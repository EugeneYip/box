import { SLOTS, MATERIALS, QUALITIES } from './items.js';

// Divine editing of creatures (Life module), per docs/EDITING.md:
//   rename(u, name)            1-24 printable characters
//   setFavorite(u, on)         u.data.favorite (the inspector star)
//   giveItem(u, spec)          spec {slot, kind, material, quality}; replaced
//                              gear goes to civ.depositItem when possible
//   itemOptions()              {slots, kinds: {slot: [...]}, materials, qualities}
//   setUnitFlag(u, key, val)   'immortal' | 'pacifist' | 'frozenAge' (u.flags)
//   setKingdom(u, kingdomId)   people only: joins the nearest village of it
// All return true on success and emit game.events 'edit' {kind:'unit', id, key, value}.
// Each kind of divine edit keeps one biography line, updated on later edits.
const KINDS = {
  weapon: ['sword', 'axe', 'spear', 'mace', 'bow'],
  armor: ['mail', 'plate', 'shield'],
  tool: ['hammer', 'pick', 'sickle'],
  trinket: ['amulet', 'ring', 'charm'],
};
export const UNIT_FLAGS = ['immortal', 'pacifist', 'frozenAge'];
const FLAG_TEXT = { immortal: 'Made deathless by the gods', pacifist: 'Sworn to peace by the gods', frozenAge: 'Made ageless by the gods' };

export function installEditing(Units) {
  const P = Units.prototype;

  P._edited = function (u, key, value) {
    this.game.events.emit('edit', { kind: 'unit', id: u.id, key, value });
    return true;
  };
  // One biography line per kind of divine edit (updated in place).
  P._divineLog = function (u, kind, text) {
    if (!u._divine) u._divine = {};
    const prev = u._divine[kind];
    if (prev && u.bio && u.bio.includes(prev)) {
      prev.text = text;
      prev.t = this.game.time.total;
      return;
    }
    if (!u.bio) u.bio = [];
    const entry = { t: this.game.time.total, text };
    u.bio.push(entry);
    if (u.bio.length > 24) u.bio.splice(0, u.bio.length - 24);
    u._divine[kind] = entry;
  };

  P.rename = function (u, name) {
    if (!u || !u.alive || typeof name !== 'string') return false;
    const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
    if (clean.length < 1 || clean.length > 24) return false;
    u.name = clean;
    u.data.renamed = true;
    if (u.data.civ) u.data.civ.given = clean;
    this._divineLog(u, 'rename', `Was renamed ${clean} by the gods`);
    return this._edited(u, 'name', clean);
  };

  P.setFavorite = function (u, on) {
    if (!u) return false;
    u.data.favorite = !!on;
    return this._edited(u, 'favorite', !!on);
  };

  P.itemOptions = function () {
    return { slots: SLOTS.slice(), kinds: JSON.parse(JSON.stringify(KINDS)), materials: Object.keys(MATERIALS), qualities: Object.keys(QUALITIES) };
  };

  P.giveItem = function (u, spec = {}) {
    if (!u || !u.alive || !spec || !SLOTS.includes(spec.slot)) return false;
    const kind = spec.kind || KINDS[spec.slot][0];
    if (!KINDS[spec.slot].includes(kind)) return false;
    if (spec.material != null && !MATERIALS[spec.material]) return false;
    if (spec.quality != null && !QUALITIES[spec.quality]) return false;
    const item = this.makeItem({ slot: spec.slot, kind, material: spec.material, quality: spec.quality, origin: 'the heavens', kingdom: u.kingdom, divine: true });
    const old = this.equip(u, item);
    if (old && old !== item) this.game.civ?.depositItem?.(u.village, old, u);
    this._divineLog(u, 'gift', `Received ${item.name} from the gods`);
    return this._edited(u, 'item', item.name);
  };

  P.setUnitFlag = function (u, key, value) {
    if (!u || !u.alive || !UNIT_FLAGS.includes(key)) return false;
    if (!u.flags) u.flags = {};
    const on = !!value;
    u.flags[key] = on;
    u.data.flags = u.flags;
    if (on) {
      this._divineLog(u, 'flag-' + key, FLAG_TEXT[key]);
      if (key === 'pacifist' && u.combat) this.disengage(u);
      if (key === 'immortal' && u.hp <= 0) u.hp = 1;
    }
    return this._edited(u, key, on);
  };

  P.setKingdom = function (u, kingdomId) {
    const civ = this.game.civ;
    if (!u || !u.alive || u.def.kind !== 'humanoid' || !civ) return false;
    const k = civ.kingdoms?.[kingdomId];
    if (!k || k.alive === false) return false;
    let best = null,
      bd = Infinity;
    for (const v of civ.villages || []) {
      if (!v.alive || v.kingdom !== kingdomId) continue;
      const d = (v.cx - u.x) ** 2 + (v.cz - u.z) ** 2;
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (!best) return false;
    if (civ.moveMember) civ.moveMember(u, best);
    else if (civ._moveMember) civ._moveMember(u, best);
    else {
      civ.villages[u.village]?.members?.delete?.(u);
      best.members?.add?.(u);
      u.village = best.id;
      u.kingdom = kingdomId;
    }
    if (u.combat) this.disengage(u);
    this._divineLog(u, 'kingdom', `Sent by the gods to serve ${civ.kingdomName?.(kingdomId) || 'a new realm'} in ${best.name}`);
    return this._edited(u, 'kingdom', kingdomId);
  };
}
