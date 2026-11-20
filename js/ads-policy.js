/**
 * 動画広告 (インタースティシャル) を回す前に出すかの判定。画面や広告の SDK には触らない純関数だけ。
 * 出す候補 = ユーザーが路線か地域を変えた後の最初の回転 / 前の広告から everySpins 回目の回転。
 * 候補でも、OFF・読み込めていない・前の広告から minIntervalSec 秒未満・この起動で maxPerSession 回出した後なら出さない。
 */

/** 管理画面 (Remote Config) の既定値 = 広告なし。取りに行けないときもこの値 */
export const AD_DEFAULTS = Object.freeze({
  bannerEnabled: false,
  interstitialEnabled: false,
  everySpins: 5,
  minIntervalSec: 90,
  maxPerSession: 3,
});

/** 起動したときの状態 */
export const INITIAL_AD_STATE = Object.freeze({
  spins: 0,
  lineChanged: false,
  shown: 0,
  lastShownAt: null,
});

const whole = (value, min, fallback) => (
  typeof value === 'number' && Number.isFinite(value) && value >= min ? Math.floor(value) : fallback
);

/** 管理画面の値を確かめる。型や範囲がおかしい値は既定値に戻す */
export function sanitizeAdSettings(raw = {}) {
  return {
    bannerEnabled: raw.bannerEnabled === true,
    interstitialEnabled: raw.interstitialEnabled === true,
    // 下限 2: 1 だと起動して最初の回転で出てしまう (仕様 §2-2「開いた直後は出さない」)
    everySpins: whole(raw.everySpins, 2, AD_DEFAULTS.everySpins),
    minIntervalSec: whole(raw.minIntervalSec, 0, AD_DEFAULTS.minIntervalSec),
    maxPerSession: whole(raw.maxPerSession, 0, AD_DEFAULTS.maxPerSession),
  };
}

/** ユーザーが路線か地域を変えたとき */
export function noteLineChange(state) {
  return { ...state, lineChanged: true };
}

/**
 * 「回す」を押したときに呼ぶ。show = 回す前に動画広告を出すか、state = 次の状態。
 * @param {typeof INITIAL_AD_STATE} state
 * @param {{interstitialEnabled: boolean, everySpins: number, minIntervalSec: number,
 *   maxPerSession: number, ready: boolean, now: number}} input now はミリ秒
 */
export function decideBeforeSpin(state, input) {
  const spins = state.spins + 1;
  const due = state.lineChanged || spins >= input.everySpins;
  const rested = state.lastShownAt === null || input.now - state.lastShownAt >= input.minIntervalSec * 1000;
  const allowed = input.interstitialEnabled && input.ready && rested && state.shown < input.maxPerSession;
  if (due && allowed) {
    return {
      show: true,
      state: { spins: 0, lineChanged: false, shown: state.shown + 1, lastShownAt: input.now },
    };
  }
  return { show: false, state: { ...state, spins, lineChanged: false } };
}
