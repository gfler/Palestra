// viewPrograms.js — schede: elenco, editor (anche incollando il testo), archivio, libreria esercizi.

import { $, h, icon, toast, uid, openSheet, confirmTap, fmtDay, fmtNum } from './dom.js';
import * as store from './store.js';
import { parseProgramText, fmtRest, parseRest, exerciseHistory, exKey } from './training.js';
import { pickExercise, openExercise, thumb } from './exDetail.js';
import { loadDb } from './exdb.js';

const root = () => $('#v-prog');

const repText = (e) => (e.repMin === e.repMax ? `${e.repMin}` : `${e.repMin}-${e.repMax}`);
const summary = (e) => `${e.link ? 'SS · ' : ''}${e.sets} × ${repText(e)}${e.rir ? ` · RIR ${e.rir}` : ''} · rec ${fmtRest(e.restSec)}`;
const clone = (o) => JSON.parse(JSON.stringify(o));

export function renderPrograms() {
  const r = root();
  if (!r) return;
  const all = store.getPrograms();
  const current = store.activeProgram();
  const archived = all.filter((p) => !current || p.id !== current.id).sort((a, b) => (b.archivedAt || '').localeCompare(a.archivedAt || ''));
  const nodes = [];

  nodes.push(h('section', { class: 'hero' },
    h('h1', { class: 'headline' }, 'Le tue schede'),
    h('p', { class: 'lede' }, 'Una scheda alla volta, con quanti giorni vuoi. Quando la cambi, la vecchia va in archivio e i progressi dei singoli esercizi continuano senza interruzioni.')));

  nodes.push(h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openEditor(null) }, icon('plus', 20), ' Nuova scheda'),
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => pickExercise({ onPick: (ex) => openExercise(ex.n, { dbId: ex.id }) }) }, icon('search', 20), ' Libreria esercizi')));

  if (current) {
    const used = store.getWorkouts().filter((w) => w.programId === current.id).length;
    nodes.push(h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, current.name), h('span', { class: 'pill pill-amber' }, 'In uso')),
      h('p', { class: 'muted' }, `Dal ${fmtDay(current.createdAt)} · ${current.days.length} ${current.days.length === 1 ? 'giorno' : 'giorni'} · ${used} ${used === 1 ? 'allenamento' : 'allenamenti'} registrati`),
      ...current.days.map((d) => h('div', { class: 'prog-day' }, h('b', {}, d.name),
        h('ul', { class: 'ex-mini' }, d.exercises.map((e) => h('li', {}, thumb(e.name, e.dbId), h('span', {}, h('b', {}, e.name), h('small', {}, summary(e)))))))),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => openEditor(current) }, icon('edit', 20), ' Modifica'),
        (() => { const b = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Archivia'); confirmTap(b, 'Conferma', () => { store.archiveProgram(current.id); toast('Scheda archiviata'); }); return b; })())));
  } else {
    nodes.push(h('section', { class: 'card empty' }, h('h2', {}, 'Nessuna scheda in uso'), h('p', { class: 'muted' }, 'Creane una nuova o riattiva una scheda archiviata.')));
  }

  if (archived.length) {
    nodes.push(h('details', { class: 'card archive' },
      h('summary', {}, `Schede archiviate (${archived.length})`),
      ...archived.map((p) => {
        const used = store.getWorkouts().filter((w) => w.programId === p.id).length;
        const del = h('button', { class: 'chip-btn danger', type: 'button' }, 'Elimina');
        confirmTap(del, 'Conferma', () => { store.deleteProgram(p.id); toast('Scheda eliminata: lo storico degli allenamenti resta'); });
        return h('div', { class: 'arch-item' },
          h('span', { class: 'arch-t' }, h('b', {}, p.name), h('small', {}, `${fmtDay(p.createdAt)}${p.archivedAt ? ` → ${fmtDay(p.archivedAt)}` : ''} · ${used} allenamenti`)),
          h('span', { class: 'arch-b' },
            h('button', { class: 'chip-btn', type: 'button', onclick: () => { store.useProgram(p.id); toast(`«${p.name}» è di nuovo in uso`, 'ok'); } }, 'Riattiva'),
            h('button', { class: 'chip-btn', type: 'button', onclick: () => openEditor(p) }, 'Apri'),
            del));
      })));
  }
  r.replaceChildren(...nodes);
}

/* ------------------------------------------------------------------ */
/* Editor                                                               */
/* ------------------------------------------------------------------ */

const field = (label, input, wide) => h('label', { class: `field${wide ? ' field-wide' : ''}` }, h('span', {}, label), input);

