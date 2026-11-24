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
  age: { icon: 'eclipse', tint: '#e6c98a' },
};
const MINOR = /legendar|forged|\bhero\b|is born|completes its|raises a|reaches level|earns the title|named the/i;
export function isMinor(n) {
  return n?.minor === true || (n?.kind !== 'war' && n?.kind !== 'disaster' && n?.kind !== 'age' && MINOR.test(String(n?.text || '')));
}
export const FILTERS = [
  { id: 'all', name: 'All' },
  { id: 'war', name: 'Wars' },
  { id: 'disaster', name: 'Disasters' },
  { id: 'realm', name: 'Realms' },
  { id: 'settle', name: 'Settlements' },
  { id: 'age', name: 'Ages' },
  // (round 29) "Other" held 64 of 73 entries: technology, trade and daily
  // life have filters of their own
  { id: 'tech', name: 'Technology' },
  { id: 'trade', name: 'Trade' },
  { id: 'life', name: 'Daily life' },
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
  [/\bfirst\b|master|discover|learn|invent|research|enters? the .*\b(age|era)\b|\bera\b|launch|satellite|starship|space|survey|explorers|chart/, 'tech', 'chronicle'],
  [/trade|caravan|market|merchant|cargo|goods|harbor|\bport\b|convoy|ships?\b|shipment|fleet|galley|sails?\b|ferry|truck|train|rail/, 'trade', 'cart'],
  [/marr|\bwed|is born|festival|feast|\bfair\b|people|culture|become the|emerges|hero|legend|earns the title|reaches level|named the|sing|danc|wander|healer|school|lesson/, 'life', 'spawn-human'],
  [/plenty|harvest|granar/, 'settle', 'bountiful-harvest'],
  [/grown into|becomes a (town|city)/, 'settle', 'found-kingdom'],
  [/abandoned|razed/, 'settle', 'raze'],
  [/village|town|city|settlers|hamlet|found/, 'settle', 'found-village'],
  [/raises a|completes|builds|built/, 'settle', 'build'],
];

