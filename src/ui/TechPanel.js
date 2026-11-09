import { el, esc, hexCss, safe } from './dom.js';
import { uiIcon } from './icons.js';
import { techList, techDef, eraNames, prettyId } from './depth.js';

const ERA_ICON = ['house', 'build', 'job-soldier', 'chronicle'];

export function kingdomOf(game, id) {
  const ks = game.civ?.kingdoms || [];
  return ks[id]?.id === id ? ks[id] : ks.find((k) => k && k.id === id) || null;
}
export function eraOf(game, k) {
  if (!k) return 0;
  const e = safe(() => game.civ?.kingdomEra?.(k.id), null);
  return Math.max(0, Math.min(3, Number.isFinite(e) ? e : Number.isFinite(k.era) ? k.era : 0));
}
const has = (k, id) => (k?.techs instanceof Set ? k.techs.has(id) : Array.isArray(k?.techs) ? k.techs.includes(id) : !!k?.techs?.[id]);
const learnedIds = (k) => (k?.techs instanceof Set ? [...k.techs] : Array.isArray(k?.techs) ? k.techs : k?.techs ? Object.keys(k.techs).filter((x) => k.techs[x]) : []);

// Current research: {def, id, pct} (fields guarded: researching may be an id or an object).
export function researchOf(game, k) {
  if (!k) return null;
  const r = k.researching;
  const id = typeof r === 'string' ? r : r?.id ?? null;
  if (!id) return null;
  const def = techDef(game, id) || (typeof r === 'object' ? r : null);
  const cost = def?.cost ?? r?.cost ?? 0;
  let pct = r?.progress ?? (cost ? (k.knowledge ?? 0) / cost : null);
  if (pct != null) pct = Math.max(0, Math.min(1, pct));
  return { id, def, pct, name: def?.name || prettyId(id) };
}

export function techPanel(ui, kingdomId) {
  const g = ui.game;
  const k = kingdomOf(g, kingdomId);
  const eras = eraNames();
  const body = el('div', { class: 'ws-tech' });
  if (!k) {
    body.append(el('div', { class: 'ws-empty' }, el('div', { class: 'ws-empty__art', html: uiIcon('chronicle') }), el('div', { class: 'ws-empty__title', text: 'No realm chosen' }), el('p', { class: 'ws-empty__txt', text: 'Open a kingdom from the Kingdoms panel to see its learning.' })));
    return { title: 'Technology', icon: 'chronicle', body, wide: 'xl' };
  }
  const era = eraOf(g, k);
  const color = hexCss(k.color ?? safe(() => g.civ.kingdomColor(k.id), 0xe9c77b));
  const res = researchOf(g, k);
  const all = techList(g);
  const learned = learnedIds(k);
  body.style.setProperty('--k', color);
  body.append(
    el(
      'header',
      { class: 'ws-tech__head' },
      el('span', { class: 'ws-king__crest' }, el('span', { text: (k.name || '?').replace(/^(the|kingdom of)\s+/i, '')[0] || '?' })),
      el(
        'div',
        { class: 'ws-tech__titles' },
        el('div', { class: 'ws-tech__name', text: k.name || 'Kingdom' }),
        el('div', { class: 'ws-tech__meta' }, el('span', { class: `ws-era is-era${era}`, html: `${uiIcon(ERA_ICON[era])}<span>${esc(eras[era] || '')} Era</span>` }), el('span', { text: `${learned.length}${all.length ? ` of ${all.length}` : ''} learned` }), k.knowledge != null ? el('span', { text: `${Math.floor(k.knowledge)} knowledge` }) : null),
      ),
    ),
  );
  body.append(
    el(
      'div',
      { class: 'ws-tech__now' + (res ? '' : ' is-idle') },
      el('span', { class: 'ws-tech__nowico', html: uiIcon('sparkle') }),
      el(
        'div',
        { class: 'ws-tech__nowbody' },
        el('small', { text: g.laws?.civTechnology === false ? 'Research is halted by World Law' : res ? 'Now studying' : 'Not studying anything' }),
        el('b', { text: res ? res.name : '—' }),
        res?.def?.description ? el('p', { text: res.def.description }) : null,
        res && res.pct != null ? el('span', { class: 'ws-meter' }, el('i', { style: `width:${(res.pct * 100).toFixed(1)}%` })) : null,
      ),
      res && res.pct != null ? el('span', { class: 'ws-tech__pct', text: `${Math.round(res.pct * 100)}%` }) : null,
    ),
  );
  if (all.length) {
    const grid = el('div', { class: 'ws-tech__grid' });
    for (let e = 0; e < Math.max(4, eras.length); e++) {
      const techs = all.filter((t) => (Number.isFinite(t.era) ? t.era : eras.indexOf(t.era)) === e);
      if (!techs.length) continue;
      const col = el('div', { class: 'ws-tech__col' + (e <= era ? ' is-reached' : '') }, el('div', { class: `ws-tech__era is-era${e}`, html: `${uiIcon(ERA_ICON[e] || 'chronicle')}<span>${esc(eras[e] || `Era ${e + 1}`)}</span>` }));
      for (const t of techs) {
        const got = has(k, t.id);
        const now = res?.id === t.id;
        const reqs = (t.requires || []).map((r) => techDef(g, r)?.name || prettyId(r));
        const ready = !got && (t.requires || []).every((r) => has(k, r));
        col.append(
          el(
            'div',
            { class: 'ws-techcard' + (got ? ' is-learned' : now ? ' is-now' : ready ? ' is-ready' : ' is-locked'), 'data-tip': [t.description, got ? 'Learned' : now ? 'Being studied now' : ready ? 'Ready to study' : reqs.length ? `Needs ${reqs.join(', ')}` : ''].filter(Boolean).join(' · ') },
            el('span', { class: 'ws-techcard__state', html: uiIcon(got ? 'good' : now ? 'sparkle' : ready ? 'chev-right' : 'shield') }),
            el('span', { class: 'ws-techcard__txt' }, el('b', { text: t.name || prettyId(t.id) }), reqs.length ? el('small', { text: `Needs ${reqs.join(', ')}` }) : t.description ? el('small', { text: t.description }) : null),
            now && res.pct != null ? el('span', { class: 'ws-meter' }, el('i', { style: `width:${(res.pct * 100).toFixed(1)}%` })) : null,
          ),
        );
      }
      grid.append(col);
    }
    body.append(grid);
  } else if (learned.length) {
    body.append(el('div', { class: 'ws-tech__plain' }, ...learned.map((id) => el('span', { class: 'ws-techchip', html: `${uiIcon('good')}<span>${esc(prettyId(id))}</span>` }))));
  } else {
    body.append(el('div', { class: 'ws-empty' }, el('div', { class: 'ws-empty__art', html: uiIcon('chronicle') }), el('div', { class: 'ws-empty__title', text: 'Learning has not begun' }), el('p', { class: 'ws-empty__txt', text: 'As this realm grows, its scholars will uncover new crafts and ideas.' })));
  }
  return { title: 'Technology', icon: 'chronicle', body, wide: 'xl' };
}
