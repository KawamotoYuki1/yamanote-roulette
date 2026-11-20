import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AD_DEFAULTS, INITIAL_AD_STATE, sanitizeAdSettings, noteLineChange, decideBeforeSpin,
} from '../js/ads-policy.js';

const ON = { ...AD_DEFAULTS, interstitialEnabled: true };
const SEC = 1000;

/** state から回転を続けて、各回で出したかを返す (時刻は at の配列・ready は既定で true) */
function run(state, settings, at, { ready = true } = {}) {
  const shows = [];
  for (const now of at) {
    const r = decideBeforeSpin(state, { ...settings, ready, now });
    shows.push(r.show);
    state = r.state;
  }
  return { shows, state };
}

test('既定値は広告なし (審査中・取りに行けないとき)', () => {
  assert.equal(AD_DEFAULTS.bannerEnabled, false);
  assert.equal(AD_DEFAULTS.interstitialEnabled, false);
  assert.equal(AD_DEFAULTS.everySpins, 5);
  assert.equal(AD_DEFAULTS.minIntervalSec, 90);
  assert.equal(AD_DEFAULTS.maxPerSession, 3);
});

test('起動直後の回転では出さない (路線を変えていない)・5 回目で出す', () => {
  const { shows } = run(INITIAL_AD_STATE, ON, [1, 2, 3, 4, 5].map((s) => s * 100 * SEC));
  assert.deepEqual(shows, [false, false, false, false, true]);
});

test('路線を変えた後の最初の回転で出す・その後は数え直し', () => {
  let state = noteLineChange(INITIAL_AD_STATE);
  const first = decideBeforeSpin(state, { ...ON, ready: true, now: 1000 * SEC });
  assert.equal(first.show, true);
  state = first.state;
  assert.equal(state.spins, 0);
  assert.equal(state.lineChanged, false);
  // 出した後は、次の 5 回目まで出ない (90 秒は十分あける)
  const { shows } = run(state, ON, [1, 2, 3, 4, 5].map((s) => (1000 + s * 100) * SEC));
  assert.deepEqual(shows, [false, false, false, false, true]);
});

test('前の広告から 90 秒未満は出さない。路線を変えた印は消し、数は残す', () => {
  let state = noteLineChange(INITIAL_AD_STATE);
  state = decideBeforeSpin(state, { ...ON, ready: true, now: 0 }).state; // 出した (t=0)
  state = noteLineChange(state);
  const early = decideBeforeSpin(state, { ...ON, ready: true, now: 60 * SEC });
  assert.equal(early.show, false);
  assert.equal(early.state.lineChanged, false);
  assert.equal(early.state.spins, 1);
  // 同じ路線で回し続けて、5 回目が 90 秒を過ぎていれば出る
  const { shows } = run(early.state, ON, [70, 80, 85, 95].map((s) => s * SEC));
  assert.deepEqual(shows, [false, false, false, true]);
});

test('ちょうど 90 秒は出す (90 秒あいた)', () => {
  let state = noteLineChange(INITIAL_AD_STATE);
  state = decideBeforeSpin(state, { ...ON, ready: true, now: 0 }).state;
  state = noteLineChange(state);
  assert.equal(decideBeforeSpin(state, { ...ON, ready: true, now: 90 * SEC }).show, true);
});

test('1 回の起動で 3 回まで', () => {
  let state = INITIAL_AD_STATE;
  let shown = 0;
  for (let k = 0; k < 6; k += 1) {
    state = noteLineChange(state);
    const r = decideBeforeSpin(state, { ...ON, ready: true, now: k * 200 * SEC });
    if (r.show) shown += 1;
    state = r.state;
  }
  assert.equal(shown, 3);
  assert.equal(state.shown, 3);
});

test('OFF のときは出さない (数は進む)', () => {
  const { shows, state } = run(noteLineChange(INITIAL_AD_STATE), AD_DEFAULTS,
    [1, 2, 3, 4, 5, 6].map((s) => s * 100 * SEC));
  assert.deepEqual(shows, [false, false, false, false, false, false]);
  assert.equal(state.spins, 6);
  assert.equal(state.shown, 0);
});

