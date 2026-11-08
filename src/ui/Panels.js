import { uiIcon } from './icons.js';
import { el, esc, safe, hexCss, fmtNum, clamp } from './dom.js';
import { PRESET_NAMES } from './TopBar.js';
import { SLOT_LABELS } from './Toolbar.js';
import { LAWS, LAW_CATEGORIES, lawDef } from '../core/laws.js';
import { agesPanel } from './Ages.js';
import { techPanel } from './TechPanel.js';
import { eraNames, traitDef } from './depth.js';
import { WORLD_SIZES } from '../core/params.js';

const SIZE_NOTES = {
  128: 'Quick and intimate. Lightest on phones.',
  192: 'Cosy. The default on phones and tablets.',
  256: 'The classic balance of land and sea.',
  384: 'Room for many rival realms.',
  512: 'Epic scale. Best on desktop.',
};
const LAW_ICON = {
  harmony: 'alliance',
  diplomacy: 'make-peace',
  civilization: 'found-kingdom',
  creatures: 'spawn-human',
  beasts: 'spawn-wolf',
  spawning: 'sparkle',
  trees: 'plant-tree',
  plants: 'plant-flowers',
  fungi: 'plant-mushroom',
  biomes: 'paint-grass',
  weather: 'weather-rain',
  calamities: 'fire',
  ages: 'eclipse',
  others: 'settings',
  peoples: 'banner',
  life: 'paw',
  nature: 'tree',
  sky: 'sun',
  calamity: 'disaster',
};
const fmtLaw = (def, v) => (def.type === 'bool' ? (v ? 'On' : 'Off') : `×${(+v).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}`);

// ---------------------------------------------------------------- shared bits
export const PRESETS = [
  { id: 'continent', name: 'Continent', blurb: 'One great land, ringed by isles' },
  { id: 'pangaea', name: 'Pangaea', blurb: 'A single vast supercontinent' },
  { id: 'archipelago', name: 'Archipelago', blurb: 'Chains of scattered islands' },
  { id: 'islands', name: 'Islands', blurb: 'A few lonely island realms' },
];
const LAND = {
  continent:
    '<path d="M18 12c6-5 17-6 26-3 8 3 13 2 17 7 4 6 1 12-3 16-5 5-13 4-19 7-7 3-14 1-18-4-5-6-9-15-3-23z"/><path d="M8 38c2-2 5-2 6 0s-1 4-3 4-4-2-3-4zM63 8c2-1 4 0 4 2s-2 3-4 2-1-3 0-4z"/>',
  pangaea:
    '<path d="M9 14c4-7 15-9 24-7 6 1 10-2 17-1 10 2 15 8 14 16-1 6-6 9-6 14 0 5-6 7-12 6-6-1-9 3-16 2-8-1-11-5-15-9-6-6-10-13-6-21z"/>',
  archipelago:
    '<path d="M8 33c2-3 6-3 8-1s0 5-3 5-6-1-5-4zM19 25c2-3 6-3 7 0 1 2-1 5-4 4-2 0-4-2-3-4zM29 31c1-2 4-3 6-1 2 1 1 4-1 5-3 1-6-1-5-4zM35 19c2-3 7-3 8 0 1 2-2 5-5 4s-4-2-3-4zM46 25c2-2 5-2 6 0 1 3-2 5-4 5s-3-3-2-5zM52 13c2-3 6-2 7 0 1 3-2 5-4 5s-4-2-3-5zM61 22c2-1 4 0 4 2s-2 3-4 3-2-3 0-5z"/>',
  islands:
    '<path d="M9 15c3-5 10-6 13-2 3 3 1 9-3 10-5 2-12-2-10-8zM42 9c4-3 11-2 13 2s-1 9-6 9-10-6-7-11zM14 34c3-4 9-4 12-1 3 4 0 8-5 8-4 0-9-3-7-7zM46 31c3-3 9-3 12 0 3 4 1 9-4 9-6 1-11-4-8-9z"/>',
};
export function presetThumb(id) {
  return `<svg class="ws-thumb" viewBox="0 0 72 48" aria-hidden="true">
    <defs><radialGradient id="wst-${id}" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#2f8fb8"/><stop offset="1" stop-color="#123e66"/></radialGradient></defs>
    <rect width="72" height="48" rx="6" fill="url(#wst-${id})"/>
    <g fill="#e6d29a" stroke="#e6d29a" stroke-width="2.2" stroke-linejoin="round">${LAND[id] || LAND.continent}</g>
    <g fill="#5ea84a">${LAND[id] || LAND.continent}</g>
    <rect width="72" height="48" rx="6" fill="none" stroke="rgba(255,240,200,.18)"/>
  </svg>`;
}

