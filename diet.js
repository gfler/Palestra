// diet.js — dati del piano alimentare e del diario quotidiano (dieta, integratori, peso, vita, passi).
// Tutto resta sul dispositivo (localStorage); su Google Sheets va una copia (Dieta_Log, Dieta_Piano).

const KEY = 'fulcro.diet';
export const WEEK = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
export const MEAL_ORDER = ['colazione', 'spuntino', 'pranzo', 'merenda', 'cena', 'giornata'];
export const MEAL_LABEL = { colazione: 'Colazione', spuntino: 'Spuntino mattina', pranzo: 'Pranzo', merenda: 'Merenda', cena: 'Cena', giornata: "Nell'arco della giornata" };

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
let D = Object.assign({ plan: null, log: {}, creaStart: null, stepsGoal: 10000 }, read());
const subs = new Set();
export const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(D)); } catch { /* spazio pieno */ }
  subs.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
}
export const get = () => D;

/* ------------------------------ date ------------------------------ */

export const isoDate = (d = new Date()) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
export const fromIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = fromIso(s); d.setDate(d.getDate() + n); return isoDate(d); };
export const weekdayIdx = (s) => (fromIso(s).getDay() + 6) % 7; // 0 = lunedì
export const weekStartIso = (s) => addDays(s, -weekdayIdx(s));

/* ------------------------------ piano ------------------------------ */

/** Valida e normalizza un piano Fulcro (tipo «fulcro-dieta»). */
export function importPlan(text) {
  let p;
  try { p = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new Error('Il file non è un JSON valido.'); }
  if (!p || !Array.isArray(p.giorni) || !p.giorni.length) throw new Error('Nel file non trovo i giorni del piano («giorni»).');
  p.giorni = p.giorni.slice(0, 7).map((g, i) => ({
    nome: String(g.nome || WEEK[i]), allenamento: !!g.allenamento,
    pasti: Object.fromEntries(Object.entries(g.pasti || {}).filter(([k]) => MEAL_ORDER.includes(k)).map(([k, m]) => [k, {
      alimenti: (m.alimenti || []).map((a) => ({ nome: String(a.nome), qta: Number(a.qta) || 0, unita: String(a.unita || 'g'), frequenza: a.frequenza || '', alternative: a.alternative || [] })),
      nota: String(m.nota || ''), libero: !!m.libero,
    }])),
  }));
  p.frequenze = Array.isArray(p.frequenze) ? p.frequenze : [];
  p.categorie = Array.isArray(p.categorie) ? p.categorie : [];
  p.integratori = Array.isArray(p.integratori) ? p.integratori : [];
  p.nutrienti = p.nutrienti && p.nutrienti.kcal_p_c_g ? p.nutrienti : { kcal_p_c_g: {} };
  p.importedAt = new Date().toISOString();
  D.plan = p;
  if (!D.creaStart && p.integratori.some((x) => x.id === 'creatina')) D.creaStart = isoDate();
  save();
  return p;
}
export const plan = () => D.plan;
export function setTraining(dayIdx, on) { if (!D.plan) return; D.plan.giorni[dayIdx].allenamento = !!on; save(); }

/* ------------------------------ diario ------------------------------ */

export function dayLog(date) {
  return D.log[date] || { meals: {}, choices: {} };
}
export function patchDay(date, fn) {
  const l = D.log[date] || (D.log[date] = { meals: {}, choices: {} });
  fn(l);
  l.updatedAt = new Date().toISOString();
  save();
}
/** Indice del giorno del piano usato in quella data (scambi inclusi). */
export const planDayIdx = (date) => { const l = D.log[date]; return l && Number.isInteger(l.planDay) ? l.planDay : weekdayIdx(date); };

