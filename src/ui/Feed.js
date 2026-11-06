import { uiIcon } from './icons.js';
import { el, esc } from './dom.js';

const KINDS = {
  info: { icon: 'info', tint: '#9cc8ff', label: 'News' },
  good: { icon: 'good', tint: '#8fe3a0', label: 'Blessing' },
  bad: { icon: 'bad', tint: '#ffbf6a', label: 'Trouble' },
  war: { icon: 'war', tint: '#ff7a6e', label: 'War' },
  disaster: { icon: 'disaster', tint: '#ff8a4a', label: 'Disaster' },
};
const MAX_VISIBLE = 5;
const LIFETIME = 9; // seconds before an entry fades

// World chronicle: short cards for 'notify' events. Clicking a card with a
// position focuses the camera there. Hovering the feed holds the fade.
export class Feed {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = el('div', { class: 'ws-feed', 'aria-live': 'polite' });
    this.items = [];
    this.history = [];
    this.hover = false;
    this.el.addEventListener('pointerenter', () => (this.hover = true));
    this.el.addEventListener('pointerleave', () => (this.hover = false));
    this.game.events.on('notify', (n) => this.push(n));
  }

  push(n) {
    if (!n || !n.text) return;
    const kind = KINDS[n.kind] ? n.kind : 'info';
    const now = performance.now() / 1000;
    // collapse rapid duplicates into a counter
    const dup = this.items.find((it) => it.text === n.text && now - it.born < 6 && !it.leaving);
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
    const K = KINDS[kind];
    const hasPos = n.x != null && n.z != null && !Number.isNaN(+n.x);
    const year = Math.floor(this.game.time.year) + 1;
    const countEl = el('span', { class: 'ws-feed__count', hidden: true });
    const card = el(
      hasPos ? 'button' : 'div',
      {
        class: `ws-feed__item ws-glass is-${kind}${hasPos ? ' is-link' : ''}`,
        style: `--tint:${K.tint}`,
        type: hasPos ? 'button' : null,
        'aria-label': hasPos ? `${n.text} — show on map` : null,
      },
      el('span', { class: 'ws-feed__ico', html: uiIcon(K.icon) }),
      el('span', { class: 'ws-feed__txt', html: esc(n.text) }),
      el('span', { class: 'ws-feed__meta' }, countEl, el('span', { class: 'ws-feed__year', text: `Y${year}` }), hasPos ? el('span', { class: 'ws-feed__go', html: uiIcon('locate') }) : null),
    );
    const item = { el: card, text: n.text, born: now, count: 1, countEl, leaving: false };
    if (hasPos) {
      card.addEventListener('click', () => {
        this.game.focus(+n.x, +n.z, Math.min(this.game.cameraRig.goal.dist, 46));
        this.game.cameraRig.follow = null;
        this.game.audio?.play?.('ui-click', { volume: 0.45 });
      });
    }
    this.el.prepend(card);
    this.items.unshift(item);
    this.history.unshift({ ...n, kind, year });
    if (this.history.length > 80) this.history.length = 80;
    while (this.items.filter((it) => !it.leaving).length > MAX_VISIBLE) {
      const old = [...this.items].reverse().find((it) => !it.leaving);
      this.remove(old);
    }
    if (kind === 'war' || kind === 'disaster') this.game.audio?.play?.(kind === 'war' ? 'war-horn' : 'bell', { volume: 0.25 });
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
