#!/usr/bin/env bash
# Copia i file web del repository in www/ e aggiunge ciò che serve offline nell'APK:
# MediaPipe (wasm + modello di posa) e @capacitor/core per parlare con i plugin nativi.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=..
rm -rf www && mkdir -p www/vendor/mediapipe
cp "$ROOT"/*.html "$ROOT"/*.js "$ROOT"/*.css "$ROOT"/manifest.json www/
cp -r "$ROOT"/icons "$ROOT"/apps-script www/
rm -f www/sw.js   # nell'APK i file sono già locali: niente service worker

# @capacitor/core (ESM autonomo)
cp node_modules/@capacitor/core/dist/index.js www/vendor/capacitor-core.js

# MediaPipe Tasks Vision, stessa versione usata dal CDN
MP=0.10.14
TMP=$(mktemp -d)
( cd "$TMP" && npm pack "@mediapipe/tasks-vision@$MP" --silent >/dev/null && tar xzf mediapipe-tasks-vision-$MP.tgz )
cp "$TMP"/package/vision_bundle.mjs www/vendor/mediapipe/
cp -r "$TMP"/package/wasm www/vendor/mediapipe/
rm -rf "$TMP"

MODEL=https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task
curl -fsSL --retry 3 -o www/vendor/mediapipe/pose_landmarker_full.task "$MODEL"

echo "www pronto: $(du -sh www | cut -f1)"
