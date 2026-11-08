import * as THREE from 'three';

// Instanced "rigid rig" material. Every creature model is one merged
// geometry whose vertices carry aRig = (bone, material, variantSlot, variantOption).
// Per-instance attributes drive the pose (16 channels) and appearance:
//   instanceMatrix  root transform (position, heading, tilt, scale)
//   iPose0..3       16 pose channels (bone rotations / scales / spine waves)
//   iCol0           colour A (rgb) + hit flash (a)
//   iCol1           colour B (rgb) + fade (a, dithered; 1 = opaque)
//   iCol2           colour C (rgb) + secondary palette index + bless glow (a = idx + glow*0.9)
//   iVar            variant options (3 slots per float, base 16); w = kingdom slot + seed
//                   (integer part indexes uKing, the shared kingdom palette; 0 = none)
// Bones are baked into the shader as constants: rigid bones rotate about a
// pivot (Z, then X, then Y, optional uniform scale); spine bones bend the mesh
// along a travelling wave (serpents, fish, wyrms). Children inherit parents.

export const NOISE = { none: 0, cloth: 1, wool: 2, fur: 3, spots: 4, stone: 5, scales: 6, counter: 7, socks: 8, feather: 9 };
const SRC = { A: 1, B: 2, C: 3, D: 4, K: 5, M: 6 };
export const MAX_MATS = 40;

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const v3 = (a) => `vec3(${f(a[0])},${f(a[1])},${f(a[2])})`;

function boneGLSL(bones) {
  const n = bones.length;
  const bp = bones.map((b) => v3(b.pivot)).join(',');
  const bc = bones.map((b) => `ivec4(${(b.ch || [-1, -1, -1, -1]).map((c) => c ?? -1).join(',')})`).join(',');
  const bk = bones
    .map((b) => (b.spine ? `vec4(1.0,${f(b.spine.k)},${f(b.spine.L)},${f(b.spine.e0)})` : 'vec4(0.0)'))
    .join(',');
  const par = bones.map((b) => String(b.parent ?? -1)).join(',');
  return `
#define RIG_NB ${n}
const vec3 RBP[RIG_NB] = vec3[RIG_NB](${bp});
const ivec4 RBC[RIG_NB] = ivec4[RIG_NB](${bc});
const vec4 RBK[RIG_NB] = vec4[RIG_NB](${bk});
const int RBPAR[RIG_NB] = int[RIG_NB](${par});
`;
}

