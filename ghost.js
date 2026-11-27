// ghost.js — «Video fantasma»: salva una traccia compatta di ogni analisi e la confronta con la stessa
// esercitazione di circa 4 settimane prima (scheletro sovrapposto + profondità, traiettoria, m/s a parità di carico).

import * as idb from './idb.js';
import { SIDE_IDX } from './biomechanics.js';
import { exKey } from './training.js';

const J = ['sh', 'el', 'wr', 'hip', 'knee', 'ank'];
const N = 40; // campioni per la rep di riferimento
const DAY = 86400000;

/** Traccia compatta: la rep migliore normalizzata (origine = anca, unità = lunghezza del busto). */
export function buildTrace(a, { exercise, load }) {
  const s = a.summary;
  if (!s.total || !a.reps.length) return null;
  const rep = a.reps[(s.bestRep || 1) - 1] || a.reps[0];
  if (!Number.isFinite(rep.fi0) || !Number.isFinite(rep.fi1) || rep.fi1 - rep.fi0 < 3) return null;
  const I = SIDE_IDX[a.meta.side] || SIDE_IDX.right;
  const asp = a.meta.aspect || 1;
  const pts = [];
  for (let k = 0; k < N; k++) {
    const f = a.frames[Math.round(rep.fi0 + ((rep.fi1 - rep.fi0) * k) / (N - 1))];
    if (!f || !f.lm) { pts.push(null); continue; }
    const P = (j) => [f.lm[I[j]][0] * asp, f.lm[I[j]][1]];
    const hp = P('hip'), sh = P('sh');
    const t = Math.hypot(sh[0] - hp[0], sh[1] - hp[1]) || 1;
    pts.push(J.map((j) => { const p = P(j); return [+((p[0] - hp[0]) / t).toFixed(3), +((p[1] - hp[1]) / t).toFixed(3)]; }));
  }
  if (pts.filter(Boolean).length < N / 2) return null;
  return {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    key: exKey(exercise || ''), name: exercise || '', load: Number(load) || 0,
    date: new Date().toISOString(), profile: a.meta.profile, facing: a.meta.facing || 1,
    pts,
    sum: { total: s.total, valid: s.valid, angMin: s.avgAngMin, dev: s.avgDev, vel: s.velMean, loss: s.velLoss },
  };
}

export async function saveTrace(trace, replaceId) {
  if (!trace) return null;
  if (replaceId) { trace.id = replaceId; }
  try { await idb.put('traces', trace); return trace.id; } catch { return null; }
}

/** Sessione di riferimento: stessa esercitazione, ~28 giorni prima (21–42), preferendo lo stesso carico. */
export async function findGhost(name, load, excludeId) {
  const key = exKey(name || '');
  let all = [];
  try { all = await idb.all('traces'); } catch { return null; }
  const now = Date.now();
  const cands = all.filter((t) => t.key === key && t.id !== excludeId && now - new Date(t.date).getTime() >= 14 * DAY);
  if (!cands.length) return null;
  const score = (t) => {
    const days = (now - new Date(t.date).getTime()) / DAY;
    const inWin = days >= 21 && days <= 42 ? 0 : 40;
    const sameLoad = load && Math.abs(t.load - load) <= 2.5 ? 0 : 15;
    return inWin + sameLoad + Math.abs(days - 28);
  };
  return cands.sort((x, y) => score(x) - score(y))[0];
}

/** Righe di confronto oggi vs fantasma. */
export function compareRows(a, ghost, load) {
  const s = a.summary, g = ghost.sum;
  const same = load && Math.abs(ghost.load - load) <= 2.5;
  const rows = [];
  const add = (label, now, before, unit, d, better) => {
    if (!Number.isFinite(now) || !Number.isFinite(before)) return;
    const diff = now - before;
    const tone = Math.abs(diff) < Math.pow(10, -d) / 2 ? 'flat' : better === 'flat' ? 'flat' : (better === 'up') === (diff > 0) ? 'good' : 'bad';
    const it = (v) => v.toFixed(d).replace(".", ",");
    rows.push({ label, text: `${it(before)} → ${it(now)}${unit}`, tone });
  };
  add('Profondità (angolo minimo)', s.avgAngMin, g.angMin, '°', 0, 'flat');
  add('Deviazione traiettoria', s.avgDev, g.dev, '%', 1, 'down');
  add(same ? 'Velocità media a parità di carico' : 'Velocità media', s.velMean, g.vel, ' m/s', 2, 'up');
  add('Perdita di velocità', s.velLoss, g.loss, '%', 0, 'down');
  add('Rep corrette', s.total ? (s.valid / s.total) * 100 : NaN, g.total ? (g.valid / g.total) * 100 : NaN, '%', 0, 'up');
  return { rows, sameLoad: !!same };
}

/** Disegno dello scheletro fantasma sull'HUD, allineato su anca e busto del frame corrente. */
export function drawGhost(ctx, a, i, w, h, ghost, s) {
  const f = a.frames[i];
  if (!f || !f.lm || !ghost) return;
  const rep = f.rep ? a.reps[f.rep - 1] : null;
  let k = 0;
  if (rep && Number.isFinite(rep.fi0) && rep.fi1 > rep.fi0) k = Math.round(((i - rep.fi0) / (rep.fi1 - rep.fi0)) * (N - 1));
  const p = ghost.pts[Math.max(0, Math.min(N - 1, k))] || ghost.pts.find(Boolean);
  if (!p) return;
  const I = SIDE_IDX[a.meta.side] || SIDE_IDX.right;
  const asp = a.meta.aspect || 1;
  const hp = [f.lm[I.hip][0] * asp, f.lm[I.hip][1]], sh = [f.lm[I.sh][0] * asp, f.lm[I.sh][1]];
  const t = Math.hypot(sh[0] - hp[0], sh[1] - hp[1]) || 0.2;
  const flip = (a.meta.facing || 1) * (ghost.facing || 1);
  const X = (q) => ((hp[0] + q[0] * t * flip) / asp) * w, Y = (q) => (hp[1] + q[1] * t) * h;
  const idx = Object.fromEntries(J.map((j, n) => [j, n]));
  const segs = [['sh', 'el'], ['el', 'wr'], ['sh', 'hip'], ['hip', 'knee'], ['knee', 'ank']];
  ctx.save();
  ctx.strokeStyle = 'rgba(120,200,255,0.75)';
  ctx.fillStyle = 'rgba(120,200,255,0.9)';
  ctx.lineWidth = 4 * s; ctx.lineCap = 'round';
  ctx.setLineDash([2 * s, 7 * s]);
  for (const [u, v] of segs) {
    ctx.beginPath(); ctx.moveTo(X(p[idx[u]]), Y(p[idx[u]])); ctx.lineTo(X(p[idx[v]]), Y(p[idx[v]])); ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const q of p) { ctx.beginPath(); ctx.arc(X(q), Y(q), 3 * s, 0, Math.PI * 2); ctx.fill(); }
  ctx.font = `600 ${11 * s}px "Instrument Sans", system-ui, sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(`${new Date(ghost.date).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}${ghost.load ? ` · ${String(ghost.load).replace('.', ',')} kg` : ''}`, X(p[idx.sh]) + 8 * s, Y(p[idx.sh]) - 8 * s);
  ctx.restore();
}
