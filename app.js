// app.js — orchestrazione di Fulcro: upload, analisi, player, report, sessione e sync.

import { analyze, compactReps, PROFILES } from './biomechanics.js';
import { createPoseEngine } from './poseEngine.js';
import { HudRenderer, LAYERS } from './hudRenderer.js';
import * as sheets from './sheetsSync.js';

/* ------------------------------------------------------------------ */
/* Utilità                                                              */
/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Crea nodi DOM in modo sicuro: il testo non passa mai da innerHTML. */
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const fmtTime = (t) => {
  if (!Number.isFinite(t)) return '0:00.0';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};
const nf = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : '–');
const localDate = () => new Date().toLocaleDateString('sv-SE');
const localTime = () => new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function toast(msg, kind = 'info', ms = 3800) {
  const el = h('div', { class: 'toast', dataset: { kind } }, msg);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), ms);
}

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ } };

/* ------------------------------------------------------------------ */
/* Stato                                                                */
/* ------------------------------------------------------------------ */

const video = $('#video');
const hud = new HudRenderer($('#hud'), video);

const state = {
  url: null,
  raw: null,
  rawMeta: null,
  analysis: null,
  trim: { start: null, end: null },
  record: null,
  engine: null,
  analyzing: false,
  cancel: false,
  nameTouched: false,
  pendingImport: null,
  lastSaved: false,
  scrubbing: false,
};

const SESSION_KEY = 'fulcro.session';
const HISTORY_KEY = 'fulcro.history';

/* ------------------------------------------------------------------ */
/* Registro sessione e storico (solo locale)                            */
/* ------------------------------------------------------------------ */

function loadSession() {
  const s = lsGet(SESSION_KEY, null);
  if (!s || s.date !== localDate() || !Array.isArray(s.items)) return { date: localDate(), items: [] };
  return s;
}
const saveSession = (s) => lsSet(SESSION_KEY, s);

function upsert(list, rec) {
  const i = list.findIndex((x) => x.id === rec.id);
  if (i >= 0) list[i] = rec; else list.push(rec);
}

function upsertSession(rec) {
  const s = loadSession();
  upsert(s.items, { ...rec });
  saveSession(s);
}

function upsertHistory(rec) {
  const hst = lsGet(HISTORY_KEY, []);
  upsert(hst, { ...rec });
  lsSet(HISTORY_KEY, hst.slice(-400));
}

function markSaved(ids) {
  const s = loadSession();
  s.items.forEach((x) => { if (ids.includes(x.id)) x.sync = 'saved'; });
  saveSession(s);
  const hst = lsGet(HISTORY_KEY, []);
  hst.forEach((x) => { if (ids.includes(x.id)) x.sync = 'saved'; });
  lsSet(HISTORY_KEY, hst);
  if (state.record && ids.includes(state.record.id)) state.record.sync = 'saved';
}

function renderSession() {
  const s = loadSession();
  const list = $('#sessionLog');
  list.replaceChildren(...s.items.map((x) => h('li', { class: 'log-item' },
    h('b', {}, `${x.exercise}${x.load ? ` · ${x.load} kg` : ''}`),
    h('span', { class: 'log-sync', dataset: { s: x.sync || 'none' } }, x.sync === 'saved' ? 'Su Sheets ✓' : x.sync === 'queued' ? 'In coda' : 'Locale'),
    h('small', {}, `${x.session} · ${x.total} rep (${x.valid} valide) · ${x.time}`),
  )));
  $('#logSection').hidden = s.items.length === 0;
}

/* ------------------------------------------------------------------ */
/* Setup serie                                                          */
/* ------------------------------------------------------------------ */

function readSetup() {
  return {
    session: ($('input[name="session"]:checked') || {}).value || 'Day A',
    profile: ($('input[name="profile"]:checked') || {}).value || 'rdl',
    exercise: $('#exName').value.trim() || PROFILES[($('input[name="profile"]:checked') || {}).value || 'rdl'].defaultName,
    load: parseFloat(String($('#load').value).replace(',', '.')) || 0,
    notes: $('#notes').value.trim(),
  };
}

function applySetup(s) {
  if (!s) return;
  const set = (name, val) => { const el = $(`input[name="${name}"][value="${CSS.escape(String(val))}"]`); if (el) el.checked = true; };
  set('session', s.session); set('profile', s.profile);
  if (s.exercise) { $('#exName').value = s.exercise; state.nameTouched = true; }
  if (s.load) $('#load').value = s.load;
  if (s.notes) $('#notes').value = s.notes;
}

