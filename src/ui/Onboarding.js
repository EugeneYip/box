import { el } from './dom.js';
import { uiIcon } from './icons.js';

const STEPS = [
  { icon: 'grid', title: 'Choose a power', text: 'Open a tab in the tray below and pick a god power. Raise Land is a fine first gift.', done: 'power', at: ['.ws-dock__handle', '.ws-tabs'] },
  { icon: 'brush', title: 'Shape the world', text: 'Hold and drag across the land to paint with it. [ and ] change the brush size.', touch: 'Touch and drag across the land to paint with it. The − and + on the power bar change the brush size.', done: 'apply', at: ['.ws-brush.is-shown .ws-brush__size', '.ws-brush.is-shown', '.ws-dock__handle', '.ws-tabs'] },
  { icon: 'inspect', title: 'Look closer', text: 'Press Esc to put the power away, then click any creature, house or field to inspect it.', touch: 'Tap ✕ on the power bar to put it away, then tap any creature, house or field.', done: 'inspect', at: ['.ws-dock__cancel', '.ws-brush.is-shown .ws-brush__close', '.ws-dock__handle', '.ws-tabs'] },
  { icon: 'hourglass', title: 'Time', text: 'Space pauses the world and 1 to 5 set its speed. The bar at the top shows the year and how long until the next season.', touch: 'Tap the pause button at the top to stop time, and the speed button beside it to go faster.', done: 'speed', at: ['.ws-clock'] },
  { icon: 'overview', title: 'See it all', text: 'Press M, or Overview at the bottom right, to see the whole world. Click a place to fly back down to it.', touch: 'Tap Overview (the folded map at the right) to see the whole world, then tap a place to fly back down to it.', done: 'overview', at: ['.ws-overview', '.ws-campad__btn[aria-label="Overview"]'] },
  { icon: 'star-on', title: 'Favorites', text: 'Star a creature, town or realm on its card. Press P, or Favorites, to find and follow it again.', touch: 'Star a creature, town or realm on its card. Tap Favorites to find and follow it again.', done: 'favorites', at: ['.ws-favbtn'] },
  { icon: 'kingdoms', title: 'Realms', text: 'The Realms panel (the flag at the top left) lists every realm with its towns, wars and alliances.', touch: 'The Realms panel (the flag at the left) lists every realm with its towns, wars and alliances.', menu: 'The Realms panel (in the menu under the emblem at the top left) lists every realm with its towns, wars and alliances.', done: 'realms', at: ['.ws-nav .ws-iconbtn[aria-label^="Realms"]', '.ws-brand__id'] },
];

