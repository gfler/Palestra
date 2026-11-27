// movements.js — tipi di movimento aggiuntivi per l'analisi video (rematori, curl, spalle, gambe...).
// Ogni tipo dichiara: quale angolo guida la ripetizione, quali punti del corpo servono
// e una lista di controlli (metrica + soglia + messaggio). Nessuna dipendenza dal DOM.
//
// Il contesto `c` passato alle metriche contiene: M (serie di angoli per frame), fi0/fiMax/fi1 (indici della rep),
// ce (fine "chiusura"), torso, min/max/range(arr, a, b) e tail.

const fmt = (v, d = 0) => (Number.isFinite(v) ? v.toFixed(d) : '–');

const leanRange = (c) => c.range(c.M.lean, c.fi0, c.fi1);
const upArmRange = (c) => c.range(c.M.upArm, c.fi0, c.fi1);
const wristDev = (c) => (c.range(c.M.wrX, c.fi0, c.fi1) / c.torso) * 100;

/** Controllo: v = metrica, ok = soglia, msg = messaggio per la rep, tip = consiglio in tabella. */
const chk = (o) => o;

const swingCheck = (max) => chk({
  code: 'swing', label: 'Slancio del busto', optimal: `≤ ${max}°`, metric: leanRange, unit: '°',
  ok: (v) => v <= max, msg: (v) => `usi lo slancio del busto (oscilla di ${fmt(v)}°)`,
  tip: 'Irrigidisci addome e glutei: il movimento deve venire dal muscolo, non dal busto', good: 'busto fermo',
});

const driftCheck = (max) => chk({
  code: 'drift', label: 'Gomito fermo', optimal: `≤ ${max}°`, metric: upArmRange, unit: '°',
  ok: (v) => v <= max, msg: (v) => `il gomito si sposta (${fmt(v)}°)`,
  tip: 'Tieni il gomito fisso accanto al corpo', good: 'gomito stabile',
});

