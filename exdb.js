// exdb.js — libreria esercizi (free-exercise-db, pubblico dominio) caricata solo quando serve.
// Il service worker la mette in cache: dopo il primo caricamento funziona anche offline.

import { searchDb, autoMatch, norm, exKey } from './training.js';
import { getLink } from './store.js';

const BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/dist/';
let db = null;
let loading = null;
let failed = null;

export const imgUrl = (p) => `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/${String(p).split('/').map(encodeURIComponent).join('/')}`;
export const getDb = () => db;
export const dbError = () => failed;

export function loadDb() {
  if (db) return Promise.resolve(db);
  if (loading) return loading;
  loading = fetch(`${BASE}exercises.json`)
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((arr) => {
      if (!Array.isArray(arr)) throw new Error('formato inatteso');
      db = arr.filter((e) => e && typeof e.name === 'string' && typeof e.id === 'string').map((e) => ({
        id: e.id, n: e.name, m: e.primaryMuscles || [], s: e.secondaryMuscles || [], e: e.equipment || '',
        lv: e.level || '', c: e.category || '', ins: Array.isArray(e.instructions) ? e.instructions : [],
        im: Array.isArray(e.images) ? e.images : [],
      }));
      failed = null;
      return db;
    })
    .catch((e) => { failed = e; loading = null; throw e; });
  return loading;
}

export const byId = (id) => (db ? db.find((x) => x.id === id) || null : null);

/** Esercizio collegato a un nome: scelta dell'utente, altrimenti corrispondenza automatica molto sicura. */
export function resolve(name, dbId) {
  if (!db) return { ex: null, auto: false };
  const id = dbId || getLink(exKey(name));
  if (id) { const ex = byId(id); if (ex) return { ex, auto: false }; }
  const ex = autoMatch(db, name);
  return { ex, auto: !!ex };
}

export const search = (q, limit) => (db ? searchDb(db, q, limit) : []);
export { norm };
