import { CATEGORIES, listPowers } from '../powers/registry.js';

// BASELINE implementation (to be replaced by the UI owner).
// Bottom toolbar (categories + powers), speed controls, brush size, inspector,
// notification feed. Hidden entirely with ?ui=0.
export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui-root');
    if (!game.params.ui) {
      this.root.style.display = 'none';
      return;
    }
    this.cat = CATEGORIES[0].id;
    this.root.innerHTML = `
      <div class="ui-top">
        <div class="ui-brand">Worldseed</div>
        <div class="ui-speed"></div>
        <div class="ui-stats"></div>
      </div>
      <div class="ui-inspector hidden"></div>
      <div class="ui-feed"></div>
      <div class="ui-bottom">
        <div class="ui-cats"></div>
        <div class="ui-powers"></div>
        <div class="ui-brush">Brush <input type="range" min="1" max="24" value="4" /><span></span></div>
      </div>`;
    this.$ = (s) => this.root.querySelector(s);
    this.buildCats();
    this.buildPowers();
    this.buildSpeed();
    const slider = this.$('.ui-brush input');
    slider.addEventListener('input', () => game.setBrushSize(+slider.value));
    game.events.on('brush', ({ size }) => {
      slider.value = size;
      this.$('.ui-brush span').textContent = size;
    });
    game.events.on('power:select', () => this.buildPowers());
    game.events.on('inspect', (hit) => this.showInspector(hit));
    game.events.on('notify', (n) => this.pushFeed(n));
    game.events.on('speed', () => this.buildSpeed());
    this._statT = 0;
  }
  buildCats() {
    const el = this.$('.ui-cats');
    el.innerHTML = '';
    for (const c of CATEGORIES) {
      const b = document.createElement('button');
      b.textContent = c.name;
      b.className = c.id === this.cat ? 'active' : '';
      b.onclick = () => {
        this.cat = c.id;
        this.buildCats();
        this.buildPowers();
      };
      el.appendChild(b);
    }
  }
  buildPowers() {
    const el = this.$('.ui-powers');
    el.innerHTML = '';
    for (const p of listPowers(this.cat)) {
      const b = document.createElement('button');
      b.textContent = p.name;
      b.title = p.description;
      b.className = this.game.activePower === p ? 'active' : '';
      b.onclick = () => this.game.selectPower(this.game.activePower === p ? null : p);
      el.appendChild(b);
    }
  }
  buildSpeed() {
    const el = this.$('.ui-speed');
    el.innerHTML = '';
    const g = this.game;
    const mk = (label, active, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = active ? 'active' : '';
      b.onclick = fn;
      el.appendChild(b);
    };
    mk('❚❚', g.paused, () => g.setPaused(!g.paused));
    for (const s of [1, 2, 4, 8, 16]) mk(s + 'x', !g.paused && g.speed === s, () => g.setSpeed(s));
  }
  showInspector(hit) {
    const el = this.$('.ui-inspector');
    const info = this.game.inspect(hit);
    if (!info.length) {
      el.classList.add('hidden');
      return;
    }
    const top = info[0];
    el.classList.remove('hidden');
    el.innerHTML = `<h3>${top.title}</h3>${top.subtitle ? `<div class="sub">${top.subtitle}</div>` : ''}<table>${(top.stats || []).map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>`;
  }
  pushFeed(n) {
    const el = this.$('.ui-feed');
    const d = document.createElement('div');
    d.className = 'feed-item ' + (n.kind || 'info');
    d.textContent = n.text;
    el.prepend(d);
    while (el.children.length > 6) el.lastChild.remove();
    setTimeout(() => d.classList.add('fade'), 6000);
    setTimeout(() => d.remove(), 7000);
  }
  update(dt) {
    if (!this.game.params.ui) return;
    this._statT -= dt;
    if (this._statT <= 0) {
      this._statT = 0.5;
      const s = this.game.stats();
      const t = this.game.time;
      this.$('.ui-stats').textContent = `Year ${Math.floor(t.year)} · ${String(Math.floor(t.hour)).padStart(2, '0')}:00 · Pop ${s.population ?? 0} · Animals ${s.animals ?? 0}`;
    }
  }
}
