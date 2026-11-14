import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseHex, contrast, inkOn, darkenUntil, mix, lineTheme, textFill, darkRing, DARK_BG,
} from '../js/color.js';

const data = JSON.parse(readFileSync(new URL('../data/lines.json', import.meta.url), 'utf8'));

test('parseHex: #rgb と #rrggbb を読める・おかしな値は投げる', () => {
  assert.deepEqual(parseHex('#9acd32'), [154, 205, 50]);
  assert.deepEqual(parseHex('#FFF'), [255, 255, 255]);
  assert.throws(() => parseHex('green'));
  assert.throws(() => parseHex('#12345'));
});

test('contrast: 白と黒は 21:1・同じ色は 1:1', () => {
  assert.equal(Math.round(contrast('#ffffff', '#000000') * 10) / 10, 21);
  assert.equal(contrast('#9acd32', '#9acd32'), 1);
});

test('inkOn: 路線の色の上の文字は、黒 (#222) と白のコントラストが大きい方', () => {
  assert.equal(inkOn('#9acd32'), '#222222');
  assert.equal(inkOn('#ffd400'), '#222222');
  assert.equal(inkOn('#0079c2'), '#ffffff');
  assert.equal(inkOn('#e60012'), '#ffffff');
});

test('darkenUntil: 白地で 4.5:1 になるまで暗くする (元から足りていればそのまま)', () => {
  for (const color of ['#9acd32', '#ffd400', '#f39700', '#00a7db', '#ffffff']) {
    const dark = darkenUntil(color, '#ffffff', 4.5);
    assert.ok(contrast(dark, '#ffffff') >= 4.5, `${color} -> ${dark}`);
  }
  assert.equal(darkenUntil('#0079c2', '#ffffff', 4.5), '#0079c2');
});

test('mix: 0 はそのまま・1 は相手の色', () => {
  assert.equal(mix('#9acd32', '#000000', 0), '#9acd32');
  assert.equal(mix('#9acd32', '#000000', 1), '#000000');
});

test('lineTheme: 8 つのトークンが揃い、文字のコントラストが足りる', () => {
  for (const color of ['#9acd32', '#ffd400', '#0079c2', '#e60012', '#80c241', '#b5b5ac', '#f39700']) {
    const t = lineTheme(color);
    assert.deepEqual(Object.keys(t).sort(), ['--jy', '--jy-deep', '--jy-fill', '--jy-fill-ink', '--jy-ink', '--jy-ring', '--jy-soft', '--jy-text']);
    assert.ok(contrast(t['--jy-ink'], color) >= 3, `ink on ${color}`);
    assert.ok(contrast(t['--jy-text'], '#ffffff') >= 4.5, `text of ${color}`);
  }
});

test('全路線: 小さい文字を乗せる塗りは 4.5:1・ボタンの文字は 3:1・ダークの縁は背景と 3:1 (仕様 §0-3)', () => {
  let adjusted = 0;
  for (const line of data.lines) {
    const t = lineTheme(line.color);
    assert.ok(contrast(t['--jy-fill'], t['--jy-fill-ink']) >= 4.5, `${line.name} ${line.color} -> ${t['--jy-fill']}`);
    assert.ok(contrast(t['--jy'], t['--jy-ink']) >= 3, `${line.name} のボタン`);
    assert.ok(contrast(t['--jy-text'], '#ffffff') >= 4.5, `${line.name} の地図の文字 (白地)`);
    assert.ok(contrast(t['--jy-text'], t['--jy-soft']) >= 4.5, `${line.name} の地図の文字 (指を置いたとき)`);
    if (t['--jy-fill'] !== line.color) adjusted += 1;
    const ring = t['--jy-ring'];
    if (contrast(line.color, DARK_BG) >= 3) assert.equal(ring, 'transparent', line.name);
    else assert.ok(contrast(ring, DARK_BG) >= 3, `${line.name} の縁 ${ring}`);
  }
  assert.ok(adjusted > 0 && adjusted < data.lines.length / 2, `塗りを変えた路線 ${adjusted}`);
});

test('textFill: 足りている色はそのまま (山手線)・足りない色は少しだけ変える', () => {
  assert.deepEqual(textFill('#80c241'), { fill: '#80c241', ink: '#222222' });
  const red = textFill('#ff0000');
  assert.ok(contrast(red.fill, red.ink) >= 4.5);
  assert.notEqual(red.fill, '#ff0000');
});

test('DARK_BG は style.css のダークの背景と同じ', () => {
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
  const dark = css.slice(css.indexOf('@media (prefers-color-scheme: dark)'));
  assert.equal(/--bg:\s*(#[0-9a-f]{6})/i.exec(dark)[1].toLowerCase(), DARK_BG);
});
