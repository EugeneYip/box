// Worldseed original icon set.
//
// Every icon is drawn on a 32 x 32 grid with a 2 px round stroke in
// currentColor plus an optional duotone fill in the icon's tint (CSS var
// --tint). Classes used inside the markup (styled in style.css):
//   (none)  stroke currentColor          .f   duotone tint fill (soft)
//   .s      solid currentColor fill      .ts  solid tint fill
//   .t      tint-coloured stroke         .th  thin (1.5 px) stroke
// Icons are keyed by power id; unknown ids fall back to keyword glyphs and,
// failing that, a generated monogram badge on a category-tinted glyph.
import { TILE, TILE_INFO } from '../world/constants.js';

const r1 = (n) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- generators
function wave(y, x0 = 3, x1 = 29, n = 4, a = 2.2) {
  const seg = (x1 - x0) / n;
  let d = `M${x0} ${y}`;
  for (let i = 0; i < n; i++) {
    const xs = x0 + i * seg;
    const up = i % 2 === 0 ? -a : a;
    d += `C${r1(xs + seg * 0.36)} ${r1(y + up * 1.33)} ${r1(xs + seg * 0.64)} ${r1(y + up * 1.33)} ${r1(xs + seg)} ${y}`;
  }
  return d;
}
function star(cx, cy, ro, ri, n = 5, rot = -90) {
  let d = '';
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? ri : ro;
    const a = ((rot + (i * 180) / n) * Math.PI) / 180;
    d += (i ? 'L' : 'M') + r1(cx + Math.cos(a) * r) + ' ' + r1(cy + Math.sin(a) * r);
  }
  return d + 'Z';
}
// Four-point sparkle.
function sparkle(cx, cy, r, k = 0.28) {
  const q = r * k;
  return `M${cx} ${r1(cy - r)}Q${r1(cx + q)} ${r1(cy - q)} ${r1(cx + r)} ${cy}Q${r1(cx + q)} ${r1(cy + q)} ${cx} ${r1(cy + r)}Q${r1(cx - q)} ${r1(cy + q)} ${r1(cx - r)} ${cy}Q${r1(cx - q)} ${r1(cy - q)} ${cx} ${r1(cy - r)}Z`;
}
function flower(cx, cy, ri, ro, n = 5, rot = -90) {
  let d = '';
  for (let i = 0; i <= n; i++) {
    const a = ((rot + (i * 360) / n + 180 / n) * Math.PI) / 180;
    const x = cx + Math.cos(a) * ri,
      y = cy + Math.sin(a) * ri;
    if (i === 0) d += `M${r1(x)} ${r1(y)}`;
    else {
      const am = a - Math.PI / n;
      const s = Math.PI / n / 1.25;
      const c1x = cx + Math.cos(am - s) * ro * 1.18,
        c1y = cy + Math.sin(am - s) * ro * 1.18;
      const c2x = cx + Math.cos(am + s) * ro * 1.18,
        c2y = cy + Math.sin(am + s) * ro * 1.18;
      d += `C${r1(c1x)} ${r1(c1y)} ${r1(c2x)} ${r1(c2y)} ${r1(x)} ${r1(y)}`;
    }
  }
  return d + 'Z';
}
function rays(cx, cy, r0, r1_, n = 8, off = 0) {
  let d = '';
  for (let i = 0; i < n; i++) {
    const a = ((off + (i * 360) / n) * Math.PI) / 180;
    d += `M${r1(cx + Math.cos(a) * r0)} ${r1(cy + Math.sin(a) * r0)}L${r1(cx + Math.cos(a) * r1_)} ${r1(cy + Math.sin(a) * r1_)}`;
  }
  return d;
}
function spiral(cx, cy, turns, rMax, steps = 56) {
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = t * turns * Math.PI * 2;
    const r = 0.6 + t * rMax;
    d += (i ? 'L' : 'M') + r1(cx + Math.cos(a) * r) + ' ' + r1(cy + Math.sin(a) * r);
  }
  return d;
}
function gear(cx, cy, ro, ri, teeth = 8) {
  let d = '';
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    const pts = [
      [a - step * 0.5, ri],
      [a - step * 0.22, ri],
      [a - step * 0.14, ro],
      [a + step * 0.14, ro],
      [a + step * 0.22, ri],
    ];
    for (const [aa, r] of pts) d += (d ? 'L' : 'M') + r1(cx + Math.cos(aa) * r) + ' ' + r1(cy + Math.sin(aa) * r);
  }
  return d + 'Z';
}
function hexagon(cx, cy, r) {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = ((30 + i * 60) * Math.PI) / 180;
    d += (i ? 'L' : 'M') + r1(cx + Math.cos(a) * r) + ' ' + r1(cy + Math.sin(a) * r);
  }
  return d + 'Z';
}
const g = (tf, inner) => `<g transform="${tf}">${inner}</g>`;

// ---------------------------------------------------------------- shared parts
const CLOUD = 'M9 21h14.5a5 5 0 0 0 .6-9.97A7.5 7.5 0 0 0 9.9 11.6 4.75 4.75 0 0 0 9 21z';
const cloud = (dy = -3, fillCls = 'f') => g(`translate(0 ${dy})`, `<path class="${fillCls}" d="${CLOUD}"/><path d="${CLOUD}"/>`);
const BOLT = 'M17.5 15 12 23h4.5L14 30l7.5-9.5H17l2.5-5.5z';
const GROUND = 'M3 23.5c4-2 8.5-3 13-3s9 1 13 3V27a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z';
const GROUND_TOP = 'M3 23.5c4-2 8.5-3 13-3s9 1 13 3';
const ground = () => `<path class="f" d="${GROUND}"/><path d="${GROUND_TOP}"/>`;
// Biome swatch: a tinted map-tile hexagon behind the motif, so biomes read by
// colour first and silhouette second.
const SWATCH = `<path class="sw" d="${hexagon(16, 16, 14.6)}"/><path class="swl" d="${hexagon(16, 16, 14.6)}"/>`;
const CONIFER = (x, y, s = 1) =>
  g(
    `translate(${x} ${y}) scale(${s})`,
    '<path class="f" d="M0 -9 -5 -1.5h2.6L-6.5 5h13L2.4-1.5H5z"/><path d="M0 -9 -5 -1.5h2.6L-6.5 5h13L2.4-1.5H5z"/><path d="M0 5v3"/>',
  );
const CANOPY = 'M16 3.5c5 0 8.2 3.8 8.2 8 2 1 3.3 3.1 3.3 5.4a6.2 6.2 0 0 1-6.2 6.2H10.7a6.2 6.2 0 0 1-6.2-6.2c0-2.3 1.3-4.4 3.3-5.4 0-4.2 3.2-8 8.2-8z';
const ROUND_TREE = (x, y, s = 1) =>
  g(`translate(${x} ${y}) scale(${s}) translate(-16 -16)`, `<path class="f" d="${CANOPY}"/><path d="${CANOPY}"/><path d="M16 29V14.5M16 19.5l-4-3.5M16 17.2l3.4-2.8"/>`);
const PERSON_BUST =
  '<circle class="f" cx="16" cy="10.5" r="5"/><circle cx="16" cy="10.5" r="5"/><path class="f" d="M6 28v-1.5c0-5 4.5-8.5 10-8.5s10 3.5 10 8.5V28z"/><path d="M6 28v-1.5c0-5 4.5-8.5 10-8.5s10 3.5 10 8.5V28"/>';
const SKULL =
  '<path class="f" d="M7.5 15a8.5 8.5 0 1 1 17 0c0 3.2-1.6 5.5-3.8 6.6V26h-9.4v-4.4C9.1 20.5 7.5 18.2 7.5 15z"/><path d="M7.5 15a8.5 8.5 0 1 1 17 0c0 3.2-1.6 5.5-3.8 6.6V26h-9.4v-4.4C9.1 20.5 7.5 18.2 7.5 15z"/><circle class="s" cx="12.6" cy="15.2" r="2.3"/><circle class="s" cx="19.4" cy="15.2" r="2.3"/><path class="th" d="M14.6 26v-2.8M17.4 26v-2.8M16 18.6l-1 2h2z"/>';
const GERM = `<circle class="f" cx="16" cy="16" r="7"/><circle cx="16" cy="16" r="7"/>${rays(16, 16, 7, 10.5, 8, 22.5)
  .split('M')
  .filter(Boolean)
  .map((s) => `<path d="M${s}"/>`)
  .join('')}${[0, 1, 2, 3, 4, 5, 6, 7]
  .map((i) => {
    const a = ((22.5 + i * 45) * Math.PI) / 180;
    return `<circle class="s" cx="${r1(16 + Math.cos(a) * 11.6)}" cy="${r1(16 + Math.sin(a) * 11.6)}" r="1.5"/>`;
  })
  .join('')}<circle class="s" cx="13.5" cy="14.5" r="1.6"/><circle class="s" cx="18.3" cy="17.8" r="1.2"/><circle class="s" cx="17.6" cy="13" r=".9"/>`;
const SWORD = (flip) =>
  g(
    flip ? 'translate(32 0) scale(-1 1)' : '',
    '<path class="f" d="M27 4.5 26.4 8 13.2 21.2l-2.4-2.4L24 5.1z"/><path d="M27 4.5 26.4 8 13.2 21.2l-2.4-2.4L24 5.1z"/><path d="M8.3 16.9l6.8 6.8M10.6 21.4 6.2 25.8"/><circle class="s" cx="5.3" cy="26.7" r="1.6"/>',
  );
const HOUSE = (x, y, s = 1) =>
  g(
    `translate(${x} ${y}) scale(${s})`,
    '<path class="f" d="M-7 9V-1.5L0-7.5l7 6V9z"/><path d="M-8.5 0 0-7.5 8.5 0M-7 -1.2V9h14V-1.2"/><path d="M-2 9V4h4v5"/>',
  );
const SUN = (cx = 16, cy = 16, r = 5.2, r0 = 8.4, r1_ = 11.8) =>
  `<circle class="f" cx="${cx}" cy="${cy}" r="${r}"/><circle cx="${cx}" cy="${cy}" r="${r}"/><path d="${rays(cx, cy, r0, r1_, 8)}"/>`;
const MOON = 'M20.5 4.6A11.5 11.5 0 1 0 27.4 20.9 9 9 0 0 1 20.5 4.6z';
const SNOWFLAKE = (cx, cy, r) => {
  let d = '';
  for (let i = 0; i < 6; i++) {
    const a = ((i * 60 - 90) * Math.PI) / 180;
    const x = cx + Math.cos(a) * r,
      y = cy + Math.sin(a) * r;
    d += `M${cx} ${cy}L${r1(x)} ${r1(y)}`;
    const bx = cx + Math.cos(a) * r * 0.58,
      by = cy + Math.sin(a) * r * 0.58;
    for (const s of [-1, 1]) {
      const a2 = a + s * 0.75;
      d += `M${r1(bx)} ${r1(by)}L${r1(bx + Math.cos(a2) * r * 0.34)} ${r1(by + Math.sin(a2) * r * 0.34)}`;
    }
  }
  return `<path d="${d}"/>`;
};
const DROPS = (cls = '') =>
  `<path class="${cls}" d="M11 21.5 9.5 25M16.5 21.5 15 25M22 21.5 20.5 25M13.5 26.5 12.6 28.6M19 26.5l-.9 2.1"/>`;
const WHEAT = (x, y, s = 1) =>
  g(
    `translate(${x} ${y}) scale(${s})`,
    '<path d="M0 12V-10"/>' +
      [-7, -3, 1, 5]
        .map(
          (yy) =>
            `<path class="f" d="M0 ${yy}c-3.2-.4-4.6-2.4-4.6-4.6 3 .2 4.6 2 4.6 4.6zM0 ${yy}c3.2-.4 4.6-2.4 4.6-4.6-3 .2-4.6 2-4.6 4.6z"/><path class="th" d="M0 ${yy}c-3.2-.4-4.6-2.4-4.6-4.6 3 .2 4.6 2 4.6 4.6zM0 ${yy}c3.2-.4 4.6-2.4 4.6-4.6-3 .2-4.6 2-4.6 4.6z"/>`,
        )
        .join('') +
      '<path class="f" d="M0-10c-1.4-1.8-1.4-4 0-5.6 1.4 1.6 1.4 3.8 0 5.6z"/><path class="th" d="M0-10c-1.4-1.8-1.4-4 0-5.6 1.4 1.6 1.4 3.8 0 5.6z"/>',
  );

// ---------------------------------------------------------------- category glyphs
export const CATEGORY_ICONS = {
  terrain:
    '<path class="f" d="M2.5 26.5 12 9l5 9.2 3.6-5.2 8.9 13.5z"/><path d="M2.5 26.5 12 9l9.3 17.5M17.3 18.6l3.3-5.1 8.9 13M2.5 26.5h27"/><path class="s" d="M12 9 9.3 14l1.9 1.6 1.8-1.7 2.5 1.8z"/>',
  biome:
    '<circle class="f" cx="16" cy="16" r="12"/><circle cx="16" cy="16" r="12"/><path d="M4.6 12.5c3.2 2.2 6.2 2.2 9-.2s6.4-3 9.7-.6c1.6 1.1 3 1.4 4.3 1.2"/><path d="M4.4 19.7c3.4 1.9 6.6 1.7 9.6-.8 3-2.4 6.3-2.6 9.4-.5 1.6 1.1 3.1 1.6 4.6 1.6"/><path class="s" d="M14.3 9.7c1.1 0 2.6-1.3 4.3-1.5 1-.1 1.3.6.8 1.4-.9 1.4-3 1.6-5.1.1z" opacity=".9"/>',
  nature:
    '<path class="f" d="M16 3.5c5 0 8.2 3.8 8.2 8 2 1 3.3 3.1 3.3 5.4a6.2 6.2 0 0 1-6.2 6.2H10.7a6.2 6.2 0 0 1-6.2-6.2c0-2.3 1.3-4.4 3.3-5.4 0-4.2 3.2-8 8.2-8z"/><path d="M16 3.5c5 0 8.2 3.8 8.2 8 2 1 3.3 3.1 3.3 5.4a6.2 6.2 0 0 1-6.2 6.2H10.7a6.2 6.2 0 0 1-6.2-6.2c0-2.3 1.3-4.4 3.3-5.4 0-4.2 3.2-8 8.2-8z"/><path d="M16 29V14.5M16 19.5l-4-3.5M16 17.2l3.4-2.8"/>',
  life:
    '<path class="f" d="M16 15.2c3.6 0 7.4 4.6 7.4 8.4 0 2.6-1.9 3.9-3.8 3.9-1.4 0-2.4-.7-3.6-.7s-2.2.7-3.6.7c-1.9 0-3.8-1.3-3.8-3.9 0-3.8 3.8-8.4 7.4-8.4z"/><path d="M16 15.2c3.6 0 7.4 4.6 7.4 8.4 0 2.6-1.9 3.9-3.8 3.9-1.4 0-2.4-.7-3.6-.7s-2.2.7-3.6.7c-1.9 0-3.8-1.3-3.8-3.9 0-3.8 3.8-8.4 7.4-8.4z"/><ellipse class="s" cx="6.2" cy="13.6" rx="2.4" ry="3.1" transform="rotate(-24 6.2 13.6)"/><ellipse class="s" cx="11.6" cy="7.4" rx="2.5" ry="3.3" transform="rotate(-8 11.6 7.4)"/><ellipse class="s" cx="20.4" cy="7.4" rx="2.5" ry="3.3" transform="rotate(8 20.4 7.4)"/><ellipse class="s" cx="25.8" cy="13.6" rx="2.4" ry="3.1" transform="rotate(24 25.8 13.6)"/>',
  civ:
    '<path class="f" d="M6 28V12.5h3.5v2.4h2.6v-2.4h3.8V28zM16 28V12.5h3.8v2.4h2.6v-2.4H26V28z"/><path d="M6 28V12.5h3.5v2.4h2.6v-2.4h7.6v2.4h2.6v-2.4H26V28zM4 28h24"/><path d="M13 28v-5a3 3 0 0 1 6 0v5M16 12.5V3.5"/><path class="ts" d="M16 3.5h7l-2 2.4 2 2.4h-7z"/><path d="M16 3.5h7l-2 2.4 2 2.4h-7"/>',
  disaster:
    '<path class="f" d="M18.5 3 7.5 18h7l-3 11 13-15.5h-7.2L22 3z"/><path d="M18.5 3 7.5 18h7l-3 11 13-15.5h-7.2L22 3z"/>',
  world:
    '<circle class="f" cx="16" cy="16" r="10"/><circle cx="16" cy="16" r="10"/><path d="M6 16h20M16 6c-3.2 3-4.6 6.4-4.6 10s1.4 7 4.6 10c3.2-3 4.6-6.4 4.6-10S19.2 9 16 6z"/><path class="th" d="M4 21.5c-1.7 1.9-2.1 3.4-1.3 4.2 1.8 1.8 9.3-2.2 16.7-9.6S28.5 3.6 26.7 1.8c-.8-.8-2.3-.4-4.2 1.3"/>',
};

