// coach.js — logica del Coach (pura, nessun DOM): riscaldamento, defaticamento, plateau, scarico, consigli di carico.
// Tutto a regole, funziona offline. Gemini (opzionale) viene usato solo per le domande libere.

import { exKey, exerciseHistory, isWorking, suggest, fmtKg, norm } from './training.js';

const DAY = 86400000;
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export const roundKg = (v) => (v < 20 ? Math.round(v) : Math.round(v / 2.5) * 2.5);

/* ------------------------------------------------------------------ */
/* Serie di avvicinamento                                               */
/* ------------------------------------------------------------------ */

/** Dal carico di lavoro: rampa 40% × 8, 60% × 5, 80% × 3 (salta i passi inutili). */
export function warmupRamp(workKg) {
  if (!Number.isFinite(workKg) || workKg <= 0) return [];
  if (workKg < 12) return [{ kg: roundKg(workKg * 0.5), reps: 8 }].filter((s) => s.kg > 0 && s.kg < workKg);
  const steps = workKg < 25 ? [[0.5, 8], [0.75, 4]] : [[0.4, 8], [0.6, 5], [0.8, 3]];
  const out = [];
  for (const [p, reps] of steps) {
    const kg = roundKg(workKg * p);
    if (kg > 0 && kg < workKg && (!out.length || kg > out.at(-1).kg)) out.push({ kg, reps });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Regioni del corpo di un giorno                                       */
/* ------------------------------------------------------------------ */

const MUSCLE_REGION = {
  chest: 'push', shoulders: 'push', triceps: 'push',
  lats: 'pull', 'middle back': 'pull', biceps: 'pull', traps: 'pull', forearms: 'pull', 'lower back': 'pull',
  quadriceps: 'legs', hamstrings: 'legs', glutes: 'legs', calves: 'legs', adductors: 'legs', abductors: 'legs',
  abdominals: 'core',
};
const NAME_REGION = [
  [/\b(petto|panca|chest|bench|croci|fly|push|spalle|shoulder|alzate|military|tricip|dip|french|pushdown)/, 'push'],
  [/\b(lat|rematore|row|trazion|pull|dorsal|bicip|curl|face|schiena|shrug)/, 'pull'],
  [/\b(squat|pressa|leg|gamb|stacco|deadlift|rdl|romanian|affond|lunge|glute|hip|polpacc|calf|femoral|quadr)/, 'legs'],
  [/\b(addom|crunch|plank|core|ab )/, 'core'],
];

/** exercises: [{name, muscles?:[…]}] → insieme di regioni ordinate per frequenza */
export function regionsOf(exercises) {
  const count = {};
  for (const e of exercises) {
    let regs = (e.muscles || []).map((m) => MUSCLE_REGION[m]).filter(Boolean);
    if (!regs.length) { const n = norm(e.name); const hit = NAME_REGION.find(([re]) => re.test(n)); if (hit) regs = [hit[1]]; }
    regs.forEach((r) => { count[r] = (count[r] || 0) + 1; });
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([r]) => r);
}

/* ------------------------------------------------------------------ */
/* Riscaldamento generale e defaticamento                               */
/* ------------------------------------------------------------------ */

const WARM = {
  base: [{ name: 'Cardio leggero', detail: '5 minuti tra cyclette, vogatore o tapis roulant: battito su, respiro ancora facile.' }],
  push: [
    { name: 'Circonduzioni di spalle', detail: '2 × 10 avanti e 10 indietro, braccia tese.' },
    { name: 'Band pull-apart (o croci inverse leggere)', detail: '2 × 15 con elastico leggero, scapole indietro e giù.' },
    { name: 'Flessioni scapolari', detail: '2 × 10 sulle braccia tese, muovi solo le scapole.' },
    { name: 'Rotazioni esterne con elastico', detail: '1 × 12 per lato, gomito attaccato al fianco.' },
  ],
  pull: [
    { name: 'Appeso alla sbarra (o scapular pull)', detail: '2 × 20 secondi, spalle attive e lontane dalle orecchie.' },
    { name: 'Cat-cow', detail: '1 × 10 lento, mobilizza la colonna.' },
    { name: 'Rotazioni toraciche in quadrupedia', detail: '1 × 8 per lato.' },
    { name: 'Band pull-apart', detail: '2 × 15 con elastico leggero.' },
  ],
  legs: [
    { name: 'Mobilità anche e caviglie', detail: '1 minuto per lato, cerchi lenti e ginocchio avanti sul muro.' },
    { name: 'Squat a corpo libero', detail: '2 × 10 lenti, scendi con controllo.' },
    { name: 'Ponte per i glutei', detail: '2 × 12, stringi in alto un secondo.' },
    { name: 'Affondi dinamici', detail: '1 × 8 per gamba.' },
  ],
  core: [{ name: 'Plank leggero', detail: '2 × 20 secondi, addome attivo.' }],
};
const COOL = {
  base: [{ name: 'Camminata lenta', detail: '3-5 minuti per far scendere battito e respiro.' }],
  push: [
    { name: 'Pettorali al muro', detail: '30 secondi per lato, braccio a 90° contro lo stipite.' },
    { name: 'Spalle posteriori', detail: '30 secondi per lato, braccio incrociato al petto.' },
    { name: 'Tricipiti', detail: '30 secondi per lato, gomito dietro la testa.' },
  ],
  pull: [
    { name: 'Dorsali in posizione del bambino', detail: '45 secondi, braccia lunghe avanti, respira nei fianchi.' },
    { name: 'Bicipiti e avambracci', detail: '30 secondi per lato, palmo al muro o al banco.' },
    { name: 'Trapezio', detail: '30 secondi per lato, inclina l\'orecchio verso la spalla.' },
  ],
  legs: [
    { name: 'Quadricipiti', detail: '30 secondi per gamba in piedi, tallone ai glutei.' },
    { name: 'Femorali', detail: '30 secondi per gamba, tallone su un rialzo, schiena lunga.' },
    { name: 'Glutei (figura 4)', detail: '30 secondi per lato da sdraiato.' },
    { name: 'Polpacci', detail: '30 secondi per lato contro il muro.' },
  ],
  core: [{ name: 'Cobra dolce', detail: '30 secondi, respiro lento.' }],
};
const REGION_IT = { push: 'spinta (petto, spalle, tricipiti)', pull: 'trazione (schiena, bicipiti)', legs: 'gambe', core: 'addome' };

const build = (table, regions) => {
  const rs = regions.length ? regions : ['push'];
  return [...table.base, ...rs.flatMap((r) => table[r] || [])];
};
export const generalWarmup = (regions) => build(WARM, regions);
export const generalCooldown = (regions) => build(COOL, regions);
export const regionLabel = (regions) => regions.map((r) => REGION_IT[r]).filter(Boolean).join(', ') || 'tutto il corpo';

/* ------------------------------------------------------------------ */
/* Plateau e scarico                                                    */
/* ------------------------------------------------------------------ */

/** history = exerciseHistory(...) */
export function plateau(history) {
  const last = history.slice(-4);
  if (history.length < 4) return { stalled: false };
  const spanDays = (new Date(last.at(-1).date) - new Date(last[0].date)) / DAY;
  if (spanDays < 10) return { stalled: false };
  const prior = history.slice(0, -4).map((s) => s.e1rm || 0);
  const recentBest = Math.max(...last.map((s) => s.e1rm || 0));
  const baseline = prior.length ? Math.max(...prior) : (last[0].e1rm || 0);
  if (!baseline || recentBest > baseline * 1.005) return { stalled: false };
  const rirs = last.flatMap((s) => s.sets.map((x) => x.rir)).filter((v) => Number.isFinite(v));
  const tips = [];
  if (rirs.length && avg(rirs) <= 0.8) tips.push('Lavori già vicino al cedimento: prova a lasciare 1-2 ripetizioni di riserva e aumenta il recupero di 30".');
  else tips.push('Allunga il recupero di 30" e punta prima alle rep alte del range, poi sali di carico.');
  tips.push('Se è così da più di 4 sedute, cambia variante (es. manubri al posto del bilanciere) o fai una settimana di scarico.');
  return { stalled: true, sessions: last.length, tips };
}

/** Settimane di allenamento sulla scheda in uso e consiglio di scarico. */
export function deloadAdvice(workouts, program, now = Date.now()) {
  if (!program) return { due: false };
  const mine = workouts.filter((w) => w.programId === program.id);
  if (mine.length < 8) return { due: false };
  const startMs = new Date(mine[0].startedAt).getTime();
  const weeks = Math.floor((now - startMs) / (7 * DAY));
  // uno scarico recente (settimana con volume molto più basso) azzera il conteggio
  if (weeks < 6) return { due: false, weeks };
  return {
    due: true, weeks,
    text: `Sono ${weeks} settimane che segui questa scheda. Una settimana di scarico (una serie in meno per esercizio e carichi −10%) aiuta a consolidare prima di cambiare o riprendere a salire.`,
  };
}

export function deloadSets(sets) { return Math.max(2, sets - 1); }
export const deloadKg = (kg) => (Number.isFinite(kg) ? roundKg(kg * 0.9) : kg);

/* ------------------------------------------------------------------ */
/* Consiglio di carico: prestazione + RIR + tecnica da video            */
/* ------------------------------------------------------------------ */

/** Ultimo (o ultimi) record di analisi video dell'esercizio negli ultimi 21 giorni. */
export function techFor(name, techRecs, now = Date.now()) {
  const k = exKey(name);
  return (techRecs || []).filter((r) => exKey(r.exercise || '') === k && now - new Date(`${r.date}T12:00:00`).getTime() <= 21 * DAY && r.total > 0)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).at(-1) || null;
}

export function loadAdvice(name, target, workouts, techRecs, inc = 2.5, now = Date.now()) {
  const hist = exerciseHistory(workouts, exKey(name));
  const last = hist.at(-1);
  const tech = techFor(name, techRecs, now);
  const reasons = [];
  if (!last) return { action: 'unknown', headline: 'Servono dati', reasons: ['Registra almeno una seduta di questo esercizio.'], tech };

  const base = suggest(target, last, inc);
  const cnt = {};
  last.sets.forEach((x) => { cnt[x.kg] = (cnt[x.kg] || 0) + 1; });
  const modalKg = +Object.entries(cnt).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const techRatio = tech ? tech.valid / tech.total : null;
  const techBad = tech && (techRatio < 0.7 || (Number.isFinite(tech.loss) && tech.loss >= 30));
  const techGood = tech && techRatio >= 0.85 && !(Number.isFinite(tech.loss) && tech.loss >= 20);

  const reps = last.sets.map((s) => s.reps);
  const rirs = last.sets.map((s) => s.rir).filter((v) => Number.isFinite(v));
  const drop = reps.length > 1 ? reps[0] - reps.at(-1) : 0;
  const rirTarget = target.rir ? +String(target.rir).split('-')[0] : null;

  reasons.push(`Ultima volta: ${last.sets.map((s) => `${fmtKg(s.kg)}×${s.reps}`).join(' · ')}.`);
  if (rirs.length) reasons.push(`Riserva media dichiarata: ${avg(rirs).toFixed(1).replace('.', ',')} ripetizioni.`);
  if (tech) reasons.push(`Video del ${tech.date}: ${tech.valid}/${tech.total} rep valide${Number.isFinite(tech.loss) ? `, perdita di velocità ${Math.round(tech.loss)}%` : ''}.`);

  let action = base.kind === 'up' ? 'up' : base.kind === 'down' ? 'down' : 'keep';
  let kg = base.kg || modalKg;
  let headline;

  if (techBad) {
    action = base.kind === 'down' || techRatio < 0.5 ? 'down' : 'keep';
    kg = action === 'down' ? roundKg(modalKg * 0.92) : modalKg;
    headline = action === 'down' ? `Scendi a ${fmtKg(kg)} kg e cura l'esecuzione` : `Resta a ${fmtKg(modalKg)} kg: prima la tecnica`;
    reasons.push('Il video mostra rep non pulite o troppo lente: il carico non sale finché la tecnica non regge.');
  } else if (rirs.length && rirTarget != null && avg(rirs) < Math.max(0, rirTarget - 1) && drop >= 3) {
    action = 'keep'; kg = modalKg;
    headline = `Resta a ${fmtKg(modalKg)} kg: sei troppo al limite`;
    reasons.push('Le rep calano molto da una serie all\'altra e la riserva è bassa: allunga il recupero prima di salire.');
  } else if (action === 'up') {
    headline = techGood ? `Sali a ${fmtKg(base.kg)} kg` : `Sali a ${fmtKg(base.kg)} kg (se la tecnica resta pulita)`;
    if (techGood) reasons.push('Tecnica solida nel video: puoi salire.');
  } else if (action === 'down') {
    headline = `Prova ${fmtKg(base.kg)} kg`;
    reasons.push('Sei sotto il minimo di ripetizioni del range.');
  } else {
    headline = `Resta a ${fmtKg(modalKg)} kg e punta a ${(base.reps || []).join('/') || 'più rep'}`;
  }
  return { action, kg, headline, reasons, tech };
}
