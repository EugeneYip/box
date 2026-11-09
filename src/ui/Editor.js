import { el, esc, safe, hexCss } from './dom.js';
import { uiIcon } from './icons.js';
import { REG, prettyId } from './depth.js';

// Editing card for kingdoms, villages and creatures (docs/EDITING.md).
// Built once when editing starts and patched in place afterwards, so it never
// re-renders while the player is typing. Every change applies at once through
// the owning module's API and offers a 10 s Undo from a toast. Controls whose
// API is missing are disabled.

const BANNER_ICON = {
  tower: 'found-kingdom',
  wheat: 'plant-wheat',
  wolf: 'spawn-wolf',
  star: 'sparkle',
  wave: 'ocean',
  oak: 'plant-tree',
  tree: 'plant-tree',
  flame: 'fire',
  fire: 'fire',
  crown: 'crown',
  anvil: 'build',
  hammer: 'build',
  ship: 'ship',
  moon: 'night',
  sun: 'sun',
  eye: 'curse',
  sword: 'sword',
  swords: 'declare-war',
  shield: 'shield',
  bear: 'spawn-bear',
  stag: 'spawn-deer',
  deer: 'spawn-deer',
  fish: 'spawn-fish',
  bird: 'spawn-bird',
  eagle: 'spawn-bird',
  mountain: 'mountain',
  key: 'gold',
  rose: 'plant-flowers',
  flower: 'plant-flowers',
  serpent: 'spawn-snake',
  dragon: 'spawn-dragon',
  horse: 'spawn-horse',
  castle: 'found-kingdom',
};
const DEFAULT_SYMBOLS = ['tower', 'wheat', 'wolf', 'star', 'wave', 'oak', 'flame', 'crown', 'anvil', 'ship', 'moon', 'eye'];
const DEFAULT_FIELDS = ['plain', 'pale', 'bend', 'chevron', 'quartered'];
const fn = (o, name) => typeof o?.[name] === 'function';
const lighten = (hex, t) => {
  const n = typeof hex === 'number' ? hex : parseInt(String(hex).replace('#', ''), 16) || 0;
  const m = (c) => Math.round(c + (255 - c) * t);
  return `rgb(${m((n >> 16) & 255)},${m((n >> 8) & 255)},${m(n & 255)})`;
};

// A small heraldic preview: field pattern in the kingdom colour plus emblem.
export function bannerSvg(color, field = 'plain', symbol = null, size = 64) {
  const c = hexCss(color);
  const light = lighten(color, 0.55);
  const pat = {
    plain: '',
    pale: `<rect x="16" y="0" width="16" height="44" fill="${light}"/>`,
    'per pale': `<rect x="16" y="0" width="16" height="44" fill="${light}"/>`,
    bend: `<path d="M0 0h10L32 34v10h-10L0 10z" fill="${light}"/>`,
    'per bend': `<path d="M32 0v44L0 0z" fill="${light}"/>`,
    chevron: `<path d="M0 30 16 14l16 16v8L16 22 0 38z" fill="${light}"/>`,
    quartered: `<rect x="16" y="0" width="16" height="22" fill="${light}"/><rect x="0" y="22" width="16" height="22" fill="${light}"/>`,
    cross: `<rect x="13" y="0" width="6" height="44" fill="${light}"/><rect x="0" y="16" width="32" height="6" fill="${light}"/>`,
  }[field] ?? '';
  const icon = symbol ? BANNER_ICON[symbol] : null;
  return `<svg class="ws-banner" viewBox="0 0 32 44" width="${size * 0.73}" height="${size}" aria-hidden="true">
    <defs><clipPath id="bn-${field}-${String(symbol)}"><path d="M2 2h28v26c0 7-6 12-14 14C8 40 2 35 2 28z"/></clipPath></defs>
    <g clip-path="url(#bn-${field}-${String(symbol)})"><rect width="32" height="44" fill="${c}"/>${pat}</g>
    <path d="M2 2h28v26c0 7-6 12-14 14C8 40 2 35 2 28z" fill="none" stroke="rgba(255,240,200,.75)" stroke-width="1.4"/>
    ${icon ? `<g transform="translate(7 9) scale(.56)" style="color:#fffaf0;--tint:#fffaf0">${uiIconInner(icon)}</g>` : symbol ? `<text x="16" y="25" text-anchor="middle" font-size="12" fill="#fffaf0" font-family="Cinzel" font-weight="700">${esc(String(symbol)[0].toUpperCase())}</text>` : ''}
  </svg>`;
}
function uiIconInner(name) {
  const s = uiIcon(name);
  return s.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
}

