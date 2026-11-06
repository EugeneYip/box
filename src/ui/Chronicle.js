import { uiIcon } from './icons.js';
import { el, esc } from './dom.js';

// World chronicle: every notification (and civ history when exposed) is kept,
// classified into a category with a consistent line icon, and listed in a
// filterable panel. The feed shows the newest entries; this keeps them all.

export const KINDS = {
  info: { icon: 'info', tint: '#9cc8ff' },
  good: { icon: 'good', tint: '#8fe3a0' },
  bad: { icon: 'bad', tint: '#ffbf6a' },
  war: { icon: 'war', tint: '#ff7a6e' },
  disaster: { icon: 'disaster', tint: '#ff8a4a' },
};
export const FILTERS = [
  { id: 'all', name: 'All' },
  { id: 'war', name: 'Wars' },
  { id: 'disaster', name: 'Disasters' },
  { id: 'realm', name: 'Realms' },
  { id: 'settle', name: 'Settlements' },
  { id: 'other', name: 'Other' },
];
const EMOJI_ICON = { '🤝': 'alliance', '⚔': 'war', '🕊': 'make-peace', '🔥': 'fire', '⚑': 'banner', '✊': 'rebellion', '✨': 'golden-age', '👑': 'crown', '💀': 'kill' };
const EMOJI = /[←-⇿⌀-➿⤀-⯿\u{1F000}-\u{1FAFF}️‍]/gu;
const RULES = [
  // [regex, category, icon]
  [/declares? war|joins the war|at war/, 'war', 'declare-war'],
  [/rebellion|rebels?\b|rises in/, 'war', 'rebellion'],
  [/put to the torch|burn/, 'war', 'fire'],
  [/conquered|falls!|captured/, 'war', 'banner'],
  [/army|armies|routed|marches|siege|battle/, 'war', 'job-soldier'],
  [/meteor/, 'disaster', 'meteor'],
  [/quake|tremor/, 'disaster', 'earthquake'],
  [/tornado|whirlwind/, 'disaster', 'tornado'],
  [/volcan|erupt|lava/, 'disaster', 'volcano'],
  [/plague|disease|sickness/, 'disaster', 'plague'],
  [/flood|great wave|tsunami/, 'disaster', 'flood'],
  [/lightning|storm/, 'disaster', 'lightning'],
  [/wildfire|blaze|fire|inferno/, 'disaster', 'fire'],
  [/awoken|awakens|monster|golem|wyrm/, 'disaster', 'spawn-dragon'],
  [/famine|starv/, 'disaster', 'bad'],
  [/peace treaty|sign a peace|make peace|lay down/, 'realm', 'make-peace'],
  [/alliance/, 'realm', 'alliance'],
  [/golden age/, 'realm', 'golden-age'],
  [/throne|heir|succession|crowned|reign/, 'realm', 'crown'],
  [/has fallen|absorbed|is no more|collapses/, 'realm', 'kill'],
  [/moves its capital|capital/, 'realm', 'banner'],
  [/is founded at|strike out on their own|proclaim|new realm|kingdom of/, 'realm', 'banner'],
  [/plenty|harvest|granar/, 'settle', 'bountiful-harvest'],
  [/grown into|becomes a (town|city)/, 'settle', 'found-kingdom'],
  [/abandoned|razed/, 'settle', 'raze'],
  [/village|town|city|settlers|hamlet|found/, 'settle', 'found-village'],
  [/raises a|completes|builds|built/, 'settle', 'build'],
];

export function classify(n) {
  let text = String(n?.text ?? '');
  let icon = null;
  const lead = text.match(/^\s*((?:[←-⇿⌀-➿⤀-⯿\u{1F000}-\u{1FAFF}][️‍]*)+)\s*/u);
  if (lead) {
    icon = EMOJI_ICON[lead[1].replace(/[️‍]/g, '')] || null;
    text = text.slice(lead[0].length);
  }
  text = text.replace(EMOJI, '').replace(/\s{2,}/g, ' ').trim();
  const t = text.toLowerCase();
  let cat = null;
  for (const [re, c, ic] of RULES) {
    if (re.test(t)) {
      cat = c;
      icon = icon || ic;
      break;
    }
  }
  const kind = KINDS[n?.kind] ? n.kind : 'info';
  if (!cat) cat = kind === 'war' ? 'war' : kind === 'disaster' ? 'disaster' : 'other';
  if (kind === 'war' && cat !== 'war' && cat !== 'realm') cat = 'war';
  return { text, icon: icon || KINDS[kind].icon, cat, kind, tint: KINDS[kind].tint };
}

export function seasonOf(yearFloat) {
  const f = ((yearFloat % 1) + 1) % 1;
  return ['Spring', 'Summer', 'Autumn', 'Winter'][Math.min(3, Math.floor(f * 4))];
}

