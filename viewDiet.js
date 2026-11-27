// viewDiet.js — scheda «Dieta»: giornata a spunte, finestra allenamento, sostituzioni, frequenze, integratori, peso/vita/passi.

import { $, h, toast, openSheet, debounce, fmtNum } from './dom.js';
import * as diet from './diet.js';
import * as sheets from './sheetsSync.js';
import { openPhotoCheck } from './photoCheck.js';

const root = () => $('#v-diet');
let cur = diet.isoDate();

const WIN = { riposo: 'Riposo', sera: 'Palestra sera', weekend: 'Palestra mattina/pomeriggio' };
const CARB = /pane|pasta|riso|patate|gallette|crackers|farro|orzo|quinoa|bulgur|cereali|granola|fette|pancarr|gnocchi|avena/i;
const fmtQ = (a) => `${fmtNum(a.qta, 1)} ${a.unita || 'g'}`.trim();

/* ------------------------------ sincronizzazione ------------------------------ */

const syncSoon = debounce(async () => {
  if (!sheets.isConfigured()) return;
  try {
    await sheets.writeTab('Dieta_Log', diet.logRows());
    localStorage.removeItem('fulcro.dietDirty');
  } catch { localStorage.setItem('fulcro.dietDirty', '1'); }
}, 4000);
export async function syncDietNow() {
  if (!sheets.isConfigured()) return;
  try { await sheets.writeTab('Dieta_Log', diet.logRows()); localStorage.removeItem('fulcro.dietDirty'); } catch { /* riprova dopo */ }
}
const dietFlush = () => { if (navigator.onLine && localStorage.getItem('fulcro.dietDirty')) syncDietNow(); };
window.addEventListener('online', dietFlush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') dietFlush(); });
setTimeout(dietFlush, 3000);

/* ------------------------------ vista ------------------------------ */

export function renderDiet() {
  const r = root();
  const P = diet.plan();
  if (!P) { r.replaceChildren(emptyState()); return; }
  const di = diet.planDayIdx(cur);
  const g = P.giorni[di];
  const L = diet.dayLog(cur);
  const win = diet.windowFor(cur);
  const swapped = di !== diet.weekdayIdx(cur);
  const today = diet.isoDate();
  const label = cur === today ? 'Oggi' : cur === diet.addDays(today, -1) ? 'Ieri' : cur === diet.addDays(today, 1) ? 'Domani' : diet.fromIso(cur).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' });

  const nodes = [];
  nodes.push(h('section', { class: 'diet-head' },
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Giorno prima', onclick: () => { cur = diet.addDays(cur, -1); renderDiet(); } }, '‹'),
    h('div', { class: 'diet-day' }, h('b', {}, label), h('small', {}, `Piano: ${g.nome}${g.allenamento ? ' · allenamento' : ' · riposo'}${swapped ? ' · scambiato' : ''}`)),
    h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Giorno dopo', onclick: () => { cur = diet.addDays(cur, 1); renderDiet(); } }, '›')));

  nodes.push(morningCard(L));
  nodes.push(h('div', { class: 'seg seg-win', role: 'radiogroup', 'aria-label': 'Finestra di allenamento' },
    ...Object.entries(WIN).map(([k, t]) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(win === k), onclick: () => { diet.patchDay(cur, (l) => { l.window = k; }); syncSoon(); renderDiet(); } }, t))));
  const tip = windowTip(win, cur, g);
  if (tip) nodes.push(h('div', { class: 'win-tip' }, tip));

  const done = diet.MEAL_ORDER.filter((m) => g.pasti[m] && L.meals[m]).length;
  const tot = diet.MEAL_ORDER.filter((m) => g.pasti[m]).length;
  nodes.push(h('div', { class: 'meals-head' }, h('h2', {}, 'Pasti'), h('span', { class: 'pill' }, `${done}/${tot}`)));
  for (const m of diet.MEAL_ORDER) if (g.pasti[m]) nodes.push(mealCard(m, g.pasti[m], L, win, g));

  nodes.push(suppCard(L));
  nodes.push(freqCard());
  nodes.push(h('section', { class: 'card diet-actions' },
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: swapSheet }, 'Scambia due giorni'),
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: trainingDaysSheet }, 'Giorni di allenamento del piano'),
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => openPhotoCheck() }, 'Foto check guidata'),
    importButton('Sostituisci il piano (JSON)'),
    h('p', { class: 'hint' }, `${P.nome || 'Piano'}${P.autore ? ` · ${P.autore}` : ''}. Caricato il ${new Date(P.importedAt).toLocaleDateString('it-IT')}.`)));
  r.replaceChildren(...nodes);
}

