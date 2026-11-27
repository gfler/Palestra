// app.js — orchestrazione di Fulcro: upload, analisi, player, report, sessione e sync.

import { analyze, compactReps, PROFILES, classifyMovement, autoLabel, pct1RMFromVelocity } from './biomechanics.js';
import { createPoseEngine } from './poseEngine.js';
import { HudRenderer, LAYERS } from './hudRenderer.js';
import * as sheets from './sheetsSync.js';
import { MOVEMENT_ORDER, profileFromName } from './movements.js';
import * as store from './store.js';
import { exKey, exerciseHistory } from './training.js';
import { pickExercise } from './exDetail.js';
import { isNative, saveTextFile, shareBlob } from './native.js';
import { logVideoSet } from './viewTrain.js';
import { openRecorder } from './recorder.js';
import { renderSetImage } from './shareCard.js';

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

const PROFILE_HINT = {
  auto: 'Fulcro capisce da solo che esercizio è (squat, RDL, stacco, panca, spalle…). Dopo l\'analisi puoi correggerlo con un tocco.',
  generic: 'Conta le ripetizioni e misura i tempi, senza giudicare la tecnica.',
  lateral: 'Per le alzate inquadra da davanti o da dietro, con le braccia ben visibili.',
  _default: 'Metti il telefono di lato (circa 90°) con tutto il corpo in inquadratura.',
};

const setupState = { mode: 'free', progName: '', day: '', profileTouched: false };

function fillProfileSelect() {
  const sel = $('#profile');
  const opt = (k) => h('option', { value: k }, PROFILES[k].label);
  sel.replaceChildren(
    h('option', { value: 'auto' }, 'Automatico (lo riconosce dal video)'),
    h('optgroup', { label: 'Base' }, ...['squat', 'rdl', 'deadlift', 'bench'].map(opt)),
    h('optgroup', { label: 'Altri movimenti' }, ...MOVEMENT_ORDER.filter((k) => k !== 'deadlift').map(opt)),
    h('optgroup', { label: 'Qualsiasi altro' }, opt('generic')),
  );
}

function showProfileHint() {
  const k = $('#profile').value;
  $('#profileHint').textContent = PROFILE_HINT[k] || PROFILE_HINT._default;
}

function setProfile(k, { touched = false } = {}) {
  if (k !== 'auto' && !PROFILES[k]) k = 'auto';
  $('#profile').value = k;
  syncQuickProfile();
  if (touched) setupState.profileTouched = true;
  showProfileHint();
}

/** Tiene allineati i pulsanti rapidi e il menu completo. */
function syncQuickProfile() {
  const k = $('#profile').value;
  $$('input[name="qprof"]').forEach((el) => { el.checked = el.value === k; });
}

/* Calibrazione ricordata per ogni esercizio della scheda (es. «Pressa 45°» → Pressa). */
const PROFMAP_KEY = 'fulcro.profMap';
function profileFor(name) {
  const m = lsGet(PROFMAP_KEY, {});
  return m[exKey(name)] || profileFromName(name);
}
function rememberProfile(name, k) {
  if (!name) return;
  const m = lsGet(PROFMAP_KEY, {});
  m[exKey(name)] = k;
  lsSet(PROFMAP_KEY, m);
}

/** Profilo realmente usato: se «Automatico», quello riconosciuto dal video. */
function effectiveProfile() {
  const k = $('#profile').value || 'auto';
  if (k !== 'auto') return k;
  return (state.detected && state.detected.profile) || 'generic';
}

/** Peso dell'ultima seduta per quell'esercizio (altrimenti il riferimento della scheda). */
function lastKgFor(name, refKg) {
  const hist = exerciseHistory(store.getWorkouts(), exKey(name));
  const last = hist[hist.length - 1];
  if (last) {
    const ks = last.sets.map((x) => x.kg).filter((x) => x > 0);
    if (ks.length) return Math.max(...ks);
  }
  return refKg > 0 ? refKg : 0;
}

function setMode(mode) {
  setupState.mode = mode;
  const el = $(`input[name="mode"][value="${mode}"]`); if (el) el.checked = true;
  $('#modeFree').hidden = true;
  $('#modeProg').hidden = mode !== 'prog';
  if (mode === 'prog') fillProgDays();
}

