// Fulcro → Google Sheets (metodo «Apps Script», non scade mai).
//
// Installazione (una volta sola, 3 minuti):
//  1. Apri il tuo Foglio Google → menu Estensioni → Apps Script.
//  2. Cancella tutto e incolla questo file. Cambia la CHIAVE qui sotto con una parola segreta tua.
//  3. Salva (icona disco) → Esegui il deployment → Nuovo deployment → tipo «App web».
//     - Esegui come: «Me»
//     - Chi ha accesso: «Chiunque»
//  4. Autorizza (Avanzate → Vai al progetto → Consenti). Copia l'URL che finisce con /exec.
//  5. In Fulcro: Impostazioni → Google Sheets → incolla URL e chiave → «Prova collegamento».
//
// Se modifichi lo script: Esegui il deployment → Gestisci deployment → matita → Versione: «Nuova versione».
// L'URL resta lo stesso.
const CHIAVE = 'cambiami';

function doPost(e) {
  let out;
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const req = JSON.parse(e.postData.contents);
    if (String(req.key || '') !== CHIAVE) throw new Error('Chiave segreta errata: deve essere uguale a quella nello script');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tz = ss.getSpreadsheetTimeZone();
    const tab = (name) => ss.getSheetByName(name) || ss.insertSheet(name);

    switch (req.op) {
      case 'ping':
        out = { ok: true, name: ss.getName() };
        break;
      case 'ensure':
        ensureHeader_(tab(req.tab), req.header);
        out = { ok: true };
        break;
      case 'append': {
        const sh = tab(req.tab);
        if (req.header) ensureHeader_(sh, req.header);
        const rows = req.rows || [];
        if (rows.length) {
          const w = Math.max.apply(null, rows.map((r) => r.length));
          const padded = rows.map((r) => r.concat(new Array(w - r.length).fill('')));
          sh.getRange(sh.getLastRow() + 1, 1, padded.length, w).setValues(padded);
        }
        out = { ok: true, n: rows.length };
        break;
      }
      case 'read': {
        const sh = ss.getSheetByName(req.tab);
        if (!sh || sh.getLastRow() < 2) { out = { ok: true, values: [] }; break; }
        const values = sh.getRange(req.range || 'A2:Z').getValues()
          .filter((r) => r.some((c) => c !== ''))
          .map((r) => r.map((c) => (c && typeof c.getFullYear === 'function'
            ? Utilities.formatDate(c, tz, c.getFullYear() < 1901 ? 'HH:mm' : 'yyyy-MM-dd')
            : c)));
        out = { ok: true, values };
        break;
      }
      case 'overwrite': {
        const sh = tab(req.tab);
        sh.clearContents();
        const rows = req.rows || [];
        if (rows.length) {
          const w = Math.max.apply(null, rows.map((r) => r.length));
          sh.getRange(1, 1, rows.length, w).setValues(rows.map((r) => r.concat(new Array(w - r.length).fill(''))));
        }
        out = { ok: true };
        break;
      }
      default:
        throw new Error('Operazione sconosciuta: ' + req.op);
    }
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  } finally {
    try { lock.releaseLock(); } catch (e2) { /* niente */ }
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, app: 'fulcro' })).setMimeType(ContentService.MimeType.JSON);
}

function ensureHeader_(sh, header) {
  if (!header || !header.length) return;
  const first = sh.getRange(1, 1, 1, header.length).getValues()[0];
  if (!first.some((c) => String(c).trim() !== '')) {
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
}
