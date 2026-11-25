// nav.js — barra di navigazione a schede, passaggio tra le viste e collegamento con l'analisi video.

import { $, $$, h, icon, toast } from './dom.js';
import * as store from './store.js';
import { initTrain, render as renderTrain, setGoPrograms } from './viewTrain.js';
import { renderPrograms } from './viewPrograms.js';
import { renderStats } from './viewStats.js';
import { onAnalyzeTechnique, guessProfile } from './exDetail.js';
import { loadDb } from './exdb.js';

const VIEWS = {
  train: { label: 'Allenamento', icon: 'dumbbell', el: '#v-train', render: renderTrain },
  prog: { label: 'Schede', icon: 'list', el: '#v-prog', render: renderPrograms },
  stats: { label: 'Progressi', icon: 'chart', el: '#v-stats', render: renderStats },
  tech: { label: 'Tecnica', icon: 'lens', el: '#app', render: null },
};
let current = 'train';

export function goto(view, { scroll = true } = {}) {
  if (!VIEWS[view]) view = 'train';
  current = view;
  for (const [k, v] of Object.entries(VIEWS)) { const el = $(v.el); if (el) el.hidden = k !== view; }
  document.body.dataset.view = view;
  $$('#tabbar button').forEach((b) => { const on = b.dataset.view === view; b.setAttribute('aria-current', on ? 'page' : 'false'); b.classList.toggle('on', on); });
  if (VIEWS[view].render) VIEWS[view].render();
  try { localStorage.setItem('fulcro.view', view); } catch { /* ignora */ }
  if (scroll) window.scrollTo({ top: 0 });
}

function buildTabbar() {
  const bar = $('#tabbar');
  bar.replaceChildren(...Object.entries(VIEWS).map(([k, v]) => h('button', {
    type: 'button', dataset: { view: k }, 'aria-label': v.label, onclick: () => goto(k),
  }, icon(v.icon, 24), h('span', {}, v.label), k === 'train' ? h('i', { class: 'tab-dot', hidden: true }) : null)));
}

const APP_VERSION = '3.1';

function bindSettings() {
  const ver = $('#verLabel');
  if (ver) ver.textContent = `Versione ${APP_VERSION}. Se vedi una grafica strana dopo un aggiornamento, tocca il pulsante qui sopra: non cancella i tuoi dati.`;
  const fu = $('#btnForceUpdate');
  if (fu) fu.addEventListener('click', async () => {
    fu.disabled = true; fu.textContent = 'Aggiorno…';
    try {
      if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); }
      if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.filter((k) => k.startsWith('fulcro-shell')).map((k) => caches.delete(k))); }
    } catch { /* ignora */ }
    location.reload();
  });
  const inc = $('#setInc');
  if (inc) {
    inc.value = String(store.getInc());
    inc.addEventListener('change', () => store.setInc(+inc.value));
  }
  const back = $('#btnBackup');
  if (back) back.addEventListener('click', () => {
    const blob = new Blob([store.exportBackup()], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `fulcro-allenamenti-${new Date().toLocaleDateString('sv-SE')}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
  const rin = $('#restoreInput');
  if (rin) {
    $('#btnRestore').addEventListener('click', () => rin.click());
    rin.addEventListener('change', async () => {
      const f = rin.files && rin.files[0];
      rin.value = '';
      if (!f) return;
      try {
        const res = store.importBackup(await f.text());
        toast(`Ripristino: ${res.workouts} allenamenti e ${res.programs} schede aggiunti ✓`, 'ok', 5000);
        goto(current, { scroll: false });
      } catch (e) { toast(e.message, 'error', 5000); }
    });
  }
}

function init() {
  buildTabbar();
  initTrain();
  setGoPrograms(() => goto('prog'));
  onAnalyzeTechnique(({ name, kg }) => {
    goto('tech');
    if (window.fulcroTech) window.fulcroTech.prefill({ exercise: name, load: kg, profile: guessProfile(name) });
    toast('Scegli il video della serie: nome e carico sono già compilati.', 'info', 5000);
  });
  bindSettings();
  store.subscribe(() => { if (current !== 'tech') VIEWS[current].render(); });

  const saved = (() => { try { return localStorage.getItem('fulcro.view'); } catch { return null; } })();
  goto(store.getActive() ? 'train' : (VIEWS[saved] ? saved : 'train'), { scroll: false });

  const dot = $('#tabbar .tab-dot');
  setInterval(() => { if (dot) dot.hidden = !store.getActive() || current === 'train'; }, 1500);

  // se ci sono già schede o allenamenti, scarica la libreria in background (poi resta in cache)
  if (store.getPrograms().length || store.getWorkouts().length) setTimeout(() => loadDb().catch(() => {}), 1500);
}

init();