function fillProgDays() {
  const prog = store.activeProgram();
  const daySel = $('#progDay'), exSel = $('#progEx');
  if (!prog || !prog.days.length) {
    daySel.replaceChildren(); exSel.replaceChildren();
    $('#progHint').textContent = 'Non hai ancora una scheda in uso: creala dalla sezione Schede, oppure usa «Esercizio libero».';
    return;
  }
  $('#progHint').textContent = `Scheda in uso: ${prog.name}. Il video resta collegato all'esercizio.`;
  const keep = daySel.value;
  daySel.replaceChildren(...prog.days.map((d, i) => h('option', { value: String(i) }, d.name)));
  if (keep && daySel.querySelector(`option[value="${keep}"]`)) daySel.value = keep;
  fillProgExercises();
}

function fillProgExercises() {
  const prog = store.activeProgram();
  const day = prog && prog.days[Number($('#progDay').value) || 0];
  const exSel = $('#progEx');
  if (!day) return;
  exSel.replaceChildren(h('option', { value: '' }, 'Scegli…'), ...day.exercises.map((e, i) => h('option', { value: String(i) }, e.name)));
}

function pickProgExercise() {
  const prog = store.activeProgram();
  const day = prog && prog.days[Number($('#progDay').value) || 0];
  const ex = day && day.exercises[Number($('#progEx').value)];
  if (!ex) return;
  setupState.progName = prog.name; setupState.day = day.name;
  $('#exName').value = ex.name; state.nameTouched = true;
  const kg = lastKgFor(ex.name, ex.refKg);
  if (kg) $('#load').value = kg;
  setupState.profileTouched = false;
  setProfile(profileFor(ex.name));
  updateSummary();
  if (state.analysis) recomputeSoon(); else onMetaChange();
}

function readSetup() {
  const choice = $('#profile').value || 'auto';
  const profile = effectiveProfile();
  const prog = setupState.mode === 'prog' && setupState.day;
  return {
    mode: setupState.mode,
    session: prog ? setupState.day : 'Libero',
    programName: prog ? setupState.progName : '',
    profile, choice,
    exercise: $('#exName').value.trim() || PROFILES[profile].defaultName,
    load: parseFloat(String($('#load').value).replace(',', '.')) || 0,
    notes: $('#notes').value.trim(),
  };
}

function applySetup(s) {
  if (!s) return;
  if (s.choice || s.profile) setProfile(s.choice || s.profile);
  if (s.exercise) { $('#exName').value = s.exercise; state.nameTouched = true; }
  if (s.load) $('#load').value = s.load;
  if (s.notes) $('#notes').value = s.notes;
}

fillProfileSelect();
setProfile('auto');
$('#exName').addEventListener('input', () => { state.nameTouched = true; onMetaChange(); });
$('#exName').addEventListener('change', () => {
  if (!setupState.profileTouched) {
    const g = profileFromName($('#exName').value);
    if (g !== $('#profile').value) { setProfile(g); if (state.analysis) recomputeSoon(); }
  }
});
$('#load').addEventListener('input', onMetaChange);
$('#notes').addEventListener('input', onMetaChange);
$$('input[name="mode"]').forEach((el) => el.addEventListener('change', () => { setMode(el.value); if (el.value === 'free') { setupState.day = ''; setupState.progName = ''; } onMetaChange(); }));
$('#progDay').addEventListener('change', fillProgExercises);
$('#progEx').addEventListener('change', pickProgExercise);
$('#btnPickEx').addEventListener('click', () => pickExercise({
  query: $('#exName').value, onPick: (ex) => {
    $('#exName').value = ex.n; state.nameTouched = true;
    setupState.profileTouched = false;
    setProfile(profileFromName(ex.n));
    if (state.analysis) recomputeSoon(); else onMetaChange();
  },
}));
function onProfileChosen() {
  setupState.profileTouched = true;
  if (setupState.mode === 'prog') rememberProfile($('#exName').value.trim(), $('#profile').value);
  updateSummary();
  syncQuickProfile();
  showProfileHint();
  if (!state.nameTouched) $('#exName').value = $('#profile').value === 'auto' ? '' : PROFILES[$('#profile').value].defaultName;
  if (state.analysis) recomputeSoon(); else onMetaChange();
}
$('#profile').addEventListener('change', onProfileChosen);
$$('input[name="qprof"]').forEach((el) => el.addEventListener('change', () => { $('#profile').value = el.value; onProfileChosen(); }));

