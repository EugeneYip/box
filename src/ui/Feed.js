import { uiIcon } from './icons.js';
import { el, esc } from './dom.js';
import { classify, isMinor } from './Chronicle.js';

const LIFETIME = 7.5; // seconds before an entry fades
const maxVisible = () => (innerHeight <= 760 ? 3 : 4);

// Toast-style feed of the newest chronicle entries. Clicking a card with a
// position flies the camera there; hovering holds the fade. Every entry is
// also recorded in the Chronicle panel (J).
export class Feed {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = el('div', { class: 'ws-feed', 'aria-live': 'polite' });
    this.items = [];
    this.hover = false;
    this.el.addEventListener('pointerenter', () => (this.hover = true));
    this.el.addEventListener('pointerleave', () => (this.hover = false));
    this.game.events.on('notify', (n) => this.push(n));
    // Civ writes some lines only to its history (renames, relics, families on the
    // move). Route them here too, unless the same line also arrives as a
    // notification (Civ's _note sends both, synchronously, so one microtask is enough).
    const pend = new Map();
    this.game.events.on('notify', (n) => n?.text && pend.delete(n.text));
    this.game.events.on('civ:history', (h) => {
      if (!h?.text) return;
      pend.set(h.text, h);
      if (this._histQ) return;
      this._histQ = true;
      queueMicrotask(() => {
        this._histQ = false;
        const list = [...pend.values()];
        pend.clear();
        for (const e of list) this.pushHistory(e);
      });
    });
  }

  // A history-only line: renames and other decrees show in the feed; the rest
  // (relics, families settling) go quietly into the chronicle.
  pushHistory(h) {
    const n = { text: h.text, kind: h.kind || 'info', x: h.x, z: h.z, time: h.t };
    if (/shall now be known as|by divine|by the gods/i.test(h.text)) this.push(n);
    else this.ui.chronicle?.add?.({ ...n, minor: true });
  }

  push(n) {
    if (!n || !n.text) return;
    if (this.game.laws?.miscMinorEvents === false && isMinor(n)) return;
    if (n.kind === 'age' && n.color == null && this.game.age) n = { ...n, color: this.game.age.color };
    const e = this.ui.chronicle ? this.ui.chronicle.add(n) : classify(n);
    const now = performance.now() / 1000;
    const dup = this.items.find((it) => it.text === e.text && now - it.born < 6 && !it.leaving);
    if (dup) {
      dup.count++;
      dup.born = now;
      dup.countEl.textContent = '×' + dup.count;
      dup.countEl.hidden = false;
      dup.el.classList.remove('is-ping');
      void dup.el.offsetWidth;
      dup.el.classList.add('is-ping');
      return;
    }
    const hasPos = n.x != null && n.z != null && !Number.isNaN(+n.x);
    const countEl = el('span', { class: 'ws-feed__count', hidden: true });
    const card = el(
      hasPos ? 'button' : 'div',
      {
        class: `ws-feed__item ws-glass is-${e.kind}${hasPos ? ' is-link' : ''}`,
        style: `--tint:${e.tint}`,
        type: hasPos ? 'button' : null,
        'aria-label': hasPos ? `${e.text} — show on map` : null,
      },
      el('span', { class: 'ws-feed__ico', html: uiIcon(e.icon) }),
      el('span', { class: 'ws-feed__txt', html: esc(e.text) }),
      el('span', { class: 'ws-feed__meta' }, countEl, hasPos ? el('span', { class: 'ws-feed__go', html: uiIcon('locate') }) : null),
    );
    const item = { el: card, text: e.text, born: now, count: 1, countEl, leaving: false };
    if (hasPos) {
      card.addEventListener('click', () => {
        this.game.focus(+n.x, +n.z, Math.min(this.game.cameraRig.goal.dist, 46));
        this.game.cameraRig.follow = null;
        this.game.audio?.play?.('ui-click', { volume: 0.45 });
      });
    }
    this.el.prepend(card);
    this.items.unshift(item);
    const cap = maxVisible();
    while (this.items.filter((it) => !it.leaving).length > cap) {
      const old = [...this.items].reverse().find((it) => !it.leaving);
      this.remove(old);
    }
  }

  remove(it) {
    if (!it || it.leaving) return;
    it.leaving = true;
    it.el.classList.add('is-leaving');
    setTimeout(() => {
      it.el.remove();
      this.items = this.items.filter((x) => x !== it);
    }, 420);
  }

  clear() {
    for (const it of this.items) it.el.remove();
    this.items = [];
  }

  update() {
    if (this.hover || !this.items.length) return;
    const now = performance.now() / 1000;
    for (const it of this.items) if (!it.leaving && now - it.born > LIFETIME) this.remove(it);
  }
}
