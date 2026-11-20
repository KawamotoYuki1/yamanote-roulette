import { STATIONS } from './stations.js';
import {
  SPIN, randomIndex, randomUnit, indexAt, planSpin, easeOutQuart, sliceAngle, sides, jitterLimit,
} from './roulette.js';
import { lineTheme } from './color.js';
import { mainKana, mainRomaji } from './names.js';
import {
  VIEW, GEO, COLUMN_OFFSET, labelLayout,
} from './wheel.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAP_URL = 'https://www.google.com/maps/search/?api=1&query=';
const DATA_URL = './data/lines.json';
/** 見出しがこの文字数以上なら、紙吹雪の飾りを出さずに見出しに 1 段ぜんぶを使う (仕様 §0-2) */
const LONG_TITLE = 13;
const STORE = { region: 'yr:region', line: 'yr:line' };
/** 最初の路線 (データが読めないときもこれで動く) */
const DEFAULT_LINE = Object.freeze({
  id: 'l11302',
  name: '山手線',
  short: '山手線',
  operator: 'JR東日本',
  type: '2',
  color: '#80c241',
  loop: true,
  prefs: ['東京'],
  stations: STATIONS,
});
const SMALL_KANA = new Set('ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ');
/** 縦書きで 90° 回す字 (長音・括弧・波線) */
const TURN = new Set('ー（）〈〉「」『』〜～');
const BURST_PIECES = 28;
const BURST_SHAPES = ['c', 't', 'h'];

const $ = (id) => document.getElementById(id);
const ui = {
  head: document.querySelector('.head'),
  pickers: document.querySelector('.pickers'),
  region: $('pick-region'),
  line: $('pick-line'),
  title: $('title'),
  wheel: $('wheel'),
  dial: $('dial'),
  train: $('train'),
  spin: $('spin'),
  plate: $('plate'),
  code: $('plate-code'),
  kana: $('plate-kana'),
  mapSlot: $('plate-map-slot'),
  name: $('plate-name'),
  romaji: $('plate-romaji'),
  left: $('plate-left'),
  right: $('plate-right'),
  announce: $('announce'),
};
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** アプリ (iOS・Android) のとき: 広告・振動・送る・このアプリについて は js/native.js (アプリにだけ入る) が受け持つ */
const isNative = document.documentElement.classList.contains('is-native');
let native = null;
let adShowing = false;
Object.assign(ui, {
  action: document.querySelector('.action'),
  share: $('share'),
});

const r3 = (v) => Math.round(v * 1000) / 1000;

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** 真上から時計回りに deg 度、中心から r の点 */
function polar(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [r3(r * Math.sin(a)), r3(-r * Math.cos(a))];
}

function storeGet(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function storeSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch { /* 保存できない端末では覚えない */ }
}

// ---- いまの路線と盤 ----
let line = DEFAULT_LINE;
let n = 0;
let step = 0;
let parts = { slices: [], labels: [] };
let rotation = 0;
let spinning = false;
let picked = -1;
let trainAnimation = null;
let mapLink = null;
let announceTimer = 0;
let data = null;
let region = '東京';

const setRotation = (deg) => { ui.dial.style.transform = `rotate(${deg}deg)`; };

function slicePath(i) {
  const a0 = sliceAngle(i, n) - step / 2;
  const a1 = sliceAngle(i, n) + step / 2;
  const [x0, y0] = polar(GEO.hub, a0);
  const [x1, y1] = polar(GEO.sliceOuter, a0);
  const [x2, y2] = polar(GEO.sliceOuter, a1);
  const [x3, y3] = polar(GEO.hub, a1);
  const large = step > 180 ? 1 : 0;
  return `M${x0} ${y0}L${x1} ${y1}A${GEO.sliceOuter} ${GEO.sliceOuter} 0 ${large} 1 ${x2} ${y2}`
    + `L${x3} ${y3}A${GEO.hub} ${GEO.hub} 0 ${large} 0 ${x0} ${y0}Z`;
}