/** Scelta del movimento dal riquadro nel report: ricalcola subito. */
function chooseProfileFromReport(k) {
  setProfile(k, { touched: true });
  if (setupState.mode === 'prog') rememberProfile($('#exName').value.trim(), k);
  updateSummary();
  const fromName = profileFromName($('#exName').value);
  if (!state.nameTouched || (fromName !== 'auto' && fromName !== k && !near(fromName, k))) $('#exName').value = PROFILES[k] ? PROFILES[k].defaultName : '';
  recompute(false);
  toast(`Rianalizzato come ${autoLabel(k)} ✓`, 'ok');
}

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

/** I video registrati con MediaRecorder (webm) non dichiarano la durata: la forziamo cercando la fine. */
function fixDuration(v) {
  if (Number.isFinite(v.duration) && v.duration > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { v.removeEventListener('durationchange', on); clearTimeout(to); v.currentTime = 0; resolve(); };
    const on = () => { if (Number.isFinite(v.duration)) done(); };
    const to = setTimeout(done, 4000);
    v.addEventListener('durationchange', on);
    v.currentTime = 1e7;
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
    await fixDuration(video);
  } catch (e) {
    toast(e.message, 'error');
    return;
  }
  updateSummary();
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
  const m = state.rawMeta;
  const win = trimWindow();
  if (win.i1 - win.i0 < 5) { toast('La finestra della serie è troppo corta.', 'error'); return; }
  state.detected = classifyMovement(state.raw, { fps: m.fps, aspect: m.width / m.height, window: win });
  if ($('#profile').value === 'auto' && !state.nameTouched) $('#exName').value = PROFILES[state.detected.profile].defaultName;
  const setup = readSetup();
  state.analysis = analyze(state.raw, {
    fps: m.fps, aspect: m.width / m.height, profile: setup.profile, brightness: m.brightness, window: win, heightCm: getHeight(),
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
    session: setup.session, mode: setup.mode, programName: setup.programName, profile: setup.profile, exercise: setup.exercise, load: setup.load, notes: setup.notes,
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
  renderDetect();

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
  renderVelocity();
  const lb = $('#btnLogSet');
  lb.hidden = !s.total;
  state.loggedFor = null;
  lb.className = `btn ${setupState.mode === 'prog' ? 'btn-primary' : 'btn-ghost'}`;
  lb.textContent = store.getActive() ? 'Segna la serie nell\'allenamento in corso' : (setupState.mode === 'prog' ? `Avvia «${setupState.day}» e segna la serie` : 'Segna nell\'allenamento');

  $('#btnAi').hidden = !(sheets.getSettings().geminiKey && s.total);
}

/* ------------------------------------------------------------------ */
/* Velocità del bilanciere                                              */
/* ------------------------------------------------------------------ */

const HEIGHT_KEY = 'fulcro.heightCm';
function getHeight() { const v = Number(lsGet(HEIGHT_KEY, 0)); return v >= 120 && v <= 230 ? v : 0; }
function setHeight(v) { lsSet(HEIGHT_KEY, Number(v) || 0); }
const ms = (v) => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '–');

function renderVelocity() {
  const a = state.analysis, s = a.summary, card = $('#velCard'), body = $('#velBody');
  if (!s.total) { card.hidden = true; return; }
  card.hidden = false;
  if (!getHeight()) {
    const inp = h('input', { type: 'number', inputmode: 'numeric', min: '120', max: '230', placeholder: 'es. 178', 'aria-label': 'Altezza in cm' });
    body.replaceChildren(
      h('p', { class: 'muted' }, 'Per misurare la velocità in m/s Fulcro usa la lunghezza delle tue gambe come metro. Dimmi quanto sei alto:'),
      h('div', { class: 'inline-form' }, inp, h('span', {}, 'cm'), h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => {
        const v = Number(inp.value);
        if (!(v >= 120 && v <= 230)) { toast('Altezza tra 120 e 230 cm', 'error'); return; }
        setHeight(v); recompute(false);
      } }, 'Calcola')));
    return;
  }
  const vels = a.reps.map((r) => r.vel);
  if (!vels.some(Number.isFinite)) { body.replaceChildren(h('p', { class: 'muted' }, 'Velocità non misurabile in questo video (gambe poco visibili).')); return; }
  const max = Math.max(...vels.filter(Number.isFinite), 0.1);
  const bars = h('div', { class: 'vbars' }, ...a.reps.map((r) => h('div', { class: 'vbar', dataset: { valid: r.valid ? '1' : '0' } },
    h('i', { style: `height:${Number.isFinite(r.vel) ? Math.max(6, (r.vel / max) * 100) : 4}%` }),
    h('b', {}, ms(r.vel)), h('small', {}, `#${r.n}`))));
  const load = readSetup().load;
  const pct = pct1RMFromVelocity(a.meta.profile, s.velBest);
  const rm = pct && load > 0 ? load / (pct / 100) : null;
  const zone = (v) => (v >= 1 ? 'velocità / esplosività' : v >= 0.75 ? 'forza-velocità' : v >= 0.5 ? 'forza' : v >= 0.3 ? 'forza massima' : 'vicino al massimale');
  body.replaceChildren(...[
    h('div', { class: 'vstats' },
      h('div', {}, h('span', {}, 'Media'), h('b', {}, `${ms(s.velMean)} m/s`)),
      h('div', {}, h('span', {}, 'Migliore'), h('b', {}, `${ms(s.velBest)} m/s`)),
      h('div', {}, h('span', {}, 'Perdita'), h('b', {}, Number.isFinite(s.velLoss) ? `${Math.round(s.velLoss)}%` : '–'))),
    bars,
    h('p', { class: 'muted' }, `Zona: ${zone(s.velBest)}. `,
      Number.isFinite(s.velLoss) ? (s.velLoss > 30 ? 'Hai perso più del 30%: serie molto vicina al cedimento.' : s.velLoss > 20 ? 'Perdita 20–30%: lavoro intenso, 1–3 rep in riserva.' : 'Perdita sotto il 20%: avevi ancora diverse rep.') : ''),
    pct ? h('p', { class: 'vrm' }, h('b', {}, rm ? `1RM stimato ≈ ${Math.round(rm)} kg` : `≈ ${Math.round(pct)}% del massimale`),
      h('small', {}, rm ? ` (questo carico ≈ ${Math.round(pct)}% del massimale)` : ' — inserisci il carico per il 1RM')) : null,
    h('p', { class: 'hint' }, `Stima da video 2D tarata sulla tua altezza (${getHeight()} cm): utile per confrontare le tue serie, non è un encoder.`)].filter(Boolean));
}

