// hudRenderer.js — disegna l'HUD tecnico sul <canvas> sovrapposto al <video>.
// Nessuna ricodifica: ogni frame legge i dati già calcolati per video.currentTime.

import { SIDE_IDX, PROFILES, phaseLabel } from './biomechanics.js';

export const COLORS = {
  torso: '#B79CFF',
  thigh: '#5B8CFF',
  shin: '#3FD0E0',
  arm: '#FF8FC7',
  ecc: '#3FD0E0',
  conc: '#FFB547',
  bottom: '#FFFFFF',
  top: '#8E97A8',
  ghost: 'rgba(255,255,255,0.65)',
  ok: '#45D483',
  bad: '#FF5D6C',
};

export const LAYERS = [
  { key: 'segments', label: 'Segmenti' },
  { key: 'angles', label: 'Angoli' },
  { key: 'guide', label: 'Linea guida' },
  { key: 'trail', label: 'Traiettoria' },
  { key: 'ghost', label: 'Fantasma' },
  { key: 'gauge', label: 'ROM' },
  { key: 'bar', label: 'Barra rep' },
];

const phaseColor = (ph) => (ph === 'ECCENTRIC' ? COLORS.ecc : ph === 'CONCENTRIC' ? COLORS.conc : ph === 'BOTTOM' ? COLORS.bottom : COLORS.top);

