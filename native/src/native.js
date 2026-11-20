/**
 * アプリ (iOS・Android) だけで動く部分: 広告 (バナー・動画)・管理画面 (Remote Config)・追跡の許可 (ATT)・振動・共有・戻るボタン。
 * scripts/build.mjs が esbuild で www/js/native.js にまとめる。js/app.js がアプリのときだけ読み、start() を呼ぶ。
 * 仕様: docs/spec-app.md §2〜§5
 */
import { Capacitor } from '@capacitor/core';
import {
  AdMob, BannerAdPosition, BannerAdSize, BannerAdPluginEvents, InterstitialAdPluginEvents,
} from '@capacitor-community/admob';
import { FirebaseRemoteConfig } from '@capacitor-firebase/remote-config';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Share } from '@capacitor/share';
import { App } from '@capacitor/app';
import {
  AD_DEFAULTS, INITIAL_AD_STATE, sanitizeAdSettings, noteLineChange, decideBeforeSpin,
} from '../../js/ads-policy.js';

/* global __ADS_MODE__, __APP_VERSION__ */
/** 'test' = Google のテスト広告 + 管理画面を無視して広告を出す / 'release' = 本物の広告 + 管理画面どおり */
const ADS_MODE = __ADS_MODE__;
const APP_VERSION = __APP_VERSION__;
const PLATFORM = Capacitor.getPlatform();

/** 広告ユニット (テスト = Google 公式のテスト用・本物 = 仕様 §2-3)。ビルドの種類で片方だけがアプリに入る */
const AD_UNITS = __ADS_MODE__ === 'release'
  ? {
    ios: { banner: 'ca-app-pub-4798502599946388/4211533042', interstitial: 'ca-app-pub-4798502599946388/1602836528' },
    android: { banner: 'ca-app-pub-4798502599946388/1219693140', interstitial: 'ca-app-pub-4798502599946388/7593529803' },
  }
  : {
    ios: { banner: 'ca-app-pub-3940256099942544/2435281174', interstitial: 'ca-app-pub-3940256099942544/4411468910' },
    android: { banner: 'ca-app-pub-3940256099942544/9214589741', interstitial: 'ca-app-pub-3940256099942544/1033173712' },
  };
const UNITS = AD_UNITS[PLATFORM];

/** 管理画面のキー (Firebase Remote Config) */
const RC = {
  bannerEnabled: 'ads_banner_enabled',
  interstitialEnabled: 'ads_interstitial_enabled',
  everySpins: 'interstitial_every_spins',
  minIntervalSec: 'interstitial_min_interval_sec',
  maxPerSession: 'interstitial_max_per_session',
};
const RC_FETCH_INTERVAL_SEC = 3600;
const RC_WAIT_MS = 10000;
/** 動画広告の閉じる知らせが来ないときに、回すのを止めたままにしない上限 */
const AD_CLOSE_FALLBACK_MS = 5 * 60 * 1000;

let settings = { ...AD_DEFAULTS };
let adState = INITIAL_AD_STATE;
let adsStarted = false;
let adsStarting = false;
/** 同意が取れなかった (日本では出ない)。始め直さない */
let adsRefused = false;
/** 'idle' | 'loading' | 'shown' | 'failed'。失敗したバナーはプラグインが片づけるので、こちらで出し直す (仕様 §2-1) */
let bannerState = 'idle';
let interstitialReady = false;
/** (iOS) 追跡の許可の答えが出たら終わる。Android・聞かないときはすぐ終わる */
let trackingAnswered = Promise.resolve();
let interstitialLoading = false;
let onInterstitialDone = null;

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((_, reject) => { window.setTimeout(() => reject(new Error('timeout')), ms); }),
]);

const nextFrame = () => new Promise((resolve) => { window.requestAnimationFrame(() => resolve()); });