// Seven gentle hints after the title screen. Each step completes itself when
// the player does the thing; the sequence never shows again once finished or
// dismissed.
export class Onboarding {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.step = -1;
    this.el = el('div', { class: 'ws-coach ws-glass ws-orn', role: 'status' });
    ui.hud.append(this.el);
    // a pulsing ring on the control the step names
    this.ring = el('div', { class: 'ws-coach__ring', 'aria-hidden': 'true' });
    (ui.root || ui.hud).append(this.ring);
    const ev = this.game.events;
    ev.on('power:select', ({ power } = {}) => power && this.complete('power'));
    ev.on('power:apply', () => this.complete('apply'));
    ev.on('inspect', (hit) => hit && this.complete('inspect'));
    ev.on('speed', () => this.complete('speed'));
    // Overview, Favorites and Realms complete their steps when they open
    const wrap = (obj, fn, what, opened = () => true) => {
      const f = obj?.[fn];
      if (typeof f !== 'function') return;
      obj[fn] = (...a) => {
        const r = f.apply(obj, a);
        if (opened()) this.complete(what);
        return r;
      };
    };
    queueMicrotask(() => {
      wrap(ui, 'overview', 'overview', () => !!ui._overview);
      wrap(ui.favPanel, 'toggle', 'favorites', () => !!ui.favPanel?.open);
      wrap(ui.kingdoms, 'toggle', 'realms', () => !!ui.kingdoms?.open);
    });
    this._t = 0;
  }

  start() {
    if (this.ui.prefs.onboarded || this.step >= 0) return;
    setTimeout(() => this.show(0), 1600);
  }

  show(i) {
    if (i >= STEPS.length) return this.finish();
    this.step = i;
    const s = STEPS[i];
    this.el.innerHTML = '';
    this.el.append(
      el('span', { class: 'ws-coach__ico', html: uiIcon(s.icon) }),
      el(
        'div',
        { class: 'ws-coach__body' },
        el('div', { class: 'ws-coach__step', html: STEPS.map((_, k) => `<i class="${k < i ? 'is-done' : k === i ? 'is-on' : ''}"></i>`).join('') + `<span>Step ${i + 1} of ${STEPS.length}</span>` }),
        el('div', { class: 'ws-coach__title', text: s.title }),
        el('p', { class: 'ws-coach__text', text: (s.menu && this.ui.topbar?.menuMode?.() && s.menu) || (this.ui.root.classList.contains('is-touch') && s.touch) || s.text }),
      ),
      el(
        'div',
        { class: 'ws-coach__acts' },
        // (the last step has nothing left to skip)
        i < STEPS.length - 1 ? el('button', { class: 'ws-link', type: 'button', text: 'Skip tips', onclick: () => this.finish() }) : null,
        el('button', { class: 'ws-btn ws-btn--sm ws-btn--ghost', type: 'button', text: i === STEPS.length - 1 ? 'Done' : 'Next', onclick: () => this.show(i + 1) }),
      ),
    );
    this.el.classList.remove('is-shown');
    void this.el.offsetWidth;
    this.el.classList.add('is-shown');
    this.place();
  }

  complete(what) {
    if (this.step < 0 || STEPS[this.step]?.done !== what) return;
    const i = this.step;
    this.el.classList.add('is-success');
    setTimeout(() => {
      this.el.classList.remove('is-success');
      if (this.step === i) this.show(i + 1);
    }, what === 'apply' ? 1400 : 700);
  }

  finish() {
    this.step = STEPS.length;
    this.el.classList.remove('is-shown');
    this.ring.classList.remove('is-shown');
    this.ui.savePrefs({ onboarded: true });
  }

  // the ring sits on the first of the step's controls that is on screen;
  // returns its rectangle (or null)
  pointAt() {
    const s = STEPS[this.step];
    let r = null;
    for (const sel of s?.at || []) {
      for (const e of document.querySelectorAll(sel)) {
        const b = e.getBoundingClientRect();
        if (b.width < 4 || b.height < 4 || b.bottom < 0 || b.top > innerHeight) continue;
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden' || +cs.opacity < 0.1 || e.closest('[hidden], [inert]')) continue;
        r = b;
        break;
      }
      if (r) break;
    }
    this.ring.classList.toggle('is-shown', !!r);
    if (!r) return null;
    // (round 29) the ring stays inside the screen (round 28 ran it off the
    // top, at -17, round the clock)
    const pad = 5;
    const l = Math.max(2, Math.round(r.left - pad)),
      t = Math.max(2, Math.round(r.top - pad)),
      rr = Math.min(innerWidth - 2, Math.round(r.right + pad)),
      b = Math.min(innerHeight - 2, Math.round(r.bottom + pad));
    Object.assign(this.ring.style, { left: `${l}px`, top: `${t}px`, width: `${Math.max(8, rr - l)}px`, height: `${Math.max(8, b - t)}px` });
    return r;
  }

  // (round 27) the card stands beside its ring: under a control at the top of
  // the screen, above one at the bottom, lined up with it across (clamped to
  // the screen), never over the ring itself; with no ring, above the tray
  place() {
    const dock = this.ui.toolbar;
    const top = Math.min(dock.panel.getBoundingClientRect().top, dock.brush.el.classList.contains('is-shown') ? dock.brush.el.getBoundingClientRect().top : 1e9);
    const h = this.el.offsetHeight || 110,
      w = this.el.offsetWidth || 400;
    const W = innerWidth,
      H = innerHeight;
    const r = this.pointAt();
    let y = Math.max(80, Math.round(top - h - 16)),
      x = W / 2;
    if (r) {
      const gap = 14;
      const cx = (r.left + r.right) / 2;
      x = Math.min(W - 12 - w / 2, Math.max(12 + w / 2, cx));
      if ((r.top + r.bottom) / 2 < H * 0.5) {
        y = Math.round(r.bottom + gap);
        // (round 29) a card under the clock also clears the age row beneath
        // it (the age chip and the actual-speed note it talks about)
        for (const e of document.querySelectorAll('.ws-agerow .ws-agechip, .ws-agerow .ws-speed__eff, .ws-paused')) {
          const b = e.getBoundingClientRect();
          if (b.width < 4 || b.height < 4 || getComputedStyle(e).display === 'none' || +getComputedStyle(e).opacity < 0.1) continue;
          if (b.top < y + h && b.bottom > r.bottom - 2 && b.left < x + w / 2 && b.right > x - w / 2) y = Math.max(y, Math.round(b.bottom + 10));
        }
        y = Math.min(H - h - 12, y);
      } else y = Math.max(12, Math.round(Math.min(r.top, top) - h - gap));
    }
    this.el.style.top = y + 'px';
    this.el.style.left = Math.round(x) + 'px';
  }

  update(dt) {
    if (this.step < 0 || this.step >= STEPS.length) return;
    this._t -= dt;
    if (this._t <= 0) {
      this._t = 0.3;
      this.place();
    }
  }
}