/* ------------------------------------------------------------------ */
/* Due pagine: Prova libera / Dalla mia scheda                          */
/* ------------------------------------------------------------------ */

const MOVE_CARDS = [
  ['auto', 'Automatico', 'Lo riconosce dal video'], ['squat', 'Squat', 'Bilanciere, goblet, front'], ['rdl', 'Stacco rumeno', 'RDL, gambe tese'],
  ['deadlift', 'Stacco da terra', 'Classico, sumo, trap bar'], ['bench', 'Panca', 'Piana, inclinata, chest press'], ['press_v', 'Spalle', 'Military, lento avanti'],
  ['pull_v', 'Lat / trazioni', 'Lat machine, trazioni'], ['pull_h', 'Rematore', 'Bilanciere, cavo, macchina'], ['hip_ext', 'Hip thrust', 'Ponte glutei'],
  ['knee_press', 'Pressa / affondi', 'Leg press, split squat'], ['knee_iso', 'Leg ext / curl', 'Macchine per le gambe'], ['curl', 'Curl', 'Bicipiti'],
  ['triceps', 'Tricipiti', 'Pushdown, french'], ['lateral', 'Alzate', 'Laterali o frontali'], ['generic', 'Altro', 'Conta rep e tempi'],
];
const GLYPH = {
  squat: 'M12 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM4 9h16M12 9v4l-4 3 2 5M12 13l4 3-2 5',
  rdl: 'M6 6a2 2 0 1 1 4 0 2 2 0 0 1-4 0ZM9 8l7 4M16 12l1 9M16 12l-3 9M11 10v6M8 16h6',
  deadlift: 'M12 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM12 8v6M12 14l-3 7M12 14l3 7M7 11h10M7 9v4M17 9v4',
  bench: 'M3 15h18M6 15v4M18 15v4M7 12h9M9 12l1-6M14 12l-1-6M7 6h10',
  press_v: 'M12 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM12 10v6l-2 5M12 16l2 5M7 4l1 7M17 4l-1 7M5 4h14',
  pull_v: 'M4 4h16M8 4l1 6M16 4l-1 6M12 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM12 12v5l-2 4M12 17l2 4',
  pull_h: 'M5 7a2 2 0 1 1 4 0 2 2 0 0 1-4 0ZM8 9l7 3M15 12l-1 9M15 12l2 9M11 11l2 5M19 16h3',
  hip_ext: 'M3 18h7M10 18l4-6h6M20 12l-1 6M6 15a2 2 0 1 1 0-4 2 2 0 0 1 0 4ZM11 9h8',
  knee_press: 'M4 20l6-6M10 14l5 1M15 15l3-8M14 5l6 3M5 13a2 2 0 1 1 0-4 2 2 0 0 1 0 4Z',
  knee_iso: 'M4 14h8M12 14v6M4 10h6l2 4M14 14l6-4M20 10l1 2',
  curl: 'M12 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM12 8v13M12 9l-3 5 3 2M16 9v3',
  triceps: 'M12 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM12 8v13M12 9l3 5-3 2M8 4v8',
  lateral: 'M12 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM12 8v13M4 9h16M3 8v2M21 8v2',
  generic: 'M4 12h4l2-5 4 10 2-5h4',
  auto: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5ZM19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z',
};
const glyph = (k) => { const el = h('span', { class: 'mv-ic', 'aria-hidden': 'true' }); el.innerHTML = `<svg viewBox="0 0 24 24"><path d="${GLYPH[k] || GLYPH.generic}"/></svg>`; return el; };

