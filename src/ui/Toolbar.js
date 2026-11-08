import { CATEGORIES, listPowers, getPower } from '../powers/registry.js';
import { powerIcon, categoryIcon, uiIcon, CATEGORY_TINT } from './icons.js';
import { el, esc } from './dom.js';

// Power slots in the active category are bound to the bottom letter row.
export const SLOT_CODES = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'Comma', 'Period', 'Slash'];
export const SLOT_LABELS = ['Z', 'X', 'C', 'V', 'B', 'N', ',', '.', '/'];
const NS = SLOT_LABELS.length;
// slot i (0-based in display order): first row plain, second row with Shift
export const slotLabel = (i) => (i < NS ? SLOT_LABELS[i] : i < NS * 2 ? '⇧' + SLOT_LABELS[i - NS] : null);

const MONSTER = /golem|serpent|wyrm|dragon|troll|giant|kraken|monster|demon|skeleton|zombie|undead|behemoth/;
// Optional sub-groups inside a category (a power may also set p.group).
const GROUPS = {
  life: [
    { name: 'Creatures', test: (p) => p.id.startsWith('spawn-') && !MONSTER.test(p.id) },
    { name: 'Monsters', test: (p) => MONSTER.test(p.id) },
    { name: 'Miracles', test: () => true },
  ],
  civ: [
    { name: 'Settle', test: (p) => /^found-|village|settle|colon/.test(p.id) },
    { name: 'Diplomacy', test: (p) => /war|peace|allian|rebel|treaty|truce|pact/.test(p.id) },
    { name: 'Blessings', test: () => true },
  ],
};
export function groupPowers(cat) {
  const list = listPowers(cat);
  const defs = GROUPS[cat];
  const out = [];
  const byName = new Map();
  const add = (name, p) => {
    let gr = byName.get(name);
    if (!gr) byName.set(name, (gr = { name, list: [] })) && out.push(gr);
    gr.list.push(p);
  };
  for (const p of list) {
    if (p.group) add(String(p.group), p);
    else if (defs) add((defs.find((d) => d.test(p)) || defs[defs.length - 1]).name, p);
    else add('', p);
  }
  if (defs) out.sort((a, b) => defs.findIndex((d) => d.name === a.name) - defs.findIndex((d) => d.name === b.name));
  return out;
}

const CAT_BLURB = {
  terrain: 'Raise, carve and level the land',
  biome: 'Paint the skin of the world',
  nature: 'Seed and clear plant life',
  life: 'Bring creatures into being',
  civ: 'Guide the peoples and their realms',
  disaster: 'Unleash the wrath of the heavens',
  world: 'Tools, weather and insight',
};

// God-powers dock: category tabs, power grid, tooltip card and a brush pill
// that only appears for powers with a brush radius. On narrow screens it
// becomes a bottom drawer.
export class Toolbar {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.cat = CATEGORIES[0].id;
    this.powerCount = listPowers().length;
    this.tiles = new Map();
    this._tipTimer = 0;
    this._tipFor = null;
    this._tipWarm = 0;

    this.el = el('div', { class: 'ws-dock' });
    this.brush = this.buildBrush();
    this.panel = el('div', { class: 'ws-dock__panel ws-glass ws-orn' });
    this.handle = el(
      'button',
      { class: 'ws-dock__handle', type: 'button', 'aria-label': 'Open god powers', onclick: () => this.toggleDrawer() },
      el('span', { class: 'ws-dock__handle-ico' }),
      el('span', { class: 'ws-dock__handle-text' }, el('b', { text: 'God Powers' }), el('small', { text: 'Tap to choose' })),
      el('span', { class: 'ws-dock__handle-chev', html: uiIcon('chev-up') }),
    );
    this.tabsEl = el('div', { class: 'ws-tabs', role: 'tablist' });
    this.gridEl = el('div', { class: 'ws-powers', role: 'toolbar' });
    this.minBtn = el('button', {
      class: 'ws-iconbtn ws-iconbtn--sm ws-dock__min',
      type: 'button',
      'aria-label': 'Fold the power tray (`)',
      'data-tip': 'Fold tray · `',
      html: uiIcon('chev-down'),
      onclick: () => this.setMin(!this.el.classList.contains('is-min')),
    });
    this.panel.append(this.handle, el('div', { class: 'ws-dock__body' }, el('div', { class: 'ws-tabrow' }, this.tabsEl, this.minBtn), this.gridEl));
    const row = this.tabsEl.parentElement;
    const hint = (this.tabHint = () => {
      const t = this.tabsEl;
      row.classList.toggle('is-scrolled', t.scrollLeft > 4);
      row.classList.toggle('at-end', t.scrollWidth > 0 && t.scrollLeft + t.clientWidth >= t.scrollWidth - 4);
    });
    row.addEventListener('click', (e) => {
      // the chevron at the right edge scrolls the tabs on phones
      const r = row.getBoundingClientRect();
      if (this.isDrawer() && e.clientX > r.right - 30 && e.target === row) this.tabsEl.scrollBy({ left: 160, behavior: 'smooth' });
    });
    this.tabsEl.addEventListener('scroll', hint, { passive: true });
    requestAnimationFrame(hint);
    let rt = 0;
    addEventListener('resize', () => {
      hint();
      clearTimeout(rt);
      rt = setTimeout(() => this.buildGrid(), 150);
    });
    this.el.append(this.brush.el, this.panel);

