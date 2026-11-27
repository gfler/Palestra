// viewTrain.js — schermata «Allenamento»: avvio da scheda, registro serie, timer di recupero, riepilogo con record.

import { $, h, icon, toast, uid, openSheet, confirmTap, fmtDay, fmtDayLong, fmtClock, fmtDuration, mmss, fmtNum, explainErr } from './dom.js';
import * as store from './store.js';
import {
  exKey, exerciseHistory, records, newRecords, suggest, est1RM, isWorking, workoutVolume, workoutSets, fmtKg, fmtRest, parseRest,
} from './training.js';
import { openExercise, pickExercise, analyze } from './exDetail.js';
import { thumb } from './exDetail.js';
import * as sheets from './sheetsSync.js';
import * as C from './coach.js';
import { openCoach } from './viewCoach.js';
import { resolve } from './exdb.js';

const deloadOn = () => { try { return localStorage.getItem('fulcro.deload') === '1'; } catch { return false; } };
const setDeload = (v) => { try { localStorage.setItem('fulcro.deload', v ? '1' : '0'); } catch { /* ignora */ } };

const root = () => $('#v-train');
let goProg = () => {};
export const setGoPrograms = (fn) => { goProg = fn; };

/* ------------------------------------------------------------------ */
/* Suono, vibrazione, schermo acceso                                    */
/* ------------------------------------------------------------------ */

let audio = null;
function ensureAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}
function beep() {
  if (!audio) return;
  [0, 0.28].forEach((d) => {
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, audio.currentTime + d);
    g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + d + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + d + 0.22);
    o.connect(g).connect(audio.destination);
    o.start(audio.currentTime + d); o.stop(audio.currentTime + d + 0.25);
  });
}

let wake = null;
async function holdScreen() {
  try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch { wake = null; }
}
function releaseScreen() { try { if (wake) wake.release(); } catch { /* ignora */ } wake = null; }

/* ------------------------------------------------------------------ */
/* Timer di recupero (basato su orario assoluto: resiste a blocco schermo e ricarica) */
/* ------------------------------------------------------------------ */

let restBar = null, tickId = null, firedFor = 0;

function ensureRestBar() {
  if (restBar) return restBar;
  restBar = h('div', { class: 'restbar', id: 'restbar', hidden: true, role: 'timer', 'aria-live': 'off' },
    h('div', { class: 'rest-main' },
      h('span', { class: 'rest-label' }, 'Recupero'),
      h('b', { class: 'rest-time' }, '0:00')),
    h('div', { class: 'rest-track' }, h('i', {})),
    h('div', { class: 'rest-btns' },
      h('button', { type: 'button', class: 'chip-btn', onclick: () => adjustRest(-15) }, '−15"'),
      h('button', { type: 'button', class: 'chip-btn', onclick: () => adjustRest(15) }, '+15"'),
      h('button', { type: 'button', class: 'chip-btn chip-ghost', onclick: () => stopRest() }, 'Salta')));
  document.body.append(restBar);
  return restBar;
}

function startRest(sec, label) {
  const W = store.getActive();
  if (!W || !sec) return;
  W.rest = { endsAt: Date.now() + sec * 1000, total: sec, label };
  store.saveActive();
  firedFor = 0;
  runTick();
}
function adjustRest(delta) {
  const W = store.getActive();
  if (!W || !W.rest) return;
  W.rest.endsAt += delta * 1000; W.rest.total = Math.max(1, W.rest.total + delta); firedFor = 0;
  store.saveActive(); runTick();
}
function stopRest() {
  const W = store.getActive();
  if (W) { delete W.rest; store.saveActive(); }
  runTick();
}
function runTick() {
  clearInterval(tickId);
  tick();
  const W = store.getActive();
  if (W && W.rest) tickId = setInterval(tick, 250);
}
function tick() {
  const bar = ensureRestBar();
  const W = store.getActive();
  if (!W || !W.rest) { bar.hidden = true; clearInterval(tickId); return; }
  const left = (W.rest.endsAt - Date.now()) / 1000;
  bar.hidden = false;
  if (left > 0) {
    bar.dataset.state = 'run';
    bar.querySelector('.rest-label').textContent = W.rest.label || 'Recupero';
    bar.querySelector('.rest-time').textContent = mmss(Math.ceil(left));
    bar.querySelector('.rest-track i').style.width = `${Math.max(0, Math.min(100, (1 - left / W.rest.total) * 100))}%`;
    return;
  }
  bar.dataset.state = 'done';
  bar.querySelector('.rest-label').textContent = 'Recupero finito — via!';
  bar.querySelector('.rest-time').textContent = '0:00';
  bar.querySelector('.rest-track i').style.width = '100%';
  if (firedFor !== W.rest.endsAt) {
    firedFor = W.rest.endsAt;
    beep();
    try { navigator.vibrate && navigator.vibrate([220, 90, 220]); } catch { /* non supportato */ }
  }
  if (left < -8) { delete W.rest; store.saveActive(); bar.hidden = true; clearInterval(tickId); }
}

