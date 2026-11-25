// viewStats.js — progressi: frequenza, volume, andamento per esercizio (continuo tra schede diverse), muscoli.

import { $, h, fmtDay, fmtNum, openSheet } from './dom.js';
import * as store from './store.js';
import { exerciseHistory, exKey, isWorking, workoutVolume, workoutSets, muscleIt, fmtKg, records } from './training.js';
import { lineChart, barChart, heatGrid, hBars } from './charts.js';
import { loadDb, getDb, resolve } from './exdb.js';
import { openWorkoutDetail } from './viewTrain.js';
import { icon } from './dom.js';
import { plateau } from './coach.js';

const root = () => $('#v-stats');
const DAY = 86400000;
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const mondayOf = (t) => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); };

let selKey = null;
let metric = 'e1rm';

const METRICS = {
  e1rm: { label: '1RM stimato', unit: 'kg', pick: (s) => s.e1rm, dec: 1 },
  kg: { label: 'Carico max', unit: 'kg', pick: (s) => s.topKg, dec: 1 },
  vol: { label: 'Volume', unit: 'kg', pick: (s) => s.volume, dec: 0 },
  reps: { label: 'Rep totali', unit: 'rep', pick: (s) => s.reps, dec: 0 },
};

function exerciseList(workouts) {
  const m = new Map();
  for (const w of workouts) for (const e of w.exercises) {
    if (!e.sets.some(isWorking)) continue;
    const k = exKey(e.name);
    const cur = m.get(k) || { key: k, name: e.name, last: '', n: 0 };
    cur.name = e.name; cur.last = w.startedAt; cur.n++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.last.localeCompare(a.last));
}

export function renderStats() {
  const r = root();
  if (!r) return;
  const workouts = store.getWorkouts();
  const nodes = [h('section', { class: 'hero' }, h('h1', { class: 'headline' }, 'Progressi'),
    h('p', { class: 'lede' }, 'Ogni esercizio ha la sua storia, anche se cambi scheda: i numeri si sommano nel tempo.'))];

  if (!workouts.length) {
    nodes.push(h('section', { class: 'card empty' }, h('h2', {}, 'Ancora niente da mostrare'), h('p', { class: 'muted' }, 'Dopo il primo allenamento completato compaiono qui frequenza, volume e andamento di ogni esercizio.')));
    r.replaceChildren(...nodes);
    return;
  }

  const now = Date.now();
  const last30 = workouts.filter((w) => now - new Date(w.startedAt).getTime() <= 30 * DAY);
  nodes.push(h('div', { class: 'kpis kpis-4' },
    h('div', { class: 'kpi' }, h('b', {}, String(workouts.length)), h('small', {}, 'allenamenti')),
    h('div', { class: 'kpi' }, h('b', {}, String(last30.length)), h('small', {}, 'ultimi 30 gg')),
    h('div', { class: 'kpi' }, h('b', {}, fmtNum(last30.reduce((a, w) => a + workoutVolume(w), 0) / 1000, 1)), h('small', {}, 't di volume')),
    h('div', { class: 'kpi' }, h('b', {}, String(last30.reduce((a, w) => a + workoutSets(w), 0))), h('small', {}, 'serie utili'))));

  const WEEKS = 12;
  const m0 = mondayOf(now) - (WEEKS - 1) * 7 * DAY;
  nodes.push(calendarCard(workouts));

  // volume settimanale
  const weekVol = new Array(WEEKS).fill(0);
  for (const w of workouts) { const i = Math.floor((mondayOf(new Date(w.startedAt).getTime()) - m0) / (7 * DAY)); if (i >= 0 && i < WEEKS) weekVol[i] += workoutVolume(w); }
  nodes.push(h('section', { class: 'card' }, h('h2', {}, 'Volume per settimana'),
    barChart(weekVol.map((v, i) => ({ label: fmtDay(m0 + i * 7 * DAY), v: Math.round(v), hot: i === WEEKS - 1 })), { unit: 'kg' })));

  // per esercizio
  const list = exerciseList(workouts);
  if (!selKey || !list.some((x) => x.key === selKey)) selKey = list[0] && list[0].key;
  if (selKey) nodes.push(exerciseCard(workouts, list));

  nodes.push(muscleCard(last30));
  r.replaceChildren(...nodes);
}

