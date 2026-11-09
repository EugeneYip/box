import { el, esc } from './dom.js';
import { uiIcon } from './icons.js';
import { emblemSvg } from './TopBar.js';
import { PRESETS } from './Panels.js';
import { WORLD_SIZES } from '../core/params.js';

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
    this.sizeBtns = WORLD_SIZES.map((z) =>
      el(
        'button',
        {
          class: 'ws-chip ws-chip--size' + (z.size === g.world.w ? ' is-on' : ''),
          type: 'button',
          'data-size': z.size,
          'aria-label': `${z.name} world, ${z.size} tiles`,
          onclick: () => this.chooseSize(z),
        },
        z.name,
      ),
    );
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
          el('div', { class: 'ws-chips ws-chips--sizes', role: 'radiogroup' }, ...this.sizeBtns),
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
        ),
      ),
      el('div', { class: 'ws-title__foot', html: `Press <kbd class="ws-key">Enter</kbd> to begin` }),
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
    this.ui.regenerate(g.params.seed, id, g.params.civs, { quiet: true, after: () => (this.seedEl.textContent = String(g.params.seed)) });
  }

  chooseSize(z) {
    const g = this.game;
    this.sizeBtns.forEach((b) => b.classList.toggle('is-on', +b.dataset.size === z.size));
    if (z.size === g.world.w) return;
    const q = new URLSearchParams(location.search);
    q.set('seed', g.params.seed);
    q.set('preset', g.params.preset || 'continent');
    q.set('size', z.size);
    for (const k of ['cam', 'hour', 'ff', 'title']) q.delete(k);
    const label = this.ui.veil.querySelector('.ws-veil__label');
    if (label) label.textContent = `Shaping a ${z.name.toLowerCase()} world`;
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