export class Editor {
  constructor(inspector) {
    this.insp = inspector;
    this.ui = inspector.ui;
    this.game = inspector.game;
  }

  // ---------------------------------------------------------------- undo toast
  applied(text, undo) {
    this.ui.undoToast?.(text, undo);
    this.game.audio?.play?.('ui-click', { volume: 0.4 });
  }

  // ---------------------------------------------------------------- building blocks
  section(title, ...kids) {
    return el('section', { class: 'ws-esec' }, el('h5', { text: title }), ...kids);
  }
  missing(text = 'Coming soon') {
    return el('div', { class: 'ws-emissing', text });
  }
  nameField(value, max, ok, apply) {
    const input = el('input', { class: 'ws-input ws-ename', type: 'text', value: value || '', maxlength: max, spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Name', disabled: ok ? null : true });
    const commit = () => {
      const v = input.value.trim();
      if (!v || v === (input.dataset.cur ?? value)) return;
      if (apply(v)) input.dataset.cur = v;
      else input.classList.add('is-bad');
    };
    input.dataset.cur = value || '';
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') {
        input.value = input.dataset.cur;
        input.blur();
      }
    });
    input.addEventListener('input', () => input.classList.remove('is-bad'));
    return input;
  }
  toggle(label, value, ok, onChange, desc = null) {
    const input = el('input', { type: 'checkbox', class: 'ws-switch__in', role: 'switch', 'aria-label': label, disabled: ok ? null : true });
    input.checked = !!value;
    input.addEventListener('change', () => {
      if (!onChange(input.checked)) input.checked = !input.checked;
    });
    return el(
      'label',
      { class: 'ws-erow' + (ok ? '' : ' is-disabled') },
      el('span', { class: 'ws-erow__txt' }, el('b', { text: label }), desc ? el('small', { text: desc }) : null),
      el('span', { class: 'ws-switch' }, input, el('span', { class: 'ws-switch__track' }, el('span', { class: 'ws-switch__knob' }))),
    );
  }
  slider(label, value, min, max, step, ok, onChange, fmt = (v) => `×${+(+v).toFixed(2)}`) {
    const out = el('output', { class: 'ws-row__val', text: fmt(value) });
    const r = el('input', { type: 'range', class: 'ws-range', min, max, step, value, 'aria-label': label, disabled: ok ? null : true });
    const paint = () => r.style.setProperty('--p', ((r.value - min) / (max - min)) * 100 + '%');
    paint();
    let before = value;
    r.addEventListener('input', () => {
      paint();
      out.textContent = fmt(+r.value);
    });
    r.addEventListener('change', () => {
      const prev = before;
      if (onChange(+r.value, prev)) before = +r.value;
    });
    return el('div', { class: 'ws-erow ws-erow--stack' + (ok ? '' : ' is-disabled') }, el('span', { class: 'ws-erow__txt' }, el('b', { text: label })), el('span', { class: 'ws-row__ctl' }, r, out));
  }
  select(label, options, value, ok, onChange) {
    const s = el('select', { class: 'ws-select', 'aria-label': label, disabled: ok ? null : true });
    for (const o of options) {
      const op = el('option', { value: String(o.value), text: o.label });
      if (String(o.value) === String(value)) op.selected = true;
      s.append(op);
    }
    s.addEventListener('change', () => onChange(s.value));
    return el('label', { class: 'ws-erow ws-erow--stack' + (ok ? '' : ' is-disabled') }, el('span', { class: 'ws-erow__txt' }, el('b', { text: label })), s);
  }

  // ---------------------------------------------------------------- entry
  build(r) {
    const kind = r.unit ? 'unit' : r.kind === 'kingdom' ? 'kingdom' : 'village';
    const box = el('div', { class: 'ws-edit' });
    // Escape in any field drops focus (and reverts uncommitted text); a second Escape closes the card
    box.addEventListener('keydown', (e) => {
      const t = e.target;
      if (e.key !== 'Escape' || !t.matches?.('input, select')) return;
      if (t.dataset.cur != null && t.type === 'text') t.value = t.dataset.cur;
      t.blur();
    });
    try {
      if (kind === 'kingdom') this.kingdom(box, r.kingdom);
      else if (kind === 'village') this.village(box, r.village || this.game.civ?.villages?.[r.building?.village]);
      else this.unit(box, r.unit);
    } catch (err) {
      console.warn('[ui] editor', err);
      box.append(this.missing('This editor is not available yet.'));
    }
    return box;
  }

  // ---------------------------------------------------------------- kingdom
  kingdom(box, k) {
    const g = this.game;
    const civ = g.civ || {};
    if (!k) return box.append(this.missing('No kingdom here.'));
    const id = k.id;
    const nameIn = this.nameField(k.name, 32, fn(civ, 'renameKingdom'), (v) => {
      const prev = k.name;
      const ok = !!safe(() => civ.renameKingdom(id, v), false);
      if (ok) {
        this.insp.patchTitle(v);
        this.applied(`Renamed to ${v}`, () => {
          civ.renameKingdom(id, prev);
          nameIn.value = nameIn.dataset.cur = prev;
          this.insp.patchTitle(prev);
        });
      }
      return ok;
    });
    box.append(this.section('Name', nameIn, fn(civ, 'renameKingdom') ? null : this.missing()));

    // colour
    const preview = el('span', { class: 'ws-ebanner' });
    const drawBanner = () => {
      const b = k.banner || {};
      preview.innerHTML = bannerSvg(k.color, b.field || 'plain', b.symbol || null, 72);
    };
    drawBanner();
    const sw = el('div', { class: 'ws-swatches' });
    const okColor = fn(civ, 'setKingdomColor');
    const setColor = (hex) => {
      const prev = k.color;
      if (hex === prev) return;
      if (!safe(() => civ.setKingdomColor(id, hex), false)) return;
      drawBanner();
      markSw();
      this.applied('Colours changed', () => {
        civ.setKingdomColor(id, prev);
        drawBanner();
        markSw();
      });
    };
    const sugg = safe(() => civ.kingdomColorSuggestions?.(id), null) || [];
    const markSw = () => sw.querySelectorAll('.ws-swatch').forEach((b) => b.classList.toggle('is-on', +b.dataset.hex === k.color));
    for (const hex of [k.color, ...sugg.filter((h) => h !== k.color)].slice(0, 13)) {
      sw.append(el('button', { class: 'ws-swatch', type: 'button', 'data-hex': hex, style: `--c:${hexCss(hex)}`, 'aria-label': hexCss(hex), disabled: okColor ? null : true, onclick: () => setColor(hex) }));
    }
    const picker = el('input', { type: 'color', class: 'ws-colorpick', value: hexCss(k.color), 'aria-label': 'Custom colour', disabled: okColor ? null : true });
    picker.addEventListener('change', () => setColor(parseInt(picker.value.slice(1), 16)));
    sw.append(el('label', { class: 'ws-swatch ws-swatch--custom', 'data-tip': 'Pick any colour' }, picker, el('span', { html: uiIcon('plus') })));
    markSw();
    box.append(this.section('Colours', sw, okColor ? null : this.missing()));

    // banner
    const okBanner = fn(civ, 'setKingdomBanner');
    const symbols = (Array.isArray(civ.BANNER_SYMBOLS) && civ.BANNER_SYMBOLS.length ? civ.BANNER_SYMBOLS : DEFAULT_SYMBOLS).map((s) => (typeof s === 'string' ? s : s.id));
    const fields = (Array.isArray(civ.BANNER_FIELDS) && civ.BANNER_FIELDS.length ? civ.BANNER_FIELDS : DEFAULT_FIELDS).map((s) => (typeof s === 'string' ? s : s.id));
    const symGrid = el('div', { class: 'ws-egrid ws-egrid--sym' });
    const fieldGrid = el('div', { class: 'ws-egrid ws-egrid--field' });
    const setBanner = (patch) => {
      const prev = { ...(k.banner || {}) };
      const next = { symbol: prev.symbol ?? symbols[0], field: prev.field ?? fields[0], ...patch };
      if (!safe(() => civ.setKingdomBanner(id, next), false)) return;
      drawBanner();
      markBanner();
      this.applied('Banner changed', () => {
        civ.setKingdomBanner(id, prev);
        drawBanner();
        markBanner();
      });
    };
    const markBanner = () => {
      symGrid.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.v === (k.banner?.symbol ?? '')));
      fieldGrid.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.v === (k.banner?.field ?? '')));
    };
    for (const s of symbols)
      symGrid.append(el('button', { class: 'ws-ebtn', type: 'button', 'data-v': s, 'data-tip': prettyId(s), 'aria-label': prettyId(s), disabled: okBanner ? null : true, html: BANNER_ICON[s] ? uiIcon(BANNER_ICON[s]) : `<b>${esc(s[0].toUpperCase())}</b>`, onclick: () => setBanner({ symbol: s }) }));
    for (const f of fields)
      fieldGrid.append(el('button', { class: 'ws-ebtn ws-ebtn--field', type: 'button', 'data-v': f, 'data-tip': prettyId(f), 'aria-label': prettyId(f), disabled: okBanner ? null : true, html: bannerSvg(0x8a8478, f, null, 30), onclick: () => setBanner({ field: f }) }));
    markBanner();
    box.append(this.section('Banner', el('div', { class: 'ws-ebannerrow' }, preview, el('div', { class: 'ws-ebannerpick' }, symGrid, fieldGrid)), okBanner ? null : this.missing()));

    // motto
    const okMotto = fn(civ, 'setKingdomMotto');
    const motto = el('input', { class: 'ws-input', type: 'text', value: k.motto || '', maxlength: 48, placeholder: 'A motto for the realm…', spellcheck: 'false', 'aria-label': 'Motto', disabled: okMotto ? null : true });
    motto.dataset.cur = k.motto || '';
    motto.addEventListener('change', () => {
      const prev = motto.dataset.cur;
      const v = motto.value.trim();
      if (v === prev) return;
      if (safe(() => civ.setKingdomMotto(id, v), false)) {
        motto.dataset.cur = v;
        this.applied(v ? 'Motto proclaimed' : 'Motto removed', () => {
          civ.setKingdomMotto(id, prev);
          motto.value = motto.dataset.cur = prev;
        });
      }
    });
    motto.addEventListener('keydown', (e) => e.key === 'Enter' && motto.blur());
    box.append(this.section('Motto', motto, okMotto ? null : this.missing()));

    // diplomacy
    const okRel = fn(civ, 'setRelation');
    const dip = el('div', { class: 'ws-edip' });
    const relOf = (o) => (safe(() => civ.atWar?.(id, o.id), false) ? 'war' : safe(() => civ.allied?.(id, o.id), false) ? 'alliance' : 'peace');
    const others = (civ.kingdoms || []).filter((o) => o && o.alive !== false && o.id !== id);
    for (const o of others) {
      const row = el('div', { class: 'ws-edip__row', style: `--k:${hexCss(o.color)}` }, el('span', { class: 'ws-edip__name' }, el('i'), el('span', { text: o.name })));
      const seg = el('div', { class: 'ws-pills ws-pills--dip' });
      const mark = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.v === relOf(o)));
      for (const [v, label] of [
        ['war', 'War'],
        ['peace', 'Peace'],
        ['alliance', 'Alliance'],
      ])
        seg.append(
          el('button', {
            class: `ws-pill is-${v}`,
            type: 'button',
            'data-v': v,
            text: label,
            disabled: okRel ? null : true,
            onclick: () => {
              const prev = relOf(o);
              if (prev === v) return;
              if (!safe(() => civ.setRelation(id, o.id, v), false)) return;
              mark();
              this.applied(`${label} with ${o.name}`, () => {
                civ.setRelation(id, o.id, prev);
                mark();
              });
            },
          }),
        );
      mark();
      row.append(seg);
      dip.append(row);
    }
    if (!others.length) dip.append(this.missing('No other realms stand yet.'));
    box.append(this.section('Diplomacy', dip, okRel ? null : this.missing()));

    // policies
    const okPol = fn(civ, 'setKingdomPolicy');
    const pol = safe(() => civ.kingdomPolicies?.(id), null) || {};
    const setPol = (key, v, prev, label) => {
      if (!safe(() => civ.setKingdomPolicy(id, key, v), false)) return false;
      this.applied(label, () => civ.setKingdomPolicy(id, key, prev));
      return true;
    };
    box.append(
      this.section(
        'Policies',
        this.toggle('Settlers', pol.expansion ?? true, okPol, (v) => setPol('expansion', v, !v, v ? 'Settlers may set out' : 'Settlers stay home'), 'Villages found new villages'),
        this.slider('War fever', pol.warlike ?? 1, 0, 3, 0.25, okPol, (v, prev) => setPol('warlike', v, prev, `War fever ×${v}`)),
        this.toggle('Rebellions', pol.rebellions ?? true, okPol, (v) => setPol('rebellions', v, !v, v ? 'Rebellions possible' : 'No rebellions')),
        this.toggle('Research', pol.technology ?? true, okPol, (v) => setPol('technology', v, !v, v ? 'Research resumes' : 'Research halted')),
        this.slider('Growth', pol.growth ?? 1, 0.25, 3, 0.25, okPol, (v, prev) => setPol('growth', v, prev, `Growth ×${v}`)),
        this.toggle('Lock diplomacy', pol.lockDiplomacy ?? false, okPol, (v) => setPol('lockDiplomacy', v, !v, v ? 'Relations locked' : 'Relations free'), 'Kings may not undo your decrees'),
        okPol ? null : this.missing(),
      ),
    );
  }

  // ---------------------------------------------------------------- village
  village(box, v) {
    const g = this.game;
    const civ = g.civ || {};
    if (!v) return box.append(this.missing('No village here.'));
    const id = v.id;
    const nameIn = this.nameField(v.name, 32, fn(civ, 'renameVillage'), (name) => {
      const prev = v.name;
      const ok = !!safe(() => civ.renameVillage(id, name), false);
      if (ok) {
        this.insp.patchTitle(name);
        this.applied(`Renamed to ${name}`, () => {
          civ.renameVillage(id, prev);
          nameIn.value = nameIn.dataset.cur = prev;
          this.insp.patchTitle(prev);
        });
      }
      return ok;
    });
    box.append(this.section('Name', nameIn, fn(civ, 'renameVillage') ? null : this.missing()));
    const okT = fn(civ, 'transferVillage');
    const opts = [{ value: 'null', label: 'An independent realm' }, ...(civ.kingdoms || []).filter((k) => k && k.alive !== false).map((k) => ({ value: k.id, label: k.name }))];
    box.append(
      this.section(
        'Allegiance',
        this.select('Belongs to', opts, v.kingdom ?? 'null', okT, (val) => {
          const prev = v.kingdom;
          const to = val === 'null' ? null : +val;
          if (!safe(() => civ.transferVillage(id, to), false)) return;
          this.applied(to == null ? `${v.name} declares independence` : `${v.name} joins the ${civ.kingdomName?.(to) || 'realm'}`, () => civ.transferVillage(id, prev ?? null));
        }),
        okT ? null : this.missing(),
      ),
    );
    const okP = fn(civ, 'setVillagePolicy');
    const pol = safe(() => civ.villagePolicies?.(id), null) || {};
    const setPol = (key, val, prev, label) => {
      if (!safe(() => civ.setVillagePolicy(id, key, val), false)) return false;
      this.applied(label, () => civ.setVillagePolicy(id, key, prev));
      return true;
    };
    box.append(
      this.section(
        'Policies',
        this.toggle('Walls', pol.walls ?? true, okP, (val) => setPol('walls', val, !val, val ? 'Walls may be raised' : 'No walls')),
        this.slider('Growth', pol.growth ?? 1, 0.25, 3, 0.25, okP, (val, prev) => setPol('growth', val, prev, `Growth ×${val}`)),
        this.toggle('New buildings', pol.buildings ?? true, okP, (val) => setPol('buildings', val, !val, val ? 'Building allowed' : 'Building halted')),
        this.toggle('Capital', pol.capital ?? false, okP, (val) => setPol('capital', val, !val, val ? `${v.name} becomes the capital` : 'Capital unchanged'), 'Seat of its kingdom'),
        okP ? null : this.missing(),
      ),
    );
  }

  // ---------------------------------------------------------------- creature
  unit(box, u) {
    const g = this.game;
    const U = g.units || {};
    if (!u) return box.append(this.missing('Nothing to edit.'));
    const nameIn = this.nameField(u.name || '', 24, fn(U, 'rename'), (name) => {
      const prev = u.name || '';
      const ok = !!safe(() => U.rename(u, name), false);
      if (ok) {
        this.insp.patchTitle(name);
        this.applied(`Renamed to ${name}`, () => {
          if (prev) U.rename(u, prev);
          nameIn.value = nameIn.dataset.cur = prev;
          this.insp.patchTitle(prev || u.def?.name || '');
        });
      }
      return ok;
    });
    box.append(this.section('Name', nameIn, fn(U, 'rename') ? null : this.missing()));

    // flags
    const okF = fn(U, 'setUnitFlag');
    const flag = (key) => !!(u.flags?.[key] ?? u.data?.flags?.[key] ?? u.data?.[key]);
    const setF = (key, val, label) => {
      if (!safe(() => U.setUnitFlag(u, key, val), false)) return false;
      this.applied(label, () => U.setUnitFlag(u, key, !val));
      return true;
    };
    box.append(
      this.section(
        'Blessings',
        this.toggle('Immortal', flag('immortal'), okF, (v) => setF('immortal', v, v ? 'Made immortal' : 'Mortal again'), 'No death from age, hunger or wounds'),
        this.toggle('Pacifist', flag('pacifist'), okF, (v) => setF('pacifist', v, v ? 'Swears off violence' : 'Will fight again'), 'Never starts a fight'),
        this.toggle('Ageless', flag('frozenAge'), okF, (v) => setF('frozenAge', v, v ? 'Age frozen' : 'Ageing resumes'), 'Stops growing older'),
        okF ? null : this.missing(),
      ),
    );

    // traits
    const T = REG.traits?.TRAITS || U.TRAITS || [];
    const okT = fn(U, 'addTrait') && fn(U, 'removeTrait');
    const cats = [...new Set(T.map((t) => t.category))];
    let cat = 'all',
      q = '';
    const list = el('div', { class: 'ws-etraits' });
    const has = (id) => (u.traits || []).includes(id);
    const drawTraits = () => {
      list.innerHTML = '';
      for (const t of T) {
        if (cat !== 'all' && t.category !== cat) continue;
        if (q && !`${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q)) continue;
        const on = has(t.id);
        list.append(
          el(
            'button',
            {
              class: `ws-etrait is-${t.category}${on ? ' is-on' : ''}`,
              type: 'button',
              disabled: okT ? null : true,
              onclick: () => {
                const was = has(t.id);
                const before = [...(u.traits || [])];
                // a god's gift ignores the Traits law; opposites replace each other
                const ok = was ? safe(() => U.removeTrait(u, t.id), false) : safe(() => U.addTrait(u, t.id, { force: true }), false);
                if (!ok) return;
                drawTraits();
                this.applied(was ? `Lost the trait ${t.name}` : `Gained the trait ${t.name}`, () => {
                  const now = [...(u.traits || [])];
                  for (const id of now) if (!before.includes(id)) U.removeTrait(u, id);
                  for (const id of before) if (!now.includes(id)) U.addTrait(u, id, { force: true, silent: true });
                  drawTraits();
                });
              },
            },
            el('span', { class: 'ws-etrait__mark', html: uiIcon(on ? 'good' : 'plus') }),
            el('span', { class: 'ws-etrait__txt' }, el('b', { text: t.name }), el('small', { text: t.description || '' })),
          ),
        );
      }
      if (!list.childElementCount) list.append(this.missing('No traits match.'));
    };
    const search = el('input', { class: 'ws-input', type: 'search', placeholder: 'Search traits…', 'aria-label': 'Search traits', spellcheck: 'false' });
    search.addEventListener('input', () => {
      q = search.value.trim().toLowerCase();
      drawTraits();
    });
    const pills = el('div', { class: 'ws-pills ws-pills--cats' });
    for (const c of ['all', ...cats])
      pills.append(
        el('button', {
          class: 'ws-pill' + (c === cat ? ' is-on' : ''),
          type: 'button',
          text: c === 'all' ? 'All' : prettyId(c),
          onclick: (e) => {
            cat = c;
            pills.querySelectorAll('.ws-pill').forEach((b) => b.classList.toggle('is-on', b === e.currentTarget));
            drawTraits();
          },
        }),
      );
    drawTraits();
    box.append(this.section('Traits', search, pills, list, okT && T.length ? null : this.missing(T.length ? undefined : 'Traits are not known in this world yet.')));

    // item giver
    const okI = fn(U, 'giveItem');
    const opt = safe(() => U.itemOptions?.(), null) || {};
    const slots = opt.slots || ['weapon', 'armor', 'tool', 'trinket'];
    const kindsFor = (slot) => {
      const k = opt.kinds;
      if (Array.isArray(k)) return k;
      if (k && typeof k === 'object') return k[slot] || [];
      return [];
    };
    const mats = Array.isArray(opt.materials) ? opt.materials : opt.materials ? Object.keys(opt.materials) : ['wood', 'stone', 'bronze', 'iron', 'steel', 'starsteel'];
    const quals = Array.isArray(opt.qualities) ? opt.qualities : opt.qualities ? Object.keys(opt.qualities) : ['crude', 'common', 'fine', 'masterwork', 'legendary'];
    const st = { slot: slots[0], kind: kindsFor(slots[0])[0] || '', material: mats[Math.min(3, mats.length - 1)], quality: quals[Math.min(2, quals.length - 1)] };
    const sel = (label, options, key) => {
      const s = el('select', { class: 'ws-select', 'aria-label': label, disabled: okI ? null : true });
      const fill = (list2) => {
        s.innerHTML = '';
        for (const o of list2) s.append(el('option', { value: o, text: prettyId(o) }));
        s.value = st[key] && list2.includes(st[key]) ? st[key] : list2[0] || '';
        st[key] = s.value;
      };
      fill(options);
      s.addEventListener('change', () => {
        st[key] = s.value;
        if (key === 'slot') kindSel.fill(kindsFor(s.value));
      });
      s.fill = fill;
      return s;
    };
    const slotSel = sel('Slot', slots, 'slot');
    const kindSel = sel('Kind', kindsFor(st.slot), 'kind');
    const matSel = sel('Material', mats, 'material');
    const qualSel = sel('Quality', quals, 'quality');
    const give = el(
      'button',
      {
        class: 'ws-btn ws-btn--sm',
        type: 'button',
        disabled: okI ? null : true,
        onclick: () => {
          const prev = u.equipment?.[st.slot] || null;
          const spec = { slot: st.slot, material: st.material, quality: st.quality, ...(st.kind ? { kind: st.kind } : {}) };
          if (!safe(() => U.giveItem(u, spec), false)) return;
          const it = u.equipment?.[st.slot];
          const slot = st.slot;
          this.applied(`Gave ${it?.name || prettyId(slot)}`, () => {
            if (prev) {
              // the replaced item went to the armoury: take it back out
              for (const k of g.civ?.kingdoms || []) {
                const i = k?.armory?.indexOf?.(prev) ?? -1;
                if (i >= 0) k.armory.splice(i, 1);
              }
              if (fn(U, 'equip')) U.equip(u, prev);
            } else if (u.equipment && u.equipment[slot] === it) {
              u.equipment[slot] = null;
              u._eqVer = (u._eqVer || 0) + 1;
              if (it?.legendary) U._legendCache = null;
            }
          });
        },
      },
      el('span', { html: uiIcon('sparkle') }),
      el('span', { text: 'Bestow' }),
    );
    box.append(
      this.section(
        'Gift an item',
        el('div', { class: 'ws-egive' }, el('label', null, el('small', { text: 'Slot' }), slotSel), el('label', null, el('small', { text: 'Kind' }), kindSel), el('label', null, el('small', { text: 'Material' }), matSel), el('label', null, el('small', { text: 'Quality' }), qualSel)),
        give,
        okI ? null : this.missing(),
      ),
    );

    // kingdom move (people only)
    if (u.def?.kind === 'humanoid') {
      const civ = g.civ || {};
      const okK = fn(U, 'setKingdom');
      const opts = (civ.kingdoms || []).filter((k) => k && k.alive !== false).map((k) => ({ value: k.id, label: k.name }));
      if (u.kingdom == null || u.kingdom < 0) opts.unshift({ value: -1, label: 'No kingdom' });
      box.append(
        this.section(
          'Allegiance',
          this.select('Swears fealty to', opts, u.kingdom ?? -1, okK && opts.length, (val) => {
            const prev = u.kingdom;
            if (!safe(() => U.setKingdom(u, +val), false)) return;
            this.applied(`Now serves the ${civ.kingdomName?.(+val) || 'realm'}`, () => prev != null && prev >= 0 && U.setKingdom(u, prev));
          }),
          okK ? null : this.missing(),
        ),
      );
    }
  }
}