function exerciseCard(workouts, list) {
  const card = h('section', { class: 'card' });
  const sel = h('select', { class: 'in-wide', 'aria-label': 'Esercizio' }, list.map((x) => h('option', { value: x.key, selected: x.key === selKey }, `${x.name} (${x.n})`)));
  sel.addEventListener('change', () => { selKey = sel.value; paint(); });
  const chips = h('div', { class: 'chips-wrap' }, Object.entries(METRICS).map(([k, m]) => h('button', {
    type: 'button', class: `chip-btn${k === metric ? ' on' : ''}`, onclick: () => { metric = k; paint(); },
  }, m.label)));
  const body = h('div', {});

  function paint() {
    chips.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', Object.keys(METRICS)[i] === metric));
    const hist = exerciseHistory(workouts, selKey);
    const M = METRICS[metric];
    const pts = hist.map((s) => ({
      t: new Date(s.date).getTime(), v: M.pick(s) || 0,
      caption: `${fmtDay(s.date)} · ${M.label} ${fmtNum(M.pick(s), M.dec)} ${M.unit} · ${s.sets.map((x) => `${fmtKg(x.kg)}×${x.reps}`).join('  ')}`,
    })).filter((p) => p.v > 0);
    const markers = [];
    hist.forEach((s, i) => { if (i && s.programId !== hist[i - 1].programId) markers.push({ t: new Date(s.date).getTime() }); });

    // riepilogo per scheda
    const groups = [];
    for (const s of hist) {
      const g = groups.at(-1);
      if (g && g.programId === s.programId) { g.sessions++; g.best = Math.max(g.best, s.e1rm || 0); g.last = s.e1rm || g.last; }
      else groups.push({ programId: s.programId, name: s.programName || 'Libero', sessions: 1, first: s.e1rm || 0, best: s.e1rm || 0, last: s.e1rm || 0, from: s.date });
    }
    const rec = records(hist);
    body.replaceChildren(...[
      lineChart(pts, { unit: M.unit, decimals: M.dec, markers }),
      plateau(hist).stalled ? h('div', { class: 'advice-stall' }, h('b', {}, 'Fermo da 4 sedute'), ...plateau(hist).tips.map((t) => h('p', {}, t))) : null,
      markers.length ? h('p', { class: 'hint' }, 'Le linee tratteggiate segnano il passaggio a una nuova scheda.') : null,
      h('div', { class: 'kpis kpis-3' },
        h('div', { class: 'kpi' }, h('b', {}, fmtKg(rec.kg)), h('small', {}, 'kg massimo')),
        h('div', { class: 'kpi' }, h('b', {}, fmtKg(Math.round(rec.e1rm * 10) / 10)), h('small', {}, '1RM stimato')),
        h('div', { class: 'kpi' }, h('b', {}, String(hist.length)), h('small', {}, 'sedute'))),
      groups.length > 1 || (groups[0] && groups[0].first && groups[0].best > groups[0].first)
        ? h('div', {}, h('h3', {}, 'Scheda per scheda'),
          h('ul', { class: 'hist-list' }, groups.map((g) => {
            const pct = g.first ? Math.round(((g.best - g.first) / g.first) * 100) : 0;
            return h('li', {}, h('span', {}, g.name), h('span', { class: 'muted' }, `${g.sessions} sedute · 1RM ${fmtKg(Math.round(g.first))} → ${fmtKg(Math.round(g.best))} kg`), h('i', { class: pct >= 0 ? 'up' : 'down' }, `${pct >= 0 ? '+' : ''}${pct}%`));
          }))) : null].filter(Boolean));
  }
  card.append(h('h2', {}, 'Andamento esercizio'), sel, chips, body);
  paint();
  return card;
}

function muscleCard(recent) {
  const card = h('section', { class: 'card' }, h('h2', {}, 'Serie per muscolo (30 giorni)'));
  const body = h('div', {});
  card.append(body);
  const paint = () => {
    const counts = new Map();
    let linked = 0, total = 0;
    for (const w of recent) for (const e of w.exercises) {
      const n = e.sets.filter(isWorking).length;
      if (!n) continue;
      total++;
      const { ex } = resolve(e.name, e.dbId);
      if (!ex || !ex.m.length) continue;
      linked++;
      for (const m of ex.m) counts.set(m, (counts.get(m) || 0) + n);
    }
    if (!getDb()) { body.replaceChildren(h('p', { class: 'muted' }, 'Carico la libreria per riconoscere i muscoli…')); return; }
    if (!counts.size) { body.replaceChildren(h('p', { class: 'muted' }, 'Nessun esercizio riconosciuto: collega le immagini dalla scheda dell\'esercizio.')); return; }
    const items = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m, v]) => ({ label: muscleIt(m), v }));
    body.replaceChildren(hBars(items, { unit: '' }), h('p', { class: 'hint' }, `Riconosciuti ${linked} esercizi su ${total}. Conta le serie in cui il muscolo è il principale.`));
  };
  paint();
  if (!getDb()) loadDb().then(paint).catch(() => { body.replaceChildren(h('p', { class: 'muted' }, 'Libreria non raggiungibile: serve internet la prima volta.')); });
  return card;
}