function toggleRow(label, desc, value, onChange) {
  const input = el('input', { type: 'checkbox', class: 'ws-switch__in', role: 'switch' });
  input.checked = !!value;
  input.addEventListener('change', () => onChange(input.checked));
  return el(
    'label',
    { class: 'ws-row' },
    el('span', { class: 'ws-row__txt' }, el('span', { class: 'ws-row__label', text: label }), desc ? el('span', { class: 'ws-row__desc', text: desc }) : null),
    el('span', { class: 'ws-switch' }, input, el('span', { class: 'ws-switch__track' }, el('span', { class: 'ws-switch__knob' }))),
  );
}
function segRow(label, desc, options, value, onChange) {
  const seg = el('div', { class: 'ws-pills', role: 'radiogroup', 'aria-label': label });
  for (const o of options) {
    const b = el('button', {
      class: 'ws-pill' + (o.id === value ? ' is-on' : ''),
      type: 'button',
      role: 'radio',
      'aria-checked': o.id === value ? 'true' : 'false',
      text: o.name,
      onclick: () => {
        seg.querySelectorAll('.ws-pill').forEach((x) => {
          x.classList.toggle('is-on', x === b);
          x.setAttribute('aria-checked', x === b ? 'true' : 'false');
        });
        onChange(o.id);
      },
    });
    seg.append(b);
  }
  return el('div', { class: 'ws-row ws-row--stack' }, el('span', { class: 'ws-row__txt' }, el('span', { class: 'ws-row__label', text: label }), desc ? el('span', { class: 'ws-row__desc', text: desc }) : null), seg);
}
function rangeRow(label, min, max, step, value, fmt, onChange) {
  const out = el('output', { class: 'ws-row__val', text: fmt(value) });
  const r = el('input', { type: 'range', class: 'ws-range', min, max, step, value });
  const paint = () => r.style.setProperty('--p', ((r.value - min) / (max - min)) * 100 + '%');
  paint();
  r.addEventListener('input', () => {
    paint();
    out.textContent = fmt(+r.value);
    onChange(+r.value);
  });
  return el('div', { class: 'ws-row' }, el('span', { class: 'ws-row__txt' }, el('span', { class: 'ws-row__label', text: label })), el('span', { class: 'ws-row__ctl' }, r, out));
}
const section = (title, ...rows) => el('section', { class: 'ws-sect' }, el('h4', { class: 'ws-sect__h', text: title }), ...rows);

