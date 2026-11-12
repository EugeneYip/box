import { el, esc, safe, hexCss, realmColourText } from './dom.js';
import { uiIcon } from './icons.js';
import { REG, prettyId } from './depth.js';
import { bannerURL, emblemFace, EMBLEM_IDS, FIELD_IDS } from './banner.js';

// Editing card for kingdoms, villages and creatures (docs/EDITING.md).
// Built once when editing starts and patched in place afterwards, so it never
// re-renders while the player is typing. Every change applies at once through
// the owning module's API and offers a 10 s Undo from a toast. Controls whose
// API is missing are disabled.
//
// Every control reads its value from the simulation through a getter and
// registers a sync function; after any change or Undo all of them re-read the
// model, so nothing on the card can go stale (a toggle never flips the wrong way).
// Sections fold (an accordion) so long cards stay short; which ones are open
// is remembered per kind of subject for the session.

const fn = (o, name) => typeof o?.[name] === 'function';
const OPEN_DEFAULT = {
  kingdom: ['Name', 'Colours'],
  village: ['Name', 'Allegiance', 'Policies', 'Village name'],
  unit: ['Name', 'Blessings'],
};

export class Editor {
  constructor(inspector) {
    this.insp = inspector;
    this.ui = inspector.ui;
    this.game = inspector.game;
    this.syncs = [];
    this.openSecs = {};
  }

  // ---------------------------------------------------------------- change plumbing
  // After a change or an Undo: every control re-reads the model, the header follows.
  afterChange() {
    for (const f of this.syncs) safe(f, null, 'editor sync');
    if (this.insp.editing) this.insp.patchHeader?.();
    else {
      this.insp._sig = '';
      this.insp.refresh?.();
    }
  }
  applied(text, undo) {
    this.afterChange();
    this.ui.undoToast?.(
      text,
      undo
        ? () => {
            safe(undo, null, 'editor undo');
            this.afterChange();
          }
        : null,
    );
    this.game.audio?.play?.('ui-click', { volume: 0.4 });
  }
  sync(f) {
    this.syncs.push(f);
    safe(f, null, 'editor sync');
    return f;
  }

