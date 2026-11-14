/** 回し方: 周回数・時間・止まる位置のずれ (マスの中心から ±度) */
export const SPIN = Object.freeze({ turns: 5, durationMs: 4600, jitterDeg: 4 });

const UINT32_RANGE = 2 ** 32;

/** i を 0..n-1 に折り返す */
export const wrap = (i, n) => ((i % n) + n) % n;

export function cryptoUint32() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0];
}

/** 0..n-1 を同じ確率で返す。剰余の偏りが出る上端の値は引き直す (棄却法) */
export function randomIndex(n, nextUint32 = cryptoUint32) {
  if (!Number.isInteger(n) || n < 1 || n > UINT32_RANGE) {
    throw new RangeError(`n must be an integer in 1..2^32, got ${n}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % n);
  for (;;) {
    const x = nextUint32();
    if (x < limit) return x % n;
  }
}

/** 0 以上 1 未満 */
export const randomUnit = (nextUint32 = cryptoUint32) => nextUint32() / UINT32_RANGE;

/** マス i の中心の角度 (真上から時計回りを正)。駅は反時計回りに並ぶ = 北が上の路線図と同じ巡り */
export const sliceAngle = (i, n) => 0 - i * (360 / n);

/**
 * 真上のマス i の左右にあるマス (左 = 番号が 1 つ後 / 右 = 1 つ前)。
 * 環状線は輪で回る。端がある路線は、終点・始発で片側が無い (-1)。
 * breaks = 線路がつながっていない所 (k = k と k+1 の間)。またぐ駅はとなりにしない
 */
export function sides(i, n, loop = true, breaks = []) {
  if (loop) return { left: wrap(i + 1, n), right: wrap(i - 1, n) };
  const cut = new Set(breaks);
  return {
    left: i + 1 < n && !cut.has(i) ? i + 1 : -1,
    right: i - 1 >= 0 && !cut.has(i - 1) ? i - 1 : -1,
  };
}

/** 止まる位置のずれの上限: 4° とマスの幅の 1/3 の小さい方 (境目に寄りすぎない) */
export const jitterLimit = (n) => Math.min(SPIN.jitterDeg, 360 / n / 3);

/** 盤の回転角 (度・時計回り) のとき、真上の針の下にあるマスの番号 */
export function indexAt(rotationDeg, n) {
  return wrap(Math.round(rotationDeg / (360 / n)), n);
}

/**
 * from から時計回りに turns 周以上回り、target のマス (中心から jitter 度ずらした所) で止まる回転角。
 * 移動量は turns*360 以上 (turns+1)*360 未満。
 */
export function planSpin({ from, target, n, turns, jitter = 0 }) {
  const rest = target * (360 / n) + jitter;
  const delta = (((rest - from) % 360) + 360) % 360;
  return from + turns * 360 + delta;
}

export const easeOutQuart = (p) => 1 - (1 - p) ** 4;
