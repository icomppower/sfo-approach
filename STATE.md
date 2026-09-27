# State

| Gate | Status | Last run | Notes |
|------|--------|----------|-------|
| A0 Data | — | — | |
| A1 Georeference | — | — | |
| A2 Flight | — | — | |
| A3 Render | — | — | |
| A4 Page | — | — | |
| A5 Look (advisory) | — | — | |

## Current

2026-09-27: data fetched and baked (terrain 400 tiles, 24,002 buildings incl. 271 OSM multipolygons, tower + bridge
landmarks, B77W model, the ILS 28R track); game module written; the site builds on GitHub Actions and is live.
Checked in real Chrome (WebGPU, M4): boots in 10 s, 60 fps at 1440×900, 0 page errors, all eight shots show the
aircraft, HUD live, keys switch shots, 390×844 with `?touch&lang=zh`: 8/8 buttons reachable, no overflow, Chinese
captions. Gates A0–A5 are written but not run: `npm install` in the title was denied to the session (D8); run
`npm install && ./verify.sh` to calibrate SPEC-THRESHOLDS.md and turn the table green.