$('#exName').addEventListener('input', () => { state.nameTouched = true; onMetaChange(); });
$('#load').addEventListener('input', onMetaChange);
$('#notes').addEventListener('input', onMetaChange);
$$('input[name="session"]').forEach((el) => el.addEventListener('change', onMetaChange));
$$('input[name="profile"]').forEach((el) => el.addEventListener('change', () => {
  if (!state.nameTouched) $('#exName').value = PROFILES[el.value].defaultName;
  if (state.analysis) recomputeSoon(); else onMetaChange();
}));

/* ------------------------------------------------------------------ */
/* Caricamento video                                                    */
/* ------------------------------------------------------------------ */

$('#fileInput').addEventListener('change', (e) => {
  const f = e.target.files && e.target.files[0];
  if (f) loadVideo(f);
  e.target.value = '';
});
$('#btnChange').addEventListener('click', () => $('#fileInput').click());

function whenMetadata(v) {
  return new Promise((resolve, reject) => {
    if (v.readyState >= 1) return resolve();
    const ok = () => { cleanup(); resolve(); };
    const ko = () => { cleanup(); reject(new Error('Formato video non supportato da questo browser.')); };
    const cleanup = () => { v.removeEventListener('loadedmetadata', ok); v.removeEventListener('error', ko); };
    v.addEventListener('loadedmetadata', ok);
    v.addEventListener('error', ko);
  });
}

async function loadVideo(file) {
  if (state.analyzing) return;
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = URL.createObjectURL(file);
  state.raw = null; state.rawMeta = null; state.analysis = null; state.record = null;
  state.trim = { start: null, end: null };
  hud.setAnalysis(null);
  video.pause();
  video.src = state.url;
  video.playbackRate = 1;
  try {
    await whenMetadata(video);
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  const ar = video.videoWidth / video.videoHeight;
  $('#stage').style.setProperty('--ar', String(ar || 0.5625));
  $('#intake').hidden = true;
  $('#setup').hidden = false;
  $('#player').hidden = false;
  $('#report').hidden = true;
  $('#dock').hidden = true;
  $('#btnAnalyze').textContent = 'Analizza il video';
  $('#timeTotal').textContent = fmtTime(video.duration);
  $('#seek').value = 0;
  updateTrimUi();
  renderTicks();
  requestAnimationFrame(() => hud.resize());
  if (state.pendingImport) applyImport(state.pendingImport);
}

/* ------------------------------------------------------------------ */
/* Analisi frame-by-frame                                               */
/* ------------------------------------------------------------------ */

function chooseFps(duration) {
  for (const f of [30, 20, 15]) if (duration * f <= 5400) return f;
  return 10;
}

function seekTo(v, t) {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return resolve();
    let done = false;
    const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', fin); clearTimeout(to); resolve(); };
    const to = setTimeout(fin, 1500);
    v.addEventListener('seeked', fin);
    v.currentTime = Math.min(t, Math.max(0, v.duration - 0.001));
  });
}

const lumaCanvas = document.createElement('canvas');
lumaCanvas.width = 32; lumaCanvas.height = 32;
const lumaCtx = lumaCanvas.getContext('2d', { willReadFrequently: true });
function sampleLuma() {
  try {
    lumaCtx.drawImage(video, 0, 0, 32, 32);
    const d = lumaCtx.getImageData(0, 0, 32, 32).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return sum / (d.length / 4);
  } catch { return null; }
}

function setBusy(on) {
  state.analyzing = on;
  $$('.timeline, .transport, .controls-row, .layers').forEach((el) => { el.inert = on; });
  $('#btnAnalyze').disabled = on;
  $('#progress').hidden = !on;
}

function setProgress(p, text) {
  $('#progressFill').style.width = `${Math.round(p * 100)}%`;
  if (text) $('#progressText').textContent = text;
}

$('#btnAnalyze').addEventListener('click', runAnalysis);
$('#btnCancel').addEventListener('click', () => { state.cancel = true; });

