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