function emptyState() {
  return h('section', { class: 'card empty' },
    h('h1', { class: 'headline' }, 'Il tuo piano alimentare.'),
    h('p', { class: 'lede' }, 'Importa il piano in formato JSON: ogni giorno avrai i pasti da spuntare, le alternative con i grammi giusti, le frequenze settimanali e gli integratori.'),
    importButton('Importa piano (JSON)', true));
}

function importButton(text, primary = false) {
  const inp = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async () => {
    const f = inp.files && inp.files[0]; inp.value = '';
    if (!f) return;
    try {
      const p = diet.importPlan(await f.text());
      toast(`Piano caricato: ${p.giorni.length} giorni ✓`, 'ok');
      if (sheets.isConfigured()) sheets.writeTab('Dieta_Piano', diet.planRows()).catch(() => {});
      renderDiet();
    } catch (e) { toast(e.message, 'error', 6000); }
  } });
  return h('span', {}, inp, h('button', { class: `btn ${primary ? 'btn-primary' : 'btn-ghost'}`, type: 'button', onclick: () => inp.click() }, text));
}

/* ------------------------------ mattina: peso, vita, passi ------------------------------ */

function numInput(val, attrs, onSave) {
  const el = h('input', { type: 'number', inputmode: 'decimal', value: Number.isFinite(val) ? String(val) : '', ...attrs });
  el.addEventListener('change', () => { const v = el.value === '' ? null : Number(String(el.value).replace(',', '.')); onSave(Number.isFinite(v) ? v : null); });
  return el;
}

function morningCard(L) {
  const save = (k) => (v) => { diet.patchDay(cur, (l) => { if (v === null) delete l[k]; else l[k] = v; }); syncSoon(); renderDiet(); };
  const goal = (diet.plan().regole && diet.plan().regole.passi) || 10000;
  const steps = L.steps;
  let neat = null;
  if (Number.isFinite(steps) && steps < goal) {
    const miss = goal - steps;
    const walkMin = Math.max(10, Math.round(miss / 110 / 5) * 5); // ~110 passi al minuto
    neat = h('p', { class: 'neat' }, `Mancano ${fmtNum(miss)} passi. Compensa con ${walkMin} minuti di camminata dopo cena`,
      diet.windowFor(cur) !== 'riposo' ? ' oppure 5–10 minuti di tapis roulant in pendenza 10–11% a fine seduta.' : '.');
  }
  return h('section', { class: 'card morning' },
    h('div', { class: 'm-grid' },
      h('label', {}, h('span', {}, 'Peso a digiuno'), h('span', { class: 'm-in' }, numInput(L.weight, { step: '0.1', min: '30', max: '250', placeholder: '–' }, save('weight')), 'kg')),
      h('label', {}, h('span', {}, 'Vita (ombelico)'), h('span', { class: 'm-in' }, numInput(L.waist, { step: '0.5', min: '40', max: '200', placeholder: '–' }, save('waist')), 'cm')),
      h('label', {}, h('span', {}, 'Passi'), h('span', { class: 'm-in' }, numInput(L.steps, { step: '100', min: '0', max: '100000', placeholder: '–' }, save('steps')), ''))),
    neat);
}

/* ------------------------------ finestra allenamento ------------------------------ */

