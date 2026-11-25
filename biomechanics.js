// biomechanics.js — motore matematico di Fulcro.
// Nessuna dipendenza dal DOM: si può eseguire e testare anche in Node.
//
// Convenzioni:
//  - i landmark grezzi sono array [x, y, visibility] con x,y normalizzati 0..1
//  - tutta la geometria lavora in "spazio pixel" (x moltiplicata per l'aspect ratio)
//    così gli angoli non vengono deformati dai video non quadrati
//  - "depth" è un segnale che vale ~0 in alto (TOP) e cresce verso il fondo (BOTTOM)

export const PHASES = ['TOP', 'ECCENTRIC', 'BOTTOM', 'CONCENTRIC'];
export const PHASE_LABEL = { TOP: 'In alto', ECCENTRIC: 'Eccentrica', BOTTOM: 'Fondo', CONCENTRIC: 'Concentrica' };

export const SIDE_IDX = {
  right: { sh: 12, el: 14, wr: 16, hip: 24, knee: 26, ank: 28, foot: 32 },
  left: { sh: 11, el: 13, wr: 15, hip: 23, knee: 25, ank: 27, foot: 31 },
};
const RIGHT_VIS = [12, 24, 26, 28];
const LEFT_VIS = [11, 23, 25, 27];

export const PROFILES = {
  rdl: {
    key: 'rdl',
    label: 'RDL (Stacco Rumeno)',
    defaultName: 'Stacco Rumeno (RDL)',
    angles: ['hip', 'knee'],
    minRange: 25, // gradi di escursione minima per considerare un movimento una rep
    track: 'wr',
  },
  squat: {
    key: 'squat',
    label: 'Squat',
    defaultName: 'Squat',
    angles: ['knee', 'hip'],
    minRange: 30,
    track: 'sh',
  },
  bench: {
    key: 'bench',
    label: 'Panca Piana',
    defaultName: 'Panca Piana',
    angles: ['elbow'],
    minRange: 35,
    track: 'wr',
  },
  generic: {
    key: 'generic',
    label: 'Generico (Conteggio Rep + Tempi)',
    defaultName: 'Esercizio',
    angles: ['elbow', 'hip'],
    minRange: 10, // % della lunghezza del busto
    track: 'wr',
  },
};

/* ------------------------------------------------------------------ */
/* One Euro Filter                                                      */
/* ------------------------------------------------------------------ */

const smoothingAlpha = (cutoff, dt) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

class LowPass {
  constructor() { this.s = null; }
  filter(x, a) {
    this.s = this.s === null ? x : a * x + (1 - a) * this.s;
    return this.s;
  }
}

