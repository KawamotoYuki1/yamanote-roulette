import { STATIONS } from './stations.js';
import {
  SPIN, randomIndex, randomUnit, indexAt, planSpin, easeOutQuart, sliceAngle, sides,
} from './roulette.js';

const N = STATIONS.length;
const STEP = 360 / N;
const SVG_NS = 'http://www.w3.org/2000/svg';
const MAP_URL = 'https://www.google.com/maps/search/?api=1&query=';
/**
 * 盤の寸法 (viewBox -164..164 の単位)。
 * 外周の帯 130..146 (中心線 138) / 駅名は 124 から内へ / 中心の円 26。上の余白に電車の顔が乗る
 */
const VIEW = 328;
const GEO = Object.freeze({
  outer: 146, rim: 138, sliceOuter: 130, hub: 26, textOuter: 124, fontMax: 15, fontMin: 7,
});
const HALF_TAN = Math.tan(((STEP / 2) * Math.PI) / 180);
const SMALL_KANA = new Set('ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ');
const BURST_PIECES = 28;
const BURST_SHAPES = ['c', 't', 'h'];

const $ = (id) => document.getElementById(id);
const ui = {
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

function slicePath(i) {
  const a0 = sliceAngle(i, N) - STEP / 2;
  const a1 = sliceAngle(i, N) + STEP / 2;
  const [x0, y0] = polar(GEO.hub, a0);
  const [x1, y1] = polar(GEO.sliceOuter, a0);
  const [x2, y2] = polar(GEO.sliceOuter, a1);
  const [x3, y3] = polar(GEO.hub, a1);
  return `M${x0} ${y0}L${x1} ${y1}A${GEO.sliceOuter} ${GEO.sliceOuter} 0 0 1 ${x2} ${y2}`
    + `L${x3} ${y3}A${GEO.hub} ${GEO.hub} 0 0 0 ${x0} ${y0}Z`;
}

/** 縦書きの駅名がマスに収まる最大の文字サイズ */
function labelFontSize(length) {
  for (let fs = GEO.fontMax; fs >= GEO.fontMin; fs -= 0.25) {
    const innerEdge = GEO.textOuter - length * fs;
    if (innerEdge >= GEO.hub + 4 && innerEdge * HALF_TAN >= fs / 2 + 0.6) return fs;
  }
  return GEO.fontMin;
}

function buildLabel(name, i) {
  const chars = [...name];
  const fs = labelFontSize(chars.length);
  const group = svgEl('g', { class: 'label', transform: `rotate(${r3(sliceAngle(i, N))})`, 'font-size': fs });
  chars.forEach((ch, k) => {
    const y = r3(-(GEO.textOuter - fs * (k + 0.5)));
    const text = svgEl('text', { x: 0, y, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    text.textContent = ch;
    if (ch === 'ー') text.setAttribute('transform', `rotate(90 0 ${y})`);
    else if (SMALL_KANA.has(ch)) text.setAttribute('transform', `translate(${r3(fs * 0.14)} ${r3(-fs * 0.14)})`);
    group.append(text);
  });
  return group;
}

function buildWheel() {
  const half = VIEW / 2;
  const svg = svgEl('svg', {
    viewBox: `${-half} ${-half} ${VIEW} ${VIEW}`, focusable: 'false', 'aria-hidden': 'true',
  });
  const groups = {
    slices: svgEl('g'), dividers: svgEl('g'), labels: svgEl('g'), dots: svgEl('g'),
  };
  const parts = { slices: [], labels: [] };
  STATIONS.forEach((station, i) => {
    const slice = svgEl('path', { d: slicePath(i), class: 'slice' });
    const edge = sliceAngle(i, N) - STEP / 2;
    const [x0, y0] = polar(GEO.hub, edge);
    const [x1, y1] = polar(GEO.sliceOuter, edge);
    const label = buildLabel(station.name, i);
    const [cx, cy] = polar(GEO.rim, sliceAngle(i, N));
    groups.slices.append(slice);
    groups.dividers.append(svgEl('line', {
      x1: x0, y1: y0, x2: x1, y2: y1, class: 'divider',
    }));
    groups.labels.append(label);
    groups.dots.append(svgEl('circle', {
      cx, cy, r: 3.8, class: 'dot',
    }));
    parts.slices.push(slice);
    parts.labels.push(label);
  });
  svg.append(
    groups.slices,
    groups.dividers,
    groups.labels,
    svgEl('circle', { r: GEO.rim, class: 'rim' }),
    groups.dots,
    svgEl('circle', { r: GEO.hub, class: 'hub' }),
  );
  ui.dial.append(svg);
  return parts;
}

const parts = buildWheel();
let rotation = 0;
let spinning = false;
let picked = -1;
let trainAnimation = null;
let mapLink = null;

const setRotation = (deg) => { ui.dial.style.transform = `rotate(${deg}deg)`; };

function setPicked(i, on) {
  if (i < 0) return;
  parts.slices[i].classList.toggle('is-picked', on);
  parts.labels[i].classList.toggle('is-picked', on);
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

let announceTimer = 0;

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
  ui.kana.style.setProperty('--kana-fit', String(r3(length * (1 + track))));
}

/** 回している間: 結果を消し、駅名欄に針の下の駅名だけを薄く流す */
function startRolling() {
  window.clearTimeout(announceTimer);
  ui.plate.classList.remove('is-revealed');
  ui.plate.classList.add('is-empty');
  for (const el of [ui.code, ui.kana, ui.romaji, ui.left, ui.right, ui.announce]) el.textContent = '';
  setName(STATIONS[indexAt(rotation, N)].name);
}

function showStation(i) {
  const station = STATIONS[i];
  ui.plate.classList.remove('is-empty', 'is-revealed');
  ui.code.textContent = station.code;
  setKana(station.kana);
  setName(station.name);
  ui.romaji.textContent = station.romaji;
  const { left, right } = sides(i, N);
  ui.left.textContent = STATIONS[left].name;
  ui.right.textContent = STATIONS[right].name;
  const link = ensureMapLink();
  link.href = MAP_URL + encodeURIComponent(`JR${station.name}駅`);
  link.setAttribute('aria-label', `${station.name}駅を地図で見る`);
  void ui.plate.offsetWidth;
  ui.plate.classList.add('is-revealed');
  announce(`${station.name}（${station.kana}）に決まりました`);
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
  if (typeof navigator.vibrate === 'function') navigator.vibrate(18);
}

function spin() {
  if (spinning) return;
  spinning = true;
  ui.spin.setAttribute('aria-disabled', 'true');
  ui.wheel.classList.add('is-spinning');
  setPicked(picked, false);

  const target = randomIndex(N);
  const jitter = (randomUnit() * 2 - 1) * SPIN.jitterDeg;
  const instant = reduceMotion.matches;
  const from = rotation;
  const end = planSpin({
    from, target, n: N, turns: instant ? 0 : SPIN.turns, jitter,
  });

  if (instant) {
    rotation = end;
    finish(target);
    return;
  }

  startRolling();
  const startedAt = performance.now();
  let lastEdge = Math.floor((from + STEP / 2) / STEP);
  const frame = (now) => {
    const p = Math.min(1, Math.max(0, (now - startedAt) / SPIN.durationMs));
    rotation = from + (end - from) * easeOutQuart(p);
    setRotation(rotation);
    const edge = Math.floor((rotation + STEP / 2) / STEP);
    if (edge !== lastEdge) {
      lastEdge = edge;
      swingTrain();
      setName(STATIONS[indexAt(rotation, N)].name);
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

ui.spin.addEventListener('click', spin);
ui.wheel.addEventListener('click', onWheelClick);
setRotation(rotation);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => navigator.serviceWorker.controller?.postMessage('heal'))
      .catch(() => {});
  });
}