    this.tip = el('div', { class: 'ws-tip ws-glass', role: 'tooltip' });
    ui.layer.append(this.tip);

    this.buildTabs();
    this.buildGrid();
    this.syncActive();

    const ev = this.game.events;
    ev.on('power:select', () => this.syncActive());
    ev.on('brush', () => this.syncBrush());
  }

  // ------------------------------------------------------------------ tabs
  buildTabs() {
    this.tabsEl.innerHTML = '';
    this.tabEls = new Map();
    for (const c of CATEGORIES) {
      const n = listPowers(c.id).length;
      const b = el(
        'button',
        {
          class: 'ws-tab',
          type: 'button',
          role: 'tab',
          style: `--tint:${CATEGORY_TINT[c.id] || '#e9c77b'}`,
          'data-cat': c.id,
          'aria-label': `${c.name} (${n} powers)`,
          onclick: () => this.setCategory(c.id),
          onpointerenter: () => this.game.audio?.play?.('ui-hover', { volume: 0.25 }),
        },
        el('span', { class: 'ws-tab__ico', html: categoryIcon(c.id) }),
        el('span', { class: 'ws-tab__label', text: c.name }),
        el('span', { class: 'ws-tab__dot' }),
      );
      if (!n) b.classList.add('is-empty');
      this.tabsEl.append(b);
      this.tabEls.set(c.id, b);
    }
  }

  setMin(min) {
    this.el.classList.toggle('is-min', min);
    this.minBtn.innerHTML = uiIcon(min ? 'chev-up' : 'chev-down');
    this.minBtn.dataset.tip = min ? 'Unfold tray · `' : 'Fold tray · `';
    this.ui.savePrefs?.({ dockMin: min });
    this.hideTip(true);
  }

  setCategory(id, { quiet = false } = {}) {
    if (!CATEGORIES.find((c) => c.id === id)) return;
    if (this.el.classList.contains('is-min')) this.setMin(false);
    if (this.cat === id) return;
    this.cat = id;
    this.tabEls?.get(id)?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    this.hideTip(true);
    this.buildGrid(true);
    this.syncActive();
    if (!quiet) this.game.audio?.play?.('ui-click', { volume: 0.5 });
  }

  cycleCategory(dir = 1) {
    const ids = CATEGORIES.map((c) => c.id).filter((id) => listPowers(id).length);
    if (!ids.length) return;
    const i = ids.indexOf(this.cat);
    this.setCategory(ids[(i + dir + ids.length) % ids.length]);
  }

  // ------------------------------------------------------------------ grid
  // Balanced rows: if a category does not fit on one row, every group gets
  // ceil(n / rows) columns so rows come out even (e.g. 6 + 6, not 11 + 1).
  layout(groups) {
    const cs = getComputedStyle(document.documentElement);
    const tile = parseFloat(cs.getPropertyValue('--ws-tile')) || 56;
    const map = parseFloat(cs.getPropertyValue('--ws-map')) || 214;
    const edge = parseFloat(cs.getPropertyValue('--ws-edge')) || 14;
    const cell = tile + 6;
    const drawer = this.isDrawer();
    const avail = drawer ? Math.min(innerWidth, innerWidth > 720 ? 600 : innerWidth) - 2 * edge - 16 : Math.min(innerWidth - 2 * edge - 2 * (map + 16), 1500) - 22;
    const n = groups.reduce((s, gr) => s + gr.list.length, 0);
    const extra = (groups.length - 1) * 17;
    if (drawer) return groups.map(() => Math.max(1, Math.floor((avail + 6) / cell)));
    const rows = Math.max(1, Math.ceil((n * cell + extra) / Math.max(cell, avail)));
    // small groups (<= 4) stay on one row when the tray has room for it
    const cols = groups.map((gr) => Math.max(1, Math.ceil(gr.list.length / rows)));
    const single = groups.map((gr, i) => (gr.list.length <= 4 ? gr.list.length : cols[i]));
    const width = (cs2) => cs2.reduce((s, c) => s + c * cell, 0) + extra;
    return width(single) <= avail ? single : cols;
  }

  buildGrid(animate = false) {
    const grid = this.gridEl;
    grid.innerHTML = '';
    this.tiles.clear();
    const groups = groupPowers(this.cat);
    const cols = this.layout(groups);
    this.order = groups.flatMap((gr) => gr.list);
    const named = groups.length > 1 || (groups[0] && groups[0].name);
    grid.classList.toggle('is-grouped', !!named);
    let i = 0;
    groups.forEach((gr, gi) => {
      const box = el('div', { class: 'ws-pgroup', style: `--cols:${cols[gi]}` });
      if (named) box.append(el('div', { class: 'ws-pgroup__cap', text: gr.name }));
      const inner = el('div', { class: 'ws-pgroup__grid' });
      box.append(inner);
      grid.append(box);
      for (const p of gr.list) this.makeTile(p, i++, inner);
    });
    const list = this.order;
    grid.style.setProperty('--n', list.length);
    if (!list.length) grid.append(el('div', { class: 'ws-powers__empty', text: 'No powers here yet' }));
    if (animate) {
      grid.classList.remove('is-swap');
      void grid.offsetWidth;
      grid.classList.add('is-swap');
    }
    this.handleCat?.();
  }

  makeTile(p, i, parent) {
    const { svg, tint } = powerIcon(p);
    const key = slotLabel(i);
    const b = el(
      'button',
      {
        class: 'ws-pw',
        type: 'button',
        style: `--tint:${tint};--i:${i}`,
        'data-id': p.id,
        'aria-label': p.name + (key ? ` (${key.replace('⇧', 'Shift+')})` : ''),
        onclick: () => this.pick(p),
        onpointerenter: (e) => {
          if (e.pointerType !== 'touch') this.queueTip(p, b);
        },
        onpointerleave: () => this.hideTip(),
        onfocus: () => this.queueTip(p, b, 0),
        onblur: () => this.hideTip(),
      },
      el('span', { class: 'ws-pw__ico', html: svg }),
      key ? el('span', { class: 'ws-pw__key' + (i >= NS ? ' is-shift' : ''), text: key }) : null,
    );
    parent.append(b);
    this.tiles.set(p.id, b);
  }

  // Rebuild if other modules registered powers after the UI was built.
  refreshIfChanged() {
    const n = listPowers().length;
    if (n === this.powerCount) return;
    this.powerCount = n;
    this.buildTabs();
    this.buildGrid();
    this.syncActive();
  }

  pick(p) {
    const g = this.game;
    if (typeof p === 'string') p = getPower(p);
    if (!p) return;
    const next = g.activePower === p ? null : p;
    g.selectPower(next);
    g.audio?.play?.(next ? 'ui-click' : 'ui-click', { volume: 0.6 });
    if (next && this.isDrawer()) setTimeout(() => this.toggleDrawer(false), 140);
  }

  pickSlot(i) {
    const p = (this.order || listPowers(this.cat))[i];
    if (p) this.pick(p);
    return !!p;
  }

  // ------------------------------------------------------------------ state sync
  syncActive() {
    const ap = this.game.activePower;
    for (const [id, b] of this.tiles) b.classList.toggle('is-on', !!ap && ap.id === id);
    for (const [id, t] of this.tabEls) {
      t.classList.toggle('is-active', id === this.cat);
      t.setAttribute('aria-selected', id === this.cat ? 'true' : 'false');
      t.classList.toggle('has-power', !!ap && ap.category === id && id !== this.cat);
    }
    // handle (drawer mode)
    const ico = this.handle.querySelector('.ws-dock__handle-ico');
    const txt = this.handle.querySelector('.ws-dock__handle-text');
    if (ap) {
      const { svg, tint } = powerIcon(ap);
      ico.innerHTML = svg;
      ico.style.setProperty('--tint', tint);
      txt.innerHTML = `<b>${esc(ap.name)}</b><small>${esc(CATEGORIES.find((c) => c.id === ap.category)?.name || '')} · tap to change</small>`;
    } else {
      ico.innerHTML = categoryIcon(this.cat);
      ico.style.setProperty('--tint', CATEGORY_TINT[this.cat]);
      txt.innerHTML = `<b>God Powers</b><small>Tap to choose a power</small>`;
    }
    this.el.classList.toggle('has-power', !!ap);
    this.syncBrush();
  }

  // ------------------------------------------------------------------ brush pill
  buildBrush() {
    const wrap = el('div', { class: 'ws-brush ws-glass' });
    const ico = el('span', { class: 'ws-brush__ico' });
    const name = el('span', { class: 'ws-brush__name' });
    const mode = el('span', { class: 'ws-brush__mode' });
    const range = el('input', { class: 'ws-range', type: 'range', min: 1, max: 24, step: 1, value: 4, 'aria-label': 'Brush size' });
    const val = el('output', { class: 'ws-brush__val' });
    const ring = el('span', { class: 'ws-brush__ring' });
    const minus = el('button', { class: 'ws-iconbtn ws-iconbtn--sm', type: 'button', 'aria-label': 'Smaller brush ([)', html: uiIcon('minus'), onclick: () => this.game.setBrushSize(this.game.brushSize - 1) });
    const plus = el('button', { class: 'ws-iconbtn ws-iconbtn--sm', type: 'button', 'aria-label': 'Larger brush (])', html: uiIcon('plus'), onclick: () => this.game.setBrushSize(this.game.brushSize + 1) });
    const close = el('button', {
      class: 'ws-iconbtn ws-iconbtn--sm ws-brush__close',
      type: 'button',
      'aria-label': 'Put the power away (Esc)',
      'data-tip': 'Put away · Esc',
      html: uiIcon('close'),
      onclick: () => this.game.selectPower(null),
    });
    range.addEventListener('input', () => this.game.setBrushSize(+range.value));
    wrap.append(
      el('div', { class: 'ws-brush__id' }, ico, el('div', { class: 'ws-brush__txt' }, name, mode)),
      el('div', { class: 'ws-brush__size' }, el('span', { class: 'ws-brush__ringbox' }, ring), minus, range, plus, val),
      el('span', { class: 'ws-brush__keys' }, el('kbd', { class: 'ws-key', text: '[' }), el('kbd', { class: 'ws-key', text: ']' })),
      close,
    );
    return { el: wrap, ico, name, mode, range, val, ring, size: wrap.querySelector('.ws-brush__size'), keys: wrap.querySelector('.ws-brush__keys') };
  }

  syncBrush() {
    const g = this.game;
    const p = g.activePower;
    const B = this.brush;
    const show = !!p;
    B.el.classList.toggle('is-shown', show);
    if (!p) return;
    const { svg, tint } = powerIcon(p);
    if (B._id !== p.id) {
      B._id = p.id;
      B.ico.innerHTML = svg;
      B.el.style.setProperty('--tint', tint);
      B.name.textContent = p.name;
    }
    const hasBrush = !!p.brush;
    B.el.classList.toggle('has-brush', hasBrush);
    B.mode.textContent = p.mode === 'click' ? (hasBrush ? 'Click to cast · area' : 'Click to cast') : 'Hold to paint';
    if (hasBrush) {
      const min = p.brush.min ?? 1,
        max = p.brush.max ?? 30;
      B.range.min = min;
      B.range.max = max;
      B.range.value = g.brushSize;
      const pct = max > min ? ((g.brushSize - min) / (max - min)) * 100 : 100;
      B.range.style.setProperty('--p', pct + '%');
      B.val.textContent = g.brushSize;
      B.ring.style.setProperty('--s', (0.28 + 0.72 * (pct / 100)).toFixed(3));
    }
  }

  // ------------------------------------------------------------------ tooltip
  queueTip(p, anchor, delay = null) {
    clearTimeout(this._tipTimer);
    const warm = performance.now() - this._tipWarm < 600;
    const d = delay ?? (warm || this.tip.classList.contains('is-shown') ? 0 : 320);
    this._tipTimer = setTimeout(() => this.showTip(p, anchor), d);
    this.game.audio?.play?.('ui-hover', { volume: 0.25 });
  }

  showTip(p, anchor) {
    if (typeof p === 'string') p = getPower(p);
    if (!p) return;
    if (!anchor) anchor = this.tiles.get(p.id);
    const { svg, tint } = powerIcon(p);
    const idx = (p.category === this.cat ? this.order || [] : groupPowers(p.category).flatMap((gr) => gr.list)).indexOf(p);
    const key = idx >= 0 ? slotLabel(idx) : null;
    const grp = groupPowers(p.category).find((gr) => gr.list.includes(p))?.name;
    const cat = CATEGORIES.find((c) => c.id === p.category);
    const brush = p.brush ? `Radius ${p.brush.min ?? 1}–${p.brush.max ?? 30}` : 'Single target';
    const how = p.mode === 'click' ? 'Click to cast' : 'Hold & drag to paint';
    this.tip.style.setProperty('--tint', tint);
    this.tip.innerHTML = `
      <div class="ws-tip__head">
        <span class="ws-tip__ico">${svg}</span>
        <div class="ws-tip__titles">
          <div class="ws-tip__name">${esc(p.name)}</div>
          <div class="ws-tip__cat">${esc(cat?.name || p.category)}${grp ? ` · ${esc(grp)}` : ''} <i></i> ${esc(how)}</div>
        </div>
      </div>
      ${p.description ? `<p class="ws-tip__desc">${esc(p.description)}</p>` : ''}
      <div class="ws-tip__foot">
        <span class="ws-tip__hot">${key ? `${key.startsWith('⇧') ? '<kbd class="ws-key">Shift</kbd>' : ''}<kbd class="ws-key">${esc(key.replace('⇧', ''))}</kbd> Hotkey` : '<span class="ws-tip__muted">No hotkey</span>'}</span>
        <span class="ws-tip__muted">${esc(brush)}</span>
      </div>`;
    this.tip.classList.add('is-shown');
    this._tipFor = p.id;
    this.positionTip(anchor);
  }

  // The card sits beside the dock (left of it, bottom-aligned) so it never
  // covers the land the player is about to target; if there is no room it
  // goes above the dock at its left edge.
  positionTip(anchor) {
    const tip = this.tip;
    const vw = innerWidth;
    const tw = tip.offsetWidth || 280;
    const th = tip.offsetHeight || 120;
    const pr = this.panel.getBoundingClientRect();
    const stackTop = Math.min(pr.top, this.brush.el.classList.contains('is-shown') ? this.brush.el.getBoundingClientRect().top : 1e9);
    let left, top, side;
    if (this.isDrawer()) {
      left = Math.max(10, (vw - tw) / 2);
      top = stackTop - th - 10;
      side = 'none';
    } else if (pr.left - tw - 14 >= 10) {
      left = pr.left - tw - 14;
      top = pr.bottom - th;
      side = 'right';
    } else {
      left = Math.max(10, pr.left);
      top = stackTop - th - 10;
      side = 'down';
    }
    tip.classList.toggle('is-side', side === 'right');
    tip.classList.toggle('no-arrow', side === 'none');
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(Math.max(64, top))}px)`;
    if (anchor && side === 'down') {
      const r = anchor.getBoundingClientRect();
      const ax = r.left + r.width / 2 - left;
      tip.classList.toggle('no-arrow', ax < 16 || ax > tw - 16);
      tip.style.setProperty('--arrow-x', Math.round(ax) + 'px');
    }
  }

  hideTip(instant = false) {
    clearTimeout(this._tipTimer);
    if (this.tip.classList.contains('is-shown')) this._tipWarm = performance.now();
    this.tip.classList.remove('is-shown');
    if (instant) this._tipWarm = 0;
    this._tipFor = null;
  }

  // ------------------------------------------------------------------ drawer (phones)
  isDrawer() {
    return matchMedia('(max-width: 720px), (max-height: 500px)').matches;
  }
  toggleDrawer(open = !this.el.classList.contains('is-open')) {
    this.el.classList.toggle('is-open', open);
    if (open) requestAnimationFrame(() => {
      this.tabEls?.get(this.cat)?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
      this.tabHint?.();
    });
    this.handle.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.game.audio?.play?.(open ? 'ui-open' : 'ui-click', { volume: 0.4 });
  }

  update() {}
}

export { CAT_BLURB };
