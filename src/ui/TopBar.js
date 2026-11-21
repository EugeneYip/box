import { uiIcon } from './icons.js';
import { el, fmtNum, safe, titleCase } from './dom.js';
import { seasonOf } from './Chronicle.js';
import { earthRegion } from '../world/data/regions.js';

const SEASON_TINT = { Spring: '#9fe08a', Summer: '#ffd36a', Autumn: '#f0a050', Winter: '#bfe0ff' };
const SEASON_GLYPH = { Spring: 'plant-flowers', Summer: 'sun', Autumn: 'clear-flora', Winter: 'weather-snow' };

// The Worldseed emblem: a sprouting seed that is also a tiny globe.
export function emblemSvg(cls = '', id = 'e') {
  return `<svg class="ws-emblem ${cls}" viewBox="0 0 48 48" aria-hidden="true">
  <defs>
    <linearGradient id="wsg-${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff1c8"/><stop offset=".5" stop-color="#ecc673"/><stop offset="1" stop-color="#a6772f"/>
    </linearGradient>
    <radialGradient id="wsr-${id}" cx=".5" cy=".42" r=".6">
      <stop offset="0" stop-color="#f6d58c" stop-opacity=".22"/><stop offset="1" stop-color="#f6d58c" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="24" cy="24" r="22" fill="url(#wsr-${id})"/>
  <circle cx="24" cy="24" r="20.6" fill="none" stroke="url(#wsg-${id})" stroke-width="1.3"/>
  <circle cx="24" cy="24" r="17.2" fill="none" stroke="url(#wsg-${id})" stroke-width=".7" opacity=".55" stroke-dasharray="1.4 2.2"/>
  <path d="M24 2.2l1.6 1.8L24 5.8 22.4 4zM24 42.2l1.6 1.8-1.6 1.8-1.6-1.8zM2.2 24l1.8-1.6L5.8 24 4 25.6zM42.2 24l1.8-1.6 1.8 1.6-1.8 1.6z" fill="url(#wsg-${id})"/>
  <path d="M24 37.5c-5.6 0-9-4-9-9.2 0-5.8 4.4-9.6 9-13.8 4.6 4.2 9 8 9 13.8 0 5.2-3.4 9.2-9 9.2z" fill="url(#wsg-${id})"/>
  <path d="M24 37.4c-2.4-2.6-3.6-5.8-3.6-9.4 0-3.4 1.2-6.6 3.6-9.4M24 37.4c2.4-2.6 3.6-5.8 3.6-9.4 0-3.4-1.2-6.6-3.6-9.4M15.4 27.4h17.2" fill="none" stroke="#2a1d08" stroke-opacity=".42" stroke-width="1"/>
  <path d="M24 14.6V8.8" fill="none" stroke="url(#wsg-${id})" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M24 11.6c-1.2-3.2-4.2-5-7.6-4.6.6 3.4 3.6 5.2 7.6 4.6zM24 10.4c1.2-3 4-4.6 7.2-4.2-.6 3.2-3.4 4.8-7.2 4.2z" fill="url(#wsg-${id})"/>
</svg>`;
}

