import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GEO, labelFontSize, labelLayout, splitColumns } from '../js/wheel.js';
import { STATIONS } from '../js/stations.js';

const data = JSON.parse(readFileSync(new URL('../data/lines.json', import.meta.url), 'utf8'));
const NO_START = 'ー・）〉」』、。ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ';
const NO_END = '（〈「『';

/** 書いた駅名が、マス (step 度) と中心の円からはみ出していないか */
function fits({ cols, fs }, n) {
  const halfTan = Math.tan(((Math.min(360 / n, 90) / 2) * Math.PI) / 180);
  const innerEdge = GEO.textOuter - Math.max(...cols.map((c) => c.length)) * fs;
  const halfWidth = cols.length === 1 ? fs / 2 : fs * 1.05;
  return fs >= GEO.fontMin && innerEdge >= GEO.hub + 4 && innerEdge * halfTan >= halfWidth + 0.6;
}

test('山手線: 30 駅とも 1 列で、v1 と同じ大きさ', () => {
  for (const s of STATIONS) {
    const layout = labelLayout(s.name, 30);
    assert.equal(layout.cols.length, 1, s.name);
    assert.equal(layout.cols[0].join(''), s.name);
    assert.equal(layout.fs, labelFontSize([...s.name].length, 12, 1), s.name);
  }
});

test('データの全駅 (n ≤ 40 の路線) が、マスと中心の円からはみ出さずに書ける (仕様 §0-4)', () => {
  let count = 0;
  for (const line of data.lines) {
    const n = line.stations.length;
    if (n > 40) continue;
    for (const s of line.stations) {
      const layout = labelLayout(s.name, n);
      assert.ok(fits(layout, n), `${line.name} ${s.name} ${JSON.stringify(layout)}`);
      count += 1;
    }
  }
  assert.ok(count > 4000, `駅の数 ${count}`);
});

test('2 列: 列の頭に ー・）や小さい字、列の終わりに （ が来ない・両方の列に字がある', () => {
  for (const line of data.lines) {
    if (line.stations.length > 40) continue;
    for (const s of line.stations) {
      const { cols } = labelLayout(s.name, line.stations.length);
      if (cols.length !== 2) continue;
      assert.ok(cols[0].length > 0 && cols[1].length > 0, s.name);
      assert.ok(!NO_START.includes(cols[1][0]), `${s.name}: ${cols.map((c) => c.join('')).join(' | ')}`);
      assert.ok(!NO_END.includes(cols[0].at(-1)), `${s.name}: ${cols.map((c) => c.join('')).join(' | ')}`);
    }
  }
});

test('2 列にするのは 1 列で 9 未満・収まらないときだけ。1 列で 9 以上なら 1 列', () => {
  for (const line of data.lines) {
    const n = line.stations.length;
    if (n > 40) continue;
    for (const s of line.stations) {
      const one = labelFontSize([...s.name].length, 360 / n, 1);
      const layout = labelLayout(s.name, n);
      if (one !== null && one >= 9) {
        assert.equal(layout.cols.length, 1, s.name);
        assert.equal(layout.cols[0].join(''), s.name);
      }
    }
  }
});

test('例: 長い駅名の書き方', () => {
  const show = (name, n) => {
    const { cols, fs } = labelLayout(name, n);
    return { text: cols.map((c) => c.join('')), fs };
  };
  // ディズニーリゾートライン (4 駅): 1 列では中心の円に入り込む → 2 列
  assert.equal(show('東京ディズニーランド・ステーション', 4).text.length, 2);
  assert.equal(show('東京ディズニーランド・ステーション', 4).text.join(''), '東京ディズニーランド・ステーション');
  // 成田線 (28 駅): 2 列でも入らない → 括弧を外す
  assert.deepEqual(show('空港第２ビル（第２旅客ターミナル）', 28).text, ['空港第２ビル']);
  // ポートライナー (12 駅): 括弧つきは 2 列でも 9 未満 → 括弧を外した方が大きい
  assert.deepEqual(show('計算科学センター（神戸どうぶつ王国・「富岳」前）', 12).text, ['計算科学センター']);
  // 浅草線 (20 駅): 1 列 8.25 → 2 列で 9 以上
  assert.equal(show('押上（スカイツリー前）', 20).text.length, 2);
  assert.ok(show('押上（スカイツリー前）', 20).fs >= 9);
});

test('splitColumns: 真ん中で分け、ー や ・ を列の頭にしない', () => {
  assert.deepEqual(splitColumns([...'あいうえ']).map((c) => c.join('')), ['あい', 'うえ']);
  assert.deepEqual(splitColumns([...'あいうえお']).map((c) => c.join('')), ['あいう', 'えお']);
  assert.deepEqual(splitColumns([...'ベイサイド・ステーション']).map((c) => c.join('')), ['ベイサイド・', 'ステーション']);
  assert.deepEqual(splitColumns([...'あいーうえ']).map((c) => c.join('')), ['あいー', 'うえ']);
});