async function runAnalysis() {
  if (state.analyzing || !video.src) return;
  state.cancel = false;
  setBusy(true);
  setProgress(0, 'Preparo l\'analisi…');
  video.pause();
  try {
    if (!state.engine) state.engine = await createPoseEngine((m) => setProgress(0, m));
  } catch (e) {
    console.error(e);
    toast('Impossibile caricare il modello di posa. Serve la rete la prima volta.', 'error', 6000);
    setBusy(false);
    return;
  }
  state.engine.startNewRun();
  const duration = video.duration;
  const fps = chooseFps(duration);
  const N = Math.max(1, Math.floor(duration * fps));
  const raw = new Array(N).fill(null);
  const lumas = [];
  const t0 = performance.now();
  try {
    for (let i = 0; i < N; i++) {
      if (state.cancel) break;
      await seekTo(video, i / fps);
      raw[i] = state.engine.detect(video, i, fps);
      if (i % 12 === 0) { const l = sampleLuma(); if (l != null) lumas.push(l); }
      if (i % 3 === 0 || i === N - 1) {
        const elapsed = (performance.now() - t0) / 1000;
        const eta = i > 10 ? Math.max(0, (elapsed / i) * (N - i)) : null;
        setProgress((i + 1) / N, `Analisi frame ${i + 1}/${N} · ${Math.round(((i + 1) / N) * 100)}%${eta != null ? ` · ~${Math.ceil(eta)} s` : ''}`);
      }
    }
  } catch (e) {
    console.error(e);
    toast('Errore durante l\'analisi del video.', 'error');
    setBusy(false);
    return;
  }
  setBusy(false);
  if (state.cancel) { toast('Analisi annullata.'); await seekTo(video, 0); return; }
  state.raw = raw;
  state.rawMeta = {
    fps, duration, width: video.videoWidth, height: video.videoHeight,
    brightness: lumas.length ? lumas.reduce((a, b) => a + b, 0) / lumas.length : null,
  };
  await seekTo(video, 0);
  recompute(true);
  $('#btnAnalyze').textContent = 'Riesegui analisi';
  $('#report').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
}

/* ------------------------------------------------------------------ */
/* Ricalcolo (cambio profilo, finestra della serie)                     */
/* ------------------------------------------------------------------ */

function trimWindow() {
  const m = state.rawMeta;
  const n = state.raw.length;
  const i0 = state.trim.start != null ? Math.round(state.trim.start * m.fps) : 0;
  const i1 = state.trim.end != null ? Math.round(state.trim.end * m.fps) : n - 1;
  return { i0: Math.max(0, Math.min(i0, n - 2)), i1: Math.max(1, Math.min(i1, n - 1)) };
}

function recompute(isNew = false) {
  if (!state.raw) return;
  const setup = readSetup();
  const m = state.rawMeta;
  const win = trimWindow();
  if (win.i1 - win.i0 < 5) { toast('La finestra della serie è troppo corta.', 'error'); return; }
  state.analysis = analyze(state.raw, {
    fps: m.fps, aspect: m.width / m.height, profile: setup.profile, brightness: m.brightness, window: win,
  });
  hud.setAnalysis(state.analysis);
  buildRecord(isNew);
  renderReport();
  renderTicks();
  renderSession();
  updateDock();
  $('#aiCard').hidden = true;
  if (isNew && state.record && sheets.getSettings().autoSync) sendRecord(true);
}
const recomputeSoon = debounce(() => recompute(false), 250);

/* ------------------------------------------------------------------ */
/* Record della serie                                                   */
/* ------------------------------------------------------------------ */

function fillRecord(rec) {
  const a = state.analysis, s = a.summary, setup = readSetup();
  Object.assign(rec, {
    session: setup.session, profile: setup.profile, exercise: setup.exercise, load: setup.load, notes: setup.notes,
    total: s.total, valid: s.valid, improve: s.improve,
    ecc: s.avgEcc, conc: s.avgConc, angMin: s.avgAngMin, dev: s.avgDev, loss: s.loss,
    rpe: s.rpeHint, verdict: s.verdict,
  });
  return rec;
}

/** Una serie già inviata non si modifica: ogni nuova modifica crea un nuovo record. */
function editableRecord() {
  if (!state.record || state.record.sync === 'saved') {
    state.record = { id: uid(), date: localDate(), time: localTime(), ts: new Date().toISOString(), sync: 'none' };
  }
  return state.record;
}

function buildRecord(isNew) {
  const s = state.analysis.summary;
  if (!s.total) { state.record = null; return; }
  if (isNew) state.record = null;
  const rec = fillRecord(editableRecord());
  persistRecord(rec);
}

function persistRecord(rec) {
  upsertSession(rec);
  upsertHistory(rec);
  if (rec.sync === 'queued') sheets.enqueue({ ...rec });
}

function onMetaChange() {
  if (!state.analysis || !state.record && !state.analysis.summary.total) return;
  if (!state.analysis.summary.total) return;
  const rec = fillRecord(editableRecord());
  persistRecord(rec);
  renderSession();
  updateDock();
  renderCompare();
}

/* ------------------------------------------------------------------ */
/* Report                                                               */
/* ------------------------------------------------------------------ */

const ICON_WARN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';

