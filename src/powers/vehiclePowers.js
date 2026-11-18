import { registerPower } from './registry.js';
import { KINDS, AIR_KINDS, SEA_KINDS, LAND_KINDS } from '../sim/fleet/kinds.js';

// Technology powers (category 'tech', docs/TECH-BREADTH.md section 5) owned
// by the Fleets module: Spawn Vehicle, Launch and Solar Storm. Ids are stable.
// (Gift of Knowledge and Blackout live in the Civ development powers file.)

const icon = (body) => `<svg viewBox="0 0 32 32">${body}</svg>`;

// The realm a click belongs to: whose land it is, else the nearest town's.
function realmAt(g, c) {
  const civ = g.civ;
  let k = civ?.kingdomAt?.(c.tx, c.ty);
  if (!k) {
    const v = civ?.villageAt?.(c.x, c.z, 1e6);
    if (v) k = civ.kingdoms[v.kingdom];
  }
  return k && k.alive !== false ? k : null;
}
const theK = (civ, id) => civ.theKingdomName?.(id) ?? 'the ' + civ.kingdomName(id);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ------------------------------------------------------------------ Spawn Vehicle
// Every kind, from a fishing boat to a colony starship, in era order.
const GROUPS = [
  ['Sea', SEA_KINDS.map((k) => [k, KINDS[k].name])],
  ['Land', LAND_KINDS.map((k) => [k, KINDS[k].name])],
  ['Air', ['plane', 'biplane', 'airliner', 'jet', 'helicopter', 'drone', 'skytaxi'].map((k) => [k, AIR_KINDS[k].name])],
  ['Space', ['rocket', 'satellite', 'station', 'starship'].map((k) => [k, AIR_KINDS[k].name])],
];
let chosen = 'steamer';
let panel = null;

function openChooser(g) {
  closeChooser();
  const host = g.ui?.layer || document.body;
  panel = document.createElement('div');
  panel.className = 'ws-glass ws-vehpick';
  panel.setAttribute('role', 'listbox');
  panel.setAttribute('aria-label', 'Vehicle to spawn');
  Object.assign(panel.style, { position: 'absolute', left: '50%', bottom: 'calc(var(--ws-tile, 56px) * 2 + 48px)', transform: 'translateX(-50%)', maxWidth: 'min(720px, calc(100vw - 32px))', maxHeight: '38vh', overflowY: 'auto', padding: '8px 10px', borderRadius: '12px', zIndex: 30, font: '12px/1.3 Inter, system-ui, sans-serif', color: '#f2ead8', pointerEvents: 'auto' });
  for (const [title, list] of GROUPS) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin:3px 0';
    const h = document.createElement('b');
    h.textContent = title;
    h.style.cssText = 'width:44px;opacity:.75;font-weight:600';
    row.append(h);
    for (const [id, name] of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.dataset.kind = id;
      b.setAttribute('role', 'option');
      b.style.cssText = 'border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:3px 7px;background:rgba(255,255,255,.06);color:inherit;font:inherit;cursor:pointer';
      b.onclick = (e) => {
        e.stopPropagation();
        chosen = id;
        sync();
        g.audio?.play?.('ui-click', { volume: 0.4 });
      };
      row.append(b);
    }
    panel.append(row);
  }
  const hint = document.createElement('div');
  hint.style.cssText = 'opacity:.7;margin-top:4px';
  hint.textContent = 'Click the map to drop it there. It joins the nearest realm.';
  panel.append(hint);
  host.append(panel);
  sync();
}
function sync() {
  if (!panel) return;
  for (const b of panel.querySelectorAll('button')) {
    const on = b.dataset.kind === chosen;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.style.background = on ? 'rgba(233,199,123,.85)' : 'rgba(255,255,255,.06)';
    b.style.color = on ? '#1c1810' : 'inherit';
  }
}
function closeChooser() {
  panel?.remove();
  panel = null;
}