function windowTip(win, date, g) {
  if (win === 'riposo') return null;
  const wd = diet.weekdayIdx(date);
  if (win === 'sera') {
    return h('div', {}, h('b', {}, 'Allenamento dopo cena. '), 'I carboidrati della cena sono il tuo pre-workout (evidenziati). ',
      g.pasti.giornata ? 'La whey 20 g va dopo l\'allenamento.' : 'Dopo l\'allenamento: 20 g di whey oppure lo spuntino yogurt + frutta.');
  }
  if (wd === 6) return h('div', {}, h('b', {}, 'Domenica. '), 'Lo spuntino yogurt magro + cereali + frutta secca (merenda) è la tua finestra post-workout.');
  return h('div', {}, h('b', {}, 'Allenamento di giorno. '), 'Aspetta almeno 2 ore dalla colazione prima di allenarti. La merenda con whey + frutta va dopo l\'allenamento.');
}
function postWorkoutMeal(win, date) {
  if (win === 'sera') return 'giornata';
  if (win === 'weekend') return 'merenda';
  return null;
}

/* ------------------------------ pasti ------------------------------ */

function mealCard(m, meal, L, win, g) {
  const checked = !!L.meals[m];
  const post = postWorkoutMeal(win, cur) === m;
  const pre = win === 'sera' && m === 'cena';
  const box = h('input', { type: 'checkbox', checked, 'aria-label': `${diet.MEAL_LABEL[m]} fatto`, onchange: () => { diet.patchDay(cur, (l) => { l.meals[m] = box.checked; }); syncSoon(); renderDiet(); } });
  const items = meal.libero
    ? [h('p', { class: 'muted' }, 'Pasto libero settimanale: goditelo, poi torna al piano.')]
    : meal.alimenti.map((a, i) => {
      const c = diet.chosen(cur, m, i);
      const alt = c !== a;
      return h('button', { type: 'button', class: `food${pre && CARB.test(c.nome) ? ' hl' : ''}${alt ? ' alt' : ''}`, onclick: () => foodSheet(m, i) },
        h('span', { class: 'f-n' }, c.nome, c.composto ? h('small', {}, ` (${c.composto.map((x) => `${x.nome} ${fmtQ(x)}`).join(' + ')})`) : null),
        h('span', { class: 'f-q' }, c.composto ? '' : fmtQ(c)),
        a.alternative.length ? h('span', { class: 'f-alt' }, alt ? '↺' : `${a.alternative.length} alt.`) : h('span'));
    });
  const tag = pre ? h('em', { class: 'meal-tag pre' }, 'Pre-workout') : post ? h('em', { class: 'meal-tag post' }, 'Post-workout') : null;
  return h('section', { class: `card meal${checked ? ' done' : ''}` },
    h('label', { class: 'meal-h' }, box, h('b', {}, diet.MEAL_LABEL[m]), tag),
    h('div', { class: 'foods' }, ...items),
    meal.nota ? h('details', { class: 'meal-note' }, h('summary', {}, 'Note della nutrizionista'), h('p', {}, meal.nota)) : null);
}