// ---------------------------------------------------------------- power icons
const P = {
  // --- terrain -------------------------------------------------------------
  raise:
    '<path class="f" d="M2.5 27.5c3-7 7.5-10.8 13.5-10.8s10.5 3.8 13.5 10.8z"/><path d="M2.5 27.5c3-7 7.5-10.8 13.5-10.8s10.5 3.8 13.5 10.8M2.5 27.5h27"/><path d="M16 13V3.5M11.5 8 16 3.5 20.5 8"/>',
  lower:
    '<path class="f" d="M2.5 15.5H7c2.8 0 3.6 11 9 11s6.2-11 9-11h4.5v12h-27z"/><path d="M2.5 15.5H7c2.8 0 3.6 11 9 11s6.2-11 9-11h4.5"/><path d="M16 3.5V17M11.5 12.5 16 17l4.5-4.5"/>',
  flatten:
    '<rect class="f" x="3" y="19.5" width="26" height="8" rx="2"/><rect x="3" y="19.5" width="26" height="8" rx="2"/><path d="M10 3.5v11M6.5 11 10 14.5l3.5-3.5M22 3.5v11M18.5 11l3.5 3.5 3.5-3.5"/>',
  mountain:
    '<path class="f" d="M2.5 27 12.5 8.5 18 18.8l3.4-5.1L29.5 27z"/><path d="M2.5 27 12.5 8.5 22 27M18 18.8l3.4-5.1L29.5 27M2.5 27h27"/><path class="s" d="M12.5 8.5 9.6 13.9l1.9 1.6 1.9-1.8 2.6 1.9z"/>',
  ocean: `<path class="f" d="${wave(10.5)}V26a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="${wave(10.5)}"/><path d="${wave(17)}"/><path d="${wave(23.5, 3, 29, 4, 1.8)}"/>`,
  land:
    `<path class="f" d="M5.5 24.5c2.2-7 5.8-10.5 10.5-10.5s8.3 3.5 10.5 10.5z"/><path d="M5.5 24.5c2.2-7 5.8-10.5 10.5-10.5s8.3 3.5 10.5 10.5"/>` +
    '<path d="M16 14V8"/><path class="s" d="M16 10.4c-.6-2.6-2.6-4.1-5.2-4.1 0 2.6 2.1 4.3 5.2 4.1zM16 9.2c.6-2.4 2.4-3.8 4.8-3.8 0 2.4-1.9 4-4.8 3.8z"/>' +
    `<path d="${wave(26, 2.5, 29.5, 4, 1.6)}"/>`,
  smooth:
    '<path class="th" d="M3 12 7 6.5l4 6 4-7.5 4 7.5 4-5 6 4.5"/><path d="M16 15.5v4M13.5 17.5 16 20l2.5-2.5"/>' +
    `<path class="f" d="${wave(24, 3, 29, 2, 1.6)}V28H3z"/><path d="${wave(24, 3, 29, 2, 1.6)}"/>`,
  river:
    '<path class="f" d="M4 3.5h6c0 6 12.5 5.3 12.5 12.5S10 22.5 10 28.5H4C4 21.7 16.5 22 16.5 16S4 10.3 4 3.5z" transform="translate(3 0)"/><path d="M7 3.5c0 6.8 12.5 6.5 12.5 12.5S7 22.4 7 28.5M13 3.5c0 6 12.5 5.3 12.5 12.5S13 22.5 13 28.5"/>',
  hill: '<path class="f" d="M2.5 27C5 19 9.5 14.5 16 14.5s11 4.5 13.5 12.5z"/><path d="M2.5 27C5 19 9.5 14.5 16 14.5s11 4.5 13.5 12.5M2.5 27h27"/>' + CONIFER(21, 11.2, 0.62) + CONIFER(13.4, 12.4, 0.5),
  canyon:
    '<path class="f" d="M3 9h7l2 5 1.5 1 1 13H3zM29 9h-7l-2.5 4.5-1.5 2-.5 12.5H29z"/><path d="M3 9h7l2 5 1.5 1 1 13M29 9h-7l-2.5 4.5-1.5 2-.5 12.5"/><path class="th" d="M15 23.5h2.5"/>',

  // --- biomes (ground swatch + motif) ---------------------------------------
  'paint-grass': SWATCH + '<path d="M9 21.5c0-4.2-1.6-7.6-4.4-10.2M12.6 20.8c0-5.2.6-9.4 2.8-13.4M17.6 20.6c.4-4.4 2.3-8.2 5.6-10.8M22.4 21.6c.6-3 2.2-5.3 4.8-6.8"/>',
  'paint-forest': SWATCH + CONIFER(11.5, 13) + CONIFER(21, 15.6, 0.72),
  'paint-jungle':
    SWATCH +
    '<path class="f" d="M8 20.5C5.5 12.5 9.5 5 20 3.5c3.2 8.6-.6 16.8-12 17z"/><path d="M8 20.5C5.5 12.5 9.5 5 20 3.5c3.2 8.6-.6 16.8-12 17z"/><path class="th" d="M8 20.5c3.4-5.5 6.7-10 12-17M10.6 15.6l-2.3-4.2M13.4 11.7l-1.6-5M12 17.4l5.4.3M15.2 13.6l5.6-.8"/>' +
    '<path class="f" d="M18.5 21c1.2-4.4 4.5-7.4 9.3-7.4-1 4.3-4.4 7.4-9.3 7.4z"/><path class="th" d="M18.5 21c1.2-4.4 4.5-7.4 9.3-7.4-1 4.3-4.4 7.4-9.3 7.4z"/>',
  'paint-savanna':
    SWATCH +
    '<path class="f" d="M5.5 10.8c1.8-2.9 5.6-4.2 10.5-4.2s8.7 1.3 10.5 4.2c-2.2 1.8-6 2.5-10.5 2.5s-8.3-.7-10.5-2.5z"/><path d="M5.5 10.8c1.8-2.9 5.6-4.2 10.5-4.2s8.7 1.3 10.5 4.2c-2.2 1.8-6 2.5-10.5 2.5s-8.3-.7-10.5-2.5z"/><path d="M16 13.3v8M16 17l-3.6-3.6M16 16.2l3.8-2.9"/>',
  'paint-desert':
    `<circle class="f" cx="21.5" cy="8.5" r="4"/><circle cx="21.5" cy="8.5" r="4"/>` +
    '<path class="f" d="M3 22.5c4-5.6 8.6-7.6 13.5-6.3 4.2 1.1 7.4 3.8 12.5 4V27a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 22.5c4-5.6 8.6-7.6 13.5-6.3 4.2 1.1 7.4 3.8 12.5 4"/><path class="th" d="M9.5 25.5c4.4-2.8 9.4-3.4 15-1.6"/>',
  'paint-sand': SWATCH + `<path class="f" d="${star(16, 12.3, 8.6, 3.7)}"/><path d="${star(16, 12.3, 8.6, 3.7)}"/><circle class="s" cx="16" cy="12.6" r="1.1"/>`,
  'paint-swamp':
    SWATCH +
    '<path d="M11 21V10.5M16.2 20.6V7M21.4 21v-8"/><rect class="s" x="9.4" y="9" width="3.2" height="6.6" rx="1.6"/><rect class="s" x="14.6" y="5.6" width="3.2" height="6.8" rx="1.6"/><rect class="s" x="19.8" y="11.6" width="3.2" height="5.8" rx="1.6"/><path class="th" d="M16.2 20.6c-2.4-2.6-5.8-4-9.2-4M5.5 26h5M21 26h5.5"/>',
  'paint-tundra':
    SWATCH +
    '<path d="M4.5 7.5h13a3 3 0 1 0-3-3M7.5 12.5h16a3 3 0 1 1-3 3"/><path class="f" d="M8.5 21c.8-2.6 2.8-4 5-4s4.2 1.4 5 4z"/><path d="M8.5 21c.8-2.6 2.8-4 5-4s4.2 1.4 5 4"/><path class="th" d="M22 21v-3.2M24.2 21.2l1-3M19.8 21.2l-.8-2.6"/>',
  'paint-snow': SWATCH + SNOWFLAKE(16, 11.2, 8.4),
  'paint-soil':
    SWATCH +
    '<path d="M13.2 3.6h5.6M16 3.6v9.8"/><path class="f" d="M12.4 13.4h7.2v4.2a3.6 3.6 0 0 1-7.2 0z"/><path d="M12.4 13.4h7.2v4.2a3.6 3.6 0 0 1-7.2 0z"/><circle class="s" cx="7.6" cy="25.4" r="1.2"/><circle class="s" cx="24.6" cy="25.6" r="1.2"/><circle class="s" cx="11.6" cy="26.4" r=".9"/><circle class="s" cx="20.4" cy="26.4" r=".9"/>',
  'paint-rock':
    SWATCH +
    '<path class="f" d="M5.5 21.5 8 13.6l5.6-3.6 6.2 1.8 3 5.2.8 4.5z"/><path d="M5.5 21.5 8 13.6l5.6-3.6 6.2 1.8 3 5.2.8 4.5"/><path class="th" d="M8 13.6l4.4 3.2 1.8 4.7M13.6 10l-1.2 6.8 6.5-2.7 3.9 2.9"/><path class="f" d="M22 21.6l1.7-3.8 3-.8 2 2v2.6z"/><path class="th" d="M22 21.6l1.7-3.8 3-.8 2 2"/>',
  'paint-ice':
    SWATCH +
    '<path class="f" d="M9 21l2.5-12 3 6 2.5-10 3.5 9 2.5-4 2 11z"/><path d="M9 21l2.5-12 3 6 2.5-10 3.5 9 2.5-4 2 11"/><path class="th" d="M14.5 15l-1 6M20.5 14l.5 7"/>',
  'paint-lava':
    SWATCH +
    '<path class="ts" d="M16 4c3.2 4.6 5.4 8.1 5.4 10.8a5.4 5.4 0 0 1-10.8 0C10.6 12.1 12.8 8.6 16 4z" opacity=".55"/><path d="M16 4c3.2 4.6 5.4 8.1 5.4 10.8a5.4 5.4 0 0 1-10.8 0C10.6 12.1 12.8 8.6 16 4z"/><circle class="s" cx="24.5" cy="9" r="1.4"/><circle class="s" cx="7.5" cy="11" r="1.1"/>',
  'paint-ash':
    SWATCH +
    '<path d="M11.5 18c-2.2-2.2-.4-4.3 1.4-5.6 1.8-1.3 2.3-3.5.5-5.5M18 18c-2-2-.4-4 1.3-5.2 1.7-1.2 2-3.2.4-5.1"/><path class="th" d="M23.5 18.5c-1.3-1.3-.3-2.6.8-3.4"/>',
  'paint-farmland':
    '<path class="f" d="M2.5 27.5 7 14h18l4.5 13.5z"/><path d="M2.5 27.5 7 14h18l4.5 13.5z"/><path class="th" d="M11 14 9.5 27.5M16 14v13.5M21 14l1.5 13.5"/>' + WHEAT(16, 7, 0.45),
  'paint-road':
    '<path class="f" d="M12 4h8l7 24H5z"/><path d="M12 4 5 28M20 4l7 24"/><path d="M16 6v3M16 13v4M16 21v5"/>',

  // --- nature ------------------------------------------------------------
  'plant-forest':
    '<path class="f" d="M7 27.5c2.2-3 5.2-4.6 9-4.6s6.8 1.6 9 4.6z"/><path d="M7 27.5c2.2-3 5.2-4.6 9-4.6s6.8 1.6 9 4.6"/><path d="M16 23V13"/>' +
    '<path class="f" d="M16 16.6c-1.2-3.8-4.4-6-8.6-6 0 4 3.4 6.4 8.6 6zM16 14.2c.9-3.4 3.8-5.6 7.6-5.6 0 3.6-3.1 5.8-7.6 5.6z"/><path d="M16 16.6c-1.2-3.8-4.4-6-8.6-6 0 4 3.4 6.4 8.6 6zM16 14.2c.9-3.4 3.8-5.6 7.6-5.6 0 3.6-3.1 5.8-7.6 5.6z"/>' +
    '<ellipse class="s" cx="9" cy="4.6" rx="1.3" ry="1.7" transform="rotate(-30 9 4.6)"/><ellipse class="s" cx="15.6" cy="3.6" rx="1.3" ry="1.7"/><ellipse class="s" cx="25.6" cy="4.4" rx="1.3" ry="1.7" transform="rotate(30 25.6 4.4)"/>',
  'clear-flora':
    g('translate(-2.5 -3.2) scale(.72)', `<path class="f" d="${CANOPY}"/><path d="${CANOPY}" style="stroke-width:2.78"/>`) +
    '<path d="M9 13.4v7.4M9 20.8c-.8 2.2-2.6 3.4-4.8 3.8M9 20.8c.8 2.2 2.6 3.4 4.8 3.8M9 20.8v4.8"/>' +
    '<path class="th" d="M2.5 28h1.6M14.4 28h3"/><path d="M24.5 27V9.5M19.6 14.4l4.9-4.9 4.9 4.9"/>',
  'plant-flowers':
    `<path d="M16 16.5V28"/><path class="f" d="M16 24.5c-3.6.2-6.2-1.8-6.8-5 3.4-.1 6 1.6 6.8 5zM16 22c3-.2 5.4-2 5.8-4.8-3 .1-5.2 1.6-5.8 4.8z"/><path d="M16 24.5c-3.6.2-6.2-1.8-6.8-5 3.4-.1 6 1.6 6.8 5zM16 22c3-.2 5.4-2 5.8-4.8-3 .1-5.2 1.6-5.8 4.8z"/>` +
    `<path class="f" d="${flower(16, 10, 3.2, 7.4)}"/><path d="${flower(16, 10, 3.2, 7.4)}"/><circle class="s" cx="16" cy="10" r="2.3"/>`,
  'plant-bush':
    '<path class="f" d="M7 25.5c-3 0-3.8-4.6-.8-5.6-1-4.2 3.6-6.6 6.2-3.8 1.2-3.8 7.6-3.8 8.8 0 2.6-2.8 7.2-.4 6.2 3.8 3 1 2.2 5.6-.8 5.6z"/><path d="M7 25.5c-3 0-3.8-4.6-.8-5.6-1-4.2 3.6-6.6 6.2-3.8 1.2-3.8 7.6-3.8 8.8 0 2.6-2.8 7.2-.4 6.2 3.8 3 1 2.2 5.6-.8 5.6zM4 28.5h24"/>',
  'plant-berries':
    '<path class="f" d="M7 25.5c-3 0-3.8-4.6-.8-5.6-1-4.2 3.6-6.6 6.2-3.8 1.2-3.8 7.6-3.8 8.8 0 2.6-2.8 7.2-.4 6.2 3.8 3 1 2.2 5.6-.8 5.6z"/><path d="M7 25.5c-3 0-3.8-4.6-.8-5.6-1-4.2 3.6-6.6 6.2-3.8 1.2-3.8 7.6-3.8 8.8 0 2.6-2.8 7.2-.4 6.2 3.8 3 1 2.2 5.6-.8 5.6z"/><circle class="s" cx="11" cy="20.5" r="1.7"/><circle class="s" cx="16.5" cy="17.4" r="1.7"/><circle class="s" cx="21.2" cy="21.2" r="1.7"/><circle class="s" cx="14.4" cy="22.6" r="1.4"/>',
  'plant-cactus':
    '<path class="f" d="M13 28V7.5a3 3 0 0 1 6 0V28z"/><path d="M13 28V7.5a3 3 0 0 1 6 0V28M13 20H9.5a3 3 0 0 1-3-3v-4.2a1.6 1.6 0 0 1 3.2 0V16.6H13M19 17.2h2.6V11a1.6 1.6 0 0 1 3.2 0v6.2a3 3 0 0 1-3 3H19M8 28h16"/>',
  'plant-palm':
    '<path d="M15.5 27.5c-.2-5.8.8-11.2 3-15.8"/><path class="f" d="M18.5 11.7c-2.6-3-6.6-3.8-10.6-2.2 2.8.6 4.6 1.8 5.6 3.6zM18.5 11.7c-.4-3.8-3.4-6.6-7.2-7.4 1.8 2 2.4 3.8 2.2 5.8zM18.5 11.7c2-3.4 5.8-4.6 9.4-3.6-2.4 1-3.8 2.4-4.4 4.2zM18.5 11.7c3.4-.6 6.8 1 8.4 4.2-2.2-.6-4-.4-5.6.6z"/><path d="M18.5 11.7c-2.6-3-6.6-3.8-10.6-2.2M18.5 11.7c-.4-3.8-3.4-6.6-7.2-7.4M18.5 11.7c2-3.4 5.8-4.6 9.4-3.6M18.5 11.7c3.4-.6 6.8 1 8.4 4.2"/><path d="M7 28.5c2.8-1.6 5.8-2.2 9-2.2s6.2.6 9 2.2"/>',
  'plant-pine': CONIFER(16, 15, 1.35),
  'plant-tree': ROUND_TREE(16, 16, 1),
  'plant-mushroom':
    '<path class="f" d="M4.5 16c0-6 5.2-10.5 11.5-10.5S27.5 10 27.5 16z"/><path d="M4.5 16c0-6 5.2-10.5 11.5-10.5S27.5 10 27.5 16z"/><path d="M12 16v8.5a2.5 2.5 0 0 0 2.5 2.5h3a2.5 2.5 0 0 0 2.5-2.5V16"/><circle class="s" cx="11" cy="11" r="1.6"/><circle class="s" cx="17.6" cy="8.8" r="1.4"/><circle class="s" cx="22" cy="12.6" r="1.6"/>',
  'plant-reeds':
    '<path d="M10 28V12M16 28V7.5M22 28V13"/><rect class="s" x="8.4" y="10" width="3.2" height="7" rx="1.6"/><rect class="s" x="14.4" y="5.5" width="3.2" height="7.4" rx="1.6"/><rect class="s" x="20.4" y="11" width="3.2" height="6.4" rx="1.6"/><path class="th" d="M16 28c-1-4-4-7-9-8.5M16 28c1.4-3.4 4.4-5.6 9-6.4"/>',
  'plant-wheat': WHEAT(11, 15, 0.9) + WHEAT(21, 16, 0.9),
  'plant-grass': '<path d="M3 27.5h26"/><path d="M8.5 27c0-5-2-9.2-5-12M13 27c0-6.4.8-11.6 3.4-16.4M19 27c.4-5.4 2.8-10 6.8-13.2M24 27c.8-3.6 2.8-6.4 5-8"/>',
  'plant-rocks':
    '<path class="f" d="M4 26.5 6.5 18l6-4 7 2 3.2 5.6.8 4.9z"/><path d="M4 26.5 6.5 18l6-4 7 2 3.2 5.6.8 4.9zM3 26.5h26"/><path class="th" d="M6.5 18l4.7 3.6 2 4.9M12.5 14l-1.3 7.6 7.1-3"/><path class="f" d="M22.5 26.5l1.9-4 3.2-.9 1.9 2.3v2.6z"/><path class="th" d="M22.5 26.5l1.9-4 3.2-.9 1.9 2.3"/>',
  bloom: `<path d="M16 28V18"/><path class="f" d="M16 22c-1.2-3.6-4.2-5.6-8-5.6 0 3.6 3.2 5.8 8 5.6zM16 20c1-3 3.6-5 7-5 0 3.2-2.8 5.2-7 5z"/><path d="M16 22c-1.2-3.6-4.2-5.6-8-5.6 0 3.6 3.2 5.8 8 5.6zM16 20c1-3 3.6-5 7-5 0 3.2-2.8 5.2-7 5z"/><path class="s" d="${sparkle(16, 8, 5)}"/><path class="s" d="${sparkle(25.5, 5.5, 2.6)}"/><path class="s" d="${sparkle(6.5, 9, 2.2)}"/>`,
  wither:
    '<path d="M16 28V12M16 17.5l-5-4.5M11 13l-1.5-4.5M11 13 7 11.5M16 15.5l5.5-5M21.5 10.5 22.5 6M21.5 10.5l4-1M16 12l-1.6-4.5M16 12l2-4"/><path class="th" d="M8 28h16"/><path class="f" d="M10 28c1.5-1.6 3.6-2.4 6-2.4s4.5.8 6 2.4z"/>',

  // --- life: creatures -----------------------------------------------------
  'spawn-human': PERSON_BUST,
  'spawn-elf':
    '<path class="f" d="M11.2 9.4 3.6 8.2l7.2 4.8zM20.8 9.4l7.6-1.2-7.2 4.8z"/><path d="M11.2 9.4 3.6 8.2l7.2 4.8M20.8 9.4l7.6-1.2-7.2 4.8"/>' +
    PERSON_BUST +
    '<path class="th" d="M11.4 7.6c2.8-1.6 6.4-1.6 9.2 0"/>',
  'spawn-dwarf':
    '<path class="f" d="M9.5 10.5a6.5 6.5 0 0 1 13 0z"/><path d="M9.5 10.5a6.5 6.5 0 0 1 13 0zM8 10.5h16M16 4v6.5"/><path class="f" d="M10 12.5c0 7 2.8 11.5 6 11.5s6-4.5 6-11.5c-1.8 1.4-3.8 2-6 2s-4.2-.6-6-2z"/><path d="M10 12.5c0 7 2.8 11.5 6 11.5s6-4.5 6-11.5c-1.8 1.4-3.8 2-6 2s-4.2-.6-6-2z"/><path d="M5 28.5c0-4.6 1.8-7.4 5-8.6M27 28.5c0-4.6-1.8-7.4-5-8.6"/><path class="th" d="M14 18c1.2.8 2.8.8 4 0"/>',
  'spawn-orc':
    '<path class="f" d="M8.5 9c0-3.4 3.2-5 7.5-5s7.5 1.6 7.5 5v5.5c0 4.6-3.2 7.8-7.5 7.8s-7.5-3.2-7.5-7.8z"/><path d="M8.5 9c0-3.4 3.2-5 7.5-5s7.5 1.6 7.5 5v5.5c0 4.6-3.2 7.8-7.5 7.8s-7.5-3.2-7.5-7.8zM8.5 10.5 5 9l3.5 4.5M23.5 10.5 27 9l-3.5 4.5"/><path class="th" d="M11 10.8l3 1.2M21 10.8l-3 1.2"/><path class="s" d="M12.4 19.2l-.7-3.6 2.2 2.8zM19.6 19.2l.7-3.6-2.2 2.8z"/><path d="M4.5 28.5c0-3.4 2.8-5.6 6-6.2M27.5 28.5c0-3.4-2.8-5.6-6-6.2"/>',
  'spawn-sheep':
    '<path class="f" d="M10.5 11.2a3.4 3.4 0 0 1 5.6-1.8 3.4 3.4 0 0 1 5.6.4 3.4 3.4 0 0 1 4.2 3.6 3.2 3.2 0 0 1 .4 5.6 3.4 3.4 0 0 1-4 3.4H13.4a3.4 3.4 0 0 1-3.6-3 3.3 3.3 0 0 1 .7-8.2z"/><path d="M10.5 11.2a3.4 3.4 0 0 1 5.6-1.8 3.4 3.4 0 0 1 5.6.4 3.4 3.4 0 0 1 4.2 3.6 3.2 3.2 0 0 1 .4 5.6 3.4 3.4 0 0 1-4 3.4H13.4a3.4 3.4 0 0 1-3.6-3 3.3 3.3 0 0 1 .7-8.2z"/><path d="M14 22.4V28M22 22.4V28"/><ellipse class="s" cx="7.4" cy="14.2" rx="3.6" ry="2.7" transform="rotate(-20 7.4 14.2)"/><path class="th" d="M9 11.8 6.8 10"/>',
  'spawn-wolf':
    '<path class="f" d="M6 4.5 11 12l5-1.8 5 1.8 5-7.5.2 11.2-4.4 7.4L16 28l-5.8-4.9-4.4-7.4z"/><path d="M6 4.5 11 12l5-1.8 5 1.8 5-7.5.2 11.2-4.4 7.4L16 28l-5.8-4.9-4.4-7.4z"/><path class="th" d="M10.2 15.4l3 1.4M21.8 15.4l-3 1.4M16 18.5v5.5"/><path class="s" d="M13.8 22.6h4.4L16 25.2z"/>',
  'spawn-deer':
    '<path class="f" d="M12 13.4c0-2 1.8-3.2 4-3.2s4 1.2 4 3.2l-.9 9.4c-.4 2.6-1.6 4.4-3.1 4.4s-2.7-1.8-3.1-4.4z"/><path d="M12 13.4c0-2 1.8-3.2 4-3.2s4 1.2 4 3.2l-.9 9.4c-.4 2.6-1.6 4.4-3.1 4.4s-2.7-1.8-3.1-4.4zM12.2 14 7 12.6c1 2.6 2.8 3.8 5 3.6M19.8 14l5.2-1.4c-1 2.6-2.8 3.8-5 3.6"/><path d="M13.6 10.6c-1.4-2.2-2-4.6-1.4-7.6M12.6 7 9 4.6M12.4 4.6l-1.6-2M18.4 10.6c1.4-2.2 2-4.6 1.4-7.6M19.4 7 23 4.6M19.6 4.6l1.6-2"/><circle class="s" cx="16" cy="25.4" r="1.4"/>',
  'spawn-chicken':
    '<path class="f" d="M9 15.5c0-3.4 2-5.6 4.6-6.2l.3-2.6a3.6 3.6 0 0 1 7.1.4l.2 2.4c2.6 1.2 4.3 4.2 4.3 8 0 5-3.6 8.5-8.5 8.5-4.6 0-8-3.4-8-8.5z"/><path d="M9 15.5c0-3.4 2-5.6 4.6-6.2l.3-2.6a3.6 3.6 0 0 1 7.1.4l.2 2.4c2.6 1.2 4.3 4.2 4.3 8 0 5-3.6 8.5-8.5 8.5-4.6 0-8-3.4-8-8.5z"/><path class="ts" d="M14.6 4.6c.2-1.6 1.6-2.4 2.4-1.4.8-1 2.4-.4 2.4 1.2z"/><path class="s" d="M21.2 8.2 24.6 9l-3.4 1.4z"/><circle class="s" cx="18.4" cy="7.6" r=".9"/><path class="th" d="M9.5 13.5C6.6 13 4.6 10.8 4.4 8c2.8.6 4.4 1.6 5.6 3.2M12 17.5c2.2 2.4 5 3 8 1.6"/><path d="M14 24.5v3.5M19 24.5v3.5M12.6 28h3M17.6 28h3"/>',
  'spawn-rabbit':
    '<path class="f" d="M12.8 13.6c-1.8-3.6-2-7.4-.8-10.4 2.4.8 3.8 4.6 3.4 9.8zM19.2 13.6c1.8-3.6 2-7.4.8-10.4-2.4.8-3.8 4.6-3.4 9.8z"/><path d="M12.8 13.6c-1.8-3.6-2-7.4-.8-10.4 2.4.8 3.8 4.6 3.4 9.8M19.2 13.6c1.8-3.6 2-7.4.8-10.4-2.4.8-3.8 4.6-3.4 9.8"/><circle class="f" cx="16" cy="20" r="7.5"/><circle cx="16" cy="20" r="7.5"/><circle class="s" cx="12.8" cy="18.6" r="1.2"/><circle class="s" cx="19.2" cy="18.6" r="1.2"/><path class="th" d="M16 21.6v1.8M14.2 24.2c1.1.8 2.5.8 3.6 0"/><path class="s" d="M14.8 20.8h2.4L16 22.2z"/>',
  'spawn-fish':
    '<path class="f" d="M8 16c3.4-4.8 7.8-7 12.2-7S27 12 29 16c-2 4-4.4 7-8.8 7S11.4 20.8 8 16z"/><path d="M8 16c3.4-4.8 7.8-7 12.2-7S27 12 29 16c-2 4-4.4 7-8.8 7S11.4 20.8 8 16zM8 16 3 10.5v11z"/><circle class="s" cx="23.4" cy="14.6" r="1.4"/><path class="th" d="M18.4 11.8c1.2 2.6 1.2 5.8 0 8.4"/>',
  'spawn-bird':
    '<path class="f" d="M2.5 11.5c4.6-1.2 9.2.6 13.5 5.5 4.3-4.9 8.9-6.7 13.5-5.5-4.2.8-7.6 3.4-9.6 7.6-.9 2-2.2 3.4-3.9 3.4s-3-1.4-3.9-3.4c-2-4.2-5.4-6.8-9.6-7.6z"/><path d="M2.5 11.5c4.6-1.2 9.2.6 13.5 5.5 4.3-4.9 8.9-6.7 13.5-5.5-4.2.8-7.6 3.4-9.6 7.6-.9 2-2.2 3.4-3.9 3.4s-3-1.4-3.9-3.4c-2-4.2-5.4-6.8-9.6-7.6z"/><path d="M14.4 22.4 16 26.5l1.6-4.1"/>',
  'spawn-bear':
    '<circle class="f" cx="8.6" cy="8.6" r="3.6"/><circle cx="8.6" cy="8.6" r="3.6"/><circle class="f" cx="23.4" cy="8.6" r="3.6"/><circle cx="23.4" cy="8.6" r="3.6"/><circle class="f" cx="16" cy="17" r="10"/><circle cx="16" cy="17" r="10"/><ellipse cx="16" cy="21.4" rx="4.6" ry="3.6"/><path class="s" d="M14 19.6h4L16 22z"/><circle class="s" cx="11.8" cy="14.8" r="1.3"/><circle class="s" cx="20.2" cy="14.8" r="1.3"/>',
  'spawn-cow':
    '<path class="f" d="M10 9h12l-1 12.4c-.3 3.6-2.3 6.1-5 6.1s-4.7-2.5-5-6.1z"/><path d="M10 9h12l-1 12.4c-.3 3.6-2.3 6.1-5 6.1s-4.7-2.5-5-6.1zM10 9C7 9 5 7 5 4M22 9c3 0 5-2 5-5M10.2 11.6 5.4 13c1.4 1.6 3 2.1 4.8 1.8M21.8 11.6l4.8 1.4c-1.4 1.6-3 2.1-4.8 1.8"/><rect class="s" x="10.8" y="19.4" width="10.4" height="7.4" rx="3.7" opacity=".9"/><circle cx="13.8" cy="23" r=".9" style="stroke:var(--ws-ico-bg,#151926)"/><circle cx="18.2" cy="23" r=".9" style="stroke:var(--ws-ico-bg,#151926)"/><circle class="s" cx="12.8" cy="14" r="1.2"/><circle class="s" cx="19.2" cy="14" r="1.2"/>',
  'spawn-pig':
    '<path class="f" d="M8.6 9.6 6.4 4.4l6 3.2zM23.4 9.6l2.2-5.2-6 3.2z"/><path d="M8.6 9.6 6.4 4.4l6 3.2M23.4 9.6l2.2-5.2-6 3.2"/><circle class="f" cx="16" cy="17" r="10"/><circle cx="16" cy="17" r="10"/><ellipse cx="16" cy="20.4" rx="5" ry="3.6"/><circle class="s" cx="14.2" cy="20.4" r="1.1"/><circle class="s" cx="17.8" cy="20.4" r="1.1"/><circle class="s" cx="11.4" cy="14" r="1.3"/><circle class="s" cx="20.6" cy="14" r="1.3"/>',
  'spawn-horse':
    '<path class="f" d="M8.5 28.5c0-7 0-14 3-19l1-5.2 2.6 3.6c3.1.5 5.6 2.1 7.6 4.6l5 5.6c1 1.2.6 3-1 3.4l-2.5.6c-1.2.3-2.4-.1-3.2-1L18.5 18c-.5 3 0 7 1.5 10.5z"/><path d="M8.5 28.5c0-7 0-14 3-19l1-5.2 2.6 3.6c3.1.5 5.6 2.1 7.6 4.6l5 5.6c1 1.2.6 3-1 3.4l-2.5.6c-1.2.3-2.4-.1-3.2-1L18.5 18c-.5 3 0 7 1.5 10.5"/><path class="th" d="M11.3 9.4c-2.2 2.4-3.4 5.6-3.6 9.4M12.6 7.6C10 9.4 8 11.8 6.4 15"/><circle class="s" cx="16.6" cy="11" r="1.2"/>',
  'spawn-fox':
    '<path class="f" d="M4.5 4.5 11 10h10l6.5-5.5-.8 9.8L16 27.5 5.3 14.3z"/><path d="M4.5 4.5 11 10h10l6.5-5.5-.8 9.8L16 27.5 5.3 14.3z"/><path class="th" d="M7.6 15.6c3.4-.2 6 1.6 8.4 5.6 2.4-4 5-5.8 8.4-5.6"/><circle class="s" cx="11.8" cy="14.4" r="1.2"/><circle class="s" cx="20.2" cy="14.4" r="1.2"/><circle class="s" cx="16" cy="25.2" r="1.4"/>',
  'spawn-cat':
    '<path class="f" d="M7 4.5l5 5h8l5-5v12c0 6-4 10-9 10s-9-4-9-10z"/><path d="M7 4.5l5 5h8l5-5v12c0 6-4 10-9 10s-9-4-9-10z"/><path class="th" d="M3 18.5l6 .8M3.4 22.4l5.8-1.4M29 18.5l-6 .8M28.6 22.4l-5.8-1.4"/><ellipse class="s" cx="12.4" cy="15" rx="1.2" ry="1.8"/><ellipse class="s" cx="19.6" cy="15" rx="1.2" ry="1.8"/><path class="s" d="M14.6 19.4h2.8L16 21z"/>',
  'spawn-dog':
    '<path class="f" d="M9.6 8.2C6 6.6 3.6 9 4 13c.3 3.4 2 6 4.6 6.4zM22.4 8.2c3.6-1.6 6 .8 5.6 4.8-.3 3.4-2 6-4.6 6.4z"/><path d="M9.6 8.2C6 6.6 3.6 9 4 13c.3 3.4 2 6 4.6 6.4M22.4 8.2c3.6-1.6 6 .8 5.6 4.8-.3 3.4-2 6-4.6 6.4"/><path class="f" d="M9 12c0-4.2 3-6.5 7-6.5s7 2.3 7 6.5v6c0 5-3.2 8.5-7 8.5s-7-3.5-7-8.5z"/><path d="M9 12c0-4.2 3-6.5 7-6.5s7 2.3 7 6.5v6c0 5-3.2 8.5-7 8.5s-7-3.5-7-8.5z"/><ellipse class="s" cx="16" cy="20.6" rx="2.4" ry="1.7"/><circle class="s" cx="12.6" cy="14" r="1.2"/><circle class="s" cx="19.4" cy="14" r="1.2"/>',
  'spawn-goat':
    '<path d="M12.4 9C10.6 5 7 3.6 4.6 5.4c2.6.2 4.4 1.8 5 4.8M19.6 9c1.8-4 5.4-5.4 7.8-3.6-2.6.2-4.4 1.8-5 4.8"/><path class="f" d="M11 10h10l-1.4 11c-.4 3-1.8 4.6-3.6 4.6s-3.2-1.6-3.6-4.6z"/><path d="M11 10h10l-1.4 11c-.4 3-1.8 4.6-3.6 4.6s-3.2-1.6-3.6-4.6zM11.2 12.4 6.4 14c1.6 1.4 3.2 1.6 5 1.2M20.8 12.4l4.8 1.6c-1.6 1.4-3.2 1.6-5 1.2"/><path class="ts" d="M14.6 25.4l1.4 4 1.4-4z"/><circle class="s" cx="13.6" cy="15" r="1.1"/><circle class="s" cx="18.4" cy="15" r="1.1"/>',
  'spawn-dragon':
    '<path class="f" d="M13.4 12.6C10.6 8.8 7 6.2 2.6 5.4c.6 3.4 1.4 6.8 3.6 9.6 1-1 2.4-1.2 3.6-.4.6-1.2 2.2-1.6 3.6-.6zM18.6 12.6c2.8-3.8 6.4-6.4 10.8-7.2-.6 3.4-1.4 6.8-3.6 9.6-1-1-2.4-1.2-3.6-.4-.6-1.2-2.2-1.6-3.6-.6z"/><path d="M13.4 12.6C10.6 8.8 7 6.2 2.6 5.4c.6 3.4 1.4 6.8 3.6 9.6 1-1 2.4-1.2 3.6-.4.6-1.2 2.2-1.6 3.6-.6M18.6 12.6c2.8-3.8 6.4-6.4 10.8-7.2-.6 3.4-1.4 6.8-3.6 9.6-1-1-2.4-1.2-3.6-.4-.6-1.2-2.2-1.6-3.6-.6"/>' +
    '<path class="f" d="M16 8.6c2 0 3.2 2 3.2 5.6 0 3.4-1.2 6.6-3.2 8.4-2-1.8-3.2-5-3.2-8.4 0-3.6 1.2-5.6 3.2-5.6z"/><path d="M16 8.6c2 0 3.2 2 3.2 5.6 0 3.4-1.2 6.6-3.2 8.4-2-1.8-3.2-5-3.2-8.4 0-3.6 1.2-5.6 3.2-5.6zM16 22.6c0 3 1.6 5 5 5.6l-1.4-2.4M14.6 9.2l-1.6-4M17.4 9.2l1.6-4"/>',
  'spawn-crab':
    '<ellipse class="f" cx="16" cy="19" rx="8" ry="5.6"/><ellipse cx="16" cy="19" rx="8" ry="5.6"/><path d="M8.6 17 5.4 13.4M23.4 17l3.2-3.6M9 22.4l-4.4 3M23 22.4l4.4 3M10.4 24.2l-2.8 3.4M21.6 24.2l2.8 3.4"/><path class="f" d="M5.4 13.4c-2.8-.6-3.6-4.2-1.6-6.4 0 2 1.2 3 2.8 3.2.4-1.4 1.6-2.4 3-2.6-.4 3.4-1.8 5.4-4.2 5.8zM26.6 13.4c2.8-.6 3.6-4.2 1.6-6.4 0 2-1.2 3-2.8 3.2-.4-1.4-1.6-2.4-3-2.6.4 3.4 1.8 5.4 4.2 5.8z"/><path class="th" d="M5.4 13.4c-2.8-.6-3.6-4.2-1.6-6.4 0 2 1.2 3 2.8 3.2.4-1.4 1.6-2.4 3-2.6-.4 3.4-1.8 5.4-4.2 5.8zM26.6 13.4c2.8-.6 3.6-4.2 1.6-6.4 0 2-1.2 3-2.8 3.2-.4-1.4-1.6-2.4-3-2.6.4 3.4 1.8 5.4 4.2 5.8z"/><circle class="s" cx="13.4" cy="15.4" r="1.1"/><circle class="s" cx="18.6" cy="15.4" r="1.1"/>',
  'spawn-bee':
    '<ellipse class="f" cx="11" cy="10" rx="5" ry="3.4" transform="rotate(-30 11 10)"/><ellipse class="th" cx="11" cy="10" rx="5" ry="3.4" transform="rotate(-30 11 10)"/><ellipse class="f" cx="21" cy="10" rx="5" ry="3.4" transform="rotate(30 21 10)"/><ellipse class="th" cx="21" cy="10" rx="5" ry="3.4" transform="rotate(30 21 10)"/><ellipse class="ts" cx="16" cy="19.5" rx="6" ry="7.5" opacity=".55"/><ellipse cx="16" cy="19.5" rx="6" ry="7.5"/><path d="M10.4 17h11.2M10.2 21.4h11.6M16 27v2.4"/>',
  'spawn-skeleton': SKULL,
  'spawn-snake':
    '<path class="f" d="M24 7.5c2.6 0 4 1.6 4 3.4s-1.6 3.1-4 3.1h-3"/><path d="M21 7.5h3c2.6 0 4 1.6 4 3.4s-1.6 3.1-4 3.1H10a4 4 0 0 0 0 8h12a3 3 0 0 1 0 6H6"/><circle class="s" cx="24.6" cy="10.4" r="1.1"/><path class="t" d="M21 9.2l-3 1.2 3 1.2"/>',

  // --- life: miracles & curses ---------------------------------------------
  bless:
    '<ellipse class="t" cx="16" cy="5" rx="6.2" ry="2.2"/>' +
    PERSON_BUST.replace('cy="10.5"', 'cy="12"').replace('cy="10.5"', 'cy="12"').replace(/c0-5 4.5-8.5/g, 'c0-4.4 4.5-7.6').replace(/M6 28v-1.5/g, 'M6 28.5v-1') +
    `<path class="s" d="${sparkle(26, 9, 3.2)}"/><path class="s" d="${sparkle(5.6, 13, 2.4)}"/>`,
  heal: '<path class="f" d="M16 27.5S4 20.6 4 12.4A6.4 6.4 0 0 1 16 9.2a6.4 6.4 0 0 1 12 3.2c0 8.2-12 15.1-12 15.1z"/><path d="M16 27.5S4 20.6 4 12.4A6.4 6.4 0 0 1 16 9.2a6.4 6.4 0 0 1 12 3.2c0 8.2-12 15.1-12 15.1z"/><path d="M16 12.6v8M12 16.6h8"/>',
  madness:
    '<path class="f" d="M10.5 28.5v-4c-3-2-4.5-5.4-4.5-9.4C6 9 10.6 4.5 16.6 4.5S26.5 8.6 26.5 14c0 1.6.9 3 2 4.6l-2.1 1v3.2c0 1.6-1.2 2.7-2.8 2.7H21v3"/><path d="M10.5 28.5v-4c-3-2-4.5-5.4-4.5-9.4C6 9 10.6 4.5 16.6 4.5S26.5 8.6 26.5 14c0 1.6.9 3 2 4.6l-2.1 1v3.2c0 1.6-1.2 2.7-2.8 2.7H21v3"/>' +
    `<path class="th" d="${spiral(15.6, 14.2, 2.6, 6.4)}"/>`,
  smite:
    '<circle cx="16" cy="3.6" r="1.6"/><path d="M16 5.2v2.8M10.8 8.4h10.4"/><path class="f" d="M14 8.4 16 23.5l2-15.1z"/><path d="M14 8.4 16 23.5l2-15.1"/><path d="M9.5 26.5 6.5 28.5M22.5 26.5l3 2M16 26v3M11.4 24.4 8 23.6M20.6 24.4l3.4-.8"/>',
  curse:
    '<path class="f" d="M3 15.5C6.4 10 10.8 7.5 16 7.5S25.6 10 29 15.5c-3.4 5.5-7.8 8-13 8S6.4 21 3 15.5z"/><path d="M3 15.5C6.4 10 10.8 7.5 16 7.5S25.6 10 29 15.5c-3.4 5.5-7.8 8-13 8S6.4 21 3 15.5z"/><ellipse class="s" cx="16" cy="15.5" rx="2" ry="5"/><path d="M10.5 22.4v3.4M16 23.5v5M21.5 22.4v3.4"/>',
  plague: GERM,
  fertility:
    '<path class="f" d="M12 25S3 19.8 3 13.6a4.8 4.8 0 0 1 9-2.4 4.8 4.8 0 0 1 9 2.4C21 19.8 12 25 12 25z"/><path d="M12 25S3 19.8 3 13.6a4.8 4.8 0 0 1 9-2.4 4.8 4.8 0 0 1 9 2.4C21 19.8 12 25 12 25z"/><path class="ts" d="M22 18.4s-5-2.9-5-6.4a2.7 2.7 0 0 1 5-1.3 2.7 2.7 0 0 1 5 1.3c0 3.5-5 6.4-5 6.4z" transform="translate(1.4 -4.6)"/><path class="th" d="M22 18.4s-5-2.9-5-6.4a2.7 2.7 0 0 1 5-1.3 2.7 2.7 0 0 1 5 1.3c0 3.5-5 6.4-5 6.4z" transform="translate(1.4 -4.6)"/>',
  kill: SKULL,
  grow: '<path d="M6 26 26 6M26 6h-7.5M26 6v7.5M6 26h7.5M6 26v-7.5"/>',

  // --- civilisation --------------------------------------------------------
  'found-village':
    HOUSE(12, 18.5, 1.05) + '<path d="M23.5 27.5V5"/><path class="ts" d="M23.5 5h5.5l-1.8 2.6 1.8 2.6h-5.5z"/><path d="M23.5 5h5.5l-1.8 2.6 1.8 2.6h-5.5M3 27.5h26"/>',
  'found-kingdom': CATEGORY_ICONS.civ,
  'declare-war': SWORD(false) + SWORD(true),
  'make-peace': (() => {
    const leaf = (x, y, a) => g(`translate(${x} ${y}) rotate(${a})`, '<path class="f" d="M0 0c1.6-2.6 4.6-3.6 7.4-2.8C6 0 3 1.2 0 0z"/><path class="th" d="M0 0c1.6-2.6 4.6-3.6 7.4-2.8C6 0 3 1.2 0 0z"/>');
    return '<path d="M5 28C10 22 15 15.5 26.5 4.5"/>' + leaf(9.4, 22.6, -100) + leaf(9.6, 22.6, 10) + leaf(14.2, 17, -95) + leaf(14.4, 17, 5) + leaf(19.4, 11.6, -90) + leaf(19.6, 11.6, 0) + leaf(24.4, 6.8, -60) +
      '<ellipse class="ts" cx="7.4" cy="18.6" rx="1.7" ry="2.1" transform="rotate(-30 7.4 18.6)"/><ellipse class="ts" cx="23.6" cy="15.2" rx="1.7" ry="2.1" transform="rotate(-30 23.6 15.2)"/>';
  })(),
  alliance: '<circle class="f" cx="11.5" cy="16" r="7.5"/><circle cx="11.5" cy="16" r="7.5"/><circle class="f" cx="20.5" cy="16" r="7.5"/><circle cx="20.5" cy="16" r="7.5"/>',
  rebellion:
    '<path d="M16 15.5v13"/><path class="f" d="M12 15.5h8l-1.2 3.4h-5.6z"/><path d="M12 15.5h8l-1.2 3.4h-5.6z"/><path class="f" d="M16 3c.8 3.4 4.8 4.8 4.8 8.6a4.8 4.8 0 0 1-9.6 0c0-2.2 1.2-3.6 2.2-4.4.3 1.4 1 2.2 2 2.4-.4-2.4-.2-4.6.6-6.6z"/><path d="M16 3c.8 3.4 4.8 4.8 4.8 8.6a4.8 4.8 0 0 1-9.6 0c0-2.2 1.2-3.6 2.2-4.4.3 1.4 1 2.2 2 2.4-.4-2.4-.2-4.6.6-6.6z"/>',
  crown:
    '<path class="f" d="M5.5 23.5 3.6 10.6l6.8 5.2L16 7l5.6 8.8 6.8-5.2-1.9 12.9z"/><path d="M5.5 23.5 3.6 10.6l6.8 5.2L16 7l5.6 8.8 6.8-5.2-1.9 12.9zM6 27.5h20"/><circle class="s" cx="16" cy="19" r="1.7"/><circle class="s" cx="3.6" cy="10.6" r="1.4"/><circle class="s" cx="16" cy="7" r="1.4"/><circle class="s" cx="28.4" cy="10.6" r="1.4"/>',
  raze:
    HOUSE(12, 19, 1.05) +
    '<path class="f" d="M23 6c.6 2.6 3.6 3.6 3.6 6.6a3.6 3.6 0 0 1-7.2 0c0-1.6.9-2.7 1.6-3.3.3 1 .8 1.6 1.6 1.8-.3-1.8-.2-3.5.4-5.1z"/><path d="M23 6c.6 2.6 3.6 3.6 3.6 6.6a3.6 3.6 0 0 1-7.2 0c0-1.6.9-2.7 1.6-3.3.3 1 .8 1.6 1.6 1.8-.3-1.8-.2-3.5.4-5.1zM3 28h26"/>',
  road: '<path class="f" d="M12 4h8l7 24H5z"/><path d="M12 4 5 28M20 4l7 24"/><path d="M16 6v3M16 13v4M16 21v5"/>',
  farmland: '<path class="f" d="M2.5 27.5 7 14h18l4.5 13.5z"/><path d="M2.5 27.5 7 14h18l4.5 13.5z"/><path class="th" d="M11 14 9.5 27.5M16 14v13.5M21 14l1.5 13.5"/>' + WHEAT(16, 7, 0.45),
  gold: '<ellipse class="f" cx="16" cy="9" rx="9" ry="3.5"/><ellipse cx="16" cy="9" rx="9" ry="3.5"/><path d="M7 9v5c0 1.9 4 3.5 9 3.5s9-1.6 9-3.5V9M7 14v5c0 1.9 4 3.5 9 3.5s9-1.6 9-3.5v-5M7 19v4.5c0 1.9 4 3.5 9 3.5s9-1.6 9-3.5V19"/>',
  build:
    '<path class="f" d="M5 10.5 14.5 4l3.5 3.5-2.6 2.6L19 13.6l-2.8 2.8-3.5-3.5-2.6 2.6z"/><path d="M5 10.5 14.5 4l3.5 3.5-2.6 2.6L19 13.6l-2.8 2.8-3.5-3.5-2.6 2.6zM17.6 15l9.6 9.6a2.1 2.1 0 0 1-3 3L14.6 18"/>',
  trade:
    '<path d="M16 4v23M10 27.5h12M6 8.5h20M16 5.5V8.5"/><path class="f" d="M2.5 18.5 6 9l3.5 9.5a3.5 3.5 0 0 1-7 0zM22.5 18.5 26 9l3.5 9.5a3.5 3.5 0 0 1-7 0z"/><path d="M2.5 18.5 6 9l3.5 9.5a3.5 3.5 0 0 1-7 0zM22.5 18.5 26 9l3.5 9.5a3.5 3.5 0 0 1-7 0z"/>',
  banner:
    '<path d="M8 28.5V3.5"/><path class="f" d="M8 5h16v14l-8-3.6L8 19z"/><path d="M8 5h16v14l-8-3.6L8 19"/><path class="s" d="M16 8.4l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z"/>',
  migrate:
    '<path class="f" d="M9 4.5c2.2 0 3.4 2.6 3.2 6l-.4 4H7.6l-.6-4C6.6 7 7 4.5 9 4.5zM23 12.5c2.2 0 3.4 2.6 3.2 6l-.4 4h-4.2l-.6-4c-.4-3.4 0-6 2-6z"/><path d="M9 4.5c2.2 0 3.4 2.6 3.2 6l-.4 4H7.6l-.6-4C6.6 7 7 4.5 9 4.5zM23 12.5c2.2 0 3.4 2.6 3.2 6l-.4 4h-4.2l-.6-4c-.4-3.4 0-6 2-6z"/><rect class="s" x="7.4" y="16.4" width="4.6" height="3.6" rx="1.8"/><rect class="s" x="21.4" y="24.4" width="4.6" height="3.6" rx="1.8"/>',

  // --- disasters -----------------------------------------------------------
  fire: '<path class="f" d="M16 3c1 5 7.6 7.4 7.6 15a7.6 7.6 0 0 1-15.2 0c0-4.2 2-6.8 3.6-8.2.5 2.6 1.5 4 3 4.6C14 10 15 6.2 16 3z"/><path d="M16 3c1 5 7.6 7.4 7.6 15a7.6 7.6 0 0 1-15.2 0c0-4.2 2-6.8 3.6-8.2.5 2.6 1.5 4 3 4.6C14 10 15 6.2 16 3z"/><path class="s" d="M16 27.4a3.4 3.4 0 0 1-3.4-3.4c0-2.8 3.4-5 3.4-7.6 1.1 2.2 3.4 4.4 3.4 7.6a3.4 3.4 0 0 1-3.4 3.4z" opacity=".9"/>',
  meteor:
    '<circle class="f" cx="11" cy="21" r="6.5"/><circle cx="11" cy="21" r="6.5"/><circle class="s" cx="9" cy="19.6" r="1.5"/><circle class="s" cx="13.2" cy="23.4" r="1.1"/><path d="M15.8 16.2 27 5M17.6 20.2 28.5 11.5M11.6 14.6 20.5 4"/><path class="th" d="M22.6 15.6l3.6-2.6M15.2 9.6l2.4-3"/>',
  lightning: cloud(-3.5) + `<path class="ts" d="${BOLT}"/><path d="${BOLT}"/>`,
  earthquake:
    '<path d="M2.5 9h5l2-4.5 3 9 3-7 2.2 4.5 1.8-2H29.5"/><path class="f" d="M3 18h12.5l-2.4 4.2 2.6 2.8-1.8 4H5a2 2 0 0 1-2-2zM29 19.6H17.8l2.6 3.2-1.8 2.4 1.4 3.8H27a2 2 0 0 0 2-2z"/><path d="M3 18h12.5l-2.4 4.2 2.6 2.8-1.8 4M29 19.6H17.8l2.6 3.2-1.8 2.4 1.4 3.8"/>',
  tornado:
    '<path d="M4 5.5h24M6.5 10.5h18.5M10 15.5H23M12.5 20.5h7.5M14.5 25h3.6"/><path class="t" d="M16.3 25c-.2 1.6.4 2.8 1.8 3.6"/>',
  volcano:
    '<path class="f" d="M2.5 28.5 10.5 15h11l8 13.5z"/><path d="M2.5 28.5 10.5 15h11l8 13.5zM10.5 15c1.6 1.2 3.4 1.8 5.5 1.8s3.9-.6 5.5-1.8"/><path class="ts" d="M14.2 16.6 13 21.5l1.8 1.6-1.4 3.4 3.4-4-1.6-1.6 1.4-4.2z"/><path d="M13 10.8a3.2 3.2 0 0 1 1-6.1 3.8 3.8 0 0 1 6.2.8 2.8 2.8 0 0 1 .4 5.3"/><circle class="s" cx="7.6" cy="9.6" r="1.4"/><circle class="s" cx="25.2" cy="8" r="1.2"/>',
  flood: `<path class="f" d="M3 26.5C3 16.6 9 7.5 18 7.5c5 0 9 3 9 7 0 3-2.5 4.5-4.5 4.5-2.5 0-3.5-2-2-4-4 0-6.5 4-6.5 8 0 1.6.4 2.6 1 3.5z"/><path d="M3 26.5C3 16.6 9 7.5 18 7.5c5 0 9 3 9 7 0 3-2.5 4.5-4.5 4.5-2.5 0-3.5-2-2-4-4 0-6.5 4-6.5 8 0 1.6.4 2.6 1 3.5"/><path d="${wave(27, 3, 29, 4, 1.5)}"/>`,
  'acid-rain': cloud(-4) + '<path class="t" d="M11 21.5 9.5 25M16.5 21.5 15 25M22 21.5 20.5 25"/><circle class="ts" cx="12.6" cy="27.8" r="1.3"/><circle class="ts" cx="18.4" cy="27.8" r="1.3"/>',
  blizzard: cloud(-4) + '<path d="M3 23.5h8M6 27.5h9"/>' + g('translate(0 0)', SNOWFLAKE(22, 24.5, 4.2)),
  drought:
    SUN(16, 9.5, 4, 6.6, 9) +
    '<path class="f" d="M3 21h26v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 21h26"/><path class="th" d="M9 21l1.6 3-2 2.2.6 2.8M18 21l-1.6 2.6 2.4 1.6-.8 3.8M24 21.5l1 2.6"/>',
  bomb: '<circle class="f" cx="14" cy="19" r="9"/><circle cx="14" cy="19" r="9"/><path d="M19.6 11.8l2.4-2.4M21 8.4l1.6 1.6"/><path d="M22.4 8.6c1-2.6 3-3.6 5-3"/><path class="ts" d="' + sparkle(27.5, 5.5, 3) + '"/><path class="th" d="M9.4 16a5.6 5.6 0 0 1 3.8-3.6"/>',
  explosion: `<path class="f" d="${star(16, 16, 13, 6.2, 9)}"/><path d="${star(16, 16, 13, 6.2, 9)}"/><path class="s" d="${star(16, 16, 5.6, 2.8, 6)}"/>`,
  lava: '<path class="f" d="M3 23c3-2 5.2-2 7 0s4.4 2 6.6 0 4.6-2 6.4 0 4 2 6 0v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 23c3-2 5.2-2 7 0s4.4 2 6.6 0 4.6-2 6.4 0 4 2 6 0"/><path class="ts" d="M16 4c2.8 4 4.6 7 4.6 9.4a4.6 4.6 0 0 1-9.2 0C11.4 11 13.2 8 16 4z" opacity=".6"/><path d="M16 4c2.8 4 4.6 7 4.6 9.4a4.6 4.6 0 0 1-9.2 0C11.4 11 13.2 8 16 4z"/><circle class="s" cx="24.5" cy="10" r="1.3"/><circle class="s" cx="7.4" cy="13" r="1.1"/>',
  sinkhole:
    '<ellipse class="f" cx="16" cy="18.5" rx="12.5" ry="6"/><ellipse cx="16" cy="18.5" rx="12.5" ry="6"/><path class="s" d="M8.5 18.5c1.6-2 4.4-3 7.5-3s5.9 1 7.5 3c-1.6 2-4.4 3-7.5 3s-5.9-1-7.5-3z" opacity=".85"/><path class="th" d="M5 12.5l2 2.4M27 12.5l-2 2.4M16 8.5v3"/>',
  firestorm:
    cloud(-4) +
    '<path class="f" d="M16 18c.6 2.6 4 3.8 4 7.2a4 4 0 0 1-8 0c0-2 1-3.4 1.8-4 .3 1.2.8 2 1.6 2.2-.3-2-.1-3.8.6-5.4z"/><path d="M16 18c.6 2.6 4 3.8 4 7.2a4 4 0 0 1-8 0c0-2 1-3.4 1.8-4 .3 1.2.8 2 1.6 2.2-.3-2-.1-3.8.6-5.4z"/>',

  // --- world ---------------------------------------------------------------
  inspect:
    '<circle class="f" cx="13.5" cy="13.5" r="8.5"/><circle cx="13.5" cy="13.5" r="8.5"/><path d="M20 20l7.5 7.5" style="stroke-width:3.2"/><path class="th" d="M9 12a4.8 4.8 0 0 1 4.2-3.6"/>',
  'weather-rain': cloud(-4) + DROPS(),
  'weather-storm': cloud(-4.5) + `<path class="ts" d="${BOLT}" transform="translate(0 -1)"/><path d="${BOLT}" transform="translate(0 -1)"/><path class="th" d="M9.4 20.5 8 24M24.4 20.5 23 24"/>`,
  'weather-snow': cloud(-4) + '<path d="M11 22v4.6M8.8 23.2l4.4 2.4M13.2 23.2l-4.4 2.4M21 22v4.6M18.8 23.2l4.4 2.4M23.2 23.2l-4.4 2.4"/>',
  'weather-clear': SUN(),
  'weather-fog': '<path d="M4 10.5h17M8 15.5h20M4 20.5h20M10 25.5h14"/><path class="th" d="M23.5 10.5h4.5M4 15.5h1.5M26.5 20.5H28"/>',
  'weather-wind': '<path d="M3 11h17.5a3.5 3.5 0 1 0-3.5-3.5M3 16h23.5a3.5 3.5 0 1 1-3.5 3.5M3 21h11a3 3 0 1 1-3 3"/>',
  'weather-cloudy':
    g('translate(-4 -6) scale(.8)', `<path class="f" d="${CLOUD}"/><path d="${CLOUD}"/>`) + g('translate(5 4)', `<path class="f" d="${CLOUD}"/><path d="${CLOUD}"/>`),
  day: SUN(),
  night: `<path class="f" d="${MOON}"/><path d="${MOON}"/><path class="s" d="${sparkle(24, 7, 2.6)}"/><path class="s" d="${sparkle(27.2, 14, 1.6)}"/>`,
  eclipse: '<circle class="f" cx="16" cy="16" r="9"/><circle cx="16" cy="16" r="9"/><circle class="s" cx="19" cy="13.5" r="7.6"/>' + `<path class="th" d="${rays(16, 16, 11.4, 13.6, 12, 15)}"/>`,
  aurora: '<path class="f" d="M3 22c4-10 8-14 13-12s7 0 13-6v10c-6 6-8 8-13 6s-9 0-13 8z"/><path d="M3 22c4-10 8-14 13-12s7 0 13-6M3 28c4-6 8-8 13-6s7 0 13-6"/><path class="th" d="M9 15v8M15 11v10M21 9.5v9"/>',
  erase:
    '<path class="f" d="M4.6 20.4 16.4 8.6a2 2 0 0 1 2.8 0l5.4 5.4a2 2 0 0 1 0 2.8L13.8 27.6H9.2l-4.6-4.4a2 2 0 0 1 0-2.8z"/><path d="M4.6 20.4 16.4 8.6a2 2 0 0 1 2.8 0l5.4 5.4a2 2 0 0 1 0 2.8L13.8 27.6H9.2l-4.6-4.4a2 2 0 0 1 0-2.8zM10.4 14.6l8.2 8.2M13.8 27.6H28"/>',
  'time-skip': '<circle class="f" cx="16" cy="16" r="11.5"/><circle cx="16" cy="16" r="11.5"/><path d="M16 9v7l4.6 3"/><path class="s" d="M27.5 5.5v6h-6z"/>',
  // --- added for the integrated power set ---------------------------------
  inferno: (() => {
    const side = '<path class="f" d="M8.2 11.5c.6 2.9 3.8 4.4 3.8 8.3a3.8 3.8 0 0 1-7.6 0c0-2.1 1-3.4 1.8-4 .2 1.3.7 2 1.5 2.2-.2-2.3 0-4.5.5-6.5z"/><path d="M8.2 11.5c.6 2.9 3.8 4.4 3.8 8.3a3.8 3.8 0 0 1-7.6 0c0-2.1 1-3.4 1.8-4 .2 1.3.7 2 1.5 2.2-.2-2.3 0-4.5.5-6.5z"/>';
    return side + g('translate(32 0) scale(-1 1)', side) +
      '<path class="f" d="M16 2.5c1.1 4.8 6.8 7.2 6.8 14.6a6.8 6.8 0 0 1-13.6 0c0-3.8 1.8-6.1 3.2-7.4.4 2.3 1.4 3.6 2.7 4.1C14.2 9.4 15 5.7 16 2.5z"/><path d="M16 2.5c1.1 4.8 6.8 7.2 6.8 14.6a6.8 6.8 0 0 1-13.6 0c0-3.8 1.8-6.1 3.2-7.4.4 2.3 1.4 3.6 2.7 4.1C14.2 9.4 15 5.7 16 2.5z"/>' +
      '<path class="s" d="M16 26.4a3 3 0 0 1-3-3c0-2.4 3-4.4 3-6.6 1 1.9 3 3.8 3 6.6a3 3 0 0 1-3 3z" opacity=".9"/><path d="M3 29h26"/>';
  })(),
  'meteor-shower':
    '<circle class="f" cx="21.5" cy="15.5" r="3.4"/><circle cx="21.5" cy="15.5" r="3.4"/><path d="M24 13 29 8M24.8 16.6l3.6-3.6"/>' +
    '<circle class="f" cx="8" cy="22" r="2.8"/><circle cx="8" cy="22" r="2.8"/><path d="M10 20 15 15M10.8 23l2.8-2.8"/>' +
    '<circle class="f" cx="16" cy="27" r="2"/><circle cx="16" cy="27" r="2"/><path d="M17.5 25.5l3.5-3.5"/>' +
    '<path class="th" d="M12 7.5 15.5 4M5.5 13 8 10.5"/>',
  'spawn-golem':
    '<path class="f" d="M12.6 4.5h6.8l1.2 4.6-1.8 2.6h-5.6l-1.8-2.6z"/><path d="M12.6 4.5h6.8l1.2 4.6-1.8 2.6h-5.6l-1.8-2.6z"/><path class="s" d="M13.6 7.4h1.9v1.2h-1.9zM16.5 7.4h1.9v1.2h-1.9z"/>' +
    '<path class="f" d="M9.6 13.2 16 11.7l6.4 1.5 1.6 7-3 4.4H11l-3-4.4z"/><path d="M9.6 13.2 16 11.7l6.4 1.5 1.6 7-3 4.4H11l-3-4.4z"/><path class="th" d="M16 11.7v6.6l-4.2 3.4M16 18.3l4.2 3.4"/>' +
    '<path d="M9.6 13.6 5.8 15.4l-1.5 6.4 2.3 2.4 2.6-1.4M22.4 13.6l3.8 1.8 1.5 6.4-2.3 2.4-2.6-1.4M12.4 24.6v3.9h3v-3.9M16.6 24.6v3.9h3v-3.9"/>' +
    '<circle class="ts" cx="11.4" cy="13.6" r="1.3"/><circle class="ts" cx="21" cy="13" r="1"/><circle class="ts" cx="13.6" cy="5" r=".9"/>',
  'spawn-serpent':
    `<path class="f" d="M4.5 24c0-5.6 2.8-9 6-9s6 3.4 6 9h-3.4c0-3.6-1.2-5.6-2.6-5.6S7.9 20.4 7.9 24z"/><path d="M4.5 24c0-5.6 2.8-9 6-9s6 3.4 6 9M7.9 24c0-3.6 1.2-5.6 2.6-5.6s2.6 2 2.6 5.6"/>` +
    '<path class="f" d="M19 24c0-7.4 1.8-12.4 5.4-13.8 2.2-.8 4.4.4 4.8 2.6l-3.4.6c-.8 1.6-1.6 4.8-1.6 10.6z"/><path d="M19 24c0-7.4 1.8-12.4 5.4-13.8 2.2-.8 4.4.4 4.8 2.6l-3.4.6c-.8 1.6-1.6 4.8-1.6 10.6"/><circle class="s" cx="25.4" cy="12.2" r=".9"/><path class="t" d="M22.4 11.2l-2.2-3.6 3.6 1.4M20.4 15.2l-2.6-1.6"/>' +
    `<path d="${wave(26.5, 2.5, 29.5, 4, 1.4)}"/>`,
  'found-vale':
    '<path class="f" d="M5 27V17.5h13V27z"/><path d="M5 17.5V27h13v-9.5M8.6 17.5V27M14.4 17.5V27M8.6 22.4l5.8-4.9"/>' +
    '<path class="ts" d="M3 18.4c2.4-4.4 5.2-8 8.5-10.6 3.3 2.6 6.1 6.2 8.5 10.6z" opacity=".6"/><path d="M3 18.4c2.4-4.4 5.2-8 8.5-10.6 3.3 2.6 6.1 6.2 8.5 10.6z"/><path class="th" d="M7.6 13.4h7.8M5.6 16h11.8"/>' +
    ROUND_TREE(25, 20.2, 0.46) + '<path d="M2.5 27.5h27"/>',
  'found-dune':
    '<path class="f" d="M5.5 27V19h14v8z"/><path d="M5.5 19v8h14v-8z"/><path class="ts" d="M7.6 19a4.9 4.9 0 0 1 9.8 0z" opacity=".6"/><path d="M7.6 19a4.9 4.9 0 0 1 9.8 0M12.5 14.1v-2.4"/><path d="M10.6 27v-3a1.9 1.9 0 0 1 3.8 0v3"/>' +
    '<path class="f" d="M21.5 27V9.6h5V27z"/><path d="M21.5 27V9.6h5V27M20.8 9.6h6.4l-1.2-2.4h-4z"/><path class="th" d="M23 12.4h2M23 15h2"/><path d="M2.5 27.5h27"/>',
  'found-frost':
    '<path class="f" d="M3.8 19.4 11.5 5l7.7 14.4z"/><path d="M3.8 19.4 11.5 5l7.7 14.4"/><path class="s" d="M9.3 9.2 11.5 5l2.2 4.2-1-.6-1.2.9-1.2-.9z"/>' +
    '<path d="M6 19.4v8.1h11v-8.1"/><path class="th" d="M6 23.4h5.4M11.4 23.4v4.1M13.4 21.4H17M9.6 19.4v4"/>' +
    CONIFER(24.6, 19.4, 0.72) + '<path d="M2.5 27.5h27"/>',
  'found-mire':
    '<path class="ts" d="M4.6 12.6c3.6 1.7 7.4 1.7 11.4 0s7.8-1.7 11.4 0l-2.4-4.8c-2.6 1-5.6 1.5-9 1.5S9.6 8.8 7 7.8z" opacity=".6"/><path d="M4.6 12.6c3.6 1.7 7.4 1.7 11.4 0s7.8-1.7 11.4 0l-2.4-4.8c-2.6 1-5.6 1.5-9 1.5S9.6 8.8 7 7.8z"/>' +
    '<path class="f" d="M8 13.4h16v5.8H8z"/><path d="M8 13.4v5.8h16v-5.8M14 19.2v-3.6h4v3.6"/><path d="M9.6 19.2v7.2M16 19.2v7.2M22.4 19.2v7.2"/>' +
    `<path d="${wave(26.5, 2.5, 29.5, 4, 1.3)}"/>`,
  'golden-age':
    `<path class="ts" d="M8.6 23.5a7.4 7.4 0 0 1 14.8 0z" opacity=".6"/><path d="M8.6 23.5a7.4 7.4 0 0 1 14.8 0M3 23.5h26M7 27.5h18"/>` +
    [-160, -132, -104, -76, -48, -20]
      .map((a) => {
        const r = (a * Math.PI) / 180;
        return `<path d="M${r1(16 + Math.cos(r) * 10)} ${r1(23.5 + Math.sin(r) * 10)}L${r1(16 + Math.cos(r) * 13.4)} ${r1(23.5 + Math.sin(r) * 13.4)}"/>`;
      })
      .join('') +
    `<path class="s" d="${sparkle(16, 4.2, 2.6)}"/>`,
  'bountiful-harvest':
    g('rotate(-24 16 24)', WHEAT(16, 13.5, 0.7)) + g('rotate(24 16 24)', WHEAT(16, 13.5, 0.7)) + WHEAT(16, 12.5, 0.74) + '<path d="M12.6 22.4h6.8" style="stroke-width:3"/>',
  // job glyphs (inspector portraits)
  'job-woodcutter': '<path d="M9 28 21 8.5"/><path class="f" d="M18.6 6.2c2.8-1.8 6.2-1.4 8 .8-1 3.2-3.6 5.4-6.8 5.8z"/><path d="M18.6 6.2c2.8-1.8 6.2-1.4 8 .8-1 3.2-3.6 5.4-6.8 5.8"/>',
  'job-miner': '<path d="M10 28 19 9"/><path class="f" d="M5.5 12.2C10.4 6.4 19.4 4.8 26.6 9c-6.6-2-13.8-1-21.1 3.2z"/><path d="M5.5 12.2C10.4 6.4 19.4 4.8 26.6 9"/><path class="s" d="M21 25.5l2.4-2.4 3 1.4-1 3.4-3.2.4z"/>',
  'job-farmer': '<path d="M10 28 21 6.5"/><path class="f" d="M21 6.5c4 .2 7 2.6 7.6 6.2-3.2-2-6.6-2.4-9.8-1.6z"/><path d="M21 6.5c4 .2 7 2.6 7.6 6.2-3.2-2-6.6-2.4-9.8-1.6"/>' + WHEAT(7.5, 16, 0.5),
  'job-fisher': '<path d="M5 28 24 5"/><path class="th" d="M24 5c2 3 2.6 8 2.6 13"/><path d="M26.6 18v3.4a2.4 2.4 0 0 1-4.8 0v-1"/><path class="f" d="M4 22c2.4-2.6 5.4-3.6 8.6-2.6l2.4-2v6l-2.4-2C9.4 22.4 6.4 22 4 22z"/>',
  'job-soldier': '<path class="f" d="M16 4.5 26 8v7.4c0 6-4.2 9.8-10 12.1C10.2 25.2 6 21.4 6 15.4V8z"/><path d="M16 4.5 26 8v7.4c0 6-4.2 9.8-10 12.1C10.2 25.2 6 21.4 6 15.4V8z"/><path d="M16 9v13M11.5 14h9"/>',
  'job-child': '<circle class="f" cx="16" cy="13" r="4.2"/><circle cx="16" cy="13" r="4.2"/><path class="f" d="M9 27.5v-1c0-4 3.2-6.6 7-6.6s7 2.6 7 6.6v1z"/><path d="M9 27.5v-1c0-4 3.2-6.6 7-6.6s7 2.6 7 6.6v1"/>',
};