/** 管理画面の値を取る。取れないときは前回取れた値か既定 (= 広告なし) */
async function loadSettings() {
  try {
    await FirebaseRemoteConfig.setDefaults({
      defaults: Object.fromEntries(Object.entries(RC).map(([name, key]) => [key, AD_DEFAULTS[name]])),
    });
    await FirebaseRemoteConfig.setSettings({
      minimumFetchIntervalInSeconds: RC_FETCH_INTERVAL_SEC,
      fetchTimeoutInSeconds: RC_WAIT_MS / 1000,
    });
    await withTimeout(FirebaseRemoteConfig.fetchAndActivate(), RC_WAIT_MS).catch(() => {});
    const raw = {};
    for (const [name, key] of Object.entries(RC)) {
      const read = typeof AD_DEFAULTS[name] === 'boolean'
        ? FirebaseRemoteConfig.getBoolean({ key })
        : FirebaseRemoteConfig.getNumber({ key });
      raw[name] = (await read).value;
    }
    return sanitizeAdSettings(raw);
  } catch {
    return { ...AD_DEFAULTS };
  }
}

/** 「回す」とバナーの間 (AdMob の決まり: 押し間違いを誘わない) */
const BANNER_GAP = 16;

/**
 * バナーの高さ + 間の分だけ、アプリの画面の下を詰める (style.css の --ad-h)。
 * バナーは下の安全領域 (ホームバー) のすぐ上に出るので、安全領域の分は style.css 側の env() が受け持つ
 */
function setAdHeight(height) {
  const h = Math.max(0, Math.round(Number(height) || 0));
  document.documentElement.style.setProperty('--ad-h', `${h > 0 ? h + BANNER_GAP : 0}px`);
}

/** 動画広告が閉じた (shown = true)・出せなかった (false) ときに、回すのを待っている所へ知らせる。2 回目以降は何もしない */
function finishInterstitial(shown) {
  const finish = onInterstitialDone;
  onInterstitialDone = null;
  finish?.(shown);
}

function prepareInterstitial() {
  if (interstitialReady || interstitialLoading || !UNITS) return;
  interstitialLoading = true;
  AdMob.prepareInterstitial({ adId: UNITS.interstitial })
    .then(() => { interstitialReady = true; })
    .catch(() => { interstitialReady = false; })
    .finally(() => { interstitialLoading = false; });
}

function bannerFailed() {
  bannerState = 'failed';
  setAdHeight(0);
}

function showBannerAd() {
  bannerState = 'loading';
  AdMob.showBanner({
    adId: UNITS.banner,
    adSize: BannerAdSize.ADAPTIVE_BANNER,
    position: BannerAdPosition.BOTTOM_CENTER,
    margin: 0,
  }).catch(bannerFailed);
}

/**
 * iOS の追跡の許可 (ATT) を聞き、答えが出るまで待つ (仕様 §4)。
 * 確認の画面を出す呼び出しは答えを待たずに返ることがある。アプリが前に出ていないときは画面を出さずに返り、
 * 答えずに閉じられたら「未決定」のまま (Apple の説明) → 前に出ているときに、前に出てから 1 回だけ聞き直す
 */
async function askTracking() {
  let asked = false;
  while ((await AdMob.trackingAuthorizationStatus()).status === 'notDetermined') {
    const { isActive } = await App.getState();
    if (!isActive) asked = false;
    else if (!asked) {
      asked = true;
      await AdMob.requestTrackingAuthorization();
    }
    await new Promise((resolve) => { window.setTimeout(resolve, 500); });
  }
}

