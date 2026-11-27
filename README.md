# Fulcro — analisi biomeccanica in palestra (PWA)

App 100% client-side: nessun server, nessun backend, nessun build. HTML + CSS + JavaScript (ES Modules).
Il video resta sul telefono: viene analizzato in locale con MediaPipe. A Google Sheets va solo una riga di numeri per serie.

## Pubblicare su GitHub Pages
1. Crea un repository e carica **il contenuto** di questa cartella nella radice (non la cartella stessa).
2. Settings → Pages → Source: `Deploy from a branch` → `main` / `(root)`.
3. Apri `https://<utente>.github.io/<repo>/` dal telefono e scegli «Aggiungi a schermata Home».

La prima apertura richiede la rete (scarica MediaPipe e il modello di posa, ~10 MB). Poi tutto è in cache e l'app funziona offline.

## Collegare Google Sheets (una volta sola) — metodo Apps Script
Non serve Google Cloud né login, e il collegamento non scade mai (funziona anche nell'APK).
1. Apri il tuo Foglio Google → **Estensioni → Apps Script**. Cancella tutto e incolla `apps-script/Code.gs` (in Fulcro: ⚙ → «Copia lo script per il foglio»).
2. Cambia `cambiami` con una parola segreta tua e salva.
3. **Esegui il deployment → Nuovo deployment → App web**. Esegui come: *Me*. Chi ha accesso: *Chiunque*. Autorizza (Avanzate → Vai al progetto → Consenti).
4. Copia l'URL che finisce con `/exec`. In Fulcro: ⚙ → incolla URL e parola segreta → **Prova collegamento**.

Il metodo vecchio (OAuth con Client ID, token di un'ora) è ancora disponibile nel riquadro «Metodo vecchio» ma solo nel browser.

## Colonne del foglio
`Data | Ora | Scheda | Esercizio | Carico_kg | Rep_Totali | Rep_Valide | Tempo_Ecc_Medio_s | Tempo_Conc_Medio_s | Angolo_Min_Medio | Deviazione_Traiettoria | Verdetto_Tecnico | Note` + **Perdita_Velocita_Pct** (14ª colonna, stima di fatica).
Con l'opzione attiva viene creato anche il tab `Riepilogo_Settimanale` (serie, rep, tonnellaggio e medie per esercizio e settimana).

## Come filmare
- Telefono fermo, di **lato** (circa 90°), all'altezza dell'anca, tutto il corpo in inquadratura, buona luce.
- Il lato più visibile (destro/sinistro) viene scelto da solo.

## Funzioni
- Pre-analisi frame per frame (30 FPS, scende a 20/15/10 se il video è lungo), poi riproduzione fluida con HUD sul canvas.
- Profili RDL, Squat, Panca piana, Generico. Cambiare profilo o finestra della serie ricalcola subito, senza rifare l'analisi.
- Controllo qualità del video: corpo tagliato, inquadratura frontale, poca luce.
- Finestra della serie: «Inizio serie» / «Fine serie» sulla posizione corrente per escludere i momenti di preparazione.
- Perdita di velocità (tempo concentrico che si allunga) con stima indicativa dell'RPE.
- Fantasma: la traiettoria della rep migliore sovrapposta alle altre.
- Confronto con la serie precedente dello stesso esercizio (storico locale; «Importa storico dal foglio» nelle impostazioni).
- Coda offline: le serie restano in coda e partono al ritorno della rete.
- Export/Import JSON dell'analisi: ricaricando lo stesso video non rifai la pre-analisi.
- Coach AI opzionale: Gemini 2.5 Flash riceve solo il JSON delle metriche.

## Note oneste sui limiti
- È un'analisi 2D da una sola telecamera: angoli e traiettorie sono indicativi, non misure cliniche. Una cattiva angolazione può falsarli.
- I tempi eccentrico/concentrico misurano il movimento attivo (dal 4% dell'escursione in poi), quindi sono leggermente più corti del cronometro.
- Nel profilo Generico «eccentrica/concentrica» indicano prima e seconda metà del movimento rispetto alla posizione di partenza.
- La chiave Gemini e il Client ID restano in `localStorage` su questo dispositivo: usa una chiave con limiti di quota e non condividere il telefono sbloccato.

## Struttura
`index.html` · `styles.css` · `app.js` · `native.js` · `poseEngine.js` · `biomechanics.js` · `hudRenderer.js` · `sheetsSync.js` · `manifest.json` · `sw.js` · `icons/`

## Novità v2 — Allenamento

Quattro sezioni in basso: **Allenamento** (registro serie, recuperi, suggerimenti di carico), **Schede** (le tue schede, incolla da testo o crea a mano, archivio), **Progressi** (costanza, volume, andamento per esercizio continuo tra schede diverse, muscoli) e **Tecnica** (l'analisi video).

- Dati sul telefono (localStorage). Scarica ogni tanto un backup da Impostazioni → Allenamento.
- Con Google Sheets collegato, ogni allenamento aggiunge righe al tab `Serie_Dettaglio`.
- Libreria esercizi: Free Exercise DB (pubblico dominio), scaricata al primo uso e poi in cache. Istruzioni in inglese.

Aggiornamento: sostituisci nella radice del repository tutti i file (anche i nuovi: `dom.js`, `store.js`, `exdb.js`, `charts.js`, `exDetail.js`, `viewTrain.js`, `viewPrograms.js`, `viewStats.js`, `nav.js`, `training.js`).

## Novità v3
Calendario mensile (Progressi), Coach (riscaldamento, defaticamento, consigli di carico che tengono conto di rep, RIR e video; domande libere con Gemini), serie di riscaldamento automatiche, superset, rilevamento dei plateau e settimana di scarico. File nuovi: `coach.js`, `viewCoach.js`.

## Novità v3.3
- **Tipo di movimento ben visibile** in cima alla scheda della serie, con **Automatico** come predefinito (prima era fisso su RDL).
- **Riconoscimento automatico** dal video: squat, RDL, stacco, panca, hip thrust, pressa, leg extension/curl, press spalle, lat machine, rematore, curl, tricipiti, alzate. Nel report compare «Riconosciuto: …» con i pulsanti per correggerlo; se scegli tu un esercizio e il video sembra un altro, Fulcro ti avvisa e rianalizza con un tocco (senza rifare la pre-analisi).
- Nomi dalla scheda: «Sumo squat» ora è squat (prima diventava stacco).
- **Google Sheets via Apps Script**: niente più disconnessioni.
- **App Android (APK)**.

## Novità v3.4
- **Tecnica a due pagine.** *Prova libera*: scegli prima il movimento (15 schede con icona) e Fulcro si calibra su quello. *Dalla mia scheda*: scegli giorno ed esercizio; per ogni esercizio puoi fissare "Analizza come…" (es. Pressa 45° → Pressa), e Fulcro se lo ricorda.
- **Registra dall'app**: fotocamera posteriore, sagoma per inquadrarti di lato, conto alla rovescia 3/5/10 s, cambio camera.
- **Segna la serie**: dopo l'analisi, un tocco mette kg e rep nella prossima serie dell'allenamento (lo avvia se serve) e parte il recupero. La serie mostra "Video: x/y buone · v m/s".
- **Velocità del bilanciere** in m/s per rep, perdita di velocità e **1RM stimato** (squat e panca). Serve la tua altezza (Impostazioni o direttamente nella scheda). È una stima da video 2D, non un encoder.
- **Timer di recupero** con notifica e vibrazione anche a schermo spento (nell'APK con notifiche native).
- **HUD essenziale/completo** e **immagini da condividere** (serie analizzata e allenamento completo, 1080×1350).

## App Android (APK)
Il repository contiene `android-app/` (progetto Capacitor) e `.github/workflows/android-apk.yml`.
A ogni push su `main` GitHub costruisce l'APK (circa 5–8 minuti, scheda **Actions**) e lo pubblica nelle **Releases**.
Link fisso da aprire sul telefono:
`https://github.com/<utente>/<repo>/releases/latest/download/Fulcro.apk`

- Prima installazione: Android chiede di consentire «installa app sconosciute» al browser.
- Aggiornamenti: scarica di nuovo dallo stesso link e installa sopra; i dati restano.
- Nell'APK MediaPipe e il modello di posa sono inclusi: l'analisi funziona anche senza rete.
- I dati dell'APK sono separati da quelli della versione web: per portarli, ⚙ → «Scarica backup» nel browser e «Ripristina da backup» nell'app.
- Firma: `android-app/fulcro-release.jks` (password `fulcro-apk`), fissa per permettere gli aggiornamenti. Il repository è pubblico, quindi la chiave è visibile: per un uso personale va bene; se vuoi una chiave privata, crea i secret `KEYSTORE_BASE64` e `KEYSTORE_PASSWORD` (alias `fulcro`) e il workflow userà quella. Cambiare chiave richiede di disinstallare l'app una volta.