function countTo(el, target) {
  if (reduceMotion || target === 0) { el.textContent = String(target); return; }
  const t0 = performance.now(), dur = 700;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    el.textContent = String(Math.round(target * (1 - Math.pow(1 - k, 3))));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderReport() {
  const a = state.analysis, s = a.summary;
  $('#report').hidden = false;

  $('#qualityBox').replaceChildren(...a.quality.issues.map((q) => {
    const icon = h('span'); icon.innerHTML = ICON_WARN;
    return h('div', { class: 'q-item', dataset: { level: q.level } }, icon.firstChild, h('span', {}, q.msg));
  }));

  countTo($('#kpiTotal'), s.total);
  countTo($('#kpiValid'), s.valid);
  countTo($('#kpiBad'), s.improve);
  $('#verdict').textContent = s.verdict;

  $('#specTable tbody').replaceChildren(...s.rows.map((r) => h('tr', {},
    h('td', {}, r.label, r.note ? h('span', { class: 'note' }, r.note) : null),
    h('td', { class: 'val' }, r.value, h('span', { class: 'opt' }, `Ottimale: ${r.optimal}`)),
    h('td', {}, h('span', { class: `pill ${r.status === 'ok' ? 'pill-ok' : 'pill-warn'}` }, r.status === 'ok' ? 'Bene' : 'Migliora')),
  )));
  $('#specTable').closest('.card').hidden = !s.rows.length;

  // Rep per rep
  $('#repsCard').hidden = !a.reps.length;
  $('#repList').replaceChildren(...a.reps.map((r) => h('li', {}, h('button', {
    type: 'button', class: 'rep-item', dataset: { valid: r.valid ? '1' : '0' },
    'aria-label': `Rep ${r.n}: vai al punto nel video`,
    onclick: () => seekToRep(r),
  },
  h('span', { class: 'rep-num' }, r.n),
  h('span', { class: 'rep-meta' }, `Ecc ${nf(r.ecc)} s · Conc ${nf(r.conc)} s${Number.isFinite(r.angMin) ? ` · ${Math.round(r.angMin)}°` : ''}`),
  h('span', { class: 'rep-go' }, fmtTime(r.tStart)),
  h('span', { class: 'rep-reason' }, r.valid ? 'Rep corretta' : r.reason),
  ))));

  renderFatigue();
  renderCompare();

  $('#btnAi').hidden = !(sheets.getSettings().geminiKey && s.total);
}

function renderFatigue() {
  const a = state.analysis, s = a.summary;
  const card = $('#fatigueCard');
  if (a.reps.length < 3) { card.hidden = true; return; }
  card.hidden = false;
  const concs = a.reps.map((r) => r.conc);
  const max = Math.max(...concs);
  const ref = (concs[0] + concs[1]) / 2;
  $('#fatigueChart').replaceChildren(...a.reps.map((r) => {
    const bar = h('div', { class: 'fbar', dataset: { bad: r.conc > ref * 1.2 ? '1' : '0' } },
      h('span', {}, nf(r.conc, 1)), h('i'));
    bar.querySelector('i').style.height = `${Math.max(6, Math.round((r.conc / max) * 88))}px`;
    return bar;
  }));
  $('#fatigueText').textContent = Number.isFinite(s.loss)
    ? `Perdita di velocità: ${Math.round(s.loss)}% dalle prime alle ultime rep. ${s.rpeHint ? `${s.rpeHint}.` : ''} È una stima indicativa.`
    : '';
}

function findPrevious(rec) {
  const key = rec.exercise.trim().toLowerCase();
  return lsGet(HISTORY_KEY, [])
    .filter((x) => x.id !== rec.id && x.exercise.trim().toLowerCase() === key && String(x.ts) < String(rec.ts))
    .sort((a, b) => String(b.ts).localeCompare(String(a.ts)))[0] || null;
}

function renderCompare() {
  const card = $('#compareCard');
  const rec = state.record;
  const prev = rec && findPrevious(rec);
  if (!prev) { card.hidden = true; return; }
  const pct = (r) => (r.total ? (r.valid / r.total) * 100 : NaN);
  const defs = [
    ['Rep valide', pct(rec), pct(prev), '%', 1, 'up'],
    ['Angolo minimo', rec.angMin, prev.angMin, '°', 0, 'flat'],
    ['Tempo eccentrico', rec.ecc, prev.ecc, ' s', 1, 'flat'],
    ['Tempo concentrico', rec.conc, prev.conc, ' s', 1, 'flat'],
    ['Deviazione traiettoria', rec.dev, prev.dev, '%', 1, 'down'],
    ['Perdita di velocità', rec.loss, prev.loss, '%', 0, 'down'],
    ['Carico', rec.load, prev.load, ' kg', 1, 'flat'],
  ];
  const items = [];
  for (const [label, now, before, unit, d, better] of defs) {
    if (!Number.isFinite(now) || !Number.isFinite(before)) continue;
    const diff = now - before;
    if (Math.abs(diff) < Math.pow(10, -d) / 2) { items.push(h('li', {}, label, h('span', { class: 'delta', dataset: { tone: 'flat' } }, '=' ))); continue; }
    const tone = better === 'flat' ? 'flat' : (better === 'up') === (diff > 0) ? 'good' : 'bad';
    items.push(h('li', {}, label, h('span', { class: 'delta', dataset: { tone } }, `${diff > 0 ? '+' : '−'}${Math.abs(diff).toFixed(d)}${unit}`)));
  }
  if (!items.length) { card.hidden = true; return; }
  const [y, m, dd] = String(prev.date).split('-');
  $('#compareTitle').textContent = `Rispetto al ${dd}/${m}${prev.load ? ` (${prev.load} kg)` : ''}`;
  $('#compareList').replaceChildren(...items);
  card.hidden = false;
}

/* ------------------------------------------------------------------ */
/* Player                                                               */
/* ------------------------------------------------------------------ */

const seek = $('#seek');
hud.onFrame = (t) => {
  const d = video.duration || 1;
  if (!state.scrubbing) seek.value = String(Math.round((t / d) * 1000));
  $('#timeNow').textContent = fmtTime(t);
};
seek.addEventListener('pointerdown', () => { state.scrubbing = true; });
['pointerup', 'pointercancel', 'blur'].forEach((ev) => seek.addEventListener(ev, () => { state.scrubbing = false; }));
seek.addEventListener('input', () => { video.currentTime = (Number(seek.value) / 1000) * (video.duration || 0); });

const fpsNow = () => (state.rawMeta ? state.rawMeta.fps : 30);

$('#btnPlay').addEventListener('click', () => {
  if (video.paused) {
    if (video.ended) video.currentTime = 0;
    video.play().catch(() => toast('Impossibile avviare la riproduzione.', 'error'));
  } else video.pause();
});
const syncPlayIcons = () => {
  const playing = !video.paused && !video.ended;
  $('#iconPlay').hidden = playing; $('#iconPause').hidden = !playing;
  $('#btnPlay').setAttribute('aria-label', playing ? 'Pausa' : 'Riproduci');
};
['play', 'pause', 'ended'].forEach((ev) => video.addEventListener(ev, syncPlayIcons));

const step = (dir) => { video.pause(); video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + dir / fpsNow())); };
$('#btnStepBack').addEventListener('click', () => step(-1));
$('#btnStepFwd').addEventListener('click', () => step(1));