const DIAL = `<svg class="ws-dial" viewBox="0 0 44 44" aria-hidden="true">
  <defs>
    <linearGradient id="wsDialSky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6fb8f0"/><stop offset=".36" stop-color="#a9d6f4"/>
      <stop offset=".47" stop-color="#ffc98a"/><stop offset=".5" stop-color="#e57a5a"/>
      <stop offset=".53" stop-color="#4b3f7e"/><stop offset=".7" stop-color="#1c2150"/><stop offset="1" stop-color="#090c22"/>
    </linearGradient>
    <radialGradient id="wsDialSun"><stop offset="0" stop-color="#fff6d6"/><stop offset=".45" stop-color="#ffd76a"/><stop offset="1" stop-color="#ffb347" stop-opacity="0"/></radialGradient>
    <clipPath id="wsDialClip"><circle cx="22" cy="22" r="17.6"/></clipPath>
  </defs>
  <g clip-path="url(#wsDialClip)">
    <g class="ws-dial__rot">
      <rect x="2" y="2" width="40" height="40" fill="url(#wsDialSky)"/>
      <circle cx="22" cy="9.6" r="6.2" fill="url(#wsDialSun)"/>
      <circle cx="22" cy="9.6" r="3.1" fill="#fff3c4"/>
      <path d="M24.6 31.2a4.6 4.6 0 1 1-4.2-6.4 3.6 3.6 0 0 0 4.2 6.4z" fill="#e8e6ff"/>
      <circle cx="14" cy="30" r=".7" fill="#fff"/><circle cx="29.5" cy="27" r=".6" fill="#fff"/><circle cx="27" cy="35.5" r=".7" fill="#fff"/><circle cx="16.5" cy="36" r=".5" fill="#fff"/>
    </g>
    <path d="M2 30.5c4-2.6 7.4-3.4 10.6-2.6 2.6.6 4.2-1.6 7.4-1.6 3.6 0 5 2.4 8.4 2.2 3-.2 6.4-2.6 13.6-.6V44H2z" fill="#16241c"/>
    <path d="M2 33.4c5-1.6 9.6-1.4 13.4-.2 3.2 1 6.6-1 10.6-.8 4 .2 7.6 1.8 16 .4V44H2z" fill="#0d1712"/>
  </g>
  <circle cx="22" cy="22" r="17.6" fill="none" stroke="rgba(0,0,0,.5)" stroke-width="1"/>
  <circle cx="22" cy="22" r="19.6" fill="none" stroke="url(#wsg-dial)" stroke-width="1.1"/>
  <defs><linearGradient id="wsg-dial" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe3a6"/><stop offset="1" stop-color="#9c7434"/></linearGradient></defs>
  <path d="M22 .9l2 3.2h-4z" fill="#fbe3a6"/>
</svg>`;

const SPEEDS = [1, 2, 4, 8, 16];
// `wide`: the value may run to five characters ("9,999", "38.4k", "999M": the
// longest fmtNum writes), otherwise three ("999"); each value keeps that room
// so the bar never changes width as the numbers grow
const STAT_DEFS = [
  { key: 'population', label: 'Population', icon: 'population', tint: '#f3d9a6', wide: true },
  { key: 'kingdoms', label: 'Realms', icon: 'crown', tint: '#ffd36a' },
  { key: 'villages', label: 'Villages', icon: 'village', tint: '#9fbcff' },
  { key: 'animals', label: 'Animals', icon: 'paw', tint: '#ffab94', wide: true },
  { key: 'trees', label: 'Trees', icon: 'tree', tint: '#6fdca4', wide: true },
];
export const PRESET_NAMES = { continent: 'Continent', pangaea: 'Pangaea', archipelago: 'Archipelago', islands: 'Islands', earth: 'World Map' };

// short captions for the phone rail (the full name is the long-press tip)
const NAV_CAPTION = { 'World laws': 'Laws', 'World ages': 'Ages', Controls: 'Help', 'New world': 'New' };

export class TopBar {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    const g = this.game;
    this.el = el('div', { class: 'ws-top' });

