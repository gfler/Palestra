// charts.js — grafici SVG scritti a mano (nessuna libreria): linea con selezione, barre, calendario, barre orizzontali.

import { h, svg, fmtDay, fmtNum } from './dom.js';

const W = 320;

function niceRange(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) { const pad = Math.max(1, Math.abs(min) * 0.1); return [min - pad, max + pad]; }
  const pad = (max - min) * 0.18;
  return [Math.max(0, min - pad), max + pad];
}

/**
 * Linea nel tempo. points: [{t (ms), v, caption}] ordinati; markers: [{t, label}] (cambi scheda).
 */
export function lineChart(points, { unit = '', height = 190, markers = [], decimals = 1, overlay = null, dotsOnly = false } = {}) {
  const wrap = h('div', { class: 'chart' });
  const caption = h('div', { class: 'chart-cap', 'aria-live': 'polite' });
  if (!points.length) {
    wrap.append(h('p', { class: 'muted chart-empty' }, 'Nessun dato ancora: registra qualche allenamento.'));
    return wrap;
  }
  const padL = 34, padR = 12, padT = 14, padB = 24, H = height;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const span = Math.max(1, t1 - t0);
  const allV = points.map((p) => p.v).concat((overlay || []).map((p) => p.v).filter(Number.isFinite));
  const [lo, hi] = niceRange(Math.min(...allV), Math.max(...allV));
  const X = (t) => (points.length === 1 ? (padL + (W - padR)) / 2 : padL + ((t - t0) / span) * (W - padL - padR));
  const Y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': `Grafico, ${points.length} punti` });
  for (let i = 0; i <= 2; i++) {
    const v = lo + ((hi - lo) * i) / 2;
    const y = Y(v);
    s.append(svg('line', { x1: padL, x2: W - padR, y1: y, y2: y, class: 'g-grid' }),
      svg('text', { x: padL - 6, y: y + 4, class: 'g-axis', 'text-anchor': 'end' }, fmtNum(v, v < 20 ? 1 : 0)));
  }
  s.append(svg('text', { x: padL, y: H - 6, class: 'g-axis' }, fmtDay(points[0].t)));
  if (points.length > 1) s.append(svg('text', { x: W - padR, y: H - 6, class: 'g-axis', 'text-anchor': 'end' }, fmtDay(t1)));

  for (const m of markers) {
    if (m.t <= t0 || m.t > t1) continue;
    const x = X(m.t);
    s.append(svg('line', { x1: x, x2: x, y1: padT, y2: H - padB, class: 'g-marker' }));
  }

  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' ');
  if (points.length > 1 && !dotsOnly) {
    s.append(svg('path', { d: `${d} L${X(t1).toFixed(1)} ${H - padB} L${X(t0).toFixed(1)} ${H - padB} Z`, class: 'g-area' }));
    s.append(svg('path', { d, class: 'g-line' }));
  }
  if (overlay && overlay.length > 1) {
    const o = overlay.filter((p) => Number.isFinite(p.v));
    s.append(svg('path', { d: o.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join(' '), class: 'g-line g-line2' }));
  }
  const dots = points.map((p) => svg('circle', { cx: X(p.t), cy: Y(p.v), r: 4, class: 'g-dot' }));
  s.append(...dots);
  const sel = svg('circle', { r: 7, class: 'g-sel', cx: -10, cy: -10 });
  s.append(sel);

  const pick = (i) => {
    const p = points[i];
    sel.setAttribute('cx', X(p.t)); sel.setAttribute('cy', Y(p.v));
    caption.textContent = p.caption || `${fmtDay(p.t)} · ${fmtNum(p.v, decimals)} ${unit}`.trim();
  };
  s.addEventListener('pointerdown', (e) => {
    const r = s.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((p, i) => { if (Math.abs(X(p.t) - x) < Math.abs(X(points[best].t) - x)) best = i; });
    pick(best);
  });
  pick(points.length - 1);
  wrap.append(s, caption);
  return wrap;
}

/** Barre verticali: items [{label, v, hot}] */
export function barChart(items, { height = 150, unit = '' } = {}) {
  const wrap = h('div', { class: 'chart' });
  const caption = h('div', { class: 'chart-cap', 'aria-live': 'polite' }, ' ');
  const max = Math.max(1, ...items.map((i) => i.v));
  const padB = 22, padT = 8, H = height;
  const bw = (W - 16) / items.length;
  const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg', role: 'img', 'aria-label': 'Grafico a barre' });
  s.append(svg('line', { x1: 8, x2: W - 8, y1: H - padB, y2: H - padB, class: 'g-grid' }));
  items.forEach((it, i) => {
    const bh = Math.round(((H - padB - padT) * it.v) / max);
    const x = 8 + i * bw + bw * 0.14;
    const bar = svg('rect', { x, y: H - padB - bh, width: bw * 0.72, height: Math.max(it.v ? 2 : 0, bh), rx: 4, class: it.hot ? 'g-bar g-bar-hot' : 'g-bar' });
    s.append(bar);
    if (i % Math.ceil(items.length / 6) === 0 || i === items.length - 1) s.append(svg('text', { x: x + bw * 0.36, y: H - 6, class: 'g-axis', 'text-anchor': 'middle' }, it.label));
    const hit = svg('rect', { x: 8 + i * bw, y: 0, width: bw, height: H, fill: 'transparent' });
    hit.addEventListener('pointerdown', () => { caption.textContent = `${it.label}: ${fmtNum(it.v)} ${unit}`.trim(); });
    s.append(hit);
  });
  wrap.append(s, caption);
  return wrap;
}

/** Calendario a griglia: days [{date:'YYYY-MM-DD', level 0..4, title}] già in ordine, `weeks` colonne */
export function heatGrid(cells, weeks) {
  const grid = h('div', { class: 'heat', style: `grid-template-columns: repeat(${weeks}, 1fr)`, role: 'img', 'aria-label': 'Calendario degli allenamenti' });
  for (const c of cells) grid.append(h('i', { class: `heat-c l${c.level}`, title: c.title || '' }));
  return grid;
}

/** Barre orizzontali: items [{label, v}] */
export function hBars(items, { unit = '' } = {}) {
  const max = Math.max(1, ...items.map((i) => i.v));
  return h('div', { class: 'hbars' }, items.map((it) =>
    h('div', { class: 'hbar' },
      h('span', { class: 'hbar-l' }, it.label),
      h('span', { class: 'hbar-t' }, h('i', { style: `width:${Math.max(3, (it.v / max) * 100)}%` })),
      h('b', { class: 'hbar-v' }, `${fmtNum(it.v)}${unit ? ` ${unit}` : ''}`))));
}
