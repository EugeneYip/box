import { el, esc } from './dom.js';
import { regionThumb } from './regionThumbs.js';
import { uiIcon } from './icons.js';
import { emblemSvg } from './TopBar.js';
import { PRESETS, PRESET_NAMES, bootNote } from './Panels.js';
import { WORLD_SIZES, EARTH_DEFAULT_SIZE, isWidePreset, sizeForPreset, earthChoices, earthChoice, earthLabel } from '../core/params.js';

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
    this.seed = g.params.seed;
    this.seedEl = el('span', { class: 'ws-title__seed', text: String(this.seed) });
    // the size chips follow the chosen landmass: the World Map offers the whole
    // Earth (2:1) and the regional maps, the other landmasses the square sizes.
    // Picking a landmass of the other shape swaps the chips at once; the world
    // then reloads a single time, with the size picked (or on Begin).
    this.pending = null;
    // Round world (docs/ROUND-WORLD.md): on unless this world was made with it off
    this.wrapOn = g.laws?.worldWrap !== false;
    const wide = isWidePreset(g.params.preset);
    this.curSizeId = wide ? earthChoice(g.params.size, g.params.region)?.id : WORLD_SIZES.find((z) => z.size === g.world.w)?.id;
    this.sizeBox = el('div', { class: 'ws-title__sizes' });
    this.buildSizes(wide, this.curSizeId);
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
          this.sizeBox,
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

  // The size chips (and, for the World Map, the regional maps under their own label).
  buildSizes(wide, selectedId) {
    const list = wide ? earthChoices() : WORLD_SIZES;
    this.sizeList = list;
    this.sizeId = selectedId;
    this.sizeBtns = list.map((z) =>
      el(
        'button',
        {
          class: 'ws-chip ws-chip--size' + (z.id === selectedId ? ' is-on' : ''),
          type: 'button',
          role: 'radio',
          'aria-checked': z.id === selectedId ? 'true' : 'false',
          'data-id': z.id,
          'aria-label': z.region ? `${z.name} regional map, ${z.w} by ${z.h} tiles` : z.h ? `${z.name} world, ${z.w} by ${z.h} tiles` : `${z.name} world, ${z.size} tiles`,
          onclick: () => this.chooseSize(z),
        },
        // a regional map shows its own coastline beside its name
        z.region ? ((t) => (t ? el('img', { class: 'ws-chip__map', src: t.url, alt: '', width: t.w, height: t.h, draggable: 'false' }) : null))(regionThumb(z.region, 30, 20)) : null,
        z.name,
      ),
    );
    const whole = this.sizeBtns.filter((b, k) => !list[k].region);
    const regions = this.sizeBtns.filter((b, k) => list[k].region);
    const rows = [el('div', { class: 'ws-title__label ws-title__label--sub', text: 'World size' }), el('div', { class: 'ws-chips ws-chips--sizes', role: 'radiogroup', 'aria-label': 'World size' }, ...whole)];
    // Round world, as in New World: under the whole-Earth sizes, for them only
    this.wrapRow = null;
    if (wide) {
      this.wrapBtn = el(
        'button',
        {
          class: 'ws-row ws-wraprow' + (this.wrapOn ? ' is-on' : ''),
          type: 'button',
          role: 'switch',
          'aria-checked': this.wrapOn ? 'true' : 'false',
          title: 'Sail across the map’s left and right edges, as ships cross the Atlantic on the real Earth',
          onclick: () => this.toggleWrap(),
        },
        // the same switch row as New World's, not a chip that reads like a size
        el('span', { class: 'ws-row__txt' }, el('span', { class: 'ws-row__label', text: 'Round world' }), el('span', { class: 'ws-row__desc', text: 'Sail across the map’s left and right edges' })),
        el('span', { class: 'ws-switch' }, el('span', { class: 'ws-switch__track' }, el('span', { class: 'ws-switch__knob' }))),
      );
      this.wrapRow = el('div', { class: 'ws-chips ws-chips--wrap', style: 'margin-top:6px' }, this.wrapBtn);
      rows.push(this.wrapRow);
    }
    if (regions.length) rows.push(el('div', { class: 'ws-title__label ws-title__label--sub ws-title__label--regions', text: 'Regional maps' }), el('div', { class: 'ws-chips ws-chips--sizes ws-chips--regions', role: 'radiogroup', 'aria-label': 'Regional maps' }, ...regions));
    this.sizeBox.replaceChildren(...rows);
    this.syncWrap();
  }

  // the Round world switch shows only while a whole-Earth size is picked
  syncWrap() {
    if (!this.wrapRow) return;
    const z = this.sizeList.find((c) => c.id === this.sizeId);
    this.wrapRow.hidden = !!z?.region;
    this.wrapBtn.classList.toggle('is-on', this.wrapOn);
    this.wrapBtn.setAttribute('aria-checked', this.wrapOn ? 'true' : 'false');
  }

  // A whole Earth behind the logo is grown again with the seam open or
  // closed (the land at the edges differs); otherwise the reload carries it.
  toggleWrap() {
    const g = this.game;
    this.wrapOn = !this.wrapOn;
    this.syncWrap();
    if (this.pending || !isWidePreset(g.params.preset) || g.params.region || this.sizeId !== this.curSizeId) return;
    g.setLaw?.('worldWrap', this.wrapOn);
    this.ui.regenerate(g.params.seed, g.params.preset, g.params.civs, { quiet: true, after: () => (this.seedEl.textContent = String((this.seed = g.params.seed))) });
  }

  markSize(id) {
    this.sizeId = id;
    for (const b of this.sizeBtns) {
      b.classList.toggle('is-on', b.dataset.id === id);
      b.setAttribute('aria-checked', b.dataset.id === id ? 'true' : 'false');
    }
    this.syncWrap();
  }

  choosePreset(id) {
    const g = this.game;
    this.presetBtns.forEach((b) => b.classList.toggle('is-on', b.dataset.id === id));
    const cur = g.params.preset || 'continent';
    if (isWidePreset(id) !== isWidePreset(cur)) {
      // into or out of the 2:1 World Map: its sizes show now, with the size mapped
      // the same way New World and the game map it; nothing reloads until a size
      // is picked or Begin is pressed
      if (!this.pending) {
        const size = sizeForPreset(g.params.size ?? g.world.w, cur, id);
        this.buildSizes(isWidePreset(id), isWidePreset(id) ? earthChoice(size)?.id : WORLD_SIZES.find((s) => s.size === size)?.id);
      }
      this.pending = { preset: id };
      this.el.classList.add('is-pending');
      return;
    }
    if (this.pending) {
      // back to the shape of the world behind the logo
      this.pending = null;
      this.el.classList.remove('is-pending');
      this.buildSizes(isWidePreset(cur), this.curSizeId);
    }
    if (id === cur) return;
    this.ui.regenerate(g.params.seed, id, g.params.civs, { quiet: true, after: () => (this.seedEl.textContent = String((this.seed = g.params.seed))) });
  }

  chooseSize(z) {
    this.markSize(z.id);
    if (!this.pending && z.id === this.curSizeId) return;
    this.reload(this.pending?.preset || this.game.params.preset || 'continent', z, false);
  }

  // Reload into a world of another shape or size (the world's dimensions are fixed
  // once built), back to this screen or, from Begin, straight into the world.
  reload(preset, z, intoWorld) {
    const wide = isWidePreset(preset);
    if (!z) z = wide ? earthChoice(EARTH_DEFAULT_SIZE) : WORLD_SIZES.find((s) => s.id === 'medium');
    const q = new URLSearchParams(location.search);
    q.set('seed', this.seed);
    q.set('preset', preset);
    // a regional map is named by ?region= (its size is implied)
    if (z.region) {
      q.set('region', z.region);
      q.delete('size');
    } else {
      q.set('size', z.size);
      q.delete('region');
    }
    // (the whole Earth's Round world switch; regional maps never wrap)
    if (wide && !z.region && !this.wrapOn) q.set('wrap', '0');
    else q.delete('wrap');
    for (const k of ['cam', 'hour', 'ff']) q.delete(k);
    if (intoWorld) q.set('title', '0');
    else q.delete('title');
    const name = PRESET_NAMES[preset] || 'new';
    const text = wide ? earthLabel(z.size, z.region) : preset === (this.game.params.preset || 'continent') ? `Shaping a ${z.name.toLowerCase()} world` : `Seeding ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name} world · ${z.name}`;
    const label = this.ui.veil.querySelector('.ws-veil__label');
    if (label) label.textContent = text;
    bootNote(text);
    this.ui.veil.classList.add('is-shown');
    setTimeout(() => (location.search = q.toString()), 320);
  }

  reroll() {
    const g = this.game;
    const seed = Math.floor(Math.random() * 1e9);
    if (this.pending) {
      // the reload carries it
      this.seed = seed;
      this.seedEl.textContent = String(seed);
      return;
    }
    this.ui.regenerate(seed, g.params.preset, g.params.civs, { quiet: true, after: () => (this.seedEl.textContent = String((this.seed = g.params.seed))) });
  }

  begin() {
    if (!this.active) return;
    if (this.pending) {
      // a landmass of the other shape was picked: build it once, then play
      this.active = false;
      return this.reload(this.pending.preset, this.sizeList.find((z) => z.id === this.sizeId), true);
    }
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