/** Scambia i giorni di piano di due date: allenamento solo con allenamento, riposo solo con riposo. */
export function swapDays(a, b) {
  const p = D.plan;
  const ia = planDayIdx(a), ib = planDayIdx(b);
  if (!!p.giorni[ia].allenamento !== !!p.giorni[ib].allenamento) {
    throw new Error('Si possono scambiare solo giorni dello stesso tipo: allenamento con allenamento, riposo con riposo.');
  }
  patchDay(a, (l) => { l.planDay = ib; l.choices = {}; });
  patchDay(b, (l) => { l.planDay = ia; l.choices = {}; });
}
export function resetSwap(date) { patchDay(date, (l) => { delete l.planDay; l.choices = {}; }); }

/** Finestra di allenamento: riposo, sera (dopo cena) o weekend (mattina/pomeriggio). */
export function windowFor(date) {
  const l = D.log[date];
  if (l && l.window) return l.window;
  const g = D.plan && D.plan.giorni[planDayIdx(date)];
  if (!g || !g.allenamento) return 'riposo';
  return weekdayIdx(date) >= 5 ? 'weekend' : 'sera';
}

/** Alimento scelto per una voce del pasto (principale o alternativa). */
export function chosen(date, meal, i) {
  const g = D.plan.giorni[planDayIdx(date)];
  const a = g.pasti[meal].alimenti[i];
  const c = dayLog(date).choices[`${meal}|${i}`];
  return Number.isInteger(c) && a.alternative[c] ? a.alternative[c] : a;
}

/* ------------------------------ frequenze settimanali ------------------------------ */

export function categoryOf(name) {
  const n = String(name || '').toLowerCase();
  for (const [id, re] of (D.plan ? D.plan.categorie : [])) if (new RegExp(re, 'i').test(n)) return id;
  return null;
}
function itemsOf(it) { return it.composto ? it.composto : [it]; }

export function weekCounts(anyDate) {
  const out = {};
  if (!D.plan) return out;
  const start = weekStartIso(anyDate);
  for (let k = 0; k < 7; k++) {
    const date = addDays(start, k);
    const l = D.log[date];
    if (!l) continue;
    const g = D.plan.giorni[planDayIdx(date)];
    for (const meal of MEAL_ORDER) {
      if (!l.meals[meal] || !g.pasti[meal]) continue;
      if (g.pasti[meal].libero) { out.libero = (out.libero || 0) + 1; continue; }
      const cats = new Set();
      g.pasti[meal].alimenti.forEach((_, i) => itemsOf(chosen(date, meal, i)).forEach((x) => { const c = categoryOf(x.nome); if (c) cats.add(c); }));
      cats.forEach((c) => { out[c] = (out[c] || 0) + 1; });
    }
    if (l.libero) out.libero = (out.libero || 0) + 1;
  }
  return out;
}

/* ------------------------------ integratori ------------------------------ */

export function creatineState(date) {
  const sup = D.plan && D.plan.integratori.find((x) => x.id === 'creatina');
  if (!sup || !D.creaStart) return null;
  const on = sup.cicloOn || 75, off = sup.cicloOff || 14;
  const n = Math.round((fromIso(date) - fromIso(D.creaStart)) / 864e5);
  if (n < 0) return { on: true, day: 0, of: on };
  const k = n % (on + off);
  return k < on ? { on: true, day: k + 1, of: on, offIn: on - k } : { on: false, day: k - on + 1, of: off, backIn: on + off - k };
}
export function setCreaStart(date) { D.creaStart = date; save(); }

/* ------------------------------ sostituzioni fuori lista ------------------------------ */

/**
 * Grammi di un prodotto da etichetta equivalenti all'alimento del piano.
 * @returns { kcal, macro, macroName } grammi iso-calorici e iso-macro (macro prevalente dell'alimento del piano)
 */
