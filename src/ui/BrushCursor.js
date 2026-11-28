import * as THREE from 'three';
import { powerIcon } from './icons.js';
import { UNIT, VEHICLE } from '../core/scale.js';
import { roadBoost } from '../sim/fleet/traffic.js';
import { BUILDING_TYPES } from '../sim/civ/catalog.js';

// a craft's drawn length in world units: its kind's length is already at the
// world's craft scale (kinds.js), and a road vehicle grows a little as the
// camera pulls back (FleetRenderer). (round 33: it was halved once more by
// VEHICLE.rel, so the ring round an ox cart at the closest zoom was smaller
// than the cart and its arcs cut through the model)
const craftLen = (o, dist = 0) => (o?.def?.length || 0.5 * VEHICLE.rel) * (o?.def?.road ? roadBoost(dist) : 1);
// (round 33) building hover outlines only up to about this camera distance (tiles)
const HOVER_BUILDING_MAX = 40;

// Ground cursor for god powers, drawn as terrain-conforming meshes:
//   * brush powers: a soft glowing rim, a falloff-shaded fill (denser at the
//     centre, matching the sculpt falloff), a half-strength contour and a
//     ripple that pulses outward (faster while the button is held);
//   * click powers: a rotating targeting reticle (plus the area rim when the
//     power has a radius);
//   * inspect mode (no power / the inspect tool): a hover highlight around the
//     creature or tile under the cursor;
//   * the current selection (game.selected) gets a gilded marker.
// Parts hidden behind terrain are drawn faintly so the cursor never vanishes.

const RING_VS = /* glsl */ `
attribute float aSide;
attribute float aU;
varying float vSide;
varying float vU;
void main() {
  vSide = aSide;
  vU = aU;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const RING_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uDash;
uniform float uDashSpeed;
uniform float uDuty;
uniform vec4 uBand;
varying float vSide;
varying float vU;
void main() {
  // the band's profile across: a solid core (uBand.xy: where it starts and
  // ends fading), a soft glow (uBand.z), the core whitened by uBand.w
  float s = abs(vSide);
  float core = 1.0 - smoothstep(uBand.x, uBand.y, s);
  float glow = (1.0 - smoothstep(0.3, 1.0, s)) * uBand.z;
  float a = max(core, glow);
  if (uDash > 0.0) {
    float f = fract(vU * uDash - uTime * uDashSpeed);
    a *= smoothstep(0.0, 0.04, f) * (1.0 - smoothstep(uDuty - 0.04, uDuty, f));
  }
  vec3 col = mix(uColor, vec3(1.0), core * uBand.w);
  gl_FragColor = vec4(col, a * uOpacity);
  if (gl_FragColor.a < 0.003) discard;
  #include <colorspace_fragment>
}`;

const DISC_VS = /* glsl */ `
attribute float aR;
varying float vR;
void main() {
  vR = aR;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const DISC_FS = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uRadius;
uniform float uPulse;
uniform float uFalloff;
varying float vR;
void main() {
  float r = clamp(vR, 0.0, 1.0);
  float t = 1.0 - r;
  float fall = t * t * (3.0 - 2.0 * t);
  float a = mix(0.35, fall, uFalloff) * 0.32;
  // half-strength contour
  a += exp(-pow((r - 0.5) * 34.0, 2.0)) * 0.22 * uFalloff;
  // outward ripple
  float ph = fract(uTime * uPulse);
  a += exp(-pow((r - ph) * 11.0, 2.0)) * (1.0 - ph) * 0.55;
  // centre pip (world-sized)
  float rr = r * uRadius;
  a += (1.0 - smoothstep(0.08, 0.2, rr)) * 0.9;
  a *= 1.0 - smoothstep(0.9, 1.0, r);
  gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.12), a * uOpacity);
  if (gl_FragColor.a < 0.003) discard;
  #include <colorspace_fragment>
}`;