// Category swatch silhouettes: the shape says the category, the colour says the power.
const swPair = (d) => `<path class="sw" d="${d}"/><path class="swl" d="${d}"/>`;
const CAT_SWATCH = {
  terrain: swPair('M8.5 2.6h15a5.9 5.9 0 0 1 5.9 5.9v15a5.9 5.9 0 0 1-5.9 5.9h-15a5.9 5.9 0 0 1-5.9-5.9v-15a5.9 5.9 0 0 1 5.9-5.9z'),
  nature: swPair('M16 2.4C24 2.4 29.6 8 29.6 16S24 29.6 16 29.6c-4.2 0-8-1.6-10.6-4.4L2.4 29.6l.6-5.4C1.6 21.6 2.4 18.8 2.4 16 2.4 8 8 2.4 16 2.4z'),
  life: swPair('M16 2.4c9.2 0 13.6 4.4 13.6 13.6S25.2 29.6 16 29.6 2.4 25.2 2.4 16 6.8 2.4 16 2.4z'),
  civ: swPair('M16 2.2 28.6 6.4v9.4c0 7.2-5.2 12-12.6 14.6C8.6 27.8 3.4 23 3.4 15.8V6.4z'),
  disaster: swPair('M10.6 2.6h10.8l7.9 7.9v10.8l-7.9 7.9H10.6l-7.9-7.9V10.6z'),
  world: swPair('M16 2.4a13.6 13.6 0 1 1 0 27.2 13.6 13.6 0 0 1 0-27.2z') + '<circle class="swl" cx="16" cy="16" r="11.2" style="stroke-opacity:.35"/>',
};

