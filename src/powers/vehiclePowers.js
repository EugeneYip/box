import { registerPower } from './registry.js';
import { KINDS, AIR_KINDS, SEA_KINDS, LAND_KINDS } from '../sim/fleet/kinds.js';
import { techById } from '../sim/civ/tech.js';
import { uiIcon, vehicleIconName } from '../ui/icons.js';
import { eraNames } from '../ui/depth.js';
import { pluralName } from './techPowers.js';

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
  ['sea', 'Sea', SEA_KINDS],
  ['land', 'Land', LAND_KINDS],
  ['air', 'Air', ['plane', 'biplane', 'airliner', 'jet', 'helicopter', 'drone', 'skytaxi']],
  ['space', 'Space', ['rocket', 'satellite', 'station', 'starship']],
];
const defOf = (k) => KINDS[k] || AIR_KINDS[k];
const eraOfKind = (k) => {
  const d = defOf(k);
  return Number.isFinite(techById[d?.tech]?.era) ? techById[d.tech].era : Number.isFinite(d?.era) ? d.era : 0;
};
const groupOf = (k) => (GROUPS.find(([, , list]) => list.includes(k)) || GROUPS[0])[0];
// "a steamship", "an icebreaker"
const withArticle = (name) => (/^[aeiou]/i.test(name) ? 'an ' : 'a ') + name;
let chosen = 'steamer';
let picked = false; // once a kind is picked the chooser folds to one pill
let tab = 'sea';
let panel = null;
let gRef = null;
let placeT = 0;

