/** 路線の色から、画面で使う色のトークンを作る (WCAG のコントラスト比で文字の色を選ぶ) */

const INK = '#222222';
const WHITE = '#ffffff';
const BLACK = '#000000';
/** ダークモードの背景 (style.css の --bg と同じ。テストで確かめる) */
export const DARK_BG = '#16181b';

/** '#rgb' / '#rrggbb' → [r, g, b] */
export function parseHex(hex) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) throw new TypeError(`not a hex color: ${hex}`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  return [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16));
}

const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;

function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG のコントラスト比 (1〜21) */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** a に b を t の割合で混ぜる (0 = a のまま / 1 = b) */
export function mix(a, b, t) {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return toHex(ca.map((v, k) => v + (cb[k] - v) * t));
}

/** 色の上に乗せる文字の色: 黒 (#222) と白のうちコントラストが大きい方 */
export const inkOn = (bg) => (contrast(INK, bg) >= contrast(WHITE, bg) ? INK : WHITE);

/** against の上で min 以上のコントラストになるまで黒を混ぜて暗くする */
export function darkenUntil(color, against, min) {
  for (let t = 0; t <= 1; t += 0.02) {
    const c = mix(color, BLACK, t);
    if (contrast(c, against) >= min) return t === 0 ? color.toLowerCase() : c;
  }
  return BLACK;
}

/**
 * 小さい文字を乗せる塗り (§0-3): 文字とのコントラストが 4.5 未満なら、黒を混ぜて白い文字 / 白を混ぜて黒い文字の
 * うち、混ぜる量が少ない方で 4.5 にする
 */
export function textFill(color) {
  const base = color.toLowerCase();
  const ink = inkOn(base);
  if (contrast(base, ink) >= 4.5) return { fill: base, ink };
  for (let k = 1; k <= 50; k += 1) {
    const t = k / 50;
    const dark = mix(base, BLACK, t);
    if (contrast(dark, WHITE) >= 4.5) return { fill: dark, ink: WHITE };
    const light = mix(base, WHITE, t);
    if (contrast(light, INK) >= 4.5) return { fill: light, ink: INK };
  }
  return { fill: BLACK, ink: WHITE };
}

/** ダークの背景の上で、路線の色の形が見える (3:1) 縁の色。路線の色だけで足りていれば透明 */
export function darkRing(color) {
  const base = color.toLowerCase();
  if (contrast(base, DARK_BG) >= 3) return 'transparent';
  for (let k = 1; k <= 25; k += 1) {
    const c = mix(base, WHITE, k / 25);
    if (contrast(c, DARK_BG) >= 3) return c;
  }
  return WHITE;
}

/** 路線の色 → :root に入れるトークン (§0-3) */
export function lineTheme(color) {
  const base = color.toLowerCase();
  const { fill, ink } = textFill(base);
  const soft = mix(base, WHITE, 0.72);
  return {
    '--jy': base,
    '--jy-ink': inkOn(base),
    '--jy-deep': mix(base, BLACK, 0.28),
    // 地図のピルの文字: 指を置いたときの淡い地 (soft) で 4.5:1 → 白地ではもっと高い
    '--jy-text': darkenUntil(base, soft, 4.5),
    '--jy-soft': soft,
    '--jy-fill': fill,
    '--jy-fill-ink': ink,
    '--jy-ring': darkRing(base),
  };
}
