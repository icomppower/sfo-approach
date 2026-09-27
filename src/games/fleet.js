// The fleet for the live sim (Phase 3, SPEC B0): seven Blender silhouettes (public/aircraft/fleet_*.glb) loaded as
// one vertex-coloured mesh per LOD (one draw call per aircraft), instanced per sim aircraft and scaled to that
// type's own FAA ACD length and span (public/sim/fleet.json).
import { BufferGeometry, BufferAttribute, Group, Mesh, Color } from 'harbor-engine/src/engine/index.js';
import { parseGLB } from 'harbor-engine/src/engine/loaders/GLTF.js';
import { Material } from 'harbor-engine';

// merge every primitive of a GLB into one geometry; the material's base colour (sRGB → linear) becomes the vertex colour
function mergedGeometry(buffer) {
  const glb = parseGLB(buffer);
  const P = [], N = [], C = [], I = [];
  let base = 0;
  for (const n of glb.nodes) {
    if (n.mesh === undefined) continue;
    const t = n.t || [0, 0, 0];
    for (const p of glb.meshes[n.mesh]) {
      const m = glb.materials[p.material] || {}, pbr = m.pbrMetallicRoughness || {}, c = pbr.baseColorFactor || [0.8, 0.8, 0.8, 1], e = m.emissiveFactor || [0, 0, 0];
      const col = [Math.min(1, c[0] + e[0]), Math.min(1, c[1] + e[1]), Math.min(1, c[2] + e[2]), 1];
      const pos = p.attributes.POSITION.array, nor = p.attributes.NORMAL.array, count = pos.length / 3;
      for (let k = 0; k < count; k++) { P.push(pos[k * 3] + t[0], pos[k * 3 + 1] + t[1], pos[k * 3 + 2] + t[2]); N.push(nor[k * 3], nor[k * 3 + 1], nor[k * 3 + 2]); C.push(...col); }
      if (p.indices) for (let k = 0; k < p.indices.length; k++) I.push(p.indices[k] + base); else for (let k = 0; k < count; k++) I.push(k + base);
      base += count;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(N), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(C), 4));
  g.setIndex(new BufferAttribute(new Uint32Array(I), 1));
  g.userData.triangles = I.length / 3;
  return g;
}

export class Fleet {
  constructor() { this.classes = {}; this.material = new Material({ name: 'fleet', vertexColors: true, roughness: 0.4, metalness: 0.1 }); this.lodDistances = [900, 3500]; this.refFov = 60; }
  async load(base, aircraftIndex, simIndex) {
    this.lodDistances = aircraftIndex.lodDistances || this.lodDistances;
    this.types = simIndex.types;
    await Promise.all(Object.entries(aircraftIndex.fleet).map(async ([cls, def]) => {
      const lods = await Promise.all(def.lods.map(async (l) => { const r = await fetch(base + 'aircraft/' + l.name); if (!r.ok) throw new Error(`fleet: ${l.name} HTTP ${r.status}`); return mergedGeometry(await r.arrayBuffer()); }));
      this.classes[cls] = { lods, lengthM: def.lengthM, spanM: def.spanM, ref: def.ref };
      if (!(def.lengthM > 0 && def.spanM > 0)) throw new Error(`fleet: class ${cls} has no reference dimensions`);
    }));
    return this;
  }
  // a Group with the three LOD meshes for a sim type, scaled to the type's dimensions
  instance(icao) {
    const t = this.types[icao] || { cls: 'narrow', lengthM: 38, spanM: 34 };
    const cls = this.classes[t.cls] || this.classes.narrow;
    const g = new Group();
    g.name = 'ac-' + icao;
    const sx = t.spanM / cls.spanM, sz = t.lengthM / cls.lengthM, sy = (sx + sz) / 2;
    cls.lods.forEach((geo, i) => { const m = new Mesh(geo, this.material); m.scale.set(sx, sy, sz); m.castShadow = true; m.receiveShadow = false; m.visible = i === 0; g.add(m); });
    g.userData = { cls: t.cls, level: 0, lengthM: t.lengthM, spanM: t.spanM };
    return g;
  }
  updateLod(g, camera) {
    const [d0, d1] = this.lodDistances, k = camera.fov ? this.refFov / camera.fov : 1;
    const d = camera.position.distanceTo(g.position) * Math.min(1, 40 / Math.max(8, g.userData.lengthM)); // small types drop a level sooner
    const level = d < d0 * k ? 0 : d < d1 * k ? 1 : 2;
    if (level !== g.userData.level) { g.children.forEach((m, i) => { m.visible = i === level; }); g.userData.level = level; }
  }
}
