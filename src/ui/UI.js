import '@fontsource/cinzel/700.css';
import * as THREE from 'three';
import './hud2.css';
import './hud3.css';
import './hud4.css';
import './hud5.css';
import './hud6.css';
import './hud7.css';
import { CATEGORIES, listPowers, getPower } from '../powers/registry.js';
import { el, safe } from './dom.js';
import { SEA_LEVEL } from '../world/constants.js';
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
import { Popover } from './Popover.js';
import { AgeChip, AgeBanner } from './Ages.js';
import { loadRegistries } from './depth.js';
import { lawDef } from '../core/laws.js';
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
    this.popover = new Popover(this);
    // ages: chip under the clock, banner on change
    this.ageChip = new AgeChip(this);
    this.topbar.centre.insertBefore(this.ageChip.el, this.topbar.pausedEl);
    this.ageBanner = new AgeBanner(this);
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
    this.parts = [this.topbar, this.toolbar, this.minimap, this.inspector, this.feed, this.kingdoms, this.onboarding, this.ageChip];
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
    // On-screen keyboards: while a text field in the inspector has focus, lift the
    // sheet above the keyboard (visualViewport) and keep the field in view.
    const vv = window.visualViewport;
    if (vv) {
      const fit = () => {
        const a = document.activeElement;
        const typing = !!a && this.inspector.el.contains(a) && a.matches?.('input:not([type]), input[type=text], input[type=search], textarea');
        const kb = typing ? Math.max(0, Math.round(innerHeight - (vv.height + vv.offsetTop))) : 0;
        root.style.setProperty('--kb', kb + 'px');
        root.classList.toggle('has-kb', kb > 40);
        if (kb > 40) requestAnimationFrame(() => a.scrollIntoView?.({ block: 'nearest' }));
      };
      vv.addEventListener('resize', fit);
      vv.addEventListener('scroll', fit);
      root.addEventListener('focusin', () => setTimeout(fit, 60));
      root.addEventListener('focusout', () => setTimeout(fit, 60));
    }
    // typing in any field never reaches game hotkeys (Input, power slots, ...)
    root.addEventListener('keydown', (e) => {
      if (this.isTyping(e)) e.stopPropagation();
    });
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
    this._lawT = new Map();
    game.events.on('laws', ({ key, value } = {}) => {
      if (key == null) {
        this.toast('World laws restored to their defaults');
        return safe(() => game.notify('The World Laws are restored to their ancient defaults.', 'info'));
      }
      clearTimeout(this._lawT.get(key));
      this._lawT.set(
        key,
        setTimeout(() => {
          const def = lawDef(key);
          if (!def) return;
          const v = game.laws?.[key] ?? value;
          let text;
          if (def.type === 'bool') text = v ? `${def.label} allowed again: ${def.description.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())}.` : `${def.label} forbidden by World Law.`;
          else text = +v === 0 ? `${def.label} stilled by World Law.` : `${def.label} set to ×${+(+v).toFixed(2)}.`;
          this.toast(text);
          safe(() => game.notify(text, 'info'));
        }, 650),
      );
    });
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

  // A toast with Undo, live for 10 seconds.
  undoToast(text, undo) {
    if (!this.undoEl) {
      this.undoEl = el(
        'div',
        { class: 'ws-undo ws-glass', role: 'status' },
        el('span', { class: 'ws-undo__txt' }),
        el('button', { class: 'ws-btn ws-btn--sm ws-undo__btn', type: 'button', text: 'Undo' }),
        el('i', { class: 'ws-undo__bar' }),
      );
      this.hud.append(this.undoEl);
    }
    const t = this.undoEl;
    t.querySelector('.ws-undo__txt').textContent = text;
    const btn = t.querySelector('.ws-undo__btn');
    btn.onclick = () => {
      clearTimeout(this._undoT);
      t.classList.remove('is-shown');
      safe(() => undo?.(), null, 'undo');
      this.toast('Undone', 1400);
    };
    btn.hidden = !undo;
    t.classList.remove('is-shown');
    void t.offsetWidth;
    t.classList.add('is-shown');
    clearTimeout(this._undoT);
    this._undoT = setTimeout(() => t.classList.remove('is-shown'), 10000);
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
    label.textContent = preset === 'earth' ? 'Shaping the World Map' : `Seeding ${/^[aeiou]/i.test(PRESET_NAMES[preset] || '') ? 'an' : 'a'} ${PRESET_NAMES[preset] || 'new'} world`;
    this.veil.classList.add('is-shown');
    setTimeout(() => {
      requestAnimationFrame(() => {
        safe(() => g.regenerate(seed, preset, civs), null, 'regenerate');
        this._regenN = (this._regenN || 0) + 1; // new land: the overview frame is measured again
        g.params.civs = civs;
        after?.();
        if (!quiet) setTimeout(() => g.notify(preset === 'earth' ? `The World Map rises from the deep. Seed ${seed}.` : `A new ${(PRESET_NAMES[preset] || 'world').toLowerCase()} rises from the deep. Seed ${seed}.`, 'good'), 400);
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

  // Frame the whole map between the top bar and the (folded) dock: solve the
  // camera distance and target offset from the real FOV and aspect so all four
  // corners are on screen, at a steeper pitch. Press again to return.
  overview() {
    const g = this.game;
    const rig = g.cameraRig;
    const W = g.world;
    if (this._overview) return this.exitOverview(true);
    const prev = { x: rig.goal.x, z: rig.goal.z, dist: rig.goal.dist, yaw: rig.goal.yaw, follow: rig.follow, maxDist: rig.maxDist, dockMin: this.toolbar.el.classList.contains('is-min') };
    // fold the tray first so the usable band is measured with it folded
    this.root.classList.add('is-overview');
    if (!prev.dockMin && !this.toolbar.isDrawer()) this.toolbar.setMin(true);
    if (this.toolbar.isDrawer()) this.toolbar.toggleDrawer(false);
    this.placeBackPill(true);
    const vw = innerWidth,
      vh = innerHeight;
    const topR = this.topbar.el.getBoundingClientRect();
    const ovR = this.overviewBtn.getBoundingClientRect();
    const pillBottom = ovR.height && ovR.top < innerHeight * 0.4 ? ovR.bottom : 0;
    const dockR = this.toolbar.panel.getBoundingClientRect();
    const top = Math.min(vh * 0.45, Math.max(topR.bottom, pillBottom) + 12);
    // on drawer layouts (phones, short landscape) and touch tablets the dock folds
    // away during Overview (hud5.css, hud7.css), so the map may use the full height
    const dockGone = matchMedia('(max-width: 720px), (max-height: 500px)').matches || this.root.classList.contains('is-touch');
    const bottom = dockGone ? vh - 10 : Math.max(vh * 0.6, (dockR.top > vh * 0.5 ? dockR.top : vh) - 12);
    const left = 12,
      right = vw - 12;
    const north = Math.round(rig.goal.yaw / (Math.PI * 2)) * Math.PI * 2;
    const bias = THREE.MathUtils.degToRad(innerHeight <= 500 ? 15 : 8);
    const pitch = THREE.MathUtils.degToRad(70) + bias;
    const cam = new THREE.PerspectiveCamera(rig.camera.fov, vw / vh, 1, 1e6);
    const v = new THREE.Vector3();
    // frame the land, not the empty ocean around it (a continent fills the
    // screen instead of floating in a blue square)
    const box = this.landBox();
    const cx = (box.x0 + box.x1) / 2,
      cz = (box.z0 + box.z1) / 2;
    const ty = Math.max(0, W.heightAt(cx, cz)) * 0.6;
    // the coastline's outline (not the box corners, which are open sea): the
    // corners of the world may slip under the HUD, the land may not
    const corners = this._landOutline || [
      [box.x0, box.z0],
      [box.x1, box.z0],
      [box.x0, box.z1],
      [box.x1, box.z1],
    ];
    const fits = (d, tx, tz, yaw) => {
      const horiz = Math.cos(pitch) * d;
      cam.position.set(tx + Math.sin(yaw) * horiz, ty + Math.sin(pitch) * d, tz + Math.cos(yaw) * horiz);
      cam.lookAt(tx, ty, tz);
      cam.updateMatrixWorld();
      for (const [x, z] of corners) {
        v.set(x, 0, z).project(cam);
        const sx = (v.x * 0.5 + 0.5) * vw,
          sy = (-v.y * 0.5 + 0.5) * vh;
        if (v.z > 1 || sx < left || sx > right || sy < top || sy > bottom) return false;
      }
      return true;
    };
    const solve = (yaw) => {
      let best = null;
      const span = Math.abs(Math.cos(yaw)) > 0.5 ? box.z1 - box.z0 : box.x1 - box.x0;
      for (let k = -10; k <= 10; k++) {
        // slide the target along the view direction (perspective puts the far edge higher)
        const off = (k / 40) * span;
        const tx = cx - Math.sin(yaw) * off,
          tz = cz - Math.cos(yaw) * off;
        let lo = 5,
          hi = Math.max(W.w, W.h) * 12;
        if (!fits(hi, tx, tz, yaw)) continue;
        for (let it = 0; it < 26; it++) {
          const m = (lo + hi) / 2;
          if (fits(m, tx, tz, yaw)) hi = m;
          else lo = m;
        }
        if (!best || hi < best.d) best = { d: hi, tx, tz, yaw };
      }
      return best;
    };
    let best = solve(north);
    // a long map on a tall screen (the 2:1 World Map in portrait) turns a quarter
    // so its long axis runs down the screen, when that fills clearly more of it
    const bw = box.x1 - box.x0,
      bh = box.z1 - box.z0;
    if ((vh > vw * 1.15 && bw > bh * 1.3) || (vw > vh * 1.15 && bh > bw * 1.3)) {
      const turned = solve(north + Math.PI / 2);
      if (turned && (!best || turned.d < best.d * 0.9)) best = turned;
    }
    if (!best) best = { d: rig.maxDist, tx: W.w / 2, tz: W.h / 2, yaw: north };
    const d = best.d * 1.02;
    this._overview = { ...prev, dist: prev.dist, target: d };
    rig.follow = null;
    // maxDist = d makes the rig's auto-pitch reach its top (70°) exactly at d,
    // so pitch + bias equals the 78° the fit was solved for
    rig.maxDist = d;
    rig.goal.x = best.tx;
    rig.goal.z = best.tz;
    rig.goal.dist = d;
    rig.goal.yaw = best.yaw;
    if (best.yaw !== north) this.toast('Turned to fit the screen: north is to the right', 2600);
    this._biasGoal = bias;
    this.syncOverviewBtn();
    g.audio?.play?.('ui-click', { volume: 0.45 });
  }

  // Bounding box of the land (above sea level) plus a small shore margin, cached per world.
  landBox() {
    const W = this.game.world;
    const key = `${W.w}x${W.h}:${this.game.params?.seed}:${this.game.params?.preset}:${this._regenN || 0}`;
    if (this._landBox?.key === key) {
      this._landOutline = this._landBox.outline;
      return this._landBox.box;
    }
    const n = 96;
    const sx = W.w / n,
      sz = W.h / Math.max(8, Math.round((n * W.h) / W.w));
    let x0 = Infinity,
      z0 = Infinity,
      x1 = -Infinity,
      z1 = -Infinity;
    const rowMin = new Map(),
      rowMax = new Map(),
      colMin = new Map(),
      colMax = new Map();
    for (let z = sz / 2; z < W.h; z += sz)
      for (let x = sx / 2; x < W.w; x += sx) {
        const h = safe(() => W.heightAt(x, z), 0, 'land box');
        if (h > SEA_LEVEL + 0.05) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (z < z0) z0 = z;
          if (z > z1) z1 = z;
          if (!(rowMin.get(z) <= x)) rowMin.set(z, x);
          if (!(rowMax.get(z) >= x)) rowMax.set(z, x);
          if (!(colMin.get(x) <= z)) colMin.set(x, z);
          if (!(colMax.get(x) >= z)) colMax.set(x, z);
        }
      }
    // outline: the outermost land sample of every row and column, pushed out by a shore margin
    const out = [];
    const mo = Math.max(W.w, W.h) * 0.035 + Math.max(sx, sz);
    const push = (x, z, dx, dz) => out.push([Math.max(0, Math.min(W.w, x + dx * mo)), Math.max(0, Math.min(W.h, z + dz * mo))]);
    for (const [z, x] of rowMin) push(x, z, -1, 0);
    for (const [z, x] of rowMax) push(x, z, 1, 0);
    for (const [x, z] of colMin) push(x, z, 0, -1);
    for (const [x, z] of colMax) push(x, z, 0, 1);
    this._landOutline = out.length >= 4 ? out : null;
    let box;
    if (!Number.isFinite(x0)) box = { x0: 0, z0: 0, x1: W.w, z1: W.h };
    else {
      const m = Math.max(W.w, W.h) * 0.04 + Math.max(sx, sz);
      box = { x0: Math.max(0, x0 - m), z0: Math.max(0, z0 - m), x1: Math.min(W.w, x1 + m), z1: Math.min(W.h, z1 + m) };
      // never zoom into a sliver: keep at least 45% of the world in view
      for (const [a, b, size] of [
        ['x0', 'x1', W.w],
        ['z0', 'z1', W.h],
      ]) {
        const need = size * 0.45 - (box[b] - box[a]);
        if (need > 0) {
          box[a] = Math.max(0, box[a] - need / 2);
          box[b] = Math.min(size, box[b] + need / 2);
        }
      }
    }
    this._landBox = { key, box, outline: this._landOutline };
    return box;
  }

  // Touch Overview: the Back pill sits just below whatever occupies the top
  // centre (clock, age chip), measured rather than guessed per device; on short
  // landscape screens it moves to the bottom-right corner, out of the map's way.
  placeBackPill(on) {
    const b = this.overviewBtn;
    b.style.top = '';
    if (!on || !this.root.classList.contains('is-touch') || innerHeight <= 500) return;
    let y = 0;
    for (const e of [this.topbar.el, this.ageChip?.el]) {
      const r = e?.getBoundingClientRect?.();
      if (!r || !r.height || r.top > innerHeight * 0.3) continue;
      if (e === this.topbar.el) {
        // only the parts of the top bar over the centre column count
        for (const c of e.querySelectorAll(':scope > *')) {
          const q = c.getBoundingClientRect();
          if (q.height && q.left < innerWidth * 0.62 && q.right > innerWidth * 0.38) y = Math.max(y, q.bottom);
        }
      } else if (r.left < innerWidth * 0.62 && r.right > innerWidth * 0.38) y = Math.max(y, r.bottom);
    }
    b.style.top = Math.round((y || 60) + 10) + 'px';
  }

  exitOverview(restoreView) {
    const rig = this.game.cameraRig;
    const p = this._overview;
    if (!p) return;
    this._overview = null;
    this.placeBackPill(false);
    rig.maxDist = p.maxDist;
    if (restoreView) {
      rig.goal.x = p.x;
      rig.goal.z = p.z;
      rig.goal.dist = Math.min(p.dist, p.maxDist);
      rig.goal.yaw = p.yaw;
      if (p.follow && p.follow.alive !== false) rig.follow = p.follow;
    } else rig.goal.dist = Math.min(rig.goal.dist, p.maxDist);
    this._biasGoal = 0;
    this.root.classList.remove('is-overview');
    if (!p.dockMin && !this.toolbar.isDrawer()) this.toolbar.setMin(false);
    this.syncOverviewBtn();
    this.game.audio?.play?.('ui-click', { volume: 0.4 });
  }

  syncOverviewBtn() {
    const on = !!this._overview;
    this.overviewBtn.querySelector('.ws-overview__txt').textContent = on ? 'Back' : 'Overview';
    this.overviewBtn.querySelector('.ws-overview__ico').innerHTML = uiIcon(on ? 'collapse' : 'expand');
    this.overviewBtn.setAttribute('aria-label', on ? 'Back to your view (M)' : 'Overview (M)');
    this.overviewBtn.dataset.tip = on ? 'Back · M' : 'Overview · M';
  }

  // per-frame: ease the overview pitch, leave overview when the player dives in
  updateOverview(dt) {
    const rig = this.game.cameraRig;
    const goal = this._biasGoal ?? 0;
    if (Math.abs((rig.cur.pitchBias || 0) - goal) > 1e-4) {
      const k = 1 - Math.exp(-dt * 4);
      rig.cur.pitchBias = (rig.cur.pitchBias || 0) + (goal - (rig.cur.pitchBias || 0)) * k;
      rig.goal.pitchBias = rig.cur.pitchBias;
    }
    if (this._overview && rig.goal.dist < this._overview.target * 0.6) this.exitOverview(false);
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
      // Escape inside an edit field reverts that field (Editor), it does not close the card
      if (!this.modals.current && this.isTyping(e) && this.inspector.el.contains(e.target)) return;
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
        if (this.inspector.editing) this.inspector.stopEdit();
        else this.inspector.close();
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
      case 'Tab': {
        // Tab cycles power categories only while nothing has focus (the world has
        // the keyboard); on a button, pill or field it moves focus as usual, so the
        // inspector, panels and dialogs stay keyboard-navigable.
        const a = document.activeElement;
        if (a && a !== document.body && a !== document.documentElement && a.tagName !== 'CANVAS') break;
        e.preventDefault();
        this.toolbar.cycleCategory(e.shiftKey ? -1 : 1);
        break;
      }
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
    if (this.title?.active) {
      safe(() => this.title.update(dt), null, 'title');
      // kingdom / village name sprites would draw over the logo and card
      safe(() => {
        const L = this.game.buildings?.labels;
        for (const m of [L?.kLabels, L?.vLabels, L?.battles, L?.markers]) if (m?.values) for (const s of m.values()) if (s) s.visible = false;
      }, null, 'title labels');
    }
    for (const p of this.parts) safe(() => p.update(dt), null, p.constructor.name);
    safe(() => this.updateOverview(dt), null, 'overview');
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
