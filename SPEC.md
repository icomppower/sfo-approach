# SFO Approach — SPEC (Phase 2 of SFO Tower, cinematic approach)

Owner's brief (2026-09-27): "I want to see the flight with real life openstreetmap view to approach … cinematic approach."
This is SFO Tower SPEC §8's Phase 2, built as a Harbor Engine title. Notion holds the status page; this file is the
frozen gate ladder the run is judged by.

## 1. Deliverable
A public web page (GitHub Pages) that boots the Harbor Engine on a 24 km square around KSFO built from real data (USGS
3DEP, NOAA NCEI, NAIP, OpenStreetMap, NOAA datums, FAA NASR/CIFP via sfo-tower) and plays, watch-only, one heavy jet
flying the ILS 28R from 9 NM to a full stop, on the SFO Tower simulation's own track, with a director cutting between
eight cameras, a bilingual HUD and radio captions, and the day/night cycle of the engine.

## 2. Frozen rules
- Data only from the checksummed cache; pipelines deterministic (two runs byte-identical).
- The flight track is the sim's output: no hand-tuned path. Physics checks (A2) hold against the published ILS (3.0°,
  TCH 68 ft, FAA NASR) and the FAA approach speed.
- Frozen calibrations live in SPEC-THRESHOLDS.md (triangles, draws, fps floor, GPU memory); never lowered to pass.
- No engine edits from the title (Harbor Engine D4); engine changes go out as engine releases.

## 3. Gates (each with negative fixtures; `./verify.sh`)
- A0 Data — cache, checksums, licences, shapes.
- A1 Georeference — runway elevations vs NASR, NAIP pavement under the NASR runways, tower and bridge vs OSM, UTM helper vs engine.
- A2 Flight — pipeline reproducible; glidepath, threshold height, touchdown zone, speeds, heading, continuity, attitude bounds.
- A3 Render — real App headless: every shot shows the aircraft, frame budget caps (calibrated), fps floor and GPU memory cap on the M4.
- A4 Page — build + dependency audit; real Chrome: boots, HUD live, keys switch shots, phone viewport usable, zh captions.
- A5 Look (advisory) — shots at each camera, golden hour and night, for human review.

## 4. Stop rules
Three failed attempts at one gate, data that cannot be fetched by script, or a frozen threshold that would have to
move → BLOCKED.md + the Notion status page. Decisions the SPEC leaves open: decide, log in DECISIONS.md, continue.

## 5. DONE
A0–A4 green in one clean `./verify.sh` run, Pages live, Notion status page + Live Projects Bookmark row.
