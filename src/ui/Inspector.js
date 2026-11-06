import { TILE_INFO, FLORA_INFO, SEA_LEVEL, SHALLOW_DEPTH, TILE } from '../world/constants.js';
import { powerIcon, uiIcon, tileTint } from './icons.js';
import { getPower } from '../powers/registry.js';
import { el, esc, safe, hexCss } from './dom.js';

const TILE_POWER = {
  [TILE.GRASS]: 'paint-grass',
  [TILE.FOREST]: 'paint-forest',
  [TILE.JUNGLE]: 'paint-jungle',
  [TILE.SAVANNA]: 'paint-savanna',
  [TILE.DESERT]: 'paint-desert',
  [TILE.SAND]: 'paint-sand',
  [TILE.SWAMP]: 'paint-swamp',
  [TILE.TUNDRA]: 'paint-tundra',
  [TILE.SNOW]: 'paint-snow',
  [TILE.SOIL]: 'paint-soil',
  [TILE.ROCK]: 'paint-rock',
  [TILE.LAVA]: 'paint-lava',
  [TILE.ASH]: 'paint-ash',
  [TILE.FARMLAND]: 'paint-farmland',
  [TILE.ROAD]: 'paint-road',
  [TILE.ICE]: 'paint-ice',
};
const KIND_LABEL = { unit: 'Creature', building: 'Building', village: 'Village', kingdom: 'Kingdom', flora: 'Flora', tile: 'Land', info: 'Detail' };

function kindOf(r) {
  if (!r) return 'info';
  if (r.kind) return r.kind;
  if (r.unit) return 'unit';
  if (r.building) return 'building';
  if (r.village) return 'village';
  if (r.kingdom != null && typeof r.kingdom === 'object') return 'kingdom';
  return 'info';
}
const word = (v, words) => words[Math.min(words.length - 1, Math.max(0, Math.floor(v * words.length)))];

