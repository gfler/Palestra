// shareCard.js — immagini 1080×1350 da condividere: la serie analizzata e l'allenamento completo.

const C = { bg: '#0E0F0D', panel: '#181A16', line: '#2A2D27', text: '#F3F1EA', muted: '#9A9A8F', amber: '#FFB547', cyan: '#3FD0E0', ok: '#45D483', bad: '#FF5D6C' };
const W = 1080, H = 1350;

function font(weight, size) {
  const fam = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif';
  return `${weight} ${size}px ${fam}`;
}

function base(title, sub) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  x.fillStyle = C.bg; x.fillRect(0, 0, W, H);
  // bagliore ambra in alto
  const g = x.createRadialGradient(W * 0.85, 0, 40, W * 0.85, 0, 700);
  g.addColorStop(0, 'rgba(255,181,71,0.28)'); g.addColorStop(1, 'rgba(255,181,71,0)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  // logo
  x.fillStyle = C.amber; rr(x, 72, 72, 72, 72, 18); x.fill();
  x.strokeStyle = '#10131A'; x.lineWidth = 9; x.lineCap = 'round';
  x.beginPath(); x.moveTo(92, 128); x.lineTo(108, 92); x.lineTo(124, 128); x.stroke();
  x.fillStyle = '#10131A'; x.beginPath(); x.arc(108, 90, 9, 0, Math.PI * 2); x.fill();
  x.fillStyle = C.text; x.font = font(800, 40); x.fillText('Fulcro', 164, 120);
  x.fillStyle = C.muted; x.font = font(600, 30); x.textAlign = 'right';
  x.fillText(new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }), W - 72, 120);
  x.textAlign = 'left';
  x.fillStyle = C.text; x.font = font(800, 76); wrap(x, title, 72, 270, W - 144, 84, 2);
  x.fillStyle = C.amber; x.font = font(700, 36); x.fillText(sub, 72, 390);
  return { cv, x };
}

function rr(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }

function wrap(x, text, left, top, maxW, lh, maxLines = 3) {
  const lines = [];
  let line = '';
  for (const w of String(text || '').split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (x.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  const out = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    let l = out[maxLines - 1];
    while (x.measureText(`${l}…`).width > maxW && l.length > 3) l = l.slice(0, -1);
    out[maxLines - 1] = `${l}…`;
  }
  out.forEach((l, i) => x.fillText(l, left, top + i * lh));
  return top + out.length * lh;
}

function kpi(x, left, top, w, label, value, color = C.text) {
  x.fillStyle = C.panel; rr(x, left, top, w, 190, 28); x.fill();
  x.strokeStyle = C.line; x.lineWidth = 2; x.stroke();
  x.fillStyle = C.muted; x.font = font(700, 28); x.fillText(label.toUpperCase(), left + 30, top + 56);
  x.fillStyle = color; x.font = font(800, 76); x.fillText(value, left + 30, top + 150);
}

const blobOf = (cv) => new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('canvas vuoto'))), 'image/png'));
const n2 = (v) => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '–');

/** Immagine della serie analizzata. */
export async function renderSetImage({ setup, analysis, label }) {
  const s = analysis.summary;
  const title = setup.exercise || label;
  const sub = [setup.load ? `${String(setup.load).replace('.', ',')} kg` : '', title.toLowerCase() === label.toLowerCase() ? '' : label].filter(Boolean).join(' · ') || 'Analisi tecnica';
  const { cv, x } = base(title, sub);
  const gw = (W - 144 - 40) / 3;
  kpi(x, 72, 450, gw, 'Rep', String(s.total));
  kpi(x, 72 + gw + 20, 450, gw, 'Corrette', String(s.valid), C.ok);
  kpi(x, 72 + (gw + 20) * 2, 450, gw, 'Velocità', Number.isFinite(s.velMean) ? n2(s.velMean) : '–', C.cyan);

  // barre per rep: velocità se c'è, altrimenti tempo concentrico
  const useVel = analysis.reps.some((r) => Number.isFinite(r.vel));
  const vals = analysis.reps.map((r) => (useVel ? r.vel : r.conc));
  const max = Math.max(...vals.filter(Number.isFinite), 0.01);
  const top = 720, hh = 300, n = Math.max(1, vals.length);
  const bw = Math.min(160, (W - 144 - (n - 1) * 14) / n);
  x.fillStyle = C.muted; x.font = font(700, 28); x.fillText(useVel ? 'VELOCITÀ PER REP (m/s)' : 'TEMPO DI SPINTA PER REP (s)', 72, top - 24);
  analysis.reps.forEach((r, i) => {
    const v = vals[i], bh = Number.isFinite(v) ? Math.max(10, (v / max) * hh) : 10;
    const lx = 72 + i * (bw + 14);
    x.fillStyle = r.valid ? C.ok : C.bad; rr(x, lx, top + hh - bh, bw, bh, Math.min(14, bw / 3)); x.fill();
    x.fillStyle = C.muted; x.font = font(700, 24); x.textAlign = 'center'; x.fillText(String(r.n), lx + bw / 2, top + hh + 36); x.textAlign = 'left';
  });

  x.fillStyle = C.panel; rr(x, 72, 1110, W - 144, 170, 28); x.fill();
  x.fillStyle = C.text; x.font = font(600, 32); wrap(x, s.verdict, 104, 1170, W - 208, 42, 3);
  return blobOf(cv);
}

/** Immagine dell'allenamento completo. */
export async function renderWorkoutImage(w, { volume = 0, durationText = '' } = {}) {
  const { cv, x } = base(w.dayName || 'Allenamento', `${w.programName || 'Libero'}${durationText ? ` · ${durationText}` : ''}`);
  const done = w.exercises.map((e) => ({ name: e.name, sets: e.sets.filter((s) => s.done && s.type !== 'warmup') })).filter((e) => e.sets.length);
  const nSets = done.reduce((a, e) => a + e.sets.length, 0);
  const gw = (W - 144 - 40) / 3;
  kpi(x, 72, 450, gw, 'Esercizi', String(done.length));
  kpi(x, 72 + gw + 20, 450, gw, 'Serie', String(nSets));
  kpi(x, 72 + (gw + 20) * 2, 450, gw, 'Volume', volume >= 1000 ? `${(volume / 1000).toFixed(1).replace('.', ',')} t` : `${Math.round(volume)}`, C.amber);
  let y = 720;
  const room = Math.floor((H - 100 - y) / 74);
  done.slice(0, room).forEach((e) => {
    x.fillStyle = C.text; x.font = font(700, 34);
    let name = e.name; while (x.measureText(name).width > 520 && name.length > 4) name = name.slice(0, -1);
    x.fillText(name === e.name ? name : `${name}…`, 72, y);
    x.fillStyle = C.muted; x.font = font(600, 30); x.textAlign = 'right';
    const best = e.sets.reduce((b, s) => ((s.kg || 0) > (b.kg || 0) ? s : b), e.sets[0]);
    x.fillText(`${e.sets.length} × · top ${String(best.kg ?? 0).replace('.', ',')} kg × ${best.reps ?? '–'}`, W - 72, y);
    x.textAlign = 'left';
    x.strokeStyle = C.line; x.lineWidth = 2; x.beginPath(); x.moveTo(72, y + 26); x.lineTo(W - 72, y + 26); x.stroke();
    y += 74;
  });
  if (done.length > room) { x.fillStyle = C.muted; x.font = font(600, 28); x.fillText(`+ altri ${done.length - room} esercizi`, 72, y); }
  return blobOf(cv);
}