// ---------------------------------------------------------------- modal manager
export class Modals {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.current = null;
    this.layer = el('div', { class: 'ws-modals' });
    this.scrim = el('div', { class: 'ws-scrim', onclick: () => this.close() });
    this.layer.append(this.scrim);
  }

  toggle(name) {
    if (this.current === name) this.close();
    else this.open(name);
  }

  open(name, opts = {}) {
    this.lawBack = name === 'laws' ? opts.back || null : this.lawBack;
    if (name === 'tech') this.techKingdom = opts.kingdom ?? this.techKingdom;
    const build = {
      settings: () => this.settings(),
      newworld: () => this.newWorld(),
      help: () => this.help(),
      laws: () => this.laws(),
      ages: () => agesPanel(this.ui),
      tech: () => techPanel(this.ui, this.techKingdom),
    }[name];
    if (!build) return;
    if (this.card) this.card.remove();
    this.current = name;
    const { title, icon, body, foot, wide } = build();
    const card = el(
      'div',
      { class: `ws-modal ws-glass ws-orn${wide ? ' is-wide' : ''}${wide === 'xl' ? ' is-xl' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      el(
        'header',
        { class: 'ws-modal__head' },
        el('span', { class: 'ws-modal__ico', html: uiIcon(icon) }),
        el('h2', { class: 'ws-modal__title', text: title }),
        el('button', { class: 'ws-iconbtn ws-iconbtn--sm', type: 'button', 'aria-label': 'Close (Esc)', html: uiIcon('close'), onclick: () => this.close() }),
      ),
      el('div', { class: 'ws-modal__body' }, body),
      foot ? el('footer', { class: 'ws-modal__foot' }, foot) : null,
    );
    this.card = card;
    this.layer.append(card);
    this.ui.root.classList.add('has-modal');
    requestAnimationFrame(() => card.classList.add('is-open'));
    this.layer.classList.add('is-open');
    this.game.audio?.play?.('ui-open', { volume: 0.5 });
    const first = card.querySelector('[autofocus]');
    if (first) setTimeout(() => first.focus(), 60);
  }

  close() {
    if (!this.current) return;
    const card = this.card;
    this.current = null;
    this.card = null;
    this.layer.classList.remove('is-open');
    this.ui.root.classList.remove('has-modal');
    if (card) {
      card.classList.remove('is-open');
      card.classList.add('is-closing');
      setTimeout(() => card.remove(), 260);
    }
  }

  // ---- settings
  settings() {
    const g = this.game;
    const ui = this.ui;
    const prefs = ui.prefs;
    const q = g.pipeline?.quality || 'high';
    const canQ = typeof g.pipeline?.setQuality === 'function';
    const body = el(
      'div',
      { class: 'ws-settings' },
      section(
        'Graphics',
        segRow(
          'Render quality',
          canQ ? 'Shadows, ambient occlusion and resolution' : 'Saved — the renderer applies it on next launch',
          [
            { id: 'low', name: 'Low' },
            { id: 'medium', name: 'Medium' },
            { id: 'high', name: 'High' },
            { id: 'ultra', name: 'Ultra' },
          ],
          q,
          (v) => {
            safe(() => g.pipeline.setQuality?.(v), null, 'setQuality');
            ui.savePrefs({ quality: v });
          },
        ),
        toggleRow('Frosted glass', 'Blur the world behind panels', ui.blurOn(), (v) => {
          ui.savePrefs({ blur: v });
          ui.applyPrefs();
        }),
        toggleRow('Power saver', 'Smoother battery life: 30 fps, lighter effects', !!g.settings?.powerSaver, (v) => {
          safe(() => g.setPowerSaver?.(v), null, 'setPowerSaver');
          ui.savePrefs({ powerSaver: v });
        }),
        segRow(
          'Frame rate cap',
          'Limit how often the world is drawn',
          [
            { id: 0, name: 'Off' },
            { id: 30, name: '30 fps' },
            { id: 60, name: '60 fps' },
          ],
          g.settings?.fpsCap || 0,
          (v) => {
            if (g.settings) g.settings.fpsCap = v;
            ui.savePrefs({ fpsCap: v });
          },
        ),
      ),
      section(
        'World',
        el(
          'div',
          { class: 'ws-row' },
          el('span', { class: 'ws-row__txt' }, el('span', { class: 'ws-row__label', text: 'World laws' }), el('span', { class: 'ws-row__desc', text: `Wars, wildlife, disasters, day length… ${this.lawsChanged() ? `(${this.lawsChanged()} changed)` : ''}` })),
          el('button', { class: 'ws-btn ws-btn--sm', type: 'button', onclick: () => this.open('laws', { back: 'settings' }), html: `${uiIcon('trade')}<span>Open</span>` }),
        ),
      ),
      section(
        'Sound',
        rangeRow('Master volume', 0, 100, 1, Math.round((g.audio?.volume ?? 0.8) * 100), (v) => `${v}%`, (v) => {
          safe(() => g.audio?.setVolume?.(v / 100), null, 'setVolume');
          ui.savePrefs({ volume: v / 100 });
        }),
        ...['music', 'ambience', 'sfx'].map((bus) =>
          rangeRow(
            { music: 'Music', ambience: 'Ambience', sfx: 'Effects' }[bus],
            0,
            100,
            1,
            Math.round((safe(() => g.audio?.getBusVolume?.(bus), null) ?? prefs.buses?.[bus] ?? 1) * 100),
            (v) => `${v}%`,
            (v) => {
              safe(() => g.audio?.setBusVolume?.(bus, v / 100), null, 'setBusVolume');
              ui.savePrefs({ buses: { ...(ui.prefs.buses || {}), [bus]: v / 100 } });
            },
          ),
        ),
        toggleRow('Mute all sound', null, !!g.audio?.muted, (v) => {
          safe(() => g.audio?.setMuted?.(v), null, 'setMuted');
          ui.savePrefs({ muted: v });
        }),
      ),
      section(
        'Interface',
        toggleRow('Show minimap', 'Overview (M) frames the whole world instead', prefs.minimap === true, (v) => {
          ui.savePrefs({ minimap: v });
          ui.applyPrefs();
        }),
        toggleRow('Show chronicle', 'World events in the top-left corner', prefs.feed !== false, (v) => {
          ui.savePrefs({ feed: v });
          ui.applyPrefs();
        }),
      ),
    );
    return { title: 'Settings', icon: 'settings', body };
  }

  // ---- new world
  newWorld() {
    const g = this.game;
    const state = this.nwState && this.reopenNW ? this.nwState : { seed: String(g.params.seed), preset: g.params.preset || 'continent', civs: clamp(g.params.civs ?? 3, 0, 8), size: g.world.w };
    this.reopenNW = false;
    const seedIn = el('input', { class: 'ws-input', type: 'text', inputmode: 'numeric', value: state.seed, 'aria-label': 'World seed', autofocus: true, spellcheck: 'false' });
    seedIn.addEventListener('input', () => (state.seed = seedIn.value));
    seedIn.addEventListener('keydown', (e) => e.key === 'Enter' && create());
    const dice = el('button', {
      class: 'ws-iconbtn',
      type: 'button',
      'aria-label': 'Random seed',
      'data-tip': 'Random seed',
      html: uiIcon('dice'),
      onclick: () => {
        state.seed = String(Math.floor(Math.random() * 1e9));
        seedIn.value = state.seed;
        dice.classList.remove('is-roll');
        void dice.offsetWidth;
        dice.classList.add('is-roll');
      },
    });
    const cards = el('div', { class: 'ws-presets', role: 'radiogroup', 'aria-label': 'Landmass' });
    for (const p of PRESETS) {
      const c = el(
        'button',
        {
          class: 'ws-preset' + (p.id === state.preset ? ' is-on' : ''),
          type: 'button',
          role: 'radio',
          'aria-checked': p.id === state.preset ? 'true' : 'false',
          onclick: () => {
            state.preset = p.id;
            cards.querySelectorAll('.ws-preset').forEach((x) => x.classList.toggle('is-on', x === c));
          },
        },
        el('span', { class: 'ws-preset__thumb', html: presetThumb(p.id) }),
        el('span', { class: 'ws-preset__name', text: p.name }),
        el('span', { class: 'ws-preset__blurb', text: p.blurb }),
      );
      cards.append(c);
    }
    const civOut = el('output', { class: 'ws-row__val', text: String(state.civs) });
    const civ = el('input', { type: 'range', class: 'ws-range', min: 0, max: 8, step: 1, value: state.civs, 'aria-label': 'Starting villages' });
    const paint = () => civ.style.setProperty('--p', (civ.value / 8) * 100 + '%');
    paint();
    civ.addEventListener('input', () => {
      state.civs = +civ.value;
      civOut.textContent = civ.value;
      paint();
    });
    const sizeNote = el('span', { class: 'ws-row__desc ws-size__note' });
    const sizeCards = el('div', { class: 'ws-sizes', role: 'radiogroup', 'aria-label': 'World size' });
    const pickSize = (v) => {
      state.size = v;
      sizeCards.querySelectorAll('.ws-size').forEach((b) => b.classList.toggle('is-on', +b.dataset.size === v));
      sizeNote.textContent = SIZE_NOTES[v] || `${v} × ${v} tiles`;
    };
    for (const z of WORLD_SIZES) {
      sizeCards.append(
        el(
          'button',
          { class: 'ws-size', type: 'button', role: 'radio', 'data-size': z.size, onclick: () => pickSize(z.size) },
          el('span', { class: 'ws-size__box', style: `--s:${(0.42 + 0.58 * (z.size / 512)).toFixed(3)}` }, el('i')),
          el('b', { text: z.name }),
          el('small', { text: `${z.size}²` }),
        ),
      );
    }
    pickSize(WORLD_SIZES.some((z) => z.size === state.size) ? state.size : 256);
    const sizes = el('div', { class: 'ws-field' }, el('label', { class: 'ws-field__label', text: 'World size' }), sizeCards, sizeNote);
    this.nwState = state;
    const create = () => {
      const n = parseInt(String(state.seed).replace(/[^0-9]/g, ''), 10);
      const seed = Number.isFinite(n) ? n : hashSeed(state.seed);
      this.close();
      if (state.size !== g.world.w) {
        // world size is fixed at construction: reload with the new parameters
        const q = new URLSearchParams(location.search);
        q.set('seed', seed);
        q.set('preset', state.preset);
        q.set('civs', state.civs);
        q.set('size', state.size);
        q.set('title', '0');
        q.delete('cam');
        this.ui.veil.classList.add('is-shown');
        setTimeout(() => (location.search = q.toString()), 300);
        return;
      }
      this.ui.regenerate(seed, state.preset, state.civs);
    };
    const body = el(
      'div',
      { class: 'ws-newworld' },
      el('div', { class: 'ws-field' }, el('label', { class: 'ws-field__label', text: 'Landmass' }), cards),
      el(
        'div',
        { class: 'ws-field-row' },
        el('div', { class: 'ws-field' }, el('label', { class: 'ws-field__label', text: 'Seed' }), el('div', { class: 'ws-seedbox' }, seedIn, dice)),
        el('div', { class: 'ws-field' }, el('label', { class: 'ws-field__label', text: 'Starting villages' }), el('div', { class: 'ws-row__ctl' }, civ, civOut)),
      ),
      sizes,
      el(
        'div',
        { class: 'ws-row ws-rules' },
        el('span', { class: 'ws-row__txt' }, el('span', { class: 'ws-row__label', text: 'World rules' }), el('span', { class: 'ws-row__desc', text: this.lawsChanged() ? `${this.lawsChanged()} laws differ from the defaults` : 'All laws at their defaults' })),
        el('button', { class: 'ws-btn ws-btn--sm', type: 'button', onclick: () => this.open('laws', { back: 'newworld' }), html: `${uiIcon('trade')}<span>World rules…</span>` }),
      ),
      el('p', { class: 'ws-note', html: `${uiIcon('info')}<span>The current world will be replaced. Seeds are shareable — the same seed always grows the same world.</span>` }),
    );
    const foot = [
      el('button', { class: 'ws-btn ws-btn--ghost', type: 'button', text: 'Cancel', onclick: () => this.close() }),
      el('button', { class: 'ws-btn ws-btn--gold', type: 'button', onclick: create }, el('span', { html: uiIcon('new-world') }), el('span', { text: 'Seed this world' })),
    ];
    return { title: 'New World', icon: 'new-world', body, foot, wide: true };
  }

  lawsChanged() {
    const L = this.game.laws || {};
    return LAWS.filter((l) => L[l.key] != null && L[l.key] !== l.default).length;
  }

  // ---- world laws: search, category rail, sectioned list (built once, filtered in place)
  laws() {
    const g = this.game;
    const back = this.lawBack;
    const ctl = new Map();
    const rows = [];
    const sections = new Map();
    const railBtns = new Map();
    const rail = el('nav', { class: 'ws-lawrail', role: 'tablist', 'aria-label': 'Law categories' });
    const list = el('div', { class: 'ws-lawlist' });
    const none = el('div', { class: 'ws-empty ws-lawnone', hidden: true }, el('div', { class: 'ws-empty__art', html: uiIcon('inspect') }), el('div', { class: 'ws-empty__title', text: 'No laws match' }), el('p', { class: 'ws-empty__txt', text: 'Try another word, such as “fire”, “war” or “snow”.' }));
    const isChanged = (def) => (g.laws?.[def.key] ?? def.default) !== def.default;
    const changedIn = (cid) => LAWS.filter((l) => l.category === cid && isChanged(l)).length;
    const countEl = el('span', { class: 'ws-lawsx__count' });
    const syncCounts = () => {
      for (const [cid, b] of railBtns) b.classList.toggle('has-changes', changedIn(cid) > 0);
      const n = LAWS.filter(isChanged).length;
      countEl.textContent = n ? `${n} changed` : 'All at defaults';
      countEl.classList.toggle('is-changed', n > 0);
    };
    const scrollToCat = (cid) => {
      const sec = sections.get(cid);
      if (!sec) return;
      list.scrollTo({ top: sec.offsetTop - list.offsetTop - 4, behavior: 'smooth' });
      setActive(cid);
    };
    const setActive = (cid) => {
      this.lawCat = cid;
      for (const [id, b] of railBtns) {
        b.classList.toggle('is-on', id === cid);
        if (id === cid) b.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
    };
    for (const c of LAW_CATEGORIES) {
      const defs = LAWS.filter((l) => l.category === c.id);
      if (!defs.length) continue;
      const b = el('button', { class: 'ws-lawrail__btn', type: 'button', role: 'tab', onclick: () => scrollToCat(c.id) }, el('span', { class: 'ws-lawrail__ico', html: uiIcon(LAW_ICON[c.id] || 'settings') }), el('span', { class: 'ws-lawrail__name', text: c.name }), el('i', { class: 'ws-lawrail__dot' }));
      railBtns.set(c.id, b);
      rail.append(b);
      const sec = el('section', { class: 'ws-lawsec', 'data-cat': c.id }, el('header', { class: 'ws-lawsec__head' }, el('span', { class: 'ws-lawsec__ico', html: uiIcon(LAW_ICON[c.id] || 'settings') }), el('div', null, el('h4', { class: 'ws-lawsec__name', text: c.name }), c.blurb ? el('p', { class: 'ws-lawsec__blurb', text: c.blurb }) : null)));
      sections.set(c.id, sec);
      for (const def of defs) {
        const v = g.laws?.[def.key] ?? def.default;
        let control;
        if (def.type === 'bool') {
          const input = el('input', { type: 'checkbox', class: 'ws-switch__in', role: 'switch', 'aria-label': def.label });
          input.checked = !!v;
          input.addEventListener('change', () => g.setLaw?.(def.key, input.checked));
          control = el('span', { class: 'ws-switch' }, input, el('span', { class: 'ws-switch__track' }, el('span', { class: 'ws-switch__knob' })));
          ctl.set(def.key, (nv) => (input.checked = !!nv));
        } else {
          const out = el('output', { class: 'ws-row__val', text: fmtLaw(def, v) });
          const r = el('input', { type: 'range', class: 'ws-range', min: def.min, max: def.max, step: def.step || 0.25, value: v, 'aria-label': def.label });
          const paint = () => r.style.setProperty('--p', ((r.value - def.min) / (def.max - def.min)) * 100 + '%');
          paint();
          r.addEventListener('input', () => {
            paint();
            out.textContent = fmtLaw(def, +r.value);
            g.setLaw?.(def.key, +r.value);
          });
          control = el('span', { class: 'ws-row__ctl' }, r, out);
          ctl.set(def.key, (nv) => {
            r.value = nv;
            paint();
            out.textContent = fmtLaw(def, nv);
          });
        }
        const row = el(def.type === 'bool' ? 'label' : 'div', { class: 'ws-law' + (isChanged(def) ? ' is-changed' : ''), 'data-key': def.key }, el('span', { class: 'ws-law__txt' }, el('span', { class: 'ws-row__label', text: def.label }), el('span', { class: 'ws-row__desc', text: def.description })), control);
        rows.push({ row, def, sec, hay: `${def.label} ${def.description} ${c.name} ${def.key}`.toLowerCase() });
        sec.append(row);
      }
      list.append(sec);
    }
    list.append(none);
    // scroll spy keeps the rail in step with the list
    list.addEventListener(
      'scroll',
      () => {
        if (this._lawSearch) return;
        let cur = null;
        for (const [cid, sec] of sections) if (!sec.hidden && sec.offsetTop - list.offsetTop <= list.scrollTop + 24) cur = cid;
        if (cur && cur !== this.lawCat) setActive(cur);
      },
      { passive: true },
    );
    const search = el('input', { class: 'ws-input ws-lawsx__search', type: 'search', placeholder: 'Search laws…', 'aria-label': 'Search laws', spellcheck: 'false' });
    search.addEventListener('input', () => {
      const q = search.value.trim().toLowerCase();
      this._lawSearch = q;
      for (const r of rows) r.row.hidden = !!q && !q.split(/\s+/).every((w) => r.hay.includes(w));
      let any = false;
      for (const [cid, sec] of sections) {
        const vis = [...sec.querySelectorAll('.ws-law')].some((x) => !x.hidden);
        sec.hidden = !vis;
        railBtns.get(cid)?.classList.toggle('is-empty', !vis);
        any = any || vis;
      }
      none.hidden = any;
      list.scrollTop = 0;
    });
    setActive(this.lawCat && sections.has(this.lawCat) ? this.lawCat : LAW_CATEGORIES[0].id);
    syncCounts();
    requestAnimationFrame(() => this.lawCat && sections.get(this.lawCat) && (list.scrollTop = sections.get(this.lawCat).offsetTop - list.offsetTop - 4));
    const off = g.events.on('laws', ({ key } = {}) => {
      if (!this.card || this.current !== 'laws') return off?.();
      const keys = key == null ? LAWS.map((l) => l.key) : [key];
      for (const k of keys) {
        const def = lawDef(k);
        if (!def) continue;
        ctl.get(k)?.(g.laws?.[k] ?? def.default);
        list.querySelector(`[data-key="${k}"]`)?.classList.toggle('is-changed', isChanged(def));
      }
      syncCounts();
    });
    const body = el(
      'div',
      { class: 'ws-lawsx' },
      el('div', { class: 'ws-lawsx__top' }, el('label', { class: 'ws-lawsx__searchbox' }, el('span', { html: uiIcon('inspect') }), search), countEl),
      el('div', { class: 'ws-lawsx__main' }, rail, list),
    );
    const foot = [
      back ? el('button', { class: 'ws-btn ws-btn--ghost', type: 'button', html: `${uiIcon('chev-left')}<span>Back</span>`, onclick: () => ((this.reopenNW = back === 'newworld'), this.open(back)) }) : null,
      el('span', { class: 'ws-foot__grow' }),
      el('button', {
        class: 'ws-btn ws-btn--ghost',
        type: 'button',
        text: 'Restore defaults',
        onclick: () => g.resetLaws?.(),
      }),
      el('button', { class: 'ws-btn ws-btn--gold', type: 'button', text: 'Done', onclick: () => (back ? ((this.reopenNW = back === 'newworld'), this.open(back)) : this.close()) }),
    ];
    return { title: 'World Laws', icon: 'trade', body, foot, wide: 'xl' };
  }

  // ---- help
  help() {
    const k = (...keys) => keys.map((x) => `<kbd class="ws-key">${esc(x)}</kbd>`).join('');
    const rows = [
      ['Camera', [
        [k('Right drag'), 'Pan the view'],
        [k('Left drag'), 'Pan (no power selected)'],
        [k('W', 'A', 'S', 'D'), 'Pan with keys'],
        [k('Wheel') + ' ' + k('+', '−'), 'Zoom toward cursor'],
        [k('Q', 'E') + ' ' + k('Alt') + '+drag', 'Rotate'],
        [k('F'), 'Follow inspected creature'],
      ]],
      ['Powers', [
        [k('Click'), 'Cast / hold to paint'],
        [k(SLOT_LABELS[0], SLOT_LABELS[1], SLOT_LABELS[2], '…'), 'Powers in the open tab'],
        [k('Shift') + '+' + k(SLOT_LABELS[0], '…'), 'More powers in the tab'],
        [k('Tab'), 'Next power category'],
        [k('[', ']'), 'Brush size'],
        [k('I'), 'Inspect tool'],
        [k('Esc'), 'Put power away / close'],
      ]],
      ['Time', [
        [k('Space'), 'Pause / resume'],
        [k('1', '2', '3', '4', '5'), 'Speed 1× – 16×'],
      ]],
      ['Panels', [
        [k('K'), 'Kingdoms'],
        [k('J'), 'Chronicle'],
        [k('L'), 'World laws'],
        [k('Y'), 'World ages'],
        [k('M'), 'Overview of the whole world'],
        [k('`'), 'Fold power tray'],
        [k('G'), 'New world'],
        [k('O'), 'Settings'],
        [k('H'), 'This help'],
        [k('U'), 'Hide interface'],
      ]],
    ];
    const body = el('div', { class: 'ws-help' });
    for (const [title, list] of rows) {
      body.append(
        el(
          'section',
          { class: 'ws-sect' },
          el('h4', { class: 'ws-sect__h', text: title }),
          el('div', { class: 'ws-help__list', html: list.map(([keys, what]) => `<div class="ws-help__row"><span class="ws-help__keys">${keys}</span><span class="ws-help__what">${esc(what)}</span></div>`).join('') }),
        ),
      );
    }
    body.append(el('p', { class: 'ws-note ws-help__tip', html: `${uiIcon('sparkle')}<span>Click anything in the world with no power selected to inspect it. Click a chronicle entry to fly there.</span>` }));
    return { title: 'Controls', icon: 'keyboard', body, wide: true };
  }
}

