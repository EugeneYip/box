import * as THREE from 'three';

// Cheap per-creature overlays, each a single instanced draw call:
//   - ground decals: soft contact shadows, far-zoom LOD dots, selection ring
//   - water decals: expanding ripples around swimmers / serpents / fish jumps
//   - emotes: camera-facing status icons (heart, zzz, !, anger, sparkle, ...)
//   - projectiles (arrows) and the skywyrm's fire-breath plume
export const DECAL = { shadow: 0, ring: 1, select: 2, dot: 3, glow: 4 };
export const EMOTE = { heart: 0, zzz: 1, alert: 2, anger: 3, sparkle: 4, note: 5, chat: 6, skull: 7, burning: 8, sick: 9, chilled: 10, starving: 11, wounded: 12, mourning: 13, inspired: 14, exhausted: 15 };

const decalVert = /* glsl */ `
attribute vec4 iA; // x y z size
attribute vec4 iB; // nx ny nz kind
attribute vec4 iC; // r g b alpha
attribute vec4 iD; // extra (time, ...)
varying vec2 vUv;
varying vec4 vC;
varying float vKind;
varying vec4 vD;
void main() {
  vec3 n = normalize(iB.xyz);
  vec3 t = normalize(cross(n, vec3(0.0, 0.0, 1.0)));
  vec3 b = cross(t, n);
  vec3 p = iA.xyz + (t * position.x + b * position.y) * iA.w + n * 0.018;
  vUv = position.xy * 2.0;
  vC = iC;
  vKind = iB.w;
  vD = iD;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const decalFrag = /* glsl */ `
