# Decisions

## D1 — A Harbor Engine title, a 24 km square on 6 m cells (2026-09-27)
The owner asked for the flight "with real life openstreetmap view to approach": a 3D cinematic over real data, which SFO
Tower's SPEC §8 had deferred as Phase 2 on Harbor Engine. Bay Crossing's 9.6 km slice stops 20 km north of SFO, so this
is a new title. The square is 24 km (546000–570000 E, 4151000–4175000 N, UTM 10N): KSFO, the 28L/28R final over the
bay to 8 NM, the San Mateo–Hayward Bridge west end at 5 NM, Sweeney Ridge and San Bruno Mountain behind the airport
(without them the western horizon would be open sea). At the engine's 3 m grid that is 64 M cells; the engine gained
an optional `frame.cell` (v1.1.0, additive) and this title uses 6 m: 16 M cells, about 1.6 × Bay Crossing's terrain.

## D2 — No ferry: a stand-in vessel moored at Coyote Point (2026-09-27)
The v1 map contract requires a vessel and a route. No ferry serves this map; a generic 30 m catamaran (the template's
placeholder dimensions) is moored at Coyote Point Marina with a 400 m stand-in route, `capabilities` does not advertise
`vessel` or `route`, and the approach game never uses it. The sightseeing game still works (`?game=sightseeing`).

## D3 — The flight is the SFO Tower simulation's own track (2026-09-27)
`pipelines/flight/build.mjs` runs sfo-tower's deterministic `sim/` (pinned commit) with one B77W placed on the 28R
localizer at 9 NM, cleared for the ILS and to land, and records every second. Pitch = flight-path angle + an approach
angle of attack (5.5° at Vref, less when faster; +2° in the flare, derotation after touchdown); bank from the turn rate.
The weather window is the first seed suffix giving a WEST visual westerly (310/11 kt, `sfo-approach-1`). The runway
geometry comes from the same FAA NASR record, in the title frame, so the aircraft and the markings share one source.

## D4 — Engine imports beyond the public index (2026-09-27)
The game builds its own meshes (markings, lights) and needs the engine's Vector3 / Mesh / BufferGeometry classes, which
`harbor-engine`'s index does not re-export; the game imports them from `harbor-engine/src/engine/index.js`, as Bay
Crossing's own gates already do. Recorded as an engine TODO (re-export a scene/math namespace) rather than copying code.

## D5 — Flattened runways (2026-09-27)
The 3DEP bare-earth DEM is within ±1.7 m of the published runway elevations but noisy; `shapeTerrain` puts each runway
(plus a 25 m shoulder, 40 m blend) on the straight gradient between its NASR end elevations, so the pavement overlay
(0.32 m above the terrain) neither sinks nor floats and the aircraft's touchdown height matches the sim's.

## D6 — Buildings: OSM ways plus multipolygons, class-default heights (2026-09-27)
23,700 footprints in the two boxes (airport / Millbrae / Burlingame / San Bruno; Foster City / San Mateo shoreline /
Coyote Point). Only 2.6 % carry an OSM height or level count; the rest take a class default (terminals, commercial,
industrial 12 m; apartments 10 m; retail 6 m; houses 5.5 m; other 6 m), every fallback counted in the tile index. The
first Overpass extract (`out geom tags`) drops relation members, so multipolygons (the terminals) come from a second
`out geom` extract. Roofs sample the 2 m NAIP boxes.

## D7 — Runway lights that read as points (2026-09-27)
Approach and runway lights are instanced 0.5 m cubes whose vertex shader scales them with camera distance (×1 to ×60),
and whose emission rises with `frame.night`; a photometric point-light system is out of scope. The ALSF-2 (28R) and
MALSR (28L) stand on a modelled pier over the bay as the real ones do.

## D8 — `npm install` needed the owner (2026-09-27)
The session's permission classifier denied installing the pinned GitHub dependencies (harbor-engine, sfo-tower). Every
pipeline was run through the engine checkout (`HARBOR_TITLE=…`, the engine's own documented mode) and the flight builder
with `SFO_TOWER=…`; the build, gates A3–A5 and the deploy wait for `npm install` in the title.