// Biome motifs were drawn above a ground band; centre them on the swatch.
for (const k of Object.keys(P)) {
  if (!k.startsWith('paint-')) continue;
  const body = P[k].startsWith(SWATCH) ? P[k].slice(SWATCH.length) : P[k];
  P[k] = SWATCH + g(P[k].startsWith(SWATCH) ? 'translate(0 3.2)' : 'translate(0 .6)', body);
}

// Aliases / synonyms for ids other teams are likely to use.
const ALIAS = {
  'spawn-humans': 'spawn-human',
  'spawn-people': 'spawn-human',
  'spawn-villager': 'spawn-human',
  'spawn-sheeps': 'spawn-sheep',
  'spawn-wolves': 'spawn-wolf',
  'spawn-cattle': 'spawn-cow',
  'spawn-chick': 'spawn-chicken',
  'spawn-hen': 'spawn-chicken',
  'spawn-bunny': 'spawn-rabbit',
  'spawn-hare': 'spawn-rabbit',
  'spawn-birds': 'spawn-bird',
  'spawn-seagull': 'spawn-bird',
  'spawn-crow': 'spawn-bird',
  'spawn-eagle': 'spawn-bird',
  'spawn-boar': 'spawn-pig',
  'spawn-undead': 'spawn-skeleton',
  'spawn-zombie': 'spawn-skeleton',
  'spawn-wyvern': 'spawn-dragon',
  'spawn-skywyrm': 'spawn-dragon',
  'spawn-tidewyrm': 'spawn-serpent',
  'spawn-sea-serpent': 'spawn-serpent',
  'forge-alliance': 'alliance',
  'incite-rebellion': 'rebellion',
  'job-builder': 'build',
  'job-king': 'crown',
  'job-queen': 'crown',
  'job-ruler': 'crown',
  'spawn-cod': 'spawn-fish',
  'spawn-salmon': 'spawn-fish',
  'spawn-fishes': 'spawn-fish',
  'plant-trees': 'plant-forest',
  'plant-oak': 'plant-tree',
  'plant-birch': 'plant-tree',
  'plant-acacia': 'paint-savanna',
  'plant-flower': 'plant-flowers',
  'plant-crops': 'plant-wheat',
  'plant-bushes': 'plant-bush',
  'plant-berry': 'plant-berries',
  'plant-mushrooms': 'plant-mushroom',
  'plant-boulders': 'plant-rocks',
  'plant-stones': 'plant-rocks',
  'place-rocks': 'plant-rocks',
  'plant-jungle': 'paint-jungle',
  uproot: 'clear-flora',
  'clear-trees': 'clear-flora',
  'meteor-shower': 'meteor',
  meteorite: 'meteor',
  quake: 'earthquake',
  eruption: 'volcano',
  tsunami: 'flood',
  'acid-rain': 'acid-rain',
  acid: 'acid-rain',
  storm: 'weather-storm',
  rain: 'weather-rain',
  snow: 'weather-snow',
  fog: 'weather-fog',
  wind: 'weather-wind',
  clear: 'weather-clear',
  'weather-sun': 'weather-clear',
  'weather-sunny': 'weather-clear',
  'weather-blizzard': 'blizzard',
  'weather-clouds': 'weather-cloudy',
  sun: 'weather-clear',
  'time-day': 'day',
  'time-night': 'night',
  'make-war': 'declare-war',
  war: 'declare-war',
  peace: 'make-peace',
  'make-alliance': 'alliance',
  ally: 'alliance',
  revolt: 'rebellion',
  riot: 'rebellion',
  'spawn-kingdom': 'found-kingdom',
  'new-kingdom': 'found-kingdom',
  castle: 'found-kingdom',
  village: 'found-village',
  'make-king': 'crown',
  'crown-king': 'crown',
  coronate: 'crown',
  'build-road': 'road',
  roads: 'road',
  'paint-road': 'paint-road',
  'paint-farm': 'paint-farmland',
  farm: 'farmland',
  treasure: 'gold',
  gift: 'gold',
  'give-gold': 'gold',
  hex: 'curse',
  disease: 'plague',
  pestilence: 'plague',
  insanity: 'madness',
  frenzy: 'madness',
  lightning: 'lightning',
  'lightning-strike': 'lightning',
  thunder: 'lightning',
  'smite-unit': 'smite',
  blessing: 'bless',
  miracle: 'bless',
  'heal-area': 'heal',
  love: 'fertility',
  'kill-unit': 'kill',
  'paint-lava': 'paint-lava',
  'paint-ice': 'paint-ice',
  'paint-ash': 'paint-ash',
  'raise-land': 'raise',
  'lower-land': 'lower',
  'new-land': 'land',
  island: 'land',
  'make-island': 'land',
  'smooth-land': 'smooth',
  erode: 'smooth',
  'carve-river': 'river',
  magnify: 'inspect',
  eraser: 'erase',
};