/* ------------------------------ calendario ------------------------------ */

let calMonth = (() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; })();
const ymd = (d) => new Date(d).toLocaleDateString('sv-SE');
const MONTHS = new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric' });

function weekStreak(workouts) {
  const weeks = new Set(workouts.map((w) => mondayOf(new Date(w.startedAt).getTime())));
  let cur = mondayOf(Date.now());
  if (!weeks.has(cur)) cur -= 7 * DAY; // la settimana in corso può ancora riempirsi
  let n = 0;
  while (weeks.has(cur)) { n++; cur -= 7 * DAY; }
  return n;
}

function calendarCard(workouts) {
  const card = h('section', { class: 'card' });
  const byDay = new Map();
  for (const w of workouts) { const k = ymd(w.startedAt); (byDay.get(k) || byDay.set(k, []).get(k)).push(w); }
  const maxV = Math.max(1, ...[...byDay.values()].map((l) => l.reduce((a, w) => a + workoutVolume(w), 0)));
  const body = h('div', {});

  function paint() {
    const y = calMonth.getFullYear(), m = calMonth.getMonth();
    const first = new Date(y, m, 1), days = new Date(y, m + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;
    const today = ymd(new Date());
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push(h('i', { class: 'cal-d out' }));
    let count = 0;
    for (let d = 1; d <= days; d++) {
      const key = ymd(new Date(y, m, d));
      const list = byDay.get(key) || [];
      if (list.length) count += list.length;
      const vol = list.reduce((a, w) => a + workoutVolume(w), 0);
      const level = list.length ? 1 + Math.min(2, Math.floor((vol / maxV) * 2.99)) : 0;
      cells.push(h(list.length ? 'button' : 'span', {
        class: `cal-d${list.length ? ' has l' + level : ''}${key === today ? ' today' : ''}`, type: list.length ? 'button' : null,
        'aria-label': list.length ? `${d}: ${list.map((w) => w.dayName).join(', ')}` : String(d),
        onclick: list.length ? () => openDay(key, list) : null,
      }, h('span', {}, String(d)), list.length > 1 ? h('em', {}, '×' + list.length) : null));
    }
    const streak = weekStreak(workouts);
    body.replaceChildren(
      h('div', { class: 'cal-head' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Mese precedente', onclick: () => { calMonth = new Date(y, m - 1, 1); paint(); } }, icon('up', 20)),
        h('b', {}, MONTHS.format(first)),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Mese successivo', onclick: () => { calMonth = new Date(y, m + 1, 1); paint(); } }, icon('down', 20))),
      h('div', { class: 'cal-grid cal-wd' }, ['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((x) => h('span', {}, x))),
      h('div', { class: 'cal-grid' }, cells),
      h('div', { class: 'kpis kpis-3' },
        h('div', { class: 'kpi' }, h('b', {}, String(count)), h('small', {}, 'allenamenti nel mese')),
        h('div', { class: 'kpi' }, h('b', {}, String(streak)), h('small', {}, streak === 1 ? 'settimana di fila' : 'settimane di fila')),
        h('div', { class: 'kpi' }, h('b', {}, String(byDay.size)), h('small', {}, 'giorni totali'))));
  }
  function openDay(key, list) {
    if (list.length === 1) { openWorkoutDetail(list[0]); return; }
    const sh = openSheet({ title: fmtDay(key), content: list.map((w) => h('button', { class: 'wo-item', type: 'button', onclick: () => { sh.close(); openWorkoutDetail(w); } },
      h('span', { class: 'wo-d' }, h('b', {}, w.dayName), h('small', {}, w.programName || 'libero')),
      h('span', { class: 'wo-n' }, `${fmtNum(workoutVolume(w))} kg`))) });
  }
  card.append(h('h2', {}, 'Calendario'), body, h('p', { class: 'hint' }, 'Tocca un giorno allenato per rivedere la seduta. Più il pallino è pieno, più volume hai fatto.'));
  paint();
  return card;
}
