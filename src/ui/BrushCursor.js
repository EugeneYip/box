import * as THREE from 'three';
import { powerIcon } from './icons.js';

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
varying float vSide;
varying float vU;
void main() {
  float s = abs(vSide);
  float core = 1.0 - smoothstep(0.18, 0.5, s);
  float glow = (1.0 - smoothstep(0.3, 1.0, s)) * 0.42;
  float a = max(core, glow);
  if (uDash > 0.0) {
    float f = fract(vU * uDash - uTime * uDashSpeed);
    a *= smoothstep(0.0, 0.04, f) * (1.0 - smoothstep(uDuty - 0.04, uDuty, f));
  }
  vec3 col = mix(uColor, vec3(1.0), core * 0.35);
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
  }
  set visible(v) {
    this.front.visible = this.back.visible = v;
  }
  get visible() {
    return this.front.visible;
  }
  style(color, opacity, time, dash = 0, dashSpeed = 0, duty = 0.6, backOpacity = 0.28) {
    for (const [m, o] of [
      [this.front, opacity],
      [this.back, opacity * backOpacity],
    ]) {
      const u = m.material.uniforms;
      u.uColor.value.copy(color);
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

export class BrushCursor {
  constructor(game) {
    this.game = game;
    this.rim = new GroundLoop(game, 160, 992);
    this.reticle = new GroundLoop(game, 72, 994);
    this.fill = new GroundDisc(game);
    this.hover = new GroundLoop(game, 64, 991);
    this.sel = new GroundLoop(game, 72, 993);
    this.color = new THREE.Color();
    this.white = new THREE.Color(1, 1, 1);
    this.gold = new THREE.Color('#fbe3a6');
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
    this.t = 0;
    this.press = 0;
    this.appear = 0;
  }

  tint(p) {
    if (this._tintFor !== p) {
      this._tintFor = p;
      this.color.setStyle(powerIcon(p).tint || '#ffffff');
    }
    return this.color;
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    const hit = g.input?.hover;
    const p = g.activePower;
    const dist = g.cameraRig.cur.dist;
    const lift = 0.06 + dist * 0.0016;
    const lineW = Math.min(1.1, Math.max(0.07, dist * 0.0048));
    const pressed = !!g.input?._pressed;
    this.press += ((pressed ? 1 : 0) - this.press) * Math.min(1, dt * 14);

    const inspectMode = !p || p.id === 'inspect';
    const showPower = !!(hit && p && !inspectMode);
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
    let hovered = false;
    const uiOn = g.params.ui !== false;
    if (uiOn && hit && inspectMode && !g.input?.drag) {
      const sel = g.selected?.ref;
      const u = g.units?.nearest?.(hit.x, hit.z, 0.9);
      if (u && u !== sel) {
        const r = 0.42 * (u.scale || 1) * (u.def?.size || 1) + 0.18;
        this.hover.circle(u.x, u.z, r);
        this.hover.build(Math.max(0.05, lineW * 0.7), lift, g.world.surfaceAt(u.x, u.z), 0.25);
        this.hover.style(this.white, 0.85, this.t, 0, 0, 0.6, 0.35);
        hovered = true;
      } else if (!hit.water || g.world.isLand(hit.tx, hit.ty)) {
        this.hover.square(hit.tx, hit.ty, hit.tx + 1, hit.ty + 1);
        this.hover.build(Math.max(0.04, lineW * 0.55), lift, g.world.surfaceAt(hit.tx + 0.5, hit.ty + 0.5), 0.45);
        this.hover.style(this.white, 0.55, this.t, 0, 0, 0.6, 0.25);
        hovered = true;
      }
    }
    this.hover.visible = hovered;

    // ---- selection marker
    const s = g.selected;
    const ref = s?.ref;
    if (uiOn && ref && ref.alive !== false && ref.x != null) {
      let r;
      if (s.kind === 'building') r = Math.max(1, Math.max(ref.w || 1, ref.h || 1) * 0.72);
      else if (s.kind === 'vessel') r = 0.45 + (ref.def?.length || 1) * 0.55;
      else r = 0.5 * (ref.scale || 1) * (ref.def?.size || 1) + 0.25;
      r *= 1 + Math.sin(this.t * 3.2) * 0.04;
      this.sel.circle(ref.x, ref.z, r);
      this.sel.build(Math.max(0.06, lineW * 0.85), lift, g.world.surfaceAt(ref.x, ref.z), s.kind === 'building' ? 0.8 : 0.25);
      // the hidden part of the ring stays bright so it reads through foliage
      this.sel.style(this.gold, 1, this.t, 3, 0.18, 0.72, 0.75 + Math.sin(this.t * 4) * 0.2);
      this.sel.visible = true;
    } else this.sel.visible = false;
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
