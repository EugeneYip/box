import { esc, hexCss } from './dom.js';
import { uiIcon } from './icons.js';

// Realm banners for the UI. When the renderer's emblem module exists
// (src/render/buildings/emblems.js, drawn on labels and building flags) the UI
// uses the very same drawing, so the editor preview matches the world. Without
// it, a small SVG stand-in keeps the editor usable.
const MOD = import.meta.glob('../render/buildings/emblems.js', { eager: true });
const E = Object.values(MOD)[0] || null;
export const hasEmblems = typeof E?.bannerDataURL === 'function';

const FALLBACK_ICON = {
  tower: 'found-kingdom',
  wheat: 'plant-wheat',
  wolf: 'spawn-wolf',
  star: 'sparkle',
  wave: 'ocean',
  oak: 'plant-tree',
  flame: 'fire',
  crown: 'crown',
  anvil: 'build',
  ship: 'ship',
  moon: 'night',
  eye: 'curse',
  key: 'gold',
  sun: 'sun',
  mountain: 'mountain',
  stag: 'spawn-deer',
};
const shade = (hex, k) => {
  const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16) || 0;
  return `rgb(${(((n >> 16) & 255) * k) | 0},${(((n >> 8) & 255) * k) | 0},${((n & 255) * k) | 0})`;
};
const inner = (svg) => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

// SVG stand-in: pennant with a notched fly, field in a darker shade, emblem.
function bannerSvg(banner, color) {
  const c = hexCss(color);
  const d = shade(color, 0.55);
  const f = banner?.field || 'plain';
  const pat =
    {
      pale: `<rect x="16" y="0" width="16" height="40" fill="${d}"/>`,
      bend: `<path d="M32 0v40H0z" fill="${d}"/>`,
      chevron: `<path d="M0 40 16 17l16 23z" fill="${d}"/>`,
      quartered: `<rect x="16" y="0" width="16" height="20" fill="${d}"/><rect x="0" y="20" width="16" height="20" fill="${d}"/>`,
    }[f] || '';
  const ic = banner?.symbol ? FALLBACK_ICON[banner.symbol] : null;
  const glyph = ic ? `<g transform="translate(6.5 6) scale(.6)" style="color:#f3ead2;--tint:#f3ead2">${inner(uiIcon(ic))}</g>` : banner?.symbol ? `<text x="16" y="22" text-anchor="middle" font-size="12" fill="#f3ead2" font-family="serif" font-weight="700">${esc(String(banner.symbol)[0].toUpperCase())}</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40"><defs><clipPath id="p"><path d="M0 0h32v32.8L16 40 0 32.8z"/></clipPath></defs><g clip-path="url(#p)"><rect width="32" height="40" fill="${c}"/>${pat}</g>${glyph}</svg>`;
}

const cache = new Map();
// Data URL of a banner (field + emblem in the realm colour).
export function bannerURL(banner, color, size = 64) {
  const key = `${banner?.symbol}|${banner?.field}|${color}|${size}`;
  let url = cache.get(key);
  if (url != null) return url;
  url = '';
  try {
    url = hasEmblems ? E.bannerDataURL(banner, color, size) : 'data:image/svg+xml;utf8,' + encodeURIComponent(bannerSvg(banner, color));
  } catch (err) {
    console.warn('[ui] banner', err);
  }
  if (cache.size > 240) cache.clear();
  cache.set(key, url);
  return url;
}

const glyphs = new Map();
// White emblem on transparent, for CSS masks (so buttons can tint it); null without the renderer module.
export function emblemURL(id) {
  if (typeof E?.drawEmblem !== 'function') return null;
  if (glyphs.has(id)) return glyphs.get(id);
  let url = null;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 48;
    E.drawEmblem(c.getContext('2d'), id, 24, 24, 42, '#ffffff');
    url = c.toDataURL('image/png');
  } catch {
    url = null;
  }
  glyphs.set(id, url);
  return url;
}
// Markup for an emblem button face.
export function emblemFace(id) {
  const m = emblemURL(id);
  if (m) return `<i class="ws-ebtn__glyph" style="--m:url(${m})"></i>`;
  const ic = FALLBACK_ICON[id];
  return ic ? uiIcon(ic) : `<b>${esc(String(id)[0].toUpperCase())}</b>`;
}
export const EMBLEM_IDS = E?.EMBLEM_IDS || Object.keys(FALLBACK_ICON);
export const FIELD_IDS = E?.FIELD_IDS || ['plain', 'pale', 'bend', 'chevron', 'quartered'];