/* ------------------------------------------------------------------ */
/* Costruzione di un allenamento dalla scheda                           */
/* ------------------------------------------------------------------ */

const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

export function planExercise(pe, deload = false) {
  const key = exKey(pe.name);
  const last = exerciseHistory(store.getWorkouts(), key).at(-1) || null;
  const target = { sets: pe.sets, repMin: pe.repMin, repMax: pe.repMax, rir: pe.rir };
  const sug = suggest(target, last, store.getInc());
  const nSets = deload ? C.deloadSets(pe.sets) : pe.sets;
  const sets = Array.from({ length: nSets }, (_, i) => {
    let kg = null, reps = null;
    if (last) {
      kg = sug.kg ?? null;
      if (sug.kind === 'keep') reps = sug.reps[i] ?? sug.reps.at(-1);
      else if (sug.kind === 'up') reps = pe.repMin;
      else reps = Math.max(pe.repMin, Math.round(avg(last.sets.map((s) => s.reps))));
    } else {
      kg = pe.refKg; reps = (pe.refReps && (pe.refReps[i] ?? pe.refReps.at(-1))) || null;
    }
    return { type: 'normal', kg: deload ? C.deloadKg(kg) : kg, reps, rir: null, done: false, ts: null };
  });
  return {
    name: pe.name, dbId: pe.dbId || null, restSec: pe.restSec, note: '', target, link: !!pe.link,
    hint: deload ? 'Scarico: una serie in meno e carico −10%. Resta lontano dal cedimento.' : (last ? sug.text : ''),
    refText: !last ? (pe.ref || pe.note || '') : '', sets,
  };
}

export function startWorkout(program, day, { deload = false } = {}) {
  const W = {
    id: uid(), programId: program ? program.id : null, programName: program ? program.name : '',
    dayId: day ? day.id : null, dayName: day ? `${day.name}${deload ? ' (scarico)' : ''}` : 'Allenamento libero',
    startedAt: new Date().toISOString(), endedAt: null, note: '',
    exercises: day ? day.exercises.map((e) => planExercise(e, deload)) : [], prep: { warm: [], cool: [] },
  };
  store.setActive(W); store.saveActive();
  holdScreen();
  render();
  window.scrollTo({ top: 0 });
}

/* ------------------------------------------------------------------ */
/* Righe per Google Sheets                                              */
/* ------------------------------------------------------------------ */

export function rowsFor(w) {
  const d = new Date(w.startedAt);
  const date = d.toLocaleDateString('sv-SE'), time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  const TYPE = { normal: 'Normale', warmup: 'Riscaldamento', drop: 'Drop set', failure: 'Cedimento' };
  const rows = [];
  for (const ex of w.exercises) {
    let n = 0;
    ex.sets.filter((s) => s.done).forEach((s, i) => {
      n++;
      const e = est1RM(s.kg, s.reps);
      rows.push([date, time, w.programName, w.dayName, ex.name, n, TYPE[s.type] || 'Normale', s.kg ?? '', s.reps ?? '', s.rir ?? '', ex.restSec, i === 0 ? ex.note : '', s.type === 'warmup' || e == null ? '' : Math.round(e * 10) / 10]);
    });
  }
  return rows;
}

async function pushToSheets({ interactive = true } = {}) {
  try {
    const ids = await sheets.flushTraining({ interactive });
    return { ok: true, n: ids.length };
  } catch (e) { return { ok: false, error: e }; }
}

