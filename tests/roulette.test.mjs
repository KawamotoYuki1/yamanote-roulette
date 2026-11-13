import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATIONS } from '../js/stations.js';
import {
  SPIN, wrap, randomIndex, randomUnit, indexAt, planSpin, easeOutQuart, sliceAngle, sides,
} from '../js/roulette.js';

const N = STATIONS.length;

test('駅データ: 30 駅が JY01〜JY30 の順で並ぶ', () => {
  assert.equal(N, 30);
  STATIONS.forEach((s, i) => {
    assert.equal(s.code, `JY${String(i + 1).padStart(2, '0')}`);
  });
  assert.equal(STATIONS[0].name, '東京');
  assert.equal(STATIONS[29].name, '有楽町');
});

test('駅データ: 駅名は重複なし・よみがなはひらがな・ローマ字あり', () => {
  assert.equal(new Set(STATIONS.map((s) => s.name)).size, N);
  for (const s of STATIONS) {
    assert.match(s.kana, /^[ぁ-ゖー]+$/, s.name);
    assert.match(s.romaji, /^[A-Za-zŌōŪū][A-Za-zŌōŪū\- ]*$/, s.name);
  }
});

test('駅データ: 書き換えできない', () => {
  assert.ok(Object.isFrozen(STATIONS));
  assert.ok(STATIONS.every(Object.isFrozen));
});

test('wrap: 負の数・n 以上も 0..n-1 に入る', () => {
  assert.equal(wrap(-1, 30), 29);
  assert.equal(wrap(30, 30), 0);
  assert.equal(wrap(61, 30), 1);
  assert.equal(wrap(-0, 30), 0);
});

test('randomIndex: 2^32 mod n 未満の偏りを棄却法で捨てる', () => {
  for (let n = 1; n <= 100; n += 1) {
    const limit = 2 ** 32 - (2 ** 32 % n);
    assert.equal(limit % n, 0, `n=${n}`);
  }
  // n=30 の上限は 4294967280。これ以上は引き直し
  const seq = [2 ** 32 - 1, 4294967280, 4294967279];
  let calls = 0;
  const idx = randomIndex(30, () => seq[calls++]);
  assert.equal(calls, 3);
  assert.equal(idx, 4294967279 % 30);
});

test('randomIndex: 範囲外の n は投げる', () => {
  assert.throws(() => randomIndex(0), RangeError);
  assert.throws(() => randomIndex(2.5), RangeError);
});

/** 種を固定した uint32 の列 (mulberry32)。毎回同じ値になる */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}

test('randomIndex: 一様な入力 30 万個 → 30 駅とも均等 (カイ二乗 < 58.3, 自由度 29, p=0.001・種固定で毎回同じ)', () => {
  const next = seeded(20261114);
  const draws = 300_000;
  const counts = new Array(N).fill(0);
  for (let i = 0; i < draws; i += 1) counts[randomIndex(N, next)] += 1;
  const expected = draws / N;
  const chi2 = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
  assert.ok(chi2 < 58.3, `chi2=${chi2.toFixed(2)} counts=${counts.join(',')}`);
});

test('randomIndex: crypto の既定の経路で 3 万回 → 0..29 だけ・30 駅すべて出る', () => {
  const seen = new Set();
  for (let i = 0; i < 30_000; i += 1) {
    const idx = randomIndex(N);
    assert.ok(Number.isInteger(idx) && idx >= 0 && idx < N);
    seen.add(idx);
  }
  assert.equal(seen.size, N);
});

test('randomUnit: 0 以上 1 未満', () => {
  assert.equal(randomUnit(() => 0), 0);
  assert.ok(randomUnit(() => 2 ** 32 - 1) < 1);
});

test('sliceAngle: 駅は真上から反時計回りに並ぶ (北が上の路線図と同じ巡り)', () => {
  assert.equal(sliceAngle(0, N), 0);
  assert.equal(sliceAngle(1, N), -12);
  assert.equal(sliceAngle(29, N), -348);
});

test('sides: プレートの左右 = 盤の上で選ばれたマスの左右 (左 = 番号が 1 つ後 / 右 = 1 つ前)', () => {
  assert.deepEqual(sides(0, N), { left: 1, right: 29 });
  assert.deepEqual(sides(29, N), { left: 0, right: 28 });
  assert.deepEqual(sides(19, N), { left: 20, right: 18 });
});

test('indexAt: 回転角から針の下のマスを返す', () => {
  assert.equal(indexAt(0, N), 0);
  assert.equal(indexAt(12, N), 1);
  assert.equal(indexAt(-12, N), 29);
  assert.equal(indexAt(5.9, N), 0);
  assert.equal(indexAt(6.1, N), 1);
  assert.equal(indexAt(360 * 7 + 24, N), 2);
  assert.equal(indexAt(-360 * 3 - 12, N), 29);
});

test('indexAt と sliceAngle が噛み合う: マス i を真上に回した角度で、針の下は i', () => {
  for (let i = 0; i < N; i += 1) {
    assert.equal(indexAt(-sliceAngle(i, N), N), i);
  }
});

test('planSpin: 全 30 駅・どの開始角・ずれの端でも、止まった角の針の下が目標の駅', () => {
  const starts = [0, 7.3, -123.4, 3600.5, 359.99, -0.01, 1e5 + 0.7];
  const jitters = [-SPIN.jitterDeg, 0, SPIN.jitterDeg];
  for (const from of starts) {
    for (let target = 0; target < N; target += 1) {
      for (const jitter of jitters) {
        const end = planSpin({ from, target, n: N, turns: SPIN.turns, jitter });
        assert.equal(indexAt(end, N), target, `from=${from} target=${target} jitter=${jitter}`);
        const travel = end - from;
        assert.ok(travel >= SPIN.turns * 360, `travel=${travel}`);
        assert.ok(travel < (SPIN.turns + 1) * 360, `travel=${travel}`);
      }
    }
  }
});

test('planSpin: turns=0 は 1 周未満で目標に止まる (視差効果を減らす用)', () => {
  for (let target = 0; target < N; target += 1) {
    const end = planSpin({ from: 100, target, n: N, turns: 0 });
    assert.equal(indexAt(end, N), target);
    assert.ok(end - 100 >= 0 && end - 100 < 360);
  }
});

test('SPIN: ずれはマスの半分 (6°) より小さい', () => {
  assert.ok(SPIN.jitterDeg < 360 / N / 2);
  assert.ok(SPIN.turns >= 3);
  assert.ok(SPIN.durationMs >= 3000 && SPIN.durationMs <= 6000);
});

test('easeOutQuart: 0→0, 1→1, 単調増加', () => {
  assert.equal(easeOutQuart(0), 0);
  assert.equal(easeOutQuart(1), 1);
  let prev = -1;
  for (let p = 0; p <= 1.0000001; p += 0.01) {
    const v = easeOutQuart(Math.min(p, 1));
    assert.ok(v >= prev);
    prev = v;
  }
});