// Keyword fallbacks when the id is not in the table (checked in order).
const KEYWORDS = [
  [/human|villager|people|settler/, 'spawn-human'],
  [/(^|-)(elf|elves|elven)(-|$)/, 'spawn-elf'],
  [/dwarf/, 'spawn-dwarf'],
  [/(^|-)(orc|orcs)(-|$)|goblin|troll|ogre/, 'spawn-orc'],
  [/sheep|lamb/, 'spawn-sheep'],
  [/wolf|wolves/, 'spawn-wolf'],
  [/deer|elk|stag|moose/, 'spawn-deer'],
  [/chicken|hen|duck|goose/, 'spawn-chicken'],
  [/rabbit|bunny|hare/, 'spawn-rabbit'],
  [/fish|shark|whale|dolphin/, 'spawn-fish'],
  [/bird|crow|gull|eagle|owl|hawk/, 'spawn-bird'],
  [/(^|-)bears?(-|$)/, 'spawn-bear'],
  [/cow|cattle|bison|ox\b|buffalo/, 'spawn-cow'],
  [/(^|-)(pig|pigs|boar|hog)(-|$)/, 'spawn-pig'],
  [/horse|pony|camel/, 'spawn-horse'],
  [/(^|-)fox(es)?(-|$)/, 'spawn-fox'],
  [/(^|-)(cat|lion|tiger|lynx)(-|$)/, 'spawn-cat'],
  [/(^|-)(dog|dogs|hound)(-|$)/, 'spawn-dog'],
  [/goat|ibex/, 'spawn-goat'],
  [/dragon|wyvern|drake/, 'spawn-dragon'],
  [/crab|lobster/, 'spawn-crab'],
  [/(^|-)(bee|bees|wasp|insect|locust)(-|$)/, 'spawn-bee'],
  [/skeleton|undead|zombie|ghoul/, 'spawn-skeleton'],
  [/snake|serpent/, 'spawn-snake'],
  [/flower|blossom/, 'plant-flowers'],
  [/cactus/, 'plant-cactus'],
  [/palm/, 'plant-palm'],
  [/pine|conifer|spruce|fir\b/, 'plant-pine'],
  [/mushroom|fung/, 'plant-mushroom'],
  [/berr/, 'plant-berries'],
  [/reed|cattail/, 'plant-reeds'],
  [/wheat|crop|grain|harvest/, 'plant-wheat'],
  [/bush|shrub/, 'plant-bush'],
  [/boulder|stone|rock/, 'plant-rocks'],
  [/grass/, 'plant-grass'],
  [/forest|tree|oak|birch|wood/, 'plant-forest'],
  [/bloom|grow|fertil/, 'bloom'],
  [/wither|blight|drought/, 'drought'],
  [/meteor|comet|asteroid/, 'meteor'],
  [/lightning|thunder|bolt/, 'lightning'],
  [/quake|tremor|shake/, 'earthquake'],
  [/tornado|twister|whirlwind|cyclone/, 'tornado'],
  [/volcan|erupt/, 'volcano'],
  [/plague|disease|pest|virus|sick/, 'plague'],
  [/flood|tsunami|wave|deluge/, 'flood'],
  [/acid/, 'acid-rain'],
  [/blizzard|frost|freeze/, 'blizzard'],
  [/bomb|explo|blast|nuke|tnt/, 'bomb'],
  [/lava|magma/, 'lava'],
  [/fire|flame|burn|ignite|blaze/, 'fire'],
  [/storm/, 'weather-storm'],
  [/rain/, 'weather-rain'],
  [/snow/, 'weather-snow'],
  [/fog|mist/, 'weather-fog'],
  [/wind|gust/, 'weather-wind'],
  [/cloud/, 'weather-cloudy'],
  [/(^|-)(sun|sunny|clear|day)(-|$)/, 'weather-clear'],
  [/night|moon/, 'night'],
  [/eclipse/, 'eclipse'],
  [/(^|-)(war|attack|battle)(-|$)/, 'declare-war'],
  [/peace|truce/, 'make-peace'],
  [/allian|ally|pact/, 'alliance'],
  [/rebel|revolt|riot/, 'rebellion'],
  [/king|crown|royal|emperor/, 'crown'],
  [/village|settle|town|house/, 'found-village'],
  [/kingdom|castle|city|fort/, 'found-kingdom'],
  [/raze|ruin|sack/, 'raze'],
  [/road|path/, 'road'],
  [/farm|field/, 'farmland'],
  [/gold|coin|treasure|gift|wealth/, 'gold'],
  [/build|construct/, 'build'],
  [/trade|market/, 'trade'],
  [/migrat|exodus/, 'migrate'],
  [/bless|holy|divine|miracle/, 'bless'],
  [/heal|cure|restore/, 'heal'],
  [/(^|-)mad|insan|frenz|chaos/, 'madness'],
  [/smite|judg/, 'smite'],
  [/curse|hex|doom/, 'curse'],
  [/kill|death|reap/, 'kill'],
  [/love|breed/, 'fertility'],
  [/inspect|info|look/, 'inspect'],
  [/erase|clear-all|reset/, 'erase'],
  [/(^|-)(time|clock|skip|warp)(-|$)/, 'time-skip'],
  [/river|canal/, 'river'],
  [/smooth|erod/, 'smooth'],
  [/canyon|chasm|rift/, 'canyon'],
  [/hill/, 'hill'],
  [/mountain|peak/, 'mountain'],
  [/ocean|sea|water|lake/, 'ocean'],
  [/raise|lift/, 'raise'],
  [/lower|sink|dig/, 'lower'],
  [/flat|level/, 'flatten'],
  [/island|(^|-)land(-|$)/, 'land'],
];

