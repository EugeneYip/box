import { uiIcon } from './icons.js';
import { el, esc, safe, hexCss, fmtNum, clamp } from './dom.js';
import { PRESET_NAMES } from './TopBar.js';
import { SLOT_LABELS } from './Toolbar.js';

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

  open(name) {
    const build = { settings: () => this.settings(), newworld: () => this.newWorld(), help: () => this.help() }[name];
    if (!build) return;
    if (this.card) this.card.remove();
    this.current = name;
    const { title, icon, body, foot, wide } = build();
    const card = el(
      'div',
      { class: `ws-modal ws-glass ws-orn${wide ? ' is-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
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
      ),
      section(
        'World',
        toggleRow('Day & night cycle', 'Let the sun rise and set', !!g.settings?.dayNight, (v) => {
          if (g.settings) g.settings.dayNight = v;
          ui.savePrefs({ dayNight: v });
        }),
        toggleRow('Living weather', 'Rain, storms and snow come and go on their own', g.settings?.autoWeather !== false, (v) => {
          if (g.settings) g.settings.autoWeather = v;
          safe(() => g.atmosphere?.setAutoWeather?.(v), null, 'setAutoWeather');
          ui.savePrefs({ autoWeather: v });
        }),
      ),
      section(
        'Sound',
        rangeRow('Master volume', 0, 100, 1, Math.round((g.audio?.volume ?? 0.8) * 100), (v) => `${v}%`, (v) => {
          safe(() => g.audio?.setVolume?.(v / 100), null, 'setVolume');
          ui.savePrefs({ volume: v / 100 });
        }),
        toggleRow('Mute all sound', null, !!g.audio?.muted, (v) => {
          safe(() => g.audio?.setMuted?.(v), null, 'setMuted');
          ui.savePrefs({ muted: v });
        }),
      ),
      section(
        'Interface',
        toggleRow('Show minimap', null, prefs.minimap !== false, (v) => {
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
    const state = { seed: String(g.params.seed), preset: g.params.preset || 'continent', civs: clamp(g.params.civs ?? 3, 0, 8) };
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
    const create = () => {
      const n = parseInt(String(state.seed).replace(/[^0-9]/g, ''), 10);
      const seed = Number.isFinite(n) ? n : hashSeed(state.seed);
      this.close();
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
      el('p', { class: 'ws-note', html: `${uiIcon('info')}<span>The current world will be replaced. Seeds are shareable — the same seed always grows the same world.</span>` }),
    );
    const foot = [
      el('button', { class: 'ws-btn ws-btn--ghost', type: 'button', text: 'Cancel', onclick: () => this.close() }),
      el('button', { class: 'ws-btn ws-btn--gold', type: 'button', onclick: create }, el('span', { html: uiIcon('new-world') }), el('span', { text: 'Seed this world' })),
    ];
    return { title: 'New World', icon: 'new-world', body, foot, wide: true };
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
  for (const o of civ.kingdoms || []) {
    if (!o || o === k) continue;
    if (safe(() => civ.isAtWar?.(k.id, o.id) || civ.atWar?.(k.id, o.id), false)) wars.add(o.id);
    if (safe(() => civ.isAllied?.(k.id, o.id) || civ.areAllied?.(k.id, o.id), false)) allies.add(o.id);
  }
  for (const w of safe(() => (Array.isArray(civ.wars) ? civ.wars : []), [])) {
    const a = w?.a ?? w?.attacker ?? w?.[0],
      b = w?.b ?? w?.defender ?? w?.[1];
    const ia = a?.id ?? a,
      ib = b?.id ?? b;
    if (ia === k.id && ib != null) wars.add(ib);
    else if (ib === k.id && ia != null) wars.add(ia);
  }
  return { wars: [...wars], allies: [...allies] };
}

export class KingdomsPanel {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = el('aside', { class: 'ws-side ws-glass ws-orn', 'aria-label': 'Kingdoms' });
    this._t = 0;
  }
  get open() {
    return this.el.classList.contains('is-open');
  }
  toggle(force) {
    const open = force ?? !this.open;
    this.el.classList.toggle('is-open', open);
    this.ui.root.classList.toggle('has-side', open);
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
      land = new Map();
    for (const u of safe(() => g.units?.list || [], [])) if (u.alive !== false && u.kingdom != null && u.kingdom >= 0) pop.set(u.kingdom, (pop.get(u.kingdom) || 0) + 1);
    for (const v of safe(() => civ.villages || [], [])) if (v && v.alive !== false && v.kingdom != null) vil.set(v.kingdom, (vil.get(v.kingdom) || 0) + 1);
    const own = g.world.owner;
    for (let i = 0; i < own.length; i++) if (own[i] >= 0) land.set(own[i], (land.get(own[i]) || 0) + 1);
    return ks
      .map((k) => ({
        k,
        id: k.id,
        name: k.name || safe(() => civ.kingdomName(k.id), 'Kingdom'),
        color: hexCss(k.color ?? safe(() => civ.kingdomColor(k.id), 0xe9c77b)),
        pop: k.population ?? pop.get(k.id) ?? 0,
        villages: vil.get(k.id) ?? (Array.isArray(k.villages) ? k.villages.length : 0),
        land: land.get(k.id) || 0,
        rel: relationsOf(civ, k),
      }))
      .sort((a, b) => b.pop - a.pop || b.land - a.land);
  }

  render() {
    const g = this.game;
    const list = this.data();
    const nameOf = (id) => list.find((x) => x.id === id)?.name || safe(() => g.civ.kingdomName(id), 'a rival');
    const colorOf = (id) => list.find((x) => x.id === id)?.color || '#888';
    const totalPop = list.reduce((s, x) => s + x.pop, 0) || 1;
    let html = `<header class="ws-side__head"><span class="ws-modal__ico">${uiIcon('kingdoms')}</span><h2 class="ws-modal__title">Kingdoms</h2><span class="ws-side__count">${list.length}</span><button class="ws-iconbtn ws-iconbtn--sm" type="button" data-act="close" aria-label="Close (K)">${uiIcon('close')}</button></header>`;
    if (!list.length) {
      html += `<div class="ws-empty">
        <div class="ws-empty__art">${uiIcon('crown')}</div>
        <div class="ws-empty__title">No crowns yet</div>
        <p class="ws-empty__txt">Kingdoms rise as villages grow. Found a settlement and watch a realm take shape.</p>
        <button class="ws-btn ws-btn--gold ws-btn--sm" type="button" data-act="found">${uiIcon('house')}<span>Found a village</span></button>
      </div>`;
    } else {
      html += '<div class="ws-side__list">';
      for (const x of list) {
        const share = Math.max(2, (x.pop / totalPop) * 100);
        const rel = [
          ...x.rel.wars.map((id) => `<span class="ws-rel is-war" style="--k:${colorOf(id)}" title="At war">${uiIcon('war')}${esc(nameOf(id))}</span>`),
          ...x.rel.allies.map((id) => `<span class="ws-rel is-ally" style="--k:${colorOf(id)}" title="Allied">${uiIcon('shield')}${esc(nameOf(id))}</span>`),
        ].join('');
        html += `<button class="ws-king" type="button" data-id="${x.id}" style="--k:${x.color}">
          <span class="ws-king__crest"><span>${esc((x.name || '?').replace(/^(the|kingdom of)\s+/i, '')[0] || '?')}</span></span>
          <span class="ws-king__body">
            <span class="ws-king__name">${esc(x.name)}</span>
            <span class="ws-king__stats">
              <span>${uiIcon('population')}${fmtNum(x.pop)}</span>
              <span>${uiIcon('village')}${fmtNum(x.villages)}</span>
              <span>${uiIcon('map')}${fmtNum(x.land)}</span>
            </span>
            <span class="ws-king__bar"><i style="width:${share.toFixed(1)}%"></i></span>
            ${rel ? `<span class="ws-king__rel">${rel}</span>` : '<span class="ws-king__rel ws-king__rel--none">At peace with all</span>'}
          </span>
        </button>`;
      }
      html += '</div>';
    }
    this.el.innerHTML = html;
    this.el.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.act === 'close') return this.toggle(false);
      if (b.dataset.act === 'found') {
        this.ui.toolbar.setCategory('civ');
        g.selectPower('found-village');
        return;
      }
      if (b.dataset.id != null) this.focusKingdom(+b.dataset.id);
    };
  }

  focusKingdom(id) {
    const g = this.game;
    const k = safe(() => g.civ.kingdoms.find((x) => x && x.id === id), null);
    let x = k?.capital?.x ?? k?.x,
      z = k?.capital?.z ?? k?.z;
    if (x == null) {
      const v = safe(() => g.civ.villages.find((v) => v && v.kingdom === id), null);
      x = v?.x;
      z = v?.z;
    }
    if (x == null) {
      // centroid of territory
      const W = g.world;
      let sx = 0,
        sz = 0,
        n = 0;
      for (let i = 0; i < W.owner.length; i += 3) if (W.owner[i] === id) {
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
      this._t = 1.2;
      safe(() => this.render(), null, 'kingdoms render');
    }
  }
}

export { PRESET_NAMES };
