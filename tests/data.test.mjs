import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATIONS } from '../js/stations.js';

const data = JSON.parse(readFileSync(new URL('../data/lines.json', import.meta.url), 'utf8'));
const PREFS = data.regions.flatMap((area) => area.prefs);

test('地域: 5 都市圏・11 都道府県 (仕様 §0-1)', () => {
  assert.deepEqual(data.regions.map((area) => area.area), ['首都圏', '関西', '名古屋', '福岡', '札幌']);
  assert.deepEqual(PREFS, ['東京', '神奈川', '埼玉', '千葉', '大阪', '京都', '兵庫', '奈良', '愛知', '福岡', '北海道']);
});

test('どの地域にも路線が 1 本以上ある', () => {
  for (const pref of PREFS) {
    assert.ok(data.lines.some((line) => line.prefs.includes(pref)), pref);
  }
});

test('路線: id は重複なし・色は #rrggbb・地域は一覧の中・駅は 2 つ以上で駅名の重複なし', () => {
  const ids = new Set();
  for (const line of data.lines) {
    assert.ok(!ids.has(line.id), line.id);
    ids.add(line.id);
    assert.ok(line.name && line.short && line.operator, line.id);
    assert.match(line.color, /^#[0-9a-f]{6}$/, line.name);
    assert.ok(line.prefs.length > 0 && line.prefs.every((p) => PREFS.includes(p)), line.name);
    assert.ok(line.stations.length >= 2, line.name);
    const names = line.stations.map((s) => s.name);
    assert.equal(new Set(names).size, names.length, `${line.name} に同じ駅名`);
    for (const s of line.stations) {
      assert.equal(typeof s.kana, 'string');
      assert.equal(typeof s.romaji, 'string');
      assert.equal(typeof s.code, 'string');
    }
  }
});

test('切れ目: 端がある路線だけ・番号は 0..n-2 の昇順', () => {
  for (const line of data.lines) {
    if (!line.breaks) continue;
    assert.equal(line.loop, false, line.name);
    assert.deepEqual([...line.breaks].sort((a, b) => a - b), line.breaks, line.name);
    assert.ok(line.breaks.every((i) => Number.isInteger(i) && i >= 0 && i <= line.stations.length - 2), line.name);
  }
});

test('全駅に座標 (地図のピン・仕様 §4): [緯度, 経度] が日本の範囲・小数 5 桁まで', () => {
  for (const line of data.lines) {
    for (const s of line.stations) {
      assert.ok(Array.isArray(s.at) && s.at.length === 2, `${line.name} ${s.name}`);
      const [lat, lon] = s.at;
      assert.ok(lat >= 24 && lat <= 46 && lon >= 122 && lon <= 154, `${line.name} ${s.name} ${s.at}`);
      assert.equal(Math.round(lat * 1e5) / 1e5, lat);
      assert.equal(Math.round(lon * 1e5) / 1e5, lon);
    }
  }
});

test('同じ路線の中で駅番号が重複しない', () => {
  for (const line of data.lines) {
    const codes = line.stations.map((s) => s.code).filter(Boolean);
    assert.equal(new Set(codes).size, codes.length, line.name);
  }
});

test('山手線は v1 (Wikipedia で確かめた 30 駅) と同じ・環状・座標も js/stations.js と同じ', () => {
  const yamanote = data.lines.filter((line) => line.name === '山手線');
  assert.equal(yamanote.length, 1);
  assert.equal(yamanote[0].loop, true);
  assert.deepEqual(
    yamanote[0].stations.map((s) => [s.code, s.name, s.kana, s.romaji, s.at]),
    STATIONS.map((s) => [s.code, s.name, s.kana, s.romaji, s.at]),
  );
});

test('地域を変えたときの路線 (defaults): 全都道府県にあり・その地域の路線・東京は山手線 (仕様 §0-2)', () => {
  assert.deepEqual(Object.keys(data.defaults), PREFS);
  for (const pref of PREFS) {
    const line = data.lines.find((l) => l.id === data.defaults[pref]);
    assert.ok(line && line.prefs.includes(pref), pref);
  }
  // js/app.js の DEFAULT_LINE (データが読めないときの山手線) と同じ id
  assert.equal(data.defaults['東京'], 'l11302');
  assert.equal(data.lines.find((l) => l.id === 'l11302').name, '山手線');
});

test('環状線は 5 本 (山手線・大阪環状線・名城線・札幌市電・ディズニーリゾートライン)', () => {
  assert.deepEqual(
    data.lines.filter((line) => line.loop).map((line) => line.name).sort(),
    ['ディズニーリゾートライン', '名古屋市営地下鉄名城線', '大阪環状線', '山手線', '札幌市電'].sort(),
  );
});

test('その系統の列車が止まらない駅・信号場を入れない (仕様 §0-1・§1)', () => {
  const sym = (code) => (code.match(/^[A-Za-z]+/) || [''])[0];
  const num = (code) => Number((code.match(/(\d+)$/) || [])[1]);
  for (const line of data.lines) {
    assert.ok(line.stations.every((s) => !/信号場$|信号所$/.test(s.name)), line.name);
    const coded = line.stations.filter((s) => s.code);
    if (!coded.length) continue;
    const counts = {};
    for (const s of coded) counts[sym(s.code)] = (counts[sym(s.code)] || 0) + 1;
    const main = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
    const mains = line.stations.map((s, i) => (s.code && sym(s.code) === main ? i : -1)).filter((i) => i >= 0);
    for (const [i, j] of mains.slice(1).map((j, k) => [mains[k], j])) {
      if (Math.abs(num(line.stations[j].code) - num(line.stations[i].code)) !== 1) continue;
      const between = line.stations.slice(i + 1, j).filter((s) => s.code && sym(s.code) !== main);
      assert.deepEqual(between.map((s) => s.name), [], `${line.name}: ${line.stations[i].name}〜${line.stations[j].name}`);
    }
  }
  const rapid = data.lines.find((l) => l.name === '中央線(快速)');
  assert.ok(!rapid.stations.some((s) => s.name === '信濃町'));
});

test('並びの直し: 辰野支線は塩尻から戻る向き・東成田は成田空港の隣にしない・西鉄福岡（天神）のよみ', () => {
  const chuo = data.lines.find((l) => l.id === 'l11311');
  assert.equal(chuo.name, '中央本線（高尾〜塩尻）');
  assert.deepEqual(chuo.stations.slice(-7).map((s) => s.name), ['岡谷', 'みどり湖', '塩尻', '小野', '信濃川島', '辰野', '川岸']);
  const keisei = data.lines.find((l) => l.id === 'l23001');
  const k = keisei.stations.findIndex((s) => s.name === '東成田');
  assert.ok(keisei.breaks.includes(k - 1), '成田空港 と 東成田 の間を切る');
  const tenjin = data.lines.flatMap((l) => l.stations).find((s) => s.name === '西鉄福岡（天神）');
  assert.equal(tenjin.kana, 'にしてつふくおか（てんじん）');
});

test('出典が書いてある', () => {
  assert.match(data.source, /TrainLCD\/StationAPI .*MIT/);
});