// ---------------------------------------------------------------- tints
export const CATEGORY_TINT = {
  terrain: '#f0bf6a',
  biome: '#a8de6e',
  nature: '#5fd49a',
  life: '#ff9f86',
  civ: '#93b4ff',
  disaster: '#ff7043',
  world: '#7fdcec',
};
const ID_TINT = {
  ocean: '#59c3e6',
  lower: '#6cc4dc',
  river: '#59c3e6',
  land: '#9ad66a',
  fire: '#ff7a3a',
  lava: '#ff6a2a',
  meteor: '#ffa95a',
  lightning: '#ffe27a',
  'weather-storm': '#b9a8ff',
  'weather-rain': '#7fc8ff',
  'weather-snow': '#d6ecff',
  'weather-fog': '#c6d2dc',
  'weather-clear': '#ffd36a',
  'weather-wind': '#bde6e2',
  'weather-cloudy': '#c6d6e6',
  day: '#ffd36a',
  night: '#c0b8ff',
  tornado: '#c9d4dc',
  earthquake: '#e0a46a',
  volcano: '#ff6a3a',
  flood: '#59c3e6',
  plague: '#b6e05a',
  'acid-rain': '#b6e05a',
  blizzard: '#d6ecff',
  curse: '#c48cff',
  madness: '#d58cff',
  bless: '#ffe08a',
  heal: '#ff8aa8',
  fertility: '#ff8aa8',
  smite: '#ffe08a',
  'declare-war': '#ff7a6a',
  'make-peace': '#e6eef8',
  crown: '#ffd36a',
  gold: '#ffd36a',
  'plant-flowers': '#ff9fd0',
  'plant-mushroom': '#ff8a6a',
  'plant-berries': '#ff6f9a',
  'plant-wheat': '#f0cf6a',
  'plant-cactus': '#7ccf7a',
  inspect: '#7fdcec',
  erase: '#ff9aa8',
  'spawn-fish': '#7fc8ff',
  'spawn-bee': '#ffd36a',
  'spawn-dragon': '#ff7a5a',
  'spawn-skeleton': '#d8d2c4',
  inferno: '#ff6a2a',
  'meteor-shower': '#ffb36a',
  'spawn-golem': '#a8d27a',
  'spawn-serpent': '#6fe0d8',
  'spawn-skywyrm': '#ffa040',
  'found-vale': '#f0cf6a',
  'found-dune': '#e8b872',
  'found-frost': '#bfe0ff',
  'found-mire': '#7fd09a',
  'golden-age': '#ffd36a',
  'bountiful-harvest': '#f0cf6a',
  'forge-alliance': '#9fe0b0',
  'incite-rebellion': '#ff8a5a',
  tsunami: '#59c3e6',
  wither: '#d0a060',
  bloom: '#ffb0d8',
  'plant-grass': '#9ad66a',
  // terrain
  raise: '#e8b062',
  flatten: '#d8c28a',
  smooth: '#c9a77a',
  mountain: '#b4b0c0',
  // nature
  'plant-forest': '#5fd08a',
  'plant-flowers': '#ff9fd0',
  'clear-flora': '#c08a5a',
  // life
  'spawn-human': '#f2c9a0',
  'spawn-sheep': '#efe6d2',
  'spawn-cow': '#c7956a',
  'spawn-pig': '#ff9fb4',
  'spawn-chicken': '#ff8a5a',
  'spawn-deer': '#d9a466',
  'spawn-rabbit': '#c8c0d8',
  'spawn-wolf': '#8fa4c8',
  'spawn-bear': '#a07850',
  'spawn-fox': '#ff9a40',
  'spawn-birds': '#8fd0ff',
  'spawn-bird': '#8fd0ff',
  'spawn-skywyrm': '#ff7a40',
  fertility: '#ff8ac0',
  bless: '#ffe08a',
  // civ
  'found-village': '#9fbcff',
  // wrath
  fire: '#ff8a3a',
  inferno: '#ff4a2a',
  smite: '#fff0b0',
  earthquake: '#c99060',
  // world
  'weather-clear': '#ffd36a',
};
function hexStr(n) {
  return '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
}
function lighten(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255,
    g2 = (n >> 8) & 255,
    b = n & 255;
  const m = (c) => Math.round(c + (255 - c) * t);
  return '#' + ((1 << 24) | (m(r) << 16) | (m(g2) << 8) | m(b)).toString(16).slice(1);
}
const BIOME_TILE = {
  'paint-grass': TILE.GRASS,
  'paint-forest': TILE.FOREST,
  'paint-jungle': TILE.JUNGLE,
  'paint-savanna': TILE.SAVANNA,
  'paint-desert': TILE.DESERT,
  'paint-sand': TILE.SAND,
  'paint-swamp': TILE.SWAMP,
  'paint-tundra': TILE.TUNDRA,
  'paint-snow': TILE.SNOW,
  'paint-soil': TILE.SOIL,
  'paint-rock': TILE.ROCK,
  'paint-lava': TILE.LAVA,
  'paint-ash': TILE.ASH,
  'paint-farmland': TILE.FARMLAND,
  'paint-road': TILE.ROAD,
  'paint-ice': TILE.ICE,
};
export function tileTint(tileId) {
  const info = TILE_INFO[tileId];
  if (!info) return '#a8de6e';
  return lighten(hexStr(info.color), 0.22);
}