// Inspector panel. Shows the highest-priority result of game.inspect(hit)
// plus the other things under the cursor, refreshes live, supports following
// a unit and implements the Selection hook (game.selected + 'select').
export class Inspector {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = el('aside', { class: 'ws-insp ws-glass', 'aria-live': 'polite' });
    this.hit = null;
    this.results = [];
    this.index = 0;
    this._t = 0;
    this.game.events.on('inspect', (hit) => this.show(hit));
  }

  get open() {
    return this.el.classList.contains('is-open');
  }

  tileResult(hit) {
    const g = this.game;
    const W = g.world;
    const tx = Math.max(0, Math.min(W.w - 1, hit.tx ?? Math.floor(hit.x))),
      ty = Math.max(0, Math.min(W.h - 1, hit.ty ?? Math.floor(hit.z)));
    const i = W.idx(tx, ty);
    const hh = W.height[i];
    const water = hh < SEA_LEVEL;
    const info = TILE_INFO[W.type[i]] || TILE_INFO[1];
    const o = W.owner[i];
    const kname = o >= 0 ? safe(() => g.civ.kingdomName(o), null) : null;
    const f = W.flora[i];
    const stats = [];
    stats.push(['Elevation', water ? `${Math.round(-hh * 100).toLocaleString('en-US')} m deep` : `${Math.round(hh * 100).toLocaleString('en-US')} m`]);
    if (!water) {
      stats.push(['Climate', word(W.temperature[i] ?? 0.5, ['Frozen', 'Cold', 'Temperate', 'Warm', 'Scorching'])]);
      stats.push(['Moisture', Math.round((W.moisture[i] ?? 0) * 100) + '%']);
      stats.push(['Fertility', Math.round((info.fertile ?? 0) * 100) + '%']);
      if (f) stats.push(['Growth', FLORA_INFO[f]?.name || 'Plants']);
    }
    if (W.fire[i] > 0) stats.push(['Fire', Math.round(W.fire[i] * 100) + '%']);
    stats.push(['Location', `${tx}, ${ty}`]);
    return {
      priority: -100,
      kind: 'tile',
      tile: { tx, ty, type: W.type[i], water, owner: o },
      title: water ? (hh < SEA_LEVEL - SHALLOW_DEPTH ? 'Deep Ocean' : 'Shallow Water') : info.name,
      subtitle: kname ? `Territory of ${kname}` : water ? 'Open waters' : 'Unclaimed wilds',
      stats,
      x: tx + 0.5,
      z: ty + 0.5,
    };
  }

  collect(hit) {
    const list = (safe(() => this.game.inspect(hit), []) || []).filter(Boolean);
    if (!list.some((r) => kindOf(r) === 'tile')) list.push(this.tileResult(hit));
    return list;
  }

  show(hit, keepIndex = false) {
    if (!hit) return;
    this.hit = { x: hit.x, z: hit.z, tx: hit.tx ?? Math.floor(hit.x), ty: hit.ty ?? Math.floor(hit.z) };
    this.results = this.collect(this.hit);
    if (!keepIndex) this.index = 0;
    this.track = this.results[this.index];
    this.render();
    this.el.classList.add('is-open');
    this.ui.root.classList.add('has-insp');
    this.applySelection();
    this.game.audio?.play?.('ui-open', { volume: 0.35 });
  }

  focusIndex(i) {
    this.index = i;
    this.track = this.results[i];
    this.render();
    this.applySelection();
  }

  close() {
    if (!this.open) return;
    this.el.classList.remove('is-open');
    this.ui.root.classList.remove('has-insp');
    const rig = this.game.cameraRig;
    if (this.track?.unit && rig.follow === this.track.unit) rig.follow = null;
    this.track = null;
    this.hit = null;
    this.setSelected(null);
  }

  applySelection() {
    const r = this.track;
    if (r?.unit) this.setSelected({ kind: 'unit', ref: r.unit });
    else if (r?.building) this.setSelected({ kind: 'building', ref: r.building });
    else this.setSelected(null);
  }

  setSelected(sel) {
    const g = this.game;
    const prev = g.selected || null;
    if (prev === sel || (prev && sel && prev.ref === sel.ref)) return;
    g.selected = sel;
    g.events.emit('select', sel);
  }

  iconFor(r) {
    const k = kindOf(r);
    if (k === 'unit' && r.unit) {
      const sp = r.unit.species || r.unit.def?.id;
      const p = getPower('spawn-' + sp) || { id: 'spawn-' + sp, name: r.unit.def?.name || sp, category: 'life' };
      return powerIcon(p);
    }
    if (k === 'tile') {
      if (r.tile?.water) return powerIcon({ id: 'ocean', category: 'terrain' });
      const pid = TILE_POWER[r.tile?.type] || 'paint-grass';
      return { svg: powerIcon({ id: pid, category: 'biome' }).svg, tint: tileTint(r.tile?.type) };
    }
    if (k === 'flora') return powerIcon({ id: 'plant-forest', category: 'nature' });
    if (k === 'building') return { svg: uiIcon('house'), tint: '#9fbcff' };
    if (k === 'village') return { svg: uiIcon('village'), tint: '#9fbcff' };
    if (k === 'kingdom') return { svg: uiIcon('crown'), tint: '#ffd36a' };
    return { svg: uiIcon('info'), tint: '#7fdcec' };
  }

  // A stat value like "32 / 40" or "45%" renders as a meter.
  meter(v) {
    const s = String(v);
    let m = s.match(/^\s*(-?[\d.]+)\s*\/\s*([\d.]+)\s*$/);
    if (m) return Math.max(0, Math.min(1, +m[1] / Math.max(1e-6, +m[2])));
    m = s.match(/^\s*(-?[\d.]+)\s*%\s*$/);
    if (m) return Math.max(0, Math.min(1, +m[1] / 100));
    return null;
  }

  render() {
    const r = this.track;
    if (!r) return;
    const k = kindOf(r);
    const { svg: ico, tint } = this.iconFor(r);
    const u = r.unit;
    const dead = u && u.alive === false;
    let kTint = null;
    const kid = u?.kingdom ?? r.building?.kingdom ?? r.village?.kingdom ?? (k === 'tile' ? r.tile?.owner : null);
    if (kid != null && kid >= 0) kTint = hexCss(safe(() => this.game.civ.kingdomColor(kid), null));
    const stats = (r.stats || []).filter((s) => Array.isArray(s) && s.length >= 2);
    const cap = (v) => (typeof v === 'string' && /^[a-z]/.test(v) ? v[0].toUpperCase() + v.slice(1) : v);
    const rows = stats
      .map(([key, v]) => {
        v = cap(v);
        const lower = String(key).toLowerCase();
        const m = this.meter(v);
        const bad = /hunger|damage|fire|danger/.test(lower);
        if (m != null)
          return `<div class="ws-insp__row ws-insp__row--meter"><span class="ws-insp__k">${esc(key)}</span><span class="ws-insp__v">${esc(v)}</span><span class="ws-meter ${bad ? 'is-bad' : /health|hp/.test(lower) ? 'is-hp' : ''}"><i style="width:${(m * 100).toFixed(1)}%"></i></span></div>`;
        return `<div class="ws-insp__row"><span class="ws-insp__k">${esc(key)}</span><span class="ws-insp__v">${esc(v)}</span></div>`;
      })
      .join('');
    const others = this.results
      .map((o, i) => ({ o, i }))
      .filter(({ i }) => i !== this.index)
      .map(({ o, i }) => {
        const ic = this.iconFor(o);
        return `<button class="ws-insp__other" type="button" data-i="${i}" style="--tint:${ic.tint}"><span class="ws-insp__oico">${ic.svg}</span><span class="ws-insp__otxt"><b>${esc(o.title || KIND_LABEL[kindOf(o)])}</b><small>${esc(KIND_LABEL[kindOf(o)] || '')}</small></span>${uiIcon('chev-right', 'ws-insp__ochev')}</button>`;
      })
      .join('');
    const following = u && this.game.cameraRig.follow === u;
    let subtitle = r.subtitle;
    if (u && (!subtitle || subtitle === r.title)) {
      const sex = u.sex === 'f' ? 'Female' : u.sex === 'm' ? 'Male' : '';
      const mat = u.def?.maturity ?? 1;
      const stage = u.age < mat ? 'Young' : u.age > (u.def?.lifespan ?? 99) * 0.8 ? 'Elder' : 'Adult';
      subtitle = [u.def?.name && u.def.name !== r.title ? u.def.name : null, sex, stage].filter(Boolean).join(' · ');
    }
    const actions = [];
    if (u && !dead) actions.push(`<button class="ws-btn ws-btn--sm ${following ? 'is-on' : ''}" type="button" data-act="follow">${uiIcon('follow')}<span>${following ? 'Following' : 'Follow'}</span><kbd class="ws-key">F</kbd></button>`);
    if (r.x != null || u || r.building || r.village || this.hit) actions.push(`<button class="ws-btn ws-btn--sm ws-btn--ghost" type="button" data-act="focus">${uiIcon('focus')}<span>Focus</span></button>`);

    this.el.style.setProperty('--tint', tint);
    this.el.innerHTML = `
      <header class="ws-insp__head">
        <span class="ws-insp__badge">${ico}</span>
        <div class="ws-insp__titles">
          <div class="ws-insp__kind">${esc(k === 'tile' && r.tile?.water ? 'Waters' : KIND_LABEL[k] || 'Detail')}${dead ? ' <em class="ws-insp__dead">Fallen</em>' : ''}</div>
          <h3 class="ws-insp__title">${esc(r.title || 'Unknown')}</h3>
          ${subtitle ? `<div class="ws-insp__sub">${kTint ? `<i class="ws-crest" style="--k:${kTint}"></i>` : ''}${esc(subtitle)}</div>` : ''}
        </div>
        <button class="ws-iconbtn ws-iconbtn--sm ws-insp__x" type="button" aria-label="Close (Esc)" data-act="close">${uiIcon('close')}</button>
      </header>
      ${rows ? `<div class="ws-insp__stats">${rows}</div>` : ''}
      ${actions.length ? `<div class="ws-insp__actions">${actions.join('')}</div>` : ''}
      ${others ? `<div class="ws-insp__also"><div class="ws-insp__also-h">Also here</div>${others}</div>` : ''}`;
    this.el.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.i != null) return this.focusIndex(+b.dataset.i);
      const act = b.dataset.act;
      if (act === 'close') this.close();
      else if (act === 'follow') this.toggleFollow();
      else if (act === 'focus') this.focusCamera();
      this.game.audio?.play?.('ui-click', { volume: 0.45 });
    };
    this._sig = this.signature();
  }

  signature() {
    const r = this.track;
    return r ? JSON.stringify([r.title, r.subtitle, r.stats, r.unit?.alive, this.game.cameraRig.follow === r.unit, this.results.length]) : '';
  }

  toggleFollow() {
    const u = this.track?.unit;
    if (!u || u.alive === false) return;
    const rig = this.game.cameraRig;
    if (rig.follow === u) rig.follow = null;
    else {
      rig.follow = u;
      rig.goal.dist = Math.min(rig.goal.dist, 34);
    }
    this.render();
  }

  focusCamera() {
    const r = this.track;
    const o = r?.unit || r?.building || r?.village;
    const x = o?.x ?? r?.x ?? this.hit?.x,
      z = o?.z ?? r?.z ?? this.hit?.z;
    if (x != null) this.game.focus(x, z, Math.min(this.game.cameraRig.goal.dist, 40));
  }

  // Re-query the tracked entity so stats stay live.
  refresh() {
    const r = this.track;
    if (!r) return;
    const u = r.unit,
      b = r.building;
    let at = this.hit;
    if (u) at = { x: u.x, z: u.z, tx: Math.floor(u.x), ty: Math.floor(u.z) };
    else if (b && b.x != null) at = { x: b.x, z: b.z, tx: Math.floor(b.x), ty: Math.floor(b.z) };
    const list = this.collect(at);
    let idx = list.findIndex((o) => (u && o.unit === u) || (b && o.building === b) || (!u && !b && kindOf(o) === kindOf(r) && o.title === r.title));
    if (idx < 0) {
      if (u) {
        // the unit died or wandered off: keep the last card, marked as fallen
        if (u.alive === false && !this._deadShown) {
          this._deadShown = true;
          this.render();
        }
        return;
      }
      idx = 0;
    }
    this._deadShown = false;
    this.results = list;
    this.index = idx;
    this.track = list[idx];
    if (u) this.hit = at;
    if (this.signature() !== this._sig) this.render();
  }

  update(dt) {
    if (!this.open) return;
    this._t -= dt;
    if (this._t <= 0) {
      this._t = 0.35;
      safe(() => this.refresh(), null, 'inspector refresh');
    }
  }
}
