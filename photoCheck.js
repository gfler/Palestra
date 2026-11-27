// photoCheck.js — «Camera guida» per le foto check: la prima foto di riferimento resta in trasparenza
// sopra l'inquadratura, così distanza, postura, angolo e luce restano uguali tra un check e l'altro.

import { h, toast, openSheet } from './dom.js';
import * as idb from './idb.js';

const POSES = { front: 'Fronte', side: 'Profilo', back: 'Schiena' };

async function photos() { try { return (await idb.all('photos')).sort((a, b) => a.date.localeCompare(b.date)); } catch { return []; } }

export async function openPhotoCheck() {
  const list = await photos();
  const body = h('div', { class: 'pc' });
  const draw = async () => {
    const ps = await photos();
    const byDate = {};
    ps.forEach((p) => { (byDate[p.date.slice(0, 10)] ||= []).push(p); });
    const dates = Object.keys(byDate).sort().reverse();
    body.replaceChildren(
      h('p', { class: 'muted' }, 'Ogni 2–4 settimane: stessa stanza, stessa luce, stessa ora (a digiuno). La prima foto di ogni posa diventa la sagoma guida.'),
      h('div', { class: 'pc-poses' }, ...Object.entries(POSES).map(([k, t]) => h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { await shoot(k); draw(); } }, `Scatta: ${t}`))),
      dates.length ? h('div', { class: 'pc-hist' }, ...dates.map((d) => h('div', { class: 'pc-day' },
        h('b', {}, new Date(d).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })),
        h('div', { class: 'pc-thumbs' }, ...byDate[d].map((p) => {
          const url = URL.createObjectURL(p.blob);
          return h('figure', {}, h('img', { src: url, alt: POSES[p.pose], onclick: () => compare(p, ps) }), h('figcaption', {}, POSES[p.pose]));
        }))))) : h('p', { class: 'muted' }, 'Ancora nessuna foto.'));
  };
  await draw();
  openSheet({ title: 'Foto check guidata', content: body, wide: true });
  return list;
}

function compare(p, all) {
  const first = all.find((x) => x.pose === p.pose);
  const a = URL.createObjectURL(first.blob), b = URL.createObjectURL(p.blob);
  const top = h('img', { src: b, class: 'cmp-top', alt: 'Foto scelta' });
  const range = h('input', { type: 'range', min: '0', max: '100', value: '50', 'aria-label': 'Sovrapposizione', oninput: () => { top.style.opacity = String(range.value / 100); } });
  top.style.opacity = '0.5';
  openSheet({ title: `${POSES[p.pose]}: prima foto vs ${new Date(p.date).toLocaleDateString('it-IT')}`, wide: true,
    content: h('div', {}, h('div', { class: 'cmp' }, h('img', { src: a, alt: 'Prima foto' }), top), range, h('p', { class: 'hint' }, 'Scorri per passare dalla prima foto a quella scelta.')) });
}

async function shoot(pose) {
  const ref = (await photos()).find((x) => x.pose === pose);
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1080 }, height: { ideal: 1920 } }, audio: false });
  } catch { toast('Fotocamera non disponibile: concedi il permesso.', 'error', 5000); return; }
  return new Promise((resolve) => {
    const video = h('video', { class: 'rec-video', autoplay: true, playsinline: true, muted: true });
    video.srcObject = stream;
    const ghost = ref ? h('img', { class: 'pc-ghost', src: URL.createObjectURL(ref.blob), alt: '' }) : null;
    let facing = 'user', timer = 5;
    const count = h('div', { class: 'rec-count', hidden: true });
    const dlg = h('dialog', { class: 'recorder mirror' },
      h('div', { class: 'rec-stage' }, video, ghost,
        h('div', { class: 'rec-top' },
          h('button', { type: 'button', 'aria-label': 'Chiudi', onclick: () => dlg.close() }, '×'),
          h('div', { class: 'rec-title' }, `Foto check · ${POSES[pose]}`),
          h('button', { type: 'button', 'aria-label': 'Cambia fotocamera', onclick: flip }, '⟲')),
        h('p', { class: 'rec-tip' }, ref ? 'Allinea il corpo alla sagoma della prima foto.' : 'Prima foto: diventerà la guida per le prossime. Corpo intero, braccia rilassate.'),
        count),
      h('div', { class: 'rec-bar' },
        h('div', { class: 'rec-delay' }, ...[3, 5, 10].map((s) => h('button', { type: 'button', 'aria-checked': String(s === timer), onclick: (e) => { timer = s; [...e.target.parentNode.children].forEach((b) => b.setAttribute('aria-checked', String(b === e.target))); } }, `${s}s`))),
        h('button', { class: 'rec-go', type: 'button', 'aria-label': 'Scatta', onclick: go }, h('span')),
        h('span', { class: 'rec-hint' }, 'Timer')));
    async function flip() {
      facing = facing === 'user' ? 'environment' : 'user';
      stream.getTracks().forEach((t) => t.stop());
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false }); video.srcObject = stream; dlg.classList.toggle('mirror', facing === 'user'); } catch { /* resta com'è */ }
    }
    async function go() {
      for (let s = timer; s > 0; s--) { count.hidden = false; count.textContent = String(s); await new Promise((r) => setTimeout(r, 1000)); }
      count.hidden = true;
      const cv = document.createElement('canvas');
      cv.width = video.videoWidth; cv.height = video.videoHeight;
      const x = cv.getContext('2d');
      if (facing === 'user') { x.translate(cv.width, 0); x.scale(-1, 1); }
      x.drawImage(video, 0, 0);
      cv.toBlob(async (blob) => {
        if (blob) { await idb.put('photos', { id: `${Date.now()}`, date: new Date().toISOString(), pose, blob }); toast('Foto salvata sul telefono ✓', 'ok'); }
        dlg.close();
      }, 'image/jpeg', 0.88);
    }
    dlg.addEventListener('close', () => { stream.getTracks().forEach((t) => t.stop()); dlg.remove(); resolve(); });
    document.body.append(dlg);
    dlg.showModal();
  });
}
