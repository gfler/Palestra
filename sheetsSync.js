// sheetsSync.js — collegamento a Google Sheets con due metodi:
//  1. «Apps Script» (consigliato): un piccolo script nel foglio riceve le righe. Nessun login, non scade mai, funziona anche nell'APK.
//  2. OAuth (Google Identity Services + Sheets API v4): il token dura ~1 ora e va rinnovato.

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
export const TAB = 'Log_Allenamenti';
export const WEEK_TAB = 'Riepilogo_Settimanale';
export const HEADER = [
  'Data', 'Ora', 'Scheda', 'Esercizio', 'Carico_kg', 'Rep_Totali', 'Rep_Valide',
  'Tempo_Ecc_Medio_s', 'Tempo_Conc_Medio_s', 'Angolo_Min_Medio', 'Deviazione_Traiettoria',
  'Verdetto_Tecnico', 'Note', 'Perdita_Velocita_Pct',
];
const WEEK_HEADER = [
  'Settimana', 'Esercizio', 'Serie', 'Rep_Totali', 'Rep_Valide', 'Pct_Valide',
  'Carico_Medio_kg', 'Tonnellaggio_kg', 'Tempo_Ecc_Medio_s', 'Tempo_Conc_Medio_s', 'Perdita_Velocita_Media_Pct',
];

/* ------------------------------ storage ------------------------------ */

const KEYS = {
  clientId: 'fulcro.clientId',
  sheetUrl: 'fulcro.sheetUrl',
  autoSync: 'fulcro.autoSync',
  weekly: 'fulcro.weekly',
  gemini: 'fulcro.geminiKey',
  queue: 'fulcro.queue',
  scriptUrl: 'fulcro.scriptUrl',
  scriptKey: 'fulcro.scriptKey',
};

/** Nell'APK (Capacitor) il login Google in WebView è bloccato: si usa solo Apps Script. */
export const isNativeApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

function lsGet(key, def) {
  try { const v = localStorage.getItem(key); return v === null ? def : JSON.parse(v); } catch { return def; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota o privato */ }
}

export function getSettings() {
  return {
    clientId: lsGet(KEYS.clientId, ''),
    sheetUrl: lsGet(KEYS.sheetUrl, ''),
    autoSync: lsGet(KEYS.autoSync, false),
    weekly: lsGet(KEYS.weekly, true),
    geminiKey: lsGet(KEYS.gemini, ''),
    scriptUrl: lsGet(KEYS.scriptUrl, ''),
    scriptKey: lsGet(KEYS.scriptKey, ''),
  };
}

const useScript = () => { const s = getSettings(); return !!s.scriptUrl || isNativeApp(); };
export const method = () => (useScript() ? 'script' : 'oauth');

export function saveSettings(s) {
  lsSet(KEYS.clientId, (s.clientId || '').trim());
  lsSet(KEYS.sheetUrl, (s.sheetUrl || '').trim());
  lsSet(KEYS.autoSync, !!s.autoSync);
  lsSet(KEYS.weekly, !!s.weekly);
  lsSet(KEYS.gemini, (s.geminiKey || '').trim());
  if (s.scriptUrl !== undefined) lsSet(KEYS.scriptUrl, (s.scriptUrl || '').trim());
  if (s.scriptKey !== undefined) lsSet(KEYS.scriptKey, (s.scriptKey || '').trim());
  ready = false; // le impostazioni possono cambiare foglio
}

export function parseSpreadsheetId(url) {
  const m = /spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url || '');
  return m ? m[1] : null;
}

/* ------------------------------ autenticazione ------------------------------ */

let token = null;
let tokenExp = 0;
let ready = false;

export const isConnected = () => (useScript() ? !!getSettings().scriptUrl : !!token && Date.now() < tokenExp);

function waitForGis(timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = () => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error('Libreria Google non raggiungibile (sei offline?)'));
      setTimeout(poll, 100);
    };
    poll();
  });
}

