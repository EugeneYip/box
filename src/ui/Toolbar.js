import { CATEGORIES, listPowers, getPower } from '../powers/registry.js';
import { powerIcon, categoryIcon, uiIcon, CATEGORY_TINT } from './icons.js';
import { el, esc } from './dom.js';

// Power slots in the active category are bound to the bottom letter row.
export const SLOT_CODES = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'];
export const SLOT_LABELS = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/'];

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
    this.panel.append(this.handle, el('div', { class: 'ws-dock__body' }, this.tabsEl, this.gridEl));
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

  setCategory(id, { quiet = false } = {}) {
    if (!CATEGORIES.find((c) => c.id === id)) return;
    if (this.cat === id) return;
    this.cat = id;
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
  buildGrid(animate = false) {
    const grid = this.gridEl;
    grid.innerHTML = '';
    this.tiles.clear();
    const list = listPowers(this.cat);
    grid.style.setProperty('--n', list.length);
    list.forEach((p, i) => {
      const { svg, tint } = powerIcon(p);
      const key = SLOT_LABELS[i];
      const b = el(
        'button',
        {
          class: 'ws-pw',
          type: 'button',
          style: `--tint:${tint};--i:${i}`,
          'data-id': p.id,
          'aria-label': p.name + (key ? ` (${key})` : ''),
          onclick: () => this.pick(p),
          onpointerenter: (e) => {
            if (e.pointerType !== 'touch') this.queueTip(p, b);
          },
          onpointerleave: () => this.hideTip(),
          onfocus: () => this.queueTip(p, b, 0),
          onblur: () => this.hideTip(),
        },
        el('span', { class: 'ws-pw__ico', html: svg }),
        key ? el('span', { class: 'ws-pw__key', text: key }) : null,
      );
      grid.append(b);
      this.tiles.set(p.id, b);
    });
    if (!list.length) grid.append(el('div', { class: 'ws-powers__empty', text: 'No powers here yet' }));
    if (animate) {
      grid.classList.remove('is-swap');
      void grid.offsetWidth;
      grid.classList.add('is-swap');
    }
    this.handleCat?.();
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
    const p = listPowers(this.cat)[i];
    if (p) this.pick(p);
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
    const idx = listPowers(p.category).indexOf(p);
    const key = p.category === this.cat ? SLOT_LABELS[idx] : null;
    const cat = CATEGORIES.find((c) => c.id === p.category);
    const brush = p.brush ? `Radius ${p.brush.min ?? 1}–${p.brush.max ?? 30}` : 'Single target';
    const how = p.mode === 'click' ? 'Click to cast' : 'Hold & drag to paint';
    this.tip.style.setProperty('--tint', tint);
    this.tip.innerHTML = `
      <div class="ws-tip__head">
        <span class="ws-tip__ico">${svg}</span>
        <div class="ws-tip__titles">
          <div class="ws-tip__name">${esc(p.name)}</div>
          <div class="ws-tip__cat">${esc(cat?.name || p.category)} <i></i> ${esc(how)}</div>
        </div>
      </div>
      ${p.description ? `<p class="ws-tip__desc">${esc(p.description)}</p>` : ''}
      <div class="ws-tip__foot">
        <span>${key ? `<kbd class="ws-key">${esc(key)}</kbd> Hotkey` : '<span class="ws-tip__muted">No hotkey</span>'}</span>
        <span class="ws-tip__muted">${esc(brush)}</span>
      </div>`;
    this.tip.classList.add('is-shown');
    this._tipFor = p.id;
    this.positionTip(anchor);
  }

  positionTip(anchor) {
    const tip = this.tip;
    const vw = innerWidth;
    const tw = tip.offsetWidth || 280;
    const th = tip.offsetHeight || 120;
    let cx = vw / 2,
      top = innerHeight - 260;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      cx = r.left + r.width / 2;
      const stackTop = Math.min(this.panel.getBoundingClientRect().top, this.brush.el.classList.contains('is-shown') ? this.brush.el.getBoundingClientRect().top : 1e9);
      top = stackTop - th - 12;
      if (top < 64) top = r.bottom + 10;
    }
    const left = Math.max(10, Math.min(vw - tw - 10, cx - tw / 2));
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    tip.style.setProperty('--arrow-x', Math.round(cx - left) + 'px');
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
    return matchMedia('(max-width: 720px)').matches;
  }
  toggleDrawer(open = !this.el.classList.contains('is-open')) {
    this.el.classList.toggle('is-open', open);
    this.handle.setAttribute('aria-expanded', open ? 'true' : 'false');
    this.game.audio?.play?.(open ? 'ui-open' : 'ui-click', { volume: 0.4 });
  }

  update() {}
}

export { CAT_BLURB };