function foodSheet(m, i) {
  const g = diet.plan().giorni[diet.planDayIdx(cur)];
  const a = g.pasti[m].alimenti[i];
  const sel = diet.dayLog(cur).choices[`${m}|${i}`];
  const pick = (idx) => { diet.patchDay(cur, (l) => { if (idx === null) delete l.choices[`${m}|${i}`]; else l.choices[`${m}|${i}`] = idx; }); sh.close(); renderDiet(); };
  const altList = h('div', { class: 'alt-list' },
    h('button', { type: 'button', class: `alt-row${!Number.isInteger(sel) ? ' on' : ''}`, onclick: () => pick(null) }, h('b', {}, a.nome), h('span', {}, fmtQ(a)), h('small', {}, 'del piano')),
    ...a.alternative.map((x, k) => h('button', { type: 'button', class: `alt-row${sel === k ? ' on' : ''}`, onclick: () => pick(k) },
      h('b', {}, x.nome), h('span', {}, x.composto ? x.composto.map((y) => `${y.nome} ${fmtQ(y)}`).join(' + ') : fmtQ(x)), h('small', {}, x.frequenza || ''))));
  if (!a.alternative.length) altList.append(h('p', { class: 'muted' }, 'Il piano non prevede alternative per questo alimento.'));

  // calcolatrice da etichetta
  const f = { kcal: null, p: null, c: null, f: null };
  const out = h('div', { class: 'calc-out' });
  const calc = () => {
    const r = diet.equivalent(a, f);
    if (!r) { out.replaceChildren(h('p', { class: 'muted' }, `Non ho i valori nutrizionali di «${a.nome}»: la calcolatrice funziona sugli alimenti principali del piano.`)); return; }
    const rows = [];
    if (r.macro) rows.push(h('div', { class: 'calc-res' }, h('b', {}, `${Math.round(r.macro)} g`), h('span', {}, `stesse ${r.macroName} di ${fmtQ(a)} di ${a.nome}`)));
    if (r.kcal) rows.push(h('div', { class: 'calc-res' }, h('b', {}, `${Math.round(r.kcal)} g`), h('span', {}, `stesse calorie (${Math.round(r.plan.kcal)} kcal)`)));
    if (!rows.length) rows.push(h('p', { class: 'muted' }, 'Inserisci i valori per 100 g dall\'etichetta.'));
    rows.push(h('p', { class: 'hint' }, `Valori medi dell'alimento del piano: ${Math.round(r.plan.p)} g proteine, ${Math.round(r.plan.c)} g carboidrati, ${Math.round(r.plan.f)} g grassi. Indicativo: per cambi abituali chiedi alla nutrizionista.`));
    out.replaceChildren(...rows);
  };
  const fld = (k, t) => h('label', { class: 'calc-f' }, h('span', {}, t), (() => { const e = h('input', { type: 'number', inputmode: 'decimal', step: '0.1', placeholder: '0' }); e.addEventListener('input', () => { f[k] = Number(e.value) || null; calc(); }); return e; })());
  const calcBox = h('div', { class: 'calc', hidden: true },
    h('p', { class: 'muted' }, `Valori per 100 g del prodotto che vuoi usare al posto di ${a.nome} (${fmtQ(a)}):`),
    h('div', { class: 'calc-grid' }, fld('kcal', 'kcal'), fld('p', 'Proteine g'), fld('c', 'Carboidrati g'), fld('f', 'Grassi g')), out);
  calc();
  const tabs = h('div', { class: 'seg' },
    h('button', { type: 'button', role: 'tab', 'aria-selected': 'true', onclick: (ev) => { altList.hidden = false; calcBox.hidden = true; ev.target.setAttribute('aria-selected', 'true'); ev.target.nextSibling.setAttribute('aria-selected', 'false'); } }, 'Alternative del piano'),
    h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', onclick: (ev) => { altList.hidden = true; calcBox.hidden = false; ev.target.setAttribute('aria-selected', 'true'); ev.target.previousSibling.setAttribute('aria-selected', 'false'); } }, 'Fuori lista (etichetta)'));
  const sh = openSheet({ title: `${a.nome} · ${fmtQ(a)}`, content: h('div', { class: 'food-sheet' }, tabs, altList, calcBox) });
}

/* ------------------------------ integratori ------------------------------ */

function suppCard(L) {
  const P = diet.plan();
  const rows = [];
  for (const s of P.integratori) {
    const st = s.id === 'creatina' ? diet.creatineState(cur) : null;
    const off = st && !st.on;
    const box = h('input', { type: 'checkbox', checked: !!L[s.id], disabled: off, onchange: () => { diet.patchDay(cur, (l) => { l[s.id] = box.checked; }); syncSoon(); } });
    rows.push(h('label', { class: `supp${off ? ' off' : ''}` }, box,
      h('span', {}, h('b', {}, s.nome), h('small', {}, s.dose || '')),
      st ? h('em', { class: 'cyc' }, st.on ? `Giorno ${st.day}/${st.of}${st.offIn <= 7 ? ` · stop tra ${st.offIn} gg` : ''}` : `Pausa: riprendi tra ${st.backIn} gg`) : null));
  }
  if (!rows.length) return h('span');
  const cs = diet.creatineState(cur);
  return h('section', { class: 'card' }, h('h2', {}, 'Integratori'), ...rows,
    cs ? h('button', { class: 'link-btn', type: 'button', onclick: () => { diet.setCreaStart(cur); toast('Ciclo di creatina ripartito da oggi', 'ok'); renderDiet(); } }, 'Il ciclo di creatina inizia oggi') : null);
}

/* ------------------------------ frequenze ------------------------------ */

function freqCard() {
  const P = diet.plan();
  const cnt = diet.weekCounts(cur);
  const rows = P.frequenze.map((f) => {
    const n = cnt[f.id] || 0;
    const target = f.max ?? f.min ?? 1;
    const state = f.max != null && n > f.max ? 'over' : f.min != null && n < f.min ? 'under' : 'ok';
    const goal = f.min != null && f.max != null ? (f.min === f.max ? `${f.min}` : `${f.min}–${f.max}`) : f.min != null ? `≥ ${f.min}` : `≤ ${f.max}`;
    return h('div', { class: `freq ${state}` },
      h('span', { class: 'fq-l' }, f.label),
      h('span', { class: 'fq-bar' }, h('i', { style: `width:${Math.min(100, (n / Math.max(1, target)) * 100)}%` })),
      h('span', { class: 'fq-n' }, `${n} / ${goal}`));
  });
  const ad = diet.adherence(cur);
  return h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Questa settimana'), ad != null ? h('span', { class: 'pill' }, `Aderenza ${Math.round(ad * 100)}%`) : null),
    ...rows, h('p', { class: 'hint' }, 'Si aggiorna dai pasti spuntati e dalle alternative che scegli.'));
}

