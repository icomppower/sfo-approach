# SFO Approach

A heavy jet flies the ILS to runway 28R at San Francisco International over the real bay — a [Harbor Engine](https://github.com/icomppower/harbor-engine) title. The world is USGS terrain, NOAA seabed, NAIP imagery and OpenStreetMap buildings; the runways are FAA NASR; the flight is the [SFO Tower](https://github.com/icomppower/sfo-tower) simulation's own track.

Live: https://icomppower.github.io/sfo-approach/

- Cameras `1`–`8`, `0` auto-director, `F` free camera (`N` / `1`–`6` waypoints there), `R` replay, `P` pause, `T` run the day, `Z` 中文 / English, `H` hide the HUD. URL: `?shot=cockpit`, `?t=180`, `?night`, `?time=19.5`, `?lang=zh`, `?speed=2`, `?game=sightseeing`.
- Data: `npm run fetch-data` then `npm run bake` (terrain, buildings, Blender landmarks and aircraft, the flight). Gates: `./verify.sh`.

SPEC.md is the gate ladder, DECISIONS.md the log, CREDITS.md every source and licence.