/* ------------------------------------------------------------------ */
/* Home (nessun allenamento in corso)                                   */
/* ------------------------------------------------------------------ */

function weekStart(d = new Date()) {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function weekStrip(workouts) {
  const m0 = weekStart().getTime();
  const trained = new Set(workouts.map((w) => new Date(w.startedAt).toLocaleDateString('sv-SE')));
  const today = new Date().toLocaleDateString('sv-SE');
  return h('div', { class: 'week', role: 'img', 'aria-label': 'Allenamenti di questa settimana' },
    ['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((l, i) => {
      const day = new Date(m0 + i * 86400000);
      const key = day.toLocaleDateString('sv-SE');
      return h('span', { class: `week-d${trained.has(key) ? ' on' : ''}${key === today ? ' today' : ''}` }, l, h('i', {}, trained.has(key) ? icon('check', 18) : null));
    }));
}

function renderHome() {
  const r = root();
  const prog = store.activeProgram();
  const workouts = store.getWorkouts();
  const ws = weekStart().getTime();
  const thisWeek = workouts.filter((w) => new Date(w.startedAt).getTime() >= ws);
  const nodes = [];

  nodes.push(h('section', { class: 'hero' },
    h('h1', { class: 'headline' }, workouts.length ? 'Oggi si carica.' : 'Il tuo diario di forza.'),
    h('p', { class: 'lede' }, workouts.length
      ? `${thisWeek.length} ${thisWeek.length === 1 ? 'allenamento' : 'allenamenti'} questa settimana · ${fmtNum(thisWeek.reduce((a, w) => a + workoutVolume(w), 0))} kg di volume.`
      : 'Inserisci la tua scheda, registra serie e recuperi, guarda i progressi nel tempo.')));
  if (workouts.length) nodes.push(weekStrip(workouts));

  if (!prog) {
    nodes.push(h('section', { class: 'card empty' },
      h('h2', {}, 'Parti dalla tua scheda'),
      h('p', { class: 'muted' }, 'Incolla la scheda che hai già (anche da Hevy) oppure creala a mano. Potrai cambiarla quando vuoi: lo storico resta.'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => goProg() }, 'Crea la scheda')));
  } else {
    const lastDayId = workouts.filter((w) => w.programId === prog.id).at(-1)?.dayId;
    const idx = prog.days.findIndex((d) => d.id === lastDayId);
    const nextIdx = prog.days.length ? (idx + 1) % prog.days.length : -1;
    nodes.push(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, prog.name), h('button', { class: 'link-btn', type: 'button', onclick: () => goProg() }, 'Gestisci')),
      prog.days.length ? h('div', { class: 'day-list' }, prog.days.map((d, i) => {
        const last = workouts.filter((w) => w.dayId === d.id).at(-1);
        return h('button', { class: `day-btn${i === nextIdx ? ' next' : ''}`, type: 'button', onclick: () => startWorkout(prog, d, { deload: deloadOn() }) },
          h('span', { class: 'day-t' }, i === nextIdx ? h('em', { class: 'next-tag' }, 'Prossimo') : null, h('b', {}, d.name), h('small', {}, i === nextIdx ? `${d.exercises.slice(0, 3).map((e) => e.name).join(' · ')}${d.exercises.length > 3 ? ` · +${d.exercises.length - 3}` : ''}` : `${d.exercises.length} esercizi${last ? ` · ultima volta ${fmtDay(last.startedAt)}` : ''}`)),
          icon('play', 22));
      })) : h('p', { class: 'muted' }, 'Questa scheda non ha ancora giorni: aggiungili da «Gestisci».'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => startWorkout(null, null) }, 'Allenamento libero')));
  }

  if (prog) {
    const dl = C.deloadAdvice(workouts, prog);
    const on = deloadOn();
    if (dl.due || on) {
      nodes.push(h('section', { class: `card${on ? ' deload-on' : ''}` },
        h('h2', {}, on ? 'Settimana di scarico attiva' : 'Valuta una settimana di scarico'),
        h('p', { class: 'muted' }, on ? 'Gli allenamenti partono con una serie in meno e carichi −10%. Quando hai finito, torna alla normalità.' : dl.text),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { setDeload(!on); render(); } }, on ? 'Torna al carico normale' : 'Attiva la settimana di scarico')));
    }
    nodes.push(h('section', { class: 'card coach-card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Il tuo coach')),
      h('p', { class: 'muted' }, 'Riscaldamento e defaticamento per la seduta, e consigli su quanto caricare.'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openCoach({ tab: 'warm' }) }, 'Riscaldamento'),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => openCoach({ tab: 'adv' }) }, 'Come vado'))));
  }

  const q = sheets.getTrainQueue();
  if (sheets.isConfigured() && q.length) {
    const status = h('p', { class: 'muted', role: 'status' }, `${q.length} ${q.length === 1 ? 'allenamento' : 'allenamenti'} da inviare al foglio.`);
    nodes.push(h('section', { class: 'card' }, status,
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: async (e) => {
        e.currentTarget.disabled = true; status.textContent = 'Invio in corso…';
        const res = await pushToSheets({ interactive: true });
        if (res.ok) { toast('Allenamenti inviati a Google Sheets ✓', 'ok'); render(); } else { status.textContent = explainErr(res.error); e.currentTarget.disabled = false; }
      } }, 'Invia a Google Sheets')));
  }

  if (workouts.length) {
    nodes.push(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Ultimi allenamenti')),
      h('ul', { class: 'wo-list' }, workouts.slice(-8).reverse().map((w) => h('li', {},
        h('button', { type: 'button', class: 'wo-item', onclick: () => openWorkoutDetail(w) },
          h('span', { class: 'wo-d' }, h('b', {}, w.dayName), h('small', {}, `${fmtDayLong(w.startedAt)} · ${w.programName || 'libero'}`)),
          h('span', { class: 'wo-n' }, `${fmtNum(workoutVolume(w))} kg`, h('small', {}, `${workoutSets(w)} serie`)))))) ));
  }
  r.replaceChildren(...nodes);
}