const intake = { page: 'free', picked: null, day: 0 };

function setPage(p) {
  intake.page = p; intake.picked = null;
  $$('.page-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.page === p)));
  $('#pageFree').hidden = p !== 'free';
  $('#pageProg').hidden = p !== 'prog';
  $('#stepVideo').hidden = true;
  if (p === 'prog') renderProgPage(); else renderMoveGrid();
}
$$('.page-tab').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));

function renderMoveGrid() {
  $('#moveGrid').replaceChildren(...MOVE_CARDS.map(([k, label, sub]) => h('button', {
    type: 'button', class: `mv-card${intake.picked === k ? ' on' : ''}`, 'aria-pressed': String(intake.picked === k),
    onclick: () => {
      intake.picked = k;
      setMode('free'); setupState.day = ''; setupState.progName = '';
      state.nameTouched = false; $('#exName').value = k === 'auto' ? '' : PROFILES[k].defaultName;
      setProfile(k, { touched: true });
      renderMoveGrid(); showVideoStep(label);
    },
  }, glyph(k), h('b', {}, label), h('small', {}, sub))));
}

function renderProgPage() {
  const prog = store.activeProgram();
  const list = $('#progList'), chips = $('#dayChips');
  if (!prog || !prog.days.length) {
    chips.replaceChildren();
    list.replaceChildren(h('div', { class: 'empty-card' }, h('b', {}, 'Nessuna scheda in uso'), h('p', { class: 'muted' }, 'Crea o incolla la tua scheda nella sezione Schede: poi qui scegli l\'esercizio e il video finisce nella serie giusta.'),
      h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => $('#tabbar button[data-view="prog"]').click() }, 'Vai alle Schede')));
    return;
  }
  const W = store.getActive();
  if (W && W.programId === prog.id && !intake.dayTouched) { const di = prog.days.findIndex((d) => d.id === W.dayId); if (di >= 0) intake.day = di; }
  intake.day = Math.min(intake.day, prog.days.length - 1);
  chips.replaceChildren(...prog.days.map((d, i) => h('button', { type: 'button', class: 'chip-btn', 'aria-pressed': String(i === intake.day), onclick: () => { intake.day = i; intake.dayTouched = true; intake.picked = null; $('#stepVideo').hidden = true; renderProgPage(); } }, d.name)));
  const day = prog.days[intake.day];
  list.replaceChildren(...day.exercises.map((e, i) => {
    const k = profileFor(e.name);
    const sel = h('select', { class: 'mv-select', 'aria-label': `Movimento di ${e.name}`, onclick: (ev) => ev.stopPropagation(), onchange: (ev) => {
      rememberProfile(e.name, ev.target.value); toast(`«${e.name}» ora si analizza come ${autoLabel(ev.target.value)} ✓`, 'ok');
      if (intake.picked === i) setProfile(ev.target.value, { touched: true });
      renderProgPage();
    } }, h('option', { value: 'auto' }, 'Automatico'), ...Object.keys(PROFILES).map((p) => h('option', { value: p, selected: p === k }, autoLabel(p))));
    if (k === 'auto') sel.value = 'auto';
    const done = W ? (W.exercises.find((x) => exKey(x.name) === exKey(e.name))?.sets || []).filter((x) => x.done && x.type !== 'warmup').length : 0;
    return h('div', { class: `px-card${intake.picked === i ? ' on' : ''}`, role: 'button', tabindex: '0', onclick: () => pickFromProg(prog, intake.day, i), onkeydown: (ev) => { if (ev.key === 'Enter') pickFromProg(prog, intake.day, i); } },
      glyph(k === 'auto' ? 'auto' : k),
      h('span', { class: 'px-t' }, h('b', {}, e.name), h('small', {}, `${e.sets} × ${e.repMin === e.repMax ? e.repMin : `${e.repMin}-${e.repMax}`}${done ? ` · ${done} serie fatte oggi` : ''}`)),
      h('label', { class: 'px-mv' }, h('span', {}, 'Analizza come'), sel));
  }));
}