const RIG_COMMON = /* glsl */ `
attribute vec4 aRig;
attribute vec4 iPose0;
attribute vec4 iPose1;
attribute vec4 iPose2;
attribute vec4 iPose3;
attribute vec4 iCol0;
attribute vec4 iCol1;
attribute vec4 iCol2;
attribute vec4 iVar;
float rigSlot(int s) {
  float v = s < 3 ? iVar.x : (s < 6 ? iVar.y : iVar.z);
  int k = s - (s / 3) * 3;
  float d = k == 0 ? 1.0 : (k == 1 ? 16.0 : 256.0);
  return mod(floor(v / d + 0.001), 16.0);
}
vec3 rigCurve(float s, float ph, float k, float L, float e0, float ax, float ay, float lift) {
  float env = mix(e0, 1.0, clamp(-s / L, 0.0, 1.0));
  float a = ph + k * s;
  float hl = clamp(1.0 + s / (L * 0.4), 0.0, 1.0);
  return vec3(ax * env * sin(a), ay * env * sin(a + 1.3) + lift * hl * hl, s);
}
void rigApply(inout vec3 p, inout vec3 n) {
  float P[16] = float[16](iPose0.x, iPose0.y, iPose0.z, iPose0.w, iPose1.x, iPose1.y, iPose1.z, iPose1.w,
                          iPose2.x, iPose2.y, iPose2.z, iPose2.w, iPose3.x, iPose3.y, iPose3.z, iPose3.w);
  int b = int(aRig.x + 0.5);
  for (int it = 0; it < 6; it++) {
    if (b < 0) break;
    ivec4 ch = RBC[b];
    vec4 kd = RBK[b];
    vec3 piv = RBP[b];
    vec3 q = p - piv;
    if (kd.x < 0.5) {
      if (ch.w >= 0) q *= 1.0 + P[ch.w];
      if (ch.z >= 0) { float a = P[ch.z]; float c = cos(a), s = sin(a); mat2 m = mat2(c, s, -s, c); q.xy = m * q.xy; n.xy = m * n.xy; }
      if (ch.x >= 0) { float a = P[ch.x]; float c = cos(a), s = sin(a); mat2 m = mat2(c, s, -s, c); q.yz = m * q.yz; n.yz = m * n.yz; }
      if (ch.y >= 0) { float a = P[ch.y]; float c = cos(a), s = sin(a); mat2 m = mat2(c, s, -s, c); q.zx = m * q.zx; n.zx = m * n.zx; }
      p = q + piv;
    } else {
      float ph = ch.x >= 0 ? P[ch.x] : 0.0;
      float ax = ch.y >= 0 ? P[ch.y] : 0.0;
      float ay = ch.z >= 0 ? P[ch.z] : 0.0;
      float lift = ch.w >= 0 ? P[ch.w] : 0.0;
      float s = q.z;
      vec3 c0 = rigCurve(s, ph, kd.y, kd.z, kd.w, ax, ay, lift);
      vec3 c1 = rigCurve(s + 0.03, ph, kd.y, kd.z, kd.w, ax, ay, lift);
      vec3 cm = rigCurve(s - 0.03, ph, kd.y, kd.z, kd.w, ax, ay, lift);
      vec3 T = normalize(c1 - cm);
      vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), T));
      vec3 up = cross(T, side);
      p = piv + c0 + q.x * side + q.y * up;
      n = n.x * side + n.y * up + n.z * T;
    }
    b = RBPAR[b];
  }
}
bool rigHidden() {
  if (aRig.z < -0.5) return false;
  return abs(rigSlot(int(aRig.z + 0.5)) - aRig.w) > 0.5;
}
`;

const FRAG_COMMON = /* glsl */ `
varying vec4 vFx;
float rigBayer(vec2 p) {
  ivec2 i = ivec2(mod(p, 4.0));
  int idx = i.x + i.y * 4;
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[idx] + 0.5) / 16.0;
}
`;

export function makeRigMaterial(model, opts = {}) {
  const bones = boneGLSL(model.bones);
  const mats = model.materialTable; // [{color, src, rough, metal, emissive, noise, color2, src2}]
  const uMatA = [],
    uMatB = [],
    uMatC = [];
  for (let i = 0; i < MAX_MATS; i++) {
    const m = mats[i] || {};
    const c = new THREE.Color(m.color ?? 0xff00ff).convertSRGBToLinear();
    const c2 = new THREE.Color(m.color2 ?? m.color ?? 0xff00ff).convertSRGBToLinear();
    uMatA.push(new THREE.Vector4(c.r, c.g, c.b, SRC[m.src] || 0));
    uMatB.push(new THREE.Vector4(m.rough ?? 0.75, m.metal ?? 0, m.emissive ?? 0, NOISE[m.noise] || 0));
    uMatC.push(new THREE.Vector4(c2.r, c2.g, c2.b, SRC[m.src2] || 0));
  }
  const sec = (model.secondary || [0x6b4a32]).slice(0, 8);
  while (sec.length < 8) sec.push(sec[sec.length - 1]);
  const uniforms = {
    uMatA: { value: uMatA },
    uMatB: { value: uMatB },
    uMatC: { value: uMatC },
    uSec: { value: sec.map((h) => new THREE.Color(h).convertSRGBToLinear()) },
    uAoH: { value: model.aoHeight ?? 0.12 },
    uAoMin: { value: model.aoMin ?? 0.7 },
    uRim: { value: model.rim ?? 0.16 },
    uRimCol: { value: new THREE.Color(1, 0.95, 0.85) },
    uBump: { value: model.bump ?? 1 },
    uKing: { value: Array.from({ length: 16 }, () => new THREE.Color(0.5, 0.5, 0.5)) },
    uMetal: { value: [0xc4ccd6, 0x9a6a3c, 0x9a968f, 0xc8894a, 0x8a8f98, 0xd6dde6, 0x9fd8ff, 0xf2c14e].map((h) => new THREE.Color(h).convertSRGBToLinear()) },
    uOutline: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 });
  mat.userData.rigUniforms = uniforms;
  mat.customProgramCacheKey = () => 'rig-' + model.id;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