export function openWorkoutDetail(w) {
  const del = h('button', { class: 'btn btn-ghost danger', type: 'button' }, 'Elimina allenamento');
  const sheet = openSheet({
    title: `${w.dayName} · ${fmtDay(w.startedAt)}`,
    content: [
      h('p', { class: 'muted' }, `${w.programName || 'Allenamento libero'} · ${w.endedAt ? fmtDuration((new Date(w.endedAt) - new Date(w.startedAt)) / 1000) : ''} · ${fmtNum(workoutVolume(w))} kg di volume`),
      ...w.exercises.map((e) => h('div', { class: 'detail-ex' }, h('b', {}, e.name),
        h('div', { class: 'detail-sets' }, e.sets.map((s) => h('span', { class: `set-chip${s.type !== 'normal' ? ' t-' + s.type : ''}` }, `${fmtKg(s.kg)}×${s.reps ?? '–'}${Number.isFinite(s.rir) ? ` @${s.rir}` : ''}`))),
        e.note ? h('p', { class: 'muted' }, e.note) : null)),
    ],
    foot: del,
  });
  confirmTap(del, 'Tocca di nuovo per eliminare', () => { store.deleteWorkout(w.id); sheet.close(); toast('Allenamento eliminato'); });
}

/* ------------------------------------------------------------------ */
/* Allenamento in corso                                                 */
/* ------------------------------------------------------------------ */

const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) ? x : null; };
let elapsedId = null;

function setLabel(ex, i) {
  const s = ex.sets[i];
  if (s.type === 'warmup') return 'R';
  if (s.type === 'drop') return 'D';
  if (s.type === 'failure') return 'F';
  return String(ex.sets.slice(0, i + 1).filter((x) => x.type !== 'warmup').length);
}

