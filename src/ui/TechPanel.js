import { el, esc, hexCss, safe } from './dom.js';
import { uiIcon } from './icons.js';
import { techList, techDef, eraNames, prettyId, ERA_ICON } from './depth.js';

export function kingdomOf(game, id) {
  const ks = game.civ?.kingdoms || [];
  return ks[id]?.id === id ? ks[id] : ks.find((k) => k && k.id === id) || null;
}
export function eraOf(game, k) {
  if (!k) return 0;
  const e = safe(() => game.civ?.kingdomEra?.(k.id), null);
  return Math.max(0, Math.min(eraNames().length - 1, Number.isFinite(e) ? e : Number.isFinite(k.era) ? k.era : 0));
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

// Side arts (tech.js `side: true`) by branch; they never count toward an era.
export const BRANCH_NAME = { food: 'Food', medicine: 'Medicine', land: 'Land', city: 'City', urban: 'Urban planning' };
const BRANCH_ICON = { food: 'plant-wheat', medicine: 'heal', land: 'hill', city: 'house', urban: 'road' };
// The second line of study: {def, id, pct, name, branch}
export function sideResearchOf(game, k) {
  const id = k?.researchSide;
  if (!id) return null;
  const def = techDef(game, id);
  const cost = def?.cost || 0;
  const pct = cost ? Math.max(0, Math.min(1, (k.sideKnowledge || 0) / cost)) : null;
  return { id, def, pct, name: def?.name || prettyId(id), branch: BRANCH_NAME[def?.branch] || prettyId(def?.branch || '') };
}

export function techPanel(ui, kingdomId) {
  const g = ui.game;
  const k = kingdomOf(g, kingdomId);
  const eras = eraNames();
  const body = el('div', { class: 'ws-tech' });
  if (!k) {
    body.append(el('div', { class: 'ws-empty' }, el('div', { class: 'ws-empty__art', html: uiIcon('chronicle') }), el('div', { class: 'ws-empty__title', text: 'No realm chosen' }), el('p', { class: 'ws-empty__txt', text: 'Open a realm from the Realms panel to see its learning.' })));
    return { title: 'Technology', icon: 'chronicle', body, wide: 'xl' };
  }
  const era = eraOf(g, k);
  const color = hexCss(k.color ?? safe(() => g.civ.kingdomColor(k.id), 0xe9c77b));
  const res = researchOf(g, k);
  const side = sideResearchOf(g, k);
  const all = techList(g);
  const learned = learnedIds(k);
  const mainAll = all.filter((t) => !t.side);
  const sideAll = all.filter((t) => t.side);
  const nMain = mainAll.filter((t) => has(k, t.id)).length;
  const nSide = sideAll.filter((t) => has(k, t.id)).length;
  // the World Law that holds realms at an era (civEraCap)
  const capRaw = g.laws?.civEraCap;
  const cap = Number.isFinite(+capRaw) ? Math.round(+capRaw) : eras.length - 1;
  body.style.setProperty('--k', color);
  // the realm line, what it studies now and the folded eras stay in view as the
  // eras scroll under them (a compact sticky header)
  const top = el('div', { class: 'ws-tech__top' });
  body.append(
    el(
      'header',
      { class: 'ws-tech__head' },
      el('span', { class: 'ws-king__crest' }, el('span', { text: (k.name || '?').replace(/^(the|kingdom of)\s+/i, '')[0] || '?' })),
      el(
        'div',
        { class: 'ws-tech__titles' },
        el('div', { class: 'ws-tech__name', text: k.name || 'Realm' }),
        el('div', { class: 'ws-tech__meta' }, el('span', { class: `ws-era is-era${era}`, html: `${uiIcon(ERA_ICON[era])}<span>${esc(eras[era] || '')} era</span>` }), sideAll.length ? el('span', { text: `${nMain} of ${mainAll.length} main arts`, 'data-tip': 'Main arts carry the realm from era to era' }) : el('span', { text: `${learned.length}${all.length ? ` of ${all.length}` : ''} learned` }), sideAll.length ? el('span', { text: `${nSide} of ${sideAll.length} side arts`, 'data-tip': 'Side arts (food, medicine, land, city and urban planning) are studied beside the main art and do not count toward eras' }) : null, k.knowledge != null ? el('span', { text: `${Math.floor(k.knowledge)} knowledge` }) : null),
      ),
    ),
  );
  // (the realm line scrolls away; what it studies and the folded eras stay)
  body.append(top);
  top.append(
    el(
      'div',
      { class: 'ws-tech__now' + (res ? '' : ' is-idle'), 'data-tip': res ? [res.def?.description, Array.isArray(res.def?.unlocks) && res.def.unlocks.length ? `Brings: ${res.def.unlocks.join('; ')}` : ''].filter(Boolean).join(' · ') || null : null },
      el('span', { class: 'ws-tech__nowico', html: uiIcon('sparkle') }),
      el(
        'div',
        { class: 'ws-tech__nowbody' },
        el('small', { text: g.laws?.civTechnology === false ? 'Research is halted by World Law' : res ? 'Now studying' : era >= cap && cap < eras.length - 1 ? `World Law holds the realms at the ${eras[cap] || ''} era` : 'Not studying anything' }),
        el('b', { text: res ? res.name : '—' }),
        // one line of what it is and brings; the full text is the box's tooltip
        res ? ((d, u) => (d || u.length ? el('p', { class: 'ws-tech__nowdesc', text: [d, u.length ? `Brings: ${u.join('; ')}` : ''].filter(Boolean).join(' · ') }) : null))(res.def?.description || '', Array.isArray(res.def?.unlocks) ? res.def.unlocks : []) : null,
        res && res.pct != null ? el('span', { class: 'ws-tech__nowmeter' }, el('span', { class: 'ws-meter' }, el('i', { style: `width:${(res.pct * 100).toFixed(1)}%` })), el('b', { class: 'ws-tech__nowpct', text: `${Math.round(res.pct * 100)}%` })) : null,
        // the second line of study: a side art, learned beside the main one
        side
          ? el(
              'div',
              { class: 'ws-tech__also', 'data-tip': side.def?.description ? `${side.def.description} · Side arts do not count toward eras` : 'Side arts do not count toward eras' },
              el('span', { class: 'ws-tech__alsoico', html: uiIcon(BRANCH_ICON[side.def?.branch] || 'leaf') }),
              el('span', { class: 'ws-tech__alsotxt' }, el('small', { text: 'Also studying' }), el('span', { text: [side.name, side.branch].filter(Boolean).join(' · ') })),
              side.pct != null ? el('span', { class: 'ws-meter ws-tech__alsometer' }, el('i', { style: `width:${(side.pct * 100).toFixed(1)}%` })) : null,
              side.pct != null ? el('b', { class: 'ws-tech__alsopct', text: `${Math.round(side.pct * 100)}%` }) : null,
            )
          : null,
      ),
    ),
  );
  if (all.length) {
    const grid = el('div', { class: 'ws-tech__grid' });
    // eras the realm has wholly learned fold into one strip above the grid, so
    // the panel opens with the realm's own era in view
    const done = [];
    // the era being researched is the current one (a realm in the Modern era
    // studying an Atomic art is working in the Atomic column)
    const eraOf = (t) => (Number.isFinite(t?.era) ? t.era : eras.indexOf(t?.era));
    const resDef = res ? all.find((t) => t.id === res.id) : null;
    const curE = resDef && eraOf(resDef) > era ? eraOf(resDef) : era;
    for (let e = 0; e < Math.max(4, eras.length); e++) {
      // main arts first, then the side arts under their own label
      const inEra = all.filter((t) => (Number.isFinite(t.era) ? t.era : eras.indexOf(t.era)) === e);
      const techs = [...inEra.filter((t) => !t.side), ...inEra.filter((t) => t.side)];
      if (!techs.length) continue;
      const beyond = e > cap;
      const whole = e < curE && techs.every((t) => has(k, t.id));
      if (whole) done.push([e, techs.length]);
      const col = el('div', { class: 'ws-tech__col' + (e <= era ? ' is-reached' : '') + (e === curE ? ' is-cur' : '') + (beyond ? ' is-capped' : '') + (whole ? ' is-done' : ''), 'data-tip': beyond ? `Beyond the latest era the World Laws allow (${eras[cap] || ''})` : null }, el('div', { class: `ws-tech__era is-era${e}`, html: `${uiIcon(ERA_ICON[e] || 'chronicle')}<span>${esc(eras[e] || `Era ${e + 1}`)}</span>${e === era ? '<em class="ws-tech__curtag">Current era</em>' : e === curE ? '<em class="ws-tech__curtag is-next" data-tip="The realm is in the ' + esc(eras[era] || '') + ' era and studies this era\'s arts">Studying</em>' : ''}` }));
      let sideHead = false;
      for (const t of techs) {
        if (t.side && !sideHead) {
          sideHead = true;
          col.append(el('div', { class: 'ws-tech__sidehead', 'data-tip': 'Studied beside the main art; they do not count toward eras' }, el('span', { text: 'Side arts' }), el('small', { text: 'not counted toward eras' })));
        }
        const got = has(k, t.id);
        const now = res?.id === t.id || side?.id === t.id;
        const nowPct = res?.id === t.id ? res.pct : side?.id === t.id ? side.pct : null;
        const reqs = (t.requires || []).map((r) => techDef(g, r)?.name || prettyId(r));
        const missing = (t.requires || []).filter((r) => !has(k, r)).map((r) => techDef(g, r)?.name || prettyId(r));
        const ul = Array.isArray(t.unlocks) ? t.unlocks : [];
        const more = ul.length > 1 ? ` and ${ul.length - 1} more` : '';
        const ready = !got && (t.requires || []).every((r) => has(k, r));
        col.append(
          el(
            'div',
            { class: 'ws-techcard' + (t.side ? ' is-side' : '') + (got ? ' is-learned' : now ? ' is-now' : ready ? ' is-ready' : ' is-locked'), 'data-tip': [t.side ? `Side art · ${BRANCH_NAME[t.branch] || prettyId(t.branch || '')}` : '', t.description, Array.isArray(t.unlocks) && t.unlocks.length ? `${got ? 'Brought' : 'Brings'}: ${t.unlocks.join('; ')}` : '', got ? 'Learned' : now ? 'Being studied now' : ready ? 'Ready to study' : reqs.length ? `Needs ${reqs.join(', ')}` : ''].filter(Boolean).join(' · ') },
            el('span', { class: 'ws-techcard__state', html: uiIcon(got ? 'good' : now ? 'sparkle' : ready ? 'chev-right' : 'shield') }),
            el(
              'span',
              { class: 'ws-techcard__txt' },
              // name, and for a locked card what is still missing, on one line
              el('span', { class: 'ws-techcard__head' }, el('b', { text: t.name || prettyId(t.id) }), t.side ? el('i', { class: `ws-techcard__branch is-${t.branch || 'x'}`, text: BRANCH_NAME[t.branch] || prettyId(t.branch || '') }) : null, !got && !ready && missing.length ? el('em', { class: 'ws-techcard__needs', text: `needs ${missing.join(', ')}` }) : null),
              // what it brought (learned) or brings: the item may be cut short, "and N more" never is
              // ("and N more" opens the whole list in place)
              ul.length
                ? el(
                    'small',
                    { class: 'ws-techcard__brings' },
                    el('span', { class: 'ws-techcard__item', text: `${got ? 'Brought' : 'Brings'}: ${ul[0]}` }),
                    more
                      ? el('button', {
                          class: 'ws-techcard__more',
                          type: 'button',
                          'aria-expanded': 'false',
                          text: more,
                          onclick: (ev) => {
                            ev.stopPropagation();
                            const b = ev.currentTarget;
                            const box = b.parentElement;
                            const open = !box.classList.contains('is-open');
                            box.classList.toggle('is-open', open);
                            box.querySelector('.ws-techcard__item').textContent = `${got ? 'Brought' : 'Brings'}: ${open ? ul.join('; ') : ul[0]}`;
                            b.textContent = open ? ' less' : more;
                            b.setAttribute('aria-expanded', open ? 'true' : 'false');
                          },
                        })
                      : null,
                  )
                : t.description
                  ? el('small', { text: t.description })
                  : null,
            ),
            now && nowPct != null ? el('span', { class: 'ws-meter' }, el('i', { style: `width:${(nowPct * 100).toFixed(1)}%` })) : null,
          ),
        );
      }
      grid.append(col);
    }
    if (done.length) {
      const btn = el('button', {
        class: 'ws-btn ws-btn--sm ws-tech__donebtn',
        type: 'button',
        'aria-expanded': 'false',
        text: 'Show them',
        onclick: () => {
          const open = grid.classList.toggle('show-done');
          btn.textContent = open ? 'Fold them' : 'Show them';
          btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          spread();
        },
      });
      top.append(
        el(
          'div',
          { class: 'ws-tech__done' },
          el('span', { class: 'ws-tech__donelbl', text: done.length > 1 ? 'Eras fully learned' : 'Era fully learned' }),
          // three or more learned eras read as one range chip, so the header stays one line
          el(
            'span',
            { class: 'ws-tech__doneeras' },
            ...(done.length >= 3
              ? [el('span', { class: `ws-era is-era${done.at(-1)[0]}`, 'data-tip': done.map(([e, n]) => `${eras[e] || ''} era: all ${n} arts learned${e === era ? ' (the current era)' : ''}`).join(' · '), html: `${uiIcon('good')}<span>${esc(eras[done[0][0]] || '')} to ${esc(eras[done.at(-1)[0]] || '')} · ${done.reduce((a, d) => a + d[1], 0)} arts</span>` })]
              : done.map(([e, n]) => el('span', { class: `ws-era is-era${e}`, 'data-tip': `${eras[e] || ''} era: all ${n} arts learned${e === era ? ' (the current era)' : ''}`, html: `${uiIcon('good')}<span>${esc(eras[e] || '')} · ${n}</span>` }))),
          ),
          btn,
        ),
      );
    }
    // the eras in view share the full width: three eras make three wide columns,
    // never three of four with an empty track; more than four wrap in two rows
    const spread = () => {
      const n = grid.querySelectorAll(grid.classList.contains('show-done') ? '.ws-tech__col' : '.ws-tech__col:not(.is-done)').length;
      grid.style.setProperty('--cols', String(Math.max(1, n <= 4 ? n : Math.ceil(n / 2))));
    };
    spread();
    body.append(grid);
    // the era headers stick just under the sticky header
    const measure = () => body.style.setProperty('--tt', `${Math.round(top.getBoundingClientRect().height)}px`);
    if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(top);
    // open at the realm's own era, not at the Hearth era
    setTimeout(() => {
      if (!body.isConnected) return;
      measure();
      const cur = grid.querySelector('.ws-tech__col.is-cur');
      const sc = body.closest('.ws-modal__body');
      if (!cur || !sc || era <= 0) return;
      const stuck = getComputedStyle(top).position === 'sticky' ? top.getBoundingClientRect().height : 0;
      const y = cur.getBoundingClientRect().top - sc.getBoundingClientRect().top - stuck;
      if (y > (sc.clientHeight - stuck) * 0.45 || y < 0) sc.scrollTop = y + sc.scrollTop - 10;
    }, 80);
  } else if (learned.length) {
    body.append(el('div', { class: 'ws-tech__plain' }, ...learned.map((id) => el('span', { class: 'ws-techchip', html: `${uiIcon('good')}<span>${esc(prettyId(id))}</span>` }))));
  } else {
    body.append(el('div', { class: 'ws-empty' }, el('div', { class: 'ws-empty__art', html: uiIcon('chronicle') }), el('div', { class: 'ws-empty__title', text: 'Learning has not begun' }), el('p', { class: 'ws-empty__txt', text: 'As this realm grows, its scholars will uncover new crafts and ideas.' })));
  }
  return { title: 'Technology', icon: 'chronicle', body, wide: 'xl' };
}
