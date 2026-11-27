// exDetail.js — scheda di un esercizio (immagini, muscoli, istruzioni, storico, record) e scelta dalla libreria.

import { h, icon, openSheet, toast, fmtDay, fmtNum } from './dom.js';
import { loadDb, getDb, dbError, resolve, search, imgUrl } from './exdb.js';
import { exKey, exerciseHistory, records, est1RM, muscleIt, EQUIPMENT_IT, fmtKg, norm } from './training.js';
import { getWorkouts, setLink } from './store.js';
import { guessProfile } from './movements.js';

let techHandler = () => {};
export const onAnalyzeTechnique = (fn) => { techHandler = fn; };
export const analyze = (o) => techHandler(o);

export { guessProfile };

const photo = (ex, i = 0) => {
  if (!ex || !ex.im[i]) return null;
  const img = h('img', { class: 'ex-img', src: imgUrl(ex.im[i]), alt: `${ex.n}, posizione ${i + 1}`, loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => { img.classList.add('broken'); img.alt = ''; });
  img.addEventListener('load', () => img.classList.add('ok'));
  return img;
};

/** Miniatura per elenchi (può essere null finché la libreria non è caricata). */
export function thumb(name, dbId) {
  const slot = h('span', { class: 'thumb' });
  const fill = () => {
    const { ex } = resolve(name, dbId);
    const img = ex && photo(ex, 0);
    if (img) { img.className = 'thumb-img'; slot.replaceChildren(img); }
  };
  if (getDb()) fill(); else loadDb().then(fill).catch(() => {});
  return slot;
}

/* ------------------------------ scelta dalla libreria ------------------------------ */

const MUSCLES = ['chest', 'lats', 'middle back', 'shoulders', 'biceps', 'triceps', 'quadriceps', 'hamstrings', 'glutes', 'calves', 'abdominals'];

export function pickExercise({ query = '', onPick }) {
  const list = h('div', { class: 'pick-list' });
  const input = h('input', { type: 'search', class: 'pick-q', placeholder: 'Cerca (anche in italiano: «lat machine»)', value: query, autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Cerca esercizio' });
  let muscle = null;
  const chips = h('div', { class: 'chips-wrap pick-chips' }, MUSCLES.map((m) => h('button', {
    type: 'button', class: 'chip-btn', onclick: (e) => {
      muscle = muscle === m ? null : m;
      chips.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
      if (muscle) e.currentTarget.classList.add('on');
      render();
    },
  }, muscleIt(m))));
  const sheet = openSheet({ title: 'Libreria esercizi', content: [input, chips, list], wide: true });

  const row = (ex) => h('button', {
    type: 'button', class: 'pick-row', onclick: () => { sheet.close(); onPick(ex); },
  }, h('span', { class: 'thumb' }, photo(ex, 0)), h('span', { class: 'pick-t' }, h('b', {}, ex.n), h('small', {}, [ex.m.map(muscleIt).join(', '), EQUIPMENT_IT[ex.e] || ex.e].filter(Boolean).join(' · '))));

  function render() {
    const db = getDb();
    list.replaceChildren();
    if (!db) {
      list.append(dbError()
        ? h('p', { class: 'muted' }, 'Non riesco a scaricare la libreria (serve internet la prima volta). Puoi comunque usare l\'app senza immagini.')
        : h('p', { class: 'muted' }, 'Carico la libreria…'));
      return;
    }
    const q = input.value.trim();
    let items;
    if (q) {
      items = search(q, 30).map((r) => r.ex);
      if (muscle) items = items.filter((e) => e.m.includes(muscle));
    } else if (muscle) items = db.filter((e) => e.m.includes(muscle) && e.c === 'strength').slice(0, 40);
    else items = [];
    if (!items.length) { list.append(h('p', { class: 'muted' }, q || muscle ? 'Nessun risultato: prova un nome inglese (es. «lat pulldown»).' : 'Scrivi un nome o scegli un muscolo.')); return; }
    list.append(...items.map(row));
  }
  input.addEventListener('input', render);
  render();
  if (!getDb()) loadDb().then(render).catch(render);
  return sheet;
}

/* ------------------------------ scheda esercizio ------------------------------ */

/**
 * @param name   nome esercizio come lo scrive l'utente
 * @param opts   { dbId, kg, onChange }
 */
export function openExercise(name, { dbId = null, kg = null, onChange } = {}) {
  const key = exKey(name);
  const media = h('div', { class: 'ex-media' });
  const meta = h('div', { class: 'ex-meta' });
  const how = h('div', { class: 'ex-how' });
  const hist = h('div', { class: 'ex-hist' });
  const linkNote = h('p', { class: 'hint' });

  const paint = () => {
    const { ex, auto } = resolve(name, dbId);
    media.replaceChildren(); meta.replaceChildren(); how.replaceChildren();
    if (ex) {
      media.append(...[0, 1].map((i) => photo(ex, i)).filter(Boolean));
      meta.append(...ex.m.map((m) => h('span', { class: 'pill pill-amber' }, muscleIt(m))), ...ex.s.slice(0, 3).map((m) => h('span', { class: 'pill' }, muscleIt(m))),
        ...(ex.e ? [h('span', { class: 'pill pill-cyan' }, EQUIPMENT_IT[ex.e] || ex.e)] : []));
      how.append(h('h3', {}, 'Come si esegue'), h('ol', { class: 'steps' }, ex.ins.map((s) => h('li', {}, s))),
        h('p', { class: 'hint' }, 'Istruzioni in inglese (libreria pubblica Free Exercise DB).'));
      linkNote.textContent = auto ? `Immagine suggerita: «${ex.n}». Se non è quella giusta, scegline un'altra.` : `Collegato a «${ex.n}».`;
    } else if (getDb()) {
      linkNote.textContent = 'Nessuna immagine collegata. Cercala nella libreria.';
    } else {
      linkNote.textContent = dbError() ? 'Libreria non raggiungibile: serve internet la prima volta.' : 'Carico la libreria…';
    }
  };

  const h1 = exerciseHistory(getWorkouts(), key);
  if (!h1.length) hist.append(h('p', { class: 'muted' }, 'Ancora nessuna serie registrata per questo esercizio.'));
  else {
    const rec = records(h1);
    hist.append(
      h('h3', {}, 'I tuoi numeri'),
      h('div', { class: 'kpis kpis-3' },
        h('div', { class: 'kpi' }, h('b', {}, fmtKg(rec.kg)), h('small', {}, 'kg massimo')),
        h('div', { class: 'kpi' }, h('b', {}, fmtKg(Math.round(rec.e1rm * 10) / 10)), h('small', {}, '1RM stimato')),
        h('div', { class: 'kpi' }, h('b', {}, String(h1.length)), h('small', {}, 'sedute'))),
      h('ul', { class: 'hist-list' }, h1.slice(-5).reverse().map((s) => h('li', {},
        h('span', {}, fmtDay(s.date)),
        h('span', { class: 'muted' }, s.sets.map((x) => `${fmtKg(x.kg)}×${x.reps}`).join('  ')),
        h('i', { class: 'muted' }, s.programName || '')))));
  }

  const btnTech = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { sheet.close(); techHandler({ name, kg }); } }, icon('lens', 20), ' Analizza la tecnica da video');
  const btnImg = h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => pickExercise({
    query: name, onPick: (ex) => { setLink(key, ex.id); dbId = ex.id; paint(); if (onChange) onChange(ex); toast('Immagine collegata ✓', 'ok'); },
  }) }, icon('search', 20), ' Scegli immagine');

  const sheet = openSheet({ title: name, content: [media, meta, linkNote, btnImg, how, hist], foot: btnTech, wide: true });
  paint();
  if (!getDb()) loadDb().then(paint).catch(paint);
  return sheet;
}

export { fmtNum, est1RM };