registerPower({
  id: 'spawn-vehicle',
  name: 'Spawn Vehicle',
  category: 'tech',
  description: 'Drop a vehicle of your choice, from a fishing boat to a colony starship. It joins the nearest realm and gets to work.',
  mode: 'click',
  brush: null,
  icon: icon('<path class="f" d="M4 21h24l-3 5H8z"/><path d="M4 21h24l-3 5H8zM9 21v-6h9l3 6M12 15v-4h4"/><path class="s" d="M22 8l3-3M24 11h4M20 6V2"/>'),
  onSelect: (g) => openChooser(g),
  onDeselect: () => closeChooser(),
  apply: (g, c) => {
    const F = g.fleet;
    const k = realmAt(g, c);
    if (!F || !k) return g.notify?.('There is no realm to give it to.', 'bad', { x: c.x, z: c.z });
    const v = F.spawnVehicle(chosen, c.x, c.z, k.id);
    const def = KINDS[chosen] || AIR_KINDS[chosen];
    if (!v) return g.notify?.(cap(F.lastRefusal || 'it cannot go there') + '.', 'bad', { x: c.x, z: c.z });
    g.fx?.emit?.('spawn', { x: c.x, z: c.z }, { scale: 0.8 });
    g.audio?.play?.('spawn', { pos: { x: c.x, z: c.z }, volume: 0.5 });
    g.notify?.(`A ${def.name.toLowerCase()} joins ${theK(g.civ, k.id)}.`, 'good', { x: c.x, z: c.z });
  },
});

// ------------------------------------------------------------------ Launch
registerPower({
  id: 'launch-rocket',
  name: 'Launch',
  category: 'tech',
  description: 'Order a realm with a launch pad or a spaceport to launch a rocket now: a satellite, its orbital station, or a colony starship once it can build one.',
  mode: 'click',
  brush: null,
  icon: icon('<path class="f" d="M16 3c4 4 5 9 4 15h-8c-1-6 0-11 4-15z"/><path d="M16 3c4 4 5 9 4 15h-8c-1-6 0-11 4-15zM12 18l-3 4h4M20 18l3 4h-4"/><path class="s" d="M14 22l2 7 2-7z"/><circle cx="16" cy="11" r="2"/>'),
  apply: (g, c) => {
    const F = g.fleet,
      civ = g.civ;
    const k = realmAt(g, c);
    if (!F || !k) return g.notify?.('Choose a realm to launch.', 'bad', { x: c.x, z: c.z });
    let pad = null,
      port = null;
    for (const vid of k.villages || []) for (const b of civ.villages[vid]?.buildings || []) {
      if (!b.alive || b.constructing) continue;
      if (b.type === 'spaceport' && !port) port = b;
      if (b.type === 'launchpad' && !pad) pad = b;
    }
    if (!pad && !port) return g.notify?.(`${cap(theK(civ, k.id))} has no launch pad.`, 'bad', { x: c.x, z: c.z });
    const has = (t) => k.techs?.has?.(t);
    const payload = port && has('starships') ? 'starship' : port && has('orbital') && !k.orbitalStation ? 'station' : 'satellite';
    const site = payload === 'satellite' ? pad || port : port;
    const f = F.requestLaunch({ kingdom: k.id, from: site.id, payload });
    if (!f) return g.notify?.(cap(F.lastRefusal || 'the launch is scrubbed') + '.', 'bad', { x: site.x, z: site.z });
    // the realm's own clock for launches restarts (Civ reads it)
    k.launchT = g.time.total;
    if (payload === 'starship') k.starshipT = g.time.total;
    g.notify?.(`${cap(theK(civ, k.id))} launches ${payload === 'starship' ? 'a colony starship' : payload === 'station' ? 'its orbital station' : 'a satellite'}.`, 'good', { x: site.x, z: site.z });
  },
});

// ------------------------------------------------------------------ Solar Storm
registerPower({
  id: 'solar-storm',
  name: 'Solar Storm',
  category: 'tech',
  description: 'The sun flares: auroras dance across the sky, satellites tumble and every aircraft is grounded for a while.',
  mode: 'click',
  brush: null,
  icon: icon('<circle class="f" cx="12" cy="13" r="6"/><circle cx="12" cy="13" r="6"/><path d="M12 3v2M12 21v2M2 13h2M20 13h2M5 6l1.5 1.5M17.5 18.5 19 20M5 20l1.5-1.5M17.5 7.5 19 6"/><path class="s" d="M20 24c3-2 6-2 9 0M18 28c4-2 8-2 11 0"/>'),
  apply: (g, c) => {
    const F = g.fleet;
    if (!F?.solarStormStart) return;
    F.solarStormStart(75);
    g.audio?.play?.('thunder', { volume: 0.3 });
    const text = '☀ A solar storm breaks: auroras light the sky, satellites tumble and aircraft are grounded';
    if (g.civ?._note) g.civ._note(text, 'disaster', { x: c.x, z: c.z }, 'solarstorm', 30);
    else g.notify?.(text, 'disaster', { x: c.x, z: c.z });
  },
});