/** Richiede il token OAuth. `interactive:false` tenta solo il rinnovo silenzioso. */
export async function connect({ interactive = true } = {}) {
  if (useScript()) { await scall({ op: 'ping' }); return 'script'; }
  const { clientId } = getSettings();
  if (!clientId) throw new Error('Inserisci il Client ID OAuth nelle impostazioni.');
  await waitForGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        token = r.access_token;
        tokenExp = Date.now() + (Number(r.expires_in || 3600) - 60) * 1000;
        resolve(token);
      },
      error_callback: (e) => reject(new Error(e && e.type === 'popup_closed' ? 'Autorizzazione annullata' : (e && e.message) || 'Autorizzazione non riuscita')),
    });
    client.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

export function disconnect() {
  if (token && window.google && window.google.accounts) {
    try { window.google.accounts.oauth2.revoke(token, () => {}); } catch { /* ignora */ }
  }
  token = null; tokenExp = 0; ready = false;
}

async function gfetch(url, opts = {}, allowInteractive = true) {
  if (!isConnected()) {
    if (!allowInteractive) throw Object.assign(new Error('Non connesso a Google'), { code: 'AUTH' });
    await connect({ interactive: true });
  }
  let res;
  try {
    res = await fetch(url, {
      ...opts,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
    });
  } catch (e) {
    throw Object.assign(new Error('Rete non disponibile'), { code: 'OFFLINE' });
  }
  if (res.status === 401) { token = null; throw Object.assign(new Error('Sessione Google scaduta: riconnetti'), { code: 'AUTH' }); }
  if (!res.ok) {
    let msg = `Errore Google ${res.status}`;
    try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch { /* corpo non JSON */ }
    throw Object.assign(new Error(msg), { code: res.status === 403 || res.status === 404 ? 'ACCESS' : 'API' });
  }
  return res.json();
}

const enc = encodeURIComponent;
function sheetId() {
  const id = parseSpreadsheetId(getSettings().sheetUrl);
  if (!id) throw Object.assign(new Error('Incolla l\'URL completo del Foglio Google nelle impostazioni.'), { code: 'CONFIG' });
  return id;
}

/* ------------------------------ Apps Script ------------------------------ */

const SCRIPT_RE = /^https:\/\/script\.google(usercontent)?\.com\/.+/;
export const isScriptUrl = (u) => SCRIPT_RE.test(String(u || '').trim());

async function scall(payload) {
  const { scriptUrl, scriptKey } = getSettings();
  if (!isScriptUrl(scriptUrl)) throw Object.assign(new Error('Incolla l\'URL dell\'app web di Apps Script nelle impostazioni.'), { code: 'CONFIG' });
  let res;
  try {
    // text/plain evita la richiesta preliminare CORS, che Apps Script non gestisce
    res = await fetch(scriptUrl, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: scriptKey, ...payload }) });
  } catch {
    throw Object.assign(new Error('Rete non disponibile'), { code: 'OFFLINE' });
  }
  let j = null;
  try { j = await res.json(); } catch { /* risposta HTML: script non pubblicato come app web per «Chiunque» */ }
  if (!j) throw Object.assign(new Error('Lo script non risponde: ripubblicalo come App web con accesso «Chiunque».'), { code: 'ACCESS' });
  if (!j.ok) throw Object.assign(new Error(j.error || 'Errore dello script'), { code: /chiave/i.test(j.error || '') ? 'KEY' : 'API' });
  return j;
}

/* ------------------------------ primitive (uguali per i due metodi) ------------------------------ */