// ---------------------------------------------------------------- public API
export function svg(inner, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">${inner}</svg>`;
}

function resolveInner(id) {
  if (P[id]) return P[id];
  if (ALIAS[id] && P[ALIAS[id]]) return P[ALIAS[id]];
  const bare = id.replace(/^(spawn|plant|paint|weather|cast|summon|make|place|power)-/, '');
  if (P[bare]) return P[bare];
  if (ALIAS[bare] && P[ALIAS[bare]]) return P[ALIAS[bare]];
  if (id.startsWith('paint-')) {
    const t = Object.values(TILE).find((v) => TILE_INFO[v]?.name.toLowerCase().includes(bare));
    if (t != null) return null; // handled by biome swatch fallback
  }
  for (const [re, key] of KEYWORDS) if (re.test(id)) return P[key];
  return null;
}

export function monogram(name) {
  const words = String(name || '?')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).replace(/^./, (c) => c.toUpperCase());
  return (words[0][0] + words[1][0]).toUpperCase();
}

function fallbackInner(p) {
  const cat = CATEGORY_ICONS[p.category] || CATEGORY_ICONS.world;
  const mono = monogram(p.name || p.id);
  const fs = mono.length > 1 ? 11 : 14;
  // a faint category glyph behind a gilded hex badge carrying the monogram
  return (
    `<g opacity=".55">${cat.replace(/class="(s|ts)"/g, 'class="f"').replace(/<path d=|<circle cx=|<ellipse cx=/g, (m) => m.replace('<', '<x-')).replace(/<x-[^>]*\/>/g, '')}</g>` +
    `<path class="th" d="${hexagon(16, 16, 12.6)}"/>` +
    `<text x="16" y="${mono.length > 1 ? 20 : 21}" text-anchor="middle" font-size="${fs}" letter-spacing=".4">${mono}</text>`
  );
}

