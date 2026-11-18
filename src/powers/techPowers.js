import { registerPower } from './registry.js';
import { techById } from '../sim/civ/tech.js';

// Technology powers (category 'tech', docs/TECH-BREADTH.md section 5): Civ's
// Gift of Knowledge and Blackout. (Other modules add their own Technology
// powers in files of their own.) Ids are stable.

const YEAR = 30;
const theK = (civ, id) => civ.theKingdomName?.(id) ?? 'the ' + civ.kingdomName(id);

// the realm at a click: its territory, else the nearest town's realm
function realmAt(g, c) {
  const civ = g.civ;
  const k = civ?.kingdomAt?.(c.tx, c.ty);
  if (k?.alive) return k;
  const v = civ?.villageAt?.(c.x, c.z, 24);
  const kk = v ? civ.kingdoms[v.kingdom] : null;
  return kk?.alive ? kk : null;
}

// Gift of Knowledge: a realm learns what its scholars are studying, at once.
registerPower({
  id: 'gift-knowledge',
  name: 'Gift of Knowledge',
  category: 'tech',
  description: 'Click a realm: it learns its current research at once.',
  mode: 'click',
  brush: null,
  cursorColor: '#9fd8ff',
  apply(g, c) {
    const civ = g.civ;
    const k = realmAt(g, c);
    if (!k) return g.notify('The Gift of Knowledge needs a realm: click within its borders.', 'info', { x: c.x, z: c.z });
    if (!k.techs) civ._initTech?.(k);
    if (!k.researching || k.techs.has(k.researching)) k.researching = civ._chooseResearch?.(k) || 'mastery';
    const pos = civ._kingdomPos?.(k) || { x: c.x, z: c.z };
    if (k.researching === 'mastery') {
      civ._gainMastery?.(k);
      k.researching = null;
      g.notify(`📜 ${theK(civ, k.id)} is granted new mastery of its arts`, 'good', pos);
    } else {
      const id = k.researching;
      const name = techById[id]?.name || id;
      k.knowledge = 0;
      civ.learnTech(k, id);
      g.notify(`📜 A gift of knowledge: ${theK(civ, k.id)} learns ${name}`, 'good', pos);
    }
    g.fx?.burst?.('sparkle', pos, 18, { scale: 2 });
    g.audio?.play?.('bell', { pos });
  },
});

// Blackout: a powered town loses its power for a while (lights out,
// factories idle, aircraft grounded there). Sets village.blackoutUntil.
registerPower({
  id: 'blackout',
  name: 'Blackout',
  category: 'tech',
  description: 'Click a powered town: its lights go out and its factories stand idle for a few years.',
  mode: 'click',
  brush: null,
  cursorColor: '#ffd36a',
  apply(g, c) {
    const civ = g.civ;
    let v = null,
      bd = Infinity;
    for (const o of civ?.villages || []) {
      if (!o.alive || !(o.powered || o.blackoutUntil > g.time.total)) continue;
      const d = Math.hypot(o.cx - c.x, o.cz - c.z);
      if (d < bd && d < (o.radius || 8) + 14) (bd = d), (v = o);
    }
    if (!v) return g.notify('No powered town there: a blackout needs a town on the power lines.', 'info', { x: c.x, z: c.z });
    v.blackoutUntil = g.time.total + YEAR * 3;
    v.powered = false;
    civ.infraVersion = (civ.infraVersion || 0) + 1;
    civ.version++;
    g.events?.emit?.('civ:blackout', { village: v.id, kingdom: v.kingdom, until: v.blackoutUntil });
    g.notify(`🔌 Blackout in ${v.name}: the lights go out and the factories fall silent`, 'disaster', { x: v.cx, z: v.cz });
    g.fx?.burst?.('smoke', { x: v.cx, z: v.cz }, 8, { scale: 1.2 });
  },
});