    // ---- brand plate (left)
    // a long line ends in an ellipsis, the seed giving way before the place ("North America · Seed 42…")
    this.placeEl = el('span', { class: 'ws-brand__place' });
    this.seedEl = el('span', { class: 'ws-brand__seed' });
    this.worldLine = el('span', { class: 'ws-brand__world' }, this.placeEl, this.seedEl);
    this.brand = el(
      'div',
      { class: 'ws-brand ws-glass' },
      (this.brandBtn = el(
        'button',
        { class: 'ws-brand__id', type: 'button', 'aria-label': 'Worldseed menu', 'data-tip': 'New world · G', onclick: () => (this.menuMode() ? this.toggleMenu() : ui.modals.toggle('newworld')) },
        el('span', { class: 'ws-brand__emblem', html: emblemSvg('', 'brand') }),
        el('span', { class: 'ws-brand__txt' }, el('span', { class: 'ws-brand__name', text: 'Worldseed' }), this.worldLine),
      )),
      el('span', { class: 'ws-sep' }),
      el(
        'nav',
        { class: 'ws-nav' },
        this.navBtn('new-world', 'New world', 'G', () => ui.modals.toggle('newworld')),
        (this.kBtn = this.navBtn('kingdoms', 'Realms', 'K', () => ui.kingdoms.toggle())),
        this.navBtn('chronicle', 'Chronicle', 'J', () => ui.chronicle.toggle()),
        this.navBtn('trade', 'World laws', 'L', () => ui.modals.toggle('laws')),
        (() => {
          const b = this.navBtn('eclipse', 'World ages', 'Y', () => ui.modals.toggle('ages'));
          b.classList.add('ws-nav__ages');
          return b;
        })(),
        this.navBtn('settings', 'Settings', 'O', () => ui.modals.toggle('settings')),
        this.navBtn('help', 'Controls', 'H', () => ui.modals.toggle('help')),
      ),
    );

    // ---- clock + speed (centre)
    this.yearEl = el('span', { class: 'ws-clock__year' });
    this.dayEl = el('span', { class: 'ws-clock__day' });
    this.dialEl = el('span', { class: 'ws-clock__dial', html: DIAL });
    this.dialRot = this.dialEl.querySelector('.ws-dial__rot');
    this.pauseBtn = el('button', {
      class: 'ws-speed__pause',
      type: 'button',
      'aria-label': 'Pause (Space)',
      'data-tip': 'Pause · Space',
      onclick: () => {
        g.setPaused(!g.paused);
        g.audio?.play?.('ui-click', { volume: 0.5 });
      },
    });
    this.seg = el('div', { class: 'ws-seg', role: 'radiogroup', 'aria-label': 'Simulation speed' }, el('span', { class: 'ws-seg__thumb' }));
    // a radio group: arrow keys (and Home/End) choose the speed and move the focus
    this.seg.addEventListener('keydown', (e) => {
      const i0 = this.segBtns.indexOf(document.activeElement);
      if (i0 < 0) return;
      const n = SPEEDS.length;
      const k = e.key;
      const i = k === 'ArrowRight' || k === 'ArrowDown' ? (i0 + 1) % n : k === 'ArrowLeft' || k === 'ArrowUp' ? (i0 + n - 1) % n : k === 'Home' ? 0 : k === 'End' ? n - 1 : -1;
      if (i < 0) return;
      e.preventDefault();
      e.stopPropagation();
      g.setSpeed(SPEEDS[i]);
      this.segBtns[i].focus();
    });
    this.segBtns = SPEEDS.map((s, i) => {
      const b = el('button', {
        class: 'ws-seg__btn',
        type: 'button',
        role: 'radio',
        'data-tip': `${s}× speed · ${i + 1}`,
        'aria-label': `${s}× speed`,
        html: `${s}<small>×</small>`,
        onclick: () => {
          g.setSpeed(s);
          g.audio?.play?.('ui-click', { volume: 0.45 });
        },
      });
      this.seg.append(b);
      return b;
    });
    this.effEl = el('span', { class: 'ws-speed__eff', 'data-tip': 'The simulation cannot keep up: actual speed' });
    this.cycleBtn = el('button', {
      class: 'ws-speed__cycle',
      type: 'button',
      'aria-label': 'Change speed',
      'data-tip': 'Change speed · 1–5',
      onclick: () => {
        const i = SPEEDS.indexOf(g.speed);
        g.setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
        g.audio?.play?.('ui-click', { volume: 0.45 });
      },
    });
    this._eff = { t: performance.now(), sim: g.time.total, ema: null };
    this.clock = el(
      'div',
      { class: 'ws-clock ws-glass' },
      (this.timeBox = el(
        'div',
        { class: 'ws-clock__time', 'data-tip': 'Year, season and time of day' },
        this.dialEl,
        el('span', { class: 'ws-clock__txt' }, this.yearEl, this.dayEl, el('span', { class: 'ws-seasonbar' }, (this.seasonBar = el('i')))),
      )),
      el('span', { class: 'ws-sep' }),
      // the actual-speed and power-saver badges ride on the speed control's corner,
      // so showing them never changes the clock's width
      el(
        'div',
        { class: 'ws-speed' },
        this.pauseBtn,
        this.seg,
        this.cycleBtn,
        this.effEl,
        el('span', { class: 'ws-speed__flags' }, (this.leafEl = el('span', { class: 'ws-leaf', 'data-tip': 'Power saver on · 30 fps', html: uiIcon('leaf') }))),
      ),
    );
    this.pausedEl = el('div', { class: 'ws-paused' }, el('span', { class: 'ws-paused__dot' }), 'Time is paused', el('kbd', { class: 'ws-key', text: 'Space' }));
    this.centre = el('div', { class: 'ws-top__centre' }, this.clock, this.pausedEl);

