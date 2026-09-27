// shapeTerrain: the 3DEP bare-earth DEM is within ±0.3 m of the runway pavement but noisy; each runway (FAA NASR
// ends + width, plus a 25 m shoulder) is set onto the straight gradient between its published end elevations,
// blended into the DEM over the outer 40 m. Logged: cells touched, largest change.
import { nasr, FT } from './lib/nasr.mjs';
import { toLocal, fromLocal } from './lib/utm.mjs';

export async function shapeTerrain(kit) {
  const apt = nasr(), msl = kit.merged.msl;
  const log = {};
  for (const rw of apt.runways) {
    const [A, B] = apt.ends.filter(e => e.runway === rw.id);
    const a = toLocal(A.endLat, A.endLon), b = toLocal(B.endLat, B.endLon);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], r = [- u[1], u[0]];
    const hA = (A.endElevFt ?? apt.elevFt) * FT - msl, hB = (B.endElevFt ?? apt.elevFt) * FT - msl;
    const half = rw.widthFt * FT / 2 + 25, blend = 40;
    const corner = (s, w) => fromLocal(a[0] + u[0] * s + r[0] * w, a[1] + u[1] * s + r[1] * w);
    const ring = [corner(- blend, - half - blend), corner(L + blend, - half - blend), corner(L + blend, half + blend), corner(- blend, half + blend)];
    const cells = kit.cellsIn([ring]);
    const { res, size } = kit.grid, texel = kit.texel, o = - size / 2;
    let maxChange = 0;
    for (const k of cells) {
      const i = k % res, j = Math.floor(k / res), x = o + (i + 0.5) * texel, z = o + (j + 0.5) * texel;
      const s = (x - a[0]) * u[0] + (z - a[1]) * u[1], w = (x - a[0]) * r[0] + (z - a[1]) * r[1];
      const target = hA + (hB - hA) * Math.max(0, Math.min(1, s / L));
      const out = Math.max(Math.abs(w) - half, - s, s - L, 0); // metres outside the pavement + shoulder
      const t = 1 - Math.min(1, out / blend);
      const h0 = kit.height(k), h = h0 + (target - h0) * (t * t * (3 - 2 * t));
      maxChange = Math.max(maxChange, Math.abs(h - h0));
      kit.setHeight(k, h);
    }
    log[rw.id] = { cells: cells.length, endsM: [Math.round(hA * 100) / 100, Math.round(hB * 100) / 100], maxChangeM: Math.round(maxChange * 100) / 100 };
  }
  return log;
}
