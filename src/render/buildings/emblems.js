import * as THREE from 'three';

// Banner emblems: sixteen original glyphs drawn with canvas paths in a unit
// box (-1..1), used on kingdom labels, the flags over buildings (through a
// 4x4 atlas) and the inspector (bannerDataURL). Ids match civ.BANNER_SYMBOLS.
export const EMBLEM_IDS = ['tower', 'wheat', 'wolf', 'star', 'wave', 'oak', 'flame', 'crown', 'anvil', 'ship', 'moon', 'eye', 'key', 'sun', 'mountain', 'stag'];
export const FIELD_IDS = ['plain', 'pale', 'bend', 'chevron', 'quartered'];

const poly = (x, pts) => {
  x.beginPath();
  x.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]);
  x.closePath();
  x.fill();
};

const GLYPH = {
  tower(x) {
    poly(x, [-0.5, 0.9, 0.5, 0.9, 0.42, -0.45, -0.42, -0.45]);
    for (let i = 0; i < 3; i++) x.fillRect(-0.55 + i * 0.42, -0.8, 0.26, 0.4);
    x.fillRect(-0.55, -0.5, 1.1, 0.12);
    x.globalCompositeOperation = 'destination-out';
    x.beginPath();
    x.arc(0, 0.55, 0.18, Math.PI, 0);
    x.lineTo(0.18, 0.9);
    x.lineTo(-0.18, 0.9);
    x.fill();
    x.fillRect(-0.07, -0.15, 0.14, 0.28);
    x.globalCompositeOperation = 'source-over';
  },
  wheat(x) {
    x.fillRect(-0.05, -0.55, 0.1, 1.45);
    for (let i = 0; i < 4; i++) {
      const y = -0.5 + i * 0.32;
      for (const s of [-1, 1]) {
        x.beginPath();
        x.ellipse(s * 0.2, y, 0.13, 0.24, s * 0.55, 0, Math.PI * 2);
        x.fill();
      }
    }
    x.beginPath();
    x.ellipse(0, -0.78, 0.11, 0.2, 0, 0, Math.PI * 2);
    x.fill();
  },
  wolf(x) {
    // a howling head in profile
    poly(x, [-0.55, 0.85, -0.45, 0.1, -0.6, -0.35, -0.45, -0.85, -0.25, -0.45, -0.05, -0.55, 0.25, -0.3, 0.85, -0.55, 0.55, -0.15, 0.7, 0.05, 0.25, 0.2, 0.15, 0.85]);
    x.globalCompositeOperation = 'destination-out';
    x.beginPath();
    x.arc(-0.12, -0.25, 0.07, 0, Math.PI * 2);
    x.fill();
    x.globalCompositeOperation = 'source-over';
  },
  star(x) {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 - Math.PI / 2,
        r = i % 2 ? 0.38 : 0.92;
      pts.push(Math.cos(a) * r, Math.sin(a) * r);
    }
    poly(x, pts);
  },
  wave(x) {
    x.lineWidth = 0.17;
    x.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const y = -0.45 + k * 0.45;
      x.beginPath();
      for (let i = 0; i <= 24; i++) {
        const t = -0.8 + (i / 24) * 1.6;
        const yy = y + Math.sin(t * 6) * 0.12;
        if (i === 0) x.moveTo(t, yy);
        else x.lineTo(t, yy);
      }
      x.stroke();
    }
  },
  oak(x) {
    x.fillRect(-0.11, 0.1, 0.22, 0.8);
    for (const [cx, cy, r] of [
      [0, -0.35, 0.45],
      [-0.42, -0.05, 0.33],
      [0.42, -0.05, 0.33],
      [-0.22, -0.65, 0.28],
      [0.22, -0.65, 0.28],
    ]) {
      x.beginPath();
      x.arc(cx, cy, r, 0, Math.PI * 2);
      x.fill();
    }
  },
  flame(x) {
    x.beginPath();
    x.moveTo(0, -0.95);
    x.bezierCurveTo(0.35, -0.45, 0.75, -0.1, 0.55, 0.45);
    x.bezierCurveTo(0.42, 0.8, 0.15, 0.92, 0, 0.92);
    x.bezierCurveTo(-0.15, 0.92, -0.45, 0.8, -0.55, 0.45);
    x.bezierCurveTo(-0.7, 0.0, -0.3, -0.25, -0.15, -0.55);
    x.bezierCurveTo(-0.05, -0.3, 0.1, -0.35, 0, -0.95);
    x.fill();
    x.globalCompositeOperation = 'destination-out';
    x.beginPath();
    x.moveTo(0.02, -0.1);
    x.bezierCurveTo(0.3, 0.2, 0.3, 0.6, 0.02, 0.7);
    x.bezierCurveTo(-0.25, 0.62, -0.25, 0.3, 0.02, -0.1);
    x.fill();
    x.globalCompositeOperation = 'source-over';
  },
  crown(x) {
    poly(x, [-0.8, 0.55, 0.8, 0.55, 0.85, -0.35, 0.4, 0.05, 0, -0.55, -0.4, 0.05, -0.85, -0.35]);
    x.fillRect(-0.8, 0.6, 1.6, 0.2);
    for (const [cx, cy] of [
      [-0.85, -0.45],
      [0, -0.68],
      [0.85, -0.45],
    ]) {
      x.beginPath();
      x.arc(cx, cy, 0.13, 0, Math.PI * 2);
      x.fill();
    }
  },
  anvil(x) {
    poly(x, [-0.9, -0.35, 0.75, -0.35, 0.75, -0.05, 0.3, 0.05, 0.25, 0.4, 0.5, 0.75, -0.5, 0.75, -0.25, 0.4, -0.3, 0.05, -0.5, 0.0, -0.9, -0.2]);
  },
  ship(x) {
    poly(x, [-0.9, 0.35, 0.9, 0.35, 0.6, 0.75, -0.6, 0.75]);
    x.fillRect(-0.05, -0.9, 0.1, 1.25);
    poly(x, [0.1, -0.85, 0.75, 0.2, 0.1, 0.2]);
    poly(x, [-0.1, -0.6, -0.65, 0.2, -0.1, 0.2]);
  },
  moon(x) {
    x.beginPath();
    x.arc(0, 0, 0.85, 0, Math.PI * 2);
    x.fill();
    x.globalCompositeOperation = 'destination-out';
    x.beginPath();
    x.arc(0.38, -0.18, 0.72, 0, Math.PI * 2);
    x.fill();
    x.globalCompositeOperation = 'source-over';
  },
  eye(x) {
    x.beginPath();
    x.moveTo(-0.95, 0);
    x.quadraticCurveTo(0, -0.85, 0.95, 0);
    x.quadraticCurveTo(0, 0.85, -0.95, 0);
    x.fill();
    x.globalCompositeOperation = 'destination-out';
    x.beginPath();
    x.arc(0, 0, 0.36, 0, Math.PI * 2);
    x.fill();
    x.globalCompositeOperation = 'source-over';
    x.beginPath();
    x.arc(0, 0, 0.2, 0, Math.PI * 2);
    x.fill();
  },
  key(x) {
    x.lineWidth = 0.2;
    x.beginPath();
    x.arc(-0.5, 0, 0.32, 0, Math.PI * 2);
    x.stroke();
    x.fillRect(-0.2, -0.09, 1.1, 0.18);
    x.fillRect(0.5, 0.05, 0.14, 0.32);
    x.fillRect(0.75, 0.05, 0.14, 0.42);
  },
  sun(x) {
    x.beginPath();
    x.arc(0, 0, 0.42, 0, Math.PI * 2);
    x.fill();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const r0 = 0.52,
        r1 = i % 2 ? 0.78 : 0.95;
      poly(x, [Math.cos(a - 0.11) * r0, Math.sin(a - 0.11) * r0, Math.cos(a) * r1, Math.sin(a) * r1, Math.cos(a + 0.11) * r0, Math.sin(a + 0.11) * r0]);
    }
  },
  mountain(x) {
    poly(x, [-0.95, 0.75, -0.25, -0.55, 0.1, 0.05, 0.4, -0.25, 0.95, 0.75]);
    x.globalCompositeOperation = 'destination-out';
    poly(x, [-0.25, -0.55, -0.42, -0.24, -0.25, -0.3, -0.1, -0.2]);
    x.globalCompositeOperation = 'source-over';
  },
  stag(x) {
    // a stag's head with branching antlers
    poly(x, [-0.22, -0.1, 0.22, -0.1, 0.3, 0.2, 0.12, 0.85, -0.12, 0.85, -0.3, 0.2]);
    poly(x, [-0.22, -0.1, -0.5, 0.05, -0.32, 0.12]);
    poly(x, [0.22, -0.1, 0.5, 0.05, 0.32, 0.12]);
    x.lineWidth = 0.1;
    x.lineCap = 'round';
    for (const s of [-1, 1]) {
      x.beginPath();
      x.moveTo(s * 0.15, -0.12);
      x.lineTo(s * 0.45, -0.6);
      x.lineTo(s * 0.55, -0.95);
      x.moveTo(s * 0.3, -0.35);
      x.lineTo(s * 0.7, -0.45);
      x.moveTo(s * 0.42, -0.58);
      x.lineTo(s * 0.8, -0.78);
      x.stroke();
    }
  },
};