${bones}
${RIG_COMMON}
uniform vec4 uMatA[${MAX_MATS}];
uniform vec4 uMatB[${MAX_MATS}];
uniform vec4 uMatC[${MAX_MATS}];
uniform vec3 uSec[8];
uniform vec3 uKing[16];
uniform vec3 uMetal[8];
varying vec3 vRigCol;
varying vec3 vRigCol2;
varying vec4 vRigMat;
varying vec3 vRestPos;
varying vec3 vRestN;
varying vec4 vFx;
varying vec4 vKing;
vec3 rigSrc(float src, vec3 c) {
  if (src < 0.5) return c;
  if (src < 1.5) return iCol0.rgb;
  if (src < 2.5) return iCol1.rgb;
  if (src < 3.5) return iCol2.rgb;
  if (src < 4.5) return uSec[int(mod(floor(iCol2.a + 0.001), 8.0))];
  if (src < 5.5) {
    float ks = floor(iVar.w + 0.0001);
    return ks > 0.5 ? uKing[int(ks)] : c;
  }
  // equipment material colour (packed above the variant slots of iVar.z)
  return uMetal[int(mod(floor(iVar.z / 4096.0 + 0.0001), 8.0))];
}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `vec3 objectNormal = vec3(normal);
vec3 rigPos = vec3(position);
vRestPos = position;
vRestN = normal;
rigApply(rigPos, objectNormal);
if (rigHidden()) rigPos = vec3(0.0, -60.0, 0.0);
int rmi = int(aRig.y + 0.5);
vec4 rma = uMatA[rmi];
vec4 rmc = uMatC[rmi];
vRigCol = rigSrc(rma.w, rma.rgb);
vRigCol2 = rigSrc(rmc.w, rmc.rgb);
vRigMat = uMatB[rmi];
if (rma.w > 5.5 && floor(iVar.z / 4096.0 + 0.0001) > 5.5) vRigMat.z += 1.1; // starsteel glows
float rks = floor(iVar.w + 0.0001);
vKing = rks > 0.5 ? vec4(uKing[int(rks)], 1.0) : vec4(0.0);
vFx = vec4(iCol0.a, iCol1.a, fract(iVar.w), fract(iCol2.a) / 0.9);`,
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = rigPos;');

    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${FRAG_COMMON}
varying vec3 vRigCol;
varying vec3 vRigCol2;
varying vec4 vRigMat;
varying vec3 vRestPos;
varying vec3 vRestN;
varying vec4 vKing;
uniform float uOutline;
uniform float uAoH;
uniform float uAoMin;
uniform float uRim;
uniform vec3 uRimCol;
uniform float uBump;
float rhash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float rnoise(vec3 x) {
  vec3 i = floor(x); vec3 fr = fract(x); fr = fr * fr * (3.0 - 2.0 * fr);
  return mix(mix(mix(rhash(i), rhash(i + vec3(1.0, 0.0, 0.0)), fr.x), mix(rhash(i + vec3(0.0, 1.0, 0.0)), rhash(i + vec3(1.0, 1.0, 0.0)), fr.x), fr.y),
             mix(mix(rhash(i + vec3(0.0, 0.0, 1.0)), rhash(i + vec3(1.0, 0.0, 1.0)), fr.x), mix(rhash(i + vec3(0.0, 1.0, 1.0)), rhash(i + vec3(1.0, 1.0, 1.0)), fr.x), fr.y), fr.z);
}
vec3 rigPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir) {
  vec3 vSigmaX = normalize(dFdx(surf_pos));
  vec3 vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm);
  vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDir;
  vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(fDet) * surf_norm - vGrad);
}`,
      )
      .replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        `vec4 diffuseColor = vec4( diffuse, opacity );
if (vFx.y < 0.999 && vFx.y < rigBayer(gl_FragCoord.xy)) discard;`,
      )
      .replace(
        '#include <color_fragment>',
        `vec3 rc = vRigCol;