// Realms whose names are plural ("Gravby Holds", "Isles of Ruareva", "Sands of
// Sulesh") take plural verbs: "Isles of Ruareva enter the Bronze Age", "Gravby
// Holds are at war". (Real countries keep the usual singular: "the United
// States is".) Only a verb right after the name changes.
const PLURAL_REALM = /\b((?:Free Shires|Sands|Shieldlands|Riverlands|Isles) of [A-Z][\p{L}'’-]+(?: [A-Z][\p{L}'’-]+)?|[A-Z][\p{L}'’-]+ Holds)(’s?| )(is|has|was|does|[a-z]{2,}(?:ches|shes|sses|xes|zzes|ies|s))\b/gu;
const IRREGULAR = { is: 'are', has: 'have', was: 'were', does: 'do' };
// (words after a name that end in -s but are not verbs here)
const NOT_VERB = new Set(['its', 'this', 'towns', 'villages', 'cities', 'borders', 'people', 'armies', 'ships', 'forces', 'troops', 'settlers', 'scholars', 'farmers', 'workers', 'walls', 'fields', 'mines', 'roads', 'riches', 'stores', 'kings', 'queens', 'chiefs', 'heirs', 'nobles', 'allies', 'rivals', 'enemies', 'neighbors', 'capitals', 'colonies', 'provinces', 'princes', 'banners', 'gods', 'relics', 'wonders', 'treasures', 'arts', 'plus', 'as', 'was', 'has', 'is', 'does', 'yes', 'thus', 'always', 'perhaps']);
export function pluralRealmVerbs(text) {
  return String(text).replace(PLURAL_REALM, (m, name, sep, verb) => {
    if (sep !== ' ') return m;
    if (IRREGULAR[verb]) return `${name} ${IRREGULAR[verb]}`;
    if (NOT_VERB.has(verb)) return m;
    let base = verb;
    if (/ies$/.test(verb)) base = verb.slice(0, -3) + 'y';
    else if (/(ch|sh|ss|x|zz)es$/.test(verb)) base = verb.slice(0, -2);
    else if (/[^s]s$/.test(verb)) base = verb.slice(0, -1);
    else return m;
    return `${name} ${base}`;
  });
}

export function classify(n) {
  let text = pluralRealmVerbs(String(n?.text ?? ''));
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
  if (kind === 'age') {
    cat = 'age';
    icon = 'eclipse';
  }
  if (!cat) cat = kind === 'war' ? 'war' : kind === 'disaster' ? 'disaster' : 'other';
  if (kind === 'war' && cat !== 'war' && cat !== 'realm') cat = 'war';
  let tint = KINDS[kind].tint;
  if (kind === 'age' && n?.color != null) tint = '#' + (n.color >>> 0).toString(16).padStart(6, '0');
  return { text, icon: icon || KINDS[kind].icon, cat, kind, tint };
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
    // (round 35) the chips sit on up to two rows, the fullest filters first
    // (one sideways row showed 3 of 7 and hid Technology, 18 entries)
    this.frows = [el('div', { class: 'ws-chron__frow' }), el('div', { class: 'ws-chron__frow' })];
    pills.append(...this.frows);
    for (const f of FILTERS) {
      const b = el(
        'button',
        {
          class: 'ws-cpill' + (f.id === this.filter ? ' is-on' : ''),
          type: 'button',
          role: 'tab',
          'aria-selected': f.id === this.filter ? 'true' : 'false',
          onclick: () => this.setFilter(f.id),
        },
        el('span', { text: f.name }),
        el('b', { text: '0' }),
      );
      this.pills.set(f.id, b);
      this.frows[0].append(b);
    }
    // (round 33) the filters are one sideways row that never shrinks (as a
    // flex item with overflow hidden it was squeezed to 6 px by a full book),
    // with arrows and edge fades on the side that has more chips
    pills.setAttribute('aria-label', 'Filter entries');
    const nav = (dir) =>
      el('button', {
        class: `ws-chron__fnav is-${dir}`,
        type: 'button',
        tabindex: '-1',
        'aria-hidden': 'true',
        html: uiIcon(dir === 'l' ? 'chev-left' : 'chev-right'),
        onclick: () => {
          const from = pills.scrollLeft,
            to = from + (dir === 'l' ? -1 : 1) * Math.max(110, pills.clientWidth * 0.66);
          pills.scrollTo({ left: to, behavior: 'smooth' });
          // (a busy frame can hold a smooth scroll back: then it jumps)
          setTimeout(() => {
            if (Math.abs(pills.scrollLeft - from) < 2) pills.scrollLeft = to;
            this.syncFilterEdges();
          }, 400);
        },
      });
    this.filterBar = el('div', { class: 'ws-chron__filterbar' }, pills, nav('l'), nav('r'));
    this.pillRow = pills;
    pills.addEventListener('scroll', () => this.syncFilterEdges(), { passive: true });
    // a mouse wheel over the row scrolls it sideways
    pills.addEventListener(
      'wheel',
      (e) => {
        if (pills.scrollWidth <= pills.clientWidth + 1 || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
        pills.scrollLeft += e.deltaY;
        e.preventDefault();
      },
      { passive: false },
    );
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => this.syncFilterEdges()).observe(pills);
    this.list = el('div', { class: 'ws-chron__list' });
    this.empty = el('div', { class: 'ws-empty ws-chron__empty' }, el('div', { class: 'ws-empty__art', html: uiIcon('chronicle') }), el('div', { class: 'ws-empty__title', text: 'The pages are blank' }), el('p', { class: 'ws-empty__txt', text: 'Wars, disasters and the rise of realms will be written here as they happen.' }));
    this.el.append(
      el(
        'header',
        { class: 'ws-side__head' },
        el('span', { class: 'ws-modal__ico', html: uiIcon('chronicle') }),
        el('h2', { class: 'ws-modal__title', text: 'Chronicle' }),
        this.countEl,
        el('button', { class: 'ws-iconbtn ws-iconbtn--sm', type: 'button', 'aria-label': 'Close (J)', html: uiIcon('close'), onclick: () => this.toggle(false) }),
      ),
      this.filterBar,
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
    if (open && this.ui.favPanel?.open) this.ui.favPanel.toggle(false);
    this.el.classList.toggle('is-open', open);
    this.ui.root.classList.toggle('has-side', open || this.ui.kingdoms.open || !!this.ui.favPanel?.open);
    if (open) this.renderAll();
  }

  add(n) {
    const c = classify(n);
    const t = this.game.time;
    const e = { ...c, x: n.x, z: n.z, year: Math.floor(t.year) + 1, season: seasonOf(t.year), raw: n };
    // (round 31) "X learns Y" was 77% of the book: one line per realm and
    // year ("Elderley March learns Writing, Masonry and Pottery")
    const lm = c.cat === 'tech' && /^(.+?) learns (.+?)\.?$/.exec(c.text);
    if (lm) {
      e.fold = { realm: lm[1], arts: [lm[2]] };
      const prev = this.entries.slice(0, 40).find((o) => o.fold && o.fold.realm === lm[1] && o.year === e.year);
      if (prev) {
        if (!prev.fold.arts.includes(lm[2])) prev.fold.arts.push(lm[2]);
        const a = prev.fold.arts;
        prev.text = `${lm[1]} learns ${a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}` : a[0]}`;
        prev.season = e.season;
        if (prev.row?.isConnected) prev.row.querySelector('.ws-crow__txt').innerHTML = esc(prev.text);
        return prev;
      }
    }
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
    // (round 31) a filter with nothing in it is not shown ("Ages 0")
    for (const [id, b] of this.pills) {
      b.querySelector('b').textContent = counts[id] || 0;
      b.hidden = id !== 'all' && id !== this.filter && !counts[id];
    }
    this.counts = counts;
    this.layoutPills();
    this.syncFilterEdges();
  }

  // (round 35) All first, then the filters with the most entries, on one row
  // when they fit and else on two rows split where the longer row is
  // shortest; on a short screen (phone landscape) one sideways row
  layoutPills() {
    if (!this.open || !this.frows) return;
    const counts = this.counts || {};
    const order = FILTERS.map((f, i) => [f.id, i])
      .filter(([id]) => !this.pills.get(id).hidden)
      .sort((a, b) => (a[0] === 'all' ? -1 : b[0] === 'all' ? 1 : (counts[b[0]] || 0) - (counts[a[0]] || 0) || a[1] - b[1]))
      .map(([id]) => id);
    const box = this.pillRow.clientWidth;
    const twoRows = innerHeight > 500;
    const key = `${order.join(',')}|${order.map((id) => String(counts[id] || 0).length).join('')}|${box}|${twoRows}`;
    if (key === this._pillKey) return;
    this._pillKey = key;
    const chips = order.map((id) => this.pills.get(id));
    // measured on one row, in this order
    this.frows[0].append(...chips);
    const gap = 4;
    const w = chips.map((b) => b.offsetWidth);
    const n = chips.length;
    const total = w.reduce((s, x) => s + x, 0) + gap * Math.max(0, n - 1);
    // the second row's chips, as a bit mask (All always on the first row);
    // each row keeps the count order, and of the splits whose longer row is
    // shortest the one keeping the fuller filters on the first row wins
    let mask = 0;
    if (twoRows && total > box && n > 1) {
      let best = Infinity;
      // (bit 0 is All: odd masks would move it, so they are skipped)
      for (let m = 2; m < 1 << n; m += 2) {
        let a = 0,
          b = 0,
          na = 0,
          nb = 0,
          rank = 0;
        for (let i = 0; i < n; i++)
          if (m & (1 << i)) (b += w[i]), nb++, (rank += n - i);
          else (a += w[i]), na++;
        const longer = Math.max(a + gap * Math.max(0, na - 1), b + gap * Math.max(0, nb - 1));
        // past the box a row scrolls: a fit comes first, then the fuller
        // filters up top, then the shorter longer row
        const cost = (longer > box ? 1e6 + longer * 100 : 0) + rank * 10 + longer * 0.01;
        if (cost < best) (best = cost), (mask = m);
      }
    }
    const second = chips.filter((_, i) => mask & (1 << i));
    this.frows[0].append(...chips.filter((_, i) => !(mask & (1 << i))));
    this.frows[1].append(...second);
    this.frows[1].hidden = !second.length;
  }

  // which ends of the filter row hide more chips (arrow and fade on that side)
  syncFilterEdges() {
    const p = this.pillRow;
    if (!p || !this.open) return;
    const max = p.scrollWidth - p.clientWidth;
    this.filterBar.classList.toggle('has-l', max > 1 && p.scrollLeft > 2);
    this.filterBar.classList.toggle('has-r', max > 1 && p.scrollLeft < max - 2);
  }

  setFilter(id) {
    this.filter = id;
    for (const [fid, b] of this.pills) {
      b.classList.toggle('is-on', fid === id);
      b.setAttribute('aria-selected', fid === id ? 'true' : 'false');
    }
    this.renderAll();
    // the chosen filter comes fully into view
    const b = this.pills.get(id);
    const p = this.pillRow;
    if (b && p) {
      const pr = p.getBoundingClientRect(),
        br = b.getBoundingClientRect();
      const l = br.left - pr.left + p.scrollLeft,
        r = l + br.width;
      if (l < p.scrollLeft + 28) p.scrollLeft = Math.max(0, l - 28);
      else if (r > p.scrollLeft + p.clientWidth - 28) p.scrollLeft = r - p.clientWidth + 28;
      this.syncFilterEdges();
    }
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
    e.row = r;
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