// Draw one emblem centred at (cx, cy), `size` pixels across, in `css` colour.
export function drawEmblem(ctx, id, cx, cy, size, css) {
  const fn = GLYPH[id];
  if (!fn) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size / 2, size / 2);
  ctx.fillStyle = css;
  ctx.strokeStyle = css;
  fn(ctx);
  ctx.restore();
}

const css = (hex, k = 1) => `rgb(${Math.min(255, ((hex >> 16) & 255) * k) | 0},${Math.min(255, ((hex >> 8) & 255) * k) | 0},${Math.min(255, (hex & 255) * k) | 0})`;

// A small banner (field pattern + emblem) inside the rectangle x, y, w, h.
export function drawBanner(ctx, banner, color, x, y, w, h) {
  const b = banner || { symbol: 'star', field: 'plain' };
  ctx.save();
  // pennant outline with a notched fly
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h * 0.82);
  ctx.lineTo(x + w / 2, y + h);
  ctx.lineTo(x, y + h * 0.82);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = css(color);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = css(color, 0.55);
  if (b.field === 'pale') ctx.fillRect(x + w / 2, y, w / 2, h);
  else if (b.field === 'bend') {
    ctx.beginPath();
    ctx.moveTo(x + w, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
  } else if (b.field === 'chevron') {
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + w / 2, y + h * 0.42);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
  } else if (b.field === 'quartered') {
    ctx.fillRect(x + w / 2, y, w / 2, h / 2);
    ctx.fillRect(x, y + h / 2, w / 2, h / 2);
  }
  drawEmblem(ctx, b.symbol, x + w / 2, y + h * 0.43, Math.min(w, h) * 0.62, '#f3ead2');
  ctx.restore();
}

// A data URL of a realm's banner, for the inspector and editor.
export function bannerDataURL(banner, color, size = 64) {
  if (typeof document === 'undefined') return '';
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size * 1.25);
  drawBanner(c.getContext('2d'), banner, color, 2, 2, size - 4, c.height - 4);
  return c.toDataURL('image/png');
}

// 4x4 atlas of white emblems on transparent, for the flag shader.
let _atlas = null;
export function emblemAtlas() {
  if (_atlas) return _atlas;
  const N = 64;
  const c = document.createElement('canvas');
  c.width = c.height = N * 4;
  const x = c.getContext('2d');
  EMBLEM_IDS.forEach((id, i) => drawEmblem(x, id, (i % 4) * N + N / 2, Math.floor(i / 4) * N + N / 2, N * 0.8, '#ffffff'));
  _atlas = new THREE.CanvasTexture(c);
  _atlas.flipY = false;
  _atlas.generateMipmaps = true;
  _atlas.minFilter = THREE.LinearMipmapLinearFilter;
  return _atlas;
}