function renderActive() {
  const W = store.getActive();
  const r = root();
  const elapsed = h('b', { class: 'elapsed' }, '0 min');
  const bye = h('button', { class: 'link-btn danger', type: 'button' }, 'Scarta allenamento');
  confirmTap(bye, 'Tocca di nuovo per scartare', () => { store.setActive(null); releaseScreen(); runTick(); render(); toast('Allenamento scartato'); });

  const head = h('section', { class: 'card wo-head' },
    h('div', {}, h('h1', { class: 'wo-title' }, W.dayName), h('p', { class: 'muted' }, `${W.programName || 'Libero'} · `, elapsed)),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => openCoach({ tab: 'warm', sel: 'active' }) }, 'Coach'),
      h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: finishWorkout }, 'Termina')));

  const cards = W.exercises.map((ex, i) => exerciseCard(W, ex, i));
  const add = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => addExerciseSheet(W) }, icon('plus', 20), ' Aggiungi esercizio');
  r.replaceChildren(head, prepCard(W, 'warm'), ...cards, add, prepCard(W, 'cool'), h('div', { class: 'wo-foot' }, bye));
  markNow();

  clearInterval(elapsedId);
  const upd = () => { elapsed.textContent = fmtDuration((Date.now() - new Date(W.startedAt)) / 1000); };
  upd(); elapsedId = setInterval(upd, 20000);
}

function prepCard(W, kind) {
  W.prep = W.prep || { warm: [], cool: [] };
  const regions = C.regionsOf(W.exercises.map((e) => ({ name: e.name, muscles: (resolve(e.name, e.dbId).ex || {}).m || [] })));
  const items = kind === 'warm' ? C.generalWarmup(regions) : C.generalCooldown(regions);
  const done = W.prep[kind];
  const sum = h('span', {});
  const upd = () => { sum.textContent = `${done.length}/${items.length}`; };
  const rows = items.map((it, i) => {
    const b = h('button', { type: 'button', class: `prep-item${done.includes(i) ? ' on' : ''}`, 'aria-pressed': String(done.includes(i)), onclick: () => {
      const at = done.indexOf(i);
      if (at >= 0) done.splice(at, 1); else done.push(i);
      b.classList.toggle('on', at < 0); b.setAttribute('aria-pressed', String(at < 0)); store.saveActive(); upd();
    } }, h('span', { class: 'prep-ck' }, icon('check', 16)), h('span', { class: 'prep-t' }, h('b', {}, it.name), h('small', {}, it.detail)));
    return b;
  });
  upd();
  return h('details', { class: 'card prep' }, h('summary', {}, kind === 'warm' ? 'Riscaldamento ' : 'Defaticamento ', sum), ...rows);
}

function markNow() {
  const rows = [...document.querySelectorAll('#v-train .set-row')];
  rows.forEach((r) => r.classList.remove('now'));
  const next = rows.find((r) => !r.classList.contains('done') && r.dataset.type !== 'warmup') || rows.find((r) => !r.classList.contains('done'));
  if (next) next.classList.add('now');
}