export class HudRenderer {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this.ctx = canvas.getContext('2d');
    this.layers = Object.fromEntries(LAYERS.map((l) => [l.key, true]));
    this.analysis = null;
    this.w = 0;
    this.h = 0;
    this.dpr = 1;
    this.onFrame = null; // callback(t) a ogni frame disegnato (aggiorna slider/tempo)
    this._raf = 0;
    this._rvfc = 0;
    this._running = false;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas.parentElement);
    video.addEventListener('seeked', () => this.draw());
    video.addEventListener('loadeddata', () => { this.resize(); this.draw(); });
    video.addEventListener('play', () => this.start());
    video.addEventListener('pause', () => { this.stop(); this.draw(); });
    video.addEventListener('ended', () => { this.stop(); this.draw(); });
  }

  setAnalysis(a) { this.analysis = a; this.draw(); }
  setLayer(key, on) { this.layers[key] = on; this.draw(); }

  resize() {
    const box = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, Math.round(box.width));
    this.h = Math.max(1, Math.round(box.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  start() {
    if (this._running) return;
    this._running = true;
    const tick = () => {
      if (!this._running) return;
      this.draw();
      if ('requestVideoFrameCallback' in this.video) this._rvfc = this.video.requestVideoFrameCallback(tick);
      else this._raf = requestAnimationFrame(tick);
    };
    // rAF è la base richiesta; requestVideoFrameCallback, quando c'è, allinea al frame esatto
    if ('requestVideoFrameCallback' in this.video) this._rvfc = this.video.requestVideoFrameCallback(tick);
    else this._raf = requestAnimationFrame(tick);
  }

  stop() {
    this._running = false;
    cancelAnimationFrame(this._raf);
    if (this._rvfc && this.video.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this._rvfc);
  }

  frameIndexAt(t) {
    const a = this.analysis;
    if (!a) return -1;
    return Math.max(0, Math.min(a.frames.length - 1, Math.round(t * a.meta.fps)));
  }

  draw() {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);
    const t = this.video.currentTime || 0;
    if (this.onFrame) this.onFrame(t);
    if (w < 80 || h < 80) return; // palco ancora nascosto o non dimensionato
    const a = this.analysis;
    if (!a) return;
    const i = this.frameIndexAt(t);
    const f = a.frames[i];
    if (!f || !f.lm) return;
    const s = Math.max(0.8, Math.min(w / 360, 1.8)); // scala per testi e spessori
    const I = SIDE_IDX[a.meta.side];
    const P = (k) => ({ x: f.lm[k][0] * w, y: f.lm[k][1] * h });

    if (this.layers.guide) this._guide(P(I.ank), P(I.foot), s);
    if (this.layers.ghost) this._ghost(a, f, s, w, h);
    if (this.layers.trail) this._trail(a, i, s, w, h);
    if (this.layers.segments) this._segments(P, I, s);
    if (this.layers.angles) this._angles(a, P, I, f, s);
    if (this.layers.gauge) this._gauge(a, f, s);
    if (this.layers.bar) this._bar(a, f, t, s);
  }

  _guide(ank, foot, s) {
    const { ctx, h } = this;
    const x = (ank.x + foot.x) / 2;
    ctx.save();
    ctx.setLineDash([6 * s, 6 * s]);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    ctx.moveTo(x, h * 0.04);
    ctx.lineTo(x, Math.min(h, ank.y + 14 * s));
    ctx.stroke();
    ctx.restore();
  }

  _line(a, b, color, s) {
    const { ctx } = this;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(8,10,14,0.75)';
    ctx.lineWidth = 8 * s;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4.5 * s;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  _dot(p, s, color = '#fff') {
    const { ctx } = this;
    ctx.fillStyle = 'rgba(8,10,14,0.85)';
    ctx.beginPath(); ctx.arc(p.x, p.y, 6 * s, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3.8 * s, 0, Math.PI * 2); ctx.fill();
  }

  _segments(P, I, s) {
    const sh = P(I.sh), hip = P(I.hip), kn = P(I.knee), an = P(I.ank), el = P(I.el), wr = P(I.wr), ft = P(I.foot);
    this._line(sh, hip, COLORS.torso, s);
    this._line(hip, kn, COLORS.thigh, s);
    this._line(kn, an, COLORS.shin, s);
    this._line(an, ft, COLORS.shin, s);
    this._line(sh, el, COLORS.arm, s);
    this._line(el, wr, COLORS.arm, s);
    [sh, hip, kn, an, el, wr].forEach((p) => this._dot(p, s));
  }

  _angles(a, P, I, f, s) {
    const prof = PROFILES[a.meta.profile];
    const defs = {
      hip: [I.sh, I.hip, I.knee],
      knee: [I.hip, I.knee, I.ank],
      elbow: [I.sh, I.el, I.wr],
    };
    prof.angles.forEach((name) => {
      const [A, B, C] = defs[name];
      const val = f.ang[name];
      if (!Number.isFinite(val)) return;
      this._arc(P(A), P(B), P(C), val, s);
    });
  }

  _arc(a, b, c, val, s) {
    const { ctx } = this;
    const r = 26 * s;
    const a1 = Math.atan2(a.y - b.y, a.x - b.x);
    const a2 = Math.atan2(c.y - b.y, c.x - b.x);
    let diff = a2 - a1;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    ctx.save();
    ctx.lineWidth = 3 * s;
    ctx.strokeStyle = 'rgba(8,10,14,0.8)';
    ctx.beginPath(); ctx.arc(b.x, b.y, r, a1, a1 + diff, diff < 0); ctx.stroke();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(b.x, b.y, r, a1, a1 + diff, diff < 0); ctx.stroke();
    const mid = a1 + diff / 2;
    const lx = b.x + Math.cos(mid) * (r + 20 * s);
    const ly = b.y + Math.sin(mid) * (r + 20 * s);
    const text = `${Math.round(val)}°`;
    ctx.font = `700 ${13 * s}px "Bricolage Grotesque", system-ui, sans-serif`;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(8,10,14,0.82)';
    roundRect(ctx, lx - tw / 2 - 5 * s, ly - 10 * s, tw + 10 * s, 20 * s, 6 * s); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, lx, ly + 0.5);
    ctx.restore();
  }

  _trail(a, i, s, w, h) {
    const f = a.frames[i];
    if (!f.rep) return;
    const rep = a.reps[f.rep - 1];
    const idx = a.meta.trackIdx;
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    let prev = null;
    for (let k = rep.fi0; k <= i; k++) {
      const fr = a.frames[k];
      if (!fr.lm) continue;
      const p = { x: fr.lm[idx][0] * w, y: fr.lm[idx][1] * h };
      if (prev) {
        const age = (k - rep.fi0) / Math.max(1, i - rep.fi0);
        ctx.strokeStyle = phaseColor(fr.ph);
        ctx.globalAlpha = 0.25 + 0.75 * age;
        ctx.lineWidth = (2.5 + 3 * age) * s;
        ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      }
      prev = p;
    }
    ctx.restore();
  }

  _ghost(a, f, s, w, h) {
    const best = a.summary.bestRep;
    if (!best || f.rep === best) return;
    const rep = a.reps[best - 1];
    if (!rep || rep.path.length < 2) return;
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([3 * s, 6 * s]);
    ctx.lineCap = 'round';
    ctx.strokeStyle = COLORS.ghost;
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    rep.path.forEach(([x, y], k) => (k ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
    ctx.stroke();
    ctx.setLineDash([]);
    const [lx, ly] = rep.path[rep.path.length - 1];
    ctx.font = `600 ${11 * s}px "Instrument Sans", system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textAlign = 'left';
    ctx.fillText(`rep migliore (${best})`, lx * w + 8 * s, ly * h - 6 * s);
    ctx.restore();
  }

  _gauge(a, f, s) {
    const { ctx, w, h } = this;
    const gh = h * 0.5, gw = 12 * s;
    const x = w - 16 * s - gw, y = h * 0.22;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,14,0.65)';
    roundRect(ctx, x - 3 * s, y - 3 * s, gw + 6 * s, gh + 6 * s, 8 * s); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    roundRect(ctx, x, y, gw, gh, 5 * s); ctx.fill();
    const fill = Math.max(0, Math.min(1, f.rom)) * gh;
    if (fill > 1) {
      ctx.fillStyle = phaseColor(f.ph === 'TOP' ? 'ECCENTRIC' : f.ph);
      roundRect(ctx, x, y, gw, fill, 5 * s); ctx.fill();
    }
    // tacca della zona "fondo" (soglia 60%)
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath(); ctx.moveTo(x - 5 * s, y + gh * 0.6); ctx.lineTo(x + gw + 5 * s, y + gh * 0.6); ctx.stroke();
    ctx.font = `600 ${10 * s}px "Instrument Sans", system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'center';
    ctx.fillText('ROM', x + gw / 2, y - 9 * s);
    ctx.restore();
  }

  _bar(a, f, t, s) {
    const { ctx, w, h } = this;
    const total = a.reps.length;
    const rep = f.rep || 0;
    const ph = rep ? f.ph : 'TOP';
    const repTxt = total ? `Rep ${rep || '–'}/${total}` : 'Nessuna rep';
    const phTxt = rep ? phaseLabel(a.meta.profile, ph) : 'In attesa';
    const time = rep ? `${f.pe.toFixed(1)} s` : '';
    const bh = 34 * s, bw = Math.min(w - 24 * s, 320 * s);
    const x = (w - bw) / 2, y = h - bh - 12 * s;
    ctx.save();
    ctx.fillStyle = 'rgba(8,10,14,0.78)';
    roundRect(ctx, x, y, bw, bh, bh / 2); ctx.fill();
    ctx.fillStyle = phaseColor(ph);
    ctx.beginPath(); ctx.arc(x + 16 * s, y + bh / 2, 5 * s, 0, Math.PI * 2); ctx.fill();
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${14 * s}px "Bricolage Grotesque", system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(repTxt, x + 28 * s, y + bh / 2 + 0.5);
    ctx.font = `600 ${13 * s}px "Instrument Sans", system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.textAlign = 'center';
    ctx.fillText(phTxt, x + bw * 0.58, y + bh / 2 + 0.5);
    ctx.textAlign = 'right';
    ctx.font = `700 ${14 * s}px "Bricolage Grotesque", system-ui, sans-serif`;
    ctx.fillStyle = phaseColor(ph);
    ctx.fillText(time, x + bw - 14 * s, y + bh / 2 + 0.5);
    ctx.restore();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  if (!(w > 0) || !(h > 0)) { ctx.beginPath(); return; }
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
