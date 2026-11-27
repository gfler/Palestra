// store.js — dati di allenamento sul dispositivo (localStorage, versionati) + backup/ripristino.
// Modello: programmi (schede con giorni) → allenamenti (registro) ; lo storico si aggrega per NOME esercizio,
// così cambiare scheda dopo 8 settimane non interrompe i grafici.

import { uid } from './dom.js';

const KEY = 'fulcro.data';
const ACTIVE_KEY = 'fulcro.active';
const VERSION = 1;

const blank = () => ({ v: VERSION, programs: [], workouts: [], links: {}, prefs: { inc: 2.5 } });

const read = (k) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; }
};

/* ---------------------------- sanitizzazione ---------------------------- */

const str = (v, n = 120) => (typeof v === 'string' ? v.slice(0, n) : '');
const nnum = (v, min, max, def = null) => { if (v === null || v === undefined || v === '') return def; const x = Number(v); return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : def; };
const SET_TYPES = ['normal', 'warmup', 'drop', 'failure'];

function cleanProgEx(e) {
  if (!e || typeof e !== 'object') return null;
  const name = str(e.name, 80).trim();
  if (!name) return null;
  const repMin = nnum(e.repMin, 1, 200, 8);
  const repMax = nnum(e.repMax, 1, 200, repMin);
  return {
    id: str(e.id, 60) || uid(), name,
    sets: Math.round(nnum(e.sets, 1, 20, 3)), repMin: Math.min(repMin, repMax), repMax: Math.max(repMin, repMax),
    rir: str(e.rir, 6), restSec: Math.round(nnum(e.restSec, 0, 1800, 120)), note: str(e.note, 300), ref: str(e.ref, 300),
    refKg: nnum(e.refKg, 0, 1000, null),
    refReps: Array.isArray(e.refReps) ? e.refReps.slice(0, 20).map((x) => nnum(x, 0, 500, 0)) : null,
    dbId: str(e.dbId, 100) || null, link: !!e.link,
  };
}
function cleanProgram(p) {
  if (!p || typeof p !== 'object') return null;
  const days = (Array.isArray(p.days) ? p.days : []).slice(0, 14).map((d) => ({
    id: str(d && d.id, 60) || uid(), name: str(d && d.name, 60) || 'Giorno',
    exercises: (Array.isArray(d && d.exercises) ? d.exercises : []).slice(0, 40).map(cleanProgEx).filter(Boolean),
  }));
  return { id: str(p.id, 60) || uid(), name: str(p.name, 80) || 'Scheda', createdAt: str(p.createdAt, 40) || new Date().toISOString(), archivedAt: str(p.archivedAt, 40) || null, days };
}
function cleanSet(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    type: SET_TYPES.includes(s.type) ? s.type : 'normal',
    kg: nnum(s.kg, 0, 2000, null), reps: nnum(s.reps, 0, 1000, null), rir: nnum(s.rir, 0, 10, null),
    done: !!s.done, ts: str(s.ts, 40) || null,
    tech: s.tech && typeof s.tech === 'object' ? { total: nnum(s.tech.total, 0, 500, 0), valid: nnum(s.tech.valid, 0, 500, 0), vel: nnum(s.tech.vel, 0, 5, null), profile: str(s.tech.profile, 20) } : null,
  };
}
export function cleanWorkout(w) {
  if (!w || typeof w !== 'object') return null;
  const exercises = (Array.isArray(w.exercises) ? w.exercises : []).slice(0, 40).map((e) => {
    const name = str(e && e.name, 80).trim();
    if (!name) return null;
    const t = (e && e.target) || {};
    return {
      name, dbId: str(e.dbId, 100) || null, restSec: Math.round(nnum(e.restSec, 0, 1800, 120)), note: str(e.note, 300),
      hint: str(e.hint, 300), refText: str(e.refText, 300), link: !!e.link,
      target: { sets: Math.round(nnum(t.sets, 1, 20, 3)), repMin: nnum(t.repMin, 1, 200, 8), repMax: nnum(t.repMax, 1, 200, 12), rir: str(t.rir, 6) },
      sets: (Array.isArray(e.sets) ? e.sets : []).slice(0, 40).map(cleanSet).filter(Boolean),
    };
  }).filter(Boolean);
  const out = {
    id: str(w.id, 60) || uid(), programId: str(w.programId, 60) || null, programName: str(w.programName, 80),
    dayId: str(w.dayId, 60) || null, dayName: str(w.dayName, 60) || 'Allenamento',
    startedAt: str(w.startedAt, 40) || new Date().toISOString(), endedAt: str(w.endedAt, 40) || null, note: str(w.note, 500), exercises,
  };
  const pr = w.prep && typeof w.prep === 'object' ? w.prep : {};
  const idx = (a) => (Array.isArray(a) ? a.slice(0, 30).map((x) => Math.round(Number(x))).filter((x) => Number.isInteger(x) && x >= 0 && x < 30) : []);
  out.prep = { warm: idx(pr.warm), cool: idx(pr.cool) };
  const r = w.rest;
  if (r && typeof r === 'object' && Number.isFinite(+r.endsAt)) out.rest = { endsAt: +r.endsAt, total: nnum(r.total, 1, 3600, 60), label: str(r.label, 80) };
  return out;
}

