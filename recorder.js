// recorder.js — registrazione del video dentro l'app: fotocamera posteriore, sagoma per inquadrarsi,
// conto alla rovescia con bip, poi restituisce un File pronto per l'analisi.

const PREF_KEY = 'fulcro.recDelay';

function pickMime() {
  const c = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return c.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

let audio = null;
function beep(freq = 880, dur = 0.12) {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(0.0001, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, audio.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + dur + 0.02);
  } catch { /* niente audio */ }
}

// Sagoma laterale (persona in piedi, vista di fianco) disegnata in SVG
const SILHOUETTE = `
<svg viewBox="0 0 100 200" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="5 5">
    <circle cx="52" cy="22" r="11"/>
    <path d="M50 34 L48 92"/>
    <path d="M49 40 L56 66 L58 88"/>
    <path d="M48 92 L52 140 L50 186"/>
    <path d="M50 186 L64 188"/>
  </g>
  <line x1="10" y1="190" x2="90" y2="190" stroke="currentColor" stroke-width="1.5" opacity=".6"/>
</svg>`;

/** Apre la fotocamera a schermo intero. Restituisce un File oppure null se annullato. */
export function openRecorder({ title = '' } = {}) {
  return new Promise((resolve) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      resolve({ error: 'Questo browser non permette di registrare: usa «Dalla galleria».' });
      return;
    }
    let stream = null, rec = null, chunks = [], timer = null, startedAt = 0, finished = false;
    let delay = Number(localStorage.getItem(PREF_KEY)) || 5;
    let facing = 'environment';

    const dlg = document.createElement('dialog');
    dlg.className = 'recorder';
    dlg.innerHTML = `
      <div class="rec-stage">
        <video class="rec-video" playsinline muted autoplay></video>
        <div class="rec-ghost">${SILHOUETTE}</div>
        <div class="rec-top">
          <button type="button" class="rec-x" aria-label="Chiudi">×</button>
          <span class="rec-title"></span>
          <button type="button" class="rec-flip" aria-label="Cambia fotocamera">⟲</button>
        </div>
        <p class="rec-tip">Telefono fermo e di lato, all'altezza dell'anca. Entra tutto dentro la sagoma.</p>
        <div class="rec-count" hidden></div>
        <div class="rec-live" hidden><i></i><span>0:00</span></div>
      </div>
      <div class="rec-bar">
        <div class="rec-delay" role="radiogroup" aria-label="Conto alla rovescia">
          ${[3, 5, 10].map((d) => `<button type="button" data-d="${d}" role="radio">${d}"</button>`).join('')}
        </div>
        <button type="button" class="rec-go" aria-label="Avvia registrazione"><span></span></button>
        <span class="rec-hint">Tocca per iniziare</span>
      </div>`;
    document.body.append(dlg);
    const $ = (s) => dlg.querySelector(s);
    const video = $('.rec-video'), go = $('.rec-go'), count = $('.rec-count'), live = $('.rec-live'), hint = $('.rec-hint');
    $('.rec-title').textContent = title;

    const paintDelay = () => dlg.querySelectorAll('.rec-delay button').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.d) === delay)));
    paintDelay();
    dlg.querySelectorAll('.rec-delay button').forEach((b) => b.addEventListener('click', () => { delay = Number(b.dataset.d); localStorage.setItem(PREF_KEY, String(delay)); paintDelay(); }));

    async function startCam() {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        });
        video.srcObject = stream;
        dlg.classList.toggle('mirror', facing === 'user');
      } catch (e) {
        close({ error: e && e.name === 'NotAllowedError' ? 'Permesso fotocamera negato: abilitalo nelle impostazioni del telefono.' : 'Fotocamera non disponibile.' });
      }
    }

    function close(result) {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* già fermo */ }
      if (stream) stream.getTracks().forEach((t) => t.stop());
      dlg.close(); dlg.remove();
      resolve(result || null);
    }

    function startRecording() {
      const mime = pickMime();
      chunks = [];
      try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined); } catch { rec = new MediaRecorder(stream); }
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        if (finished && !chunks.length) return;
        const type = (rec.mimeType || mime || 'video/webm').split(';')[0];
        const blob = new Blob(chunks, { type });
        const ext = type.includes('mp4') ? 'mp4' : 'webm';
        const file = new File([blob], `fulcro_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`, { type });
        file.recordedDuration = (Date.now() - startedAt) / 1000;
        close({ file });
      };
      rec.start(500);
      startedAt = Date.now();
      dlg.classList.add('recording');
      live.hidden = false; hint.textContent = 'Tocca per fermare';
      beep(1320, 0.25);
      timer = setInterval(() => {
        const s = Math.floor((Date.now() - startedAt) / 1000);
        live.querySelector('span').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      }, 250);
    }

    let counting = false;
    go.addEventListener('click', () => {
      if (rec && rec.state === 'recording') { rec.stop(); return; }
      if (counting) { counting = false; count.hidden = true; hint.textContent = 'Tocca per iniziare'; return; }
      counting = true;
      let n = delay;
      count.hidden = false; count.textContent = String(n); hint.textContent = 'Tocca per annullare';
      beep();
      const step = () => {
        if (!counting) return;
        n -= 1;
        if (n <= 0) { counting = false; count.hidden = true; startRecording(); return; }
        count.textContent = String(n); beep(n <= 3 ? 990 : 880);
        setTimeout(step, 1000);
      };
      setTimeout(step, 1000);
    });
    $('.rec-x').addEventListener('click', () => close(null));
    $('.rec-flip').addEventListener('click', () => { if (rec && rec.state === 'recording') return; facing = facing === 'environment' ? 'user' : 'environment'; startCam(); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    dlg.addEventListener('close', () => { if (!finished) close(null); }); // es. tasto indietro di Android

    dlg.showModal();
    startCam();
  });
}