function hashSeed(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) % 1e9;
}

// ---------------------------------------------------------------- kingdoms panel
function idsOf(v) {
  if (v == null) return [];
  if (v instanceof Set || v instanceof Map) return [...(v instanceof Map ? v.keys() : v)];
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' ? x.id : x));
  if (typeof v === 'object') return Object.keys(v).filter((key) => v[key]).map((x) => (isNaN(+x) ? x : +x));
  return [];
}
export function relationsOf(civ, k) {
  const wars = new Set(idsOf(k.wars ?? k.enemies ?? k.atWarWith));
  const allies = new Set(idsOf(k.allies ?? k.alliances ?? k.friends));
  for (const id of safe(() => civ.enemiesOf?.(k.id) || [], [])) wars.add(id?.id ?? id);
  for (const o of civ.kingdoms || []) {
    if (!o || o === k || o.alive === false) continue;
    if (safe(() => civ.isAtWar?.(k.id, o.id) || civ.atWar?.(k.id, o.id), false)) wars.add(o.id);
    if (safe(() => civ.isAllied?.(k.id, o.id) || civ.allied?.(k.id, o.id) || civ.areAllied?.(k.id, o.id), false)) allies.add(o.id);
  }
  for (const w of safe(() => (Array.isArray(civ.wars) ? civ.wars : []), [])) {
    const a = w?.a ?? w?.attacker ?? w?.[0],
      b = w?.b ?? w?.defender ?? w?.[1];
    const ia = a?.id ?? a,
      ib = b?.id ?? b;
    if (ia === k.id && ib != null) wars.add(ib);
    else if (ib === k.id && ia != null) wars.add(ia);
  }
  const alive = (id) => civ.kingdoms?.[id]?.alive !== false;
  return { wars: [...wars].filter(alive), allies: [...allies].filter((id) => alive(id) && !wars.has(id)) };
}

