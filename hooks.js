// SFO Approach's pipeline hooks (Harbor Engine contract, docs/ENGINE.md §3). Node only, no engine imports: the
// engine's pipelines hand in a kit; the title's own helpers are relative modules.
//   shapeTerrain( kit )       flatten each runway onto its published gradient (FAA NASR end elevations)
//   collectBuildings( kit )   OSM footprints + heights → kit.finish() per building (pipelines/buildings.mjs)
//   prepareLandmarks( ctx )   OSM → Blender inputs for pipelines/landmarks/build.py (pipelines/landmarks/prepare.mjs)
export { shapeTerrain } from './pipelines/terrain.mjs';
export { collectBuildings } from './pipelines/buildings.mjs';
export { prepareLandmarks } from './pipelines/landmarks/prepare.mjs';
