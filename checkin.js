// checkin.js — check-in lampo prima della seduta (energia, sonno, fastidi) e adattamento dell'allenamento.

import { h } from './dom.js';
import { profileFromName } from './movements.js';

const Q = [
  ['energy', 'Energia', [['low', 'Bassa'], ['ok', 'Normale'], ['high', 'Alta']]],
  ['sleep', 'Sonno', [['bad', 'Scarso'], ['ok', 'Ok'], ['good', 'Buono']]],
  ['pain', 'Fastidi', [['none', 'Nessuno'], ['knee', 'Ginocchio'], ['shoulder', 'Spalla'], ['back', 'Schiena']]],
];
const KNEE = ['squat', 'knee_press', 'knee_iso'];
const SHOULDER = ['bench', 'press_v', 'lateral', 'pull_v'];
const BACK = ['deadlift', 'rdl', 'squat', 'pull_h'];

/** Mostra il check-in. Ritorna i valori, null se saltato, false se annullato. */
export function openCheckin(dayName) {
  if (localStorage.getItem('fulcro.checkin') === 'off') return Promise.resolve(null);
  return new Promise((resolve) => {
    const val = { energy: 'ok', sleep: 'ok', pain: 'none' };
    let result = false;
    const groups = Q.map(([k, t, opts]) => h('div', { class: 'ci-q' }, h('b', {}, t),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': t }, ...opts.map(([v, l]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(val[k] === v),
        onclick: (e) => { val[k] = v; [...e.target.parentNode.children].forEach((b) => b.setAttribute('aria-checked', String(b === e.target))); },
      }, l)))));
    const dlg = h('dialog', { class: 'sheet checkin', 'aria-label': 'Check-in' },
      h('div', { class: 'sheet-head' }, h('h2', {}, `Come arrivi a «${dayName}»?`)),
      h('div', { class: 'sheet-body' }, ...groups,
        h('p', { class: 'hint' }, 'Cinque secondi: Fulcro adatta i target di oggi.')),
      h('div', { class: 'sheet-foot' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { result = null; dlg.close(); } }, 'Salta'),
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { result = { ...val }; dlg.close(); } }, 'Inizia')));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Adatta l'allenamento al check-in: energia bassa → base del range (RIR 2); fastidi → avvisi mirati. */
export function applyCheckin(W, c) {
  const tired = c.energy === 'low' || (c.sleep === 'bad' && c.energy !== 'high');
  for (const ex of W.exercises) {
    const k = profileFromName(ex.name);
    const notes = [];
    if (tired) {
      ex.sets.forEach((s) => { if (s.type !== 'warmup') { s.reps = ex.target.repMin; s.hl = false; } });
      ex.progress = null;
      notes.push(`Oggi energia bassa: fermati alla base del range (${ex.target.repMin} rep) con RIR 2, stesso carico.`);
    }
    if (c.pain === 'knee' && KNEE.includes(k)) notes.push('Ginocchio: ROM solo dove non fa male, discesa lenta; se il fastidio sale, togli carico o passa a un esercizio d\'anca.');
    if (c.pain === 'shoulder' && SHOULDER.includes(k)) notes.push('Spalla: presa e ROM comodi, niente cedimento; se il fastidio sale, riduci carico o sostituisci.');
    if (c.pain === 'back' && BACK.includes(k)) notes.push('Schiena: busto neutro, carico conservativo, ferma la serie se la tecnica cede.');
    if (notes.length) ex.hint = [...notes, tired ? '' : ex.hint].filter(Boolean).join(' ');
  }
}
