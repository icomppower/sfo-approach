# State

| Gate | Status | Last run | Notes |
|------|--------|----------|-------|
| A0 Data | — | — | |
| A1 Georeference | — | — | |
| A2 Flight | — | — | |
| A3 Render | — | — | |
| A4 Page | — | — | |
| A5 Look (advisory) | — | — | |
| B0 Fleet | PASS | 2026-09-27 | 7 silhouettes × 3 LODs at FAA ACD reference dimensions, 44 sim types mapped, public/sim byte-identical to sfo-tower; 4/4 negatives |
| B1 Live sim | — (written) | — | needs npm install |
| B3 Commands | — (written) | — | needs npm install |
| B4 Budget | — (written) | — | needs npm install |
| B5 Page + tags | — (written) | — | needs npm install (real Chrome checks done by hand, see Current) |
| B6 Look (advisory) | — (written) | — | |

## Current

2026-09-27: data fetched and baked (terrain 400 tiles, 24,002 buildings incl. 271 OSM multipolygons, tower + bridge
landmarks, B77W model, the ILS 28R track); game module written; the site builds on GitHub Actions and is live.
Checked in real Chrome (WebGPU, M4): boots in 10 s, 60 fps at 1440×900, 0 page errors, all eight shots show the
aircraft, HUD live, keys switch shots, 390×844 with `?touch&lang=zh`: 8/8 buttons reachable, no overflow, Chinese
captions.

Phase 3 (2026-09-27): `?game=tower` live. Checked in real Chrome: the shift runs with the bot (6 aircraft at 4 min, tags on
them, radar inset, readbacks in the ticker), tag click selects, an altitude picked from the command bar reaches the
sim (its own "unable, established on the approach" came back), follow camera and zoom work, 60 fps, 0 errors; phone
390×844 with `?touch&lang=zh`: 13/13 buttons reachable, no overflow. Gates A0–A5 and B1–B6 are written but not run: `npm install` in the title was denied to the session (D8); run
`npm install && ./verify.sh` to calibrate SPEC-THRESHOLDS.md and turn the table green.
