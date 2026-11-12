import { el } from './dom.js';

// One shared description popover in the floating layer.
//  * mouse: hovering a [data-tip] inside a scrolling panel (inspector, tech,
//    side panels, dialogs) shows it here, so it is never clipped;
//  * touch: tapping an informational [data-tip] (chips, slots, cards) toggles
//    it; long-pressing a button shows its tip without triggering the button.
const SCROLLERS = '.ws-insp, .ws-tech, .ws-side, .ws-modal, .ws-chron__list';
const INTERACTIVE = 'button, [role=button], input, select, label, a';

export class Popover {
  constructor(ui) {
    this.ui = ui;
    this.el = el('div', { class: 'ws-pop', role: 'tooltip' });
    // mounted on the UI root above the dialogs (the floating layer is its own
    // stacking context at z 40, so tips inside World Laws, tech and settings were hidden)
    (ui.root || ui.layer).append(this.el);
    this.target = null;
    const root = ui.root;
    root.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch') return;
      const t = e.target.closest?.('[data-tip]');
      if (!t || !t.closest(SCROLLERS)) return;
      clearTimeout(this._hov);
      this._hov = setTimeout(() => this.show(t), 220);
    });
    root.addEventListener('pointerout', (e) => {
      if (e.pointerType === 'touch') return;
      const t = e.target.closest?.('[data-tip]');
      if (t && t.contains(e.relatedTarget)) return;
      clearTimeout(this._hov);
      if (t === this.target) this.hide();
    });
    // Long-press on a control explains it. Robust under load: the hold is
    // measured from the events' own timestamps (a late timer still counts),
    // a drag of more than 10 px cancels it, and the click that follows is
    // swallowed only briefly.
    const LONG = 450,
      SLOP = 10;
    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      const t = e.target.closest?.('[data-tip]');
      clearTimeout(this._lp);
      this._swallow = false;
      this._lpShown = false;
      this._press = null;
      if (!t || !t.dataset.tip) return this.hide();
      if (t.closest(INTERACTIVE)) {
        this._press = { t: e.timeStamp, x: e.clientX, y: e.clientY, el: t, id: e.pointerId };
        this._lp = setTimeout(() => {
          if (!this._press || this._press.el !== t) return;
          this._lpShown = true;
          this._swallow = true;
          this.show(t, 2600);
        }, LONG);
      } else this._tap = t;
    });
    root.addEventListener('pointermove', (e) => {
      const pr = this._press;
      if (!pr || e.pointerId !== pr.id) return;
      if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) > SLOP) {
        clearTimeout(this._lp);
        this._press = null;
        this._tap = null;
      }
    });
    // the browser's own long-press gesture can cancel the pointer (and send
    // contextmenu) before a late timer runs: that also counts as the hold
    const held = (pr, e) => pr && !this._lpShown && pr.el.isConnected && e.timeStamp - pr.t >= LONG - 60;
    const longPress = (pr) => {
      clearTimeout(this._lp);
      this._lpShown = true;
      this._swallow = true;
      clearTimeout(this._swT);
      this._swT = setTimeout(() => (this._swallow = false), 1200);
      this.show(pr.el, 2600);
    };
    const cancel = (e) => {
      const pr = this._press;
      clearTimeout(this._lp);
      if (e && held(pr, e)) longPress(pr);
      this._press = null;
    };
    root.addEventListener('pointerup', (e) => {
      const pr = this._press;
      clearTimeout(this._lp);
      this._press = null;
      if (e.pointerType === 'touch' && pr && !this._lpShown && pr.el.isConnected && e.timeStamp - pr.t >= LONG && Math.hypot(e.clientX - pr.x, e.clientY - pr.y) <= SLOP) {
        // the timer was late (a busy frame): the hold still counts
        this._swallow = true;
        this.show(pr.el, 2600);
      }
      this._lpShown = false;
      if (this._swallow) {
        clearTimeout(this._swT);
        this._swT = setTimeout(() => (this._swallow = false), 700);
      }
      if (e.pointerType !== 'touch' || !this._tap) return;
      let t = this._tap;
      this._tap = null;
      // the panel may have re-rendered under the finger: find the element again
      if (!t.isConnected) t = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-tip]');
      if (!t) return;
      if (this.target === t && this.el.classList.contains('is-shown')) this.hide();
      else this.show(t, 3200);
    });
    // no system callout or context menu on a long-pressed control
    root.addEventListener('contextmenu', (e) => {
      const t = e.target.closest?.('[data-tip]');
      if (!t || !t.closest(INTERACTIVE)) return;
      e.preventDefault();
      const pr = this._press;
      if (pr && pr.el === t && !this._lpShown) longPress(pr);
    });
    root.addEventListener('pointercancel', cancel);
    root.addEventListener(
      'click',
      (e) => {
        if (!this._swallow) return;
        this._swallow = false;
        e.preventDefault();
        e.stopPropagation();
      },
      true,
    );
    // only a scroll that moves the target hides it (not unrelated panels)
    addEventListener(
      'scroll',
      (e) => {
        const t = this.target;
        if (t && (e.target === document || e.target === window || e.target?.contains?.(t))) this.hide();
      },
      true,
    );
  }

  show(t, ms = 0) {
    const text = t?.dataset?.tip;
    if (!text || !t.isConnected) return;
    const rr = t.getBoundingClientRect();
    if (!rr.width && !rr.height) return; // never pin to a detached or hidden element
    this.target = t;
    this.el.textContent = text;
    this.el.classList.add('is-shown');
    const r = t.getBoundingClientRect();
    const vw = innerWidth;
    const w = Math.min(280, vw - 16);
    this.el.style.maxWidth = w + 'px';
    const pw = this.el.offsetWidth,
      ph = this.el.offsetHeight;
    let x = r.left + r.width / 2 - pw / 2;
    x = Math.max(8, Math.min(vw - pw - 8, x));
    let y = r.top - ph - 8;
    if (y < 8) y = r.bottom + 8;
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    clearTimeout(this._hide);
    if (ms) this._hide = setTimeout(() => this.hide(), ms);
    // watchdog: a tip never outlives its target (dialog closed, panel re-rendered, hidden)
    clearInterval(this._watch);
    this._watch = setInterval(() => {
      const tg = this.target;
      if (!tg) return this.hide();
      const b = tg.isConnected ? tg.getBoundingClientRect() : null;
      if (!b || (!b.width && !b.height) || tg.closest('[hidden], [inert]')) this.hide();
    }, 250);
  }
  hide() {
    clearTimeout(this._hide);
    clearTimeout(this._hov);
    clearInterval(this._watch);
    this.el.classList.remove('is-shown');
    this.target = null;
  }
}
