# PDF Talker

PWA for listening to PDFs with chapter navigation, sentence-level seeking, resume across sessions, and Android lock-screen controls.

## Deploy

```bash
npm install
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # run the printed command with sudo so it survives reboots
```

Serves on port 3000. Put it behind an ALB / nginx / Caddy for TLS — service workers require HTTPS.

## Local test

```bash
npm install
npm start
# open http://localhost:3000
```

## PM2 commands

```bash
pm2 logs pdf-talker
pm2 restart pdf-talker
pm2 stop pdf-talker
pm2 delete pdf-talker
pm2 status
```

## Bumping the cache

When you change app code, bump `CACHE_VERSION` in `sw.js` (e.g. `v2` → `v3`). The activate handler deletes any cache not matching the current version, so clients get fresh assets on next visit.

## Files

```
index.html               Markup
styles.css               Vanilla CSS, light + dark, mobile-responsive
app.js                   Entry. Orchestrates everything.
pdf-engine.js            pdf.js wrapper
tts-engine.js            Web Speech API + MediaSession + silent audio shim
storage.js               IndexedDB resume position
text-utils.js            Sentence splitting & citation stripping
sw.js                    Service worker
manifest.json            PWA manifest
icon-192.png             App icon (192x192)
icon-512.png             App icon (512x512)
silent.wav               Silent audio loop for Android MediaSession
vendor/pdf.min.js        Mozilla PDF.js 3.11.174, bundled locally (Apache 2.0)
vendor/pdf.worker.min.js PDF.js parser worker
package.json             Node deps (http-server) + start script
ecosystem.config.cjs     PM2 config
```

## Notes

- pdf.js (~1.4MB) is bundled locally in `vendor/`. No CDN, no network at runtime.
- Resume position is IndexedDB-keyed by `filename::size::sha256(first 128KB)`. Same file reopened — same resume.
- Sentence splitter handles abbreviations (Mr., Dr., e.g., U.S., A.D.), initials (J.R.R.), and decimals (3.14).
- Citation stripping: `[1]`, `[1,2-5]`, `(Smith, 2020)`, `[Smith et al., 2020a]`. Visible text keeps them; TTS skips them.
- Heuristic bibliography-line detection skips reference entries during playback.
- MediaSession lock-screen controls work on Android Chrome (Play/Pause/Next/Prev sentence/Stop/Seek). Requires the silent audio loop running — that's what `silent.wav` is for.
- Scanned PDFs (image-only) won't have extractable text. The reader will show an empty state on those pages.

## Known limits

### iOS Safari
- `speechSynthesis.getVoices()` returns empty array — voice dropdown will be empty, system default voice is used.
- When backgrounded mid-utterance, speech stops and won't resume; requires page refresh.
- MediaSession is supported (16.4+) but iOS aggressively suspends background audio for non-media-priority tabs.
- Net effect: foreground playback works, background playback does not.

### Android Chrome
- Full Google TTS voice selection.
- Lock-screen and Bluetooth controls work via MediaSession + silent audio loop.
- Background playback works.

### Other
- Large PDFs (>50MB) may take 5–10 seconds to parse.
- No OCR. Scanned PDFs need preprocessing.
