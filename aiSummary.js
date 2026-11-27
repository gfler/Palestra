// aiSummary.js — «Pacchetto settimanale AI»: un blocco di testo compatto della settimana, da incollare in chat.

import * as store from './store.js';
import * as diet from './diet.js';
import { exKey, isWorking, est1RM, fmtKg, exerciseHistory } from './training.js';

const n1 = (v) => (Number.isFinite(v) ? String(Math.round(v * 10) / 10).replace('.', ',') : '–');
const n2 = (v) => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '–');
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

/** Esercizi che da 3 sedute non migliorano né le rep valide né la velocità media (né il 1RM stimato). */
export function stalledExercises(workouts = store.getWorkouts()) {
  const keys = new Map();
  for (const w of workouts) for (const e of w.exercises) if (e.sets.some(isWorking)) keys.set(exKey(e.name), e.name);
  const out = [];
  for (const [k, name] of keys) {
    const hist = exerciseHistory(workouts, k);
    if (hist.length < 4) continue;
    const score = (s) => ({
      reps: s.sets.reduce((a, x) => a + (x.tech && x.tech.total ? x.tech.valid : x.reps), 0),
      vel: mean(s.sets.map((x) => x.tech && x.tech.vel).filter(Number.isFinite)),
      e1rm: s.e1rm || 0,
    });
    const before = hist.slice(0, -3).map(score);
    const ref = { reps: Math.max(...before.map((b) => b.reps)), vel: Math.max(...before.map((b) => b.vel).filter(Number.isFinite), 0), e1rm: Math.max(...before.map((b) => b.e1rm)) };
    const last3 = hist.slice(-3).map(score);
    const better = last3.some((s) => s.reps > ref.reps || (Number.isFinite(s.vel) && ref.vel > 0 && s.vel > ref.vel + 0.01) || s.e1rm > ref.e1rm + 0.1);
    if (!better) out.push({ key: k, name, since: hist.at(-3).date });
  }
  return out;
}

export function buildWeekSummary(today = diet.isoDate()) {
  const start = diet.weekStartIso(today);
  const from = new Date(diet.fromIso(start)).getTime();
  const ws = store.getWorkouts().filter((w) => new Date(w.startedAt).getTime() >= from);
  const L = [];
  L.push(`FULCRO — settimana dal ${diet.fromIso(start).toLocaleDateString('it-IT')} (generato ${new Date().toLocaleDateString('it-IT')})`);
  L.push('');
  L.push(`ALLENAMENTI: ${ws.length}`);
  for (const w of ws) {
    L.push(`• ${new Date(w.startedAt).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' })} — ${w.dayName}${w.checkin ? ` [check-in: energia ${w.checkin.energy}, sonno ${w.checkin.sleep}, fastidi ${w.checkin.pain}]` : ''}`);
    for (const e of w.exercises) {
      const sets = e.sets.filter(isWorking);
      if (!sets.length) continue;
      const best = Math.max(...sets.map((s) => est1RM(s.kg, s.reps) || 0));
      const tech = sets.filter((s) => s.tech && s.tech.total);
      const techTxt = tech.length ? ` | video: ${tech.reduce((a, s) => a + s.tech.valid, 0)}/${tech.reduce((a, s) => a + s.tech.total, 0)} rep corrette, vel ${n2(mean(tech.map((s) => s.tech.vel).filter(Number.isFinite)))} m/s${tech.some((s) => Number.isFinite(s.tech.loss)) ? `, perdita ${Math.round(Math.max(...tech.map((s) => s.tech.loss).filter(Number.isFinite)))}%` : ''}` : '';
      L.push(`   ${e.name}: ${sets.map((s) => `${fmtKg(s.kg)}×${s.reps}${Number.isFinite(s.rir) ? `@${s.rir}` : ''}`).join(', ')} | 1RM st. ${n1(best)} kg${techTxt}`);
    }
  }
  const st = stalledExercises();
  if (st.length) L.push(`In stallo da 3 sedute: ${st.map((s) => s.name).join(', ')}`);
  L.push('');
  const series = diet.bodySeries();
  const wk = series.filter((r) => r.date >= start && r.date <= today);
  const ma = diet.movingAvg(series, 'weight');
  const lastMa = ma.filter(Number.isFinite).at(-1);
  const prevI = series.map((r) => r.date < start).lastIndexOf(true);
  const prevMa = prevI >= 0 ? ma[prevI] : NaN;
  L.push(`CORPO: peso media 7 gg ${n1(lastMa)} kg${Number.isFinite(prevMa) && Number.isFinite(lastMa) ? ` (settimana prima ${n1(prevMa)}, Δ ${lastMa - prevMa >= 0 ? '+' : ''}${n1(lastMa - prevMa)})` : ''}`);
  const waists = wk.map((r) => r.waist).filter(Number.isFinite);
  L.push(`Vita (ombelico): ${waists.length ? `${n1(waists.at(-1))} cm` : '–'}`);
  const steps = wk.map((r) => r.steps).filter(Number.isFinite);
  L.push(`Passi medi: ${steps.length ? Math.round(mean(steps)).toLocaleString('it-IT') : '–'} (${steps.length} giorni registrati)`);
  const ad = diet.adherence(today);
  if (diet.plan()) {
    const c = diet.weekCounts(today);
    L.push(`DIETA: aderenza ${ad != null ? Math.round(ad * 100) : '–'}% dei pasti; ${diet.plan().frequenze.map((f) => `${f.label} ${c[f.id] || 0}`).join(', ')}`);
    const days = Array.from({ length: 7 }, (_, k) => diet.addDays(start, k)).filter((d) => d <= today);
    const crea = days.filter((d) => diet.dayLog(d).creatina).length;
    L.push(`Integratori: creatina ${crea}/${days.length} giorni${(() => { const s = diet.creatineState(today); return s ? (s.on ? ` (ciclo giorno ${s.day}/${s.of})` : ' (pausa)') : ''; })()}, omega-3 ${days.filter((d) => diet.dayLog(d).omega3).length}/${days.length}`);
  }
  L.push('');
  L.push('Analizza progressi, recupero e aderenza; dimmi cosa cambiare la prossima settimana.');
  return L.join('\n');
}