/** 盤の駅名 (仕様 §0-4): 1 列か 2 列の縦書き。2 列は右の列から読む */
function buildLabel(name, i) {
  const { cols, fs } = labelLayout(name, n);
  const group = svgEl('g', { class: 'label', transform: `rotate(${r3(sliceAngle(i, n))})`, 'font-size': fs });
  cols.forEach((chars, c) => {
    const x = cols.length === 1 ? 0 : r3((c === 0 ? 1 : -1) * fs * COLUMN_OFFSET);
    chars.forEach((ch, k) => {
      const y = r3(-(GEO.textOuter - fs * (k + 0.5)));
      const text = svgEl('text', { x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
      text.textContent = ch;
      if (TURN.has(ch)) text.setAttribute('transform', `rotate(90 ${x} ${y})`);
      else if (SMALL_KANA.has(ch)) text.setAttribute('transform', `translate(${r3(fs * 0.14)} ${r3(-fs * 0.14)})`);
      group.append(text);
    });
  });
  return group;
}

/** 盤を、いまの路線の駅の数で作り直す */
function buildWheel() {
  n = line.stations.length;
  step = 360 / n;
  const half = VIEW / 2;
  const svg = svgEl('svg', {
    viewBox: `${-half} ${-half} ${VIEW} ${VIEW}`, focusable: 'false', 'aria-hidden': 'true',
  });
  const groups = {
    slices: svgEl('g'), dividers: svgEl('g'), labels: svgEl('g'), dots: svgEl('g'),
  };
  const next = { slices: [], labels: [] };
  // 外周の駅の丸は、隣とくっつかない大きさまで小さく
  const dotR = r3(Math.min(3.8, ((2 * Math.PI * GEO.rim) / n) * 0.28));
  line.stations.forEach((station, i) => {
    const slice = svgEl('path', { d: slicePath(i), class: 'slice' });
    const edge = sliceAngle(i, n) - step / 2;
    const [x0, y0] = polar(GEO.hub, edge);
    const [x1, y1] = polar(GEO.sliceOuter, edge);
    const [cx, cy] = polar(GEO.rim, sliceAngle(i, n));
    groups.slices.append(slice);
    if (n > 1) {
      groups.dividers.append(svgEl('line', {
        x1: x0, y1: y0, x2: x1, y2: y1, class: 'divider',
      }));
    }
    const label = buildLabel(station.name, i);
    groups.labels.append(label);
    groups.dots.append(svgEl('circle', {
      cx, cy, r: dotR, class: 'dot',
    }));
    next.slices.push(slice);
    next.labels.push(label);
  });
  // 外周の帯の外側に、ダークで形を見せる縁 (切れ目の線より先に描き、切れ目が縁も切る)
  svg.append(groups.slices, groups.dividers, groups.labels, svgEl('circle', { r: GEO.rim, class: 'rim' }), svgEl('circle', { r: GEO.outer, class: 'rim-ring' }));
  // 端がある路線: 最後の駅と最初の駅の間、とデータの切れ目 (線路がつながっていない所) で外周の線を切る
  if (!line.loop) {
    const cuts = [step / 2, ...(line.breaks || []).map((k) => sliceAngle(k, n) - step / 2)];
    for (const angle of cuts) {
      const [bx0, by0] = polar(GEO.sliceOuter - 2, angle);
      const [bx1, by1] = polar(GEO.outer + 2, angle);
      svg.append(svgEl('line', {
        x1: bx0, y1: by0, x2: bx1, y2: by1, class: 'rim-break',
      }));
    }
  }
  svg.append(groups.dots, svgEl('circle', { r: GEO.hub, class: 'hub' }));
  ui.dial.replaceChildren(svg);
  parts = next;
}

function setPicked(i, on) {
  if (i < 0) return;
  parts.slices[i]?.classList.toggle('is-picked', on);
  parts.labels[i]?.classList.toggle('is-picked', on);
}

/** マスの境目を越えるたびに、電車の顔が振り子のように揺れる */
function swingTrain() {
  if (reduceMotion.matches) return;
  trainAnimation?.cancel();
  trainAnimation = ui.train.animate(
    [{ transform: 'rotate(-9deg)' }, { transform: 'rotate(0deg)' }],
    { duration: 170, easing: 'cubic-bezier(.2, .7, .3, 1)' },
  );
}

/** 止まったとき、プレートの駅名から紙吹雪 (丸・三角・ハート) がはじける */
function burst() {
  if (reduceMotion.matches) return;
  const box = ui.name.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const layer = document.createElement('div');
  layer.className = 'burst';
  layer.setAttribute('aria-hidden', 'true');
  const animations = [];
  for (let k = 0; k < BURST_PIECES; k += 1) {
    const piece = document.createElement('i');
    piece.className = BURST_SHAPES[k % BURST_SHAPES.length];
    piece.style.left = `${cx - 5}px`;
    piece.style.top = `${cy - 5}px`;
    layer.append(piece);
    const angle = ((-90 + (Math.random() * 2 - 1) * 80) * Math.PI) / 180;
    const distance = 80 + Math.random() * 120;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    const turn = (Math.random() * 2 - 1) * 540;
    animations.push(piece.animate([
      { transform: 'translate(0, 0) rotate(0deg) scale(.5)', opacity: 1 },
      { transform: `translate(${r3(dx)}px, ${r3(dy)}px) rotate(${r3(turn * 0.6)}deg) scale(1)`, opacity: 1, offset: 0.55 },
      { transform: `translate(${r3(dx * 1.15)}px, ${r3(dy + 80)}px) rotate(${r3(turn)}deg) scale(.9)`, opacity: 0 },
    ], { duration: 1000 + Math.random() * 400, easing: 'cubic-bezier(.2, .7, .4, 1)', fill: 'forwards' }));
  }
  document.body.append(layer);
  Promise.allSettled(animations.map((a) => a.finished)).then(() => layer.remove());
}

function ensureMapLink() {
  if (mapLink) return mapLink;
  mapLink = document.createElement('a');
  mapLink.className = 'plate-map';
  mapLink.target = '_blank';
  mapLink.rel = 'noopener';
  const arrow = document.createElement('span');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.textContent = ' ↗';
  mapLink.append('地図', arrow);
  ui.mapSlot.append(mapLink);
  return mapLink;
}

/** 読み上げ: 一度空にしてから入れる (同じ駅が続いても読ませる)。次の回転が始まったら取り消す */
function announce(message) {
  window.clearTimeout(announceTimer);
  ui.announce.textContent = '';
  announceTimer = window.setTimeout(() => { ui.announce.textContent = message; }, 60);
}

/** 駅名欄: 2〜3 文字は駅名標のように字間を広げ、長い駅名は幅に収まるまで小さく */
function setName(name) {
  const length = [...name].length;
  let track = 0.04;
  if (length <= 2) track = 0.5;
  else if (length === 3) track = 0.22;
  ui.name.textContent = name;
  ui.name.style.setProperty('--track', `${track}em`);
  ui.name.style.setProperty('--fit', String(r3(length * (1 + track))));
}

/** よみがな: 長い読みは字間と大きさを詰めて、駅番号・地図と重ならないようにする */
function setKana(kana) {
  const length = [...kana].length;
  let track = 0.04;
  if (length <= 5) track = 0.3;
  else if (length <= 7) track = 0.15;
  ui.kana.textContent = kana;
  ui.kana.style.setProperty('--kana-track', `${track}em`);
  ui.kana.style.setProperty('--kana-fit', String(r3(Math.max(1, length) * (1 + track))));
}

/** ローマ字: 1 行。長いときは幅に収まるまで小さく (欧文 0.68 字・和文 1.05 字で見積もる) */
function setRomaji(text) {
  ui.romaji.textContent = text;
  const fit = [...text].reduce((sum, ch) => sum + (ch.codePointAt(0) < 0x2000 ? 0.68 : 1.05), 0);
  ui.romaji.style.setProperty('--romaji-fit', String(r3(Math.max(1, fit))));
}

/** となりの駅: 半分の幅に収まるまで小さく (12〜9px)。それでも入らなければ … (CSS) */
function setSide(el, index) {
  const name = index >= 0 ? line.stations[index].name : '';
  el.textContent = name;
  el.parentElement.style.setProperty('--side-fit', String(Math.max(1, [...name].length)));
  el.parentElement.classList.toggle('is-void', index < 0);
}

/** 結果を消して、駅名欄を「？」(最初の状態) に戻す */
function resetPlate() {
  window.clearTimeout(announceTimer);
  ui.plate.classList.remove('is-revealed', 'has-code');
  ui.plate.classList.add('is-empty');
  for (const el of [ui.code, ui.kana, ui.romaji, ui.left, ui.right, ui.announce]) el.textContent = '';
  setName('？');
}

/** 回している間: 結果を消し、駅名欄に針の下の駅名だけを薄く流す */
function startRolling() {
  resetPlate();
  setName(line.stations[indexAt(rotation, n)].name);
}

function showStation(i) {
  const station = line.stations[i];
  ui.plate.classList.remove('is-empty', 'is-revealed');
  ui.plate.classList.toggle('has-code', Boolean(station.code));
  ui.code.textContent = station.code || '';
  // よみ・ローマ字の行は副駅名・英語の説明を外して本体だけ (駅名標のように・仕様 §4)
  setKana(mainKana(station.name, station.kana || ''));
  setName(station.name);
  setRomaji(mainRomaji(station.romaji || ''));
  const { left, right } = sides(i, n, line.loop, line.breaks || []);
  setSide(ui.left, left);
  setSide(ui.right, right);
  const link = ensureMapLink();
  // 地図 (仕様 §4): 駅名で検索せず、駅の座標にピンを立てる
  link.href = MAP_URL + encodeURIComponent(station.at.join(','));
  // 路面電車 (type 4) は停留場なので「駅」を付けない
  link.setAttribute('aria-label', `${station.name}${line.type === '4' ? '' : '駅'}を地図で見る（新しいタブで開きます）`);
  void ui.plate.offsetWidth;
  ui.plate.classList.add('is-revealed');
  announce(station.kana ? `${station.name}（${station.kana}）に決まりました` : `${station.name}に決まりました`);
}

function lockPickers(locked) {
  ui.pickers.classList.toggle('is-locked', locked);
  ui.region.disabled = locked;
  ui.line.disabled = locked;
}

function finish(target) {
  rotation = ((rotation % 360) + 360) % 360;
  setRotation(rotation);
  picked = target;
  setPicked(picked, true);
  showStation(picked);
  burst();
  spinning = false;
  ui.wheel.classList.remove('is-spinning');
  ui.spin.removeAttribute('aria-disabled');
  ui.spin.textContent = 'もう一回';
  lockPickers(false);
  if (isNative) {
    ui.action.classList.add('has-share');
    ui.share.removeAttribute('aria-disabled');
    native?.stopped();
  } else if (typeof navigator.vibrate === 'function') navigator.vibrate(18);
}

/** 「回す」: アプリでは先に動画広告を出すかを決め (出すなら閉じるまで待ち)、それから回す */
function spin() {
  if (spinning || adShowing || document.documentElement.classList.contains('is-restoring')) return;
  if (!native) {
    startSpin();
    return;
  }
  adShowing = true;
  ui.spin.setAttribute('aria-disabled', 'true');
  ui.share.setAttribute('aria-disabled', 'true');
  lockPickers(true);
  Promise.resolve().then(() => native.beforeSpin()).catch(() => {}).finally(() => {
    adShowing = false;
    startSpin();
  });
}

function startSpin() {
  spinning = true;
  if (isNative) ui.share.setAttribute('aria-disabled', 'true');
  ui.spin.setAttribute('aria-disabled', 'true');
  ui.wheel.classList.add('is-spinning');
  lockPickers(true);
  setPicked(picked, false);

  const target = randomIndex(n);
  const jitter = (randomUnit() * 2 - 1) * jitterLimit(n);
  const instant = reduceMotion.matches;
  const from = rotation;
  const end = planSpin({
    from, target, n, turns: instant ? 0 : SPIN.turns, jitter,
  });

  if (instant) {
    rotation = end;
    finish(target);
    return;
  }

  startRolling();
  const startedAt = performance.now();
  let lastEdge = Math.floor((from + step / 2) / step);
  const frame = (now) => {
    const p = Math.min(1, Math.max(0, (now - startedAt) / SPIN.durationMs));
    rotation = from + (end - from) * easeOutQuart(p);
    setRotation(rotation);
    const edge = Math.floor((rotation + step / 2) / step);
    if (edge !== lastEdge) {
      lastEdge = edge;
      swingTrain();
      setName(line.stations[indexAt(rotation, n)].name);
    }
    if (p < 1) window.requestAnimationFrame(frame);
    else finish(target);
  };
  window.requestAnimationFrame(frame);
}

/** 盤のタップは円の中だけ (四角の角は反応しない) */
function onWheelClick(event) {
  const box = ui.wheel.getBoundingClientRect();
  const dx = event.clientX - (box.left + box.width / 2);
  const dy = event.clientY - (box.top + box.height / 2);
  if (Math.hypot(dx, dy) <= (box.width * GEO.outer) / VIEW) spin();
}

/** 路線を切り替える: 盤を作り直し、色・タイトルを変え、プレートとボタンを最初に戻す */
function setLine(next) {
  if (spinning) return;
  line = next;
  rotation = 0;
  picked = -1;
  buildWheel();
  setRotation(0);
  for (const [key, value] of Object.entries(lineTheme(line.color))) {
    document.documentElement.style.setProperty(key, value);
  }
  const title = `${line.short}ルーレット`;
  ui.title.textContent = title;
  ui.title.style.setProperty('--title-fit', String([...title].length));
  ui.head.classList.toggle('is-long-title', [...title].length >= LONG_TITLE);
  document.title = title;
  ui.wheel.setAttribute('aria-label', `${line.name}の${n}駅のルーレット盤`);
  resetPlate();
  ui.spin.textContent = '回す';
  ui.action.classList.remove('has-share');
}

// ---- 地域・路線のプルダウン ----
const linesIn = (pref) => data.lines.filter((l) => l.prefs.includes(pref));

function fillRegions() {
  ui.region.replaceChildren(...data.regions.map((area) => {
    const group = document.createElement('optgroup');
    group.label = area.area;
    group.append(...area.prefs.map((pref) => new Option(pref, pref)));
    return group;
  }));
}

function fillLines(pref) {
  const groups = new Map();
  for (const l of linesIn(pref)) {
    if (!groups.has(l.operator)) groups.set(l.operator, []);
    groups.get(l.operator).push(l);
  }
  ui.line.replaceChildren(...[...groups].map(([operator, list]) => {
    const group = document.createElement('optgroup');
    group.label = operator;
    group.append(...list.map((l) => new Option(l.name, l.id)));
    return group;
  }));
}

/** 地域を変えたときの路線 (仕様 §0-2): keepId の路線がその地域にもあればそれ、なければデータの defaults */
function lineFor(pref, keepId) {
  const available = linesIn(pref);
  return available.find((l) => l.id === keepId)
    || available.find((l) => l.id === data.defaults?.[pref])
    || available[0];
}

function chooseRegion(pref) {
  region = pref;
  fillLines(pref);
  const next = lineFor(pref, line.id);
  ui.line.value = next.id;
  if (next.id !== line.id) setLine(next);
  storeSet(STORE.region, pref);
  storeSet(STORE.line, next.id);
}

// 回転中はプルダウンを押せないが、それでも変更が届いたら (端末の選択画面など) 元に戻して何もしない
ui.region.addEventListener('change', () => {
  if (spinning || adShowing) { ui.region.value = region; return; }
  const before = region;
  chooseRegion(ui.region.value);
  // 地域を変えたら、路線が同じまま (複数の都県を走る路線) でも「変えた」に数える (仕様 spec-app §2-2)
  if (region !== before) native?.lineChanged();
});
ui.line.addEventListener('change', () => {
  const next = data?.lines.find((l) => l.id === ui.line.value);
  if (spinning || adShowing || !next) { ui.line.value = line.id; return; }
  const before = line.id;
  setLine(next);
  storeSet(STORE.line, next.id);
  if (line.id !== before) native?.lineChanged();
});

async function loadLines() {
  try {
    const res = await fetch(DATA_URL, { priority: 'low' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    document.documentElement.classList.remove('is-restoring');
    return; // 路線データが読めないときは山手線だけで動く
  }
  fillRegions();
  const prefs = data.regions.flatMap((area) => area.prefs);
  const savedPref = storeGet(STORE.region);
  // 回している途中に読み終わったときは、いまの路線 (最初の山手線) のままにして、プルダウンもそれに合わせる
  let pref = prefs.includes(savedPref) ? savedPref : '東京';
  if (spinning) pref = line.prefs.find((p) => prefs.includes(p)) || '東京';
  region = pref;
  ui.region.value = pref;
  fillLines(pref);
  const first = spinning ? line : lineFor(pref, storeGet(STORE.line));
  ui.line.value = first.id;
  if (!spinning && (first.id !== line.id || first.stations.length !== n)) setLine(first);
  document.documentElement.classList.remove('is-restoring');
}

/** 最初の描画 (first-contentful-paint) の後に fn を呼ぶ。描画の記録が取れないブラウザ・裏のタブでも 3 秒後には呼ぶ */
function afterFirstPaint(fn) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    window.setTimeout(fn, 0);
  };
  if (performance.getEntriesByName('first-contentful-paint').length) {
    run();
    return;
  }
  try {
    // paint の記録は数回だけなので、見張りは付けたままにする (2 回目以降は run が何もしない)
    new PerformanceObserver((list) => {
      if (list.getEntriesByName('first-contentful-paint').length) run();
    }).observe({ type: 'paint', buffered: true });
  } catch { /* 描画の記録が取れないブラウザは 3 秒後 */ }
  window.setTimeout(run, 3000);
}

ui.spin.addEventListener('click', spin);
ui.wheel.addEventListener('click', onWheelClick);
setLine(DEFAULT_LINE);
if (document.documentElement.classList.contains('is-restoring')) {
  // 前回の路線 (山手線以外) を覚えているとき: index.html の先頭のスクリプトが最初の描画の前に見出しと盤を隠している。
  // すぐに読み、読み終わったら出す (最大 1.5 秒。山手線が一瞬出ないように・仕様 §0-2)
  window.setTimeout(() => document.documentElement.classList.remove('is-restoring'), 1500);
  loadLines();
} else {
  // 初めて (山手線): 最初の画面を読み終え (load)、描いた (FCP) 後に読む (仕様 §6-1: 最初の画面のフォントと回線を取り合わない)
  if (document.readyState === 'complete') afterFirstPaint(loadLines);
  else window.addEventListener('load', () => afterFirstPaint(loadLines), { once: true });
}

if (isNative) {
  ui.share.addEventListener('click', () => {
    if (spinning || adShowing || picked < 0 || ui.share.getAttribute('aria-disabled') === 'true') return;
    native?.share({ station: line.stations[picked].name, line: line.short });
  });
  // 「このアプリについて」: ライセンスの全文は開いたときに同梱のファイルから読む
  // showModal は iOS 15.4 から。それより前 (アプリの対象は iOS 15.0 から) は open を付けて出す
  const about = $('about');
  $('about-open').addEventListener('click', () => {
    if (about.hasAttribute('open')) return;
    if (typeof about.showModal === 'function') about.showModal();
    else about.setAttribute('open', '');
  });
  $('about-close').addEventListener('click', () => {
    if (typeof about.close === 'function') about.close();
    else about.removeAttribute('open');
  });
  for (const box of about.querySelectorAll('details[data-src]')) {
    box.addEventListener('toggle', async () => {
      const pre = box.querySelector('pre');
      if (!box.open || pre.textContent) return;
      try {
        const res = await fetch(box.dataset.src);
        // 元の文は 80 字ほどで改行してある → 段落の中の改行をつないで、画面の幅で折り返す
        pre.textContent = res.ok ? (await res.text()).replace(/([^\n])\n(?!\n)/g, '$1 ') : '';
      } catch { /* 読めなければ空のまま */ }
    });
  }
  import('./native.js')
    .then((mod) => { native = mod.start(); })
    .catch(() => { /* 読めなくても広告なしで動く */ });
} else if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => navigator.serviceWorker.controller?.postMessage('heal'))
      .catch(() => {});
  });
}
