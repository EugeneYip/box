import { el, safe, hexCss, fmtNum } from './dom.js';
import { getPower } from '../powers/registry.js';
import { uiIcon } from './icons.js';
import { bannerURL } from './banner.js';
import { eraNames, prettyId } from './depth.js';
import { eraOf, researchOf } from './TechPanel.js';

// Favorites panel (P, or the star in the top bar): everything the player has
// starred, in groups, refreshed once a second while open. A row shows who or
// what it is, where it belongs, what it is doing and how it fares; clicking it
// selects it, opens its card and flies there. Follow and Unstar sit beside it.
const GROUPS = [
  ['unit', 'Creatures'],
  ['village', 'Villages'],
  ['realm', 'Realms'],
  ['vehicle', 'Vehicles'],
];
const GONE_WORD = { unit: 'Died', village: 'Abandoned', realm: 'Fell', vehicle: 'Lost' };
const NOUN = { unit: 'creature', village: 'village', realm: 'realm', vehicle: 'vehicle' };
const JOB_ROLE = { king: 'ruler' };
const isPhone = () => matchMedia('(max-width: 720px)').matches;

export class FavoritesPanel {
  constructor(ui, store) {
    this.ui = ui;
    this.game = ui.game;
    this.store = store;
    store.describe = (e) => this.info(e);
    this.el = el('aside', { class: 'ws-side ws-glass ws-orn ws-favs', 'aria-label': 'Favorites' });
    this.countEl = el('span', { class: 'ws-side__count', text: '0' });
    this.list = el('div', { class: 'ws-side__list ws-favs__list', role: 'list' });
    // the list's bottom edge fades while more rows lie below it
    this._more = () => this.list.classList.toggle('has-more', this.list.scrollTop + this.list.clientHeight < this.list.scrollHeight - 4);
    this.list.addEventListener('scroll', this._more, { passive: true });
    this.empty = el(
      'div',
      { class: 'ws-empty ws-favs__empty' },
      el('div', { class: 'ws-empty__art', html: uiIcon('star') }),
      el('div', { class: 'ws-empty__title', text: 'No favorites yet' }),
      el('p', { class: 'ws-empty__txt', html: `Inspect a creature, village, realm or vehicle, then press the star ${uiIcon('star')} at the top of its card. Starred things gather here, so you can find them again and follow their story.` }),
      el('button', {
        class: 'ws-btn ws-btn--gold ws-btn--sm',
        type: 'button',
        html: `${uiIcon('inspect')}<span>Inspect something</span>`,
        onclick: () => this.pickInspect(),
      }),
    );
    this.el.append(
      el(
        'header',
        { class: 'ws-side__head' },
        el('span', { class: 'ws-modal__ico ws-favs__ico', html: uiIcon('star-on') }),
        el('h2', { class: 'ws-modal__title', text: 'Favorites' }),
        this.countEl,
        el('button', { class: 'ws-iconbtn ws-iconbtn--sm', type: 'button', 'aria-label': 'Close (P)', 'data-tip': 'Close · P', html: uiIcon('close'), onclick: () => this.toggle(false) }),
      ),
      this.list,
      this.empty,
    );
    this.groups = new Map();
    for (const [kind, label] of GROUPS) {
      const count = el('small');
      const head = el('h5', { class: 'ws-favs__group', role: 'presentation' }, el('span', { text: label }), count);
      const box = el('div', { class: 'ws-favs__rows', role: 'presentation' });
      const wrap = el('section', { class: 'ws-favs__sect', role: 'presentation', hidden: true }, head, box);
      this.list.append(wrap);
      this.groups.set(kind, { wrap, box, count });
    }
    this.rows = new Map();
    this._t = 0;
    this._pT = 0;
    this._ver = -1;
    this.list.addEventListener('click', (e) => this.onClick(e));
    // a row just unstarred keeps its place (and its Undo) while the pointer is
    // over the list, so nothing moves under it; it goes once the pointer leaves
    this.list.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'touch') this._hover = true;
    });
    this.list.addEventListener('pointerleave', () => {
      this._hover = false;
    });
    this.list.addEventListener('keydown', (e) => this.onKeyDown(e));
    // phones: one sheet at a time, so the inspector is never hidden under this
    this.game.events.on('inspect', () => {
      if (this.open && isPhone()) this.toggle(false);
    });
  }

  get open() {
    return this.el.classList.contains('is-open');
  }
  toggle(force) {
    const ui = this.ui;
    const open = force ?? !this.open;
    if (open) {
      if (ui.kingdoms?.open) ui.kingdoms.toggle(false);
      if (ui.chronicle?.open) ui.chronicle.toggle(false);
      // phones: the inspector sheet makes way for the list
      if (isPhone() && ui.inspector?.open) ui.inspector.close();
    }
    if (!open && this.pending?.size) {
      this.pending.clear();
      this.render();
    }
    this.el.classList.toggle('is-open', open);
    if (!open) this.tail?.classList.remove('is-shown');
    ui.root.classList.toggle('has-side', open || !!ui.kingdoms?.open || !!ui.chronicle?.open);
    if (ui.favBtn) {
      ui.favBtn.classList.toggle('is-on', open);
      ui.favBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (open) {
      safe(() => this.store.adopt(), null, 'favorites adopt');
      this._t = 0;
      this.render();
      safe(() => this.place(), null, 'favorites place');
    }
  }

  // (round 29) on desktop the panel stands above the power tray wherever the
  // two overlap side to side (at 1280 x 720 its bottom row slid under the
  // tray); elsewhere it keeps its place above the Favorites button
  place() {
    const st = this.el.style;
    const desk = matchMedia('(min-width: 721px) and (min-height: 501px)').matches;
    // the tray's visible panel (the dock's own box also spans a hidden
    // power bar above it), or the power bar when one is shown
    const tb = this.ui.toolbar;
    let t = desk && tb?.panel ? tb.panel.getBoundingClientRect() : null;
    const br = tb?.brush?.el;
    if (t && br?.classList.contains('is-shown')) {
      const b = br.getBoundingClientRect();
      if (b.height > 0 && b.top < t.top) t = { left: Math.min(t.left, b.left), right: Math.max(t.right, b.right), top: b.top, width: Math.max(t.right, b.right) - Math.min(t.left, b.left), height: t.bottom - b.top };
    }
    const r = this.el.getBoundingClientRect();
    const H = innerHeight;
    if (t && t.width > 40 && t.height > 20 && t.top < H && t.left < r.right + 10 && t.right > r.left - 10) {
      const bottom = Math.ceil(H - t.top + 10);
      const maxH = Math.max(160, Math.floor(t.top - 10 - 104));
      if (st.bottom !== bottom + 'px') st.bottom = bottom + 'px';
      if (st.maxHeight !== maxH + 'px') st.maxHeight = maxH + 'px';
      this.placeTail(true);
    } else {
      if (st.bottom) st.removeProperty('bottom');
      if (st.maxHeight) st.removeProperty('max-height');
      this.placeTail(false);
    }
  }

  // (round 31) lifted above the tray, the panel keeps a short stem down to
  // its own button (it floated 74 px above it with nothing joining them)
  placeTail(on) {
    if (!this.tail) {
      this.tail = document.createElement('i');
      this.tail.className = 'ws-favs__tail';
      this.tail.setAttribute('aria-hidden', 'true');
      this.el.parentElement?.append(this.tail);
    }
    const btn = on && this.open ? this.ui.root.querySelector('.ws-favbtn') : null;
    const pr = this.el.getBoundingClientRect();
    const br = btn?.getBoundingClientRect();
    const gap = br ? br.top - pr.bottom : 0;
    if (!br || br.width < 4 || gap < 6) {
      this.tail.classList.remove('is-shown');
      return;
    }
    const x = Math.round(Math.max(pr.left + 18, Math.min(pr.right - 18, br.left + 26)));
    Object.assign(this.tail.style, { left: `${x}px`, top: `${Math.round(pr.bottom)}px`, height: `${Math.round(gap)}px` });
    this.tail.classList.add('is-shown');
  }

  pickInspect() {
    const g = this.game;
    const p = getPower('inspect');
    if (p && g.activePower !== p) {
      safe(() => g.selectPower(p), null, 'inspect power');
      safe(() => this.ui.toolbar.setCategory(p.category, { quiet: true }), null, 'inspect tab');
    }
    if (isPhone()) this.toggle(false);
    this.ui.toast(this.ui.root.classList.contains('is-touch') ? 'Tap anything in the world to inspect it' : 'Click anything in the world to inspect it', 2600);
  }

  // ---- what a row says
  info(e) {
    const g = this.game;
    const civ = g.civ;
    const r = e.ref;
    const kname = (id) => (id != null && id >= 0 ? safe(() => civ?.kingdomName?.(id), null) || civ?.kingdoms?.[id]?.name || null : null);
    const kcolor = (id) => (id != null && id >= 0 ? hexCss(safe(() => civ?.kingdomColor?.(id), null) ?? civ?.kingdoms?.[id]?.color, null) : null);
    if (!r || e.missing || e.died != null) {
      const s = e.snap || {};
      return {
        name: e.name || prettyId(NOUN[e.kind]),
        sub: s.sub || '',
        place: s.place || '',
        color: s.color || null,
        doing: e.missing ? 'Not in this world' : `${GONE_WORD[e.kind]} in Year ${e.died}`,
        gone: true,
      };
    }
    if (e.kind === 'unit') {
      const u = r;
      const def = u.def || {};
      const child = def.kind === 'humanoid' && u.age < (def.maturity ?? 0);
      let role = null;
      if (def.kind === 'humanoid') {
        const ro = safe(() => g.units?.roleOf?.(u), null);
        role = child ? 'child' : JOB_ROLE[u.job] || (ro && ro !== u.job ? ro : u.job) || 'villager';
      }
      const species = def.name || prettyId(u.species || 'creature');
      const vName = u.village != null && u.village >= 0 ? civ?.villages?.[u.village]?.name : null;
      const kn = kname(u.kingdom);
      return {
        name: u.name || species,
        sub: role ? `${species} ${String(role).toLowerCase()}` : species,
        place: [vName, kn].filter(Boolean).join(' · ') || (def.kind === 'humanoid' ? 'Wanderer' : 'In the wild'),
        color: kcolor(u.kingdom),
        doing: safe(() => g.units?.activityLabel?.(u), null) || 'Resting',
        meter: u.maxHp > 0 ? { v: Math.max(0, Math.min(1, u.hp / u.maxHp)), text: `${Math.ceil(Math.max(0, u.hp))} / ${Math.ceil(u.maxHp)}`, label: 'Health', cls: 'is-hp' } : null,
        level: Number.isFinite(u.level) && u.level > 1 ? u.level : null,
      };
    }
    if (e.kind === 'village') {
      const v = r;
      const tier = ['Village', 'Town', 'City'][v.tier] || 'Village';
      const k = civ?.kingdoms?.[v.kingdom];
      const war = k ? safe(() => civ.enemiesOf?.(k.id)?.length > 0, false) : false;
      let building = 0;
      for (const b of v.buildings || []) if (b?.alive && b.constructing) building++;
      const doing = v.starving ? 'Short of food' : building ? `Raising ${building} building${building > 1 ? 's' : ''}` : war ? 'Its realm is at war' : 'Living in peace';
      return {
        name: v.name || 'Village',
        sub: `${tier} · ${fmtNum(v.pop || 0)} people`,
        place: kname(v.kingdom) || 'Unclaimed',
        color: kcolor(v.kingdom),
        doing,
        // (round 35) a starving town's bar, track and number are amber too
        // (it had only the bar's fill, empty at 0 food: nothing showed)
        meter: v.foodCap > 0 ? { v: Math.max(0, Math.min(1, v.food / v.foodCap)), text: `${Math.floor(v.food)} / ${v.foodCap}`, label: 'Food', cls: v.starving || v.food / v.foodCap < 0.1 ? 'is-bad is-low' : '' } : null,
      };
    }
    if (e.kind === 'realm') {
      const k = r;
      const era = eraOf(g, k);
      const cap = civ?.villages?.[k.capital];
      const wars = safe(() => civ.enemiesOf?.(k.id) || [], []).map((id) => civ.kingdoms?.[id]?.name).filter(Boolean);
      const res = safe(() => researchOf(g, k), null);
      const pop = safe(() => civ._kingdomPop?.(k), null) ?? k.population ?? 0;
      const nV = Array.isArray(k.villages) ? k.villages.length : 0;
      return {
        name: k.name || 'Realm',
        sub: `${eraNames()[era] || ''} era · ${fmtNum(pop)} people`,
        place: [cap?.name ? `Capital ${cap.name}` : null, `${nV} ${nV === 1 ? 'village' : 'villages'}`].filter(Boolean).join(' · '),
        color: hexCss(k.color, null),
        doing: wars.length ? `At war with ${wars.slice(0, 2).join(', ')}${wars.length > 2 ? ` and ${wars.length - 2} more` : ''}` : res ? `At peace · studying ${res.name}` : 'At peace',
        war: wars.length > 0,
      };
    }
    // vehicles
    const v = r;
    const F = g.fleet;
    const home = civ?.villages?.[v.home];
    const doing = v.cls === 'air' || v.cls === 'space' ? (v.cls === 'space' ? 'Climbing to orbit' : v.phase === 'cruise' ? 'Cruising' : v.phase === 'climb' ? 'Climbing away' : 'Coming in to land') : safe(() => F?.doingText?.(v), null) || 'Under way';
    return {
      name: v.name || v.def?.name || 'Vehicle',
      sub: v.def?.name && v.def.name !== v.name ? v.def.name : prettyId(v.kind || 'vehicle'),
      place: [home?.name, kname(v.kingdom)].filter(Boolean).join(' · ') || 'No realm',
      color: kcolor(v.kingdom),
      doing,
      meter: v.maxHp > 0 ? { v: Math.max(0, Math.min(1, v.hp / v.maxHp)), text: `${Math.ceil(Math.max(0, v.hp))} / ${Math.ceil(v.maxHp)}`, label: 'Health', cls: 'is-hp' } : null,
    };
  }

  // The badge: a portrait when one was taken, a banner for a realm, else the
  // inspector's own icon for it.
  badge(e, info) {
    const r = e.ref;
    const ins = this.ui.inspector;
    if (r && !info.gone) {
      if (e.kind === 'realm' && r.banner) return { img: bannerURL(r.banner, r.color, 40), banner: true };
      const p = (e.kind === 'unit' || e.kind === 'vehicle') && ins?.portraits?.get(r);
      if (p) return { img: p };
    }
    const res =
      e.kind === 'unit'
        ? r
          ? { kind: 'unit', unit: r }
          : null
        : e.kind === 'vehicle'
          ? r
            ? { kind: r.cls === 'sea' ? 'vessel' : 'vehicle', vessel: r }
            : { kind: 'vessel', vessel: { cls: 'sea', def: {} } }
          : e.kind === 'village'
            ? { kind: 'village', village: r || { kingdom: -1 } }
            : { kind: 'kingdom', kingdom: r || { id: -1 } };
    const ic = res ? safe(() => ins.iconFor(res), null) : null;
    return { svg: ic?.svg || uiIcon(e.kind === 'unit' ? 'spawn-human' : 'star'), tint: ic?.tint || info.color || '#ebc977' };
  }

  makeRow(e) {
    const R = { sig: {} };
    R.badge = el('span', { class: 'ws-favs__badge' });
    R.name = el('span', { class: 'ws-favs__name' });
    R.lvl = el('i', { class: 'ws-favs__lvl', hidden: true });
    R.sub = el('span', { class: 'ws-favs__sub' });
    R.doing = el('span', { class: 'ws-favs__doing' });
    R.meterBar = el('i');
    R.meterTxt = el('small');
    R.meterLbl = el('b', { class: 'ws-favs__mlbl' });
    R.meter = el('span', { class: 'ws-favs__meter' }, R.meterLbl, el('span', { class: 'ws-meter' }, R.meterBar), R.meterTxt);
    R.main = el(
      'button',
      { class: 'ws-favs__main', type: 'button', 'data-act': 'show' },
      R.badge,
      el('span', { class: 'ws-favs__body' }, el('span', { class: 'ws-favs__line' }, R.name, R.lvl), R.sub),
    );
    // (the status line repeats the row's own action; the main button carries the label)
    R.now = el('button', { class: 'ws-favs__now', type: 'button', 'data-act': 'show', tabindex: '-1', 'aria-hidden': 'true' }, R.doing, R.meter);
    R.follow = el('button', { class: 'ws-iconbtn ws-iconbtn--sm ws-favs__follow', type: 'button', 'data-act': 'follow', html: uiIcon('follow') });
    R.star = el('button', { class: 'ws-iconbtn ws-iconbtn--sm ws-favs__star is-on', type: 'button', 'data-act': 'unstar', html: uiIcon('star-on') });
    R.undo = el('button', { class: 'ws-btn ws-btn--sm ws-favs__undo', type: 'button', 'data-act': 'undo', hidden: true, text: 'Undo' });
    R.el = el('div', { class: 'ws-favs__row', role: 'listitem', 'data-key': e.key }, R.main, el('span', { class: 'ws-favs__acts' }, R.follow, R.star, R.undo), R.now);
    return R;
  }

  render() {
    const store = this.store;
    const all = store.list();
    this.countEl.textContent = String(all.length);
    this.empty.hidden = all.length > 0;
    this.list.hidden = !all.length;
    const rig = this.game.cameraRig;
    const seen = new Set();
    const now = performance.now();
    this.pending ||= new Map();
    this.seq ||= new Map();
    for (const [key, P] of this.pending) if ((now > P.until && !this._hover) || this.store.map.has(key)) this.pending.delete(key);
    const hasAny = all.length > 0 || this.pending.size > 0;
    this.empty.hidden = hasAny;
    this.list.hidden = !hasAny;
    for (const e of all) if (!this.seq.has(e.key)) this.seq.set(e.key, this.seq.size);
    for (const [kind] of GROUPS) {
      const G = this.groups.get(kind);
      // the living first (oldest star first), then the lost; a row just
      // unstarred keeps its place until it fades
      const lost = (e) => (e.died != null || e.missing ? 1 : 0);
      const live = all.filter((e) => e.kind === kind);
      const rows = [...live, ...[...this.pending.values()].filter((P) => P.e.kind === kind).map((P) => P.e)].sort((a, b) => lost(a) - lost(b) || (this.seq.get(a.key) ?? 1e9) - (this.seq.get(b.key) ?? 1e9));
      G.wrap.hidden = !rows.length;
      if (G.count.textContent !== String(live.length)) G.count.textContent = String(live.length);
      let prev = null;
      for (const e of rows) {
        seen.add(e.key);
        let R = this.rows.get(e.key);
        if (!R || R.ref !== e.ref) {
          R?.el.remove();
          R = this.makeRow(e);
          R.ref = e.ref;
          this.rows.set(e.key, R);
        }
        const info = safe(() => this.info(e), null, 'favorite info') || { name: e.name || '?', sub: '', place: '', doing: '', gone: true };
        if (!info.gone) e.snap = { sub: info.sub, place: info.place, color: info.color };
        this.paint(R, e, info, rig);
        const off = this.pending.has(e.key);
        if (R.sig.off !== off) {
          R.sig.off = off;
          R.el.classList.toggle('is-unstarred', off);
          R.star.hidden = off;
          R.undo.hidden = !off;
          R.undo.setAttribute('aria-label', `Undo: star ${info.name} again`);
        }
        const want = prev ? prev.nextSibling : G.box.firstChild;
        if (want !== R.el) G.box.insertBefore(R.el, want);
        prev = R.el;
      }
    }
    for (const [key, R] of this.rows)
      if (!seen.has(key)) {
        // keep keyboard focus in the list when a row goes
        const had = R.el.contains(document.activeElement);
        R.el.remove();
        this.rows.delete(key);
        if (had) (this.list.querySelector('.ws-favs__main') || this.el.querySelector('.ws-side__head button'))?.focus();
      }
    this._ver = store.version;
  }

  paint(R, e, info, rig) {
    const set = (node, key, val) => {
      if (R.sig[key] !== val) {
        R.sig[key] = val;
        node.textContent = val;
      }
    };
    set(R.name, 'name', info.name);
    set(R.sub, 'sub', [info.sub, info.place].filter(Boolean).join(' · '));
    set(R.doing, 'doing', info.doing || '');
    if (R.sig.lvl !== info.level) {
      R.sig.lvl = info.level;
      R.lvl.hidden = !info.level;
      R.lvl.textContent = info.level ? `Lv ${info.level}` : '';
      R.lvl.title = info.level ? `Level ${info.level}` : '';
    }
    const color = info.color || '';
    if (R.sig.color !== color) {
      R.sig.color = color;
      if (color) R.el.style.setProperty('--k', color);
      else R.el.style.removeProperty('--k');
    }
    const gone = !!info.gone;
    if (R.sig.gone !== gone) {
      R.sig.gone = gone;
      R.el.classList.toggle('is-gone', gone);
    }
    if (R.sig.war !== !!info.war) {
      R.sig.war = !!info.war;
      R.el.classList.toggle('is-war', !!info.war);
    }
    const m = info.meter;
    const mKey = m ? `${m.v.toFixed(3)}|${m.text}|${m.cls}` : '';
    if (R.sig.meter !== mKey) {
      R.sig.meter = mKey;
      R.meter.hidden = !m;
      if (m) {
        R.meterBar.style.width = (m.v * 100).toFixed(1) + '%';
        R.meterBar.parentElement.className = `ws-meter ${m.cls || ''}`;
        // each meter says what it measures ("HP", "Food")
        R.meterLbl.textContent = m.label === 'Health' ? 'HP' : m.label;
        R.meterTxt.textContent = m.text;
        R.meter.dataset.tip = `${m.label} ${m.text}`;
        R.meter.setAttribute('aria-label', `${m.label} ${m.text}`);
      }
    }
    const b = this.badge(e, info);
    const bKey = b.img ? `img:${b.img.length}:${b.img.slice(-24)}` : `svg:${b.tint}:${b.svg.length}`;
    if (R.sig.badge !== bKey) {
      R.sig.badge = bKey;
      R.badge.classList.toggle('has-img', !!b.img);
      R.badge.classList.toggle('has-banner', !!b.banner);
      R.badge.style.setProperty('--tint', b.tint || '#ebc977');
      R.badge.innerHTML = b.img ? `<img alt="" src="${b.img}">` : b.svg;
    }
    const canFollow = !gone && (e.kind === 'unit' || e.kind === 'vehicle');
    const following = canFollow && rig.follow === e.ref;
    const fKey = `${canFollow}|${following}`;
    if (R.sig.follow !== fKey) {
      R.sig.follow = fKey;
      R.follow.hidden = !canFollow;
      R.follow.classList.toggle('is-on', following);
      R.follow.setAttribute('aria-label', following ? `Stop following ${info.name}` : `Follow ${info.name}`);
      R.follow.dataset.tip = following ? 'Following · click to stop' : 'Follow';
      R.follow.setAttribute('aria-pressed', following ? 'true' : 'false');
    }
    const label = `${info.name}, ${[info.sub, info.place, info.doing, info.meter ? `${info.meter.label} ${info.meter.text}` : ''].filter(Boolean).join(', ')}`;
    if (R.sig.label !== label) {
      R.sig.label = label;
      R.main.setAttribute('aria-label', gone ? label : `Show ${label}`);
      R.star.setAttribute('aria-label', `Unstar ${info.name}`);
      R.star.dataset.tip = gone ? 'Remove from Favorites' : 'Unstar';
    }
  }

  onClick(ev) {
    const b = ev.target.closest('button[data-act]');
    if (!b) return;
    const row = b.closest('.ws-favs__row');
    if (row && b.dataset.act === 'undo') return this.pending?.get(row.dataset.key)?.back();
    const e = row && this.store.map.get(row.dataset.key);
    if (!e) return;
    const act = b.dataset.act;
    if (act === 'undo') return this.pending?.get(row.dataset.key)?.back();
    if (act === 'unstar') this.unstar(e);
    else if (act === 'follow' && e.ref && this.game.cameraRig.follow === e.ref) {
      this.game.cameraRig.follow = null;
      if (this.ui.inspector?.open) safe(() => this.ui.inspector.render(), null, 'inspector follow');
      this.render();
    } else if (act === 'follow') this.show(e, true);
    else this.show(e);
    this.game.audio?.play?.('ui-click', { volume: 0.45 });
  }
  onKeyDown(ev) {
    const main = ev.target.closest?.('.ws-favs__main');
    if (!main) return;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      const all = [...this.list.querySelectorAll('.ws-favs__main')];
      const i = all.indexOf(main) + (ev.key === 'ArrowDown' ? 1 : -1);
      if (all[i]) all[i].focus();
      ev.preventDefault();
      ev.stopPropagation();
    } else if (ev.key === 'Delete') {
      const e = this.store.map.get(main.closest('.ws-favs__row')?.dataset.key);
      if (e) this.unstar(e);
      ev.preventDefault();
    }
  }

  unstar(e) {
    const info = safe(() => this.info(e), null) || { name: e.name || 'It' };
    const hadFocus = this.rows.get(e.key)?.el.contains(document.activeElement);
    this.store.remove(e.key);
    if (this.ui.inspector?.open) safe(() => this.ui.inspector.render(), null, 'inspector star');
    // the row stays where it was, dimmed, with Undo beside it, so the list
    // never jumps under the pointer; it goes once the list is next tidied
    const kind = e.kind,
      ref = e.ref;
    const back = () => {
      this.pending?.delete(e.key);
      if (ref && e.died == null && !e.missing) this.store.set(kind, ref, true);
      else this.store.map.set(e.key, e), this.store.changed();
      if (this.open) this.render();
      if (this.ui.inspector?.open) safe(() => this.ui.inspector.render(), null, 'inspector star');
    };
    if (this.open) {
      this.pending ||= new Map();
      this.pending.set(e.key, { e, back, until: performance.now() + 7000 });
      this.render();
      if (hadFocus) this.rows.get(e.key)?.undo.focus();
      this.ui.announce?.(`${info.name} removed from Favorites`);
    } else if (typeof this.ui.undoToast === 'function') this.ui.undoToast(`${info.name} removed from Favorites`, back);
    else this.ui.toast(`${info.name} removed from Favorites`);
  }

  // Select it, open its card and fly there (follow: and ride along).
  show(e, follow = false) {
    const g = this.game;
    const ui = this.ui;
    const ins = ui.inspector;
    const rig = g.cameraRig;
    const r = e.ref;
    if (!r || e.died != null || e.missing) {
      if (e.at && !e.missing) {
        rig.follow = null;
        g.focus(e.at.x, e.at.z, Math.min(rig.goal.dist, 50));
      }
      const info = safe(() => this.info(e), null) || { name: e.name || 'It', doing: '' };
      ui.toast(e.missing ? `${info.name} is not in this world` : `${info.name}: ${info.doing.toLowerCase()}`, 2600);
      return;
    }
    let x = r.x ?? r.cx,
      z = r.z ?? r.cz;
    if (e.kind === 'realm') {
      const cap = g.civ?.villages?.[r.capital];
      const v = cap && cap.alive !== false ? cap : (g.civ?.villages || []).find((o) => o && o.alive !== false && o.kingdom === r.id);
      x = v?.cx ?? v?.x ?? e.at?.x;
      z = v?.cz ?? v?.z ?? e.at?.z;
    }
    if (x == null || z == null) return;
    const dist = Math.min(rig.goal.dist, e.kind === 'realm' ? 90 : e.kind === 'village' ? 60 : follow ? 34 : 40);
    if (rig.follow && rig.follow !== r) rig.follow = null;
    // fly first, so the phone sheet frames the subject above itself
    g.focus(x, z, dist);
    if (isPhone()) this.toggle(false);
    if (e.kind === 'unit') safe(() => ins.showUnit(r), null, 'favorite show');
    else
      safe(
        () => {
          ins.show({ x, z, tx: Math.floor(x), ty: Math.floor(z) });
          const match = (o) => (e.kind === 'vehicle' ? o.vessel === r || o.building === r : e.kind === 'village' ? o.kind === 'village' && o.village === r : o.kind === 'kingdom' && o.kingdom === r);
          let i = ins.results.findIndex(match);
          if (i < 0) {
            const res = e.kind === 'village' ? g.civ?._inspectVillage?.(r, 6) : e.kind === 'realm' ? g.civ?._inspectKingdom?.(r, 1) : r.cls === 'sea' || r.cls === 'land' ? g.fleet?.describe?.(r) : null;
            if (res) {
              ins.results.unshift(res);
              i = 0;
            }
          }
          if (i >= 0) ins.focusIndex(i);
        },
        null,
        'favorite show',
      );
    if (follow && (e.kind === 'unit' || e.kind === 'vehicle')) {
      rig.follow = r;
      rig.goal.dist = Math.min(rig.goal.dist, 34);
      safe(() => ins.render(), null, 'inspector follow');
    }
    if (this.open) this.render();
  }

  // A portrait for a favorite on screen that has none yet (one at a time,
  // only while the list is open; far-off subjects keep their icon).
  portraitTick() {
    const ins = this.ui.inspector;
    if (!ins?.renderPortrait || this._pBusy) return;
    const g = this.game;
    const rig = g.cameraRig;
    if (rig.goal.dist > 90) return;
    for (const e of this.store.map.values()) {
      const r = e.ref;
      if (!r || e.died != null || e.missing || (e.kind !== 'unit' && e.kind !== 'vehicle') || ins.portraits.has(r)) continue;
      if (r.alive === false || r.data?.inside || r.data?.aboard != null) continue;
      const tx = rig.goal.x,
        tz = rig.goal.z;
      if (Math.hypot((r.x ?? 1e9) - tx, (r.z ?? 1e9) - tz) > rig.goal.dist * 0.8) continue;
      this._pBusy = true;
      ins.portraits.set(r, '');
      Promise.resolve(safe(() => ins.renderPortrait(r, e.kind === 'unit' ? 'unit' : 'vessel'), null))
        .then((url) => {
          if (url) ins.portraits.set(r, url);
          else ins.portraits.delete(r);
        })
        .catch(() => ins.portraits.delete(r))
        .finally(() => (this._pBusy = false));
      return;
    }
  }

  // the HUD button's count
  syncButton() {
    const b = this.ui.favBtn;
    if (!b) return;
    const n = this.store.size;
    const badge = b.querySelector('.ws-favbtn__n');
    if (badge && badge.textContent !== (n ? String(n) : '')) {
      badge.textContent = n ? String(n) : '';
      badge.hidden = !n;
      b.setAttribute('aria-label', n ? `Favorites, ${n} starred (P)` : 'Favorites (P)');
    }
  }

  update(dt) {
    safe(() => this.store.update(dt), null, 'favorites store');
    if (this._bVer !== this.store.version) {
      this._bVer = this.store.version;
      safe(() => this.syncButton(), null, 'favorites button');
    }
    if (!this.open) return;
    this._t -= dt;
    if (this._t <= 0 || this._ver !== this.store.version) {
      this._t = 1;
      safe(() => this.render(), null, 'favorites render');
      safe(() => this.place(), null, 'favorites place');
      this._more();
    }
    this._pT -= dt;
    if (this._pT <= 0) {
      this._pT = 1.5;
      safe(() => this.portraitTick(), null, 'favorites portrait');
    }
  }
}

