/** 結果プレートのよみ・ローマ字の行: 副駅名・英語の説明を外して本体だけにする (仕様 §4)。DOM を使わない純関数 */

/** 最後の括弧 (（…）・(…)・〈…〉) か `…` で囲んだ部分 */
const NOTE_TAIL = /\s*(?:[（(〈][^（(〈]*[）)〉]|`[^`]*`)\s*$/;

/** 駅名の最後に副駅名の括弧がある (例: 押上〈スカイツリー前〉) */
const hasNote = (name) => /[）)〉]$/.test(name);

/** ローマ字: 最後の括弧・`…` の説明を外す (例: Meiji-jingumae `Harajuku` → Meiji-jingumae) */
export const mainRomaji = (romaji) => romaji.replace(NOTE_TAIL, '');

/**
 * よみ: 駅名に副駅名があるときだけ、その読み (最後の括弧の中、無ければ最後の全角スペースの後) を外す。
 * 駅名に括弧が無いときは外さない (大阪難波 = おおさか　なんば は全角スペースが読みの区切りなだけ)
 */
export function mainKana(name, kana) {
  if (!hasNote(name)) return kana;
  const stripped = kana.replace(NOTE_TAIL, '');
  if (stripped !== kana) return stripped;
  const space = kana.lastIndexOf('　');
  return space > 0 ? kana.slice(0, space) : kana;
}