function pickFromProg(prog, di, ei) {
  intake.picked = ei;
  setMode('prog');
  $('#progDay').value = String(di); fillProgExercises();
  $('#progEx').value = String(ei);
  pickProgExercise();
  renderProgPage();
  const ex = prog.days[di].exercises[ei];
  showVideoStep(`${ex.name} · ${autoLabel(profileFor(ex.name))}`);
}

function showVideoStep(label) {
  $('#pickedLabel').textContent = label;
  $('#stepVideo').hidden = false;
  $('#stepVideo').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
}

function updateSummary() {
  const k = $('#profile').value;
  const name = $('#exName').value.trim();
  const mv = k === 'auto' ? 'riconoscimento automatico' : autoLabel(k);
  $('#setupSummary').replaceChildren(...[
    h('span', { class: 'sum-tag' }, setupState.mode === 'prog' ? `Scheda · ${setupState.day}` : 'Prova libera'),
    h('b', {}, setupState.mode === 'prog' ? name : mv),
    setupState.mode === 'prog' ? h('small', {}, ` analizzato come ${mv}`) : null,
    h('button', { type: 'button', class: 'link-btn', onclick: backToIntake }, 'Cambia esercizio')].filter(Boolean));
}

function backToIntake() {
  video.pause();
  ['#setup', '#player', '#report', '#dock'].forEach((sel) => { $(sel).hidden = true; });
  $('#intake').hidden = false;
  setPage(setupState.mode === 'prog' ? 'prog' : 'free');
  window.scrollTo({ top: 0 });
}

$('#btnRecord').addEventListener('click', async () => {
  const res = await openRecorder({ title: $('#pickedLabel').textContent });
  if (!res) return;
  if (res.error) { toast(res.error, 'error', 6000); return; }
  await loadVideo(res.file);
  toast('Video pronto: tocca «Analizza il video»', 'ok');
});

$('#btnLogSet').addEventListener('click', () => {
  const a = state.analysis;
  if (!a || !a.summary.total) return;
  if (state.loggedFor === a) { $('#tabbar button[data-view="train"]').click(); return; }
  const st = readSetup();
  const prog = setupState.mode === 'prog' ? store.activeProgram() : null;
  const day = prog ? prog.days.find((d) => d.name === setupState.day) : null;
  const res = logVideoSet({ name: st.exercise, kg: st.load, reps: a.summary.total, valid: a.summary.valid, vel: a.summary.velMean, profile: a.meta.profile, program: prog, day });
  const msg = `${res.started ? 'Allenamento avviato · ' : ''}Serie ${res.setNo} di ${st.exercise}: ${st.load || 0} kg × ${a.summary.total} ✓`;
  toast(msg, 'ok', 5000);
  state.loggedFor = a;
  $('#btnLogSet').textContent = 'Segnata ✓ — vai all\'allenamento';
});

$('#btnShareImg').addEventListener('click', async () => {
  if (!state.analysis) return;
  try {
    const blob = await renderSetImage({ setup: readSetup(), analysis: state.analysis, label: autoLabel(state.analysis.meta.profile) });
    await shareBlob(`fulcro_${localDate()}.png`, blob, 'La mia serie su Fulcro');
  } catch (e) { toast(`Immagine non creata: ${e.message}`, 'error'); }
});

renderMoveGrid();

// Movimenti che si somigliano abbastanza da non meritare un avviso
const NEAR = [['squat', 'knee_press'], ['rdl', 'deadlift'], ['press_v', 'pull_v'], ['curl', 'triceps']];
const near = (a, b) => NEAR.some((g) => g.includes(a) && g.includes(b));