function seekToRep(r) {
  video.pause();
  video.currentTime = Math.max(0, r.tStart - 0.15);
  $('#stage').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
}
$('#btnPrevRep').addEventListener('click', () => {
  const a = state.analysis; if (!a || !a.reps.length) return;
  const t = video.currentTime;
  const prev = [...a.reps].reverse().find((r) => r.tStart < t - 0.6);
  video.pause(); video.currentTime = prev ? Math.max(0, prev.tStart - 0.15) : 0;
});
$('#btnNextRep').addEventListener('click', () => {
  const a = state.analysis; if (!a || !a.reps.length) return;
  const t = video.currentTime;
  const next = a.reps.find((r) => r.tStart > t + 0.2);
  if (next) { video.pause(); video.currentTime = Math.max(0, next.tStart - 0.15); }
});

$$('input[name="speed"]').forEach((el) => el.addEventListener('change', () => { video.playbackRate = Number(el.value); }));

// Finestra della serie (inizio / fine)
function updateTrimUi() {
  const d = video.duration || 1;
  const { start, end } = state.trim;
  const shade = $('#trimShade');
  const s = start != null ? start : 0, e = end != null ? end : d;
  shade.style.left = `${(s / d) * 100}%`;
  shade.style.width = `${Math.max(0, (e - s) / d) * 100}%`;
  shade.hidden = start == null && end == null;
  $('#btnTrimStart').setAttribute('aria-pressed', start != null ? 'true' : 'false');
  $('#btnTrimEnd').setAttribute('aria-pressed', end != null ? 'true' : 'false');
  $('#btnTrimStart').textContent = start != null ? `Inizio ${fmtTime(start)}` : 'Inizio serie';
  $('#btnTrimEnd').textContent = end != null ? `Fine ${fmtTime(end)}` : 'Fine serie';
  $('#btnTrimReset').hidden = start == null && end == null;
}
function trimChanged() { updateTrimUi(); if (state.analysis) recomputeSoon(); }
$('#btnTrimStart').addEventListener('click', () => {
  state.trim.start = video.currentTime;
  if (state.trim.end != null && state.trim.end <= state.trim.start) state.trim.end = null;
  trimChanged();
});
$('#btnTrimEnd').addEventListener('click', () => {
  state.trim.end = video.currentTime;
  if (state.trim.start != null && state.trim.start >= state.trim.end) state.trim.start = null;
  trimChanged();
});
$('#btnTrimReset').addEventListener('click', () => { state.trim = { start: null, end: null }; trimChanged(); });

