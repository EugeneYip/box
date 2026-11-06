// Pointer / keyboard routing.
//   Left button: apply the selected god power (or pan / select when none).
//   Right drag or middle drag: pan.  Alt+drag or Ctrl+right drag: rotate.
//   Wheel / pinch: zoom toward the cursor.  Q/E rotate, WASD/arrows pan.
//   Space: pause.  1-5: speed.  [ ]: brush size.  Esc: deselect power.
export class Input {
  constructor(game) {
    this.game = game;
    this.el = game.pipeline.renderer.domElement;
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2, inside: false };
    this.hover = null; // latest pick result under the cursor
    this.buttons = 0;
    this.drag = null;
    this.pointers = new Map();
    this.pinch = null;
    this._applyTimer = 0;
    this._pressed = false;
    this.el.style.touchAction = 'none';
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.el.addEventListener('pointerdown', (e) => this.onDown(e));
    addEventListener('pointermove', (e) => this.onMove(e));
    addEventListener('pointerup', (e) => this.onUp(e));
    addEventListener('pointercancel', (e) => this.onUp(e));
    this.el.addEventListener('pointerenter', () => (this.mouse.inside = true));
    this.el.addEventListener('pointerleave', () => (this.mouse.inside = false));
    this.el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    addEventListener('keydown', (e) => this.onKey(e, true));
    addEventListener('keyup', (e) => this.onKey(e, false));
    addEventListener('blur', () => game.cameraRig.keys.clear());
  }

  isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }

  onKey(e, down) {
    if (this.isTyping(e)) return;
    const g = this.game;
    if (down) g.cameraRig.keys.add(e.code);
    else g.cameraRig.keys.delete(e.code);
    if (!down) return;
    if (e.code === 'Space') {
      g.setPaused(!g.paused);
      e.preventDefault();
    } else if (e.code === 'Escape') {
      g.selectPower(null);
    } else if (e.code === 'BracketLeft') {
      g.setBrushSize(g.brushSize - 1);
    } else if (e.code === 'BracketRight') {
      g.setBrushSize(g.brushSize + 1);
    } else if (/^Digit[1-5]$/.test(e.code) && !e.ctrlKey && !e.metaKey) {
      g.setSpeed([1, 2, 4, 8, 16][+e.code.slice(5) - 1]);
    }
    g.events.emit('key', { code: e.code, event: e });
  }

  onDown(e) {
    this.el.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // start pinch, cancel any power stroke
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      this._pressed = false;
      this._pendingTouch = null; // a second finger means pinch, not a power stroke
      this.drag = null;
      return;
    }
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    const g = this.game;
    const power = g.activePower;
    const rotate = e.altKey || (e.button === 2 && e.ctrlKey);
    if (e.button === 0 && power && !rotate) {
      if (e.pointerType === 'touch') {
        // Wait briefly for tap intent so a two-finger pinch never casts the power.
        this._pendingTouch = { t: 0, shift: e.shiftKey };
        return;
      }
      this._pressed = true;
      this._applyTimer = 0;
      this.applyPower(0, true, e);
    } else {
      this.drag = { mode: rotate ? 'rotate' : 'pan', x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, button: e.button, moved: 0 };
    }
  }

  onMove(e) {
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const cx = (a.x + b.x) / 2,
        cy = (a.y + b.y) / 2;
      this.game.cameraRig.zoom(this.pinch.d / Math.max(d, 1));
      this.game.cameraRig.rotate(-(ang - this.pinch.ang));
      this.game.cameraRig.panPixels(cx - this.pinch.cx, cy - this.pinch.cy);
      this.pinch = { d, ang, cx, cy };
      return;
    }
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    if (this.drag) {
      const dx = e.clientX - this.drag.x,
        dy = e.clientY - this.drag.y;
      this.drag.moved += Math.abs(dx) + Math.abs(dy);
      if (this.drag.mode === 'pan') this.game.cameraRig.panPixels(dx, dy);
      else this.game.cameraRig.rotate(-dx * 0.006);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    }
  }

  onUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this._pendingTouch && this.pointers.size === 0 && this.game.activePower) {
      // a quick single tap (shorter than the intent delay) still casts once
      this._pendingTouch = null;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.applyPower(0, true, e);
    }
    this._pendingTouch = null;
    if (this.drag && this.drag.button === 0 && !this.game.activePower) {
      if (this.drag.moved < 6) {
        // simple click with no power: inspect
        // (a click that hits nothing, e.g. the sky, clears the inspector)
        const hit = this.game.picker.pick(e.clientX, e.clientY);
        this.game.events.emit('inspect', hit || null);
      }
    }
    this.drag = null;
    this._pressed = false;
  }

  onWheel(e) {
    e.preventDefault();
    const hit = this.game.picker.pick(e.clientX, e.clientY);
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    this.game.cameraRig.zoom(Math.exp(delta * 0.0012), hit);
  }

  applyPower(dt, first, e) {
    const g = this.game;
    const p = g.activePower;
    if (!p) return;
    const hit = g.picker.pick(this.mouse.x, this.mouse.y);
    if (!hit) return;
    g.applyPower(p, {
      x: hit.x,
      z: hit.z,
      tx: hit.tx,
      ty: hit.ty,
      water: hit.water,
      radius: p.brush ? g.brushSize : 0,
      dt,
      first,
      button: 0,
      shift: !!(e && e.shiftKey),
      strength: 1,
    });
  }

  update(dt) {
    this.hover = this.mouse.inside ? this.game.picker.pick(this.mouse.x, this.mouse.y) : null;
    if (this._pendingTouch) {
      this._pendingTouch.t += dt;
      if (this.pointers.size !== 1 || !this.game.activePower) this._pendingTouch = null;
      else if (this._pendingTouch.t >= 0.1) {
        const shift = this._pendingTouch.shift;
        this._pendingTouch = null;
        this._pressed = true;
        this._applyTimer = 0;
        this.applyPower(0, true, { shiftKey: shift });
      }
    }
    if (this._pressed && this.game.activePower && this.game.activePower.mode === 'brush') {
      this._applyTimer += dt;
      const iv = this.game.activePower.interval || 0;
      if (this._applyTimer >= iv) {
        this.applyPower(iv > 0 ? this._applyTimer : dt, false, null);
        this._applyTimer = 0;
      }
    }
  }
}