// Returns { svg, tint } for a power definition (or id).
export function powerIcon(p, cls = '') {
  if (!p) return { svg: svg(fallbackInner({ id: '?', name: '?', category: 'world' }), cls), tint: CATEGORY_TINT.world };
  const id = p.id || '';
  let tint = p.cursorColor || ID_TINT[id] || ID_TINT[ALIAS[id]] || CATEGORY_TINT[p.category] || '#e9c77b';
  if (BIOME_TILE[id] != null) tint = tileTint(BIOME_TILE[id]);
  else if (id.startsWith('paint-')) {
    const bare = id.slice(6);
    const t = Object.values(TILE).find((v) => TILE_INFO[v]?.name.toLowerCase().includes(bare));
    if (t != null) tint = tileTint(t);
  }
  const own = P[id] || (ALIAS[id] && P[ALIAS[id]]);
  if (!own && typeof p.icon === 'string' && /<svg\b/i.test(p.icon)) {
    const norm = normalizeSvg(p.icon, cls);
    if (norm) return { svg: norm, tint, custom: true };
  }
  let inner = own || resolveInner(id);
  if (!inner && id.startsWith('paint-')) inner = SWATCH + `<path class="f" d="M16 6c3.6 4.4 6 8 6 10.6a6 6 0 0 1-12 0C12 14 12.4 10.4 16 6z"/><path d="M16 6c3.6 4.4 6 8 6 10.6a6 6 0 0 1-12 0C12 14 12.4 10.4 16 6z"/>`;
  if (!inner) inner = fallbackInner(p);
  // every power sits on a category-shaped swatch in its own accent colour
  if (!inner.startsWith(SWATCH)) inner = (CAT_SWATCH[p.category] || CAT_SWATCH.world) + inner;
  return { svg: svg(inner, 'ico--sw ' + cls), tint };
}

// Make a module-supplied SVG behave like ours: sized by font-size, styled by
// the icon classes, keeping its own viewBox.
function normalizeSvg(markup, cls = '') {
  const m = String(markup).match(/<svg\b([^>]*)>/i);
  if (!m) return null;
  const vb = m[1].match(/viewBox\s*=\s*["']([^"']+)["']/i)?.[1] || '0 0 24 24';
  const body = String(markup)
    .slice(m.index + m[0].length)
    .replace(/<\/svg>\s*$/i, '');
  const w = +vb.split(/[\s,]+/)[2] || 24;
  return `<svg class="ico ico--ext ${cls}" viewBox="${vb}" style="--sw:${((2 * w) / 32).toFixed(2)}" aria-hidden="true" focusable="false">${body}</svg>`;
}

export function categoryIcon(id, cls = '') {
  return svg(CATEGORY_ICONS[id] || CATEGORY_ICONS.world, cls);
}
export function hasIcon(id) {
  return !!resolveInner(id);
}
export const POWER_ICON_IDS = Object.keys(P);

// ---------------------------------------------------------------- UI glyphs
const U = {
  pause: '<rect class="s" x="8" y="6.5" width="5.5" height="19" rx="1.6"/><rect class="s" x="18.5" y="6.5" width="5.5" height="19" rx="1.6"/>',
  play: '<path class="s" d="M10 6.6v18.8a1.4 1.4 0 0 0 2.1 1.2l15.2-9.4a1.4 1.4 0 0 0 0-2.4L12.1 5.4A1.4 1.4 0 0 0 10 6.6z"/>',
  settings: `<path d="${gear(16, 16, 12.2, 9.4, 8)}"/><circle cx="16" cy="16" r="4"/>`,
  help: '<circle cx="16" cy="16" r="12"/><path d="M12.2 12.6a4 4 0 0 1 7.7 1.4c0 2.6-3.9 3.4-3.9 5.6"/><circle class="s" cx="16" cy="23.2" r="1.5"/>',
  close: '<path d="M9 9l14 14M23 9 9 23"/>',
  crown: P.crown,
  house: HOUSE(16, 17, 1.25),
  person: '<circle cx="16" cy="10" r="5"/><path d="M6.5 27.5v-1c0-5 4.3-8.5 9.5-8.5s9.5 3.5 9.5 8.5v1"/>',
  paw: CATEGORY_ICONS.life,
  tree: CATEGORY_ICONS.nature,
  map: '<path class="f" d="M3.5 7.5 11 4.5l10 3 7.5-3v20l-7.5 3-10-3-7.5 3z"/><path d="M3.5 7.5 11 4.5l10 3 7.5-3v20l-7.5 3-10-3-7.5 3zM11 4.5v20M21 7.5v20"/>',
  follow: '<circle cx="16" cy="16" r="5"/><circle class="s" cx="16" cy="16" r="1.8"/><path d="M4 10V6a2 2 0 0 1 2-2h4M22 4h4a2 2 0 0 1 2 2v4M28 22v4a2 2 0 0 1-2 2h-4M10 28H6a2 2 0 0 1-2-2v-4"/>',
  focus: '<circle cx="16" cy="16" r="8.5"/><path d="M16 3.5v6M16 22.5v6M3.5 16h6M22.5 16h6"/><circle class="s" cx="16" cy="16" r="1.8"/>',
  dice: '<rect x="5" y="5" width="22" height="22" rx="5"/><circle class="s" cx="11" cy="11" r="2"/><circle class="s" cx="21" cy="11" r="2"/><circle class="s" cx="16" cy="16" r="2"/><circle class="s" cx="11" cy="21" r="2"/><circle class="s" cx="21" cy="21" r="2"/>',
  'chev-up': '<path d="M8 19.5 16 11.5l8 8"/>',
  'chev-down': '<path d="M8 12.5l8 8 8-8"/>',
  'chev-left': '<path d="M19.5 8l-8 8 8 8"/>',
  'chev-right': '<path d="M12.5 8l8 8-8 8"/>',
  volume: '<path class="f" d="M5 12.5h4.5L16 6.5v19l-6.5-6H5z"/><path d="M5 12.5h4.5L16 6.5v19l-6.5-6H5zM20.5 11.5a6 6 0 0 1 0 9M24 8a11 11 0 0 1 0 16"/>',
  mute: '<path class="f" d="M5 12.5h4.5L16 6.5v19l-6.5-6H5z"/><path d="M5 12.5h4.5L16 6.5v19l-6.5-6H5zM20.5 12.5l7 7M27.5 12.5l-7 7"/>',
  sun: SUN(),
  moon: `<path class="f" d="${MOON}"/><path d="${MOON}"/>`,
  info: '<circle cx="16" cy="16" r="11.5"/><path d="M16 14.5v8"/><circle class="s" cx="16" cy="10.2" r="1.6"/>',
  good: `<path class="s" d="${sparkle(14, 17, 10)}"/><path class="s" d="${sparkle(25, 7.5, 4)}"/>`,
  bad: '<path d="M16 4.5 28.5 26.5h-25z"/><path d="M16 12.5v7"/><circle class="s" cx="16" cy="23" r="1.5"/>',
  war: SWORD(false) + SWORD(true),
  disaster: P.fire,
  globe: CATEGORY_ICONS.world,
  'new-world': '<circle cx="14.5" cy="16.5" r="10"/><path d="M4.5 16.5h20M14.5 6.5c-3 2.8-4.4 6.2-4.4 10s1.4 7.2 4.4 10c3-2.8 4.4-6.2 4.4-10S17.5 9.3 14.5 6.5z"/><circle class="ts" cx="25" cy="7" r="5.6" style="stroke:none"/><path d="M25 4.2v5.6M22.2 7h5.6" style="stroke:#191307;stroke-width:1.8"/>',
  kingdoms: P.banner,
  menu: '<path d="M5 9h22M5 16h22M5 23h22"/>',
  'eye-off': '<path d="M4 16c3.2-5.4 7.2-8 12-8s8.8 2.6 12 8c-3.2 5.4-7.2 8-12 8s-8.8-2.6-12-8z"/><circle cx="16" cy="16" r="4"/><path d="M5 27 27 5"/>',
  locate: '<path d="M16 28.5S7 19.8 7 13a9 9 0 0 1 18 0c0 6.8-9 15.5-9 15.5z"/><circle cx="16" cy="13" r="3.2"/>',
  brush: '<circle cx="16" cy="16" r="11.5" class="th"/><circle cx="16" cy="16" r="6.5"/><circle class="s" cx="16" cy="16" r="1.6"/>',
  minus: '<path d="M8 16h16"/>',
  plus: '<path d="M8 16h16M16 8v16"/>',
  keyboard: '<rect x="3" y="8" width="26" height="16" rx="3"/><path d="M8 13h.01M12 13h.01M16 13h.01M20 13h.01M24 13h.01M8 17.5h.01M24 17.5h.01M11.5 20h9" style="stroke-width:2.4"/>',
  mouse: '<rect x="9" y="3.5" width="14" height="25" rx="7"/><path d="M16 8v5"/>',
  sword: SWORD(false),
  heart: P.heal,
  shield: '<path class="f" d="M16 3.5 26 7v8.5c0 6.4-4.4 10.6-10 13-5.6-2.4-10-6.6-10-13V7z"/><path d="M16 3.5 26 7v8.5c0 6.4-4.4 10.6-10 13-5.6-2.4-10-6.6-10-13V7z"/>',
  chronicle: '<path class="f" d="M8 4.5h15a3 3 0 0 1 3 3v17H11a3 3 0 0 0-3 3z"/><path d="M8 27.5v-20a3 3 0 0 1 3-3h15v20H11a3 3 0 0 0-3 3 3 3 0 0 0 3 3h15M13 10.5h8M13 15h6"/>',
  grid: '<rect x="5" y="5" width="9" height="9" rx="2"/><rect x="18" y="5" width="9" height="9" rx="2"/><rect x="5" y="18" width="9" height="9" rx="2"/><rect x="18" y="18" width="9" height="9" rx="2"/>',
  sparkle: `<path class="s" d="${sparkle(16, 16, 11)}"/>`,
  compass: '<circle cx="16" cy="16" r="12"/><path class="ts" d="M16 6.5l3.2 9.5h-6.4z" style="stroke:none"/><path class="s" d="M16 25.5 12.8 16h6.4z" opacity=".55"/>',
  expand: '<path d="M5 12V5h7M27 12V5h-7M5 20v7h7M27 20v7h-7"/>',
  collapse: '<path d="M12 5v7H5M20 5v7h7M12 27v-7H5M20 27v-7h7"/>',
  population: '<circle cx="12" cy="11" r="4.2"/><path d="M4 26v-.8c0-4.2 3.6-7 8-7s8 2.8 8 7v.8"/><path class="th" d="M20.5 7.4a4 4 0 0 1 0 7.4M23.5 18.6c2.6.9 4.5 3.2 4.5 6.4v1"/>',
  village: HOUSE(11.5, 17.5, 0.95) + HOUSE(22, 19.5, 0.7),
};
export function uiIcon(name, cls = '') {
  return svg(U[name] || P[name] || (ALIAS[name] && P[ALIAS[name]]) || U.info, cls);
}