// The chooser docks as a strip above the power's name bar (or the tray), so it
// never covers the middle of the map, and folds to a pill once a kind is picked.
function place() {
  if (!panel) return;
  const vh = innerHeight;
  const vis = (e) => {
    if (!e) return null;
    const r = e.getBoundingClientRect();
    const cs = getComputedStyle(e);
    return r.height > 0 && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && cs.display !== 'none' ? r : null;
  };
  const bEl = document.querySelector('.ws-brush.is-shown');
  const bR = bEl?.getBoundingClientRect();
  const brush = bR && bR.height > 0 && getComputedStyle(bEl).display !== 'none' ? bR : null;
  const dock = vis(document.querySelector('.ws-dock__panel')) || vis(document.querySelector('.ws-dock'));
  let top = vh - 12;
  if (dock) top = Math.min(top, dock.top);
  if (brush && brush.bottom <= top + 4) top = Math.min(top, brush.top);
  panel.style.bottom = Math.round(vh - top + 8) + 'px';
  // short landscape phones: no wider than the powers bar, so the camera pad and
  // the Favorites button at the sides stay clear
  const short = vh <= 500 && innerWidth > vh;
  panel.style.maxWidth = short && dock ? Math.round(Math.max(320, dock.width)) + 'px' : '';
}
const touch = () => !!gRef?.ui?.root?.classList.contains('is-touch');
function openChooser(g) {
  closeChooser();
  gRef = g;
  tab = groupOf(chosen);
  const host = g.ui?.layer || g.ui?.root || document.body;
  panel = document.createElement('div');
  panel.className = 'ws-vehpick ws-glass';
  host.append(panel);
  render();
  place();
  placeT = setInterval(place, 400);
  addEventListener('resize', place);
}
function render() {
  if (!panel) return;
  const eras = eraNames();
  panel.classList.toggle('is-folded', picked);
  if (picked) {
    const d = defOf(chosen);
    panel.removeAttribute('role');
    panel.innerHTML = `<button class="ws-vehpick__pill" type="button" aria-expanded="false" aria-label="Vehicle: ${d.name}. Change vehicle" data-tip="Change vehicle"><span class="ws-vehpick__ico">${uiIcon(vehicleIconName(d))}</span><span class="ws-vehpick__pname">${d.name}</span><small>${eras[eraOfKind(chosen)] || ''}</small><span class="ws-vehpick__chg">Change ${uiIcon('chev-up')}</span></button>`;
    panel.querySelector('button').onclick = (e) => {
      e.stopPropagation();
      picked = false;
      render();
      place();
      panel.querySelector('.ws-vehpick__opt.is-on')?.focus({ preventScroll: true });
    };
    return;
  }
  // in era order (stable within an era); on desktops the two-row strip fills
  // column by column with a divider at each new era, so scrolling right always
  // means later eras (phones in portrait list them down, under era headings)
  const list = GROUPS.find(([id]) => id === tab)[2]
    .map((k, i) => [k, i])
    .sort((a, b) => eraOfKind(a[0]) - eraOfKind(b[0]) || a[1] - b[1])
    .map(([k]) => k);
  const byEra = [];
  for (const k of list) {
    const era = eraOfKind(k);
    if (byEra.at(-1)?.era !== era) byEra.push({ era, kinds: [] });
    byEra.at(-1).kinds.push(k);
  }
  panel.innerHTML = `
    <div class="ws-vehpick__head">
      <div class="ws-vehpick__tabs" role="tablist" aria-label="Kind of vehicle">${GROUPS.map(([id, label]) => `<button class="ws-vehpick__tab${id === tab ? ' is-on' : ''}${id === groupOf(chosen) ? ' has-pick' : ''}" type="button" role="tab" aria-selected="${id === tab}" tabindex="${id === tab ? 0 : -1}" data-tab="${id}"${id === groupOf(chosen) ? ` aria-label="${label}, holds your pick: ${defOf(chosen).name}" data-tip="Your pick: ${defOf(chosen).name}"` : ''}>${label}${id === groupOf(chosen) ? '<i class="ws-vehpick__dot" aria-hidden="true"></i>' : ''}</button>`).join('')}</div>
      <span class="ws-vehpick__hint">${touch() ? 'Pick one, then tap the map.' : 'Pick one, then click the map.'} It joins the nearest realm.</span>
    </div>
    <div class="ws-vehpick__row is-grouped" role="listbox" aria-label="Vehicle to spawn" aria-orientation="horizontal">${byEra
      .map(
        ({ era, kinds }) =>
          // one group per era, its name above it (pinned at the strip's left edge,
          // or at the list's top on phones, while that era is in view)
          `<div class="ws-vehpick__grp" role="group" aria-label="${eras[era] || ''} era"><span class="ws-vehpick__glbl" aria-hidden="true"><i>${eras[era] || ''}</i></span><div class="ws-vehpick__gopts">${kinds
            .map((k) => {
              const d = defOf(k);
              const on = k === chosen;
              const need = techById[d.tech]?.name;
              return `<button class="ws-vehpick__opt${on ? ' is-on' : ''}" type="button" role="option" aria-selected="${on}" tabindex="${on || (!list.includes(chosen) && k === list[0]) ? 0 : -1}" data-kind="${k}" title="${d.name}: ${eras[era] || ''} era${need ? ' · realms build it once they know ' + need : ''}"><span class="ws-vehpick__ico">${uiIcon(vehicleIconName(d))}</span><span class="ws-vehpick__txt"><b>${d.name}</b><small><span class="ws-vehpick__sera">${eras[era] || ''}${need ? ' · ' : ''}</span>${need || ''}</small></span></button>`;
            })
            .join('')}</div></div>`,
      )
      .join('')}</div>`;
  for (const b of panel.querySelectorAll('.ws-vehpick__tab')) {
    b.onclick = (e) => {
      e.stopPropagation();
      tab = b.dataset.tab;
      render();
      panel.querySelector('.ws-vehpick__tab.is-on')?.focus({ preventScroll: true });
    };
  }
  for (const b of panel.querySelectorAll('.ws-vehpick__opt')) {
    b.onclick = (e) => {
      e.stopPropagation();
      choose(b.dataset.kind, true);
    };
  }
  panel.onkeydown = onKey;
  const row = panel.querySelector('.ws-vehpick__row');
  // a short list (Space: four kinds) keeps one row
  row.classList.toggle('is-short', list.length <= 4);
  row.style.setProperty('--n', String(list.length));
  row.style.setProperty('--half', String(Math.ceil(list.length / 2)));
  // the mouse wheel scrolls the kinds sideways; the edge fades show there is more
  // (phones in portrait scroll a two-column list up and down instead)
  // (phones in portrait: a pill says how many kinds lie above the list's top
  // and scrolls back up to them)
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'ws-vehpick__more';
  more.hidden = true;
  more.onclick = (e) => {
    e.stopPropagation();
    row.scrollTo({ top: 0, behavior: 'smooth' });
  };
  row.before(more);
  const opts = [...row.querySelectorAll('.ws-vehpick__opt')];
  const grps = [...row.querySelectorAll('.ws-vehpick__grp')];
  // (round 35) an era's pinned heading steps aside while only a sliver of its
  // group is left in view (scrolled to the Steamship, the Sea tab opened with
  // "IRON" pinned at its left edge over an empty strip)
  const headings = () => {
    const rr = row.getBoundingClientRect();
    const vertical = row.scrollHeight > row.clientHeight + 2 && row.scrollWidth <= row.clientWidth + 2;
    for (const g of grps) {
      const lb = g.querySelector('.ws-vehpick__glbl');
      if (!lb) continue;
      const gr = g.getBoundingClientRect();
      const lr = lb.getBoundingClientRect();
      const left = vertical ? gr.bottom - rr.top : gr.right - rr.left;
      const need = vertical ? lr.height + 30 : lr.width + 30;
      lb.classList.toggle('is-cut', left > 0 && left < need && (vertical ? gr.top < rr.top : gr.left < rr.left));
    }
  };
  const edges = () => {
    headings();
    row.classList.toggle('at-start', row.scrollLeft <= 2 && row.scrollTop <= 2);
    row.classList.toggle('at-end', row.scrollLeft + row.clientWidth >= row.scrollWidth - 2 && row.scrollTop + row.clientHeight >= row.scrollHeight - 2);
    const vertical = row.scrollHeight > row.clientHeight + 2 && row.scrollWidth <= row.clientWidth + 2;
    let above = 0;
    if (vertical && row.scrollTop > 2) {
      const top = row.getBoundingClientRect().top + 8;
      for (const o of opts) if (o.getBoundingClientRect().bottom <= top) above++;
    }
    more.hidden = !above;
    if (above) more.innerHTML = `${uiIcon('chev-up')}<span>${above} more above</span>`;
  };
  row.addEventListener('scroll', edges, { passive: true });
  row.addEventListener(
    'wheel',
    (e) => {
      if (row.scrollWidth <= row.clientWidth + 1) return;
      const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (!d) return;
      e.preventDefault();
      e.stopPropagation();
      row.scrollLeft += d * (e.deltaMode === 1 ? 32 : 1);
    },
    { passive: false },
  );
  // the chosen kind scrolls into view
  const on = panel.querySelector('.ws-vehpick__opt.is-on');
  if (on) {
    const rr = row.getBoundingClientRect();
    const or = on.getBoundingClientRect();
    row.scrollLeft = Math.max(0, row.scrollLeft + or.left - rr.left - row.clientWidth / 2 + or.width / 2);
    if (row.scrollHeight > row.clientHeight + 2) row.scrollTop = Math.max(0, row.scrollTop + or.top - rr.top - row.clientHeight / 2 + or.height / 2);
    // (round 35) then the strip starts on an era's first column (or row),
    // so no heading sits over a group cut in two, as long as the chosen
    // kind stays in view
    const vertical = row.scrollHeight > row.clientHeight + 2 && row.scrollWidth <= row.clientWidth + 2;
    const r2 = row.getBoundingClientRect();
    const edge = vertical ? r2.top : r2.left;
    const g = grps.find((q) => {
      const b = q.getBoundingClientRect();
      return vertical ? b.top < edge - 1 && b.bottom > edge + 1 : b.left < edge - 1 && b.right > edge + 1;
    });
    if (g) {
      const b = g.getBoundingClientRect();
      const o = on.getBoundingClientRect();
      const lo = vertical ? b.top : b.left,
        hi = vertical ? b.bottom : b.right;
      // to the start of this era when more than half of it is in view, else to the next
      const delta = hi - edge > (hi - lo) / 2 ? lo - edge : hi - edge;
      const size = vertical ? row.clientHeight : row.clientWidth;
      const oLo = (vertical ? o.top : o.left) - delta,
        oHi = (vertical ? o.bottom : o.right) - delta;
      if (oLo >= edge - 1 && oHi <= edge + size + 1) {
        if (vertical) row.scrollTop = Math.max(0, row.scrollTop + delta);
        else row.scrollLeft = Math.max(0, row.scrollLeft + delta);
      }
    }
  }
  edges();
}
// the power's name strip names the chosen kind ("Spawn Vehicle: Container ship")
const syncStrip = () => gRef?.ui?.toolbar?.syncActive?.();
function choose(k, fold) {
  chosen = k;
  if (fold) picked = true;
  render();
  place();
  syncStrip();
  gRef?.audio?.play?.('ui-click', { volume: 0.4 });
  if (fold) panel?.querySelector('.ws-vehpick__pill')?.focus({ preventScroll: true });
}
// arrow keys: left/right walk the kinds (or the tabs), up/down move between
// the rows, Page Up/Down (or Ctrl+Up/Down) change the tab, Enter or Space picks
function onKey(e) {
  const t = e.target;
  const isTab = t.classList?.contains('ws-vehpick__tab');
  const isOpt = t.classList?.contains('ws-vehpick__opt');
  if (!isTab && !isOpt) return;
  const sib = isOpt ? [...panel.querySelectorAll('.ws-vehpick__opt')] : [...t.parentElement.children];
  const i = sib.indexOf(t);
  let j = null;
  // a kind's Left/Right neighbor is the nearest kind in the same row (the strip
  // fills column by column, so the next kind in the list is the one below)
  const rowStep = (dir) => {
    const r0 = t.getBoundingClientRect();
    let best = null;
    sib.forEach((o, k) => {
      const r = o.getBoundingClientRect();
      const dx = (r.left - r0.left) * dir;
      if (o === t || Math.abs(r.top - r0.top) > 4 || dx < 4) return;
      if (!best || dx < best[0]) best = [dx, k];
    });
    return best ? best[1] : Math.max(0, Math.min(sib.length - 1, i + dir));
  };
  if (e.key === 'ArrowRight') j = isOpt ? rowStep(1) : Math.min(sib.length - 1, i + 1);
  else if (e.key === 'ArrowLeft') j = isOpt ? rowStep(-1) : Math.max(0, i - 1);
  else if (e.key === 'Home') j = 0;
  else if (e.key === 'End') j = sib.length - 1;
  if (j != null) {
    e.preventDefault();
    e.stopPropagation();
    if (isTab) {
      tab = sib[j].dataset.tab;
      render();
      panel.querySelector('.ws-vehpick__tab.is-on')?.focus();
    } else {
      chosen = sib[j].dataset.kind;
      render();
      syncStrip();
      panel.querySelector('.ws-vehpick__opt.is-on')?.focus();
    }
    return;
  }
  // Page Up / Page Down (or Ctrl with an arrow) change the tab
  const tabKey = e.key === 'PageDown' || e.key === 'PageUp' || ((e.ctrlKey || e.metaKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown'));
  if (isOpt && tabKey) {
    e.preventDefault();
    e.stopPropagation();
    const gi = GROUPS.findIndex(([id]) => id === tab);
    tab = GROUPS[(gi + (e.key === 'ArrowDown' || e.key === 'PageDown' ? 1 : GROUPS.length - 1)) % GROUPS.length][0];
    render();
    (panel.querySelector('.ws-vehpick__opt.is-on') || panel.querySelector('.ws-vehpick__opt'))?.focus();
    return;
  }
  // Up / Down move between the rows: to the nearest kind in the row above or below
  if (isOpt && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    e.stopPropagation();
    const down = e.key === 'ArrowDown';
    const r0 = t.getBoundingClientRect();
    let best = null;
    for (const o of sib) {
      if (o === t) continue;
      const r = o.getBoundingClientRect();
      const dy = down ? r.top - r0.top : r0.top - r.top;
      if (dy < 4) continue;
      const score = dy * 1000 + Math.abs(r.left - r0.left);
      if (!best || score < best[0]) best = [score, o];
    }
    if (best) {
      chosen = best[1].dataset.kind;
      render();
      syncStrip();
      panel.querySelector('.ws-vehpick__opt.is-on')?.focus();
    }
    return;
  }
  if (isOpt && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    e.stopPropagation();
    choose(t.dataset.kind, true);
  }
}
function closeChooser() {
  clearInterval(placeT);
  removeEventListener('resize', place);
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
  label: () => `Spawn Vehicle: ${defOf(chosen)?.name || 'Vehicle'}`,
  // phones: the handle names the vehicle first ("Steamship" over "Spawn Vehicle · Technology")
  pick: () => defOf(chosen)?.name || null,
  onSelect: (g) => openChooser(g),
  onDeselect: () => closeChooser(),
  apply: (g, c) => {
    const F = g.fleet;
    const k = realmAt(g, c);
    if (!F || !k) return g.notify?.('There is no realm to give it to.', 'bad', { x: c.x, z: c.z });
    // one feed line per spawn: the realm's "first of its kind" news is not
    // repeated for a vehicle the god hands it (the line below says it)
    const fk = k.id + '|' + chosen;
    const hadFirst = !!F.firsts?.has(fk);
    F.firsts?.add(fk);
    const v = F.spawnVehicle(chosen, c.x, c.z, k.id);
    const def = KINDS[chosen] || AIR_KINDS[chosen];
    if (!v && !hadFirst) F.firsts?.delete(fk);
    if (!v) return g.notify?.(cap(F.lastRefusal || 'it cannot go there') + '.', 'bad', { x: c.x, z: c.z });
    g.fx?.emit?.('spawn', { x: c.x, z: c.z }, { scale: 0.8 });
    g.audio?.play?.('spawn', { pos: { x: c.x, z: c.z }, volume: 0.5 });
    const line = `${cap(withArticle(def.name.toLowerCase()))} joins ${theK(g.civ, k.id)}.`;
    g.notify?.(line, 'good', { x: c.x, z: c.z });
    // a short toast and a brief gold ring where it lands
    g.ui?.toast?.(line.replace(/\.$/, ''), 2200);
    g.fx?.shockwave?.(Number.isFinite(v.x) ? v.x : c.x, Number.isFinite(v.z) ? v.z : c.z, 3.2, { color: 0xf3d488, life: 1.1 });
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
    if (!pad && !port) return g.notify?.(`${cap(theK(civ, k.id))} ${pluralName(theK(civ, k.id)) ? 'have' : 'has'} no launch pad.`, 'bad', { x: c.x, z: c.z });
    const has = (t) => k.techs?.has?.(t);
    const payload = port && has('starships') ? 'starship' : port && has('orbital') && !k.orbitalStation ? 'station' : 'satellite';
    const site = payload === 'satellite' ? pad || port : port;
    const f = F.requestLaunch({ kingdom: k.id, from: site.id, payload });
    if (!f) return g.notify?.(cap(F.lastRefusal || 'the launch is scrubbed') + '.', 'bad', { x: site.x, z: site.z });
    // the realm's own clock for launches restarts (Civ reads it)
    k.launchT = g.time.total;
    if (payload === 'starship') k.starshipT = g.time.total;
    const pl = pluralName(theK(civ, k.id));
    g.notify?.(`${cap(theK(civ, k.id))} ${pl ? 'launch' : 'launches'} ${payload === 'starship' ? 'a colony starship' : payload === 'station' ? (pl ? 'their' : 'its') + ' orbital station' : 'a satellite'}.`, 'good', { x: site.x, z: site.z });
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
    const text = 'A solar storm breaks: auroras light the sky, satellites tumble and aircraft are grounded';
    if (g.civ?._note) g.civ._note(text, 'disaster', { x: c.x, z: c.z }, 'solarstorm', 30);
    else g.notify?.(text, 'disaster', { x: c.x, z: c.z });
  },
});