export const MOVEMENTS = {
  press_v: {
    key: 'press_v', label: 'Press verticale (spalle)', defaultName: 'Shoulder press',
    angle: 'elbow', mode: 'flex', swap: false, minRange: 40, angles: ['elbow'], track: 'wr', need: ['sh', 'el', 'wr', 'hip'],
    checks: [
      chk({ code: 'elbow_rom', label: 'Gomito in basso', optimal: '60–100°', metric: (c) => c.min(c.M.elbow, c.fi0, c.fi1), unit: '°',
        ok: (v) => v <= 105, msg: (v) => `discesa incompleta, gomito a ${fmt(v)}°`, tip: 'Scendi fino a portare i manubri/il bilanciere all\'altezza delle orecchie', good: 'buon range in basso' }),
      chk({ code: 'lockout', label: 'Chiusura in alto', optimal: '≥ 165°', metric: (c) => c.max(c.M.elbow, c.fiMax, c.ce), unit: '°',
        ok: (v) => v >= 165, msg: (v) => `chiusura incompleta (gomito a ${fmt(v)}°)`, tip: 'Estendi del tutto le braccia sopra la testa', good: 'chiusura completa' }),
      chk({ code: 'arch', label: 'Inarcamento', optimal: '≤ 14°', metric: leanRange, unit: '°',
        ok: (v) => v <= 14, msg: (v) => `il busto si inclina (${fmt(v)}°): inarchi la schiena`, tip: 'Contrai addome e glutei, costole giù', good: 'busto stabile' }),
    ],
  },
  pull_h: {
    key: 'pull_h', label: 'Rematore / trazione orizzontale', defaultName: 'Rematore',
    angle: 'elbow', mode: 'flex', swap: true, minRange: 35, angles: ['elbow'], track: 'wr', need: ['sh', 'el', 'wr', 'hip'],
    checks: [
      chk({ code: 'pull_short', label: 'Gomito al picco', optimal: '55–95°', metric: (c) => c.min(c.M.elbow, c.fi0, c.fi1), unit: '°',
        ok: (v) => v <= 100, msg: (v) => `tiri poco indietro, gomito a ${fmt(v)}°`, tip: 'Porta il gomito oltre la linea del busto e stringi le scapole', good: 'buona contrazione' }),
      chk({ code: 'stretch', label: 'Allungamento', optimal: '≥ 150°', metric: (c) => c.max(c.M.elbow, c.fi0, c.fi1), unit: '°',
        ok: (v) => v >= 150, msg: (v) => `non allunghi del tutto (gomito a ${fmt(v)}°)`, tip: 'Lascia andare le braccia fino in fondo tra una rep e l\'altra', good: 'allungamento completo' }),
      swingCheck(12),
    ],
  },
  pull_v: {
    key: 'pull_v', label: 'Trazioni / lat machine', defaultName: 'Lat machine',
    angle: 'elbow', mode: 'flex', swap: true, minRange: 35, angles: ['elbow'], track: 'wr', need: ['sh', 'el', 'wr', 'hip'],
    checks: [
      chk({ code: 'pull_short', label: 'Gomito al picco', optimal: '45–90°', metric: (c) => c.min(c.M.elbow, c.fi0, c.fi1), unit: '°',
        ok: (v) => v <= 95, msg: (v) => `tiri poco, gomito a ${fmt(v)}°`, tip: 'Porta i gomiti verso i fianchi, petto verso la barra', good: 'buona contrazione' }),
      chk({ code: 'stretch', label: 'Allungamento', optimal: '≥ 155°', metric: (c) => c.max(c.M.elbow, c.fi0, c.fi1), unit: '°',
        ok: (v) => v >= 155, msg: (v) => `non allunghi del tutto (gomito a ${fmt(v)}°)`, tip: 'Risali fino a braccia quasi distese', good: 'allungamento completo' }),
      swingCheck(16),
    ],
  },
  curl: {
    key: 'curl', label: 'Curl (bicipiti)', defaultName: 'Curl manubri',
    angle: 'elbow', mode: 'flex', swap: true, minRange: 45, angles: ['elbow'], track: 'wr', need: ['sh', 'el', 'wr'],
    checks: [
      chk({ code: 'curl_short', label: 'Gomito al picco', optimal: '≤ 65°', metric: (c) => c.min(c.M.elbow, c.fi0, c.fi1), unit: '°',
        ok: (v) => v <= 65, msg: (v) => `curl non completo, gomito a ${fmt(v)}°`, tip: 'Porta il peso più in alto e contrai il bicipite', good: 'curl completo' }),
      chk({ code: 'stretch', label: 'Estensione in basso', optimal: '≥ 150°', metric: (c) => c.max(c.M.elbow, c.fi0, c.fi1), unit: '°',
        ok: (v) => v >= 150, msg: (v) => `non distendi del tutto (gomito a ${fmt(v)}°)`, tip: 'Scendi fino a braccio quasi disteso', good: 'allungamento completo' }),
      driftCheck(18),
      swingCheck(10),
    ],
  },
  triceps: {
    key: 'triceps', label: 'Estensioni tricipiti', defaultName: 'Pushdown tricipiti',
    angle: 'elbow', mode: 'ext', swap: true, minRange: 40, angles: ['elbow'], track: 'wr', need: ['sh', 'el', 'wr'],
    checks: [
      chk({ code: 'lockout', label: 'Estensione finale', optimal: '≥ 165°', metric: (c) => c.max(c.M.elbow, c.fi0, c.fi1), unit: '°',
        ok: (v) => v >= 165, msg: (v) => `estensione incompleta (gomito a ${fmt(v)}°)`, tip: 'Distendi completamente il gomito e contrai il tricipite', good: 'estensione completa' }),
      chk({ code: 'rom_short', label: 'Escursione', optimal: '≥ 60°', metric: (c) => c.range(c.M.elbow, c.fi0, c.fi1), unit: '°',
        ok: (v) => v >= 60, msg: (v) => `escursione ridotta (${fmt(v)}°)`, tip: 'Usa tutto il range, anche in fase di richiamo', good: 'buona escursione' }),
      driftCheck(15),
      swingCheck(10),
    ],
  },
  lateral: {
    key: 'lateral', label: 'Alzate (laterali / frontali)', defaultName: 'Alzate laterali',
    angle: 'shAng', mode: 'ext', swap: true, minRange: 30, angles: ['elbow'], track: 'wr', need: ['sh', 'el', 'hip'], frontalOk: true,
    checks: [
      chk({ code: 'raise_low', label: 'Altezza al picco', optimal: '80–100°', metric: (c) => c.max(c.M.shAng, c.fi0, c.fi1), unit: '°',
        ok: (v) => v >= 75, msg: (v) => `non arrivi all'altezza delle spalle (${fmt(v)}°)`, tip: 'Sali fino al braccio parallelo al pavimento', good: 'altezza giusta' }),
      chk({ code: 'raise_high', label: 'Non oltre', optimal: '≤ 110°', metric: (c) => c.max(c.M.shAng, c.fi0, c.fi1), unit: '°',
        ok: (v) => v <= 110, msg: (v) => `sali troppo (${fmt(v)}°): entrano i trapezi`, tip: 'Fermati all\'altezza delle spalle', good: 'trapezi fuori' }),
      swingCheck(10),
    ],
  },
  knee_press: {
    key: 'knee_press', label: 'Pressa / affondi / split squat', defaultName: 'Leg press',
    angle: 'knee', mode: 'flex', swap: false, minRange: 30, angles: ['knee', 'hip'], track: 'hip', need: ['sh', 'hip', 'knee', 'ank'],
    checks: [
      chk({ code: 'depth', label: 'Ginocchio al fondo', optimal: '70–110°', metric: (c) => c.min(c.M.knee, c.fi0, c.fi1), unit: '°',
        ok: (v) => v <= 115, msg: (v) => `discesa corta, ginocchio a ${fmt(v)}°`, tip: 'Scendi un po\' di più mantenendo il controllo', good: 'profondità adeguata' }),
      chk({ code: 'lockout', label: 'Estensione in alto', optimal: '≥ 160°', metric: (c) => c.max(c.M.knee, c.fiMax, c.ce), unit: '°',
        ok: (v) => v >= 160, msg: (v) => `estensione incompleta (ginocchio a ${fmt(v)}°)`, tip: 'Chiudi la spinta senza bloccare di scatto il ginocchio', good: 'estensione completa' }),
      chk({ code: 'trunk', label: 'Busto al fondo', optimal: '≤ 55°', metric: (c) => c.M.trunkVert[c.fiMax], unit: '° dalla verticale',
        ok: (v) => v <= 55, msg: (v) => `busto molto inclinato (${fmt(v)}°)`, tip: 'Petto alto, sguardo avanti', good: 'busto controllato' }),
    ],
  },
  knee_iso: {
    key: 'knee_iso', label: 'Leg extension / leg curl', defaultName: 'Leg extension',
    angle: 'knee', mode: 'abs', swap: true, minRange: 35, angles: ['knee'], track: 'ank', need: ['hip', 'knee', 'ank'],
    checks: [
      chk({ code: 'rom_short', label: 'Escursione del ginocchio', optimal: '≥ 70°', metric: (c) => c.range(c.M.knee, c.fi0, c.fi1), unit: '°',
        ok: (v) => v >= 70, msg: (v) => `escursione ridotta (${fmt(v)}°)`, tip: 'Usa tutto il range disponibile della macchina', good: 'escursione ampia' }),
      swingCheck(10),
    ],
  },
  hip_ext: {
    key: 'hip_ext', label: 'Hip thrust / ponte glutei', defaultName: 'Hip thrust',
    angle: 'hip', mode: 'ext', swap: true, minRange: 30, angles: ['hip', 'knee'], track: 'hip', need: ['sh', 'hip', 'knee', 'ank'],
    checks: [
      chk({ code: 'lockout', label: 'Estensione anca', optimal: '≥ 165°', metric: (c) => c.max(c.M.hip, c.fi0, c.fi1), unit: '°',
        ok: (v) => v >= 165, msg: (v) => `estensione incompleta (anca a ${fmt(v)}°)`, tip: 'Spingi il bacino fino ad allineare spalle, anca e ginocchia', good: 'estensione completa' }),
      chk({ code: 'knee_pos', label: 'Ginocchio in alto', optimal: '80–110°', metric: (c) => c.M.knee[c.fiMax], unit: '°',
        ok: (v) => v >= 75 && v <= 115, msg: (v) => `ginocchio a ${fmt(v)}° in alto: avvicina o allontana i piedi`, tip: 'Piedi in modo che la tibia sia verticale in alto', good: 'posizione dei piedi giusta' }),
    ],
  },
  deadlift: {
    key: 'deadlift', label: 'Stacco da terra', defaultName: 'Stacco da terra',
    angle: 'hip', mode: 'ext', swap: true, minRange: 40, angles: ['hip', 'knee'], track: 'wr', need: ['sh', 'hip', 'knee', 'ank', 'wr'],
    checks: [
      chk({ code: 'lockout', label: 'Chiusura anca', optimal: '≥ 170°', metric: (c) => c.max(c.M.hip, c.fi0, c.fi1), unit: '°',
        ok: (v) => v >= 170, msg: (v) => `chiusura incompleta (anca a ${fmt(v)}°)`, tip: 'Finisci in piedi, glutei contratti', good: 'chiusura completa' }),
      chk({ code: 'hyperext', label: 'Iperestensione', optimal: '≥ −6°', metric: (c) => c.min(c.M.lean, c.fi0, c.fi1), unit: '°',
        ok: (v) => v >= -6, msg: () => 'iperestensione in alto (busto indietro)', tip: 'Fermati quando sei dritto, senza inclinarti indietro', good: 'nessuna iperestensione' }),
      chk({ code: 'path', label: 'Peso vicino al corpo', optimal: '≤ 20%', metric: wristDev, unit: '% del busto',
        ok: (v) => v <= 20, msg: (v) => `peso lontano dal corpo (${fmt(v)}% del busto)`, tip: 'Tieni il bilanciere a contatto con le gambe', good: 'peso vicino al corpo' }),
    ],
  },
};

