import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mainKana, mainRomaji } from '../js/names.js';

const data = JSON.parse(readFileSync(new URL('../data/lines.json', import.meta.url), 'utf8'));
const stations = data.lines.flatMap((line) => line.stations);

test('ローマ字: 最後の括弧と `…` の説明を外す (仕様 §4)', () => {
  assert.equal(mainRomaji('Kokusaikaikan （Kyoto International Conference Center）'), 'Kokusaikaikan');
  assert.equal(mainRomaji('Meiji-jingumae `Harajuku`'), 'Meiji-jingumae');
  assert.equal(mainRomaji('Dokkyodaigakumae〈Soka-Matsubara〉'), 'Dokkyodaigakumae');
  assert.equal(mainRomaji('Ohorikoen(Ohori Park)'), 'Ohorikoen');
  assert.equal(mainRomaji('Shibuya'), 'Shibuya');
  assert.equal(mainRomaji(''), '');
});

test('よみ: 駅名に副駅名の括弧があるときだけ外す・大阪難波の全角スペースは残す', () => {
  assert.equal(mainKana('押上〈スカイツリー前〉', 'おしあげ　すかいつりーまえ'), 'おしあげ');
  assert.equal(mainKana('明治神宮前〈原宿〉', 'めいじじんぐうまえ　はらじゅく'), 'めいじじんぐうまえ');
  assert.equal(mainKana('西鉄福岡（天神）', 'にしてつふくおか（てんじん）'), 'にしてつふくおか');
  assert.equal(mainKana('大阪難波', 'おおさか　なんば'), 'おおさか　なんば');
  assert.equal(mainKana('空港第２ビル（第２旅客ターミナル）', 'くうこうだいにびる'), 'くうこうだいにびる');
  assert.equal(mainKana('渋谷', 'しぶや'), 'しぶや');
});

test('全駅: よみ・ローマ字の行に括弧・` が残らない (駅名に括弧が無い駅のよみはそのまま)', () => {
  for (const s of stations) {
    const kana = mainKana(s.name, s.kana);
    const romaji = mainRomaji(s.romaji);
    assert.ok(!/[（）()〈〉`]/.test(kana), `${s.name}: ${kana}`);
    assert.ok(!/[（）()〈〉`]/.test(romaji), `${s.name}: ${romaji}`);
    if (!/[）〉)]$/.test(s.name)) assert.equal(kana, s.kana, s.name);
    assert.ok(romaji.length > 0 || s.romaji === '', s.name);
  }
});