/** 同意の確認 → (iOS) 追跡の許可の答えを待つ → 初期化 → 広告。広告が全部 OFF のときは何もしない (追跡の許可は start() が ON/OFF に関係なく聞く) */
async function startAds() {
  if (adsStarted || adsStarting || adsRefused || !UNITS) return;
  if (!settings.bannerEnabled && !settings.interstitialEnabled) return;
  adsStarting = true;
  try {
    try {
      const info = await AdMob.requestConsentInfo();
      let canRequestAds = info.canRequestAds !== false;
      if (info.status === 'REQUIRED' && info.isConsentFormAvailable) {
        canRequestAds = (await AdMob.showConsentForm()).canRequestAds !== false;
      }
      if (!canRequestAds) { adsRefused = true; return; }
    } catch { /* 同意の確認ができないときも、日本では出す場面が無いので続ける */ }
    // 追跡の許可の答えが出るまで待ってから広告を読む (聞くのは start() で、広告の ON/OFF に関係なく 1 回)
    await trackingAnswered;
    await AdMob.initialize();
    adsStarted = true;
  } finally {
    adsStarting = false;
  }
  if (settings.bannerEnabled) {
    AdMob.addListener(BannerAdPluginEvents.Loaded, () => { bannerState = 'shown'; });
    AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => setAdHeight(size?.height));
    AdMob.addListener(BannerAdPluginEvents.FailedToLoad, bannerFailed);
    showBannerAd();
  }
  if (settings.interstitialEnabled) {
    AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => finishInterstitial(true));
    AdMob.addListener(InterstitialAdPluginEvents.FailedToShow, () => finishInterstitial(false));
    prepareInterstitial();
  }
}

/** 読めなかった広告を読み直す (電波が戻ったとき・回す前)。起動時に始められなかったら始め直す (仕様 §2-1・§2-2) */
function retryAds() {
  if (!adsStarted) {
    startAds().catch(() => setAdHeight(0));
    return;
  }
  if (settings.bannerEnabled && bannerState === 'failed') showBannerAd();
  if (settings.interstitialEnabled && !interstitialReady) prepareInterstitial();
}

/** 回す前に呼ぶ。動画広告を出すときは閉じるまで (出せなくても) 待つ */
async function beforeSpin() {
  const input = { ...settings, ready: interstitialReady, now: Date.now() };
  const before = adState;
  const decision = decideBeforeSpin(before, input);
  adState = decision.state;
  if (!decision.show) {
    retryAds();
    return;
  }
  interstitialReady = false;
  const shown = await new Promise((resolve) => {
    // 閉じた知らせが来ないときは、出たものとして回す
    const timer = window.setTimeout(() => { onInterstitialDone = null; resolve(true); }, AD_CLOSE_FALLBACK_MS);
    onInterstitialDone = (ok) => { window.clearTimeout(timer); resolve(ok); };
    AdMob.showInterstitial().catch(() => finishInterstitial(false));
  });
  // 出せなかった (読んでから 1 時間たって期限切れなど) ときは「出した」に数えない = 読み込めていないときと同じ (仕様 §2-2)
  if (!shown) adState = decideBeforeSpin(before, { ...input, ready: false }).state;
  prepareInterstitial();
}

/** Android の戻るボタン: 「このアプリについて」が開いていれば閉じる。それ以外はアプリを閉じる */
function watchBackButton() {
  App.addListener('backButton', () => {
    const about = document.getElementById('about');
    if (about?.hasAttribute('open')) document.getElementById('about-close')?.click();
    else App.exitApp();
  });
}

export function start() {
  const version = document.getElementById('about-version');
  if (version) version.textContent = APP_VERSION;
  if (PLATFORM === 'android') watchBackButton();

  // 盤が出た後に、(iOS) 追跡の許可を聞き、管理画面の値を取ってから広告を始める
  (async () => {
    await nextFrame();
    await nextFrame();
    // 広告の ON/OFF に関係なく聞く (仕様 §4・審査中の広告 OFF でも確認画面が出る)。断られても・聞けなくても広告は出る
    if (PLATFORM === 'ios') trackingAnswered = askTracking().catch(() => {});
    settings = await loadSettings();
    if (ADS_MODE === 'test') settings = { ...settings, bannerEnabled: true, interstitialEnabled: true };
    // 追跡の許可の答えを待っている間に電波が戻っても読み直せるように、始める前に付ける
    window.addEventListener('online', retryAds);
    await startAds().catch(() => setAdHeight(0));
  })();

  return {
    beforeSpin,
    lineChanged() { adState = noteLineChange(adState); },
    stopped() { Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}); },
    share({ station, line }) {
      Share.share({ text: `今日の駅は${station}（${line}）！` }).catch(() => { /* 閉じただけ */ });
    },
  };
}
