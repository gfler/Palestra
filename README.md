# Fulcro — analisi biomeccanica in palestra (PWA)

App 100% client-side: nessun server, nessun backend, nessun build. HTML + CSS + JavaScript (ES Modules).
Il video resta sul telefono: viene analizzato in locale con MediaPipe. A Google Sheets va solo una riga di numeri per serie.

## Pubblicare su GitHub Pages
1. Crea un repository e carica **il contenuto** di questa cartella nella radice (non la cartella stessa).
2. Settings → Pages → Source: `Deploy from a branch` → `main` / `(root)`.
3. Apri `https://<utente>.github.io/<repo>/` dal telefono e scegli «Aggiungi a schermata Home».

La prima apertura richiede la rete (scarica MediaPipe e il modello di posa, ~10 MB). Poi tutto è in cache e l'app funziona offline.

## Collegare Google Sheets (una volta sola)
1. Crea un Foglio Google vuoto e copia l'URL completo dalla barra degli indirizzi.
2. Vai su Google Cloud Console → crea un progetto → «API e servizi» → abilita **Google Sheets API**.
3. «Schermata di consenso OAuth»: tipo Esterno, aggiungi la tua email come utente di test.
4. «Credenziali» → Crea credenziali → **ID client OAuth** → tipo *Applicazione web*.
5. In «Origini JavaScript autorizzate» aggiungi l'origine mostrata nelle impostazioni dell'app (es. `https://<utente>.github.io`). Nessun URI di reindirizzamento.
6. In Fulcro: ⚙ Impostazioni → incolla Client ID e URL del foglio → **Connetti Google Sheets**.

Al primo invio l'app crea il tab `Log_Allenamenti` (se manca) e scrive l'intestazione. Il token Google dura circa un'ora e non viene salvato: se scade, tocca il badge in alto per riconnettere.

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
`index.html` · `styles.css` · `app.js` · `poseEngine.js` · `biomechanics.js` · `hudRenderer.js` · `sheetsSync.js` · `manifest.json` · `sw.js` · `icons/`