function renderDetect() {
  const box = $('#detectBox');
  const det = state.detected;
  const choice = $('#profile').value;
  const used = state.analysis.meta.profile;
  if (!det) { box.hidden = true; return; }
  const chip = (k, primary = false) => h('button', { type: 'button', class: `chip-btn${primary ? ' chip-primary' : ''}`, onclick: () => chooseProfileFromReport(k) }, primary ? `Rianalizza come ${autoLabel(k)}` : autoLabel(k));
  const others = h('select', { class: 'detect-select', 'aria-label': 'Altro movimento', onchange: (e) => { if (e.target.value) chooseProfileFromReport(e.target.value); } },
    h('option', { value: '' }, 'Altro…'),
    ...Object.keys(PROFILES).filter((k) => k !== used).map((k) => h('option', { value: k }, PROFILES[k].label)));
  let title, text, chips, level = 'info';
  if (choice === 'auto') {
    const unsure = det.profile === 'generic';
    title = unsure ? 'Non sono sicuro di che esercizio sia' : `Riconosciuto: ${autoLabel(det.profile)}`;
    text = unsure ? `Ho contato le rep in modo generico (${det.why}). Dimmi tu cos'è e rifaccio i calcoli:` : `Sicurezza ${det.confidence} — ${det.why}. Non è giusto? Tocca quello corretto:`;
    chips = [...['squat', 'rdl', 'deadlift', 'bench', 'press_v'].filter((k) => k !== det.profile).slice(0, 4).map((k) => chip(k)), others];
    level = unsure ? 'warn' : 'info';
  } else if (det.profile !== 'generic' && det.profile !== used && !near(det.profile, used) && det.confidence !== 'bassa') {
    title = `Hai scelto ${autoLabel(used)}, ma sembra ${/^[aeiou]/i.test(autoLabel(det.profile)) ? 'un' : 'uno'} ${autoLabel(det.profile)}`;
    text = `Nel video ${det.why}. Se hai ragione tu ignora questo avviso.`;
    chips = [chip(det.profile, true), others];
    level = 'warn';
  } else {
    title = `Analizzato come ${autoLabel(used)}`;
    text = 'Scelto da te.';
    chips = [others];
  }
  box.dataset.level = level;
  box.replaceChildren(h('div', { class: 'detect-head' }, h('b', {}, title), h('span', {}, text)), h('div', { class: 'chips-wrap' }, ...chips));
  box.hidden = false;
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
const HUD_PRESET = { essential: ['segments', 'trail', 'bar'], full: LAYERS.map((l) => l.key) };
function applyHudMode(mode) {
  const on = HUD_PRESET[mode] || HUD_PRESET.essential;
  LAYERS.forEach((l) => hud.setLayer(l.key, on.includes(l.key)));
  $$('#layerChips input').forEach((el, i) => { el.checked = on.includes(LAYERS[i].key); });
  lsSet('fulcro.hudMode', mode);
}
$$('input[name="hudmode"]').forEach((el) => el.addEventListener('change', () => applyHudMode(el.value)));
$('#layerChips').replaceChildren(...LAYERS.map((l) => h('label', {},
  h('input', { type: 'checkbox', checked: true, onchange: (e) => hud.setLayer(l.key, e.target.checked) }),
  h('span', {}, l.label),
)));
{
  const m = lsGet('fulcro.hudMode', 'essential');
  const el = $(`input[name="hudmode"][value="${m}"]`); if (el) el.checked = true;
  applyHudMode(m);
}

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
  else if (sheets.isConfigured()) text = 'Sheets non connesso';
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
    case 'CONFIG': return 'Collega il foglio nelle impostazioni (URL dello script)';
    case 'KEY': return 'Parola segreta diversa da quella nello script';
    case 'ACCESS': return 'Accesso al foglio negato: controlla URL e permessi';
    default: return (err && err.message) || 'Invio non riuscito';
  }
}

