import { el } from './dom.js';
import { uiIcon } from './icons.js';

const STEPS = [
  { icon: 'grid', title: 'Choose a power', text: 'Open a tab in the tray below and pick a god power. Raise Land is a fine first gift.', done: 'power' },
  { icon: 'brush', title: 'Shape the world', text: 'Hold and drag across the land to paint with it. [ and ] change the brush size.', touch: 'Touch and drag across the land to paint with it. The − and + on the power bar change the brush size.', done: 'apply' },
  { icon: 'inspect', title: 'Look closer', text: 'Press Esc to put the power away, then click any creature, house or field to inspect it.', touch: 'Tap ✕ on the power bar to put it away, then tap any creature, house or field.', done: 'inspect' },
  { icon: 'hourglass', title: 'Time', text: 'Space pauses the world and 1 to 5 set its speed. The bar at the top shows the year and how long until the next season.', touch: 'Tap the pause button at the top to stop time, and the speed button beside it to go faster.', done: 'speed' },
  { icon: 'expand', title: 'See it all', text: 'Press M, or Overview at the bottom left, to see the whole world. Click a place to fly back down to it.', touch: 'Tap Overview to see the whole world, then tap a place to fly back down to it.', done: 'overview' },
  { icon: 'star-on', title: 'Favorites', text: 'Star a creature, town or realm on its card. Press P, or Favorites, to find and follow it again.', touch: 'Star a creature, town or realm on its card. Tap Favorites to find and follow it again.', done: 'favorites' },
  { icon: 'kingdoms', title: 'Realms', text: 'The Realms panel (the flag on the left) lists every realm with its towns, wars and alliances.', touch: 'The Realms panel (the flag on the left) lists every realm with its towns, wars and alliances.', done: 'realms' },
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
        el('p', { class: 'ws-coach__text', text: (this.ui.root.classList.contains('is-touch') && s.touch) || s.text }),
      ),
      el(
        'div',
        { class: 'ws-coach__acts' },
        el('button', { class: 'ws-link', type: 'button', text: 'Skip tips', onclick: () => this.finish() }),
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
    this.ui.savePrefs({ onboarded: true });
  }

  place() {
    const dock = this.ui.toolbar;
    const top = Math.min(dock.panel.getBoundingClientRect().top, dock.brush.el.classList.contains('is-shown') ? dock.brush.el.getBoundingClientRect().top : 1e9);
    const h = this.el.offsetHeight || 110;
    this.el.style.top = Math.max(80, Math.round(top - h - 16)) + 'px';
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