function renderTicks() {
  const box = $('#ticks');
  const a = state.analysis;
  box.classList.remove('in');
  box.replaceChildren();
  if (!a) return;
  const d = video.duration || 1;
  a.reps.forEach((r, i) => {
    const tick = h('button', { type: 'button', class: 'tick', tabindex: '-1', 'aria-hidden': 'true', dataset: { valid: r.valid ? '1' : '0' } });
    tick.style.left = `${(((r.tStart + r.tEnd) / 2) / d) * 100}%`;
    tick.style.setProperty('--i', String(i));
    tick.style.border = '0'; tick.style.padding = '0';
    box.append(tick);
  });
  void box.offsetWidth; // riavvia l'animazione di ingresso
  box.classList.add('in');
}

// Livelli HUD
$('#layerChips').replaceChildren(...LAYERS.map((l) => h('label', {},
  h('input', { type: 'checkbox', checked: true, onchange: (e) => hud.setLayer(l.key, e.target.checked) }),
  h('span', {}, l.label),
)));

/* ------------------------------------------------------------------ */
/* Invio a Google Sheets                                                */
/* ------------------------------------------------------------------ */

function updateBadge() {
  const b = $('#syncBadge');
  const q = sheets.getQueue();
  const st = sheets.getSettings();
  let state_ = 'idle', text = 'Configura Sheets';
  if (q.length) { state_ = 'queued'; text = `In coda offline (${q.length})`; }
  else if (state.lastSaved) { state_ = 'saved'; text = 'Salvato su Sheets ✓'; }
  else if (sheets.isConnected()) { state_ = 'idle'; text = 'Sheets connesso'; }
  else if (st.clientId && st.sheetUrl) text = 'Sheets non connesso';
  b.dataset.state = state_;
  b.textContent = text;
}

function setSeriesStatus(kind, text) {
  const el = $('#seriesStatus');
  el.dataset.state = kind;
  el.textContent = text;
}

function updateDock() {
  const rec = state.record;
  $('#dock').hidden = !rec;
  if (!rec) return;
  const btn = $('#btnSend');
  btn.disabled = rec.sync === 'saved';
  btn.textContent = rec.sync === 'saved' ? 'Serie salvata ✓' : 'Invia serie a Sheets';
  if (rec.sync === 'saved') setSeriesStatus('saved', 'Salvato su Sheets ✓');
  else if (rec.sync === 'queued') setSeriesStatus('queued', 'In coda offline: parte appena c\'è rete');
  else setSeriesStatus('', '');
}

function explain(err) {
  switch (err && err.code) {
    case 'OFFLINE': return 'In coda offline: si invia al ritorno della rete';
    case 'AUTH': return 'Serve riconnettere Google: tocca il badge in alto';
    case 'CONFIG': return 'Imposta Client ID e URL del foglio nelle impostazioni';
    case 'ACCESS': return 'Accesso al foglio negato: controlla URL e permessi';
    default: return (err && err.message) || 'Invio non riuscito';
  }
}

async function sendRecord(auto = false) {
  const rec = state.record;
  if (!rec || rec.sync === 'saved') return;
  const st = sheets.getSettings();
  if (!st.clientId || !st.sheetUrl) {
    if (!auto) { toast('Prima imposta Client ID e URL del foglio.', 'error'); openSettings(); }
    rec.sync = 'queued'; sheets.enqueue({ ...rec }); persistRecord(rec); renderSession(); updateDock(); updateBadge();
    if (auto) setSeriesStatus('queued', 'Configura Google Sheets per salvare');
    return;
  }
  $('#syncBadge').dataset.state = 'syncing';
  $('#syncBadge').textContent = 'Sincronizzo…';
  setSeriesStatus('', 'Invio in corso…');
  const res = await sheets.syncSeries({ ...rec }, { interactive: !auto });
  if (res.status === 'saved') {
    state.lastSaved = true;
    markSaved(res.ids);
    toast('Serie salvata su Google Sheets ✓', 'ok');
  } else {
    rec.sync = 'queued';
    persistRecord(rec);
    setSeriesStatus(res.error && res.error.code === 'OFFLINE' ? 'queued' : 'error', explain(res.error));
    if (res.error && res.error.code === 'CONFIG') openSettings();
  }
  renderSession();
  if (res.status === 'saved') updateDock();
  updateBadge();
}
$('#btnSend').addEventListener('click', () => sendRecord(false));

