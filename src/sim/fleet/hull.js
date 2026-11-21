// Hull geometry shared by the fleet's separation, give-way and berths.
// A hull as a capsule: its keel line (the centre plus or minus hullHalf along
// the heading) swept by hullR. Long hulls keep apart end to end and side by
// side alike, which a circle per ship cannot do.
import { BUILDING, VEHICLE } from '../../core/scale.js';

const VS = VEHICLE.sea;
export const HULL_PAD = 0.12 * VS; // a hand's breadth of water round every hull
export const HULL_GAP = 0.1 * VS; // and between two hulls
// The end of a jetty's pier from the docks' centre (the docks model's pier
// reaches 3.4 design units out), and the berth geometry round it: design
// distances at round-13 ship size, scaled with the hulls.
export const PIER_END = 3.4 * BUILDING.scale;
export const PIER = BUILDING.scale;
export const BERTH = VS;
// Round 25: a harbour (docks at level 2 and up) runs its pier on past a stone
// quay to 4.85 design units out, so its berths begin there (half-size hulls
// lay moored under the extension, the quay block through them); and a hull
// moored alongside lies off the pier by half the pier's width (the planks sit
// a little to one side of the docks' centre line, and the quay block is
// wider) plus half its own beam.
// the great hulls that keep to deep water, off rivers and narrow inlets
export const DEEP_WATER = new Set(['carrier', 'liner', 'battleship', 'tanker', 'container', 'autocargo']);
export function pierEnd(h) {
  return (h && h.level >= 2 ? 4.95 : 3.4) * BUILDING.scale;
}
export function pierHalf(h) {
  return (h && h.level >= 2 ? 0.78 : 0.52) * BUILDING.scale;
}
export function hullR(v) {
  return (v.def.beam || 0.5 * VEHICLE.of(v.cls)) * 0.5 + HULL_PAD;
}
export function hullHalf(v) {
  return Math.max(0, v.def.length * 0.5 - hullR(v) * 0.8);
}
// Closest distance between two keel segments: A = a + u*s (|s| <= ha) and
// B = b + w*t (|t| <= hb), u and w unit vectors. `out` gets the vector from
// B's closest point to A's.
export function segDist(ax, az, ux, uz, ha, bx, bz, wx, wz, hb, out) {
  const rx = ax - bx,
    rz = az - bz;
  const k = ux * wx + uz * wz,
    d = ux * rx + uz * rz,
    e = wx * rx + wz * rz;
  const den = 1 - k * k;
  let s = den > 1e-6 ? (k * e - d) / den : 0;
  s = Math.max(-ha, Math.min(ha, s));
  const t = Math.max(-hb, Math.min(hb, e + k * s));
  s = Math.max(-ha, Math.min(ha, k * t - d));
  out.x = rx + ux * s - wx * t;
  out.z = rz + uz * s - wz * t;
  return Math.hypot(out.x, out.z);
}
