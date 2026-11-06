import { registerPower } from './registry.js';
import { SEA_LEVEL } from '../world/constants.js';

// Life powers: creature spawners, monster summons and blessings / curses.
// Every effect is guarded so the powers work with baseline fx / audio modules.
const fx = (g, type, pos, opts) => g.fx?.emit?.(type, pos, opts);
const sfx = (g, name, pos, opts = {}) => g.audio?.play?.(name, { pos, ...opts });
const VOICE = { sheep: 'bleat', cow: 'bleat', pig: 'bleat', chicken: 'bleat', wolf: 'growl', bear: 'growl', fox: 'growl' };

function randomIn(c) {
  const a = Math.random() * Math.PI * 2,
    r = Math.sqrt(Math.random()) * Math.max(0.3, c.radius);
  return [c.x + Math.cos(a) * r, c.z + Math.sin(a) * r];
}

function spawner(id, name, species, desc, count = 1, opts = {}) {
  registerPower({
    id,
    name,
    category: 'life',
    description: desc,
    mode: 'brush',
    interval: opts.interval ?? 0.18,
    brush: { size: 1, min: 1, max: 6 },
    apply: (g, c) => {
      for (let i = 0; i < count; i++) {
        const [x, z] = randomIn(c);
        const [tx, ty] = g.world.tileOf(x, z);
        if (!g.world.isWalkable(tx, ty)) continue;
        const u = g.units.spawn(species, x, z, {
          age: species === 'human' ? 17 + Math.random() * 14 : 1 + Math.random() * 3,
          herd: opts.herd ? (c.first || !g.__lastHerd ? (g.__lastHerd = g.units._nextGroup++) : g.__lastHerd) : 0,
          pack: opts.pack ? (c.first || !g.__lastPack ? (g.__lastPack = g.units._nextGroup++) : g.__lastPack) : 0,
          home: { x, z },
        });
        if (u) {
          if (opts.pack) g.units._packJoin?.(u);
          u.heading = Math.random() * Math.PI * 2;
          fx(g, 'spawn', { x, z }, { scale: 0.6 });
          sfx(g, 'spawn', { x, z }, { volume: 0.5 });
          if (VOICE[species] && Math.random() < 0.3) sfx(g, VOICE[species], { x, z }, { volume: 0.35 });
        }
      }
    },
  });
}

spawner('spawn-human', 'Humans', 'human', 'Place curious, ambitious humans who will found villages.');
spawner('spawn-sheep', 'Sheep', 'sheep', 'Place fluffy grazing sheep that stick together in flocks.', 1, { herd: true });
spawner('spawn-cow', 'Cattle', 'cow', 'Place placid spotted cattle that wander the meadows in herds.', 1, { herd: true });
spawner('spawn-pig', 'Pigs', 'pig', 'Place snuffling pigs that root about woods and fields.', 1, { herd: true });
spawner('spawn-chicken', 'Chickens', 'chicken', 'Place clucking hens and proud roosters.', 1, { herd: true });
spawner('spawn-deer', 'Deer', 'deer', 'Place shy deer that bolt at the first sign of danger. Stags grow antlers.', 1, { herd: true });
spawner('spawn-rabbit', 'Rabbits', 'rabbit', 'Place hopping rabbits. They breed quickly and feed the foxes.', 1, { herd: true });
spawner('spawn-wolf', 'Wolves', 'wolf', 'Place hungry wolves that hunt in packs.', 1, { pack: true });
spawner('spawn-bear', 'Bears', 'bear', 'Place a solitary bear that fishes, forages berries and guards its woods.', 1, { interval: 0.5 });
spawner('spawn-fox', 'Foxes', 'fox', 'Place a sly fox that hunts rabbits, chickens and voles.', 1, { interval: 0.35 });

// ---- ambient wildlife (visual) ---------------------------------------------
registerPower({
  id: 'spawn-fish',
  name: 'Fish',
  category: 'life',
  description: 'Release a shimmering school of fish into the shallows.',
  mode: 'click',
  brush: { size: 2, min: 1, max: 6 },
  apply: (g, c) => {
    const w = g.world;
    if (w.heightAt(c.x, c.z) >= SEA_LEVEL - 0.3) {
      sfx(g, 'error', c);
      return;
    }
    g.unitRenderer?.ambient?.addSchool(c.x, c.z, 8 + Math.round(c.radius * 3));
    fx(g, 'splash', { x: c.x, y: SEA_LEVEL, z: c.z }, { scale: 0.8 });
    g.unitRenderer?.ripple?.(c.x, c.z, 2.5);
    sfx(g, 'splash', c, { volume: 0.5 });
  },
});
registerPower({
  id: 'spawn-birds',
  name: 'Birds',
  category: 'life',
  description: 'Release a flock of birds: gulls over the coast, songbirds inland.',
  mode: 'click',
  brush: { size: 2, min: 1, max: 6 },
  apply: (g, c) => {
    const w = g.world;
    const [tx, ty] = w.tileOf(c.x, c.z);
    const coastal = w.isWater(tx, ty) || w.isCoastal(tx, ty) || w.heightAt(c.x, c.z) < 0.8;
    g.unitRenderer?.ambient?.addFlock(coastal ? 'gull' : 'song', c.x, c.z);
    fx(g, 'leaves', { x: c.x, z: c.z }, { scale: 0.8 });
    sfx(g, 'spawn', c, { volume: 0.5, pitch: 1.6 });
  },
});