async function sendRecord(auto = false) {
  const rec = state.record;
  if (!rec || rec.sync === 'saved') return;
  if (!sheets.isConfigured()) {
    if (!auto) { toast('Prima collega il foglio Google nelle impostazioni.', 'error'); openSettings(); }
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

$('#btnExport').addEventListener('click', async () => {
  if (!state.raw) return;
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const data = {
    app: 'fulcro', v: 1, ...state.rawMeta, setup: readSetup(), trim: state.trim,
    raw: state.raw.map((f) => (f ? f.map((l) => [r4(l[0]), r4(l[1]), Math.round(l[2] * 100) / 100]) : null)),
  };
  try {
    const ok = await saveTextFile(`fulcro_${localDate()}_${readSetup().exercise.replace(/[^\w-]+/g, '_')}.json`, JSON.stringify(data));
    if (ok) toast('Analisi esportata: ricaricandola non rifai la pre-analisi.', 'ok');
  } catch (e) { toast(`Esportazione non riuscita: ${e.message}`, 'error'); }
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
  $('#setHeight').value = getHeight() || '';
  $('#setScriptUrl').value = s.scriptUrl;
  $('#setScriptKey').value = s.scriptKey;
  $('#oauthBox').hidden = sheets.isNativeApp();
  $('#oauthBox').open = !s.scriptUrl && !!s.clientId;
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
    scriptUrl: $('#setScriptUrl').value, scriptKey: $('#setScriptKey').value,
    autoSync: $('#setAuto').checked, weekly: $('#setWeekly').checked, geminiKey: $('#setGemini').value,
  };
}
dlg.addEventListener('close', () => {
  if (dlg.returnValue === 'save') {
    sheets.saveSettings(readSettingsForm());
    const hv = Number($('#setHeight').value);
    if (hv >= 120 && hv <= 230) { if (hv !== getHeight()) { setHeight(hv); if (state.raw) recompute(false); } }
    toast('Impostazioni salvate', 'ok');
    updateBadge();
    if (state.analysis) $('#btnAi').hidden = !(sheets.getSettings().geminiKey && state.analysis.summary.total);
  }
  dlg.returnValue = '';
});

$('#btnConnect').addEventListener('click', async () => {
  const msg = $('#connectMsg');
  const f = readSettingsForm();
  const viaScript = !!f.scriptUrl.trim() || sheets.isNativeApp();
  if (viaScript && !sheets.isScriptUrl(f.scriptUrl)) { msg.textContent = 'L\'URL dello script non è valido: deve iniziare con https://script.google.com/ e finire con /exec.'; return; }
  if (!viaScript && !sheets.parseSpreadsheetId(f.sheetUrl)) { msg.textContent = 'Incolla l\'URL dello script (consigliato) oppure, nel metodo vecchio, l\'URL completo del foglio.'; return; }
  sheets.saveSettings(f);
  msg.textContent = viaScript ? 'Contatto lo script del foglio…' : 'Apro l\'autorizzazione Google…';
  try {
    await sheets.connect({ interactive: true });
    msg.textContent = 'Collegato. Controllo il foglio…';
    await sheets.ensureSheetReady(true);
    msg.textContent = 'Pronto: foglio «Log_Allenamenti» verificato e intestazione presente ✓';
    updateBadge();
    const q = sheets.getQueue();
    if (q.length) { const ids = await sheets.flush({ interactive: true }); if (ids.length) { state.lastSaved = true; markSaved(ids); renderSession(); updateDock(); updateBadge(); } }
  } catch (e) {
    msg.textContent = explain(e);
  }
});

$('#btnCopyScript').addEventListener('click', async () => {
  try {
    const code = await (await fetch('apps-script/Code.gs', { cache: 'no-cache' })).text();
    const ok = await sheets.copyText(code);
    $('#connectMsg').textContent = ok ? 'Script copiato ✓ Ora incollalo in Estensioni → Apps Script del tuo foglio.' : 'Copia non riuscita: apri il file apps-script/Code.gs dal repository.';
  } catch { $('#connectMsg').textContent = 'Script non raggiungibile offline: apri apps-script/Code.gs dal repository.'; }
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

window.fulcroTech = {
  prefill({ exercise, load, fromProgram }) {
    applySetup({ exercise, load: load || 0, profile: profileFor(exercise) });
    setupState.profileTouched = false;
    const prog = fromProgram ? store.activeProgram() : null;
    const di = prog ? prog.days.findIndex((d) => d.exercises.some((e) => exKey(e.name) === exKey(exercise))) : -1;
    if (di >= 0) {
      setMode('prog');
      $('#progDay').value = String(di); fillProgExercises();
      $('#progEx').value = String(prog.days[di].exercises.findIndex((e) => exKey(e.name) === exKey(exercise)));
      setupState.progName = prog.name; setupState.day = prog.days[di].name;
    } else { setupState.day = ''; setupState.progName = ''; setMode('free'); }
    if (di >= 0) { setPage('prog'); intake.day = di; intake.dayTouched = true; pickFromProg(prog, di, prog.days[di].exercises.findIndex((e) => exKey(e.name) === exKey(exercise))); }
    updateSummary();
    onMetaChange();
  },
};
renderSession();
updateBadge();

if ('serviceWorker' in navigator && location.protocol.startsWith('http') && !isNative()) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW non registrato', e)));
}