$('#syncBadge').addEventListener('click', async () => {
  if (sheets.getQueue().length) {
    try {
      const ids = await sheets.flush({ interactive: true });
      if (ids.length) { state.lastSaved = true; markSaved(ids); toast(`${ids.length} serie sincronizzate ✓`, 'ok'); }
    } catch (e) { toast(explain(e), 'error', 5000); }
    renderSession(); updateDock(); updateBadge();
  } else openSettings();
});

window.addEventListener('online', async () => {
  if (!sheets.getQueue().length) return;
  try {
    const ids = await sheets.flush({ interactive: false });
    if (ids.length) { state.lastSaved = true; markSaved(ids); toast('Serie in coda sincronizzate ✓', 'ok'); }
  } catch { /* serve un tocco sul badge */ }
  renderSession(); updateDock(); updateBadge();
});
window.addEventListener('offline', updateBadge);

/* ------------------------------------------------------------------ */
/* Sessione: copia riepilogo                                            */
/* ------------------------------------------------------------------ */

$('#btnClose').addEventListener('click', async () => {
  const s = loadSession();
  if (!s.items.length) return;
  const label = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const ok = await sheets.copyText(sheets.buildSessionText(s.items, label));
  toast(ok ? 'Riepilogo copiato negli appunti ✓' : 'Copia non riuscita: consenti l\'accesso agli appunti.', ok ? 'ok' : 'error');
});
$('#btnClearLog').addEventListener('click', () => {
  if (!confirm('Svuotare il registro di oggi? Lo storico per i confronti resta.')) return;
  saveSession({ date: localDate(), items: [] });
  renderSession();
});

/* ------------------------------------------------------------------ */
/* Coach AI                                                             */
/* ------------------------------------------------------------------ */

$('#btnAi').addEventListener('click', async () => {
  const a = state.analysis, rec = state.record;
  const key = sheets.getSettings().geminiKey;
  if (!a || !rec || !key) return;
  const card = $('#aiCard'), text = $('#aiText');
  card.hidden = false; text.className = 'muted'; text.textContent = 'Il coach sta leggendo le metriche…';
  card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
  const prev = findPrevious(rec);
  const payload = {
    esercizio: rec.exercise, profilo: PROFILES[rec.profile].label, carico_kg: rec.load, note: rec.notes,
    rep_totali: rec.total, rep_valide: rec.valid,
    tempo_ecc_medio_s: round(rec.ecc, 2), tempo_conc_medio_s: round(rec.conc, 2),
    angolo_min_medio_gradi: round(rec.angMin, 0), deviazione_traiettoria_pct: round(rec.dev, 1),
    perdita_velocita_pct: round(rec.loss, 0), verdetto_automatico: rec.verdict,
    rep: compactReps(a),
    serie_precedente: prev ? { data: prev.date, carico_kg: prev.load, rep_valide: prev.valid, rep_totali: prev.total, angolo_min: round(prev.angMin, 0) } : null,
  };
  try {
    const out = await sheets.askCoach(key, payload);
    text.className = ''; text.textContent = out;
  } catch (e) {
    text.className = 'muted'; text.textContent = `Coach non disponibile: ${e.message}`;
  }
});
const round = (v, d) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);

/* ------------------------------------------------------------------ */
/* Esporta / importa analisi                                            */
/* ------------------------------------------------------------------ */

$('#btnExport').addEventListener('click', () => {
  if (!state.raw) return;
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const data = {
    app: 'fulcro', v: 1, ...state.rawMeta, setup: readSetup(), trim: state.trim,
    raw: state.raw.map((f) => (f ? f.map((l) => [r4(l[0]), r4(l[1]), Math.round(l[2] * 100) / 100]) : null)),
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `fulcro_${localDate()}_${readSetup().exercise.replace(/[^\w-]+/g, '_')}.json` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Analisi esportata: ricaricandola non rifai la pre-analisi.', 'ok');
});

$('#btnImport').addEventListener('click', () => $('#importInput').click());
$('#importInput').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    validateImport(data);
    state.pendingImport = data;
    if (video.src && video.readyState >= 1) applyImport(data);
    else toast('Analisi caricata. Ora scegli il video corrispondente.', 'ok', 5000);
  } catch (err) {
    toast(`File non valido: ${err.message}`, 'error', 5000);
  }
});

function validateImport(d) {
  const bad = (m) => { throw new Error(m); };
  if (!d || d.app !== 'fulcro' || d.v !== 1) bad('non è un\'analisi di Fulcro');
  if (!Array.isArray(d.raw) || d.raw.length < 5 || d.raw.length > 30000) bad('dati dei frame mancanti');
  if (![d.fps, d.duration, d.width, d.height].every((x) => Number.isFinite(x) && x > 0)) bad('metadati mancanti');
  for (const f of d.raw) {
    if (f === null) continue;
    if (!Array.isArray(f) || f.length !== 33) bad('landmark non validi');
    for (const l of f) if (!Array.isArray(l) || l.length !== 3 || !l.every(Number.isFinite)) bad('landmark non validi');
  }
}