    // ---- stats (right)
    this.statEls = {};
    this.stats = el('div', { class: 'ws-stats ws-glass' });
    for (const d of STAT_DEFS) {
      const v = el('span', { class: 'ws-stat__v' + (d.wide ? ' is-wide' : ''), text: '—' });
      const b = el(
        'button',
        {
          class: 'ws-stat',
          type: 'button',
          // (read at a glance, not a stop on the Tab walk: Realms is in the nav)
          tabindex: '-1',
          style: `--tint:${d.tint}`,
          'data-tip': d.label,
          'aria-label': d.label,
          onclick: () => (d.key === 'kingdoms' || d.key === 'villages' || d.key === 'population' ? ui.kingdoms.toggle(true) : null),
        },
        el('span', { class: 'ws-stat__ico', html: uiIcon(d.icon) }),
        el('span', { class: 'ws-stat__txt' }, v, el('span', { class: 'ws-stat__k', text: d.label })),
      );
      this.stats.append(b);
      this.statEls[d.key] = { b, v, last: null };
    }

    this.el.append(this.brand, this.centre, this.stats);

    this._t = 0;
    this._statT = 0;
    this._lastRot = null;
    this.refreshWorld();
    this.syncSpeed();
    g.events.on('speed', () => this.syncSpeed());
    const leaf = () => this.leafEl.classList.toggle('is-shown', !!g.settings?.powerSaver);
    g.events.on('powersaver', leaf);
    leaf();
    g.events.on('world:regenerated', () => this.refreshWorld());
    addEventListener('resize', () => (this.syncSpeed(), this.brandTip()));
  }

  // Short landscape phones: the nav lives in a menu under the emblem.
  menuMode() {
    return matchMedia('(max-height: 500px) and (min-width: 721px)').matches;
  }
  toggleMenu(open = !this.menu?.classList.contains('is-open')) {
    const ui = this.ui;
    if (!this.menu) {
      const item = (icon, label, fn) =>
        el('button', { class: 'ws-menu__item', type: 'button', onclick: () => (this.toggleMenu(false), fn()) }, el('span', { class: 'ws-menu__ico', html: uiIcon(icon) }), el('span', { text: label }));
      this.menu = el(
        'div',
        { class: 'ws-menu ws-glass', role: 'menu' },
        item('new-world', 'New world', () => ui.modals.open('newworld')),
        item('kingdoms', 'Realms', () => ui.kingdoms.toggle(true)),
        item('chronicle', 'Chronicle', () => ui.chronicle.toggle(true)),
        item('trade', 'World laws', () => ui.modals.open('laws')),
        item('eclipse', 'World ages', () => ui.modals.open('ages')),
        item('settings', 'Settings', () => ui.modals.open('settings')),
        item('help', 'Controls', () => ui.modals.open('help')),
      );
      ui.layer.append(this.menu);
      addEventListener('pointerdown', (e) => {
        if (this.menu.classList.contains('is-open') && !this.menu.contains(e.target) && !this.brand.contains(e.target)) this.toggleMenu(false);
      });
    }
    this.menu.classList.toggle('is-open', open);
    this.game.audio?.play?.('ui-open', { volume: 0.4 });
  }

  navBtn(icon, label, key, fn) {
    // (round 25) a caption under each rail icon (phones in portrait show it)
    return el('button', {
      class: 'ws-iconbtn',
      type: 'button',
      'aria-label': `${label} (${key})`,
      'data-tip': `${label} · ${key}`,
      'data-cap': NAV_CAPTION[label] || label,
      html: uiIcon(icon),
      onclick: () => {
        fn();
        this.game.audio?.play?.('ui-open', { volume: 0.5 });
      },
    });
  }

  refreshWorld() {
    const p = this.game.params;
    // (a regional World Map shows its region: "Japan · Seed 7")
    const preset = (p.preset === 'earth' && p.region && earthRegion(p.region)?.name) || PRESET_NAMES[p.preset] || titleCase(p.preset || 'world');
    this.placeEl.textContent = preset;
    this.seedEl.textContent = ` · Seed ${p.seed}`;
    this._place = `${preset} · Seed ${p.seed}`;
    this.brandTip();
  }

  // the emblem's tip says what it does first (the nav has no New world button,
  // and on short screens the emblem is the menu), then the whole world line
  brandTip() {
    const menu = this.menuMode();
    this.brandBtn.dataset.tip = menu ? `Menu · New world, Realms, World laws, World ages… — ${this._place || ''}` : `Menu · New world (G) — ${this._place || ''}`;
    this.brandBtn.setAttribute('aria-label', menu ? 'Worldseed menu' : 'New world (G)');
  }

  syncSpeed() {
    const g = this.game;
    this.pauseBtn.innerHTML = uiIcon(g.paused ? 'play' : 'pause');
    this.pauseBtn.classList.toggle('is-on', !!g.paused);
    this.pauseBtn.setAttribute('aria-label', g.paused ? 'Resume (Space)' : 'Pause (Space)');
    this.pauseBtn.dataset.tip = g.paused ? 'Resume · Space' : 'Pause · Space';
    const idx = SPEEDS.indexOf(g.speed);
    this.segBtns.forEach((b, i) => {
      b.classList.toggle('is-on', i === idx);
      b.setAttribute('aria-checked', i === idx ? 'true' : 'false');
      // one Tab stop for the whole group (the chosen speed); arrows move within it
      b.tabIndex = i === (idx < 0 ? 0 : idx) ? 0 : -1;
    });
    this.seg.classList.toggle('is-paused', !!g.paused);
    this.seg.style.setProperty('--idx', Math.max(0, idx));
    this.seg.classList.toggle('no-thumb', idx < 0);
    this.cycleBtn.innerHTML = `${g.speed}<small>×</small>`;
    this._eff = { t: performance.now(), sim: g.time.total, ema: null };
    this.effEl.classList.remove('is-shown');
    this.cycleBtn.classList.remove('is-slow');
    this.ui.root.classList.toggle('is-paused', !!g.paused);
  }

  readStats() {
    const g = this.game;
    const s = safe(() => g.stats(), {}, 'stats') || {};
    const civ = g.civ || {};
    const alive = (o) => o && o.alive !== false && o.dead !== true;
    const out = { ...s };
    if (out.kingdoms == null) out.kingdoms = safe(() => (civ.kingdoms || []).filter(alive).length, 0);
    else if (typeof out.kingdoms === 'object') out.kingdoms = out.kingdoms.length ?? 0;
    if (out.villages == null) out.villages = safe(() => (civ.villages || []).filter(alive).length, 0);
    else if (typeof out.villages === 'object') out.villages = out.villages.length ?? 0;
    if (out.population == null) out.population = safe(() => (g.units?.list || []).filter((u) => u.def?.kind === 'humanoid').length, 0);
    return out;
  }

  update(dt) {
    const g = this.game;
    const t = g.time;
    // dial rotates continuously; only touch the DOM when it visibly moves
    const rot = (((t.hour - 12) / 24) * 360).toFixed(1);
    if (rot !== this._lastRot) {
      this._lastRot = rot;
      this.dialRot.setAttribute('transform', `rotate(${rot} 22 22)`);
    }
    this._t -= dt;
    if (this._t <= 0) {
      this._t = 0.25;
      const hh = Math.floor(t.hour);
      const mm = Math.floor((t.hour - hh) * 60);
      const season = t.seasonName || seasonOf(t.year);
      const year = `Year ${Math.floor(t.year) + 1}`;
      const time = `${String(hh).padStart(2, '0')}:${String(Math.floor(mm / 5) * 5).padStart(2, '0')}`;
      const yKey = `${year}|${time}`;
      if (this._yKey !== yKey) {
        this._yKey = yKey;
        this.yearEl.innerHTML = `<span class="ws-clock__yr">${year}</span><span class="ws-clock__tod">${time}</span>`;
      }
      const len = t.seasonYears || this.game.laws?.weatherSeasonLength || 1;
      const frac = (((t.season ?? 0) % 1) + 1) % 1;
      // years until the next season (a world begins part-way through spring, so
      // "7 / 12 yrs" in year 1 read as if years had passed; this reads true at any time)
      const left = Math.max(1, Math.ceil((1 - frac) * len - 1e-6));
      const next = ['Spring', 'Summer', 'Autumn', 'Winter'][(Math.floor(t.season ?? 0) + 1) % 4];
      const key = `${season}|${time}|${left}|${innerWidth}x${innerHeight}`;
      if (this._dayKey !== key) {
        this._dayKey = key;
        const fixed = this.game.laws?.weatherSeasons === false;
        const epoch = !fixed && len >= 1.5;
        // one phrasing at every width, "Spring · 6 yrs to Summer"; a narrow bar
        // shortens only the unit ("6y to Summer"), then shows the season's glyph
        // (its name kept for screen readers); the tip says it in full
        const paint = (txt, iconOnly, s = season) => {
          this.dayEl.innerHTML = `<i class="ws-season" style="--season:${SEASON_TINT[s]}">${uiIcon(SEASON_GLYPH[s] || 'sun')}</i><span class="ws-season__name${iconOnly ? ' ws-sr' : ''}">${s}</span><span class="ws-clock__epoch">${txt}</span>`;
          const ep = this.dayEl.lastElementChild;
          return ep.scrollWidth <= ep.clientWidth + 1;
        };
        // tiers: 0 "Spring 6 yrs to Summer", 2 glyph + "6 yrs to Summer", 3 glyph +
        // "6y to Summer"; a bar that shows the season's name always says "yrs"
        // (the name, not the unit, gives way first), and the name's fixed slot
        // is the gap before the years (no separator dot to strand in it)
        const word = (tier, n, nx) => (tier !== 3 ? (n === '1' ? `1 yr to ${nx}` : `${n} yrs to ${nx}`) : `${n}y to ${nx}`);
        if (!epoch) paint(time, false);
        else {
          // one wording per window width: the tier is chosen once, against the
          // longest line any season can show under the Season length law
          // ("Winter · 12 yrs to Summer"), so it never flips as the years count down
          const digits = '0'.repeat(String(Math.max(1, Math.ceil(len))).length);
          const fitKey = `${innerWidth}x${innerHeight}|${digits}|${document.fonts?.status || ''}`;
          if (this._fitKey !== fitKey) {
            const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
            // the name's slot is as wide as the widest season name, so the years
            // follow it at one place with no wide gap
            this.dayEl.style.setProperty('--season-w', '0px');
            const nameW = Math.max(
              ...SEASONS.map((s) => {
                paint('', false, s);
                return this.dayEl.querySelector('.ws-season__name')?.scrollWidth || 0;
              }),
            );
            if (nameW > 0) this.dayEl.style.setProperty('--season-w', `${Math.ceil(nameW)}px`);
            const pick = [0, 2, 3].find((tier) => SEASONS.every((s) => SEASONS.every((nx) => paint(word(tier, digits, nx), tier >= 2, s))));
            this._fitPick = pick ?? 3;
            // (measured only once the bar is laid out: a hidden bar fits anything)
            this._fitKey = this.dayEl.clientWidth > 0 ? fitKey : null;
          }
          paint(word(this._fitPick, String(left), next), this._fitPick >= 2);
        }
        this.dayEl.style.setProperty('--season', SEASON_TINT[season]);
        this.timeBox.dataset.tip = fixed
          ? `Seasons are paused by World Law · ${time}`
          : `${season}, ${left <= 1 ? `${next} comes next year` : `${left} years until ${next}`}. The Season length law sets how many years each season lasts (now ${Math.round(len)}). Time of day ${time}.`;
      }
      this.seasonBar.style.width = `${(frac * 100).toFixed(1)}%`;
      this.seasonBar.style.background = SEASON_TINT[season];
    }
    // effective speed: game seconds advanced per real second
    const E = this._eff;
    const now = performance.now();
    if (g.paused || this.ui.root.classList.contains('is-intro')) {
      E.t = now;
      E.sim = t.total;
    } else if (now - E.t > 1000) {
      const eff = (t.total - E.sim) / ((now - E.t) / 1000);
      E.ema = E.ema == null ? eff : E.ema * 0.5 + eff * 0.5;
      E.t = now;
      E.sim = t.total;
      // only a real shortfall shows (under 70% of the chosen speed), as plain text;
      // a crawl reads "under 0.1×", never "0×"
      const slow = E.ema < g.speed * 0.7;
      this.effEl.classList.toggle('is-shown', slow);
      this.cycleBtn.classList.toggle('is-slow', slow);
      this.cycleBtn.setAttribute('aria-label', slow ? 'Change speed (the world is running slower than chosen)' : 'Change speed');
      if (slow) {
        const v = E.ema < 0.1 ? null : E.ema < 9.95 ? E.ema.toFixed(1).replace(/\.0$/, '') : Math.round(E.ema);
        this.effEl.textContent = v == null ? 'Actual speed under 0.1×' : `Actual speed ${v}×`;
        // (round 25) a slower speed is suggested only when there is one: at the
        // lowest speed the tip points to Power saver alone
        const lower = SPEEDS.filter((x) => x < g.speed && x <= Math.max(1, E.ema * 1.2)).pop() ?? SPEEDS.find((x) => x < g.speed) ?? null;
        const runs = v == null ? 'barely moves (under 0.1×)' : `runs at about ${v}×`;
        this.effEl.dataset.tip = lower != null ? `Your device can't keep up with ${g.speed}×, so the world ${runs}. Try ${lower}×, or Power saver in Settings.` : `Your device can't keep up with ${g.speed}×, so the world ${runs}. Try Power saver in Settings.`;
        this.cycleBtn.dataset.tip = lower != null ? `Running slower than chosen · try ${lower}×` : 'Running slower than chosen · try Power saver';
      } else if (this.cycleBtn.dataset.tip !== 'Change speed · 1–5') {
        this.cycleBtn.dataset.tip = 'Change speed · 1–5';
      }
    }
    this._statT -= dt;
    if (this._statT <= 0) {
      this._statT = 0.5;
      const s = this.readStats();
      for (const d of STAT_DEFS) {
        const S = this.statEls[d.key];
        const val = s[d.key];
        if (val === S.last) continue;
        const txt = val == null ? '—' : fmtNum(val);
        if (S.v.textContent !== txt) {
          S.v.textContent = txt;
          if (S.last != null) {
            S.b.classList.remove('is-bump');
            void S.b.offsetWidth;
            S.b.classList.add('is-bump');
          }
        }
        S.last = val;
      }
    }
  }
}