export class OneEuroFilter {
  constructor({ minCutoff = 1.5, beta = 8, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = new LowPass();
    this.dx = new LowPass();
    this.prev = null;
  }
  filter(v, dt) {
    const rate = this.prev === null ? 0 : (v - this.prev) / dt;
    this.prev = v;
    const edx = this.dx.filter(rate, smoothingAlpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(v, smoothingAlpha(cutoff, dt));
  }
}

/** Applica il One Euro Filter a x,y di ogni landmark. I frame senza rilevamento ripetono l'ultimo stato. */
export function smoothLandmarks(raw, fps) {
  const dt = 1 / fps;
  const filters = [];
  let last = null;
  const out = new Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    const f = raw[i];
    if (!f) {
      out[i] = last ? { lm: last, ok: false } : { lm: null, ok: false };
      continue;
    }
    const lm = new Array(f.length);
    for (let k = 0; k < f.length; k++) {
      if (!filters[k]) filters[k] = { x: new OneEuroFilter(), y: new OneEuroFilter() };
      lm[k] = [filters[k].x.filter(f[k][0], dt), filters[k].y.filter(f[k][1], dt), f[k][2]];
    }
    last = lm;
    out[i] = { lm, ok: true };
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Geometria                                                            */
/* ------------------------------------------------------------------ */

export function angle3(a, b, c) {
  const v1x = a.x - b.x, v1y = a.y - b.y, v2x = c.x - b.x, v2y = c.y - b.y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!m) return NaN;
  const cos = (v1x * v2x + v1y * v2y) / m;
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** Angolo (0..90) tra il segmento a→b e la verticale. */
export function angleFromVertical(a, b) {
  return (Math.atan2(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 180) / Math.PI;
}

const px = (l, asp) => ({ x: l[0] * asp, y: l[1] });

function mean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN; }
function std(a) { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); }
function median(a) {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(a, p) {
  const s = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!s.length) return NaN;
  const idx = (p / 100) * (s.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}
const round = (v, d = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '–');

/* ------------------------------------------------------------------ */
/* Lato più visibile                                                    */
/* ------------------------------------------------------------------ */

export function detectSide(raw, sample = 30) {
  let l = 0, r = 0, n = 0;
  for (const f of raw) {
    if (!f) continue;
    r += mean(RIGHT_VIS.map((i) => f[i][2]));
    l += mean(LEFT_VIS.map((i) => f[i][2]));
    if (++n >= sample) break;
  }
  if (!n) return { side: 'right', scoreL: 0, scoreR: 0 };
  return { side: r >= l ? 'right' : 'left', scoreL: l / n, scoreR: r / n };
}

/** +1 se la persona guarda verso destra dell'immagine, −1 verso sinistra. */
function detectFacing(smoothed, side, asp) {
  const idx = SIDE_IDX[side];
  const diffs = [];
  for (const s of smoothed) {
    if (!s.lm) continue;
    diffs.push((s.lm[0][0] - s.lm[idx.hip][0]) * asp);
    if (diffs.length >= 40) break;
  }
  const m = median(diffs);
  return m < 0 ? -1 : 1;
}

/* ------------------------------------------------------------------ */
/* Metriche per frame                                                   */
/* ------------------------------------------------------------------ */

function frameMetrics(smoothed, side, asp, facing) {
  const I = SIDE_IDX[side];
  const n = smoothed.length;
  const M = {
    hip: new Array(n).fill(NaN), knee: new Array(n).fill(NaN), elbow: new Array(n).fill(NaN),
    lean: new Array(n).fill(NaN), trunkVert: new Array(n).fill(NaN), forearmVert: new Array(n).fill(NaN),
    wrX: new Array(n).fill(NaN), wrY: new Array(n).fill(NaN), shX: new Array(n).fill(NaN), shY: new Array(n).fill(NaN),
    hipX: new Array(n).fill(NaN), hipY: new Array(n).fill(NaN), kneeY: new Array(n).fill(NaN),
    ankX: new Array(n).fill(NaN),
  };
  for (let i = 0; i < n; i++) {
    const lm = smoothed[i].lm;
    if (!lm) continue;
    const sh = px(lm[I.sh], asp), el = px(lm[I.el], asp), wr = px(lm[I.wr], asp);
    const hp = px(lm[I.hip], asp), kn = px(lm[I.knee], asp), an = px(lm[I.ank], asp), ft = px(lm[I.foot], asp);
    M.hip[i] = angle3(sh, hp, kn);
    M.knee[i] = angle3(hp, kn, an);
    M.elbow[i] = angle3(sh, el, wr);
    M.trunkVert[i] = angleFromVertical(hp, sh);
    // inclinazione con segno: positiva = busto in avanti rispetto al verso di sguardo
    M.lean[i] = (Math.atan2((sh.x - hp.x) * facing, hp.y - sh.y) * 180) / Math.PI;
    M.forearmVert[i] = angleFromVertical(el, wr);
    M.wrX[i] = wr.x; M.wrY[i] = wr.y; M.shX[i] = sh.x; M.shY[i] = sh.y;
    M.hipX[i] = hp.x; M.hipY[i] = hp.y; M.kneeY[i] = kn.y;
    M.ankX[i] = (an.x + ft.x) / 2; // mesopiede
  }
  M.torso = median(smoothed.map((s, i) => (s.lm ? Math.hypot(M.shX[i] - M.hipX[i], M.shY[i] - M.hipY[i]) : NaN)));
  M.thigh = median(smoothed.map((s) => {
    if (!s.lm) return NaN;
    return Math.hypot((s.lm[I.hip][0] - s.lm[I.knee][0]) * asp, s.lm[I.hip][1] - s.lm[I.knee][1]);
  }));
  return M;
}

function fillNaN(arr) {
  let last = NaN;
  for (let i = 0; i < arr.length; i++) { if (Number.isFinite(arr[i])) last = arr[i]; else if (Number.isFinite(last)) arr[i] = last; }
  last = NaN;
  for (let i = arr.length - 1; i >= 0; i--) { if (Number.isFinite(arr[i])) last = arr[i]; else if (Number.isFinite(last)) arr[i] = last; }
  return arr;
}

/** Segnale "depth": 0 = alto, cresce verso il fondo. */
function depthSignal(profile, M, smoothed, win) {
  const n = smoothed.length;
  let d;
  if (profile === 'rdl') d = M.hip.map((v) => 180 - v);
  else if (profile === 'squat') d = M.knee.map((v) => 180 - v);
  else if (profile === 'bench') d = M.elbow.map((v) => 180 - v);
  else {
    // Generico: usa il punto (polso o spalla) con maggiore escursione verticale,
    // orientato in modo che la posizione di partenza sia "TOP".
    const rng = (a) => percentile(a, 95) - percentile(a, 5);
    const useWrist = rng(M.wrY.slice(win.i0, win.i1 + 1)) >= rng(M.shY.slice(win.i0, win.i1 + 1));
    const y = (useWrist ? M.wrY : M.shY).slice();
    fillNaN(y);
    const seg = y.slice(win.i0, win.i1 + 1);
    const lo = percentile(seg, 5), hi = percentile(seg, 95);
    const start = median(seg.slice(0, Math.min(10, seg.length)));
    const topIsLow = Math.abs(start - lo) <= Math.abs(start - hi);
    const t = M.torso || 1;
    d = y.map((v) => ((topIsLow ? v - lo : hi - v) / t) * 100);
  }
  d = fillNaN(d.slice());
  // media mobile a 3 punti per stabilizzare la macchina a stati
  const out = d.slice();
  for (let i = 1; i < n - 1; i++) out[i] = (d[i - 1] + d[i] + d[i + 1]) / 3;
  return out;
}

/* ------------------------------------------------------------------ */
/* Macchina a stati                                                     */
/* ------------------------------------------------------------------ */

// Cerca l'inizio/fine reale del movimento: scende lungo il segnale finché non tocca la fascia "alto" (stopVal)
function walkBack(d, i, minIdx, maxSteps, stopVal) {
  let j = i, steps = 0;
  while (j > minIdx && d[j - 1] <= d[j] && d[j] > stopVal && steps < maxSteps) { j--; steps++; }
  return j;
}
function walkFwd(d, i, maxIdx, maxSteps, stopVal) {
  let j = i, steps = 0;
  while (j < maxIdx && d[j + 1] <= d[j] && d[j] > stopVal && steps < maxSteps) { j++; steps++; }
  return j;
}

/**
 * TOP → ECCENTRIC → BOTTOM → CONCENTRIC → TOP con isteresi sulle soglie.
 * Le soglie sono relative all'escursione reale della serie (lo..hi), quindi funzionano
 * anche con inquadrature o ROM diversi.
 */
export function runStateMachine(d, win, fps) {
  const seg = d.slice(win.i0, win.i1 + 1);
  const lo = percentile(seg, 5), hi = percentile(seg, 95);
  const R = hi - lo;
  const res = { reps: [], phase: new Array(d.length).fill('TOP'), lo, hi, R };
  if (!Number.isFinite(R) || R <= 0) return res;
  const nearTop = lo + 0.04 * R;
  const topT = lo + 0.12 * R, upT = lo + 0.20 * R, exitBot = lo + 0.50 * R, botT = lo + 0.60 * R;
  let st = 'TOP', startIdx = win.i0, maxVal = -Infinity, maxIdx = win.i0;
  const minDur = 0.6;
  for (let i = win.i0; i <= win.i1; i++) {
    const v = d[i];
    if (st === 'TOP') {
      if (v > upT) {
        st = 'ECCENTRIC';
        startIdx = walkBack(d, i, win.i0, Math.round(1.5 * fps), nearTop);
        maxVal = v; maxIdx = i;
      }
    } else if (st === 'ECCENTRIC') {
      if (v > maxVal) { maxVal = v; maxIdx = i; }
      if (v >= botT) st = 'BOTTOM';
      else if (v < topT) st = 'TOP';
    } else if (st === 'BOTTOM') {
      if (v > maxVal) { maxVal = v; maxIdx = i; }
      if (v < exitBot) st = 'CONCENTRIC';
    } else if (st === 'CONCENTRIC') {
      if (v >= botT) st = 'BOTTOM';
      else if (v <= topT) {
        const endIdx = walkFwd(d, i, win.i1, Math.round(0.5 * fps), nearTop);
        const dur = (endIdx - startIdx) / fps;
        if (dur >= minDur) {
          res.reps.push({ fi0: startIdx, fiMax: maxIdx, fi1: endIdx, depthMax: maxVal });
        }
        st = 'TOP';
      }
    }
    res.phase[i] = st;
  }
  return res;
}

/* ------------------------------------------------------------------ */
/* Valutazione delle singole rep                                        */
/* ------------------------------------------------------------------ */

const slice = (a, i0, i1) => a.slice(i0, i1 + 1).filter(Number.isFinite);
const minOf = (a) => (a.length ? Math.min(...a) : NaN);
const maxOf = (a) => (a.length ? Math.max(...a) : NaN);

function evaluateRep(profile, rep, M, fps, closureEnd) {
  const { fi0, fiMax, fi1 } = rep;
  const torso = M.torso || 1;
  const flags = [];
  const add = (code, msg) => flags.push({ code, msg });
  const m = {};

  if (profile === 'rdl') {
    m.hipMin = minOf(slice(M.hip, fi0, fi1));
    m.hipTop = maxOf(slice(M.hip, fiMax, closureEnd));
    m.kneeMin = minOf(slice(M.knee, fi0, fi1));
    const kneeMax = maxOf(slice(M.knee, fi0, fi1));
    m.kneeRange = kneeMax - m.kneeMin;
    m.leanTop = minOf(slice(M.lean, fiMax, closureEnd).slice(-Math.max(3, Math.round(fps * 0.3))));
    m.dev = (maxOf(slice(M.wrX, fi0, fi1).map((v, k) => Math.abs(v - M.ankX[fi0 + k]))) / torso) * 100;
    m.angMin = m.hipMin;
    if (m.hipMin > 100) add('hip_rom', `anca poco flessa al fondo (${fmt(m.hipMin)}°, target 75–95°)`);
    else if (m.hipMin < 70) add('hip_deep', `discesa eccessiva, anca a ${fmt(m.hipMin)}° (target 75–95°)`);
    if (m.hipTop < 170) add('hip_close', `chiusura incompleta dell'anca (${fmt(m.hipTop)}°, target 170–180°)`);
    if (m.leanTop < -6) add('hyperext', 'iperestensione in alto (busto inclinato indietro)');
    if (m.kneeMin < 148) add('knee_bend', `ginocchia troppo flesse (${fmt(m.kneeMin)}°): rischia di diventare uno squat`);
    else if (m.kneeRange > 22) add('knee_var', `ginocchia instabili (variazione ${fmt(m.kneeRange)}°)`);
    if (m.dev > 20) add('path', `peso lontano dal corpo (${fmt(m.dev)}% del busto)`);
  } else if (profile === 'squat') {
    m.depthRatio = (M.hipY[fiMax] - M.kneeY[fiMax]) / (M.thigh || 1);
    m.depthClass = m.depthRatio >= 0.02 ? 'sotto parallelo' : m.depthRatio >= -0.08 ? 'parallelo' : 'sopra parallelo';
    m.kneeMin = minOf(slice(M.knee, fi0, fi1));
    m.trunkAtBottom = M.trunkVert[fiMax];
    m.kneeTop = maxOf(slice(M.knee, fiMax, closureEnd));
    m.dev = (maxOf(slice(M.shX, fi0, fi1).map((v, k) => Math.abs(v - M.ankX[fi0 + k]))) / torso) * 100;
    m.angMin = m.kneeMin;
    if (m.depthClass === 'sopra parallelo') add('depth', 'profondità insufficiente: anca sopra il ginocchio');
    if (m.trunkAtBottom > 55) add('trunk', `busto molto inclinato al fondo (${fmt(m.trunkAtBottom)}° dalla verticale)`);
    if (m.dev > 35) add('path', `la spalla si sposta troppo rispetto al mesopiede (${fmt(m.dev)}% del busto)`);
    if (m.kneeTop < 165) add('lockout', `estensione incompleta in risalita (ginocchio a ${fmt(m.kneeTop)}°)`);
  } else if (profile === 'bench') {
    m.elbowMin = minOf(slice(M.elbow, fi0, fi1));
    m.elbowTop = maxOf(slice(M.elbow, fiMax, closureEnd));
    m.forearm = M.forearmVert[fiMax];
    const wx = slice(M.wrX, fi0, fi1);
    m.pathRange = ((maxOf(wx) - minOf(wx)) / torso) * 100;
    m.pathClass = m.pathRange < 6 ? 'verticale' : m.pathRange <= 35 ? 'J-curve' : 'instabile';
    m.dev = m.pathRange;
    m.angMin = m.elbowMin;
    if (m.elbowMin > 95) add('elbow_rom', `discesa incompleta, gomito a ${fmt(m.elbowMin)}°`);
    else if (m.elbowMin < 55) add('elbow_deep', `gomito troppo chiuso al petto (${fmt(m.elbowMin)}°)`);
    if (m.elbowTop < 165) add('lockout', `chiusura incompleta (gomito a ${fmt(m.elbowTop)}°)`);
    if (m.forearm > 12) add('forearm', `avambraccio inclinato di ${fmt(m.forearm)}° al punto basso`);
    if (m.pathRange > 35) add('path', 'traiettoria del polso instabile');
  } else {
    const wx = slice(M.wrX, fi0, fi1);
    m.dev = ((maxOf(wx) - minOf(wx)) / torso) * 100;
    m.angMin = minOf(slice(M.elbow, fi0, fi1));
  }
  return { m, flags };
}

/* ------------------------------------------------------------------ */
/* Qualità video                                                        */
/* ------------------------------------------------------------------ */

export function assessQuality(raw, smoothed, M, side, asp, profile, brightness) {
  const issues = [];
  const total = raw.length || 1;
  const det = raw.filter(Boolean).length / total;
  if (det < 0.7) issues.push({ level: 'error', msg: `Persona rilevata solo nel ${Math.round(det * 100)}% dei frame: controlla inquadratura e luce.` });
  const I = SIDE_IDX[side];
  const need = profile === 'bench' ? [I.sh, I.el, I.wr] : profile === 'generic' ? [I.sh, I.hip, I.wr] : [I.sh, I.hip, I.knee, I.ank];
  let cut = 0, seen = 0;
  for (const f of raw) {
    if (!f) continue;
    seen++;
    if (need.some((k) => f[k][2] < 0.4 || f[k][0] < -0.02 || f[k][0] > 1.02 || f[k][1] < -0.02 || f[k][1] > 1.02)) cut++;
  }
  if (seen && cut / seen > 0.2) issues.push({ level: 'warn', msg: 'Il corpo esce dall\'inquadratura: allontana il telefono o inquadra tutto da testa a piedi.' });
  if (profile !== 'generic') {
    const widths = [];
    for (const s of smoothed) {
      if (!s.lm) continue;
      widths.push(Math.abs(s.lm[11][0] - s.lm[12][0]) * asp);
      if (widths.length >= 60) break;
    }
    const ratio = median(widths) / (M.torso || 1);
    if (ratio > 0.55) issues.push({ level: 'warn', msg: 'Inquadratura troppo frontale: gira il telefono di lato (circa 90°) per angoli affidabili.' });
  }
  if (Number.isFinite(brightness) && brightness < 50) issues.push({ level: 'warn', msg: 'Poca luce: il rilevamento può essere impreciso.' });
  return { issues, detectionRate: det, ok: !issues.some((x) => x.level === 'error') };
}

/* ------------------------------------------------------------------ */
/* Sintesi: tabella, verdetto, fatica                                   */
/* ------------------------------------------------------------------ */

const FLAG_SHORT = {
  hip_rom: 'anca poco flessa al fondo', hip_deep: 'discesa eccessiva', hip_close: 'chiusura incompleta dell\'anca',
  hyperext: 'iperestensione in alto', knee_bend: 'ginocchia troppo flesse', knee_var: 'ginocchia instabili',
  path: 'traiettoria del peso da correggere', depth: 'profondità insufficiente', trunk: 'busto troppo inclinato',
  lockout: 'chiusura incompleta', elbow_rom: 'discesa incompleta', elbow_deep: 'gomito troppo chiuso',
  forearm: 'avambraccio inclinato', rom_short: 'ROM ridotto', slow: 'rep molto più lenta',
};

function rpeHint(loss) {
  if (!Number.isFinite(loss)) return null;
  if (loss < 10) return 'RPE ≈ 6–7 (molte rep in riserva)';
  if (loss < 25) return 'RPE ≈ 8';
  if (loss < 40) return 'RPE ≈ 9';
  return 'RPE ≈ 9.5–10 (vicino al cedimento)';
}

function summarize(profile, reps, M, fps) {
  const total = reps.length;
  const valid = reps.filter((r) => r.valid).length;
  const eccs = reps.map((r) => r.ecc), concs = reps.map((r) => r.conc);
  const avgEcc = mean(eccs), avgConc = mean(concs);
  const angMins = reps.map((r) => r.angMin).filter(Number.isFinite);
  const avgAngMin = mean(angMins);
  const avgDev = mean(reps.map((r) => r.dev).filter(Number.isFinite));
  const roms = reps.map((r) => r.depthMax);
  const romCv = total > 1 ? std(roms) / (mean(roms) || 1) : 0;
  const eccCv = total > 1 ? std(eccs) / (avgEcc || 1) : 0;

  // Perdita di velocità: allungamento del tempo concentrico rispetto alle prime rep
  let loss = null;
  if (total >= 3) {
    const ref = mean(concs.slice(0, 2));
    const last = mean(concs.slice(-2));
    loss = Math.max(0, (last / ref - 1) * 100);
  }

  const count = (code) => reps.filter((r) => r.flags.some((f) => f.code === code)).length;
  const pct = (fn) => (total ? reps.filter(fn).length / total : 0);

  const rows = [];
  const row = (label, value, optimal, ok, note) => rows.push({ label, value, optimal, status: ok ? 'ok' : 'warn', note: note || '' });

  const eccOk = avgEcc >= 1.8 && avgEcc <= 5;
  const concOk = avgConc >= 0.5 && avgConc <= 3;
  const tempoNote = !eccOk ? (avgEcc < 1.8 ? 'Eccentrica troppo veloce: rallenta la discesa' : 'Eccentrica molto lenta') : '';

  if (profile === 'rdl') {
    const hipMin = mean(reps.map((r) => r.hipMin)), hipTop = mean(reps.map((r) => r.hipTop));
    const kneeMin = mean(reps.map((r) => r.kneeMin)), kneeRange = mean(reps.map((r) => r.kneeRange));
    row('Cerniera: fondo', `${fmt(hipMin)}°`, '75–95°', hipMin >= 72 && hipMin <= 100, hipMin > 100 ? 'Scendi di più con il bacino indietro' : hipMin < 72 ? 'Fermati prima: mantieni la schiena neutra' : '');
    row('Cerniera: chiusura', `${fmt(hipTop)}°`, '170–180°', hipTop >= 170, hipTop < 170 ? 'Spingi l\'anca in avanti fino a chiudere' : '');
    row('Ginocchia', `${fmt(kneeMin)}° (±${fmt(kneeRange / 2)})`, '155–165° fisse', kneeMin >= 148 && kneeRange <= 22, kneeMin < 148 ? 'Troppa flessione: è uno squat' : '');
    row('Traiettoria peso', `${fmt(avgDev)}% del busto`, '< 20%', avgDev <= 20, avgDev > 20 ? 'Tieni il bilanciere vicino alle gambe' : '');
  } else if (profile === 'squat') {
    const sotto = pct((r) => r.depthClass !== 'sopra parallelo');
    const kneeMin = mean(reps.map((r) => r.kneeMin)), trunk = mean(reps.map((r) => r.trunkAtBottom));
    const kneeTop = mean(reps.map((r) => r.kneeTop));
    row('Profondità', `${Math.round(sotto * 100)}% rep ≥ parallelo`, '≥ parallelo', sotto >= 0.8, sotto < 0.8 ? 'Scendi fino a portare l\'anca almeno a livello del ginocchio' : '');
    row('Ginocchia', `${fmt(kneeMin)}° al fondo`, '60–110°', kneeMin >= 55 && kneeMin <= 115, '');
    row('Busto', `${fmt(trunk)}° dalla verticale`, '25–55°', trunk >= 20 && trunk <= 55, trunk > 55 ? 'Busto troppo inclinato: lavora su mobilità e core' : '');
    row('Traiettoria peso', `${fmt(avgDev)}% del busto`, '< 35%', avgDev <= 35, avgDev > 35 ? 'Tieni la spalla sopra il mesopiede' : '');
    row('Chiusura', `${fmt(kneeTop)}°`, '≥ 165°', kneeTop >= 165, kneeTop < 165 ? 'Completa l\'estensione in alto' : '');
  } else if (profile === 'bench') {
    const eMin = mean(reps.map((r) => r.elbowMin)), eTop = mean(reps.map((r) => r.elbowTop));
    const fore = mean(reps.map((r) => r.forearm)), pr = mean(reps.map((r) => r.pathRange));
    row('Gomito al petto', `${fmt(eMin)}°`, '55–95°', eMin >= 55 && eMin <= 95, eMin > 95 ? 'Porta il bilanciere fino al petto' : '');
    row('Chiusura', `${fmt(eTop)}°`, '≥ 165°', eTop >= 165, eTop < 165 ? 'Chiudi completamente le braccia' : '');
    row('Avambraccio al fondo', `${fmt(fore)}° dalla verticale`, '≤ 12°', fore <= 12, fore > 12 ? 'Avambracci più verticali: rivedi la presa' : '');
    row('Traiettoria polso', `${fmt(pr)}% del busto`, 'J-curve 6–35%', pr >= 3 && pr <= 35, pr < 3 ? 'Traiettoria molto verticale' : '');
  } else {
    row('Escursione verticale', `${fmt(mean(roms))}% del busto`, '≥ 10%', mean(roms) >= 10, '');
    row('Spostamento orizzontale', `${fmt(avgDev)}% del busto`, 'basso', avgDev <= 25, '');
  }
  const romAvg = mean(roms);
  if (profile !== 'generic') {
    const unit = profile === 'rdl' || profile === 'squat' || profile === 'bench' ? '°' : '%';
    row('ROM', `${fmt(romAvg)}${unit}`, 'costante', romCv <= 0.12, romCv > 0.12 ? 'Escursione variabile da rep a rep' : '');
  }
  row('Tempo ecc. / conc.', `${fmt(avgEcc, 1)} s / ${fmt(avgConc, 1)} s`, 'ecc 2–4 s · conc 0.6–2.5 s', eccOk && concOk, tempoNote);
  row('Consistenza tra le rep', `ROM ±${fmt(romCv * 100)}% · ecc ±${fmt(eccCv * 100)}%`, 'ROM ≤ 12% · ecc ≤ 25%', romCv <= 0.12 && eccCv <= 0.25, romCv > 0.12 || eccCv > 0.25 ? 'Ripeti lo stesso schema in ogni rep' : '');

  // Verdetto in italiano
  const good = [], bad = [];
  if (profile === 'rdl') {
    if (pct((r) => !r.flags.some((f) => ['hip_rom', 'hip_deep'].includes(f.code))) >= 0.75) good.push('buon hip hinge');
    if (count('knee_bend') + count('knee_var') === 0) good.push('ginocchia stabili');
    if (count('path') === 0) good.push('peso vicino al corpo');
  } else if (profile === 'squat') {
    if (count('depth') === 0) good.push('profondità adeguata');
    if (count('trunk') === 0) good.push('busto ben controllato');
    if (count('path') === 0) good.push('traiettoria verticale');
  } else if (profile === 'bench') {
    if (count('elbow_rom') + count('elbow_deep') === 0) good.push('buon range al petto');
    if (count('forearm') === 0) good.push('avambracci verticali');
    if (count('path') === 0) good.push('traiettoria stabile');
  } else {
    if (count('rom_short') === 0) good.push('escursione costante');
  }
  if (eccOk && avgEcc >= 2) good.push(`controllo eccentrico (${fmt(avgEcc, 1)}s)`);
  const codes = {};
  reps.forEach((r) => r.flags.forEach((f) => { codes[f.code] = (codes[f.code] || 0) + 1; }));
  Object.entries(codes).sort((a, b) => b[1] - a[1]).slice(0, 3).forEach(([code, n]) => {
    bad.push(`${n} rep su ${total} mostrano ${FLAG_SHORT[code] || code}`);
  });
  if (!eccOk && avgEcc < 1.8) bad.push('discesa troppo rapida');
  let verdict;
  if (!total) verdict = 'Nessuna ripetizione riconosciuta: controlla inquadratura, profilo scelto e finestra della serie.';
  else if (good.length && bad.length) verdict = `${cap(joinIt(good.slice(0, 3)))}, ma ${bad.join('; ')}.`;
  else if (bad.length) verdict = `Da migliorare: ${bad.join('; ')}.`;
  else verdict = `Serie pulita: ${good.join(', ') || 'tutte le rep nei range ottimali'}.`;

  return {
    total, valid, improve: total - valid,
    avgEcc, avgConc, avgAngMin, avgDev, romAvg, romCv, eccCv,
    loss, rpeHint: rpeHint(loss), rows, verdict,
  };
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const joinIt = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} e ${a[a.length - 1]}`);

/* ------------------------------------------------------------------ */
/* Entry point                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param raw  array (uno per frame) di null oppure 33 landmark [x,y,visibility]
 * @param opts { fps, aspect (w/h), profile, brightness?, window?: {i0,i1} }
 */
export function analyze(raw, opts) {
  const { fps, aspect, profile = 'generic', brightness = null } = opts;
  const n = raw.length;
  const win = { i0: Math.max(0, opts.window?.i0 ?? 0), i1: Math.min(n - 1, opts.window?.i1 ?? n - 1) };
  const empty = (reason) => ({
    meta: { fps, aspect, profile, side: 'right', facing: 1, frames: n, window: win },
    frames: raw.map(() => ({ ok: false, lm: null, ph: 'TOP', rep: 0, rom: 0, pe: 0, ang: {} })),
    reps: [], summary: { total: 0, valid: 0, improve: 0, rows: [], verdict: reason, loss: null, avgEcc: NaN, avgConc: NaN, avgAngMin: NaN, avgDev: NaN },
    quality: { issues: [{ level: 'error', msg: reason }], detectionRate: 0, ok: false },
    signal: { lo: 0, hi: 1 },
  });
  if (!n || raw.every((f) => !f)) return empty('Nessuna persona rilevata nel video.');

  const { side } = detectSide(raw);
  const smoothed = smoothLandmarks(raw, fps);
  const facing = detectFacing(smoothed, side, aspect);
  const M = frameMetrics(smoothed, side, aspect, facing);
  const quality = assessQuality(raw, smoothed, M, side, aspect, profile, brightness);

  const d = depthSignal(profile, M, smoothed, win);
  const sm = runStateMachine(d, win, fps);
  const { lo, R } = sm;
  // Movimento troppo piccolo per essere una ripetizione (rumore, persona ferma)
  if (!(R >= PROFILES[profile].minRange)) sm.reps = [];

  // Rep: valutazione
  const I = SIDE_IDX[side];
  const trackIdx = I[PROFILES[profile].track];
  const reps = sm.reps.map((r, k) => {
    const next = sm.reps[k + 1];
    const closureEnd = Math.min(n - 1, r.fi1 + Math.round(0.5 * fps), next ? next.fi0 : n - 1);
    const { m, flags } = evaluateRep(profile, r, M, fps, Math.max(closureEnd, r.fi1));
    const path = [];
    for (let i = r.fi0; i <= r.fi1; i++) if (smoothed[i].lm) path.push([smoothed[i].lm[trackIdx][0], smoothed[i].lm[trackIdx][1]]);
    return {
      n: k + 1, ...r, ...m, flags,
      tStart: r.fi0 / fps, tBottom: r.fiMax / fps, tEnd: r.fi1 / fps,
      ecc: (r.fiMax - r.fi0) / fps, conc: (r.fi1 - r.fiMax) / fps,
      path,
    };
  });

  // Controlli di coerenza per il profilo generico e per ROM / durata anomali
  if (reps.length >= 3) {
    const mRom = median(reps.map((r) => r.depthMax));
    const mDur = median(reps.map((r) => r.tEnd - r.tStart));
    reps.forEach((r) => {
      if (r.depthMax < 0.7 * mRom) r.flags.push({ code: 'rom_short', msg: `ROM ridotto rispetto alle altre rep (${Math.round((r.depthMax / mRom) * 100)}%)` });
      if (r.tEnd - r.tStart > 2 * mDur) r.flags.push({ code: 'slow', msg: 'rep molto più lenta delle altre (possibile cedimento)' });
    });
  }
  reps.forEach((r) => { r.valid = r.flags.length === 0; r.verdict = r.valid ? 'VALID' : 'NEEDS_IMPROVEMENT'; r.reason = r.flags.map((f) => f.msg).join('; '); });

  const summary = summarize(profile, reps, M, fps);
  // rep migliore (per il "fantasma"): valida con minor deviazione
  const pool = reps.filter((r) => r.valid);
  const cand = (pool.length ? pool : reps).slice().sort((a, b) => a.dev - b.dev)[0];
  summary.bestRep = cand ? cand.n : null;
  summary.side = side;

  // Frame annotati per l'HUD
  const frames = new Array(n);
  let phaseStart = 0, prevPhase = 'TOP';
  for (let i = 0; i < n; i++) {
    const ph = sm.phase[i];
    if (ph !== prevPhase) { phaseStart = i; prevPhase = ph; }
    frames[i] = {
      ok: smoothed[i].ok, lm: smoothed[i].lm, ph, rep: 0,
      pe: (i - phaseStart) / fps,
      rom: Number.isFinite(R) && R > 0 ? Math.max(0, Math.min(1, (d[i] - lo) / R)) : 0,
      ang: { hip: M.hip[i], knee: M.knee[i], elbow: M.elbow[i], trunk: M.trunkVert[i] },
    };
  }
  reps.forEach((r) => { for (let i = r.fi0; i <= r.fi1; i++) frames[i].rep = r.n; });
  // fuori dalla finestra la fase non è significativa
  for (let i = 0; i < n; i++) if (i < win.i0 || i > win.i1) { frames[i].ph = 'TOP'; frames[i].rom = 0; }

  return {
    meta: { fps, aspect, profile, side, facing, frames: n, window: win, torso: M.torso, trackIdx },
    frames, reps, summary, quality,
    signal: { lo, hi: sm.hi, R },
  };
}

/** Versione senza frame né path, adatta a JSON compatti (Gemini, log, export). */
export function compactReps(analysis) {
  return analysis.reps.map((r) => ({
    rep: r.n, ecc_s: round(r.ecc, 2), conc_s: round(r.conc, 2), angolo_min: round(r.angMin, 0),
    deviazione_pct: round(r.dev, 1), giudizio: r.verdict, motivi: r.flags.map((f) => f.msg),
  }));
}