function exerciseCard(W, ex, ei) {
  const prevLinked = ei > 0 && W.exercises[ei - 1].link;
  const nextEx = W.exercises[ei + 1];
  const card = h('section', { class: `card ex-card${ex.link && nextEx ? ' ss-start' : ''}${prevLinked ? ' ss-end' : ''}` });
  const body = h('div', { class: 'sets' });
  const refresh = () => card.classList.toggle('done', ex.sets.length > 0 && ex.sets.every((s) => s.done));

  const last = exerciseHistory(store.getWorkouts(), exKey(ex.name)).at(-1);
  const lastLine = last ? `Ultima volta (${fmtDay(last.date)}): ${last.sets.map((s) => `${fmtKg(s.kg)}×${s.reps}`).join(' · ')}` : '';

  const restChip = h('button', { class: 'chip-btn', type: 'button', onclick: () => restSheet(ex, restChip) }, icon('timer', 16), ` ${fmtRest(ex.restSec)}`);

  const head = h('div', { class: 'ex-head' },
    h('button', { class: 'ex-title', type: 'button', onclick: () => openExercise(ex.name, { dbId: ex.dbId, kg: ex.sets.find((s) => s.kg)?.kg ?? null }) },
      thumb(ex.name, ex.dbId),
      h('span', { class: 'ex-name' }, h('b', {}, ex.name),
        h('small', {}, `${ex.target.sets} × ${ex.target.repMin === ex.target.repMax ? ex.target.repMin : `${ex.target.repMin}-${ex.target.repMax}`}${ex.target.rir ? ` · RIR ${ex.target.rir}` : ''}`))),
    restChip);

  const rows = ex.sets.map((s, si) => setRow(W, ex, ei, s, si, refresh, rebuild));
  function rebuild() { body.replaceChildren(...ex.sets.map((s, si) => setRow(W, ex, ei, s, si, refresh, rebuild))); refresh(); markNow(); }
  body.append(...rows);

  const noteBox = h('textarea', { class: 'ex-note', rows: '2', placeholder: 'Nota su questo esercizio (regolazioni, sensazioni…)', 'aria-label': `Nota ${ex.name}`, hidden: !ex.note, value: ex.note || '' });
  noteBox.addEventListener('input', () => { ex.note = noteBox.value.slice(0, 300); store.saveActive(); });
  const rm = h('button', { class: 'link-btn danger', type: 'button' }, 'Rimuovi');
  confirmTap(rm, 'Conferma', () => { W.exercises.splice(ei, 1); store.saveActive(); render(); });

  card.append(...[head,
    ex.link && nextEx ? h('p', { class: 'hint-ss' }, `Superset con «${nextEx.name}»: niente recupero fra i due.`) : null,
    C.plateau(exerciseHistory(store.getWorkouts(), exKey(ex.name))).stalled ? h('button', { class: 'chip-btn on', type: 'button', onclick: () => openCoach({ tab: 'adv', sel: 'active' }) }, 'Fermo da 4 sedute: idee') : null,
    ex.hint ? h('p', { class: 'hint-amber' }, icon('bolt', 16), ' ', ex.hint) : null,
    ex.refText ? h('p', { class: 'hint-ref' }, `Dalla scheda: ${ex.refText}`) : null,
    lastLine ? h('p', { class: 'muted small' }, lastLine) : null,
    h('div', { class: 'set-head' }, h('span', {}, 'Serie'), h('span', {}, 'kg'), h('span', {}, 'Rep'), h('span', {}, 'RIR'), h('span', {}, '')),
    body,
    h('div', { class: 'ex-actions' },
      h('button', { class: 'chip-btn', type: 'button', onclick: () => {
        const prev = ex.sets.at(-1);
        ex.sets.push({ type: 'normal', kg: prev ? prev.kg : null, reps: prev ? prev.reps : null, rir: null, done: false, ts: null });
        store.saveActive(); rebuild();
      } }, icon('plus', 16), ' Serie'),
      h('button', { class: 'chip-btn', type: 'button', onclick: () => { if (ex.sets.length > 1) { ex.sets.pop(); store.saveActive(); rebuild(); } } }, '− Serie'),
      h('button', { class: 'chip-btn', type: 'button', onclick: () => { noteBox.hidden = !noteBox.hidden; if (!noteBox.hidden) noteBox.focus(); } }, icon('edit', 16), ' Nota'),
      h('button', { class: 'chip-btn', type: 'button', onclick: () => {
        if (ex.sets.some((s) => s.type === 'warmup')) { toast('Le serie di riscaldamento ci sono già'); return; }
        const first = ex.sets.find((s) => s.kg > 0);
        const ramp = C.warmupRamp(first && first.kg);
        if (!ramp.length) { toast('Inserisci prima il carico di lavoro', 'error'); return; }
        ex.sets.unshift(...ramp.map((x) => ({ type: 'warmup', kg: x.kg, reps: x.reps, rir: null, done: false, ts: null })));
        store.saveActive(); rebuild();
      } }, icon('bolt', 16), ' Riscaldamento'),
      nextEx ? h('button', { class: `chip-btn${ex.link ? ' on' : ''}`, type: 'button', 'aria-pressed': String(!!ex.link), onclick: () => { ex.link = !ex.link; store.saveActive(); render(); } }, 'Superset') : null,
      h('button', { class: 'chip-btn', type: 'button', onclick: () => analyze({ name: ex.name, kg: ex.sets.find((s) => s.kg)?.kg ?? null, fromProgram: true }) }, icon('lens', 16), ' Tecnica'),
      rm),
    noteBox].filter(Boolean));
  refresh();
  return card;
}

