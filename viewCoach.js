// viewCoach.js — il Coach: riscaldamento e defaticamento per la seduta, consigli di carico (prestazione + RIR + tecnica), domande libere.

import { h, icon, openSheet, fmtDay, fmtNum, explainErr } from './dom.js';
import * as store from './store.js';
import * as sheets from './sheetsSync.js';
import { exKey, exerciseHistory, fmtKg } from './training.js';
import { resolve, loadDb, getDb } from './exdb.js';
import { analyze } from './exDetail.js';
import * as C from './coach.js';

export function techRecords() {
  try { const v = JSON.parse(localStorage.getItem('fulcro.history') || '[]'); return Array.isArray(v) ? v.filter((r) => r && typeof r.exercise === 'string') : []; } catch { return []; }
}

const withMuscles = (e) => ({ ...e, muscles: (resolve(e.name, e.dbId).ex || {}).m || [] });

/** Elenco esercizi della seduta: allenamento in corso oppure un giorno della scheda. */
function sourceExercises(sel) {
  const W = store.getActive();
  const prog = store.activeProgram();
  if (sel === 'active' && W) {
    return W.exercises.map((e) => ({ name: e.name, dbId: e.dbId, target: e.target, kg: (e.sets.find((s) => s.type !== 'warmup' && s.kg) || {}).kg ?? null }));
  }
  const day = prog && prog.days.find((d) => d.id === sel);
  return day ? day.exercises.map((e) => ({ name: e.name, dbId: e.dbId, target: { sets: e.sets, repMin: e.repMin, repMax: e.repMax, rir: e.rir }, kg: e.refKg })) : [];
}

function workKg(e) {
  const adv = C.loadAdvice(e.name, e.target, store.getWorkouts(), techRecords(), store.getInc());
  return adv.action === 'unknown' ? e.kg : adv.kg;
}

const itemList = (items) => h('ul', { class: 'coach-list' }, items.map((i) => h('li', {}, h('b', {}, i.name), h('span', {}, i.detail))));

function warmPane(exs) {
  const regions = C.regionsOf(exs.map(withMuscles));
  const ramps = exs.slice(0, 6).map((e, i) => {
    const kg = workKg(e);
    const r = i < 2 ? C.warmupRamp(kg) : C.warmupRamp(kg).slice(0, 1);
    return r.length ? h('li', {}, h('b', {}, e.name), h('span', {}, `${r.map((s) => `${fmtKg(s.kg)} kg × ${s.reps}`).join('  →  ')}  →  lavoro a ${fmtKg(kg)} kg`)) : null;
  }).filter(Boolean);
  return [
    h('p', { class: 'muted' }, `Per oggi lavori soprattutto su: ${C.regionLabel(regions)}. Circa 10 minuti.`),
    h('h3', {}, 'Riscaldamento generale'), itemList(C.generalWarmup(regions)),
    ramps.length ? h('div', {}, h('h3', {}, 'Serie di avvicinamento'),
      h('ul', { class: 'coach-list' }, ramps),
      h('p', { class: 'hint' }, 'Riposa 45-60 secondi tra queste serie e fermati sempre lontano dal cedimento. Dalla scheda dell\'esercizio puoi inserirle nell\'allenamento con «Riscaldamento».')) : null,
  ].filter(Boolean);
}

function coolPane(exs) {
  const regions = C.regionsOf(exs.map(withMuscles));
  return [h('p', { class: 'muted' }, `Per ${C.regionLabel(regions)}. Circa 8 minuti: respira lento e non forzare fino al dolore.`), itemList(C.generalCooldown(regions))];
}

export function adviceNode(e) {
  const hist = exerciseHistory(store.getWorkouts(), exKey(e.name));
  const adv = C.loadAdvice(e.name, e.target, store.getWorkouts(), techRecords(), store.getInc());
  const pl = C.plateau(hist);
  const kind = adv.action === 'up' ? 'pill-ok' : adv.action === 'down' ? 'pill-warn' : 'pill-amber';
  return h('div', { class: 'advice' },
    h('div', { class: 'advice-h' }, h('b', {}, e.name), h('span', { class: `pill ${kind}` }, adv.action === 'up' ? 'Sali' : adv.action === 'down' ? 'Scendi' : adv.action === 'keep' ? 'Resta' : 'Dati')),
    h('p', { class: 'advice-t' }, adv.headline),
    h('ul', { class: 'advice-r' }, adv.reasons.map((r) => h('li', {}, r))),
    pl.stalled ? h('div', { class: 'advice-stall' }, h('b', {}, `Fermo da ${pl.sessions} sedute`), ...pl.tips.map((t) => h('p', {}, t))) : null,
    adv.tech ? null : h('button', { class: 'chip-btn', type: 'button', onclick: () => analyze({ name: e.name, kg: adv.kg || e.kg || null }) }, icon('lens', 16), ' Aggiungi un video per un consiglio più preciso'));
}