export class ChroniclePanel {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.entries = [];
    this.filter = 'all';
    this.el = el('aside', { class: 'ws-side ws-chron ws-glass ws-orn', 'aria-label': 'Chronicle' });
    this.countEl = el('span', { class: 'ws-side__count', text: '0' });
    this.pills = new Map();
    const pills = el('div', { class: 'ws-chron__filters', role: 'tablist' });
    for (const f of FILTERS) {
      const b = el(
        'button',
        {
          class: 'ws-cpill' + (f.id === this.filter ? ' is-on' : ''),
          type: 'button',
          role: 'tab',
          onclick: () => this.setFilter(f.id),
        },
        el('span', { text: f.name }),
        el('b', { text: '0' }),
      );
      this.pills.set(f.id, b);
      pills.append(b);
    }
    this.list = el('div', { class: 'ws-chron__list' });
    this.empty = el('div', { class: 'ws-empty ws-chron__empty' }, el('div', { class: 'ws-empty__art', html: uiIcon('chronicle') }), el('div', { class: 'ws-empty__title', text: 'The pages are blank' }), el('p', { class: 'ws-empty__txt', text: 'Wars, disasters and the rise of kingdoms will be written here as they happen.' }));
    this.el.append(
      el(
        'header',
        { class: 'ws-side__head' },
        el('span', { class: 'ws-modal__ico', html: uiIcon('chronicle') }),
        el('h2', { class: 'ws-modal__title', text: 'Chronicle' }),
        this.countEl,
        el('button', { class: 'ws-iconbtn ws-iconbtn--sm', type: 'button', 'aria-label': 'Close (J)', html: uiIcon('close'), onclick: () => this.toggle(false) }),
      ),
      pills,
      this.list,
      this.empty,
    );
    this.list.addEventListener('click', (e) => {
      const row = e.target.closest('[data-x]');
      if (!row) return;
      this.game.cameraRig.follow = null;
      this.game.focus(+row.dataset.x, +row.dataset.z, Math.min(this.game.cameraRig.goal.dist, 46));
      this.game.audio?.play?.('ui-click', { volume: 0.45 });
    });
  }

  get open() {
    return this.el.classList.contains('is-open');
  }
  toggle(force) {
    const open = force ?? !this.open;
    if (open && this.ui.kingdoms.open) this.ui.kingdoms.toggle(false);
    this.el.classList.toggle('is-open', open);
    this.ui.root.classList.toggle('has-side', open || this.ui.kingdoms.open);
    if (open) this.renderAll();
  }

  add(n) {
    const c = classify(n);
    const t = this.game.time;
    const e = { ...c, x: n.x, z: n.z, year: Math.floor(t.year) + 1, season: seasonOf(t.year), raw: n };
    this.entries.unshift(e);
    if (this.entries.length > 500) this.entries.length = 500;
    this.countEl.textContent = String(this.entries.length);
    this.updateCounts();
    if (this.open && (this.filter === 'all' || this.filter === e.cat)) {
      this.list.prepend(this.row(e, true));
      while (this.list.childElementCount > 160) this.list.lastChild.remove();
      this.empty.hidden = true;
    }
    return e;
  }

  updateCounts() {
    const counts = { all: this.entries.length };
    for (const e of this.entries) counts[e.cat] = (counts[e.cat] || 0) + 1;
    for (const [id, b] of this.pills) b.querySelector('b').textContent = counts[id] || 0;
  }

  setFilter(id) {
    this.filter = id;
    for (const [fid, b] of this.pills) b.classList.toggle('is-on', fid === id);
    this.renderAll();
    this.game.audio?.play?.('ui-click', { volume: 0.4 });
  }

  row(e, fresh = false) {
    const pos = e.x != null && e.z != null && !Number.isNaN(+e.x);
    const r = el(
      pos ? 'button' : 'div',
      { class: `ws-crow is-${e.kind}${fresh ? ' is-fresh' : ''}`, type: pos ? 'button' : null, style: `--tint:${e.tint}`, 'data-x': pos ? e.x : null, 'data-z': pos ? e.z : null },
      el('span', { class: 'ws-crow__ico', html: uiIcon(e.icon) }),
      el('span', { class: 'ws-crow__txt', html: esc(e.text) }),
      el('span', { class: 'ws-crow__meta' }, el('span', { text: `Y${e.year}` }), el('small', { text: e.season }), pos ? el('span', { class: 'ws-crow__go', html: uiIcon('locate') }) : null),
    );
    return r;
  }

  renderAll() {
    this.list.innerHTML = '';
    const list = this.entries.filter((e) => this.filter === 'all' || e.cat === this.filter).slice(0, 160);
    const frag = document.createDocumentFragment();
    for (const e of list) frag.append(this.row(e));
    this.list.append(frag);
    this.empty.hidden = list.length > 0;
    this.updateCounts();
  }

  update() {}
}
