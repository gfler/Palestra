// native.js — ponte verso Android quando Fulcro gira come APK (Capacitor). Nel browser non fa nulla di speciale.
// I plugin nativi si raggiungono con registerPlugin di @capacitor/core, copiato in vendor/ solo nella build Android.

export const isNative = () => !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform());

let corePromise = null;
const core = () => (corePromise ||= import('./vendor/capacitor-core.js'));
const cache = new Map();

/** Proxy di un plugin nativo (es. 'Filesystem', 'Share', 'App'). */
export async function plugin(name) {
  if (!cache.has(name)) { const { registerPlugin } = await core(); cache.set(name, registerPlugin(name)); }
  return cache.get(name);
}

/**
 * Salva un file di testo. Nel browser lo scarica; nell'APK lo scrive in cache e apre «Condividi»
 * (da lì: Salva su Drive, File, invia a te stesso…).
 */
export async function saveTextFile(filename, text, mime = 'application/json') {
  if (isNative()) {
    try {
      const fs = await plugin('Filesystem');
      const share = await plugin('Share');
      const r = await fs.writeFile({ path: filename, data: text, directory: 'CACHE', encoding: 'utf8' });
      await share.share({ title: filename, dialogTitle: 'Salva o invia il file', files: [r.uri] });
      return true;
    } catch (e) {
      if (/cancel/i.test(String((e && e.message) || e))) return false;
      throw e;
    }
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

/** Tasto «indietro» di Android: `handler()` restituisce true se l'ha gestito, altrimenti l'app si chiude. */
export async function onBackButton(handler) {
  if (!isNative()) return;
  try {
    const App = await plugin('App');
    await App.addListener('backButton', () => { if (!handler()) App.exitApp(); });
  } catch (e) { console.warn('Tasto indietro non collegato', e); }
}

/** Salva/condivide un file binario (es. immagine PNG). */
export async function shareBlob(filename, blob, title = 'Fulcro') {
  if (isNative()) {
    const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
    const fs = await plugin('Filesystem');
    const share = await plugin('Share');
    const w = await fs.writeFile({ path: filename, data: b64, directory: 'CACHE' });
    try { await share.share({ title, dialogTitle: title, files: [w.uri] }); } catch (e) { if (!/cancel/i.test(String((e && e.message) || e))) throw e; }
    return;
  }
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- Timer di recupero: notifica anche a schermo spento ---------- */

const REST_ID = 4711;
let notifReady = null;

async function notifs() {
  const LN = await plugin('LocalNotifications');
  if (!notifReady) {
    notifReady = (async () => {
      let p = await LN.checkPermissions();
      if (p.display !== 'granted') p = await LN.requestPermissions();
      try { await LN.createChannel({ id: 'rest', name: 'Fine recupero', description: 'Avviso quando il recupero è finito', importance: 5, vibration: true, visibility: 1 }); } catch { /* già creato */ }
      return p.display === 'granted';
    })();
  }
  return (await notifReady) ? LN : null;
}

/** Programma l'avviso di fine recupero (nell'APK con notifica di sistema, nel browser se l'app è aperta). */
export async function scheduleRest(endsAt, label) {
  if (isNative()) {
    try {
      const LN = await notifs();
      if (!LN) return;
      await LN.cancel({ notifications: [{ id: REST_ID }] }).catch(() => {});
      await LN.schedule({ notifications: [{ id: REST_ID, title: 'Recupero finito — via!', body: label || 'Prossima serie', channelId: 'rest', schedule: { at: new Date(endsAt), allowWhileIdle: true }, smallIcon: 'ic_stat_fulcro', autoCancel: true }] });
    } catch (e) { console.warn('Notifica recupero non programmata', e); }
    return;
  }
  try { if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission(); } catch { /* ignora */ }
}

export async function cancelRest() {
  if (!isNative()) return;
  try { const LN = await plugin('LocalNotifications'); await LN.cancel({ notifications: [{ id: REST_ID }] }); } catch { /* niente da annullare */ }
}

/** Nel browser: notifica quando il recupero finisce e l'app è in secondo piano. */
export async function notifyRestDone(label) {
  if (isNative() || !document.hidden) return;
  try {
    if (Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker?.getRegistration();
    const opt = { body: label || 'Prossima serie', tag: 'rest', renotify: true, vibrate: [220, 90, 220], icon: 'icons/icon-192.png' };
    if (reg) await reg.showNotification('Recupero finito — via!', opt); else new Notification('Recupero finito — via!', opt);
  } catch { /* non supportato */ }
}

/** Vibrazione: nativa nell'APK, navigator.vibrate nel browser. */
export async function buzz(pattern = [220, 90, 220]) {
  if (isNative()) {
    try { const H = await plugin('Haptics'); for (const _ of pattern.filter((_, i) => i % 2 === 0)) { await H.vibrate({ duration: 220 }); await new Promise((r) => setTimeout(r, 120)); } } catch { /* ignora */ }
    return;
  }
  try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* ignora */ }
}
