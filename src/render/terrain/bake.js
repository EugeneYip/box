// CPU bakes for the terrain shader.
//
// bakeAO: large-scale horizon-based ambient occlusion per tile. For each tile
// it marches 8 directions and keeps the highest horizon angle; valleys, gorges
// and the foot of cliffs darken while ridges stay bright. This reads the
// landforms at the far "diorama" zoom where screen-space AO has no effect.
// Water surfaces are treated as flat at sea level for the horizon, so the
// seabed is not darkened by the ocean itself.
const DIRS = [];
for (let k = 0; k < 8; k++) {
  const a = (k / 8) * Math.PI * 2 + 0.2;
  DIRS.push([Math.cos(a), Math.sin(a)]);
}
const STEPS = [1, 2, 3.2, 5, 7.5, 11, 16];

export function bakeAO(world, rect = null, out = null) {
  const W = world.w,
    H = world.h;
  const hgt = world.height;
  const ao = out && out.length === W * H ? out : new Float32Array(W * H).fill(1);
  const x0 = rect ? rect.x0 : 0,
    y0 = rect ? rect.y0 : 0,
    x1 = rect ? rect.x1 : W - 1,
    y1 = rect ? rect.y1 : H - 1;
  const sample = (x, y) => {
    const xi = x < 0 ? 0 : x >= W ? W - 1 : x | 0;
    const yi = y < 0 ? 0 : y >= H ? H - 1 : y | 0;
    return hgt[yi * W + xi];
  };
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const h0 = hgt[y * W + x];
      let occ = 0;
      for (let d = 0; d < 8; d++) {
        const dx = DIRS[d][0],
          dy = DIRS[d][1];
        let best = 0;
        for (let s = 0; s < STEPS.length; s++) {
          const r = STEPS[s];
          const hs = sample(x + 0.5 + dx * r, y + 0.5 + dy * r);
          const t = (hs - h0) / r;
          if (t > best) best = t;
        }
        // sin(atan(t)) = t / sqrt(1 + t^2)
        occ += best / Math.sqrt(1 + best * best);
      }
      occ /= 8;
      // soften: gentle in meadows, strong in deep gorges
      const v = 1 - Math.min(1, occ * 1.25);
      ao[y * W + x] = v * v * 0.35 + v * 0.65;
    }
  }
  return ao;
}