function setRow(W, ex, ei, s, si, refresh, rebuild) {
  const row = h('div', { class: `set-row${s.done ? ' done' : ''}`, dataset: { type: s.type } });
  const typeBtn = h('button', { class: 'set-n', type: 'button', 'aria-label': `Tipo serie ${si + 1}: tocca per cambiare`, onclick: () => {
    const order = ['normal', 'warmup', 'drop', 'failure'];
    s.type = order[(order.indexOf(s.type) + 1) % order.length]; store.saveActive(); rebuild();
  } }, setLabel(ex, si));
  const kg = h('input', { class: 'in', type: 'text', inputmode: 'decimal', value: s.kg ?? '', placeholder: '0', 'aria-label': `Kg serie ${si + 1}`, autocomplete: 'off' });
  const reps = h('input', { class: 'in', type: 'text', inputmode: 'numeric', value: s.reps ?? '', placeholder: '0', 'aria-label': `Rep serie ${si + 1}`, autocomplete: 'off' });
  const rir = h('select', { class: 'in in-rir', 'aria-label': `RIR serie ${si + 1}` },
    h('option', { value: '' }, '–'), ...[0, 1, 2, 3, 4, 5].map((n) => h('option', { value: String(n), selected: s.rir === n }, String(n))));
  kg.addEventListener('input', () => { s.kg = num(kg.value); store.saveActive(); });
  reps.addEventListener('input', () => { s.reps = num(reps.value); store.saveActive(); });
  rir.addEventListener('change', () => { s.rir = rir.value === '' ? null : +rir.value; store.saveActive(); });
  const ok = h('button', { class: 'set-ok', type: 'button', 'aria-label': `Serie ${si + 1} fatta`, 'aria-pressed': String(!!s.done), onclick: () => {
    ensureAudio();
    if (!s.done) {
      s.kg = num(kg.value); s.reps = num(reps.value);
      if (s.reps == null || s.reps <= 0) { toast('Inserisci le ripetizioni fatte', 'error'); reps.focus(); return; }
      if (s.kg == null) { s.kg = 0; kg.value = '0'; }
      s.done = true; s.ts = new Date().toISOString();
      const next = ex.sets[si + 1];
      if (next && !next.done) {
        if (next.kg == null) next.kg = s.kg;
        if (next.reps == null) next.reps = s.reps;
      }
      store.saveActive();
      const isLast = si === ex.sets.length - 1 && ei === W.exercises.length - 1;
      const linkedFwd = ex.link && W.exercises[ei + 1];
      const pair = ei > 0 && W.exercises[ei - 1].link ? W.exercises[ei - 1] : null;
      if (!isLast && s.type !== 'warmup' && !linkedFwd) startRest(pair ? Math.max(pair.restSec, ex.restSec) : ex.restSec, pair ? `Superset: ${pair.name} + ${ex.name}` : ex.name);
      else if (s.type === 'warmup') startRest(Math.min(60, ex.restSec), `${ex.name} · riscaldamento`);
      rebuild();
    } else { s.done = false; store.saveActive(); rebuild(); }
  } }, icon('check', 22));
  row.append(typeBtn, kg, reps, rir, ok);
  return row;
}

function restSheet(ex, chip) {
  const sheet = openSheet({
    title: `Recupero · ${ex.name}`,
    content: h('div', { class: 'chips-wrap' }, [45, 60, 90, 120, 150, 180, 240, 300].map((sec) => h('button', {
      type: 'button', class: `chip-btn${ex.restSec === sec ? ' on' : ''}`, onclick: () => {
        ex.restSec = sec; store.saveActive(); chip.replaceChildren(icon('timer', 16), ` ${fmtRest(sec)}`); sheet.close();
      },
    }, fmtRest(sec)))),
  });
}

function addExerciseSheet(W) {
  const name = h('input', { type: 'text', class: 'pick-q', placeholder: 'Nome dell\'esercizio', autocomplete: 'off', 'aria-label': 'Nome esercizio' });
  const add = (n, dbId = null) => {
    const clean = String(n).trim().slice(0, 80);
    if (!clean) { name.focus(); return; }
    W.exercises.push(planExercise({ name: clean, dbId, sets: 3, repMin: 8, repMax: 12, rir: '', restSec: 120, ref: '', refKg: null, refReps: null }));
    store.saveActive(); sheet.close(); render();
  };
  const sheet = openSheet({
    title: 'Aggiungi esercizio',
    content: [name,
      h('button', { class: 'btn btn-primary', type: 'button', onclick: () => add(name.value) }, 'Aggiungi'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { sheet.close(); pickExercise({ query: name.value, onPick: (ex) => add(ex.n, ex.id) }); } }, icon('search', 20), ' Cerca nella libreria')],
  });
}

