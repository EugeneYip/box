// Tiny DOM helpers shared by the UI modules.

export function el(tag, attrs = null, ...kids) {
  const e = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    e.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return e;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// 1234 -> "1,234", 25300 -> "25.3k", 1.2e6 -> "1.2M"
export function fmtNum(n) {
  if (n == null || Number.isNaN(+n)) return '—';
  n = +n;
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return Math.round(n).toLocaleString('en-US');
}

export function hexCss(n, fallback = '#e9c77b') {
  if (n == null || Number.isNaN(+n)) return fallback;
  if (typeof n === 'string') return n.startsWith('#') ? n : '#' + n;
  return '#' + (n >>> 0).toString(16).padStart(6, '0').slice(-6);
}

export function rgbOf(hex) {
  const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Run fn, swallowing (and logging once) any exception from another team's code.
const warned = new Set();
// "deep teal", "pale rose", "gold": a plain name for any 0xRRGGBB colour.
export function colourName(hex) {
  const n = typeof hex === 'number' ? hex : parseInt(String(hex || '').replace('#', ''), 16) || 0;
  const r = ((n >> 16) & 255) / 255,
    g = ((n >> 8) & 255) / 255,
    b = (n & 255) / 255;
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b),
    l = (mx + mn) / 2,
    d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (s < 0.14) return l > 0.82 ? 'white' : l < 0.18 ? 'sable black' : l > 0.55 ? 'silver grey' : 'slate grey';
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const names = [
    [12, 'red'],
    [36, 'orange'],
    [52, 'gold'],
    [72, 'olive'],
    [150, 'green'],
    [182, 'teal'],
    [212, 'azure'],
    [248, 'blue'],
    [282, 'violet'],
    [322, 'purple'],
    [346, 'rose'],
    [360, 'red'],
  ];
  const base = names.find(([lim]) => h < lim)[1];
  const tone = l < 0.3 ? 'deep ' : l > 0.7 ? 'pale ' : '';
  return tone + base;
}
// Civ names a custom colour "a tincture of its own": say which one instead.
export function realmColourText(text, hex) {
  return String(text || '').replace(/a tincture of its own/i, () => colourName(hex));
}

export function safe(fn, fallback = null, tag = '') {
  try {
    return fn();
  } catch (err) {
    const key = tag || String(err && err.message);
    if (!warned.has(key)) {
      warned.add(key);
      console.warn('[ui] guarded call failed' + (tag ? ` (${tag})` : ''), err);
    }
    return fallback;
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function titleCase(s) {
  return String(s || '').replace(/(^|[\s-_])([a-z])/g, (m, a, b) => (a === '-' || a === '_' ? ' ' : a) + b.toUpperCase());
}
