import { el } from './dom.js';
import { uiIcon } from './icons.js';

// On-screen camera controls for touch devices: zoom, rotate and face north.
// Holding a button repeats smoothly. Pinch / twist still work on the map.
export class CameraPad {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    const mk = (icon, label, fn) => {
      const b = el('button', { class: 'ws-campad__btn', type: 'button', 'aria-label': label, html: uiIcon(icon) });
      let iv = 0;
      const stop = () => {
        clearInterval(iv);
        iv = 0;
      };
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        fn();
        stop();
        iv = setInterval(fn, 110);
        this.game.audio?.play?.('ui-click', { volume: 0.3 });
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, stop);
      return b;
    };
    const rig = () => this.game.cameraRig;
    this.el = el(
      'div',
      { class: 'ws-campad ws-glass', role: 'group', 'aria-label': 'Camera' },
      mk('plus', 'Zoom in', () => rig().zoom(0.86)),
      mk('minus', 'Zoom out', () => rig().zoom(1 / 0.86)),
      el('span', { class: 'ws-campad__sep' }),
      mk('rot-left', 'Rotate left', () => rig().rotate(-Math.PI / 24)),
      mk('rot-right', 'Rotate right', () => rig().rotate(Math.PI / 24)),
      mk('compass', 'Face north', () => {
        const r = rig();
        r.goal.yaw = Math.round(r.goal.yaw / (Math.PI * 2)) * Math.PI * 2;
      }),
    );
  }
  update() {}
}