/* ------------------------------------------------------------------ */
/* Fine allenamento                                                     */
/* ------------------------------------------------------------------ */

async function finishWorkout() {
  const W = store.getActive();
  if (!W) return;
  // tiene solo ciò che è stato fatto
  const done = W.exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.done) })).filter((e) => e.sets.length);
  if (!done.length) { toast('Nessuna serie completata: segna con ✓ quelle fatte, oppure scarta l\'allenamento.', 'error', 5000); return; }

  const prs = [];
  for (const e of done) {
    const prev = records(exerciseHistory(store.getWorkouts(), exKey(e.name)));
    for (const r of newRecords(e.sets, prev)) prs.push({ name: e.name, ...r });
  }
  const w = { ...W, exercises: done, endedAt: new Date().toISOString() };
  delete w.rest;
  const saved = store.addWorkout(w);
  store.setActive(null); releaseScreen(); runTick(); clearInterval(elapsedId);

  const rows = rowsFor(saved);
  let syncText = '';
  const syncLine = h('p', { class: 'muted', role: 'status' }, '');
  if (sheets.isConfigured()) {
    sheets.enqueueWorkout(saved.id, rows);
    syncLine.textContent = 'Invio a Google Sheets…';
    pushToSheets({ interactive: true }).then((res) => {
      syncLine.textContent = res.ok ? 'Salvato su Google Sheets ✓' : `In coda: ${explainErr(res.error)}`;
      syncLine.dataset.ok = res.ok ? '1' : '';
    });
  } else syncText = 'Collega Google Sheets dalle impostazioni per avere il foglio con tutti gli allenamenti.';

  const nextUp = saved.exercises.map((e) => {
    const hist = exerciseHistory(store.getWorkouts(), exKey(e.name)).at(-1);
    const s = suggest(e.target, hist, store.getInc());
    return h('li', {}, h('b', {}, e.name), h('span', { class: 'muted' }, ` — ${s.text}`));
  });

  openSheet({
    title: 'Allenamento completato',
    content: [
      h('div', { class: 'kpis kpis-3' },
        h('div', { class: 'kpi' }, h('b', {}, fmtDuration((new Date(saved.endedAt) - new Date(saved.startedAt)) / 1000)), h('small', {}, 'durata')),
        h('div', { class: 'kpi' }, h('b', {}, fmtNum(workoutVolume(saved))), h('small', {}, 'kg di volume')),
        h('div', { class: 'kpi' }, h('b', {}, String(workoutSets(saved))), h('small', {}, 'serie utili'))),
      prs.length ? h('div', { class: 'pr-box' }, h('h3', {}, `${prs.length} ${prs.length === 1 ? 'record' : 'record'} nuovi`),
        h('ul', {}, prs.map((p) => h('li', {}, h('b', {}, p.name), ` — ${p.label}: ${p.type === 'reps' ? p.value : fmtKg(Math.round(p.value * 10) / 10)}${p.type === 'reps' ? ' rep' : p.type === 'vol' ? ' kg' : ' kg'}`)))) : null,
      h('h3', {}, 'Prossima volta'), h('ul', { class: 'next-list' }, nextUp),
      syncLine, syncText ? h('p', { class: 'hint' }, syncText) : null,
    ],
    foot: h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => e.currentTarget.closest('dialog').close() }, 'Fatto'),
    onClose: () => render(),
  });
  render();
}

/* ------------------------------------------------------------------ */
/* Avvio                                                                */
/* ------------------------------------------------------------------ */

export function render() {
  if (!root()) return;
  if (store.getActive()) renderActive(); else { clearInterval(elapsedId); renderHome(); }
}

export function initTrain() {
  ensureRestBar();
  render();
  if (store.getActive()) { holdScreen(); runTick(); }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && store.getActive()) { holdScreen(); tick(); }
  });
  window.addEventListener('online', () => {
    if (sheets.isConfigured() && sheets.getTrainQueue().length) pushToSheets({ interactive: false }).then((r) => { if (r.ok) { toast('Allenamenti inviati a Sheets ✓', 'ok'); if (!store.getActive()) render(); } });
  });
}

export { parseRest };