export const MOVEMENT_ORDER = ['press_v', 'pull_h', 'pull_v', 'curl', 'triceps', 'lateral', 'knee_press', 'knee_iso', 'hip_ext', 'deadlift'];

export const PHASE_LABEL_SWAP = { TOP: 'Partenza', ECCENTRIC: 'Concentrica', BOTTOM: 'Picco', CONCENTRIC: 'Eccentrica' };

const flat = (s) => ` ${String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ')} `;
const has = (n, words) => words.some((w) => n.includes(` ${w} `) || n.includes(` ${w}`));

/** Tipo di movimento suggerito dal nome dell'esercizio (italiano o inglese). */
export function guessProfile(name) {
  const n = flat(name);
  if (has(n, ['rdl', 'romanian', 'rumeno', 'stiff', 'good morning', 'stacco gambe tese'])) return 'rdl';
  if (has(n, ['hip thrust', 'glute bridge', 'ponte', 'thrust'])) return 'hip_ext';
  if (has(n, ['leg extension', 'leg curl', 'hamstring curl', 'estensioni gambe', 'estensione gambe', 'leg curls'])) return 'knee_iso';
  if (has(n, ['deadlift', 'stacco', 'sumo', 'trap bar'])) return 'deadlift';
  if (has(n, ['leg press', 'pressa', 'lunge', 'affond', 'split squat', 'bulgarian', 'bulgaro', 'step up', 'hack'])) return 'knee_press';
  if (has(n, ['squat'])) return 'squat';
  if (has(n, ['lateral raise', 'alzate laterali', 'alzata laterale', 'front raise', 'alzate frontali', 'alzata frontale'])) return 'lateral';
  if (has(n, ['pulldown', 'pull down', 'lat machine', 'pull up', 'pullup', 'chin up', 'trazioni', 'trazione', 'lat pull'])) return 'pull_v';
  if (has(n, ['row', 'rematore', 'pulley', 't bar', 'seated cable'])) return 'pull_h';
  if (has(n, ['shoulder press', 'military', 'overhead press', 'arnold', 'lento avanti', 'push press', 'press spalle', 'ohp'])) return 'press_v';
  if (has(n, ['tricep', 'triceps', 'pushdown', 'push down', 'skull', 'french press', 'kickback', 'french'])) return 'triceps';
  if (has(n, ['curl'])) return 'curl';
  if (has(n, ['panca', 'bench', 'chest press', 'distensioni', 'push up', 'pushup', 'flessioni', 'dip', 'dips', 'pectoral machine', 'incline', 'decline', 'inclinata', 'declinata', 'press'])) return 'bench';
  return 'generic';
}
