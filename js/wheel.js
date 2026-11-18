/** 盤の寸法と、盤に駅名をどう書くか (仕様 §0-4・§3)。DOM を使わない純関数 */

/** 盤の座標の幅 (viewBox -164..164) */
export const VIEW = 328;
/**
 * 盤の寸法 (viewBox の単位)。
 * 外周の帯 130..146 (中心線 138) / 駅名は 124 から内へ / 中心の円 26。上の余白に電車の顔が乗る
 */
export const GEO = Object.freeze({
  outer: 146, rim: 138, sliceOuter: 130, hub: 26, textOuter: 124, fontMax: 15, fontMin: 7, fontFloor: 5.5,
});
/** 1 列でこれより小さくなる駅名は、2 列や括弧を外した名前も考える */
const READABLE = 9;
/** 2 列の列の中心は ±0.55 字 (列の外の端 = 1.05 字) */
export const COLUMN_OFFSET = 0.55;
const NO_START = new Set('ー・）〉」』、。ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ');
const NO_END = new Set('（〈「『');

/** length 字の列を cols 列、1 マス step 度に書くときの一番大きい文字の大きさ (min 以上)。収まらなければ null */
export function labelFontSize(length, step, cols = 1, min = GEO.fontMin) {
  const halfTan = Math.tan(((Math.min(step, 90) / 2) * Math.PI) / 180);
  for (let fs = GEO.fontMax; fs >= min; fs -= 0.25) {
    const innerEdge = GEO.textOuter - length * fs;
    const halfWidth = cols === 1 ? fs / 2 : fs * (COLUMN_OFFSET + 0.5);
    if (innerEdge >= GEO.hub + 4 && innerEdge * halfTan >= halfWidth + 0.6) return fs;
  }
  return null;
}

/** 2 列に分ける: 真ん中で、列の頭に ー・）や小さい字、列の終わりに （ が来ないようにずらす */
export function splitColumns(chars) {
  let cut = Math.ceil(chars.length / 2);
  while (cut < chars.length - 1 && NO_START.has(chars[cut])) cut += 1;
  while (cut > 1 && NO_END.has(chars[cut - 1])) cut -= 1;
  return [chars.slice(0, cut), chars.slice(cut)];
}

/** 1 列 → 2 列 → 括弧を外した名前、の順に、min 以上で一番大きく書ける形。どれも入らなければ null */
function layoutAt(name, step, min) {
  const bare = name.replace(/(（[^）]*）|〈[^〉]*〉)$/, '');
  let best = null;
  for (const text of bare && bare !== name ? [name, bare] : [name]) {
    const chars = [...text];
    const one = labelFontSize(chars.length, step, 1, min);
    let pick = one === null ? null : { cols: [chars], fs: one };
    if ((one === null || one < READABLE) && chars.length >= 2) {
      const cols = splitColumns(chars);
      const two = labelFontSize(Math.max(cols[0].length, cols[1].length), step, 2, min);
      if (two !== null && (one === null || two >= one + 1)) pick = { cols, fs: two };
    }
    if (pick && pick.fs >= READABLE) return pick;
    if (pick && (!best || pick.fs > best.fs)) best = pick;
  }
  return best;
}

/**
 * 盤に書く駅名: { cols: [[字…]] または [[右の列], [左の列]], fs }。
 * 1 列 → 9 未満・収まらなければ 2 列 (1 以上大きく書けるとき) → それでも 9 未満なら括弧を外した名前。
 * 7 でも入らない駅だけ 5.5 まで小さくする
 */
export function labelLayout(name, n) {
  const step = 360 / n;
  return layoutAt(name, step, GEO.fontMin) || layoutAt(name, step, GEO.fontFloor)
    || { cols: [[...name]], fs: GEO.fontFloor };
}
