import { AGES } from '../core/ages.js';
import { YEAR } from '../core/time.js';
import { el, esc, hexCss, safe } from './dom.js';
import { uiIcon } from './icons.js';
import { modLines } from './depth.js';

const AGE_GLYPH = { dawn: 'sun', bounty: 'bountiful-harvest', embers: 'fire', rime: 'weather-snow', tempests: 'weather-storm', lore: 'chronicle', blight: 'plague', twilight: 'night', iron: 'sword' };
export const ageGlyph = (id) => AGE_GLYPH[id] || 'eclipse';

// Top-bar chip: age colour, title and a progress ring. Opens the Ages panel.
export class AgeChip {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    this.el = el('button', { class: 'ws-agechip', type: 'button', 'aria-label': 'World age', onclick: () => ui.modals.toggle('ages') });
    this.el.innerHTML = `<svg class="ws-agechip__ring" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" class="bg"/><circle cx="12" cy="12" r="9.5" class="fg" pathLength="100" stroke-dasharray="0 100"/></svg><span class="ws-agechip__ico"></span><span class="ws-agechip__txt"><small>Age of</small><b></b></span>`;
    this.fg = this.el.querySelector('.fg');
    this.ico = this.el.querySelector('.ws-agechip__ico');
    this.title = this.el.querySelector('b');
    this._t = 0;
    this._id = null;
    this.game.events.on('age', () => this.sync(true));
    this.sync(true);
  }
  sync(full = false) {
    const a = this.game.age;
    if (!a) return;
    if (full || a.id !== this._id) {
      this._id = a.id;
      this.el.style.setProperty('--age', hexCss(a.color));
      this.title.textContent = a.title || a.name;
      this.ico.innerHTML = uiIcon(ageGlyph(a.id));
    }
    const p = Math.max(0, Math.min(1, a.progress || 0));
    this.fg.setAttribute('stroke-dasharray', `${(p * 100).toFixed(1)} 100`);
    const left = Math.max(0, Math.round(((1 - p) * (a.duration || 0)) / YEAR));
    this.el.dataset.tip = `${a.name} — ${this.game.laws?.ageCycle === false ? 'lasts until you call another' : `about ${left} years remain`}`;
  }
  update(dt) {
    this._t -= dt;
    if (this._t <= 0) {
      this._t = 1;
      this.sync();
    }
  }
}

// Full-width banner when an age turns.
export class AgeBanner {
  constructor(ui) {
    this.ui = ui;
    this.el = el('div', { class: 'ws-agebanner', 'aria-live': 'polite' });
    ui.layer.append(this.el);
    ui.game.events.on('age', ({ age } = {}) => age && this.show(age));
  }
  show(age) {
    const c = hexCss(age.color);
    this.el.style.setProperty('--age', c);
    this.el.innerHTML = `
      <div class="ws-agebanner__band">
        <span class="ws-agebanner__ico">${uiIcon(ageGlyph(age.id))}</span>
        <div class="ws-agebanner__kicker">A new age dawns</div>
        <div class="ws-agebanner__title">${esc(age.name)}</div>
        <div class="ws-agebanner__rule"><i></i><b></b><i></i></div>
        <div class="ws-agebanner__desc">${esc(age.description || '')}</div>
      </div>`;
    this.el.classList.remove('is-shown');
    void this.el.offsetWidth;
    this.el.classList.add('is-shown');
    clearTimeout(this._t);
    this._t = setTimeout(() => this.el.classList.remove('is-shown'), 5200);
    this.ui.game.audio?.play?.('magic', { volume: 0.5 });
  }
}

// Ages panel body (used by the modal manager).
export function agesPanel(ui) {
  const g = ui.game;
  const list = el('div', { class: 'ws-ages' });
  const draw = () => {
    list.innerHTML = '';
    const cur = g.age?.id;
    for (const def of AGES) {
      const lines = modLines(def.mods);
      const on = def.id === cur;
      const card = el(
        'div',
        { class: 'ws-agecard' + (on ? ' is-current' : ''), style: `--age:${hexCss(def.color)}` },
        el('span', { class: 'ws-agecard__medal', html: uiIcon(ageGlyph(def.id)) }),
        el(
          'div',
          { class: 'ws-agecard__body' },
          el('div', { class: 'ws-agecard__name' }, def.name, on ? el('em', { text: 'Now' }) : null),
          el('p', { class: 'ws-agecard__desc', text: def.description }),
          el(
            'div',
            { class: 'ws-agecard__mods' },
            ...(lines.length ? lines : [{ text: 'No changes to the world’s rules', good: null }]).map((l) => el('span', { class: 'ws-mod' + (l.good === true ? ' is-good' : l.good === false ? ' is-bad' : ''), text: l.text })),
          ),
          on ? el('div', { class: 'ws-agecard__bar' }, el('i', { style: `width:${((g.age.progress || 0) * 100).toFixed(1)}%` })) : null,
        ),
        el('button', {
          class: 'ws-btn ws-btn--sm' + (on ? ' ws-btn--ghost' : ''),
          type: 'button',
          disabled: on ? true : null,
          text: on ? 'Current' : 'Call forth',
          onclick: () => {
            safe(() => g.setAge?.(def.id), null, 'setAge');
            draw();
          },
        }),
      );
      list.append(card);
    }
  };
  draw();
  const body = el(
    'div',
    { class: 'ws-agesbox' },
    el('p', { class: 'ws-laws__intro', text: 'Great eras sweep over the world and bend its rules. Ages turn by themselves, or you may call one forth.' }),
    list,
  );
  return { title: 'World Ages', icon: 'eclipse', body, wide: true };
}