export class KingdomsPanel {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = el('aside', { class: 'ws-side ws-glass ws-orn', 'aria-label': 'Kingdoms' });
    this.countEl = el('span', { class: 'ws-side__count', text: '0' });
    this.list = el('div', { class: 'ws-side__list' });
    this.empty = el(
      'div',
      { class: 'ws-empty' },
      el('div', { class: 'ws-empty__art', html: uiIcon('crown') }),
      el('div', { class: 'ws-empty__title', text: 'No crowns yet' }),
      el('p', { class: 'ws-empty__txt', text: 'Kingdoms rise as villages grow. Found a settlement and watch a realm take shape.' }),
      el('button', {
        class: 'ws-btn ws-btn--gold ws-btn--sm',
        type: 'button',
        html: `${uiIcon('house')}<span>Found a village</span>`,
        onclick: () => {
          this.ui.toolbar.setCategory('civ');
          this.game.selectPower('found-village');
        },
      }),
    );
    this.el.append(
      el(
        'header',
        { class: 'ws-side__head' },
        el('span', { class: 'ws-modal__ico', html: uiIcon('kingdoms') }),
        el('h2', { class: 'ws-modal__title', text: 'Kingdoms' }),
        this.countEl,
        el('button', { class: 'ws-iconbtn ws-iconbtn--sm', type: 'button', 'aria-label': 'Close (K)', html: uiIcon('close'), onclick: () => this.toggle(false) }),
      ),
      this.list,
      this.empty,
    );
    this.rows = new Map();
    this._t = 0;
  }
  get open() {
    return this.el.classList.contains('is-open');
  }
  toggle(force) {
    const open = force ?? !this.open;
    if (open && this.ui.chronicle?.open) this.ui.chronicle.toggle(false);
    this.el.classList.toggle('is-open', open);
    this.ui.root.classList.toggle('has-side', open || !!this.ui.chronicle?.open);
    if (open) {
      this._t = 0;
      this.render();
    }
  }

  data() {
    const g = this.game;
    const civ = g.civ || {};
    const ks = safe(() => (civ.kingdoms || []).filter((k) => k && k.alive !== false && k.dead !== true), []);
    const pop = new Map(),
      vil = new Map(),
      land = new Map(),
      army = new Map();
    for (const u of safe(() => g.units?.list || [], [])) {
      if (u.alive === false || u.kingdom == null || u.kingdom < 0) continue;
      pop.set(u.kingdom, (pop.get(u.kingdom) || 0) + 1);
      if (u.job === 'soldier') army.set(u.kingdom, (army.get(u.kingdom) || 0) + 1);
    }
    for (const v of safe(() => civ.villages || [], [])) if (v && v.alive !== false && v.kingdom != null) vil.set(v.kingdom, (vil.get(v.kingdom) || 0) + 1);
    const own = g.world.owner;
    for (let i = 0; i < own.length; i++) if (own[i] >= 0) land.set(own[i], (land.get(own[i]) || 0) + 1);
    return ks
      .map((k) => {
        const capV = safe(() => civ.villages?.[k.capital], null);
        return {
          k,
          id: k.id,
          name: k.name || safe(() => civ.kingdomName(k.id), 'Kingdom'),
          color: hexCss(k.color ?? safe(() => civ.kingdomColor(k.id), 0xe9c77b)),
          ruler: safe(() => civ.rulerLabel?.(k), null) || k.rulerName || '—',
          capital: capV?.name || '—',
          pop: k.population ?? pop.get(k.id) ?? 0,
          villages: Array.isArray(k.villages) ? k.villages.length : vil.get(k.id) ?? 0,
          army: k.soldiers ?? army.get(k.id) ?? 0,
          land: land.get(k.id) || 0,
          rel: relationsOf(civ, k),
        };
      })
      .sort((a, b) => b.pop - a.pop || b.land - a.land);
  }

  makeRow(x) {
    const stat = (label, icon) => {
      const v = el('b', { text: '—' });
      return { box: el('span', { class: 'ws-king__stat' }, el('span', { class: 'ws-king__sl', html: `${uiIcon(icon)}${label}` }), v), v };
    };
    const S = { pop: stat('People', 'population'), villages: stat('Villages', 'village'), army: stat('Army', 'job-soldier'), land: stat('Land', 'map') };
    const R = {
      el: el('button', { class: 'ws-king', type: 'button', onclick: () => this.focusKingdom(x.id) }),
      crest: el('span', { class: 'ws-king__crest' }, el('span')),
      name: el('span', { class: 'ws-king__name' }),
      era: el('span', { class: 'ws-era ws-era--sm' }),
      tech: el('span', {
        class: 'ws-king__tech',
        role: 'button',
        tabindex: '0',
        'aria-label': 'Technology',
        'data-tip': 'Technology',
        html: uiIcon('chronicle'),
        onclick: (e) => {
          e.stopPropagation();
          this.ui.modals.open('tech', { kingdom: x.id });
        },
      }),
      ruler: el('b'),
      capital: el('b'),
      bar: el('i'),
      rel: el('span', { class: 'ws-king__rel' }),
      S,
      sig: {},
    };
    R.el.append(
      R.crest,
      el(
        'span',
        { class: 'ws-king__body' },
        el('span', { class: 'ws-king__line' }, R.name, R.era, R.tech),
        el('span', { class: 'ws-king__court' }, el('span', null, el('small', { text: 'Ruler' }), R.ruler), el('span', null, el('small', { text: 'Capital' }), R.capital)),
        el('span', { class: 'ws-king__stats' }, S.pop.box, S.villages.box, S.army.box, S.land.box),
        el('span', { class: 'ws-king__bar' }, R.bar),
        R.rel,
      ),
    );
    return R;
  }

  render() {
    const g = this.game;
    const list = this.data();
    const nameOf = (id) => list.find((x) => x.id === id)?.name || safe(() => g.civ.kingdomName(id), 'a rival');
    const colorOf = (id) => list.find((x) => x.id === id)?.color || '#888';
    const totalPop = list.reduce((s, x) => s + x.pop, 0) || 1;
    this.countEl.textContent = String(list.length);
    this.empty.hidden = list.length > 0;
    this.list.hidden = !list.length;
    const seen = new Set();
    let prev = null;
    for (const x of list) {
      seen.add(x.id);
      let R = this.rows.get(x.id);
      if (!R) this.rows.set(x.id, (R = this.makeRow(x)));
      const set = (node, key, val) => {
        if (R.sig[key] !== val) {
          R.sig[key] = val;
          node.textContent = val;
        }
      };
      if (R.sig.color !== x.color) {
        R.sig.color = x.color;
        R.el.style.setProperty('--k', x.color);
      }
      set(R.name, 'name', x.name);
      const era = Math.max(0, Math.min(3, safe(() => this.game.civ?.kingdomEra?.(x.id), null) ?? x.k.era ?? 0));
      if (R.sig.era !== era) {
        R.sig.era = era;
        R.era.className = `ws-era ws-era--sm is-era${era}`;
        R.era.textContent = eraNames()[era] || '';
      }
      set(R.crest.firstChild, 'crest', (x.name || '?').replace(/^(the|kingdom of)\s+/i, '')[0] || '?');
      set(R.ruler, 'ruler', x.ruler);
      set(R.capital, 'capital', x.capital);
      set(R.S.pop.v, 'pop', fmtNum(x.pop));
      set(R.S.villages.v, 'vil', fmtNum(x.villages));
      set(R.S.army.v, 'army', fmtNum(x.army));
      set(R.S.land.v, 'land', fmtNum(x.land));
      const share = Math.max(2, (x.pop / totalPop) * 100).toFixed(1) + '%';
      if (R.sig.share !== share) R.bar.style.width = R.sig.share = share;
      const relKey = JSON.stringify(x.rel);
      if (R.sig.rel !== relKey) {
        R.sig.rel = relKey;
        const chips = [
          ...x.rel.wars.map((id) => `<span class="ws-rel is-war" style="--k:${colorOf(id)}">${uiIcon('war')}<small>War</small>${esc(nameOf(id))}</span>`),
          ...x.rel.allies.map((id) => `<span class="ws-rel is-ally" style="--k:${colorOf(id)}">${uiIcon('alliance')}<small>Ally</small>${esc(nameOf(id))}</span>`),
        ].join('');
        R.rel.innerHTML = chips || '<span class="ws-king__peace">At peace with all realms</span>';
      }
      // keep population order without rebuilding
      const want = prev ? prev.nextSibling : this.list.firstChild;
      if (want !== R.el) this.list.insertBefore(R.el, want);
      prev = R.el;
    }
    for (const [id, R] of this.rows)
      if (!seen.has(id)) {
        R.el.remove();
        this.rows.delete(id);
      }
  }

  focusKingdom(id) {
    const g = this.game;
    const k = safe(() => g.civ.kingdoms.find((x) => x && x.id === id), null);
    const capV = safe(() => g.civ.villages?.[k?.capital], null);
    let x = capV?.x ?? capV?.cx,
      z = capV?.z ?? capV?.cz;
    if (x == null) {
      const v = safe(() => g.civ.villages.find((v) => v && v.kingdom === id && v.alive !== false), null);
      x = v?.x ?? v?.cx;
      z = v?.z ?? v?.cz;
    }
    if (x == null) {
      const W = g.world;
      let sx = 0,
        sz = 0,
        n = 0;
      for (let i = 0; i < W.owner.length; i += 3)
        if (W.owner[i] === id) {
          sx += i % W.w;
          sz += Math.floor(i / W.w);
          n++;
        }
      if (n) {
        x = sx / n + 0.5;
        z = sz / n + 0.5;
      }
    }
    if (x != null) {
      g.cameraRig.follow = null;
      g.focus(x, z, Math.min(g.cameraRig.goal.dist, 70));
      g.audio?.play?.('ui-click', { volume: 0.45 });
    }
  }

  update(dt) {
    if (!this.open) return;
    this._t -= dt;
    if (this._t <= 0) {
      this._t = 1;
      safe(() => this.render(), null, 'kingdoms render');
    }
  }
}

export { PRESET_NAMES };
