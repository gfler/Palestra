// poseEngine.js — wrapper di MediaPipe PoseLandmarker (Tasks Vision) caricato da CDN.
// Il modello viene scaricato una sola volta e poi servito dalla cache del service worker.

const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';

/**
 * Crea il motore. `onStatus(msg)` riceve messaggi leggibili per la UI.
 * Prova prima il delegato GPU; se non è disponibile ripiega sulla CPU.
 */
export async function createPoseEngine(onStatus = () => {}) {
  onStatus('Carico MediaPipe…');
  const vision = await import(/* @vite-ignore */ VISION_URL);
  onStatus('Carico il modello di posa (la prima volta ~10 MB)…');
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);

  const make = (delegate) =>
    vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  let landmarker;
  let delegate = 'GPU';
  try {
    landmarker = await make('GPU');
  } catch (err) {
    console.warn('Delegato GPU non disponibile, uso la CPU', err);
    delegate = 'CPU';
    landmarker = await make('CPU');
  }

  // detectForVideo richiede timestamp strettamente crescenti per tutta la vita del landmarker
  let lastTs = 0;

  return {
    delegate,
    /** Rileva la posa nel frame corrente del <video>. Restituisce null oppure 33 × [x, y, visibility]. */
    detect(video, frameIndex, fps) {
      const ts = Math.max(lastTs + 1, Math.round((frameIndex * 1000) / fps) + lastTs0);
      lastTs = ts;
      const res = landmarker.detectForVideo(video, ts);
      const pose = res && res.landmarks && res.landmarks[0];
      if (!pose) return null;
      return pose.map((l) => [l.x, l.y, l.visibility ?? 0]);
    },
    /** Da chiamare all'inizio di una nuova analisi: sposta la base dei timestamp. */
    startNewRun() {
      lastTs0 = lastTs + 1000;
    },
    close() {
      try { landmarker.close(); } catch { /* già chiuso */ }
    },
  };
}

let lastTs0 = 0;