async function ensureTab(id, title) {
  const meta = await gfetch(`${API}/${id}?fields=sheets.properties.title`);
  const titles = (meta.sheets || []).map((s) => s.properties.title);
  if (!titles.includes(title)) {
    await gfetch(`${API}/${id}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }) });
  }
}

/** Crea il tab se manca e scrive l'intestazione se la prima riga è vuota. */
async function pEnsure(tab, header) {
  if (useScript()) { await scall({ op: 'ensure', tab, header }); return; }
  const id = sheetId();
  await ensureTab(id, tab);
  const r = await gfetch(`${API}/${id}/values/${enc(`${tab}!A1:Z1`)}`);
  if (!r.values || !r.values.length || !r.values[0].some((c) => String(c).trim() !== '')) {
    await gfetch(`${API}/${id}/values/${enc(`${tab}!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: [header] }) });
  }
}

async function pAppend(tab, header, rows) {
  if (!rows.length) return;
  if (useScript()) { await scall({ op: 'append', tab, header, rows }); return; }
  await pEnsure(tab, header);
  await gfetch(`${API}/${sheetId()}/values/${enc(`${tab}!A1`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`, {
    method: 'POST', body: JSON.stringify({ values: rows }),
  });
}

/** Legge le righe dati (dalla 2ª). Date come numero seriale (OAuth) o testo «aaaa-mm-gg» / «hh:mm» (Apps Script). */
async function pRead(tab, cols) {
  if (useScript()) return (await scall({ op: 'read', tab, range: `A2:${cols}` })).values || [];
  const r = await gfetch(`${API}/${sheetId()}/values/${enc(`${tab}!A2:${cols}`)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  return r.values || [];
}

async function pOverwrite(tab, rows) {
  if (useScript()) { await scall({ op: 'overwrite', tab, rows }); return; }
  const id = sheetId();
  await ensureTab(id, tab);
  await gfetch(`${API}/${id}/values:batchClear`, { method: 'POST', body: JSON.stringify({ ranges: [`${tab}!A1:Z2000`] }) });
  await gfetch(`${API}/${id}/values/${enc(`${tab}!A1`)}?valueInputOption=RAW`, { method: 'PUT', body: JSON.stringify({ values: rows }) });
}

/* ------------------------------ setup foglio ------------------------------ */

/** Crea il foglio Log_Allenamenti se manca e scrive l'intestazione se la prima riga è vuota. */
export async function ensureSheetReady(force = false) {
  if (ready && !force) return;
  await pEnsure(TAB, HEADER);
  ready = true;
}

/* ------------------------------ coda e sync ------------------------------ */

export const getQueue = () => lsGet(KEYS.queue, []);
const setQueue = (q) => lsSet(KEYS.queue, q);

export function seriesToRow(s) {
  return [
    s.date, s.time, s.session, s.exercise, num(s.load), s.total, s.valid,
    num(s.ecc, 2), num(s.conc, 2), num(s.angMin, 0), num(s.dev, 1),
    s.verdict, s.notes || '', num(s.loss, 0),
  ];
}
const num = (v, d = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : '');

export function enqueue(series) {
  const q = getQueue().filter((x) => x.id !== series.id);
  q.push(series);
  setQueue(q);
}

/**
 * Invia la coda. Restituisce gli id sincronizzati.
 * `interactive:false` non apre mai popup (adatto all'evento "online").
 */
export async function flush({ interactive = true } = {}) {
  const q = getQueue();
  if (!q.length) return [];
  if (!navigator.onLine) throw Object.assign(new Error('Offline'), { code: 'OFFLINE' });
  if (!isConnected() && !interactive) throw Object.assign(new Error('Serve un tocco per riconnettere Google'), { code: 'AUTH' });
  await pAppend(TAB, HEADER, q.map(seriesToRow));
  setQueue([]);
  if (getSettings().weekly) {
    try { await updateWeekly(); } catch (e) { console.warn('Riepilogo settimanale non aggiornato', e); }
  }
  return q.map((x) => x.id);
}

/** Mette in coda e prova subito l'invio. Esito: 'saved' | 'queued'. */
export async function syncSeries(series, { interactive = true } = {}) {
  enqueue(series);
  try {
    const ids = await flush({ interactive });
    return { status: 'saved', ids };
  } catch (e) {
    return { status: 'queued', error: e };
  }
}


/* ------------------------------ allenamento: serie di dettaglio ------------------------------ */

export const T_TAB = 'Serie_Dettaglio';
export const T_HEADER = [
  'Data', 'Ora', 'Programma', 'Giorno', 'Esercizio', 'Serie', 'Tipo', 'Kg', 'Rep', 'RIR', 'Recupero_s', 'Nota', '1RM_Stimato',
];
const TQ_KEY = 'fulcro.tqueue';

export const isConfigured = () => {
  const st = getSettings();
  return useScript() ? isScriptUrl(st.scriptUrl) : !!(st.clientId && parseSpreadsheetId(st.sheetUrl));
};
export const getTrainQueue = () => lsGet(TQ_KEY, []);

/** Mette in coda le righe di un allenamento (idempotente per id). */
export function enqueueWorkout(id, rows) {
  const q = getTrainQueue().filter((x) => x.id !== id);
  q.push({ id, rows });
  lsSet(TQ_KEY, q);
}

export async function flushTraining({ interactive = true } = {}) {
  const q = getTrainQueue();
  if (!q.length) return [];
  if (!navigator.onLine) throw Object.assign(new Error('Offline'), { code: 'OFFLINE' });
  if (!isConnected() && !interactive) throw Object.assign(new Error('Serve un tocco per riconnettere Google'), { code: 'AUTH' });
  await pAppend(T_TAB, T_HEADER, q.flatMap((x) => x.rows));
  lsSet(TQ_KEY, []);
  return q.map((x) => x.id);
}

/* ------------------------------ lettura storico ------------------------------ */

function serialToDate(v) {
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
const isoDay = (d) => d.toISOString().slice(0, 10);

const readLog = () => pRead(TAB, 'N');

/** Importa lo storico dal foglio: serve al confronto con la serie precedente. */
export async function importHistory() {
  await ensureSheetReady();
  const rows = await readLog();
  const out = [];
  for (const r of rows) {
    const d = serialToDate(r[0]);
    if (!d || !r[3]) continue;
    const frac = typeof r[1] === 'number' ? r[1] : 0;
    const mins = Math.round(frac * 1440);
    const time = typeof r[1] === 'number' ? `${String(Math.floor(mins / 60) % 24).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}` : String(r[1] || '00:00');
    const date = isoDay(d);
    out.push({
      id: `sheet|${date}|${time}|${String(r[3]).toLowerCase()}`,
      source: 'sheet', date, time, ts: `${date}T${time}`,
      session: r[2] || '', exercise: String(r[3]), load: Number(r[4]) || 0,
      total: Number(r[5]) || 0, valid: Number(r[6]) || 0,
      ecc: Number(r[7]), conc: Number(r[8]), angMin: Number(r[9]), dev: Number(r[10]),
      verdict: r[11] || '', notes: r[12] || '', loss: r[13] === '' || r[13] == null ? null : Number(r[13]),
    });
  }
  return out;
}

/* ------------------------------ riepilogo settimanale ------------------------------ */

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((d - y0) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

export async function updateWeekly() {
  const rows = await readLog();
  const groups = new Map();
  for (const r of rows) {
    const d = serialToDate(r[0]);
    if (!d || !r[3]) continue;
    const key = `${isoWeek(d)}|${String(r[3]).trim()}`;
    const g = groups.get(key) || { week: isoWeek(d), ex: String(r[3]).trim(), n: 0, tot: 0, val: 0, load: [], ton: 0, ecc: [], conc: [], loss: [] };
    const load = Number(r[4]) || 0, tot = Number(r[5]) || 0;
    g.n++; g.tot += tot; g.val += Number(r[6]) || 0; g.load.push(load); g.ton += load * tot;
    if (Number.isFinite(Number(r[7])) && r[7] !== '') g.ecc.push(Number(r[7]));
    if (Number.isFinite(Number(r[8])) && r[8] !== '') g.conc.push(Number(r[8]));
    if (r[13] !== '' && r[13] != null && Number.isFinite(Number(r[13]))) g.loss.push(Number(r[13]));
    groups.set(key, g);
  }
  const avg = (a, d = 1) => (a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10 ** d) / 10 ** d : '');
  const out = [...groups.values()]
    .sort((a, b) => (a.week === b.week ? a.ex.localeCompare(b.ex) : b.week.localeCompare(a.week)))
    .map((g) => [g.week, g.ex, g.n, g.tot, g.val, g.tot ? Math.round((g.val / g.tot) * 100) : '', avg(g.load), Math.round(g.ton), avg(g.ecc, 2), avg(g.conc, 2), avg(g.loss, 0)]);
  await pOverwrite(WEEK_TAB, [WEEK_HEADER, ...out]);
}

/* ------------------------------ appunti ------------------------------ */

export function buildSessionText(items, dateLabel) {
  if (!items.length) return '';
  const lines = [`Sessione ${items[0].session} — ${dateLabel}`, ''];
  items.forEach((s, i) => {
    const bits = [
      `${s.total} rep (${s.valid} valide)`,
      `ecc ${fmtN(s.ecc, 1)}s / conc ${fmtN(s.conc, 1)}s`,
      Number.isFinite(s.angMin) ? `angolo min ${Math.round(s.angMin)}°` : null,
      Number.isFinite(s.dev) ? `dev. ${fmtN(s.dev, 0)}%` : null,
      Number.isFinite(s.loss) ? `perdita vel. ${Math.round(s.loss)}%` : null,
    ].filter(Boolean);
    lines.push(`${i + 1}) ${s.exercise} — ${s.load || 0} kg: ${bits.join(' · ')}`);
    if (s.notes) lines.push(`   Note: ${s.notes}`);
    lines.push(`   ${s.verdict}`);
  });
  return lines.join('\n');
}
const fmtN = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '–');

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback per contesti senza permesso clipboard
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

/* ------------------------------ AI Coach (Gemini) ------------------------------ */

const COACH_PROMPT = 'Sei un coach di forza esperto in biomeccanica. Ricevi SOLO un JSON con le metriche di una serie ' +
  'analizzata da un\'app (nessun video). Rispondi in italiano, in modo diretto, massimo 140 parole: ' +
  '1) cosa funziona, 2) i due errori più importanti con una correzione pratica ciascuno, 3) un\'indicazione su carico o recupero ' +
  'basata su tempi e perdita di velocità. Non inventare dati che non sono nel JSON e ricorda che le misure 2D hanno margine di errore.';

export async function askCoach(apiKey, payload) {
  let res;
  try {
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: COACH_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload) }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
  } catch {
    throw new Error('Rete non disponibile');
  }
  if (!res.ok) {
    let msg = `Errore Gemini ${res.status}`;
    try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch { /* non JSON */ }
    throw new Error(msg);
  }
  const j = await res.json();
  const text = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts
    ? j.candidates[0].content.parts.map((p) => p.text || '').join('').trim() : '';
  if (!text) throw new Error('Risposta vuota da Gemini');
  return text;
}

/** Domanda libera a Gemini con un'istruzione di sistema propria. */
export async function askGemini(apiKey, system, text) {
  let res;
  try {
    res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { temperature: 0.5, maxOutputTokens: 1200, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
  } catch { throw new Error('Rete non disponibile'); }
  if (!res.ok) {
    let msg = `Errore Gemini ${res.status}`;
    try { const j = await res.json(); msg = (j.error && j.error.message) || msg; } catch { /* non JSON */ }
    throw new Error(msg);
  }
  const j = await res.json();
  const out = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts
    ? j.candidates[0].content.parts.map((p) => p.text || '').join('').trim() : '';
  if (!out) throw new Error('Risposta vuota da Gemini');
  return out;
}