test('広告が読み込めていないときは出さずに回す (印は消す)', () => {
  const r = decideBeforeSpin(noteLineChange(INITIAL_AD_STATE), { ...ON, ready: false, now: 0 });
  assert.equal(r.show, false);
  assert.equal(r.state.lineChanged, false);
  assert.equal(r.state.spins, 1);
});

test('出せなかった (期限切れ) ときに戻す状態は、回数と時刻を増やさず、次の回転でまた出す候補になる', () => {
  const before = { spins: 4, lineChanged: false, shown: 1, lastShownAt: 0 };
  const input = { ...ON, ready: true, now: 100_000 };
  assert.equal(decideBeforeSpin(before, input).show, true);
  // native.js: 出せなかったら、同じ入力で ready: false にした結果に置き換える
  const undone = decideBeforeSpin(before, { ...input, ready: false }).state;
  assert.deepEqual(undone, { spins: 5, lineChanged: false, shown: 1, lastShownAt: 0 });
  assert.equal(decideBeforeSpin(undone, { ...input, now: 101_000 }).show, true);
});

test('state を書き換えない (毎回新しい state を返す)', () => {
  const before = noteLineChange(INITIAL_AD_STATE);
  const copy = { ...before };
  decideBeforeSpin(before, { ...ON, ready: true, now: 0 });
  assert.deepEqual(before, copy);
  assert.ok(Object.isFrozen(INITIAL_AD_STATE));
});

test('管理画面の値が変なときは既定値に戻す', () => {
  assert.deepEqual(sanitizeAdSettings({}), AD_DEFAULTS);
  const s = sanitizeAdSettings({
    bannerEnabled: true,
    interstitialEnabled: 'yes',
    everySpins: 0,
    minIntervalSec: -5,
    maxPerSession: Number.NaN,
  });
  assert.equal(s.bannerEnabled, true);
  assert.equal(s.interstitialEnabled, false);
  assert.equal(s.everySpins, AD_DEFAULTS.everySpins);
  assert.equal(s.minIntervalSec, AD_DEFAULTS.minIntervalSec);
  assert.equal(s.maxPerSession, AD_DEFAULTS.maxPerSession);
  // 小数は切り捨てて整数に。0 回 (= 動画広告を出さない) と 0 秒は使える
  assert.deepEqual(
    sanitizeAdSettings({ everySpins: 3.7, minIntervalSec: 0, maxPerSession: 0 }),
    { ...AD_DEFAULTS, everySpins: 3, minIntervalSec: 0, maxPerSession: 0 },
  );
});

test('interstitial_every_spins の下限は 2 (1 だと起動して最初の回転で出てしまう)', () => {
  assert.equal(sanitizeAdSettings({ everySpins: 1 }).everySpins, AD_DEFAULTS.everySpins);
  assert.equal(sanitizeAdSettings({ everySpins: 1.9 }).everySpins, AD_DEFAULTS.everySpins);
  assert.equal(sanitizeAdSettings({ everySpins: 2 }).everySpins, 2);
  // いちばん詰めた設定 (2 回ごと・0 秒) でも、起動して最初の回転では出ない
  const tight = { ...sanitizeAdSettings({ interstitialEnabled: true, everySpins: 1, minIntervalSec: 0 }), everySpins: 2 };
  const first = decideBeforeSpin(INITIAL_AD_STATE, { ...tight, ready: true, now: 0 });
  assert.equal(first.show, false);
  assert.equal(decideBeforeSpin(first.state, { ...tight, ready: true, now: 1 }).show, true);
});

test('maxPerSession = 0 なら 1 回も出さない', () => {
  const settings = { ...ON, maxPerSession: 0 };
  assert.equal(decideBeforeSpin(noteLineChange(INITIAL_AD_STATE), { ...settings, ready: true, now: 0 }).show, false);
});