function blankExercise(name = '') {
  return { id: uid(), name, sets: 3, repMin: 8, repMax: 12, rir: '', restSec: 120, note: '', ref: '', refKg: null, refReps: null, dbId: null };
}

export function openEditor(existing) {
  const isNew = !existing;
  const P = existing ? clone(existing) : store.newProgram('');
  if (isNew) P.days = [{ id: uid(), name: 'Giorno A', exercises: [] }];
  const open = new Set(); // id esercizi aperti

  const nameIn = h('input', { type: 'text', class: 'in-wide', value: P.name, placeholder: 'Es. Forza 8 settimane', maxlength: '80', autocomplete: 'off', 'aria-label': 'Nome scheda' });
  nameIn.addEventListener('input', () => { P.name = nameIn.value; });

  const paste = h('textarea', { rows: '7', class: 'paste', placeholder: "Esercizio  Serie × Rep  RIR  Rec  Rif\nDay A\nChest press macchina 3 × 6-10 1-2 3'\nLat machine presa prona 3 × 6-10 2 3'\nDay B\n…", 'aria-label': 'Testo della scheda' });
  const pasteMsg = h('p', { class: 'hint', role: 'status' }, 'Funziona con righe tipo: «Nome 3 × 8-12 1-2 2\'30"». Le righe corte senza serie×rep diventano i nomi dei giorni (Day A, Giorno 2…).');
  const pasteBox = h('details', { class: 'paste-box' },
    h('summary', {}, 'Incolla la scheda da testo'),
    paste,
    h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => {
      const { days, warnings } = parseProgramText(paste.value, P.days.length ? `Giorno ${String.fromCharCode(65 + P.days.length)}` : 'Giorno A');
      if (!days.length) { pasteMsg.textContent = 'Non ho trovato esercizi. Controlla che ogni riga abbia «serie × rep» (es. 3 × 8-12).'; return; }
      if (isNew && P.days.length === 1 && !P.days[0].exercises.length) P.days = [];
      for (const d of days) P.days.push({ id: uid(), name: d.name, exercises: d.exercises.map((e) => ({ ...blankExercise(e.name), ...e, id: uid() })) });
      paste.value = '';
      const n = days.reduce((a, d) => a + d.exercises.length, 0);
      pasteMsg.textContent = `Letti ${n} esercizi in ${days.length} ${days.length === 1 ? 'giorno' : 'giorni'}${warnings.length ? ` · ${warnings.length} righe non riconosciute` : ''}. Controlla qui sotto.`;
      pasteBox.open = false; paintDays();
    } }, 'Leggi il testo'),
    pasteMsg);

  const daysBox = h('div', { class: 'days' });

  function exerciseEditor(d, e, ei) {
    const sum = h('small', {}, summary(e));
    const form = h('div', { class: 'ex-form', hidden: !open.has(e.id) });
    const nameI = h('input', { type: 'text', value: e.name, maxlength: '80', autocomplete: 'off', 'aria-label': 'Nome esercizio' });
    const title = h('b', {}, e.name || 'Esercizio senza nome');
    nameI.addEventListener('input', () => { e.name = nameI.value; title.textContent = e.name || 'Esercizio senza nome'; });
    const numIn = (key, min, max, step = 1) => {
      const i = h('input', { type: 'number', inputmode: 'decimal', min, max, step, value: e[key] ?? '' });
      i.addEventListener('input', () => {
        const v = parseFloat(i.value.replace(',', '.'));
        e[key] = Number.isFinite(v) ? v : (key === 'refKg' ? null : e[key]);
        if (key === 'repMin' && e.repMax < e.repMin) e.repMax = e.repMin;
        sum.textContent = summary(e);
      });
      return i;
    };
    const rir = h('input', { type: 'text', value: e.rir, placeholder: '1-2', maxlength: '5', autocomplete: 'off' });
    rir.addEventListener('input', () => { e.rir = rir.value.trim(); sum.textContent = summary(e); });
    const rest = h('input', { type: 'text', value: fmtRest(e.restSec), placeholder: "2'30\"", autocomplete: 'off' });
    rest.addEventListener('change', () => { const v = parseRest(rest.value); if (v != null) e.restSec = v; rest.value = fmtRest(e.restSec); sum.textContent = summary(e); });
    const note = h('input', { type: 'text', value: e.note, maxlength: '300', placeholder: 'opzionale', autocomplete: 'off' });
    note.addEventListener('input', () => { e.note = note.value; });
    const repMin = numIn('repMin', 1, 200), repMax = numIn('repMax', 1, 200);
    repMax.addEventListener('input', () => { if (e.repMax < e.repMin) e.repMin = e.repMax; repMin.value = e.repMin; sum.textContent = summary(e); });

    form.append(
      field('Nome', nameI, true),
      h('button', { class: 'btn btn-ghost field-wide', type: 'button', onclick: () => pickExercise({ query: e.name, onPick: (x) => { e.dbId = x.id; store.setLink(exKey(e.name), x.id); toast(`Immagine collegata: ${x.n}`, 'ok'); } }) }, icon('search', 20), ' Collega immagine dalla libreria'),
      field('Serie', numIn('sets', 1, 20)), field('RIR', rir),
      field('Rep min', repMin), field('Rep max', repMax),
      field('Recupero', rest), field('Carico di partenza (kg)', numIn('refKg', 0, 1000, 0.5)),
      field('Nota', note, true),
      h('button', { class: `chip-btn field-wide${e.link ? ' on' : ''}`, type: 'button', 'aria-pressed': String(!!e.link), onclick: (ev) => { e.link = !e.link; ev.currentTarget.classList.toggle('on', e.link); ev.currentTarget.setAttribute('aria-pressed', String(e.link)); } }, 'Superset con l\'esercizio successivo'),
      h('div', { class: 'btn-row field-wide' },
        h('button', { class: 'chip-btn', type: 'button', 'aria-label': 'Sposta su', onclick: () => { if (ei > 0) { [d.exercises[ei - 1], d.exercises[ei]] = [d.exercises[ei], d.exercises[ei - 1]]; paintDays(); } } }, icon('up', 16)),
        h('button', { class: 'chip-btn', type: 'button', 'aria-label': 'Sposta giù', onclick: () => { if (ei < d.exercises.length - 1) { [d.exercises[ei + 1], d.exercises[ei]] = [d.exercises[ei], d.exercises[ei + 1]]; paintDays(); } } }, icon('down', 16)),
        h('button', { class: 'chip-btn danger', type: 'button', onclick: () => { d.exercises.splice(ei, 1); paintDays(); } }, icon('trash', 16), ' Elimina')));

    const head = h('button', { class: 'ex-row', type: 'button', 'aria-expanded': String(open.has(e.id)), onclick: () => {
      if (open.has(e.id)) open.delete(e.id); else open.add(e.id);
      form.hidden = !open.has(e.id); head.setAttribute('aria-expanded', String(open.has(e.id)));
    } }, thumb(e.name, e.dbId), h('span', { class: 'ex-row-t' }, title, sum), icon('down', 18));
    return h('div', { class: 'ex-edit' }, head, form);
  }

  function paintDays() {
    daysBox.replaceChildren(...P.days.map((d, di) => {
      const dn = h('input', { type: 'text', class: 'day-name', value: d.name, maxlength: '60', 'aria-label': 'Nome del giorno', autocomplete: 'off' });
      dn.addEventListener('input', () => { d.name = dn.value; });
      const delDay = h('button', { class: 'chip-btn danger', type: 'button' }, icon('trash', 16));
      confirmTap(delDay, 'Conferma', () => { P.days.splice(di, 1); paintDays(); });
      return h('section', { class: 'card day-card' },
        h('div', { class: 'day-head' }, dn, delDay),
        ...d.exercises.map((e, ei) => exerciseEditor(d, e, ei)),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { const e = blankExercise(''); d.exercises.push(e); open.add(e.id); paintDays(); } }, icon('plus', 20), ' Esercizio'));
    }), h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { P.days.push({ id: uid(), name: `Giorno ${String.fromCharCode(65 + P.days.length)}`, exercises: [] }); paintDays(); } }, icon('plus', 20), ' Aggiungi giorno'));
  }

  const hasCurrent = store.activeProgram() && (!existing || store.activeProgram().id !== existing.id);
  const save = (makeActive) => {
    if (!P.name.trim()) { toast('Dai un nome alla scheda', 'error'); nameIn.focus(); return; }
    const total = P.days.reduce((a, d) => a + d.exercises.filter((e) => e.name.trim()).length, 0);
    if (!total) { toast('Aggiungi almeno un esercizio', 'error'); return; }
    store.saveProgram(P, { makeActive });
    sheet.close();
    toast(makeActive ? 'Scheda salvata e in uso ✓' : 'Scheda salvata ✓', 'ok');
    loadDb().catch(() => {});
  };
  const foot = isNew
    ? [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => save(true) }, hasCurrent ? 'Salva e usa (archivia la vecchia)' : 'Salva e usa questa scheda'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => save(false) }, 'Salva senza attivare')]
    : [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => save(false) }, 'Salva modifiche')];

  const sheet = openSheet({ title: isNew ? 'Nuova scheda' : 'Modifica scheda', content: [field('Nome della scheda', nameIn, true), pasteBox, daysBox], foot, wide: true });
  paintDays();
}

export { exerciseHistory, fmtNum };