varying vec2 vUv;
varying vec4 vC;
varying float vKind;
varying vec4 vD;
uniform float uTime;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float a = 0.0;
  vec3 col = vC.rgb;
  if (vKind < 0.5) {
    a = pow(1.0 - smoothstep(0.0, 1.0, r), 1.6);
  } else if (vKind < 1.5) {
    float w = 0.09 + vD.x * 0.08;
    a = smoothstep(w, 0.0, abs(r - 0.82)) * (1.0 - smoothstep(0.95, 1.0, r));
  } else if (vKind < 2.5) {
    float ring = smoothstep(0.07, 0.0, abs(r - 0.78));
    float glow = (1.0 - smoothstep(0.0, 0.85, r)) * 0.35;
    float ang = atan(vUv.y, vUv.x);
    float dash = 0.65 + 0.35 * step(0.0, sin(ang * 8.0 + uTime * 2.0));
    a = ring * dash + glow;
  } else if (vKind < 3.5) {
    float edge = smoothstep(1.0, 0.82, r);
    col = mix(col * 0.45, col, smoothstep(0.86, 0.6, r));
    a = edge;
  } else {
    a = pow(1.0 - smoothstep(0.0, 1.0, r), 2.0);
  }
  gl_FragColor = vec4(col, a * vC.a);
  #include <colorspace_fragment>
}`;

class DecalLayer {
  constructor(scene, cap, renderOrder, blending = THREE.NormalBlending) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setIndex([0, 2, 1, 0, 3, 2]);
    this.geo = geo;
    this.uniforms = { uTime: { value: 0 } };
    this.mat = new THREE.ShaderMaterial({
      vertexShader: decalVert,
      fragmentShader: decalFrag,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'units:decals';
    scene.add(this.mesh);
    this._alloc(cap);
    this.n = 0;
  }
  _alloc(cap) {
    const mk = (old) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      if (old) a.array.set(old.array.subarray(0, Math.min(old.array.length, a.array.length)));
      return a;
    };
    const g = this.geo;
    for (const k of ['iA', 'iB', 'iC', 'iD']) g.setAttribute(k, mk(g.attributes[k]));
    this.cap = cap;
    this.A = g.attributes.iA.array;
    this.B = g.attributes.iB.array;
    this.C = g.attributes.iC.array;
    this.D = g.attributes.iD.array;
  }
  begin() {
    this.n = 0;
  }
  add(x, y, z, size, nx, ny, nz, kind, r, g, b, a, d0 = 0) {
    if (this.n >= this.cap) this._alloc(this.cap * 2);
    const j = this.n++ * 4;
    this.A[j] = x;
    this.A[j + 1] = y;
    this.A[j + 2] = z;
    this.A[j + 3] = size;
    this.B[j] = nx;
    this.B[j + 1] = ny;
    this.B[j + 2] = nz;
    this.B[j + 3] = kind;
    this.C[j] = r;
    this.C[j + 1] = g;
    this.C[j + 2] = b;
    this.C[j + 3] = a;
    this.D[j] = d0;
  }
  end(time) {
    this.uniforms.uTime.value = time;
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    for (const k of ['iA', 'iB', 'iC', 'iD']) {
      const at = this.geo.attributes[k];
      at.clearUpdateRanges();
      at.addUpdateRange(0, Math.max(4, this.n * 4));
      at.needsUpdate = true;
    }
  }
}

// ---- emote atlas (canvas-drawn, 4 x 2 icons) ------------------------------
function drawAtlas() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S * 8;
  cv.height = S * 2;
  const g = cv.getContext('2d');
  const cell = (i, fn) => {
    g.save();
    g.translate((i % 8) * S + S / 2, Math.floor(i / 8) * S + S / 2);
    fn();
    g.restore();
  };
  const outline = (fill, stroke = 'rgba(40,24,20,0.85)', w = 9) => {
    g.lineJoin = 'round';
    g.lineWidth = w;
    g.strokeStyle = stroke;
    g.stroke();
    g.fillStyle = fill;
    g.fill();
  };
  const heart = (s) => {
    g.beginPath();
    g.moveTo(0, 0.85 * s);
    g.bezierCurveTo(-1.25 * s, 0.05 * s, -0.85 * s, -0.95 * s, 0, -0.42 * s);
    g.bezierCurveTo(0.85 * s, -0.95 * s, 1.25 * s, 0.05 * s, 0, 0.85 * s);
    g.closePath();
  };
  cell(EMOTE.heart, () => {
    heart(44);
    outline('#ff5a7a');
    heart(44);
    g.save();
    g.clip();
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.beginPath();
    g.ellipse(-16, -14, 10, 6, -0.6, 0, Math.PI * 2);
    g.fill();
    g.restore();
  });
  const text = (t, size, fill, x = 0, y = 0) => {
    g.font = `900 ${size}px "Inter Variable", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = size * 0.2;
    g.strokeStyle = 'rgba(30,30,60,0.85)';
    g.strokeText(t, x, y);
    g.fillStyle = fill;
    g.fillText(t, x, y);
  };
  cell(EMOTE.zzz, () => {
    text('z', 40, '#dfe8ff', -24, 22);
    text('z', 52, '#eef3ff', 4, -2);
    text('Z', 64, '#ffffff', 28, -30);
  });
  const bubble = (fill) => {
    g.beginPath();
    g.arc(0, -6, 46, 0, Math.PI * 2);
    g.moveTo(-14, 34);
    g.lineTo(-6, 58);
    g.lineTo(10, 36);
    outline(fill);
  };
  cell(EMOTE.alert, () => {
    bubble('#ffd23a');
    text('!', 66, '#ffffff', 0, -4);
  });
  cell(EMOTE.anger, () => {
    g.strokeStyle = 'rgba(60,10,10,0.9)';
    g.lineCap = 'round';
    const vein = (w, col) => {
      g.lineWidth = w;
      g.strokeStyle = col;
      for (let i = 0; i < 4; i++) {
        g.save();
        g.rotate((i * Math.PI) / 2 + Math.PI / 4);
        g.beginPath();
        g.moveTo(10, -10);
        g.quadraticCurveTo(26, -8, 38, -26);
        g.moveTo(10, 10);
        g.quadraticCurveTo(26, 8, 38, 26);
        g.stroke();
        g.restore();
      }
    };
    vein(22, 'rgba(60,10,10,0.9)');
    vein(12, '#ff3a2a');
  });
  cell(EMOTE.sparkle, () => {
    const star = (r, x, y) => {
      g.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rr = i % 2 ? r * 0.28 : r;
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      g.closePath();
    };
    star(48, 0, 4);
    outline('#ffe27a', 'rgba(120,70,10,0.8)', 7);
    star(20, 34, -34);
    outline('#fff6c8', 'rgba(120,70,10,0.8)', 5);
  });
  cell(EMOTE.note, () => {
    text('♪', 92, '#bfe8ff', 0, 4);
  });
  cell(EMOTE.chat, () => {
    g.beginPath();
    g.roundRect(-50, -40, 100, 70, 26);
    g.moveTo(-16, 28);
    g.lineTo(-24, 52);
    g.lineTo(6, 30);
    outline('#ffffff');
    g.fillStyle = '#5a6478';
    for (const x of [-24, 0, 24]) {
      g.beginPath();
      g.arc(x, -5, 8, 0, Math.PI * 2);
      g.fill();
    }
  });
  cell(EMOTE.skull, () => {
    g.beginPath();
    g.arc(0, -10, 38, 0, Math.PI * 2);
    g.roundRect(-22, 10, 44, 34, 8);
    outline('#f2eee6');
    g.fillStyle = '#2a2020';
    for (const x of [-15, 15]) {
      g.beginPath();
      g.arc(x, -8, 10, 0, Math.PI * 2);
      g.fill();
    }
  });
  // ---- status icons
  const disc = (fill) => {
    g.beginPath();
    g.arc(0, 0, 50, 0, Math.PI * 2);
    outline(fill, 'rgba(30,24,30,0.85)', 8);
  };
  cell(EMOTE.burning, () => {
    const flame = (s, c) => {
      g.beginPath();
      g.moveTo(0, 48 * s);
      g.bezierCurveTo(-40 * s, 40 * s, -38 * s, -6 * s, -6 * s, -50 * s);
      g.bezierCurveTo(-4 * s, -22 * s, 14 * s, -20 * s, 16 * s, -36 * s);
      g.bezierCurveTo(44 * s, -4 * s, 40 * s, 40 * s, 0, 48 * s);
      outline(c, 'rgba(80,20,0,0.85)', 8 * s);
    };
    flame(1, '#ff7a1a');
    flame(0.55, '#ffe04a');
  });
  cell(EMOTE.sick, () => {
    g.beginPath();
    g.moveTo(0, -52);
    g.bezierCurveTo(30, -14, 40, 6, 40, 20);
    g.arc(0, 20, 40, 0, Math.PI);
    g.bezierCurveTo(-40, 6, -30, -14, 0, -52);
    outline('#8fd24a', 'rgba(30,60,10,0.9)', 9);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath();
    g.ellipse(-14, 14, 7, 12, 0.3, 0, Math.PI * 2);
    g.fill();
  });
  cell(EMOTE.chilled, () => {
    g.lineCap = 'round';
    for (const [w, c] of [[18, 'rgba(20,50,90,0.85)'], [9, '#d8f0ff']]) {
      g.lineWidth = w;
      g.strokeStyle = c;
      for (let i = 0; i < 3; i++) {
        g.save();
        g.rotate((i * Math.PI) / 3);
        g.beginPath();
        g.moveTo(0, -46);
        g.lineTo(0, 46);
        g.moveTo(-14, -34);
        g.lineTo(0, -22);
        g.lineTo(14, -34);
        g.moveTo(-14, 34);
        g.lineTo(0, 22);
        g.lineTo(14, 34);
        g.stroke();
        g.restore();
      }
    }
  });
  cell(EMOTE.starving, () => {
    g.beginPath();
    g.moveTo(-50, -6);
    g.lineTo(50, -6);
    g.bezierCurveTo(46, 38, -46, 38, -50, -6);
    outline('#d8a860', 'rgba(70,40,10,0.9)', 9);
    text('?', 44, '#ffffff', 0, -30);
  });
  cell(EMOTE.wounded, () => {
    disc('#ffffff');
    g.fillStyle = '#e0302a';
    g.fillRect(-12, -34, 24, 68);
    g.fillRect(-34, -12, 68, 24);
  });
  cell(EMOTE.mourning, () => {
    g.beginPath();
    g.moveTo(0, -50);
    g.bezierCurveTo(26, -10, 34, 8, 34, 22);
    g.arc(0, 22, 34, 0, Math.PI);
    g.bezierCurveTo(-34, 8, -26, -10, 0, -50);
    outline('#7fb4ff', 'rgba(20,30,70,0.9)', 9);
  });
  cell(EMOTE.inspired, () => {
    g.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = i % 2 ? 34 : 52;
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.closePath();
    outline('#ffd23a', 'rgba(120,70,10,0.85)', 7);
    g.beginPath();
    g.arc(0, 0, 24, 0, Math.PI * 2);
    g.fillStyle = '#fff2a8';
    g.fill();
  });
  cell(EMOTE.exhausted, () => {
    g.beginPath();
    g.moveTo(10, -48);
    g.bezierCurveTo(40, -6, 44, 14, 32, 30);
    g.bezierCurveTo(18, 48, -18, 44, -20, 18);
    g.bezierCurveTo(-20, -2, 0, -18, 10, -48);
    outline('#9fd4ff', 'rgba(20,40,70,0.9)', 9);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

const emoteVert = /* glsl */ `
attribute vec4 iA; // x y z size
attribute vec4 iB; // icon, alpha, rotation, -
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec4 mv = viewMatrix * vec4(iA.xyz, 1.0);
  float c = cos(iB.z), s = sin(iB.z);
  vec2 q = mat2(c, s, -s, c) * position.xy;
  mv.xy += q * iA.w;
  float icon = iB.x;
  vec2 cell = vec2(mod(icon, 8.0), floor(icon / 8.0));
  vUv = (cell + position.xy + 0.5) / vec2(8.0, 2.0);
  vUv.y = 1.0 - ((cell.y + 0.5 - position.y) / 2.0);
  vAlpha = iB.y;
  gl_Position = projectionMatrix * mv;
}`;
const emoteFrag = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying float vAlpha;
void main() {
  vec4 c = texture2D(uMap, vUv);
  if (c.a * vAlpha < 0.02) discard;
  gl_FragColor = vec4(c.rgb, c.a * vAlpha);
  #include <colorspace_fragment>
}`;

class EmoteLayer {
  constructor(scene) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      vertexShader: emoteVert,
      fragmentShader: emoteFrag,
      uniforms: { uMap: { value: drawAtlas() } },
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = 'units:emotes';
    scene.add(this.mesh);
    this._alloc(64);
    this.n = 0;
  }
  _alloc(cap) {
    for (const k of ['iA', 'iB']) {
      const old = this.geo.attributes[k];
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      if (old) a.array.set(old.array);
      this.geo.setAttribute(k, a);
    }
    this.cap = cap;
    this.A = this.geo.attributes.iA.array;
    this.B = this.geo.attributes.iB.array;
  }
  begin() {
    this.n = 0;
  }
  add(x, y, z, size, icon, alpha, rot = 0) {
    if (this.n >= this.cap) this._alloc(this.cap * 2);
    const j = this.n++ * 4;
    this.A[j] = x;
    this.A[j + 1] = y;
    this.A[j + 2] = z;
    this.A[j + 3] = size;
    this.B[j] = icon;
    this.B[j + 1] = alpha;
    this.B[j + 2] = rot;
  }
  end() {
    this.geo.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    for (const k of ['iA', 'iB']) {
      const at = this.geo.attributes[k];
      at.clearUpdateRanges();
      at.addUpdateRange(0, Math.max(4, this.n * 4));
      at.needsUpdate = true;
    }
  }
}

// ---- arrows ------------------------------------------------------------------
function arrowGeometry() {
  const parts = [];
  const shaft = new THREE.CylinderGeometry(0.006, 0.006, 0.34, 5).rotateX(Math.PI / 2);
  const head = new THREE.ConeGeometry(0.016, 0.05, 5).rotateX(Math.PI / 2).translate(0, 0, 0.19);
  const f1 = new THREE.BoxGeometry(0.002, 0.03, 0.06).translate(0, 0, -0.15);
  const f2 = new THREE.BoxGeometry(0.03, 0.002, 0.06).translate(0, 0, -0.15);
  const cols = [0x9a6a3c, 0xb8c0c8, 0xf2efe8, 0xf2efe8];
  [shaft, head, f1, f2].forEach((g, i) => {
    const gg = g.toNonIndexed();
    const c = new THREE.Color(cols[i]);
    const arr = new Float32Array(gg.attributes.position.count * 3);
    for (let k = 0; k < arr.length; k += 3) {
      arr[k] = c.r;
      arr[k + 1] = c.g;
      arr[k + 2] = c.b;
    }
    gg.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    gg.deleteAttribute('uv');
    parts.push(gg);
  });
  const out = parts[0];
  // manual merge
  const pos = [],
    nor = [],
    col = [];
  for (const p of parts) {
    pos.push(...p.attributes.position.array);
    nor.push(...p.attributes.normal.array);
    col.push(...p.attributes.color.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.dispose();
  return g;
}

// ---- fire breath plume -----------------------------------------------------
const breathVert = /* glsl */ `
varying vec2 vUv;
varying float vLen;
void main() {
  vUv = uv;
  vLen = 1.0 - uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const breathFrag = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
varying float vLen;
float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
float n2(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  float t = vLen;
  float n = n2(vec2(vUv.x * 9.0, t * 6.0 - uTime * 9.0)) * 0.6 + n2(vec2(vUv.x * 21.0, t * 14.0 - uTime * 17.0)) * 0.4;
  float a = smoothstep(0.0, 0.12, t) * (1.0 - smoothstep(0.55, 1.0, t)) * smoothstep(0.25, 0.75, n + 0.35 - t * 0.35);
  vec3 c = mix(vec3(1.0, 0.95, 0.6), vec3(1.0, 0.45, 0.08), smoothstep(0.1, 0.6, t));
  c = mix(c, vec3(0.6, 0.12, 0.04), smoothstep(0.6, 1.0, t));
  gl_FragColor = vec4(c * 2.2, a * uAlpha);
}`;

export class Overlays {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    this.ground = new DecalLayer(scene, 256, 1);
    this.water = new DecalLayer(scene, 64, 12);
    this.emotes = new EmoteLayer(scene);
    // arrows
    this.arrowMesh = new THREE.InstancedMesh(arrowGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }), 128);
    this.arrowMesh.frustumCulled = false;
    this.arrowMesh.castShadow = true;
    this.arrowMesh.count = 0;
    this.arrowMesh.name = 'units:arrows';
    scene.add(this.arrowMesh);
    // fire breath plumes (pool)
    this.breath = [];
    const cone = new THREE.ConeGeometry(0.75, 4.2, 18, 10, true).translate(0, -2.1, 0).rotateX(-Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        cone,
        new THREE.ShaderMaterial({
          vertexShader: breathVert,
          fragmentShader: breathFrag,
          uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 } },
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      );
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 15;
      scene.add(m);
      this.breath.push(m);
    }
    this._bi = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }
  begin() {
    this.ground.begin();
    this.water.begin();
    this.emotes.begin();
    this._bi = 0;
    this._ai = 0;
  }
  addArrow(x, y, z, dx, dy, dz) {
    if (this._ai >= 128) return;
    this._v.set(dx, dy, dz).normalize();
    this._q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._v);
    this._m.compose(new THREE.Vector3(x, y, z), this._q, this._s);
    this.arrowMesh.setMatrixAt(this._ai++, this._m);
  }
  addBreath(matrix, alpha, time) {
    if (this._bi >= this.breath.length) return;
    const m = this.breath[this._bi++];
    m.matrix.copy(matrix);
    m.matrixAutoUpdate = false;
    m.matrixWorldNeedsUpdate = true;
    m.material.uniforms.uTime.value = time;
    m.material.uniforms.uAlpha.value = alpha;
    m.visible = true;
  }
  end(time) {
    this.ground.end(time);
    this.water.end(time);
    this.emotes.end();
    this.arrowMesh.count = this._ai;
    if (this._ai) this.arrowMesh.instanceMatrix.needsUpdate = true;
    for (let i = this._bi; i < this.breath.length; i++) this.breath[i].visible = false;
  }
}