  // ---------------------------------------------------------------- building blocks
  // A foldable section. `summary` (optional) returns a short line (or markup) shown when folded.
  section(title, kids, opts = {}) {
    const kind = this.kind;
    const store = (this.openSecs[kind] ||= new Set(OPEN_DEFAULT[kind] || []));
    const sum = el('span', { class: 'ws-esec__sum' });
    const head = el('button', { class: 'ws-esec__head', type: 'button', 'aria-expanded': 'false' }, el('h5', { text: title }), sum, el('span', { class: 'ws-esec__chev', html: uiIcon('chev-down') }));
    const body = el('div', { class: 'ws-esec__body' }, ...kids.filter(Boolean));
    const sec = el('section', { class: 'ws-esec' + (opts.keep ? ' keeps-sum' : '') }, head, body);
    const setOpen = (on) => {
      sec.classList.toggle('is-open', on);
      head.setAttribute('aria-expanded', on ? 'true' : 'false');
      if (on) store.add(title);
      else store.delete(title);
    };
    head.addEventListener('click', () => setOpen(!sec.classList.contains('is-open')));
    setOpen(opts.open ?? store.has(title));
    if (opts.summary)
      this.sync(() => {
        const s = opts.summary();
        if (s && typeof s === 'object' && s.html != null) sum.innerHTML = s.html;
        else sum.textContent = s || '';
      });
    return sec;
  }
  missing(text = 'Coming soon') {
    return el('div', { class: 'ws-emissing', text });
  }
  // Text field committed on change (Enter); Escape reverts. `get` reads the model.
  textField(get, max, ok, apply, attrs = {}) {
    const input = el('input', { class: 'ws-input', type: 'text', maxlength: max, spellcheck: 'false', autocomplete: 'off', enterkeyhint: 'done', disabled: ok ? null : true, ...attrs });
    input.addEventListener('change', () => {
      const v = input.value.trim();
      if (v === input.dataset.cur) return;
      if (!apply(v)) input.classList.add('is-bad');
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
    input.addEventListener('input', () => input.classList.remove('is-bad'));
    this.sync(() => {
      const v = get() || '';
      input.dataset.cur = v;
      if (document.activeElement !== input) input.value = v;
    });
    return input;
  }
  toggle(label, get, ok, onChange, desc = null) {
    const input = el('input', { type: 'checkbox', class: 'ws-switch__in', role: 'switch', 'aria-label': label, disabled: ok ? null : true });
    input.addEventListener('change', () => {
      if (onChange(input.checked) !== true) input.checked = !!get();
    });
    this.sync(() => (input.checked = !!get()));
    return el(
      'label',
      { class: 'ws-erow' + (ok ? '' : ' is-disabled') },
      el('span', { class: 'ws-erow__txt' }, el('b', { text: label }), desc ? el('small', { text: desc }) : null),
      el('span', { class: 'ws-switch' }, input, el('span', { class: 'ws-switch__track' }, el('span', { class: 'ws-switch__knob' }))),
    );
  }
  slider(label, get, min, max, step, ok, onChange, fmt = (v) => `×${+(+v).toFixed(2)}`) {
    const out = el('output', { class: 'ws-row__val' });
    const r = el('input', { type: 'range', class: 'ws-range', min, max, step, 'aria-label': label, disabled: ok ? null : true });
    const paint = () => {
      r.style.setProperty('--p', ((r.value - min) / (max - min)) * 100 + '%');
      out.textContent = fmt(+r.value);
    };
    r.addEventListener('input', paint);
    r.addEventListener('change', () => {
      const prev = +get();
      if (onChange(+r.value, prev) !== true) {
        r.value = prev;
        paint();
      }
    });
    this.sync(() => {
      r.value = +get();
      paint();
    });
    return el('div', { class: 'ws-erow ws-erow--stack' + (ok ? '' : ' is-disabled') }, el('span', { class: 'ws-erow__txt' }, el('b', { text: label })), el('span', { class: 'ws-row__ctl' }, r, out));
  }
  // Select whose options and value both come from the model.
  select(label, optionsFn, get, ok, onChange) {
    const s = el('select', { class: 'ws-select', 'aria-label': label, disabled: ok ? null : true });
    const fill = () => {
      const list = optionsFn();
      const key = list.map((o) => o.value + ':' + o.label).join('|');
      if (s.dataset.key !== key) {
        s.innerHTML = '';
        for (const o of list) s.append(el('option', { value: String(o.value), text: o.label }));
        s.dataset.key = key;
      }
      s.value = String(get() ?? 'null');
    };
    s.addEventListener('change', () => {
      if (onChange(s.value) !== true) fill();
    });
    this.sync(fill);
    return el('label', { class: 'ws-erow ws-erow--stack' + (ok ? '' : ' is-disabled') }, el('span', { class: 'ws-erow__txt' }, el('b', { text: label })), s);
  }

  // ---------------------------------------------------------------- entry
  build(r) {
    const kind = r.unit ? 'unit' : r.kind === 'kingdom' ? 'kingdom' : 'village';
    this.kind = kind;
    this.syncs = [];
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
    const okName = fn(civ, 'renameKingdom');
    const nameIn = this.textField(
      () => k.name,
      32,
      okName,
      (v) => {
        if (!v) return false;
        const prev = k.name;
        if (!safe(() => civ.renameKingdom(id, v), false)) return false;
        this.applied(`Renamed to ${v}`, () => civ.renameKingdom(id, prev));
        return true;
      },
      { 'aria-label': 'Kingdom name', class: 'ws-input ws-ename' },
    );
    box.append(this.section('Name', [nameIn, okName ? null : this.missing()]));

    // colours
    const okColor = fn(civ, 'setKingdomColor');
    const sw = el('div', { class: 'ws-swatches' });
    const setColor = (hex) => {
      const prev = k.color;
      if (hex === prev) return;
      if (!safe(() => civ.setKingdomColor(id, hex), false)) return;
      this.applied(`Colours changed${k.colorName ? ` to ${realmColourText(k.colorName, k.color)}` : ''}`, () => civ.setKingdomColor(id, prev));
    };
    const sugg = safe(() => civ.kingdomColorSuggestions?.(id), null) || [];
    // 13 + the picker = two rows of 7; on touch (44 px swatches) 11 + the picker = two rows of 6
    const nSw = this.ui.root?.classList.contains('is-touch') ? 11 : 13;
    for (const hex of [k.color, ...sugg.filter((h) => h !== k.color)].slice(0, nSw))
      sw.append(el('button', { class: 'ws-swatch', type: 'button', 'data-hex': hex, style: `--c:${hexCss(hex)}`, 'aria-label': hexCss(hex), disabled: okColor ? null : true, onclick: () => setColor(hex) }));
    const picker = el('input', { type: 'color', class: 'ws-colorpick', 'aria-label': 'Custom colour', disabled: okColor ? null : true });
    picker.addEventListener('change', () => setColor(parseInt(picker.value.slice(1), 16)));
    const custom = el('label', { class: 'ws-swatch ws-swatch--custom', 'data-tip': 'Pick any colour' }, picker, el('span', { html: uiIcon('plus') }));
    sw.append(custom);
    this.sync(() => {
      let hit = false;
      sw.querySelectorAll('.ws-swatch[data-hex]').forEach((b) => {
        const on = +b.dataset.hex === k.color;
        b.classList.toggle('is-on', on);
        hit ||= on;
      });
      // a custom colour lights the picker swatch, painted in that colour
      custom.classList.toggle('is-on', !hit);
      custom.style.setProperty('--c', hexCss(k.color));
      custom.classList.toggle('is-picked', !hit);
      picker.value = hexCss(k.color);
    });
    box.append(this.section('Colours', [sw, okColor ? null : this.missing()], { summary: () => realmColourText(k.colorName || '', k.color), keep: true }));

    // banner
    const okBanner = fn(civ, 'setKingdomBanner');
    const symbols = (Array.isArray(civ.BANNER_SYMBOLS) && civ.BANNER_SYMBOLS.length ? civ.BANNER_SYMBOLS : EMBLEM_IDS).map((s) => (typeof s === 'string' ? s : s.id));
    const fields = (Array.isArray(civ.BANNER_FIELDS) && civ.BANNER_FIELDS.length ? civ.BANNER_FIELDS : FIELD_IDS).map((s) => (typeof s === 'string' ? s : s.id));
    const preview = el('span', { class: 'ws-ebanner' }, el('img', { class: 'ws-ebanner__img', alt: '' }));
    const symGrid = el('div', { class: 'ws-egrid ws-egrid--sym' });
    const fieldGrid = el('div', { class: 'ws-egrid ws-egrid--field' });
    const setBanner = (patch) => {
      const prev = { ...(k.banner || {}) };
      const next = { symbol: prev.symbol ?? symbols[0], field: prev.field ?? fields[0], ...patch };
      if (!safe(() => civ.setKingdomBanner(id, next), false)) return;
      this.applied('Banner changed', () => civ.setKingdomBanner(id, prev));
    };
    for (const s of symbols)
      symGrid.append(el('button', { class: 'ws-ebtn', type: 'button', 'data-v': s, 'data-tip': prettyId(s), 'aria-label': prettyId(s), disabled: okBanner ? null : true, html: emblemFace(s), onclick: () => setBanner({ symbol: s }) }));
    for (const f of fields)
      fieldGrid.append(el('button', { class: 'ws-ebtn ws-ebtn--field', type: 'button', 'data-v': f, 'data-tip': prettyId(f), 'aria-label': prettyId(f), disabled: okBanner ? null : true, html: `<img alt="" data-f="${esc(f)}">`, onclick: () => setBanner({ field: f }) }));
    this.sync(() => {
      preview.firstChild.src = bannerURL(k.banner || null, k.color, 96);
      fieldGrid.querySelectorAll('img').forEach((im) => (im.src = bannerURL({ symbol: null, field: im.dataset.f }, k.color, 36)));
      symGrid.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.v === (k.banner?.symbol ?? '')));
      fieldGrid.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.v === (k.banner?.field ?? '')));
    });
    box.append(
      this.section('Banner', [el('div', { class: 'ws-ebannerrow' }, preview, el('div', { class: 'ws-ebannerpick' }, symGrid, fieldGrid)), okBanner ? null : this.missing()], {
        summary: () => ({ html: `<img class="ws-esec__flag" alt="" src="${bannerURL(k.banner || null, k.color, 36)}"><span>${esc(k.banner ? `${prettyId(k.banner.symbol)} · ${prettyId(k.banner.field)}` : '')}</span>` }),
      }),
    );

    // motto
    const okMotto = fn(civ, 'setKingdomMotto');
    const motto = this.textField(
      () => k.motto,
      48,
      okMotto,
      (v) => {
        const prev = k.motto || '';
        if (!safe(() => civ.setKingdomMotto(id, v), false)) return false;
        this.applied(v ? 'Motto proclaimed' : 'Motto removed', () => civ.setKingdomMotto(id, prev));
        return true;
      },
      { placeholder: 'A motto for the realm…', 'aria-label': 'Motto' },
    );
    box.append(this.section('Motto', [motto, okMotto ? null : this.missing()], { summary: () => (k.motto ? `“${k.motto}”` : 'None') }));

    // diplomacy
    const okRel = fn(civ, 'setRelation');
    const dip = el('div', { class: 'ws-edip' });
    const relOf = (o) => (safe(() => civ.atWar?.(id, o.id), false) ? 'war' : safe(() => civ.allied?.(id, o.id), false) ? 'alliance' : 'peace');
    const others = (civ.kingdoms || []).filter((o) => o && o.alive !== false && o.id !== id);
    for (const o of others) {
      const row = el('div', { class: 'ws-edip__row', style: `--k:${hexCss(o.color)}` }, el('span', { class: 'ws-edip__name' }, el('i'), el('span', { text: o.name })));
      const seg = el('div', { class: 'ws-pills ws-pills--dip', role: 'radiogroup', 'aria-label': `Relation with ${o.name}` });
      for (const [v, label] of [
        ['war', 'War'],
        ['peace', 'Peace'],
        ['alliance', 'Alliance'],
      ])
        seg.append(
          el('button', {
            class: `ws-pill is-${v}`,
            type: 'button',
            role: 'radio',
            'data-v': v,
            text: label,
            disabled: okRel ? null : true,
            onclick: () => {
              const prev = relOf(o);
              if (prev === v || o.alive === false) return;
              if (!safe(() => civ.setRelation(id, o.id, v), false)) return;
              this.applied(`${label} with ${o.name}`, () => civ.setRelation(id, o.id, prev));
            },
          }),
        );
      this.sync(() => {
        const rel = relOf(o);
        row.classList.toggle('is-gone', o.alive === false);
        seg.querySelectorAll('button').forEach((b) => {
          b.classList.toggle('is-on', b.dataset.v === rel);
          b.setAttribute('aria-checked', b.dataset.v === rel ? 'true' : 'false');
        });
      });
      row.append(seg);
      dip.append(row);
    }
    if (!others.length) dip.append(this.missing('No other realms stand yet.'));
    box.append(
      this.section('Diplomacy', [dip, okRel ? null : this.missing()], {
        summary: () => {
          const live = others.filter((o) => o.alive !== false);
          const wars = live.filter((o) => relOf(o) === 'war').length;
          const allies = live.filter((o) => relOf(o) === 'alliance').length;
          return [wars ? `${wars} at war` : 'At peace', allies ? `${allies} allied` : ''].filter(Boolean).join(' · ');
        },
      }),
    );

    // policies
    const okPol = fn(civ, 'setKingdomPolicy');
    const pol = () => safe(() => civ.kingdomPolicies?.(id), null) || {};
    const setPol = (key, v, prev, label) => {
      // Undo restores the realm's own setting, or "follow the world law" (null) when it had none
      const raw = k.policy && key in k.policy ? k.policy[key] : null;
      if (!safe(() => civ.setKingdomPolicy(id, key, v), false)) return false;
      this.applied(label, () => civ.setKingdomPolicy(id, key, raw));
      return true;
    };
    box.append(
      this.section(
        'Policies',
        [
          this.toggle('Settlers', () => pol().expansion ?? true, okPol, (v) => setPol('expansion', v, !v, v ? 'Settlers may set out' : 'Settlers stay home'), 'Villages found new villages'),
          this.slider('War fever', () => pol().warlike ?? 1, 0, 3, 0.25, okPol, (v, prev) => setPol('warlike', v, prev, `War fever ×${v}`)),
          this.toggle('Rebellions', () => pol().rebellions ?? true, okPol, (v) => setPol('rebellions', v, !v, v ? 'Rebellions possible' : 'No rebellions')),
          this.toggle('Research', () => pol().technology ?? true, okPol, (v) => setPol('technology', v, !v, v ? 'Research resumes' : 'Research halted')),
          this.slider('Growth', () => pol().growth ?? 1, 0.25, 3, 0.25, okPol, (v, prev) => setPol('growth', v, prev, `Growth ×${v}`)),
          this.toggle('Lock diplomacy', () => pol().lockDiplomacy ?? false, okPol, (v) => setPol('lockDiplomacy', v, !v, v ? 'Relations locked' : 'Relations free'), 'Kings may not undo your decrees'),
          okPol ? null : this.missing(),
        ],
        { summary: () => (k.policy && Object.keys(k.policy).length ? `${Object.keys(k.policy).length} set by you` : 'Following world laws') },
      ),
    );
  }

  // ---------------------------------------------------------------- village
  village(box, v) {
    const g = this.game;
    const civ = g.civ || {};
    if (!v) return box.append(this.missing('No village here.'));
    const id = v.id;
    const okName = fn(civ, 'renameVillage');
    const nameIn = this.textField(
      () => v.name,
      32,
      okName,
      (name) => {
        if (!name) return false;
        const prev = v.name;
        if (!safe(() => civ.renameVillage(id, name), false)) return false;
        this.applied(`Renamed to ${name}`, () => civ.renameVillage(id, prev));
        return true;
      },
      { 'aria-label': 'Village name', class: 'ws-input ws-ename' },
    );
    box.append(this.section(this.insp.track?.building ? 'Village name' : 'Name', [nameIn, okName ? null : this.missing()]));

    const okT = fn(civ, 'transferVillage');
    const realmOpts = () => {
      const own = civ.kingdoms?.[v.kingdom];
      const alone = !!own && own.alive !== false && (own.villages?.length ?? 0) <= 1;
      return [...(civ.kingdoms || []).filter((k) => k && k.alive !== false).map((k) => ({ value: k.id, label: k.name })), ...(alone ? [] : [{ value: 'null', label: 'A new free realm' }])];
    };
    const allegiance = this.select('Belongs to', realmOpts, () => v.kingdom, okT, (val) => {
      const prev = v.kingdom;
      const to = val === 'null' ? null : +val;
      if (to === prev) return true;
      if (!safe(() => civ.transferVillage(id, to), false)) return false;
      this.applied(to == null ? `${v.name} is freed: ${civ.kingdomName?.(v.kingdom) || 'a new realm'}` : `${v.name} joins ${civ.kingdomName?.(to) || 'the realm'}`, () => {
        // the old realm may have fallen with its last village: then it rises again as a free realm
        if (!safe(() => civ.transferVillage(id, prev), false, 'undo transfer') && civ.kingdoms?.[prev]?.alive === false) safe(() => civ.transferVillage(id, null), false, 'undo transfer');
      });
      return true;
    });
    box.append(this.section('Allegiance', [allegiance, okT ? null : this.missing()]));

    const okP = fn(civ, 'setVillagePolicy');
    const pol = () => safe(() => civ.villagePolicies?.(id), null) || {};
    const setPol = (key, val, prev, label) => {
      const raw = v.policy && key in v.policy ? v.policy[key] : null;
      if (!safe(() => civ.setVillagePolicy(id, key, val), false)) return false;
      this.applied(label, () => civ.setVillagePolicy(id, key, raw));
      return true;
    };
    box.append(
      this.section('Policies', [
        this.toggle('Walls', () => pol().walls ?? true, okP, (val) => setPol('walls', val, !val, val ? 'Walls may be raised' : 'No walls')),
        this.slider('Growth', () => pol().growth ?? 1, 0.25, 3, 0.25, okP, (val, prev) => setPol('growth', val, prev, `Growth ×${val}`)),
        this.toggle('New buildings', () => pol().buildings ?? true, okP, (val) => setPol('buildings', val, !val, val ? 'Building allowed' : 'Building halted')),
        this.capitalRow(v, okP),
        okP ? null : this.missing(),
      ]),
    );
  }
  // "Make capital": a one-way decree (the old seat comes back with Undo)
  capitalRow(v, ok) {
    const civ = this.game.civ || {};
    const btn = el('button', { class: 'ws-btn ws-btn--sm', type: 'button' });
    btn.addEventListener('click', () => {
      const prev = civ.kingdoms?.[v.kingdom]?.capital;
      if (!safe(() => civ.setVillagePolicy(v.id, 'capital', true), false)) return;
      this.applied(`${v.name} becomes the capital`, () => {
        if (prev != null && prev !== v.id) safe(() => civ.setVillagePolicy(prev, 'capital', true), false, 'undo capital');
      });
    });
    this.sync(() => {
      const isCap = civ.kingdoms?.[v.kingdom]?.capital === v.id;
      btn.textContent = isCap ? 'The capital' : 'Make capital';
      btn.disabled = !ok || isCap || v.kingdom == null;
    });
    return el('div', { class: 'ws-erow' + (ok ? '' : ' is-disabled') }, el('span', { class: 'ws-erow__txt' }, el('b', { text: 'Capital' }), el('small', { text: 'Seat of its kingdom' })), btn);
  }

  // ---------------------------------------------------------------- creature
  unit(box, u) {
    const g = this.game;
    const U = g.units || {};
    if (!u) return box.append(this.missing('Nothing to edit.'));
    const okName = fn(U, 'rename');
    const nameIn = this.textField(
      () => u.name,
      24,
      okName,
      (name) => {
        if (!name) return false;
        const prev = u.name || '';
        if (!safe(() => U.rename(u, name), false)) return false;
        this.applied(`Renamed to ${name}`, () => prev && U.rename(u, prev));
        return true;
      },
      { 'aria-label': 'Name', class: 'ws-input ws-ename' },
    );
    box.append(this.section('Name', [nameIn, okName ? null : this.missing()]));

    // blessings (flags)
    const okF = fn(U, 'setUnitFlag');
    const kRealm = g.civ?.kingdoms?.[u.kingdom];
    const isRuler = u.job === 'king' || (kRealm && (kRealm.ruler === u.id || kRealm.ruler === u));
    const flag = (key) => !!(u.flags?.[key] ?? u.data?.flags?.[key]);
    const setF = (key, val, label) => {
      if (!safe(() => U.setUnitFlag(u, key, val), false)) return false;
      this.applied(label, () => U.setUnitFlag(u, key, !val));
      return true;
    };
    box.append(
      this.section(
        'Blessings',
        [
          this.toggle('Immortal', () => flag('immortal'), okF, (v) => setF('immortal', v, v ? 'Made immortal' : 'Mortal again'), isRuler ? 'No death from age, hunger or wounds. Immortal rulers step down after 60 years on the throne.' : 'No death from age, hunger or wounds'),
          this.toggle('Pacifist', () => flag('pacifist'), okF, (v) => setF('pacifist', v, v ? 'Swears off violence' : 'Will fight again'), 'Never starts a fight'),
          this.toggle('Ageless', () => flag('frozenAge'), okF, (v) => setF('frozenAge', v, v ? 'Age frozen' : 'Ageing resumes'), 'Stops growing older'),
          okF ? null : this.missing(),
        ],
        { summary: () => ['immortal', 'pacifist', 'frozenAge'].filter(flag).map((f) => ({ immortal: 'Immortal', pacifist: 'Pacifist', frozenAge: 'Ageless' })[f]).join(' · ') || 'None' },
      ),
    );

    // traits: filtered in place (owned first), no nested scroller
    const T = REG.traits?.TRAITS || U.TRAITS || [];
    const okT = fn(U, 'addTrait') && fn(U, 'removeTrait');
    const cats = [...new Set(T.map((t) => t.category))];
    let cat = 'all',
      q = '';
    const list = el('div', { class: 'ws-etraits' });
    const has = (id) => (u.traits || []).includes(id);
    const toggleTrait = (t) => {
      const was = has(t.id);
      const before = [...(u.traits || [])];
      // a god's gift ignores the Traits law; opposites replace each other
      const ok = was ? safe(() => U.removeTrait(u, t.id), false) : safe(() => U.addTrait(u, t.id, { force: true }), false);
      if (!ok) return;
      this.applied(was ? `Lost the trait ${t.name}` : `Gained the trait ${t.name}`, () => {
        const now = [...(u.traits || [])];
        for (const id of now) if (!before.includes(id)) U.removeTrait(u, id);
        for (const id of before) if (!now.includes(id)) U.addTrait(u, id, { force: true, silent: true });
      });
    };
    const drawTraits = () => {
      list.innerHTML = '';
      const shown = T.filter((t) => (cat === 'all' || t.category === cat) && (!q || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q)));
      shown.sort((a, b) => has(b.id) - has(a.id));
      for (const t of shown) {
        const on = has(t.id);
        list.append(
          el(
            'button',
            { class: `ws-etrait is-${t.category}${on ? ' is-on' : ''}`, type: 'button', 'aria-pressed': on ? 'true' : 'false', disabled: okT ? null : true, onclick: () => toggleTrait(t) },
            el('span', { class: 'ws-etrait__mark', html: uiIcon(on ? 'check' : 'plus') }),
            el('span', { class: 'ws-etrait__txt' }, el('b', { text: t.name }), el('small', { text: t.description || '' })),
          ),
        );
      }
      if (!shown.length) list.append(this.missing('No traits match.'));
    };
    const search = el('input', { class: 'ws-input', type: 'search', placeholder: 'Search traits…', 'aria-label': 'Search traits', spellcheck: 'false', enterkeyhint: 'search' });
    search.addEventListener('input', () => {
      q = search.value.trim().toLowerCase();
      drawTraits();
    });
    const pills = el('div', { class: 'ws-pills ws-pills--cats', role: 'tablist' });
    for (const c of ['all', ...cats])
      pills.append(
        el('button', {
          class: 'ws-pill' + (c === cat ? ' is-on' : ''),
          type: 'button',
          role: 'tab',
          text: c === 'all' ? 'All' : prettyId(c),
          onclick: (e) => {
            cat = c;
            pills.querySelectorAll('.ws-pill').forEach((b) => b.classList.toggle('is-on', b === e.currentTarget));
            drawTraits();
          },
        }),
      );
    this.sync(drawTraits);
    const traitName = (id) => T.find((t) => t.id === id)?.name || prettyId(id);
    box.append(
      this.section('Traits', [search, pills, list, okT && T.length ? null : this.missing(T.length ? undefined : 'Traits are not known in this world yet.')], {
        summary: () => (u.traits?.length ? u.traits.map(traitName).join(', ') : 'None'),
      }),
    );

    // item giver, with a preview of what will be bestowed
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
    const prevBox = el('div', { class: 'ws-egive__preview', 'aria-live': 'polite' });
    const spec = () => ({ slot: st.slot, material: st.material, quality: st.quality, ...(st.kind ? { kind: st.kind } : {}) });
    let given = null; // the item just bestowed (the preview then shows it worn)
    const drawPreview = () => {
      const cur0 = u.equipment?.[st.slot] || null;
      const sameSpec = given && cur0 === given && given.slot === st.slot && given.material === st.material && given.quality === st.quality && (!st.kind || given.kind === st.kind);
      if (sameSpec) {
        prevBox.innerHTML = `<span class="ws-egive__ico">${uiIcon({ weapon: 'sword', armor: 'shield', tool: 'job-builder', trinket: 'sparkle' }[st.slot] || 'sparkle')}</span><span class="ws-egive__txt"><b>${esc(given.name)}</b><small>Now worn · Power ${given.power}</small></span>`;
        prevBox.classList.add('is-worn');
        return;
      }
      prevBox.classList.remove('is-worn');
      const mk = REG.items?.makeItem;
      const it = mk ? safe(() => mk({ ...spec(), name: '…' }, () => 0.5), null) : null;
      const cur = u.equipment?.[st.slot] || null;
      const name = !it ? `${prettyId(st.quality)} ${prettyId(st.material)} ${prettyId(st.kind || st.slot)}` : it.legendary ? `A legendary ${prettyId(it.kind)}` : it.name;
      const delta = it && cur ? Math.round((it.power - (cur.power || 0)) * 10) / 10 : null;
      prevBox.innerHTML = `<span class="ws-egive__ico">${uiIcon({ weapon: 'sword', armor: 'shield', tool: 'job-builder', trinket: 'sparkle' }[st.slot] || 'sparkle')}</span><span class="ws-egive__txt"><b>${esc(name)}</b><small>${it ? `Power ${it.power}` : ''}${delta != null ? ` <em class="${delta >= 0 ? 'is-up' : 'is-down'}">${delta >= 0 ? '+' : ''}${delta} vs ${esc(cur.name)}</em>` : cur ? '' : ' · empty slot'}${it?.legendary ? ' · named when bestowed' : ''}</small></span>`;
    };
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
        drawPreview();
      });
      s.fill = fill;
      return s;
    };
    const slotSel = sel('Slot', slots, 'slot');
    const kindSel = sel('Kind', kindsFor(st.slot), 'kind');
    const matSel = sel('Material', mats, 'material');
    const qualSel = sel('Quality', quals, 'quality');
    this.sync(drawPreview);
    const give = el(
      'button',
      {
        class: 'ws-btn ws-btn--sm ws-egive__go',
        type: 'button',
        disabled: okI ? null : true,
        onclick: () => {
          const slot = st.slot;
          const prev = u.equipment?.[slot] || null;
          if (!safe(() => U.giveItem(u, spec()), false)) return;
          const it = u.equipment?.[slot];
          given = it || null;
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
        [
          el('div', { class: 'ws-egive' }, el('label', null, el('small', { text: 'Slot' }), slotSel), el('label', null, el('small', { text: 'Kind' }), kindSel), el('label', null, el('small', { text: 'Material' }), matSel), el('label', null, el('small', { text: 'Quality' }), qualSel)),
          el('div', { class: 'ws-egive__row' }, prevBox, give),
          okI ? null : this.missing(),
        ],
        // what is worn now stays visible while choosing a gift
        { summary: () => Object.values(u.equipment || {}).filter(Boolean).map((i) => i.name).join(' · ') || 'Nothing worn', keep: true },
      ),
    );

    // kingdom move (people only)
    if (u.def?.kind === 'humanoid') {
      const civ = g.civ || {};
      const okK = fn(U, 'setKingdom');
      const opts = () => {
        const o = (civ.kingdoms || []).filter((k) => k && k.alive !== false).map((k) => ({ value: k.id, label: k.name }));
        if (u.kingdom == null || u.kingdom < 0) o.unshift({ value: -1, label: 'No kingdom' });
        return o;
      };
      box.append(
        this.section(
          'Allegiance',
          [
            this.select('Swears fealty to', opts, () => u.kingdom ?? -1, okK, (val) => {
              const prev = u.kingdom;
              const to = +val;
              if (to === prev) return true;
              if (!safe(() => U.setKingdom(u, to), false)) return false;
              this.applied(`Now serves ${civ.kingdomName?.(to) || 'the realm'}`, () => prev != null && prev >= 0 && U.setKingdom(u, prev));
              return true;
            }),
            okK ? null : this.missing(),
          ],
          { summary: () => (u.kingdom >= 0 ? civ.kingdomName?.(u.kingdom) || '' : 'No kingdom') },
        ),
      );
    }
  }
}