/* ------------------------------ scambio giorni e giorni di allenamento ------------------------------ */

function swapSheet() {
  const P = diet.plan();
  const start = diet.weekStartIso(cur);
  const dates = Array.from({ length: 7 }, (_, k) => diet.addDays(start, k));
  let first = null;
  const list = h('div', { class: 'swap-list' });
  const draw = () => list.replaceChildren(...dates.map((d) => {
    const g = P.giorni[diet.planDayIdx(d)];
    const can = !first || (first !== d && !!P.giorni[diet.planDayIdx(first)].allenamento === !!g.allenamento);
    return h('button', { type: 'button', class: `swap-row${first === d ? ' on' : ''}`, disabled: !can, onclick: () => {
      if (!first) { first = d; draw(); return; }
      if (first === d) { first = null; draw(); return; }
      try { diet.swapDays(first, d); toast('Giorni scambiati ✓', 'ok'); sh.close(); syncSoon(); renderDiet(); } catch (e) { toast(e.message, 'error', 5000); }
    } }, h('b', {}, diet.fromIso(d).toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric' })), h('span', {}, `${g.nome} · ${g.allenamento ? 'allenamento' : 'riposo'}`));
  }));
  draw();
  const sh = openSheet({ title: 'Scambia due giorni', content: h('div', {}, h('p', { class: 'muted' }, 'Tocca il primo giorno, poi il secondo. Come da piano: allenamento solo con allenamento, riposo solo con riposo.'), list,
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { dates.forEach((d) => diet.resetSwap(d)); sh.close(); renderDiet(); } }, 'Annulla gli scambi della settimana')) });
}

function trainingDaysSheet() {
  const P = diet.plan();
  const content = h('div', {}, h('p', { class: 'muted' }, 'Quali giorni del piano sono di allenamento? Decide gli scambi possibili e la finestra pre/post-workout.'),
    ...P.giorni.map((g, i) => {
      const b = h('input', { type: 'checkbox', checked: g.allenamento, onchange: () => { diet.setTraining(i, b.checked); renderDiet(); } });
      return h('label', { class: 'supp' }, b, h('span', {}, h('b', {}, g.nome)));
    }));
  openSheet({ title: 'Giorni di allenamento', content });
}

export function initDiet() {
  diet.subscribe(() => {});
  if (localStorage.getItem('fulcro.dietDirty') && navigator.onLine) setTimeout(syncDietNow, 3000);
}
export const setDietDate = (d) => { cur = d; };