export function sanitize(raw) {
  const d = blank();
  if (!raw || typeof raw !== 'object') return d;
  d.programs = (Array.isArray(raw.programs) ? raw.programs : []).slice(0, 200).map(cleanProgram).filter(Boolean);
  d.workouts = (Array.isArray(raw.workouts) ? raw.workouts : []).slice(0, 5000).map(cleanWorkout).filter((w) => w && w.endedAt);
  if (raw.links && typeof raw.links === 'object') {
    for (const [k, v] of Object.entries(raw.links).slice(0, 1000)) {
      if (typeof v === 'string' && k.length < 100 && k !== '__proto__') d.links[k] = v.slice(0, 100);
    }
  }
  if (raw.prefs && typeof raw.prefs === 'object') d.prefs.inc = nnum(raw.prefs.inc, 0.25, 20, 2.5);
  return d;
}

/* ------------------------------ stato ------------------------------ */

let data = sanitize(read(KEY));
let active = (() => { const a = read(ACTIVE_KEY); return a ? cleanWorkout(a) : null; })();
const subs = new Set();
const emit = () => subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });

export const subscribe = (fn) => { subs.add(fn); return () => subs.delete(fn); };
export const getData = () => data;
export const getPrograms = () => data.programs;
export const activeProgram = () => data.programs.filter((p) => !p.archivedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
export const getWorkouts = () => data.workouts;
export const getInc = () => data.prefs.inc;

/** Aggiorna i dati persistenti: `fn` muta l'oggetto, poi salva ed emette. */
export function update(fn) {
  fn(data);
  const ok = write(KEY, data);
  emit();
  return ok;
}

/* allenamento in corso: chiave separata, scritta a ogni tocco */
export const getActive = () => active;
export function setActive(w) {
  active = w || null;
  if (active) write(ACTIVE_KEY, active); else { try { localStorage.removeItem(ACTIVE_KEY); } catch { /* ignora */ } }
}
export const saveActive = () => { if (active) write(ACTIVE_KEY, active); };

/* ------------------------------ programmi ------------------------------ */

export function newProgram(name = 'Nuova scheda') {
  return { id: uid(), name, createdAt: new Date().toISOString(), archivedAt: null, days: [] };
}

/** Rende `id` la scheda in uso e archivia le altre: lo storico non viene toccato. */
export function useProgram(id) {
  update((d) => {
    const now = new Date().toISOString();
    for (const p of d.programs) {
      if (p.id === id) { p.archivedAt = null; p.createdAt = now; } else if (!p.archivedAt) p.archivedAt = now;
    }
  });
}

export function saveProgram(prog, { makeActive = false } = {}) {
  const clean = cleanProgram(prog);
  update((d) => {
    const i = d.programs.findIndex((p) => p.id === clean.id);
    if (i >= 0) d.programs[i] = clean; else d.programs.push(clean);
  });
  if (makeActive) useProgram(clean.id);
  return clean;
}

export const deleteProgram = (id) => update((d) => { d.programs = d.programs.filter((p) => p.id !== id); });
export const archiveProgram = (id) => update((d) => { const p = d.programs.find((x) => x.id === id); if (p) p.archivedAt = new Date().toISOString(); });

/* ------------------------------ allenamenti ------------------------------ */

export function addWorkout(w) {
  const clean = cleanWorkout(w);
  update((d) => { d.workouts.push(clean); d.workouts.sort((a, b) => a.startedAt.localeCompare(b.startedAt)); });
  return clean;
}
export const deleteWorkout = (id) => update((d) => { d.workouts = d.workouts.filter((w) => w.id !== id); });

export const setLink = (key, dbId) => update((d) => { if (dbId) d.links[key] = dbId; else delete d.links[key]; });
export const getLink = (key) => data.links[key] || null;
export const setInc = (v) => update((d) => { d.prefs.inc = nnum(v, 0.25, 20, 2.5); });

/* ------------------------------ backup ------------------------------ */

export function exportBackup() {
  return JSON.stringify({ app: 'fulcro-allenamento', exportedAt: new Date().toISOString(), data }, null, 1);
}

/** Unisce un backup ai dati attuali (per id): non cancella nulla. Ritorna i conteggi aggiunti. */
export function importBackup(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('File non valido: non è un JSON.'); }
  if (!raw || raw.app !== 'fulcro-allenamento' || !raw.data) throw new Error('Questo non sembra un backup di allenamenti Fulcro.');
  const inc = sanitize(raw.data);
  let np = 0, nw = 0;
  update((d) => {
    const pIds = new Set(d.programs.map((p) => p.id));
    for (const p of inc.programs) if (!pIds.has(p.id)) { d.programs.push(p); np++; }
    const wIds = new Set(d.workouts.map((w) => w.id));
    for (const w of inc.workouts) if (!wIds.has(w.id)) { d.workouts.push(w); nw++; }
    d.workouts.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    for (const [k, v] of Object.entries(inc.links)) if (!(k in d.links)) d.links[k] = v;
  });
  return { programs: np, workouts: nw };
}