float rnt = vRigMat.w;
vec3 rp = vRestPos + vFx.z * 13.0;
float rigBumpH = 0.0;
if (rnt > 0.5) {
  if (rnt < 1.5) { float n = rnoise(rp * 70.0); rc *= 0.92 + 0.12 * n; rigBumpH = n * 0.0015; }
  else if (rnt < 2.5) { float n = rnoise(rp * 34.0) * 0.6 + rnoise(rp * 85.0) * 0.4; rc *= 0.78 + 0.3 * n; rigBumpH = n * 0.012; }
  else if (rnt < 3.5) { float n = rnoise(rp * vec3(110.0, 36.0, 36.0)); rc *= 0.88 + 0.18 * n; rigBumpH = n * 0.002; }
  else if (rnt < 4.5) { float n = rnoise(rp * 8.0) * 0.7 + rnoise(rp * 21.0) * 0.3; rc = mix(rc, vRigCol2, smoothstep(0.53, 0.58, n)); }
  else if (rnt < 5.5) { float n = rnoise(rp * 7.0) * 0.55 + rnoise(rp * 26.0) * 0.45; rc *= 0.72 + 0.4 * n; rigBumpH = n * 0.05; }
  else if (rnt < 6.5) { vec2 sp = vec2(rp.x * 26.0 + rp.y * 14.0, rp.z * 22.0); float n = abs(sin(sp.x) * sin(sp.y)); rc *= 0.8 + 0.28 * n; rigBumpH = n * 0.01; rc = mix(vRigCol2, rc, smoothstep(-0.55, 0.1, vRestN.y)); }
  else if (rnt < 7.5) { float t = smoothstep(-0.5, 0.2, vRestN.y); rc = mix(vRigCol2, rc, t); float n = rnoise(rp * vec3(100.0, 34.0, 34.0)); rc *= 0.9 + 0.14 * n; rigBumpH = n * 0.0015; }
  else if (rnt < 8.5) { rc = mix(vRigCol2, rc, smoothstep(0.05, 0.1, vRestPos.y)); }
  else { float n = rnoise(rp * vec3(40.0, 120.0, 40.0)); rc *= 0.9 + 0.15 * n; rigBumpH = n * 0.002; }
}
rc *= mix(uAoMin, 1.0, smoothstep(0.0, uAoH, vRestPos.y));
rc = mix(rc, vec3(1.0, 0.25, 0.2), vFx.x * 0.55);
diffuseColor.rgb *= rc;`,
      )
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRigMat.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRigMat.y;')
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
normal = rigPerturb(-vViewPosition, normal, vec2(dFdx(rigBumpH), dFdy(rigBumpH)) * uBump * 40.0, faceDirection);`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float rndv = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
float rrim = pow(1.0 - rndv, 3.0);
totalEmissiveRadiance += vRigCol * vRigMat.z;
// readability outline: a kingdom-coloured (or warm) rim that strengthens with distance
vec3 rimC = mix(uRimCol, vKing.rgb * 1.5 + 0.12, vKing.a);
float rimW = pow(1.0 - rndv, 2.2);
totalEmissiveRadiance += uRimCol * rrim * uRim;
totalEmissiveRadiance += rimC * rimW * uOutline * (0.35 + 0.85 * vKing.a);
totalEmissiveRadiance += vec3(1.0, 0.72, 0.22) * vFx.w * (0.18 + 1.1 * rrim);
totalEmissiveRadiance += vec3(0.9, 0.1, 0.04) * vFx.x * 0.5;`,
      );
  };

  // Shadow-casting depth material running the same rig.
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.customProgramCacheKey = () => 'rigdepth-' + model.id;
  depth.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
${bones}
${RIG_COMMON}
varying vec4 vFx;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 rigN = vec3(normal);
vec3 transformed = vec3(position);
rigApply(transformed, rigN);
if (rigHidden()) transformed = vec3(0.0, -60.0, 0.0);
vFx = vec4(iCol0.a, iCol1.a, fract(iVar.w), 0.0);`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_COMMON}`)
      .replace('void main() {', `void main() {\n  if (vFx.y < 0.999 && vFx.y < rigBayer(gl_FragCoord.xy)) discard;`);
  };
  return { material: mat, depth, uniforms };
}
