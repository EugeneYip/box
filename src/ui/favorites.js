import { safe } from './dom.js';
import { YEAR } from '../core/time.js';

// The player's Favorites: creatures, villages, realms and vehicles starred
// from their inspector cards (src/ui/FavoritesPanel.js lists them).
//
// A creature's star is Life's own flag (units.setFavorite, u.data.favorite);
// villages, realms and vehicles are kept here by reference. Entries outlive
// their subject: one that dies stays listed ("Died in Year 41") until the
// player removes it.
//
// Worlds are not saved as files: a reload rebuilds the world from its seed
// (the address bar). Favorites are kept in the browser per world (preset,
// region, size and seed) and, when that world is built again, find their way
// back to the same realms, villages, founding creatures and craft. Anything
// that is not in the rebuilt world stays listed as "Not in this world".
// game.favorites.serialize() / restore(data) carry them for a save format.
const STORE_KEY = 'worldseed.favorites.v1';
const MAX_WORLDS = 8;
export const FAV_KINDS = ['unit', 'village', 'realm', 'vehicle'];

// Which favorite an inspector result stands for: { kind, ref } or null.
export function favOf(r) {
  if (!r) return null;
  if (r.unit) return { kind: 'unit', ref: r.unit };
  if (r.vessel || r.kind === 'vessel' || r.kind === 'vehicle') {
    const v = r.vessel || r.building;
    return v ? { kind: 'vehicle', ref: v } : null;
  }
  if (r.kind === 'village' && r.village) return { kind: 'village', ref: r.village };
  if (r.kind === 'kingdom' && r.kingdom && typeof r.kingdom === 'object') return { kind: 'realm', ref: r.kingdom };
  return null;
}

const isGone = (kind, ref) => !ref || ref.alive === false || (kind === 'realm' && ref.dead === true);

export class Favorites {
  constructor(game) {
    this.game = game;
    this.map = new Map(); // key -> entry
    this.version = 0; // bumps on every add, removal or death
    this._restored = false;
    this._worldKey = null;
    this._checkT = 0;
    this._saveT = null;
    const ev = game.events;
    ev.on('edit', (e) => safe(() => this.onEdit(e), null, 'favorites edit'));
    ev.on('unit:death', (e) => {
      const u = e?.unit;
      if (u?.data?.favorite) safe(() => this.check(), null, 'favorites death');
    });
    ev.on('world:regenerated', () => {
      // the old world's entries go to storage under its own key (their
      // subjects were just cleared, which is not a death)
      this.saveNow(true);
      this.map.clear();
      this._restored = false;
      this.version++;
    });
    const flush = () => this.saveNow();
    addEventListener('pagehide', flush);
    addEventListener('beforeunload', flush);
  }

  worldKey() {
    const p = this.game.params || {};
    const W = this.game.world;
    return `${p.preset || 'world'}|${p.region || ''}|${W.w}x${W.h}|${p.seed}`;
  }
  keyOf(kind, ref) {
    return `${kind}:${ref.id}`;
  }

  has(kind, ref) {
    if (!ref) return false;
    if (kind === 'unit' && ref.data?.favorite) return true;
    const e = this.map.get(this.keyOf(kind, ref));
    return !!e && e.ref === ref;
  }
  get size() {
    return this.map.size;
  }
  list() {
    return [...this.map.values()];
  }

  toggle(kind, ref) {
    return this.set(kind, ref, !this.has(kind, ref));
  }
  set(kind, ref, on) {
    if (!ref || !FAV_KINDS.includes(kind)) return false;
    if (kind === 'unit') {
      const U = this.game.units;
      ref.data = ref.data || {};
      if (typeof U?.setFavorite === 'function') safe(() => U.setFavorite(ref, !!on), null, 'setFavorite');
      else ref.data.favorite = !!on;
    }
    if (on) this.add(kind, ref);
    else this.drop(this.keyOf(kind, ref));
    return true;
  }
  add(kind, ref, extra = null) {
    const key = this.keyOf(kind, ref);
    const old = this.map.get(key);
    if (old && old.ref === ref) return old;
    const e = { key, kind, id: ref.id, ref, name: null, snap: null, at: null, added: this.year(), died: null, missing: false, ...(extra || {}) };
    this.map.set(key, e);
    this.touch(e);
    if (isGone(kind, ref)) this.markGone(e);
    this.changed();
    return e;
  }
  // Unstar: the entry leaves the list (and a creature's own flag clears).
  remove(key) {
    const e = this.map.get(key);
    if (!e) return false;
    if (e.kind === 'unit' && e.ref?.data?.favorite) {
      const U = this.game.units;
      if (typeof U?.setFavorite === 'function') safe(() => U.setFavorite(e.ref, false), null, 'setFavorite');
      else e.ref.data.favorite = false;
    }
    return this.drop(key);
  }
  drop(key) {
    if (!this.map.delete(key)) return false;
    this.changed();
    return true;
  }
  changed() {
    this.version++;
    this.save();
  }