export function equivalent(planItem, label) {
  const N = (D.plan && D.plan.nutrienti.kcal_p_c_g[planItem.nome]) || null;
  if (!N) return null;
  const qty = planItem.qta;
  const [kcal, p, c, f] = N.map((v) => (v * qty) / 100);
  const res = {};
  if (label.kcal > 0) res.kcal = (kcal / label.kcal) * 100;
  const macros = [['proteine', p, label.p], ['carboidrati', c, label.c], ['grassi', f, label.f]];
  const main = macros.slice().sort((a, b) => b[1] * (b[0] === 'grassi' ? 9 : 4) - a[1] * (a[0] === 'grassi' ? 9 : 4))[0];
  if (main[2] > 0) { res.macro = (main[1] / main[2]) * 100; res.macroName = main[0]; }
  res.plan = { kcal, p, c, f };
  return res;
}

/* ------------------------------ corpo ------------------------------ */

export function bodySeries() {
  return Object.entries(D.log).filter(([, l]) => Number.isFinite(l.weight) || Number.isFinite(l.waist) || Number.isFinite(l.steps))
    .sort(([a], [b]) => a.localeCompare(b)).map(([date, l]) => ({ date, weight: l.weight, waist: l.waist, steps: l.steps }));
}
/** Media mobile a 7 giorni di calendario (usa le pesate presenti nella finestra). */
export function movingAvg(series, key, days = 7) {
  return series.map((r) => {
    const from = addDays(r.date, -(days - 1));
    const w = series.filter((x) => x.date >= from && x.date <= r.date && Number.isFinite(x[key])).map((x) => x[key]);
    return w.length ? w.reduce((a, b) => a + b, 0) / w.length : NaN;
  });
}

/** Aderenza: pasti spuntati / pasti previsti nei giorni registrati della settimana. */
export function adherence(anyDate) {
  if (!D.plan) return null;
  const start = weekStartIso(anyDate);
  let done = 0, tot = 0;
  for (let k = 0; k < 7; k++) {
    const date = addDays(start, k);
    if (date > isoDate()) break;
    const g = D.plan.giorni[planDayIdx(date)];
    const l = D.log[date];
    for (const m of MEAL_ORDER) if (g.pasti[m]) { tot++; if (l && l.meals[m]) done++; }
  }
  return tot ? done / tot : null;
}

/* ------------------------------ righe per Google Sheets ------------------------------ */

export const LOG_HEADER = ['Data', 'Giorno_Piano', 'Finestra_Workout', 'Pasti_Completati', 'Creatina', 'Omega3', 'Pasto_Libero', 'Peso_kg', 'Vita_cm', 'Passi', 'Note'];
export function logRows() {
  const rows = [LOG_HEADER];
  for (const [date, l] of Object.entries(D.log).sort(([a], [b]) => a.localeCompare(b))) {
    const g = D.plan ? D.plan.giorni[planDayIdx(date)] : null;
    const meals = g ? MEAL_ORDER.filter((m) => g.pasti[m]) : [];
    rows.push([
      date, g ? g.nome : '', windowFor(date),
      g ? `${meals.filter((m) => l.meals[m]).length}/${meals.length}` : '',
      l.creatina ? 'sì' : '', l.omega3 ? 'sì' : '', (l.libero || (g && meals.some((m) => g.pasti[m].libero && l.meals[m]))) ? 'sì' : '',
      Number.isFinite(l.weight) ? l.weight : '', Number.isFinite(l.waist) ? l.waist : '', Number.isFinite(l.steps) ? l.steps : '', l.note || '',
    ]);
  }
  return rows;
}
export function planRows() {
  if (!D.plan) return [['Versione', 'Data_Caricamento', 'JSON_Piano']];
  const json = JSON.stringify(D.plan);
  const parts = [];
  for (let i = 0; i < json.length; i += 45000) parts.push(json.slice(i, i + 45000)); // limite di 50.000 caratteri per cella
  return [['Versione', 'Data_Caricamento', ...parts.map((_, i) => (i ? `JSON_Piano_${i + 1}` : 'JSON_Piano'))], [D.plan.versione || '', D.plan.importedAt || '', ...parts]];
}