function ringMaterial(occluded) {
  return new THREE.ShaderMaterial({
    vertexShader: RING_VS,
    fragmentShader: RING_FS,
    uniforms: {
      uColor: { value: new THREE.Color(1, 1, 1) },
      uOpacity: { value: 1 },
      uTime: { value: 0 },
      uDash: { value: 0 },
      uDashSpeed: { value: 0 },
      uDuty: { value: 0.6 },
      uBand: { value: new THREE.Vector4(0.18, 0.5, 0.42, 0.35) },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    depthFunc: occluded ? THREE.GreaterDepth : THREE.LessEqualDepth,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
}

// How much of the scene's light an unlit ground marker takes: 1 at a clear
// noon, falling with the key and sky light (storm, dusk, night) to 0.3.
// (round 33) The hover and selection outlines are unlit, unfogged lines: a
// white frame round a hall glowed over the dark frame of a storm.
// (round 35) It also gives back the exposure the night raises (about 1.8 at
// night): a hall's white frame at 0.3 still read bright white over the dark
// town at night. It now falls to about a sixth there.
function markerLight(game) {
  const env = game.env || {};
  const lum = (c) => (c ? c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722 : null);
  const key = lum(env.lightColor) ?? 3.1;
  const sky = lum(env.ambientColor) ?? 0.7;
  const ex = Math.max(1, game.atmosphere?.post?.exposure ?? 1);
  return Math.max(0.12, Math.min(1, Math.pow((key + sky) / 3.6, 0.75) / ex));
}

// (round 35) A faint outline of the building that rises next on a cleared
// plot: its footprint and height as a glass box with bright edges (the plot
// showed only the gold corner marks, though its card already said "Next:
// Apartment Block").
class PlotGhost {
  constructor(game) {
    this.game = game;
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    this.fill = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xfbe3a6, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    this.edges = new THREE.LineSegments(new THREE.EdgesGeometry(box), new THREE.LineBasicMaterial({ color: 0xfbe3a6, transparent: true, opacity: 0.6, depthWrite: false, fog: false, toneMapped: false }));
    this.group = new THREE.Group();
    this.group.name = 'plot-ghost';
    this.group.add(this.fill, this.edges);
    this.fill.renderOrder = 990;
    this.edges.renderOrder = 991;
    this.group.visible = false;
    this.group.frustumCulled = false;
    for (const m of [this.fill, this.edges]) m.frustumCulled = false;
    game.scene.add(this.group);
    this._key = '';
    this._h = 1;
  }
  // P: the town's pending renewal ({ tx, ty, rot, type, level, was }), v its town
  show(P, v, plot, t) {
    const g = this.game;
    const def = BUILDING_TYPES[P?.type];
    if (!def) return this.hide();
    const fw = P.rot & 1 ? def.h : def.w,
      fh = P.rot & 1 ? def.w : def.h;
    const cx = P.tx + fw / 2,
      cz = P.ty + fh / 2;
    const key = `${P.type}|${P.level}|${P.tx}|${P.ty}|${P.rot}`;
    if (key !== this._key) {
      this._key = key;
      let h = 0;
      try {
        h = g.buildings?.previewHeight?.({ type: P.type, level: P.level, style: P.was?.style ?? plot?.style, era: g.civ?.kingdoms?.[v?.kingdom]?.era ?? plot?.era ?? 1, kingdom: v?.kingdom, village: v?.id, x: cx, z: cz, id: plot?.id || 0 }) || 0;
      } catch {
        h = 0;
      }
      this._h = h > 0.05 ? h : 1.5;
    }
    const gy = g.world.surfaceAt(cx, cz);
    this.group.position.set(cx, gy + 0.02, cz);
    this.group.scale.set(fw * 0.86, this._h, fh * 0.86);
    const lk = markerLight(g);
    const pulse = 0.85 + Math.sin(t * 2.4) * 0.15;
    this.edges.material.opacity = 0.62 * pulse * lk;
    this.fill.material.opacity = 0.075 * pulse * lk;
    this.group.visible = true;
  }
  hide() {
    this.group.visible = false;
  }
}

// A closed band laid on the ground along a loop of points.
class GroundLoop {
  constructor(game, n, renderOrder = 990) {
    this.game = game;
    this.n = n;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array((n + 1) * 2 * 3);
    const side = new Float32Array((n + 1) * 2);
    const u = new Float32Array((n + 1) * 2);
    for (let i = 0; i <= n; i++) {
      side[i * 2] = -1;
      side[i * 2 + 1] = 1;
      u[i * 2] = u[i * 2 + 1] = i / n;
    }
    const idx = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setAttribute('aU', new THREE.BufferAttribute(u, 1));
    this.geo = geo;
    this.front = new THREE.Mesh(geo, ringMaterial(false));
    this.back = new THREE.Mesh(geo, ringMaterial(true));
    for (const m of [this.front, this.back]) {
      m.frustumCulled = false;
      m.renderOrder = renderOrder;
      m.visible = false;
      game.scene.add(m);
    }
    this.back.renderOrder = renderOrder - 1;
    this.px = new Float32Array(n);
    this.pz = new Float32Array(n);
    this.lit = false; // dims with the scene's light (markerLight)
    this.over = false; // drawn over everything (no faint hidden part)
  }
  // (round 37) drawn over buildings and hills, whole, in its own profile
  // (band: core start, core end, glow, whitening; see RING_FS)
  overlay(band) {
    this.over = true;
    this.front.material.depthTest = false;
    this.front.material.uniforms.uBand.value.set(...band);
    this.back.visible = false;
  }
  set visible(v) {
    this.front.visible = v;
    this.back.visible = v && !this.over;
  }
  get visible() {
    return this.front.visible;
  }
  dispose() {
    for (const m of [this.front, this.back]) {
      m.removeFromParent();
      m.material.dispose();
    }
    this.geo.dispose();
  }
  style(color, opacity, time, dash = 0, dashSpeed = 0, duty = 0.6, backOpacity = 0.28) {
    const lk = this.lit ? markerLight(this.game) : 1;
    for (const [m, o] of [
      [this.front, opacity],
      [this.back, opacity * backOpacity],
    ]) {
      const u = m.material.uniforms;
      u.uColor.value.copy(color).multiplyScalar(lk);
      u.uOpacity.value = o;
      u.uTime.value = time;
      u.uDash.value = dash;
      u.uDashSpeed.value = dashSpeed;
      u.uDuty.value = duty;
    }
  }
  // Lay the band along the loop stored in px/pz; width in world units.
  // With yc set, heights are clamped to yc ± dev so small markers stay flat
  // instead of climbing cliff faces.
  build(width, lift, yc = null, dev = 0.3) {
    const W = this.game.world;
    const n = this.n;
    const px = this.px,
      pz = this.pz;
    const pos = this.pos;
    const hw = width / 2;
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const a = (k - 1 + n) % n,
        b = (k + 1) % n;
      let tx = px[b] - px[a],
        tz = pz[b] - pz[a];
      const l = Math.hypot(tx, tz) || 1;
      tx /= l;
      tz /= l;
      // outward normal (loops are counter-clockwise in screen space)
      const nx = tz,
        nz = -tx;
      for (let s = 0; s < 2; s++) {
        const o = s ? hw : -hw;
        const x = px[k] + nx * o,
          z = pz[k] + nz * o;
        const j = (i * 2 + s) * 3;
        pos[j] = x;
        let y = W.surfaceAt(x, z);
        if (yc != null) y = y < yc - dev ? yc - dev : y > yc + dev ? yc + dev : y;
        pos[j + 1] = y + lift;
        pos[j + 2] = z;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
  circle(cx, cz, r) {
    const n = this.n;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.px[i] = cx + Math.cos(a) * r;
      this.pz[i] = cz + Math.sin(a) * r;
    }
  }
  square(x0, z0, x1, z1, inset = 0.04) {
    const n = this.n;
    const per = n / 4;
    const pts = [
      [x0 + inset, z0 + inset],
      [x1 - inset, z0 + inset],
      [x1 - inset, z1 - inset],
      [x0 + inset, z1 - inset],
    ];
    for (let i = 0; i < n; i++) {
      const e = Math.floor(i / per),
        t = (i % per) / per;
      const A = pts[e % 4],
        B = pts[(e + 1) % 4];
      this.px[i] = A[0] + (B[0] - A[0]) * t;
      this.pz[i] = A[1] + (B[1] - A[1]) * t;
    }
  }
}

// Polar disc laid on the ground (falloff fill).
class GroundDisc {
  constructor(game, rings = 22, segs = 80) {
    this.game = game;
    this.rings = rings;
    this.segs = segs;
    const nv = 1 + rings * segs;
    this.pos = new Float32Array(nv * 3);
    const aR = new Float32Array(nv);
    const idx = [];
    for (let j = 1; j <= rings; j++) for (let k = 0; k < segs; k++) aR[1 + (j - 1) * segs + k] = j / rings;
    for (let k = 0; k < segs; k++) idx.push(0, 1 + ((k + 1) % segs), 1 + k);
    for (let j = 1; j < rings; j++) {
      for (let k = 0; k < segs; k++) {
        const a = 1 + (j - 1) * segs + k,
          b = 1 + (j - 1) * segs + ((k + 1) % segs);
        const c = a + segs,
          d = b + segs;
        idx.push(a, b, c, b, d, c);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setIndex(idx);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aR', new THREE.BufferAttribute(aR, 1));
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: DISC_VS,
      fragmentShader: DISC_FS,
      uniforms: {
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 1 },
        uTime: { value: 0 },
        uRadius: { value: 4 },
        uPulse: { value: 0.6 },
        uFalloff: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 985;
    this.mesh.visible = false;
    game.scene.add(this.mesh);
  }
  build(cx, cz, r, lift) {
    const W = this.game.world;
    const pos = this.pos;
    pos[0] = cx;
    pos[1] = W.surfaceAt(cx, cz) + lift;
    pos[2] = cz;
    const { rings, segs } = this;
    for (let j = 1; j <= rings; j++) {
      const rr = (j / rings) * r;
      for (let k = 0; k < segs; k++) {
        const a = (k / segs) * Math.PI * 2;
        const x = cx + Math.cos(a) * rr,
          z = cz + Math.sin(a) * rr;
        const o = (1 + (j - 1) * segs + k) * 3;
        pos[o] = x;
        pos[o + 1] = W.surfaceAt(x, z) + lift;
        pos[o + 2] = z;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

// Glowing figure drawn only where the selection is hidden (GreaterDepth),
// so a followed creature stays visible under canopy or behind buildings.
function xrayTexture(kind) {
  const c = document.createElement('canvas');
  const W = kind === 'beast' ? 128 : 64,
    H = kind === 'beast' ? 80 : 128;
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  const shape = () => {
    x.beginPath();
    if (kind === 'beast') {
      x.ellipse(60, 46, 38, 18, 0, 0, Math.PI * 2);
      x.moveTo(104, 34);
      x.ellipse(98, 30, 14, 11, -0.3, 0, Math.PI * 2);
      for (const lx of [36, 52, 70, 86]) x.rect(lx - 4, 54, 8, 20);
    } else {
      x.arc(32, 24, 14, 0, Math.PI * 2);
      x.moveTo(12, 120);
      x.quadraticCurveTo(10, 46, 32, 44);
      x.quadraticCurveTo(54, 46, 52, 120);
      x.closePath();
    }
  };
  x.shadowColor = 'rgba(255,214,120,0.95)';
  x.shadowBlur = 10;
  x.fillStyle = 'rgba(251,229,173,0.55)';
  shape();
  x.fill();
  x.shadowBlur = 0;
  x.lineWidth = 3;
  x.strokeStyle = 'rgba(255,246,220,0.95)';
  shape();
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// (round 25) A small bright mark for a selected or followed creature or car
// that is drawn smaller than a few pixels (half-size people at mid zoom).
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const x = c.getContext('2d');
  x.beginPath();
  x.arc(16, 16, 13, 0, Math.PI * 2);
  x.fillStyle = 'rgba(20,16,8,0.85)';
  x.fill();
  x.beginPath();
  x.arc(16, 16, 10, 0, Math.PI * 2);
  x.fillStyle = '#fff3d0';
  x.fill();
  x.beginPath();
  x.arc(16, 16, 5.5, 0, Math.PI * 2);
  x.fillStyle = '#f2c35a';
  x.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// (round 35) A bus stop's name tag on the map while its bus is selected: a
// small dark plate with the name, the next stop's in gold.
function stopTagTexture(text, next) {
  const c = document.createElement('canvas');
  const fs = 30;
  const x = c.getContext('2d');
  const font = `600 ${fs}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  x.font = font;
  const tw = Math.ceil(x.measureText(text).width);
  c.width = tw + 34 + 24;
  c.height = fs + 22;
  x.font = font;
  const r = c.height / 2;
  x.beginPath();
  x.roundRect(1, 1, c.width - 2, c.height - 2, r - 1);
  x.fillStyle = 'rgba(16,14,10,0.82)';
  x.fill();
  x.lineWidth = 2;
  x.strokeStyle = next ? 'rgba(251,227,166,0.95)' : 'rgba(251,227,166,0.45)';
  x.stroke();
  // the bus-stop disc
  x.beginPath();
  x.arc(r + 2, r, 8, 0, Math.PI * 2);
  x.fillStyle = next ? '#f2c35a' : '#fbe3a6';
  x.fill();
  x.fillStyle = next ? '#fbe3a6' : '#f4efe4';
  x.textBaseline = 'middle';
  x.fillText(text, r + 18, r + 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.userData = { w: c.width, h: c.height };
  return t;
}

export class BrushCursor {
  constructor(game) {
    this.game = game;
    this.rim = new GroundLoop(game, 160, 992);
    this.reticle = new GroundLoop(game, 72, 994);
    this.fill = new GroundDisc(game);
    this.hover = new GroundLoop(game, 64, 991);
    this.sel = new GroundLoop(game, 72, 993);
    this.hover.lit = this.sel.lit = true; // outlines take the scene's light (the power brush keeps its own)
    this.ghost = new PlotGhost(game);
    this.color = new THREE.Color();
    this.white = new THREE.Color(1, 1, 1);
    this.gold = new THREE.Color('#fbe3a6');
    // (round 37) a bus route: saturated amber gold over a dark casing (the
    // pale gold read as the cream centre line of the streets it runs along)
    this.routeGold = new THREE.Color('#ffb21a');
    this.routeCase = new THREE.Color('#2a1c08');
    this._tintFor = null;
    this.xray = {};
    for (const k of ['figure', 'beast']) {
      const m = new THREE.SpriteMaterial({ map: xrayTexture(k), transparent: true, depthWrite: false, depthTest: true, depthFunc: THREE.GreaterDepth, fog: false, toneMapped: false });
      const s = new THREE.Sprite(m);
      s.renderOrder = 996;
      s.visible = false;
      s.frustumCulled = false;
      game.scene.add(s);
      this.xray[k] = s;
    }
    this.dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTexture(), transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false }));
    this.dot.renderOrder = 997;
    this.dot.visible = false;
    this.dot.frustumCulled = false;
    game.scene.add(this.dot);
    // (round 35) a selected town bus's loop and its stops on the map
    this.route = null;
    this.stopRings = [];
    this.stopTags = [];
    this._tagTex = new Map();
    this._tgt = null;
    this._tgtKey = '';
    this._tgtT = 0;
    this._cursor = '';
    this.t = 0;
    this.press = 0;
    this.appear = 0;
    // after a one-click cast (Drought, Spawn Vehicle, ...) the cursor steps aside
    // for a moment, so the cast's own ring on the ground reads on its own
    this.hush = 0;
    game.events?.on?.('power:apply', ({ power } = {}) => {
      if (power?.mode === 'click') this.hush = 1.1;
    });
  }

  tint(p) {
    if (this._tintFor !== p) {
      this._tintFor = p;
      this.color.setStyle(powerIcon(p).tint || '#ffffff');
    }
    return this.color;
  }

  // World units per CSS pixel at a world point (from the main camera).
  pxAt(x, y, z) {
    const cam = this.game.cameraRig.camera;
    const p = cam.position;
    const d = Math.hypot(x - p.x, y - p.y, z - p.z);
    return (2 * d * Math.tan(((cam.fov || 38) * Math.PI) / 360)) / Math.max(1, innerHeight);
  }
  // What a click at the hover point would open, re-resolved when the cursor
  // moves or every 0.2 s (people walk under a still cursor).
  hoverTarget(hit, dt) {
    const pk = this.game.picker;
    if (!pk?.target) return null;
    this._tgtT -= dt;
    const key = `${hit.sx | 0},${hit.sy | 0}`;
    if (key !== this._tgtKey || this._tgtT <= 0) {
      this._tgtKey = key;
      this._tgtT = 0.2;
      try {
        this._tgt = pk.target(hit);
      } catch {
        this._tgt = null;
      }
    }
    const o = this._tgt?.ref;
    if (o && (o.alive === false || o.state === 'sinking')) this._tgt = null;
    return this._tgt;
  }

  // (round 35) While a town bus is selected: its loop along the streets as a
  // dashed gold line running the way the bus goes, a ring at each stop and
  // each stop's name over it (the next stop's in gold), so the route reads on
  // the map as well as on the card.
  busLoop(bus, lineW, lift) {
    const g = this.game;
    const pts = bus && bus.alive !== false && !g.ui?.root?.classList.contains('is-photo') ? g.fleet?.townLoopPath?.(bus) : null;
    const stops = pts ? bus.mission.stops : null;
    const n = pts ? pts.length / 2 : 0;
    if (n >= 2) {
      // (round 37) a solid amber line on a dark casing, drawn over the
      // buildings and hills along it, about 7 and 13 px wide
      if (!this.route || this.route.n !== n) {
        this.route?.dispose();
        this.routeBack?.dispose();
        this.routeBack = new GroundLoop(g, n, 987);
        this.routeBack.lit = true;
        this.routeBack.overlay([0.72, 0.96, 0, 0]);
        this.route = new GroundLoop(g, n, 989);
        this.route.lit = true;
        this.route.overlay([0.5, 0.8, 0.22, 0.06]);
      }
      const T = g.cameraRig.target;
      const ppx = this.pxAt(T.x, T.y, T.z);
      for (const R of [this.routeBack, this.route]) {
        for (let i = 0; i < n; i++) {
          R.px[i] = pts[i * 2];
          R.pz[i] = pts[i * 2 + 1];
        }
      }
      this.routeBack.build(Math.max(0.12, 13 * ppx), lift * 0.85);
      this.routeBack.style(this.routeCase, 0.8, this.t);
      this.route.build(Math.max(0.07, 7 * ppx), lift * 0.9);
      this.route.style(this.routeGold, 1, this.t);
      this.routeBack.visible = this.route.visible = true;
    } else if (this.route) this.routeBack.visible = this.route.visible = false;
    // (round 37) a bus newly picked: the camera takes in its whole loop and
    // every stop (2 of 5 stop names were in view), once, and never while it
    // follows something (the follow camera keeps its own framing)
    if (bus !== this._loopBus) {
      this._loopBus = bus;
      if (n >= 2 && !g.cameraRig.follow) this._frameLoop(pts);
    }
    const next = stops && bus.mission.goal?.at === 'stop' ? bus.mission.goal.i : null;
    const cam = g.cameraRig.camera;
    for (let j = 0; j < Math.max(this.stopRings.length, stops?.length || 0); j++) {
      const st = stops?.[j];
      let ring = this.stopRings[j],
        tag = this.stopTags[j];
      if (!st) {
        if (ring) ring.visible = false;
        if (tag) tag.visible = false;
        continue;
      }
      if (!ring) {
        ring = this.stopRings[j] = new GroundLoop(g, 40, 990);
        ring.lit = true;
        tag = this.stopTags[j] = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false }));
        tag.renderOrder = 998;
        tag.frustumCulled = false;
        tag.center.set(0.5, 0);
        g.scene.add(tag);
      }
      const isNext = st.i === next;
      const y0 = g.world.surfaceAt(st.x, st.z);
      const ppx = this.pxAt(st.x, y0, st.z);
      ring.circle(st.x, st.z, Math.max(0.22, 7 * ppx));
      ring.build(Math.max(0.05, lineW * 0.8), lift, y0, 0.25);
      ring.style(this.gold, isNext ? 1 : 0.75, this.t, 0, 0, 0.6, 0.5);
      ring.visible = true;
      const key = `${st.label || 'Stop'}|${isNext ? 1 : 0}`;
      let tex = this._tagTex.get(key);
      if (!tex) {
        tex = stopTagTexture(st.label || 'Stop', isNext);
        this._tagTex.set(key, tex);
        if (this._tagTex.size > 40) {
          const [k0, t0] = this._tagTex.entries().next().value;
          if (k0 !== key) {
            t0.dispose();
            this._tagTex.delete(k0);
          }
        }
      }
      if (tag.material.map !== tex) {
        tag.material.map = tex;
        tag.material.needsUpdate = true;
      }
      // about 17 px tall on screen, standing just over the stop
      const hpx = 17;
      tag.scale.set(hpx * ppx * (tex.userData.w / tex.userData.h), hpx * ppx, 1);
      tag.position.set(st.x, y0 + 10 * ppx, st.z);
      // (round 37) the stop's name fades while the bus stands at (or rolls
      // through) that stop: "Elm Street" was drawn right over the bus waiting
      // there; the bus's own name pin (Inspector.updatePin) marks it instead
      const near = Math.hypot(bus.x - st.x, bus.z - st.z) < Math.max(1.3, 34 * ppx);
      const f = (tag.userData.fade ??= 1);
      tag.userData.fade = f + ((near ? 0.12 : 1) - f) * Math.min(1, this._dt * 8);
      tag.material.opacity = tag.userData.fade;
      tag.visible = true;
      void cam;
    }
  }

  // ease the camera to take in a loop of points [x, z, ...] (its yaw kept)
  _frameLoop(pts) {
    const rig = this.game.cameraRig;
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]);
      x1 = Math.max(x1, pts[i]);
      z0 = Math.min(z0, pts[i + 1]);
      z1 = Math.max(z1, pts[i + 1]);
    }
    const cam = rig.camera;
    const tanH = Math.tan(((cam.fov || 38) * Math.PI) / 360);
    const asp = cam.aspect || 1;
    // the loop's radius, with room for the stop names over it
    const R = Math.hypot(x1 - x0, z1 - z0) / 2 + 1.5;
    const d = THREE.MathUtils.clamp((R / (tanH * Math.min(1, asp))) * 1.05, 14, 70);
    rig.set((x0 + x1) / 2, (z0 + z1) / 2, d, THREE.MathUtils.radToDeg(rig.goal.yaw), null, false);
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this._dt = dt;
    const hit = g.input?.hover;
    const p = g.activePower;
    const dist = g.cameraRig.cur.dist;
    const lift = 0.06 + dist * 0.0016;
    const lineW = Math.min(1.1, Math.max(0.07, dist * 0.0048));
    const pressed = !!g.input?._pressed;
    this.press += ((pressed ? 1 : 0) - this.press) * Math.min(1, dt * 14);

    const inspectMode = !p || p.id === 'inspect';
    this.hush = Math.max(0, this.hush - dt);
    const showPower = !!(hit && p && !inspectMode && this.hush <= 0);
    this.appear += ((showPower ? 1 : 0) - this.appear) * Math.min(1, dt * 16);

    // ---- power cursor
    if (showPower) {
      const col = this.tint(p);
      const hasR = !!p.brush;
      const r = hasR ? Math.max(0.5, g.brushSize) : 0;
      const k = 0.82 + 0.18 * Math.min(1, this.appear * 1.2);
      if (hasR) {
        const rr = r * k;
        this.rim.circle(hit.x, hit.z, rr);
        this.rim.build(lineW, lift);
        this.rim.style(col, 0.95 + this.press * 0.05, this.t, 0, 0, 0.6, 0.32);
        this.rim.visible = true;
        this.fill.build(hit.x, hit.z, rr, lift * 0.9);
        const u = this.fill.mat.uniforms;
        u.uColor.value.copy(col);
        u.uOpacity.value = (p.mode === 'click' ? 0.6 : 0.85) + this.press * 0.5;
        u.uTime.value = this.t;
        u.uRadius.value = rr;
        u.uPulse.value = 0.55 + this.press * 1.1;
        u.uFalloff.value = p.mode === 'click' ? 0.4 : 1;
        this.fill.mesh.visible = true;
      } else {
        this.rim.visible = false;
        this.fill.mesh.visible = false;
      }
      if (p.mode === 'click') {
        const rr = Math.max(0.55, Math.min(hasR ? r * 0.32 : 99, dist * 0.016)) * (1.25 - 0.25 * this.appear);
        this.reticle.circle(hit.x, hit.z, rr);
        this.reticle.build(lineW * 1.15, lift * 1.1);
        this.reticle.style(hasR ? this.white : col, 1, this.t, 4, 0.12 + this.press * 0.5, 0.62, 0.4);
        this.reticle.visible = true;
        if (!hasR) {
          // small solid pip in the centre via the fill disc
          this.fill.build(hit.x, hit.z, rr * 0.9, lift);
          const u = this.fill.mat.uniforms;
          u.uColor.value.copy(col);
          u.uOpacity.value = 0.7 + this.press * 0.4;
          u.uTime.value = this.t;
          u.uRadius.value = rr * 0.9;
          u.uPulse.value = 0.8;
          u.uFalloff.value = 0;
          this.fill.mesh.visible = true;
        }
      } else this.reticle.visible = false;
    } else {
      this.rim.visible = false;
      this.reticle.visible = false;
      this.fill.mesh.visible = false;
    }

    // ---- hover highlight (inspect mode; never in ?ui=0 captures)
    // (round 25) the ring sits on what a click here would open (the picker's
    // own rule: a creature or car within its pick radius, else the building
    // under the cursor), and the pointer turns into a hand over it
    let hovered = false;
    let clickable = false;
    const uiOn = g.params.ui !== false;
    if (uiOn && hit && inspectMode && !g.input?.drag) {
      const sel = g.selected?.ref;
      const tg = this.hoverTarget(hit, dt);
      clickable = !!tg;
      const o = tg?.ref;
      if (o && o !== sel && tg.kind !== 'building') {
        const sz = (o.scale || 1) * (o.def?.size || 1);
        const rw = tg.kind === 'unit' ? 0.42 * sz * UNIT.rel + 0.09 : 0.6 * craftLen(o, g.cameraRig.cur.dist) + 0.04;
        const r = Math.max(rw, 8 * this.pxAt(o.x, o.y ?? g.world.surfaceAt(o.x, o.z), o.z));
        this.hover.circle(o.x, o.z, r);
        this.hover.build(Math.max(0.03, lineW * 0.6), lift, g.world.surfaceAt(o.x, o.z), 0.25);
        this.hover.style(this.white, 0.6, this.t, 0, 0, 0.6, 0.3);
        hovered = true;
      } else if (o && o !== sel && tg.kind === 'building' && !g.cameraRig.follow && dist <= HOVER_BUILDING_MAX) {
        // (round 33) no building outline while following someone (the hall
        // under the resting cursor was framed as the town slid by) nor from
        // world-map heights (a white frame sat on Taipei at 54-75 tiles)
        this.hover.square(o.tx - 0.06, o.ty - 0.06, o.tx + (o.w || 1) + 0.06, o.ty + (o.h || 1) + 0.06);
        this.hover.build(Math.max(0.04, lineW * 0.6), lift, g.world.surfaceAt(o.x, o.z), 0.8);
        this.hover.style(this.white, 0.5, this.t, 0, 0, 0.6, 0.25);
        hovered = true;
      }
      // (round 31) no outline round a bare tile: nothing there opens on a
      // click, and at the closest follow zoom it drew a 470 px white square
      // round the followed truck
    }
    this.hover.visible = hovered;
    const cur = uiOn && clickable ? 'pointer' : '';
    if (cur !== this._cursor) {
      this._cursor = cur;
      const cv = g.pipeline?.renderer?.domElement;
      if (cv) cv.style.cursor = cur;
    }

    // ---- selection marker
    const s = g.selected;
    const ref = s?.ref;
    if (uiOn && ref && ref.alive !== false && ref.x != null) {
      let r;
      if (s.kind === 'building') r = Math.max(1, Math.max(ref.w || 1, ref.h || 1) * 0.72);
      // (round 29) a craft's ring is about 1.3 times its length across (it
      // was 0.45 + 0.55 x length from before craft were halved: ~520 px round
      // a truck at the closest zoom), never under ~9 px
      else if (s.kind === 'vessel') r = Math.max(0.65 * craftLen(ref, g.cameraRig.cur.dist) + 0.04, 9 * this.pxAt(ref.x, ref.y ?? g.world.surfaceAt(ref.x, ref.z), ref.z));
      // (round 25) half-size creatures: a ring sized to the body, never under ~9 px
      else r = Math.max(0.5 * (ref.scale || 1) * (ref.def?.size || 1) * UNIT.rel + 0.14, 9 * this.pxAt(ref.x, ref.y ?? g.world.surfaceAt(ref.x, ref.z), ref.z));
      r *= 1 + Math.sin(this.t * 3.2) * 0.04;
      this.sel.circle(ref.x, ref.z, r);
      this.sel.build(Math.max(0.06, lineW * 0.85), lift, g.world.surfaceAt(ref.x, ref.z), s.kind === 'building' ? 0.8 : 0.25);
      // the hidden part of the ring stays bright so it reads through foliage
      this.sel.style(this.gold, 1, this.t, 3, 0.18, 0.72, 0.75 + Math.sin(this.t * 4) * 0.2);
      this.sel.visible = true;
    } else if (uiOn && !ref && g.ui?.inspector?.open && g.ui.inspector.track?.plotOf?.tx != null) {
      // (round 27) a cleared plot has no selection of its own (nothing stands
      // there): the gold mark is a square on its footprint
      const pb = g.ui.inspector.track.plotOf;
      const e = 0.08 + Math.sin(this.t * 3.2) * 0.03;
      this.sel.square(pb.tx - e, pb.ty - e, pb.tx + (pb.w || 1) + e, pb.ty + (pb.h || 1) + e);
      this.sel.build(Math.max(0.06, lineW * 0.85), lift, g.world.surfaceAt(pb.x ?? pb.tx + 0.5, pb.z ?? pb.ty + 0.5), 0.8);
      this.sel.style(this.gold, 1, this.t, 3, 0.18, 0.72, 0.75 + Math.sin(this.t * 4) * 0.2);
      this.sel.visible = true;
    } else this.sel.visible = false;
    // (round 35) a cleared plot held for a new building shows that building's
    // footprint and height
    {
      const tr = uiOn && !ref && g.ui?.inspector?.open ? g.ui.inspector.track : null;
      const pv = tr?.plotOf?.tx != null ? tr.village : null;
      const P = pv?.renewPend && pv.renewPend.home === tr.plotOf.id ? pv.renewPend : null;
      if (P) this.ghost.show(P, pv, tr.plotOf, this.t);
      else this.ghost.hide();
    }
    // (round 25) a selected or followed creature or car drawn under ~5 px
    // gets a small bright mark of at least that size over its body
    const fo = g.cameraRig?.follow;
    const mk = s && (s.kind === 'unit' || s.kind === 'vessel') ? ref : fo && fo.x != null ? fo : null;
    let dotOn = false;
    if (uiOn && mk && mk.alive !== false && mk.state !== 'sinking' && mk.x != null && !g.ui?.root?.classList.contains('is-photo')) {
      const y0 = mk.y ?? g.world.surfaceAt(mk.x, mk.z);
      const bh = g.picker?.bodyHeight ? g.picker.bodyHeight(mk) : 0.18;
      const ppx = this.pxAt(mk.x, y0 + bh * 0.5, mk.z);
      const onScreen = bh / Math.max(1e-6, ppx);
      if (onScreen < 6) {
        const d = 6 * ppx;
        this.dot.position.set(mk.x, y0 + Math.max(bh * 0.6, d * 0.5), mk.z);
        this.dot.scale.set(d, d, 1);
        dotOn = true;
      }
    }
    this.dot.visible = dotOn;
    this.busLoop(uiOn && (s?.kind === 'vessel' || s?.kind === 'vehicle') ? ref : null, lineW, lift);
    // x-ray figure (only rendered where something occludes the creature)
    const showX = uiOn && s?.kind === 'unit' && ref && ref.alive !== false && ref.x != null;
    const humanoid = ref?.def?.kind === 'humanoid';
    for (const [k, spr] of Object.entries(this.xray)) {
      const on = showX && (k === 'figure') === humanoid;
      spr.visible = on;
      if (!on) continue;
      const sz = (ref.scale || 1) * (ref.def?.size || 1);
      const h = humanoid ? 0.95 * sz + 0.15 : 0.62 * sz + 0.12;
      const w = humanoid ? h * 0.5 : h * 1.6;
      const y = (ref.y ?? g.world.surfaceAt(ref.x, ref.z)) + h * 0.5;
      spr.position.set(ref.x, y, ref.z);
      spr.scale.set(w, h, 1);
      spr.material.opacity = 0.7 + Math.sin(this.t * 4) * 0.2;
    }
  }
}