// ---- monsters ----------------------------------------------------------------
function summon(id, name, species, desc, place) {
  registerPower({
    id,
    name,
    category: 'life',
    description: desc,
    mode: 'click',
    brush: null,
    apply: (g, c) => {
      const spot = place(g, c);
      if (!spot) {
        sfx(g, 'error', c);
        g.notify?.(`${name} needs ${species === 'serpent' ? 'deep water' : 'solid ground'}.`, 'bad', c);
        return;
      }
      const u = g.units.spawn(species, spot.x, spot.z, { age: 1, home: { x: spot.x, z: spot.z }, alt: spot.alt });
      if (!u) return;
      const pos = { x: spot.x, y: spot.y ?? g.world.surfaceAt(spot.x, spot.z), z: spot.z };
      fx(g, 'magic', pos, { scale: 2, color: species === 'skywyrm' ? 0xffa040 : species === 'serpent' ? 0x6ff0e0 : 0x9fe870 });
      if (species === 'golem') {
        fx(g, 'dust', pos, { scale: 2.5 });
        fx(g, 'debris', pos, { scale: 1.5 });
        g.cameraRig?.addShake?.(0.8);
        sfx(g, 'quake', c, { volume: 0.8 });
      } else if (species === 'serpent') {
        fx(g, 'splash', { ...pos, y: SEA_LEVEL }, { scale: 2.5 });
        g.unitRenderer?.ripple?.(spot.x, spot.z, 5);
        sfx(g, 'splash', c, { volume: 0.9, pitch: 0.6 });
      } else {
        fx(g, 'embers', pos, { scale: 2 });
        sfx(g, 'growl', c, { volume: 0.9, pitch: 0.6 });
      }
      g.notify?.(`${u.name} has awoken!`, 'disaster', spot);
    },
  });
}
summon('spawn-golem', 'Stone Golem', 'golem', 'Wake a mossy stone giant. It guards its hill and smashes anything that troubles it.', (g, c) => {
  const [tx, ty] = g.world.tileOf(c.x, c.z);
  return g.world.isWalkable(tx, ty) ? { x: c.x, z: c.z } : null;
});
summon('spawn-serpent', 'Tidewyrm', 'serpent', 'Call a coiling sea serpent from the deep. It snatches swimmers and anything near the shore.', (g, c) => {
  const w = g.world;
  if (w.heightAt(c.x, c.z) < SEA_LEVEL - 0.6) return { x: c.x, z: c.z, y: SEA_LEVEL };
  const t = g.units.findNearestTile(c.x, c.z, 8, (tx, ty, i) => w.height[i] < SEA_LEVEL - 0.8);
  return t ? { x: t.x, z: t.z, y: SEA_LEVEL } : null;
});
summon('spawn-skywyrm', 'Skywyrm', 'skywyrm', 'Summon a four-winged skywyrm that soars over the land and rains fire upon it.', (g, c) => ({ x: c.x, z: c.z, alt: 9, y: g.world.surfaceAt(c.x, c.z) + 9 }));

// ---- blessings & curses ----------------------------------------------------------
registerPower({
  id: 'bless',
  name: 'Blessing',
  category: 'life',
  description: 'Heal and empower creatures: full health, more vitality, stronger and faster for a while.',
  mode: 'brush',
  interval: 0.35,
  brush: { size: 3, min: 1, max: 10 },
  apply: (g, c) => {
    const hit = g.units.query(c.x, c.z, c.radius + 0.5);
    for (const u of hit) {
      const fresh = !(u.blessed > g.time.total + 30);
      g.units.bless(u, 40);
      if (fresh) fx(g, 'sparkle', { x: u.x, y: u.y + u.def.height * u.def.size, z: u.z }, { scale: 0.8, color: 0xffd860 });
    }
    fx(g, 'heal', { x: c.x, z: c.z }, { scale: 0.6 + c.radius * 0.3, color: 0xffd860 });
    if (c.first || hit.length) sfx(g, 'magic', c, { volume: 0.6, pitch: 1.3 });
  },
});
registerPower({
  id: 'madness',
  name: 'Madness',
  category: 'life',
  description: 'Drive creatures into a blind rage. Even sheep will fight.',
  mode: 'brush',
  interval: 0.4,
  brush: { size: 3, min: 1, max: 10 },
  apply: (g, c) => {
    const hit = g.units.query(c.x, c.z, c.radius + 0.5);
    for (const u of hit) {
      g.units.setMad(u, 25);
      fx(g, 'magic', { x: u.x, y: u.y + u.def.height, z: u.z }, { scale: 0.6, color: 0xff3020 });
    }
    fx(g, 'smoke', { x: c.x, z: c.z }, { scale: 0.5 + c.radius * 0.25, color: 0x802040 });
    if (c.first || hit.length) sfx(g, 'growl', c, { volume: 0.6, pitch: 0.8 });
  },
});
registerPower({
  id: 'fertility',
  name: 'Bloom of Life',
  category: 'life',
  description: 'Fill animals with the urge to breed: grown females nearby soon give birth.',
  mode: 'brush',
  interval: 0.4,
  brush: { size: 3, min: 1, max: 10 },
  apply: (g, c) => {
    for (const u of g.units.query(c.x, c.z, c.radius + 0.5)) {
      const d = u.def;
      if (d.kind === 'humanoid' || d.fertility <= 0) continue;
      u.hunger = Math.min(u.hunger, 0.15);
      if (u.sex === 'f' && u.age >= d.maturity && !(u.pregnant > 0)) {
        u.pregnant = d.gestation * 0.35;
        g.units.emote(u, 'heart', 2.5);
      } else g.units.emote(u, 'heart', 1.5);
    }
    fx(g, 'heal', { x: c.x, z: c.z }, { scale: 0.5 + c.radius * 0.3, color: 0xff80b0 });
    if (c.first) sfx(g, 'birth', c, { volume: 0.5 });
  },
});

export { spawner };
