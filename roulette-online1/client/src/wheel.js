/**
 * 轮盘 37 格的几何/配色与真随机核心。
 * 主页面与记录专页共用，保证两处轮盘外观完全一致。
 */
import { pocketFill } from '@/constants.js';

export const NS = 'http://www.w3.org/2000/svg';
export const REDS = new Set([1, 3, 5, 7, 9, 12]);

export const POCKETS = (() => {
  const reds = [1, 3, 5, 7, 9, 12];
  const blacks = [2, 4, 6, 8, 10, 11];
  const arr = [0];
  for (let r = 0; r < 3; r++) for (let i = 0; i < 6; i++) arr.push(reds[i], blacks[i]);
  return arr; // 长度 37
})();

export const POCKET_COUNT = POCKETS.length; // 37
export const SEG = 360 / POCKET_COUNT;
export const CX = 280;
export const CY = 280;
export const R0 = 148;
export const R1 = 236;

/* ---------- 真随机：crypto.getRandomValues + 拒绝采样 ---------- */

export function drawPocket() {
  const N = POCKET_COUNT;
  const LIMIT = 0x100000000 - (0x100000000 % N); // 2^32 中能被 37 整除的最大上界
  const buf = new Uint32Array(1);
  const c = globalThis.crypto;
  if (!c?.getRandomValues) return Math.floor(Math.random() * N); // 非安全上下文兜底
  do {
    c.getRandomValues(buf); // 操作系统级加密熵源
  } while (buf[0] >= LIMIT); // 拒绝残余区间 → 严格均匀
  return buf[0] % N; // 0..36 等概率
}

export function secureUnit() {
  const buf = new Uint32Array(1);
  const c = globalThis.crypto;
  if (!c?.getRandomValues) return Math.random();
  c.getRandomValues(buf);
  return buf[0] / 0x100000000;
}

/* ---------- SVG 构建 ---------- */

export function polar(r, deg) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
}

export function wedge(r0, r1, a0, a1) {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  return (
    `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r1} ${r1} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
    `L${x2.toFixed(2)} ${y2.toFixed(2)} A${r0} ${r0} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`
  );
}

export function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent.appendChild(e);
  return e;
}

/** 把 37 格轮盘渲染进指定 <svg> 元素（含木质轮缘与中央轮毂） */
export function buildWheelSvg(svg) {
  if (!svg) return;
  svg.innerHTML = '';

  const defs = el('defs', {}, svg);
  const wood = el('radialGradient', { id: 'wood', cx: '50%', cy: '50%', r: '50%' }, defs);
  el('stop', { offset: '0%', 'stop-color': '#5a3a1e' }, wood);
  el('stop', { offset: '80%', 'stop-color': '#3a2412' }, wood);
  el('stop', { offset: '100%', 'stop-color': '#241407' }, wood);
  const hubG = el('radialGradient', { id: 'hub', cx: '50%', cy: '42%', r: '60%' }, defs);
  el('stop', { offset: '0%', 'stop-color': '#1d4a38' }, hubG);
  el('stop', { offset: '100%', 'stop-color': '#07130d' }, hubG);

  // 外圈木质轮缘 + 金线
  el('circle', { cx: CX, cy: CY, r: 272, fill: 'url(#wood)', stroke: '#d8b45a', 'stroke-width': 3 }, svg);
  el('circle', { cx: CX, cy: CY, r: 255, fill: 'none', stroke: '#8a6f35', 'stroke-width': 1.5 }, svg);
  el('circle', { cx: CX, cy: CY, r: R1, fill: '#0a0c10', stroke: '#d8b45a', 'stroke-width': 2 }, svg);

  // 37 个口袋：1–12 按四色棋子分组着色（1-3 黄 / 4-6 蓝 / 7-9 绿 / 10-12 红）
  for (let i = 0; i < POCKET_COUNT; i++) {
    const num = POCKETS[i];
    const a0 = i * SEG;
    const a1 = (i + 1) * SEG;
    const mid = (a0 + a1) / 2;
    el(
      'path',
      { d: wedge(R0, R1, a0, a1), fill: pocketFill(num), stroke: '#d8b45a', 'stroke-width': 1.4 },
      svg,
    );
    const [tx, ty] = polar((R0 + R1) / 2, mid);
    const t = el(
      'text',
      {
        x: tx.toFixed(2),
        y: ty.toFixed(2),
        transform: `rotate(${mid.toFixed(3)} ${tx.toFixed(2)} ${ty.toFixed(2)})`,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        fill: '#f3e9d2',
        'font-size': '21',
        'font-weight': '700',
        'font-family': "'Playfair Display', serif",
      },
      svg,
    );
    t.textContent = num;
  }

  // 中央轮毂
  el('circle', { cx: CX, cy: CY, r: R0, fill: 'none', stroke: '#d8b45a', 'stroke-width': 2.5 }, svg);
  el('circle', { cx: CX, cy: CY, r: 118, fill: 'url(#hub)', stroke: '#8a6f35', 'stroke-width': 2 }, svg);
  el('circle', { cx: CX, cy: CY, r: 92, fill: 'none', stroke: 'rgba(216,180,90,.35)', 'stroke-width': 1 }, svg);
  for (let k = 0; k < 4; k++) {
    const [px, py] = polar(66, k * 90 + 45);
    el('circle', { cx: px.toFixed(1), cy: py.toFixed(1), r: 9, fill: '#d8b45a', opacity: 0.85 }, svg);
  }
  el('circle', { cx: CX, cy: CY, r: 40, fill: '#0a1f16', stroke: '#d8b45a', 'stroke-width': 2.5 }, svg);
  const star = el(
    'text',
    {
      x: CX,
      y: CY,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      fill: '#d8b45a',
      'font-size': '26',
      'font-family': "'Playfair Display', serif",
    },
    svg,
  );
  star.textContent = '✦';
}