  year() {
    return Math.floor(this.game.time?.year || 0) + 1;
  }
  // Keep a little of the subject's look for when it is gone (name, place).
  touch(e, snap = null) {
    const r = e.ref;
    if (!r) return;
    const name = r.name || r.def?.name || e.name;
    if (name) e.name = String(name);
    const x = r.x ?? r.cx,
      z = r.z ?? r.cz;
    if (x != null && z != null && Number.isFinite(x)) e.at = { x: +x, z: +z };
    else if (e.kind === 'realm') {
      const cap = this.game.civ?.villages?.[r.capital];
      if (cap) e.at = { x: cap.cx ?? cap.x, z: cap.cz ?? cap.z };
    }
    if (snap) e.snap = snap;
  }
  markGone(e) {
    if (e.died != null) return;
    const r = e.ref;
    e.died = e.kind === 'unit' && Number.isFinite(r?.deathTime) ? Math.floor(r.deathTime / YEAR) + 1 : this.year();
    this.version++;
    this.save();
  }
  // Deaths, every couple of seconds (a handful of entries: cheap whether or
  // not the panel is open).
  check() {
    for (const e of this.map.values()) {
      if (e.missing || e.died != null || !e.ref) continue;
      if (isGone(e.kind, e.ref)) this.markGone(e);
      else this.touch(e);
    }
  }

  onEdit(ev) {
    if (!ev) return;
    if (ev.kind === 'unit' && ev.key === 'favorite') {
      const u = this.game.units?.byId?.get?.(ev.id);
      if (!u) return;
      if (ev.value) this.add('unit', u);
      else if (this.map.get(this.keyOf('unit', u))?.ref === u) this.drop(this.keyOf('unit', u));
      return;
    }
    // a rename or recolor: the stored names follow
    if (this.map.size) this.save();
  }

  // Creatures starred through Life's API before this list existed (or by
  // another tool) join the list.
  adopt() {
    const U = this.game.units;
    for (const u of U?.list || []) if (u?.data?.favorite && this.map.get(this.keyOf('unit', u))?.ref !== u) this.add('unit', u);
  }

  update(dt) {
    if (!this._restored) {
      this._restored = true;
      this._worldKey = this.worldKey();
      safe(() => this.restore(this.loadStore()[this._worldKey], { match: true }), null, 'favorites restore');
      safe(() => this.adopt(), null, 'favorites adopt');
    }
    this._checkT -= dt;
    if (this._checkT <= 0) {
      this._checkT = 2;
      safe(() => this.check(), null, 'favorites check');
    }
  }

  // ---- save / load
  serialize() {
    return {
      v: 1,
      list: this.list().map((e) => ({ kind: e.kind, id: e.id, name: e.name, snap: e.snap, at: e.at, added: e.added, died: e.died, missing: e.missing || undefined })),
    };
  }
  // Put saved entries back; with match, each finds its subject in this world
  // (same id and name, or for places the same spot).
  restore(data, { match = true } = {}) {
    const list = Array.isArray(data?.list) ? data.list : [];
    const g = this.game;
    const near = (a, at, r = 6) => !!a && !!at && Math.hypot((a.cx ?? a.x) - at.x, (a.cz ?? a.z) - at.z) <= r;
    for (const s of list) {
      if (!s || !FAV_KINDS.includes(s.kind) || s.id == null) continue;
      let ref = null;
      if (match && s.died == null && !s.missing) {
        if (s.kind === 'unit') {
          const u = g.units?.byId?.get?.(s.id);
          if (u && u.alive !== false && (u.name || u.def?.name) === s.name) ref = u;
        } else if (s.kind === 'village') {
          const v = g.civ?.villages?.[s.id];
          if (v && v.alive !== false && v.id === s.id && (v.name === s.name || near(v, s.at))) ref = v;
        } else if (s.kind === 'realm') {
          const k = g.civ?.kingdoms?.[s.id];
          const cap = k ? g.civ.villages?.[k.capital] : null;
          if (k && k.alive !== false && k.id === s.id && (k.name === s.name || near(cap, s.at))) ref = k;
        } else if (s.kind === 'vehicle') {
          const F = g.fleet;
          const v = F?.byId?.get?.(s.id) || (F?.air || []).find((f) => f && f.id === s.id);
          if (v && v.alive !== false && v.name === s.name) ref = v;
        }
      }
      const key = `${s.kind}:${s.id}`;
      if (this.map.has(key)) continue;
      if (ref) {
        if (s.kind === 'unit') {
          ref.data = ref.data || {};
          ref.data.favorite = true;
        }
        this.map.set(key, { key, kind: s.kind, id: s.id, ref, name: s.name, snap: s.snap || null, at: s.at || null, added: s.added ?? this.year(), died: null, missing: false });
      } else {
        // gone before the save, or not in this world: kept as a record
        this.map.set(key, { key, kind: s.kind, id: s.id, ref: null, name: s.name, snap: s.snap || null, at: s.at || null, added: s.added ?? 1, died: s.died ?? null, missing: s.died == null });
      }
    }
    this.version++;
  }

  loadStore() {
    try {
      const o = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return o && typeof o === 'object' ? o : {};
    } catch {
      return {};
    }
  }
  save() {
    clearTimeout(this._saveT);
    this._saveT = setTimeout(() => this.saveNow(), 1200);
  }
  saveNow(quiet = false) {
    clearTimeout(this._saveT);
    this._saveT = null;
    const key = this._worldKey;
    if (!key || !this._restored) return;
    if (!quiet) safe(() => this.check(), null, 'favorites check');
    try {
      const all = this.loadStore();
      if (this.map.size) all[key] = { t: Date.now(), ...this.serialize() };
      else delete all[key];
      // only the most recent worlds are kept
      const keys = Object.keys(all).sort((a, b) => (all[b]?.t || 0) - (all[a]?.t || 0));
      for (const k of keys.slice(MAX_WORLDS)) delete all[k];
      localStorage.setItem(STORE_KEY, JSON.stringify(all));
    } catch {
      /* storage unavailable: favorites last for this visit */
    }
  }
}
