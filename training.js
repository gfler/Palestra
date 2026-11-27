// training.js — logica pura dell'allenamento (nessun DOM): lettura delle schede da testo,
// 1RM stimato, volume, record personali, suggerimenti di progressione, ricerca nel database esercizi.

/* ------------------------------------------------------------------ */
/* Normalizzazione                                                      */
/* ------------------------------------------------------------------ */

export const norm = (s) =>
  String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Chiave stabile di un esercizio: lo storico si aggrega per nome, non per programma. */
export const exKey = norm;

const num = (v) => Number(String(v).replace(',', '.'));

/* ------------------------------------------------------------------ */
/* Recupero: 3'  2'30"  90"  90s  2 min  2:30                           */
/* ------------------------------------------------------------------ */

export function parseRest(str) {
  const s = String(str || '').trim().toLowerCase().replace(/[’′‘`´]/g, "'").replace(/[″”“]/g, '"');
  let m;
  if ((m = s.match(/^(\d+)\s*'\s*(\d+)\s*"?$/))) return +m[1] * 60 + +m[2];
  if ((m = s.match(/^(\d+)\s*(?:'|min|m)\s*(?:(\d+)\s*(?:"|s|sec)?)?$/))) return +m[1] * 60 + (m[2] ? +m[2] : 0);
  if ((m = s.match(/^(\d+)\s*(?:"|s|sec|secondi)$/))) return +m[1];
  if ((m = s.match(/^(\d+):(\d{2})$/))) return +m[1] * 60 + +m[2];
  if ((m = s.match(/^(\d+)$/))) return +m[1] >= 10 ? +m[1] : +m[1] * 60;
  return null;
}

export function fmtRest(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '–';
  const m = Math.floor(sec / 60), s = sec % 60;
  if (!m) return `${s}"`;
  return s ? `${m}'${String(s).padStart(2, '0')}"` : `${m}'`;
}

/* ------------------------------------------------------------------ */
/* Lettura di una scheda da testo (formato tipo Hevy / tabella)         */
/* ------------------------------------------------------------------ */

const SETS_RE = /(?:^|\s)(\d{1,2})\s*[x×*]\s*(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?(?=\s|$)/i;

/** Una riga → esercizio, oppure null. */
export function parseExerciseLine(raw) {
  const line = String(raw).replace(/\t+/g, '  ').replace(/\|/g, ' ').trim();
  const m = SETS_RE.exec(line);
  if (!m) return null;
  let name = line.slice(0, m.index).replace(/^[\s\-•*·\d]+[.)]\s*/, '').replace(/^[\s\-•*·]+/, '').trim();
  if (!name || name.length < 2) return null;
  const sets = +m[1], repMin = +m[2], repMax = m[3] ? +m[3] : +m[2];
  let after = line.slice(m.index + m[0].length).trim();

  // RIR: "2", "1-2", "RIR 1-2"
  let rir = '';
  const r = /^(?:rir\s*)?(\d(?:\s*[-–]\s*\d)?)(?=\s|$)/i.exec(after);
  if (r) { rir = r[1].replace(/\s+/g, '').replace('–', '-'); after = after.slice(r[0].length).trim(); }

  // Recupero: primo token valido
  let restSec = null;
  const t = /^(\S+(?:\s*(?:min|sec|s)\b)?)/i.exec(after);
  if (t) {
    const v = parseRest(t[1].replace(/\s+/g, ''));
    if (v != null) { restSec = v; after = after.slice(t[0].length).trim(); }
  }

  // Riferimento: "Rif: 40 kg × 10/10/10 → ..." (opzionale)
  let ref = after.replace(/^rif(?:erimento)?\s*:?\s*/i, '').trim();
  let refKg = null, refReps = null;
  const k = /(\d+(?:[.,]\d+)?)\s*kg\s*[x×]\s*((?:\d+\s*\/\s*)*\d+)/i.exec(after);
  if (k) { refKg = num(k[1]); refReps = k[2].split('/').map((x) => +x.trim()); }

  return { name, sets, repMin: Math.min(repMin, repMax), repMax: Math.max(repMin, repMax), rir, restSec: restSec ?? 120, ref, refKg, refReps };
}

const HEADER_RE = /^(esercizio|exercise)\b.*(serie|set)/i;

/**
 * Testo → giorni. Le righe senza "serie × rep" brevi diventano intestazioni di giorno
 * (es. "Day A", "Giorno 2", "Push"). Se non ce ne sono, tutto va in un solo giorno.
 */
export function parseProgramText(text, defaultDay = 'Day A') {
  const days = [];
  const warnings = [];
  let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (HEADER_RE.test(line) || /^hevy$/i.test(line)) continue;
    const ex = parseExerciseLine(line);
    if (ex) {
      if (!cur) { cur = { name: defaultDay, exercises: [] }; days.push(cur); }
      cur.exercises.push(ex);
    } else if (line.length <= 40 && !/[×x]\s*\d/i.test(line)) {
      cur = { name: line.replace(/[:：]+$/, '').trim(), exercises: [] };
      days.push(cur);
    } else {
      warnings.push(line);
    }
  }
  return { days: days.filter((d) => d.exercises.length), warnings };
}

/* ------------------------------------------------------------------ */
/* Calcoli sulle serie                                                  */
/* ------------------------------------------------------------------ */

export const isWorking = (s) => s.done && s.type !== 'warmup' && Number.isFinite(s.kg) && Number.isFinite(s.reps) && s.reps > 0;

/** 1RM stimato (Epley); oltre 15 rep la stima non è affidabile. */
export function est1RM(kg, reps) {
  if (!Number.isFinite(kg) || !Number.isFinite(reps) || reps < 1 || reps > 15 || kg <= 0) return null;
  return reps === 1 ? kg : kg * (1 + reps / 30);
}

export const setVolume = (s) => (isWorking(s) ? s.kg * s.reps : 0);
export const workoutVolume = (w) => w.exercises.reduce((a, e) => a + e.sets.reduce((b, s) => b + setVolume(s), 0), 0);
export const workoutSets = (w) => w.exercises.reduce((a, e) => a + e.sets.filter(isWorking).length, 0);

/** Tutte le sessioni di un esercizio, dalla più vecchia: { date, workoutId, programId, sets } */
export function exerciseHistory(workouts, key) {
  const out = [];
  for (const w of workouts) {
    for (const e of w.exercises) {
      if (exKey(e.name) !== key) continue;
      const sets = e.sets.filter(isWorking);
      if (!sets.length) continue;
      const best = sets.reduce((b, s) => {
        const r = est1RM(s.kg, s.reps) ?? 0;
        return r > b.r ? { r, s } : b;
      }, { r: 0, s: sets[0] });
      out.push({
        date: w.startedAt, workoutId: w.id, programId: w.programId, programName: w.programName, sets,
        e1rm: best.r || null, topKg: Math.max(...sets.map((s) => s.kg)),
        volume: sets.reduce((a, s) => a + setVolume(s), 0),
        reps: sets.reduce((a, s) => a + s.reps, 0),
      });
    }
  }
  return out.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/** Record dell'esercizio sullo storico passato. */
export function records(history) {
  const r = { e1rm: 0, kg: 0, volumeSet: 0, repsAt: {} };
  for (const h of history) for (const s of h.sets) {
    r.e1rm = Math.max(r.e1rm, est1RM(s.kg, s.reps) || 0);
    r.kg = Math.max(r.kg, s.kg);
    r.volumeSet = Math.max(r.volumeSet, s.kg * s.reps);
    r.repsAt[s.kg] = Math.max(r.repsAt[s.kg] || 0, s.reps);
  }
  return r;
}

/** Record battuti da `sets` rispetto a `prev` (risultato di records()). */
export function newRecords(sets, prev) {
  const out = [];
  const work = sets.filter(isWorking);
  if (!work.length) return out;
  const hasPrev = prev.kg > 0;
  const e1 = Math.max(...work.map((s) => est1RM(s.kg, s.reps) || 0));
  const kg = Math.max(...work.map((s) => s.kg));
  const vol = Math.max(...work.map((s) => s.kg * s.reps));
  if (hasPrev && e1 > prev.e1rm + 0.01) out.push({ type: 'e1rm', label: '1RM stimato', value: e1 });
  if (hasPrev && kg > prev.kg) out.push({ type: 'kg', label: 'Carico massimo', value: kg });
  else if (hasPrev) {
    const best = work.filter((s) => s.kg === kg).reduce((m, s) => Math.max(m, s.reps), 0);
    if (best > (prev.repsAt[kg] || 0) && prev.repsAt[kg]) out.push({ type: 'reps', label: `Rep a ${kg} kg`, value: best });
  }
  if (hasPrev && vol > prev.volumeSet && !out.some((o) => o.type === 'kg')) out.push({ type: 'vol', label: 'Miglior serie (volume)', value: vol });
  return out;
}

/* ------------------------------------------------------------------ */
/* Suggerimento di progressione (doppia progressione)                   */
/* ------------------------------------------------------------------ */

const round = (v, step) => Math.round(v / step) * step;

/**
 * @param target  { sets, repMin, repMax, rir }
 * @param last    sessione precedente (da exerciseHistory) o null
 * @param inc     incremento di carico in kg
 */
export function suggest(target, last, inc = 2.5) {
  if (!last || !last.sets.length) return { kind: 'start', text: 'Prima volta: scegli un carico con cui chiudi la serie con la riserva indicata.' };
  const modal = (() => {
    const c = {};
    last.sets.forEach((s) => { c[s.kg] = (c[s.kg] || 0) + 1; });
    return +Object.entries(c).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  })();
  const at = last.sets.filter((s) => s.kg === modal);
  const reps = at.map((s) => s.reps);
  const enough = at.length >= Math.min(target.sets, 2);
  const rirMin = target.rir ? +String(target.rir).split('-')[0] : null;
  const rirLogged = at.map((s) => s.rir).filter((v) => Number.isFinite(v));
  const tooHard = rirMin != null && rirLogged.length && rirLogged.every((v) => v < Math.max(0, rirMin - 1));

  // criteri oggettivi dal video (se le serie sono state filmate): ≥ 90% rep corrette e perdita di velocità ≤ 25%
  const filmed = at.filter((s) => s.tech && s.tech.total > 0);
  const techRatio = filmed.length ? filmed.reduce((a, s) => a + s.tech.valid, 0) / filmed.reduce((a, s) => a + s.tech.total, 0) : null;
  const losses = filmed.map((s) => s.tech.loss).filter((v) => Number.isFinite(v));
  const maxLoss = losses.length ? Math.max(...losses) : null;
  const techOk = (techRatio == null || techRatio >= 0.9) && (maxLoss == null || maxLoss <= 25);

  if (enough && reps.every((r) => r >= target.repMax) && !tooHard) {
    if (!techOk) {
      const why = techRatio != null && techRatio < 0.9 ? `rep corrette ${Math.round(techRatio * 100)}%` : `perdita di velocità ${Math.round(maxLoss)}%`;
      return { kind: 'keep', kg: modal, reps: reps.map(() => target.repMax), text: `Rep al tetto ma ${why}: resta a ${fmtKg(modal)} kg e consolida la tecnica.` };
    }
    const proof = filmed.length ? ` (video: ${Math.round(techRatio * 100)}% corrette${maxLoss != null ? `, −${Math.round(maxLoss)}% velocità` : ''})` : '';
    return { kind: 'up', kg: modal + inc, text: `Tutte le serie al massimo${proof}: prova ${fmtKg(modal + inc)} kg.` };
  }
  const avg = reps.reduce((a, b) => a + b, 0) / reps.length;
  if (avg < target.repMin - 0.01 || (tooHard && avg < target.repMin + 1)) {
    const lower = Math.max(0, round(modal * 0.95, 0.5));
    return { kind: 'down', kg: lower, text: `Sotto il range minimo: prova ${fmtKg(lower)} kg o consolida a ${fmtKg(modal)} kg.` };
  }
  const targets = reps.map((r) => Math.min(target.repMax, r + 1));
  return { kind: 'keep', kg: modal, reps: targets, text: `Resta a ${fmtKg(modal)} kg e punta a ${targets.join('/')}.` };
}

export const fmtKg = (v) => (Number.isFinite(v) ? String(Math.round(v * 100) / 100).replace('.', ',') : '–');

/* ------------------------------------------------------------------ */
/* Muscoli                                                              */
/* ------------------------------------------------------------------ */

export const MUSCLE_IT = {
  chest: 'Petto', lats: 'Dorsali', 'middle back': 'Schiena', 'lower back': 'Lombari', shoulders: 'Spalle',
  biceps: 'Bicipiti', triceps: 'Tricipiti', forearms: 'Avambracci', quadriceps: 'Quadricipiti', hamstrings: 'Femorali',
  glutes: 'Glutei', calves: 'Polpacci', abdominals: 'Addominali', traps: 'Trapezi', adductors: 'Adduttori',
  abductors: 'Abduttori', neck: 'Collo',
};
export const muscleIt = (m) => MUSCLE_IT[m] || m;

export const EQUIPMENT_IT = {
  barbell: 'Bilanciere', dumbbell: 'Manubri', cable: 'Cavi', machine: 'Macchina', 'body only': 'Corpo libero',
  kettlebells: 'Kettlebell', bands: 'Elastici', other: 'Altro', 'e-z curl bar': 'Barra EZ', 'medicine ball': 'Palla medica',
  'exercise ball': 'Palla', 'foam roll': 'Foam roller',
};

/* ------------------------------------------------------------------ */
/* Ricerca nel database esercizi (nomi inglesi)                         */
/* ------------------------------------------------------------------ */

// Italiano → termini inglesi presenti nei nomi del database
const PHRASES = [
  ['lat machine', 'lat pulldown'], ['chest press', 'chest press'], ['shoulder press', 'shoulder press'],
  ['military press', 'overhead press'], ['alzate laterali', 'lateral raise'], ['alzate frontali', 'front raise'],
  ['french press', 'skull crusher'], ['stacco rumeno', 'romanian deadlift'], ['hip thrust', 'hip thrust'],
  ['leg press', 'leg press'], ['leg extension', 'leg extension'], ['leg curl', 'leg curl'], ['panca piana', 'bench press'],
  ['pulley', 'cable row'], ['face pull', 'face pull'], ['petto appoggiato', 'chest supported'],
];
const WORDS = {
  panca: 'bench', inclinata: 'incline', declinata: 'decline', manubri: 'dumbbell', manubrio: 'dumbbell', bilanciere: 'barbell',
  macchina: 'machine', cavo: 'cable', cavi: 'cable', corda: 'rope', rematore: 'row', trazioni: 'pull up', trazione: 'pull up',
  alzate: 'raise', laterali: 'lateral', croci: 'fly', pressa: 'leg press', stacco: 'deadlift', rumeno: 'romanian',
  affondi: 'lunge', affondo: 'lunge', tricipiti: 'triceps', tricipite: 'triceps', bicipiti: 'biceps', bicipite: 'biceps',
  spalle: 'shoulder', petto: 'chest', polpacci: 'calf', addominali: 'crunch', dorsali: 'lat', prona: 'overhand',
  supina: 'underhand', presa: '', di: '', con: '', a: '', al: '', alla: '', da: '', in: '', e: '',
  appoggiato: 'supported', pushdown: 'pushdown', curl: 'curl', squat: 'squat', plank: 'plank', hammer: 'hammer',
  verticale: 'seated', orizzontale: 'row', sumo: 'sumo', glutei: 'glute', femorali: 'hamstring',
};

export function queryTokens(q) {
  let s = ' ' + norm(q) + ' ';
  const out = new Set();
  for (const [it, en] of PHRASES) {
    const p = ' ' + norm(it) + ' ';
    if (s.includes(p)) { en.split(' ').forEach((t) => out.add(t)); s = s.replace(p, ' '); }
  }
  for (const w of s.trim().split(' ')) {
    if (!w || /^\d+$/.test(w)) continue;
    if (Object.prototype.hasOwnProperty.call(WORDS, w)) WORDS[w].split(' ').filter(Boolean).forEach((t) => out.add(t));
    else out.add(w);
  }
  return [...out];
}

const stem = (t) => t.replace(/(ing|es|s)$/, '');

/** db: array di { id, n (nome), m (muscoli primari), e (attrezzo) } — ritorna i migliori `limit` con punteggio 0..1 */
export function searchDb(db, query, limit = 8) {
  const q = queryTokens(query);
  if (!q.length) return [];
  const qs = q.map(stem);
  const res = [];
  for (const ex of db) {
    const nameT = ex._t || (ex._t = norm(ex.n).split(' ').map(stem));
    const extra = ex._x || (ex._x = norm(`${(ex.m || []).join(' ')} ${ex.e || ''}`).split(' ').map(stem));
    let hit = 0, soft = 0;
    for (const t of qs) {
      if (nameT.includes(t)) hit++;
      else if (extra.includes(t)) soft += 0.5;
    }
    if (hit + soft === 0) continue;
    const cover = (hit + soft) / qs.length;
    const unmatched = nameT.filter((t) => !qs.includes(t)).length;
    const score = cover - 0.04 * unmatched + (hit === qs.length ? 0.1 : 0);
    res.push({ ex, score });
  }
  return res.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Collegamento automatico solo se la corrispondenza è chiara. */
export function autoMatch(db, name) {
  const [best] = searchDb(db, name, 1);
  return best && best.score >= 0.55 ? best.ex : null;
}
