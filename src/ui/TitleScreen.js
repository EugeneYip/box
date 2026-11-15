import { el, esc } from './dom.js';
import { uiIcon } from './icons.js';
import { emblemSvg } from './TopBar.js';
import { PRESETS, PRESET_NAMES, bootNote } from './Panels.js';
import { WORLD_SIZES, isWidePreset, sizeForPreset, earthChoices, earthChoice, earthLabel } from '../core/params.js';

// Title screen over the live world. The camera slowly orbits while the
// player picks a landmass; choosing one re-seeds the world behind the logo.
export class TitleScreen {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    const g = this.game;
    this.active = true;
    this.t = 0;
    const word = 'WORLDSEED';
    const letters = [...word].map((c, i) => `<span class="ws-logo__l" style="--d:${(0.35 + i * 0.075).toFixed(3)}s">${c}</span>`).join('');
    this.presetBtns = PRESETS.map((p) =>
      el(
        'button',
        {
          class: 'ws-chip' + (p.id === (g.params.preset || 'continent') ? ' is-on' : ''),
          type: 'button',
          'data-id': p.id,
          'aria-label': `${p.name}: ${p.blurb}`,
          onclick: () => this.choosePreset(p.id),
        },
        p.name,
      ),
    );
    this.seedEl = el('span', { class: 'ws-title__seed', text: String(g.params.seed) });
    // the World Map offers its own sizes: the whole Earth (2:1) and the regional maps
    const wide = isWidePreset(g.params.preset);
    const sizeList = wide ? earthChoices() : WORLD_SIZES;
    this.sizeId = wide ? earthChoice(g.params.size, g.params.region)?.id : WORLD_SIZES.find((z) => z.size === g.world.w)?.id;
    this.sizeBtns = sizeList.map((z) =>
      el(
        'button',
        {
          class: 'ws-chip ws-chip--size' + (z.id === this.sizeId ? ' is-on' : ''),
          type: 'button',
          'data-id': z.id,
          'aria-label': z.region ? `${z.name} regional map, ${z.w} by ${z.h} tiles` : z.h ? `${z.name} world, ${z.w} by ${z.h} tiles` : `${z.name} world, ${z.size} tiles`,
          onclick: () => this.chooseSize(z),
        },
        z.name,
      ),
    );
    // (one wrapping group, the regional maps after a thin divider, so the card
    // stays short enough for a 720-pixel-high screen)
    const regionBtns = this.sizeBtns.filter((b, k) => sizeList[k].region);
    const divider = regionBtns.length ? [el('span', { 'aria-hidden': 'true', style: 'align-self:center;width:1px;height:18px;margin:0 4px;background:rgba(255,240,210,0.25)' })] : [];
    const sizeRows = [el('div', { class: 'ws-chips ws-chips--sizes', role: 'radiogroup', 'aria-label': regionBtns.length ? 'World size or regional map' : 'World size' }, ...this.sizeBtns.filter((b, k) => !sizeList[k].region), ...divider, ...regionBtns)];
    this.el = el(
      'div',
      { class: 'ws-title', role: 'dialog', 'aria-label': 'Worldseed' },
      el('div', { class: 'ws-title__shade' }),
      el(
        'div',
        { class: 'ws-title__center' },
        el('div', { class: 'ws-title__emblem', html: emblemSvg('', 'title') }),
        el('h1', { class: 'ws-logo', 'aria-label': 'Worldseed', html: `<span class="ws-logo__word">${letters}</span><span class="ws-logo__sheen" aria-hidden="true">${esc(word)}</span>` }),
        el('div', { class: 'ws-title__rule' }, el('i'), el('b'), el('i')),
        el('p', { class: 'ws-title__tag', text: 'Shape a living world' }),
        el(
          'div',
          { class: 'ws-title__card ws-glass ws-orn' },
          el('div', { class: 'ws-title__label', text: 'Choose your landmass' }),
          el('div', { class: 'ws-chips', role: 'radiogroup' }, ...this.presetBtns),
          el('div', { class: 'ws-title__label ws-title__label--sub', text: 'World size' }),
          ...sizeRows,
          el(
            'div',
            { class: 'ws-title__seedrow' },
            el('span', { class: 'ws-title__seedlbl', text: 'Seed' }),
            this.seedEl,
            el('button', { class: 'ws-iconbtn ws-iconbtn--sm', type: 'button', 'aria-label': 'Reroll world', 'data-tip': 'Reroll world', html: uiIcon('dice'), onclick: () => this.reroll() }),
          ),
          el('button', { class: 'ws-btn ws-btn--gold ws-btn--xl ws-title__begin', type: 'button', onclick: () => this.begin() }, el('span', { text: 'Begin' })),
          el(
            'div',
            { class: 'ws-title__links' },
            el('button', { class: 'ws-link', type: 'button', onclick: () => ui.modals.open('help'), html: `${uiIcon('keyboard')}<span>Controls</span>` }),
            el('span', { class: 'ws-title__dot' }),
            el('button', { class: 'ws-link', type: 'button', onclick: () => ui.modals.open('settings'), html: `${uiIcon('settings')}<span>Settings</span>` }),
          ),
          el('div', { class: 'ws-title__hint', html: `Press <kbd class="ws-key">Enter</kbd> to begin` }),
        ),
      ),
      // keyboard hint inside the card's flow, so it can never overlap the card
    );
    ui.root.append(this.el);
    requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.add('is-in')));

    // cinematic framing behind the logo
    const rig = g.cameraRig;
    if (!g.params.cam) rig.set(g.world.w / 2, g.world.h / 2, rig.maxDist * 0.6, 24, null);
    this._yaw = rig.goal.yaw;
  }

  choosePreset(id) {
    const g = this.game;
    this.presetBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.id === id));
    if (id === g.params.preset) return;
    const from = g.params.preset || 'continent';
    if (isWidePreset(id) !== isWidePreset(from)) {
      // into or out of the 2:1 World Map: reload in its shape, keeping the seed,
      // with the size mapped the same way New World and the game map it
      const size = sizeForPreset(g.params.size ?? g.world.w, from, id);
      const z = WORLD_SIZES.find((s) => s.size === size);
      const q = new URLSearchParams(location.search);
      q.set('preset', id);
      q.set('seed', g.params.seed);
      q.set('size', size);
      for (const k of ['cam', 'hour', 'ff', 'title', 'region']) q.delete(k);
      const label = isWidePreset(id) ? earthLabel(size) : `Seeding ${/^[aeiou]/i.test(PRESET_NAMES[id] || '') ? 'an' : 'a'} ${PRESET_NAMES[id] || 'new'} world${z ? ` · ${z.name}` : ''}`;
      bootNote(label);
      const vl = this.ui.veil.querySelector('.ws-veil__label');
      if (vl) vl.textContent = label;
      this.ui.veil.classList.add('is-shown');
      setTimeout(() => (location.search = q.toString()), 320);
      return;
    }
    this.ui.regenerate(g.params.seed, id, g.params.civs, { quiet: true, after: () => (this.seedEl.textContent = String(g.params.seed)) });
  }

  chooseSize(z) {
    const g = this.game;
    this.sizeBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.id === z.id));
    if (z.id === this.sizeId) return;
    const q = new URLSearchParams(location.search);
    q.set('seed', g.params.seed);
    q.set('preset', g.params.preset || 'continent');
    // a regional map is named by ?region= (its size is implied)
    if (z.region) {
      q.set('region', z.region);
      q.delete('size');
    } else {
      q.set('size', z.size);
      q.delete('region');
    }
    for (const k of ['cam', 'hour', 'ff', 'title']) q.delete(k);
    const label = this.ui.veil.querySelector('.ws-veil__label');
    const text = isWidePreset(g.params.preset) ? earthLabel(z.size, z.region) : `Shaping a ${z.name.toLowerCase()} world`;
    if (label) label.textContent = text;
    bootNote(text);
    this.ui.veil.classList.add('is-shown');
    setTimeout(() => (location.search = q.toString()), 320);
  }

  reroll() {
    const g = this.game;
    const seed = Math.floor(Math.random() * 1e9);
    this.ui.regenerate(seed, g.params.preset, g.params.civs, { quiet: true, after: () => (this.seedEl.textContent = String(g.params.seed)) });
  }

  begin() {
    if (!this.active) return;
    this.active = false;
    const g = this.game;
    this.el.classList.add('is-leaving');
    this.ui.reveal();
    const rig = g.cameraRig;
    rig.goal.dist = rig.maxDist * 0.5;
    g.audio?.play?.('ui-open', { volume: 0.8 });
    g.audio?.play?.('magic', { volume: 0.4 });
    setTimeout(() => this.el.remove(), 1400);
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const rig = this.game.cameraRig;
    rig.follow = null;
    rig.goal.yaw += dt * 0.05;
    rig.goal.dist += (rig.maxDist * (0.6 + Math.sin(this.t * 0.12) * 0.03) - rig.goal.dist) * Math.min(1, dt * 0.5);
  }
}
