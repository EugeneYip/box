import '@fontsource/cinzel/700.css';
import './hud2.css';
import './hud3.css';
import './hud4.css';
import { CATEGORIES, listPowers, getPower } from '../powers/registry.js';
import { el, safe } from './dom.js';
import { TopBar, PRESET_NAMES } from './TopBar.js';
import { Toolbar, SLOT_CODES } from './Toolbar.js';
import { Minimap } from './Minimap.js';
import { Inspector } from './Inspector.js';
import { Feed } from './Feed.js';
import { Modals, KingdomsPanel } from './Panels.js';
import { TitleScreen } from './TitleScreen.js';
import { ChroniclePanel } from './Chronicle.js';
import { Onboarding } from './Onboarding.js';
import { CameraPad } from './CameraPad.js';
import { AgeChip, AgeBanner } from './Ages.js';
import { loadRegistries } from './depth.js';
import { uiIcon } from './icons.js';

const PREF_KEY = 'worldseed.ui.v1';

// Worldseed HUD ("obsidian glass" over the living diorama).
//   top-left  brand plate + menu      top-centre  day dial, year, speed
//   top-right live world stats        left        chronicle / kingdoms
//   right     inspector               bottom      god-powers dock, minimap
// Everything is hidden with ?ui=0; ?title=0 skips the title screen.
// Debug / tooling hooks: game.ui.debugShowTooltip(id), game.ui.debugHover(x,y),
// game.ui.open('settings'|'newworld'|'help'|'kingdoms'), game.ui.setCategory(id),
// game.ui.inspectAt(x,z), game.ui.begin().
export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui-root');
    this.enabled = !!game.params.ui && !!this.root;
    if (!this.enabled) {
      if (this.root) this.root.style.display = 'none';
      return;
    }
    this.prefs = this.loadPrefs();
    const root = this.root;
    root.classList.add('ws-root');
    if (matchMedia('(pointer: coarse)').matches) root.classList.add('is-touch');

    // layers
    this.hud = el('div', { class: 'ws-hud' });
    this.layer = el('div', { class: 'ws-layer' }); // floating (tooltips)
    this.toastEl = el('div', { class: 'ws-toast' });
    this.veil = el('div', { class: 'ws-veil' }, el('div', { class: 'ws-veil__txt' }, el('span', { class: 'ws-veil__spin' }), el('span', { class: 'ws-veil__label', text: 'Seeding a new world' })));
    root.append(this.hud, this.layer);

    // components
    this.modals = new Modals(this);
    this.chronicle = new ChroniclePanel(this);
    this.kingdoms = new KingdomsPanel(this);
    this.topbar = new TopBar(this);
    this.toolbar = new Toolbar(this);
    this.minimap = new Minimap(this);
    this.inspector = new Inspector(this);
    this.feed = new Feed(this);
    this.hud.append(this.topbar.el, this.feed.el, this.kingdoms.el, this.chronicle.el, this.inspector.el, this.minimap.wrap, this.toolbar.el, this.toastEl);
    root.append(this.modals.layer, this.veil);
    this.onboarding = new Onboarding(this);
    // ages: chip under the clock, banner on change
    this.ageChip = new AgeChip(this);
    this.topbar.centre.insertBefore(this.ageChip.el, this.topbar.pausedEl);
    this.ageBanner = new AgeBanner(this);
    this.parts.push(this.ageChip);
    // Overview replaces the always-on minimap (M)
    this.overviewBtn = el(
      'button',
      { class: 'ws-overview ws-glass', type: 'button', 'aria-label': 'Overview (M)', 'data-tip': 'Overview · M', onclick: () => this.overview() },
      el('span', { class: 'ws-overview__ico', html: uiIcon('expand') }),
      el('span', { class: 'ws-overview__txt', text: 'Overview' }),
    );
    this.hud.append(this.overviewBtn);
    loadRegistries(() => this.inspector.open && this.inspector.render());
    if (root.classList.contains('is-touch')) {
      this.campad = new CameraPad(this);
      this.hud.append(this.campad.el);
    }
    this.parts = [this.topbar, this.toolbar, this.minimap, this.inspector, this.feed, this.kingdoms, this.onboarding];
    this._paintT = 0;

    // initial prefs (audio/time only when not forced by URL params)
    this.applyPrefs(true);

    // title screen
    if (game.params.title) {
      root.classList.add('is-intro');
      this.title = new TitleScreen(this);
    } else {
      root.classList.add('is-ready');
    }

    // input
    addEventListener('keydown', (e) => this.onKeyCapture(e), true);
    addEventListener('keydown', (e) => this.onKey(e));
    // mouse clicks should not leave focus on buttons (Space would re-trigger them)
    root.addEventListener('click', (e) => {
      const b = e.target.closest?.('button');
      if (b && e.detail > 0) b.blur();
    });
    // keep the brush cursor away while the pointer is over UI
    root.addEventListener('pointerover', (e) => {
      if (e.target !== root && game.input) game.input.mouse.inside = false;
    });
    game.events.on('world:regenerated', () => this.onRegenerated());
    this._powerCheckT = 2;
  }

  // ---------------------------------------------------------------- prefs
  loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {};
    } catch {
      return {};
    }
  }
  savePrefs(patch) {
    Object.assign(this.prefs, patch);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs));
    } catch {
      /* storage unavailable */
    }
  }
  applyPrefs(initial = false) {
    const g = this.game;
    const p = this.prefs;
    this.root.classList.toggle('no-blur', !this.blurOn());
    this.minimap.setVisible(p.minimap === true);
    this.root.classList.toggle('has-minimap', p.minimap === true);
    this.feed.el.classList.toggle('is-off', p.feed === false);
    if (initial) {
      const narrow = innerWidth <= 1000 || innerHeight <= 500;
      this.minimap.setCollapsed(p.mapCollapsed ?? narrow, true);
      if (g.params.audio !== false) {
        if (p.volume != null) safe(() => g.audio?.setVolume?.(p.volume));
        if (p.muted != null) safe(() => g.audio?.setMuted?.(p.muted));
      }
      if (p.powerSaver != null && g.params.power == null) safe(() => g.setPowerSaver?.(p.powerSaver));
      if (p.fpsCap != null && g.settings) g.settings.fpsCap = p.fpsCap;
      if (p.buses) for (const [bus, v] of Object.entries(p.buses)) safe(() => g.audio?.setBusVolume?.(bus, v));
      if (p.dockMin) this.toolbar.setMin(true);

      if (p.quality && !g.params.quality && g.pipeline?.quality !== p.quality) safe(() => g.pipeline?.setQuality?.(p.quality));
    }
  }

  // Frosted glass is costly where the GPU is emulated (SwiftShader / software
  // GL): default it off there, on everywhere else.
  softwareGL() {
    if (this._soft != null) return this._soft;
    this._soft = !!safe(() => {
      const gl = this.game.pipeline.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
      return /swiftshader|llvmpipe|software|basic render/i.test(name);
    }, false);
    return this._soft;
  }
  blurOn() {
    return this.prefs.blur ?? !this.softwareGL();
  }

  // ---------------------------------------------------------------- flow
  reveal() {
    const r = this.root;
    r.classList.remove('is-intro');
    r.classList.add('is-ready', 'is-revealing');
    setTimeout(() => r.classList.remove('is-revealing'), 1800);
    this.title && (this.title.active = false);
    this.onboarding.start();
  }
  begin() {
    if (this.title?.active) this.title.begin();
  }

  toast(text, ms = 2200) {
    const t = this.toastEl;
    t.textContent = text;
    t.classList.add('is-shown');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('is-shown'), ms);
  }

  // Fade to a veil, regenerate on the next frame, fade back.
  regenerate(seed, preset, civs, { quiet = false, after = null } = {}) {
    const g = this.game;
    const label = this.veil.querySelector('.ws-veil__label');
    label.textContent = `Seeding ${/^[aeiou]/i.test(PRESET_NAMES[preset] || '') ? 'an' : 'a'} ${PRESET_NAMES[preset] || 'new'} world`;
    this.veil.classList.add('is-shown');
    setTimeout(() => {
      requestAnimationFrame(() => {
        safe(() => g.regenerate(seed, preset, civs), null, 'regenerate');
        g.params.civs = civs;
        after?.();
        if (!quiet) setTimeout(() => g.notify(`A new ${(PRESET_NAMES[preset] || 'world').toLowerCase()} rises from the deep. Seed ${seed}.`, 'good'), 400);
        setTimeout(() => this.veil.classList.remove('is-shown'), 120);
      });
    }, 360);
  }

  onRegenerated() {
    this.inspector.close();
    this.feed.clear();
    this.chronicle.entries.length = 0;
    if (this.chronicle.open) this.chronicle.renderAll();
    this.topbar.refreshWorld();
    this.minimap.markAll();
    if (this.kingdoms.open) this.kingdoms.render();
  }

  reset() {
    /* handled by the 'world:regenerated' event */
  }

  // Ease out to frame the whole map; press again to return to the previous view.
  overview() {
    const rig = this.game.cameraRig;
    const W = this.game.world;
    if (this._overview) {
      const p = this._overview;
      this._overview = null;
      rig.goal.x = p.x;
      rig.goal.z = p.z;
      rig.goal.dist = p.dist;
      rig.goal.yaw = p.yaw;
      if (p.follow) rig.follow = p.follow;
    } else {
      this._overview = { x: rig.goal.x, z: rig.goal.z, dist: rig.goal.dist, yaw: rig.goal.yaw, follow: rig.follow };
      rig.follow = null;
      rig.goal.x = W.w / 2;
      rig.goal.z = W.h / 2 + W.h * 0.04;
      rig.goal.dist = rig.maxDist;
    }
    this.root.classList.toggle('is-overview', !!this._overview);
    this.overviewBtn.querySelector('.ws-overview__txt').textContent = this._overview ? 'Back' : 'Overview';
    this.overviewBtn.querySelector('.ws-overview__ico').innerHTML = uiIcon(this._overview ? 'collapse' : 'expand');
    this.game.audio?.play?.('ui-click', { volume: 0.45 });
  }

  togglePhoto() {
    const on = !this.root.classList.contains('is-photo');
    this.root.classList.toggle('is-photo', on);
    if (on) this.toast('Interface hidden — press U to bring it back', 2600);
  }

  // ---------------------------------------------------------------- keyboard
  isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  // Runs before Input's handlers: owns Escape and shields modals / title.
  onKeyCapture(e) {
    if (this.title?.active) {
      if (this.modals.current) {
        if (e.code === 'Escape') this.modals.close(), e.stopPropagation();
        return;
      }
      if (this.isTyping(e)) return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        this.title.begin();
      }
      e.stopPropagation();
      return;
    }
    if (e.code === 'Escape') {
      if (this.modals.current) {
        this.modals.close();
        e.stopPropagation();
      } else if (this.root.classList.contains('is-photo')) {
        this.togglePhoto();
        e.stopPropagation();
      } else if (this.game.activePower) {
        /* let Input deselect the power */
      } else if (this.kingdoms.open || this.chronicle.open) {
        this.kingdoms.toggle(false);
        this.chronicle.toggle(false);
        e.stopPropagation();
      } else if (this.inspector.open) {
        this.inspector.close();
        e.stopPropagation();
      }
      return;
    }
    if (this.modals.current && !this.isTyping(e)) {
      // only the panel's own toggle key passes through while a dialog is up
      const own = { help: 'KeyH', settings: 'KeyO', newworld: 'KeyG', laws: 'KeyL', ages: 'KeyY' }[this.modals.current];
      if (e.code === own) {
        this.modals.close();
        e.preventDefault();
      }
      if (e.code !== 'Tab') e.stopPropagation();
    }
  }

  onKey(e) {
    if (this.isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (this.title?.active || this.modals.current) return;
    const g = this.game;
    const code = e.code;
    const slot = SLOT_CODES.indexOf(code);
    if (slot >= 0 && this.toolbar.pickSlot(slot + (e.shiftKey ? SLOT_CODES.length : 0))) {
      e.preventDefault();
      return;
    }
    if (e.key === '?') return this.modals.toggle('help');
    switch (code) {
      case 'Tab':
        e.preventDefault();
        this.toolbar.cycleCategory(e.shiftKey ? -1 : 1);
        break;
      case 'KeyI': {
        const p = getPower('inspect');
        if (p) {
          g.selectPower(g.activePower === p ? null : p);
          if (g.activePower === p) this.toolbar.setCategory(p.category, { quiet: true });
        }
        break;
      }
      case 'KeyK':
        this.kingdoms.toggle();
        break;
      case 'KeyJ':
        this.chronicle.toggle();
        break;
      case 'KeyL':
        this.modals.toggle('laws');
        break;
      case 'KeyM':
        this.overview();
        break;
      case 'KeyY':
        this.modals.toggle('ages');
        break;
      case 'Backquote':
        this.toolbar.setMin(!this.toolbar.el.classList.contains('is-min'));
        break;
      case 'KeyO':
        this.modals.toggle('settings');
        break;
      case 'KeyH':
        this.modals.toggle('help');
        break;
      case 'KeyG':
        this.modals.toggle('newworld');
        break;
      case 'KeyU':
        this.togglePhoto();
        break;
      case 'KeyF':
        if (this.inspector.open && this.inspector.track?.unit) this.inspector.toggleFollow();
        break;
      default:
        break;
    }
  }

  // ---------------------------------------------------------------- debug / tooling
  open(name) {
    if (name === 'kingdoms') this.kingdoms.toggle(true);
    else if (name === 'chronicle') this.chronicle.toggle(true);
    else this.modals.open(name);
  }
  setCategory(id) {
    this.toolbar.setCategory(id, { quiet: true });
  }
  debugShowTooltip(id) {
    const p = getPower(id);
    if (!p) return false;
    if (p.category !== this.toolbar.cat) this.toolbar.setCategory(p.category, { quiet: true });
    this.toolbar.showTip(p, this.toolbar.tiles.get(id));
    const tile = this.toolbar.tiles.get(id);
    tile?.classList.add('is-hover');
    return true;
  }
  // Pretend the pointer hovers the canvas at client (x, y): drives the brush cursor.
  debugHover(x, y) {
    const inp = this.game.input;
    if (!inp) return;
    inp.mouse.x = x;
    inp.mouse.y = y;
    inp.mouse.inside = true;
    this._debugHover = { x, y };
  }
  inspectAt(x, z) {
    const W = this.game.world;
    this.game.events.emit('inspect', { x, z, tx: Math.floor(x), ty: Math.floor(z), y: W.surfaceAt(x, z) });
  }

  // ---------------------------------------------------------------- frame
  update(dt) {
    if (!this.enabled) return;
    if (this._debugHover && this.game.input) this.game.input.mouse.inside = true;
    if (this.title?.active) safe(() => this.title.update(dt), null, 'title');
    for (const p of this.parts) safe(() => p.update(dt), null, p.constructor.name);
    // while a brush stroke is held, side panels fade back so the land is clear
    const painting = !!(this.game.activePower && this.game.input?._pressed);
    this._paintT = painting ? this._paintT + dt : 0;
    const fade = this._paintT > 0.35;
    if (fade !== this._fade) {
      this._fade = fade;
      this.root.classList.toggle('is-painting', fade);
    }
    this._powerCheckT -= dt;
    if (this._powerCheckT <= 0) {
      this._powerCheckT = 2;
      safe(() => this.toolbar.refreshIfChanged(), null, 'powers');
    }
  }

  resize() {
    if (!this.enabled) return;
    this.toolbar.hideTip(true);
  }
}

export { CATEGORIES, listPowers };
