# Credits and data sources

SFO Approach is built from public data. Every raw file is fetched by `pipelines/data/fetch.mjs`, checksummed into
`data/raw/MANIFEST.sha256`, and only the cache is read by the pipelines (gate A0).

## Elevation, seabed, imagery, tides
- `terrain-3dep.tif` — USGS 3D Elevation Program (3DEP), 6 m resample over the 24 km slice, 2 × 2 quadrant mosaic. Public domain (US Government work, USGS). https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits
- `bathy-ncei.tif` — NOAA NCEI DEM mosaic (topobathy), 6 m resample, 2 × 2 quadrant mosaic. Public domain (US Government work, NOAA NCEI). https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.dem:999919
- `naip-bay.tif` — USDA NAIP natural-colour orthoimagery, 6 m resample over the whole slice (ground colour map), 2 × 2 mosaic. Public domain (US Government work, USDA FSA). https://naip-usdaonline.hub.arcgis.com/
- `naip-airport.tif`, `naip-shore.tif` — USDA NAIP, 2 m resample over the two building boxes (roof colours). Public domain (US Government work, USDA FSA). https://naip-usdaonline.hub.arcgis.com/
- `noaa-datums-9414523.json` — NOAA CO-OPS tidal datums, Redwood City station 9414523 (local MSL = NAVD88 + 0.982 m). Public domain (US Government work, NOAA CO-OPS). https://tidesandcurrents.noaa.gov/datums.html?id=9414523

## OpenStreetMap (ODbL 1.0, © OpenStreetMap contributors, https://www.openstreetmap.org/copyright)
- `osm-buildings-airport.json`, `osm-buildings-shore.json` — building ways (footprints, `height`, `building:levels`). ODbL 1.0.
- `osm-relations-airport.json`, `osm-relations-shore.json` — multipolygon buildings (the terminals, garages, courtyard blocks). ODbL 1.0.
- `osm-airport.json` — SFO aerodrome outline, runways, taxiways, aprons, terminals, the control tower (way 554547693, height 67.36 m). ODbL 1.0.
- `osm-bridge.json` — San Mateo–Hayward Bridge carriageways (ways 42248740, 156047241). ODbL 1.0.

## FAA (via sfo-tower, github.com/icomppower/sfo-tower, pinned by that repo's `data/checksums.json`)
- NASR 28-day subscription (runway ends, displaced thresholds, elevations, ILS, approach lights, widths). Public domain (US Government work, FAA). https://www.faa.gov/air_traffic/flight_info/aeronav/aero_data/NASR_Subscription/
- CIFP (localizers, glidepath angles, threshold crossing heights). Public domain (FAA). https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/cifp/
- Aircraft Characteristics Database (B77W approach speed, dimensions). Public domain (FAA). https://www.faa.gov/airports/engineering/aircraft_char_database
- JO 7110.65 phraseology for the radio captions. Public domain (FAA).

## Models (pipelines/, Blender 5.2, headless)
- Aircraft: a generic twin-engine widebody at the published dimensions of the Boeing 777-300ER (Boeing D6-58329-2 *777-200LR/-300ER Airplane Characteristics for Airport Planning*: length 73.9 m, span 64.8 m, height 18.5 m, fuselage 6.2 m, wheelbase 31.2 m, gear track 11.0 m). No airline livery or trademark.
- SFO control tower: OSM footprint and height; the 2016 tower is 221 ft (SFO / FAA press material).
- San Mateo–Hayward Bridge: OSM carriageways; Caltrans published facts (high-rise west section about 1.9 mi, main-span clearance 135 ft, low trestle about 5 mi).

## Software
- Harbor Engine (github.com/icomppower/harbor-engine, MIT) — rendering, water, sky, pipelines, gates. Its own CREDITS.md lists the engine's upstreams (Tidewater, sky-pro-webgpu, …).
- SFO Tower simulation (github.com/icomppower/sfo-tower, MIT) — the flight model and rules that flew the track.
- Fonts: Inter, JetBrains Mono (Google Fonts, OFL).