function applyImport(d) {
  state.pendingImport = null;
  if (Math.abs(d.duration - video.duration) > 0.6) {
    toast('Il video scelto non corrisponde all\'analisi (durata diversa).', 'error', 6000);
    return;
  }
  state.raw = d.raw;
  state.rawMeta = { fps: d.fps, duration: d.duration, width: d.width, height: d.height, brightness: Number.isFinite(d.brightness) ? d.brightness : null };
  state.trim = { start: Number.isFinite(d.trim && d.trim.start) ? d.trim.start : null, end: Number.isFinite(d.trim && d.trim.end) ? d.trim.end : null };
  applySetup(d.setup);
  updateTrimUi();
  recompute(true);
  $('#btnAnalyze').textContent = 'Riesegui analisi';
  toast('Analisi importata: nessuna pre-analisi necessaria ✓', 'ok');
}

/* ------------------------------------------------------------------ */
/* Impostazioni                                                         */
/* ------------------------------------------------------------------ */

const dlg = $('#settings');
function openSettings() {
  const s = sheets.getSettings();
  $('#setClientId').value = s.clientId;
  $('#setSheetUrl').value = s.sheetUrl;
  $('#setAuto').checked = s.autoSync;
  $('#setWeekly').checked = s.weekly;
  $('#setGemini').value = s.geminiKey;
  $('#originHint').textContent = location.origin;
  $('#connectMsg').textContent = '';
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
}
$('#btnSettings').addEventListener('click', openSettings);

function readSettingsForm() {
  return {
    clientId: $('#setClientId').value, sheetUrl: $('#setSheetUrl').value,
    autoSync: $('#setAuto').checked, weekly: $('#setWeekly').checked, geminiKey: $('#setGemini').value,
  };
}
dlg.addEventListener('close', () => {
  if (dlg.returnValue === 'save') {
    sheets.saveSettings(readSettingsForm());
    toast('Impostazioni salvate', 'ok');
    updateBadge();
    if (state.analysis) $('#btnAi').hidden = !(sheets.getSettings().geminiKey && state.analysis.summary.total);
  }
  dlg.returnValue = '';
});

$('#btnConnect').addEventListener('click', async () => {
  const msg = $('#connectMsg');
  const f = readSettingsForm();
  if (!sheets.parseSpreadsheetId(f.sheetUrl)) { msg.textContent = 'L\'URL del foglio non è valido: incolla l\'indirizzo completo.'; return; }
  sheets.saveSettings(f);
  msg.textContent = 'Apro l\'autorizzazione Google…';
  try {
    await sheets.connect({ interactive: true });
    msg.textContent = 'Connesso. Controllo il foglio…';
    await sheets.ensureSheetReady(true);
    msg.textContent = 'Pronto: foglio «Log_Allenamenti» verificato e intestazione presente ✓';
    updateBadge();
    const q = sheets.getQueue();
    if (q.length) { const ids = await sheets.flush({ interactive: true }); if (ids.length) { state.lastSaved = true; markSaved(ids); renderSession(); updateDock(); updateBadge(); } }
  } catch (e) {
    msg.textContent = explain(e);
  }
});

$('#btnHistory').addEventListener('click', async () => {
  const msg = $('#connectMsg');
  sheets.saveSettings(readSettingsForm());
  msg.textContent = 'Leggo lo storico dal foglio…';
  try {
    const entries = await sheets.importHistory();
    const hst = lsGet(HISTORY_KEY, []);
    entries.forEach((e) => {
      if (!hst.some((x) => x.id === e.id || (x.date === e.date && x.exercise.toLowerCase() === e.exercise.toLowerCase() && x.time === e.time))) hst.push(e);
    });
    lsSet(HISTORY_KEY, hst.slice(-400));
    msg.textContent = `Storico importato: ${entries.length} serie lette dal foglio ✓`;
    renderCompare();
  } catch (e) { msg.textContent = explain(e); }
});

// Installazione PWA
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('#btnInstall').hidden = false; });
$('#btnInstall').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => {});
  deferredInstall = null; $('#btnInstall').hidden = true;
});

/* ------------------------------------------------------------------ */
/* Avvio                                                                */
/* ------------------------------------------------------------------ */

$('#exName').value = PROFILES.rdl.defaultName;
renderSession();
updateBadge();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW non registrato', e)));
}
