// dom.js — piccoli attrezzi condivisi dalle schermate di allenamento.
// Il testo dell'utente passa sempre da textContent, mai da innerHTML.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}

const ICONS = {
  plus: 'M12 5v14M5 12h14',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  trash: 'M5 7h14M10 7V5h4v2m-7 0 1 12h8l1-12M10 11v5m4-5v5',
  up: 'm6 14 6-6 6 6',
  down: 'm6 10 6 6 6-6',
  close: 'M6 6l12 12M18 6 6 18',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 4 4',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm0-12v4l3 2M9 2h6',
  bolt: 'M13 3 5 14h6l-1 7 8-11h-6l1-7Z',
  dumbbell: 'M3 9v6m3-8v10m12-10v10m3-8v6M6 12h12',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  chart: 'M4 20V4m0 16h16M8 15l4-4 3 3 5-6',
  lens: 'M4 8V6a2 2 0 0 1 2-2h2m8 0h2a2 2 0 0 1 2 2v2M4 16v2a2 2 0 0 0 2 2h2m8 0h2a2 2 0 0 0 2-2v-2M12 8v8M8 12h8',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v5m0-8h.01',
  edit: 'm4 20 4-1 11-11-3-3L5 16l-1 4Z',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  play: 'M8 5v14l11-7L8 5Z',
};
export function icon(name, size = 22) {
  return svg('svg', { viewBox: '0 0 24 24', width: size, height: size, class: 'ico', 'aria-hidden': 'true' }, svg('path', { d: ICONS[name] || ICONS.info }));
}

export function toast(msg, kind = 'info', ms = 3800) {
  const host = $('#toasts');
  if (!host) return;
  const el = h('div', { class: 'toast', dataset: { kind } }, msg);
  host.append(el);
  setTimeout(() => el.remove(), ms);
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const itDate = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' });
const itDateLong = new Intl.DateTimeFormat('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtDay = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : itDate.format(d); };
export const fmtDayLong = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? '' : itDateLong.format(d); };
export const fmtClock = (iso) => new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
export const fmtDuration = (sec) => {
  const m = Math.max(0, Math.round(sec / 60));
  return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
};
export const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, Math.floor(sec % 60))).padStart(2, '0')}`;
export const fmtNum = (v, d = 0) => (Number.isFinite(v) ? v.toLocaleString('it-IT', { maximumFractionDigits: d }) : '–');
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/** Messaggio leggibile per gli errori di sincronizzazione (mostra anche il testo reale di Google). */
export function explainErr(e) {
  switch (e && e.code) {
    case 'OFFLINE': return 'Sei offline: i dati restano in coda e partono appena torni online.';
    case 'AUTH': return 'Serve riconnettere Google: tocca «Invia» per accedere di nuovo.';
    case 'CONFIG': return e.message;
    case 'ACCESS': return `Accesso al foglio negato (${e.message}). Controlla URL e permessi.`;
    default: return (e && e.message) || 'Errore sconosciuto';
  }
}

/**
 * Pannello a tutto schermo (dialog modale) con intestazione e piede opzionale.
 * @returns {{el:HTMLDialogElement, body:HTMLElement, close:Function}}
 */
export function openSheet({ title, content, foot, onClose, wide = false }) {
  const body = h('div', { class: 'sheet-body' }, content);
  const dlg = h('dialog', { class: `sheet${wide ? ' sheet-wide' : ''}`, 'aria-label': title },
    h('div', { class: 'sheet-head' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Chiudi', onclick: () => dlg.close() }, icon('close'))),
    body,
    foot ? h('div', { class: 'sheet-foot' }, foot) : null);
  dlg.addEventListener('close', () => { dlg.remove(); if (onClose) onClose(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.append(dlg);
  dlg.showModal();
  return { el: dlg, body, close: () => { if (dlg.open) dlg.close(); } };
}

/** Conferma a due tocchi, senza finestre del browser. */
export function confirmTap(btn, label, action) {
  let armed = false, t;
  const original = btn.textContent;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!armed) {
      armed = true; btn.textContent = label; btn.dataset.armed = '1';
      t = setTimeout(() => { armed = false; btn.textContent = original; delete btn.dataset.armed; }, 3500);
    } else { clearTimeout(t); armed = false; action(); }
  });
}