function advicePane(exs) {
  if (!exs.length) return [h('p', { class: 'muted' }, 'Nessun esercizio in questa seduta.')];
  return exs.map((e) => adviceNode(e));
}

function askPane(exs, dayLabel) {
  const key = sheets.getSettings().geminiKey;
  if (!key) return [h('p', { class: 'muted' }, 'Per fare domande libere al Coach serve la chiave Gemini (gratuita), da inserire nelle impostazioni. Le sezioni qui accanto funzionano anche senza.')];
  const q = h('textarea', { rows: '3', placeholder: 'Es. «Ho solo 30 minuti, come accorcio la seduta?» oppure «Proponimi un riscaldamento per la spalla».', 'aria-label': 'Domanda al coach' });
  const out = h('div', { class: 'coach-answer', role: 'status' });
  const btn = h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
    const text = q.value.trim();
    if (!text) { q.focus(); return; }
    btn.disabled = true; out.textContent = 'Il coach sta pensando…';
    const ctx = {
      domanda: text, seduta: dayLabel,
      esercizi: exs.map((e) => ({
        nome: e.name, obiettivo: e.target,
        ultime_sedute: exerciseHistory(store.getWorkouts(), exKey(e.name)).slice(-3).map((s) => ({ data: s.date.slice(0, 10), serie: s.sets.map((x) => `${x.kg}x${x.reps}${Number.isFinite(x.rir) ? '@' + x.rir : ''}`) })),
      })),
    };
    try {
      out.textContent = await sheets.askGemini(key,
        'Sei un personal trainer esperto, prudente e concreto. Rispondi in italiano in massimo 150 parole, con elenchi brevi. Non fare diagnosi mediche: se c\'è dolore acuto o persistente invita a sentire un medico o un fisioterapista. Usa solo i dati forniti nel JSON.',
        JSON.stringify(ctx));
    } catch (e) { out.textContent = explainErr(e); }
    btn.disabled = false;
  } }, 'Chiedi al coach');
  return [q, btn, out, h('p', { class: 'hint' }, 'A Gemini vanno nome degli esercizi, carichi e ripetizioni recenti, mai video o foto.')];
}

const TABS = [['warm', 'Riscaldamento'], ['cool', 'Defaticamento'], ['adv', 'Come vado'], ['ask', 'Chiedi']];

export function openCoach({ tab = 'warm', sel = null } = {}) {
  const W = store.getActive();
  const prog = store.activeProgram();
  const options = [];
  if (W) options.push({ id: 'active', label: `In corso: ${W.dayName}` });
  if (prog) prog.days.forEach((d) => options.push({ id: d.id, label: d.name }));
  if (!options.length) {
    openSheet({ title: 'Coach', content: h('p', { class: 'muted' }, 'Crea prima una scheda: il coach lavora sui tuoi esercizi.') });
    return;
  }
  let cur = sel && options.some((o) => o.id === sel) ? sel : options[0].id;
  const select = h('select', { class: 'in-wide', 'aria-label': 'Seduta' }, options.map((o) => h('option', { value: o.id, selected: o.id === cur }, o.label)));
  const chips = h('div', { class: 'chips-wrap' }, TABS.map(([k, l]) => h('button', { type: 'button', class: `chip-btn${k === tab ? ' on' : ''}`, dataset: { tab: k }, onclick: () => { tab = k; paint(); } }, l)));
  const body = h('div', { class: 'coach-body' });
  function paint() {
    chips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const exs = sourceExercises(cur);
    const label = (options.find((o) => o.id === cur) || {}).label || '';
    const nodes = tab === 'warm' ? warmPane(exs) : tab === 'cool' ? coolPane(exs) : tab === 'adv' ? advicePane(exs) : askPane(exs, label);
    body.replaceChildren(...nodes);
  }
  select.addEventListener('change', () => { cur = select.value; paint(); });
  openSheet({ title: 'Il tuo coach', content: [select, chips, body], wide: true });
  paint();
  if (!getDb()) loadDb().then(paint).catch(() => {});
}

export { fmtDay, fmtNum };
