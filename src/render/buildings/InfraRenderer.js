import * as THREE from 'three';
import { SEA_LEVEL } from '../../world/constants.js';

// PLACEHOLDER drawing of the modern infrastructure (docs/MODERN-ERAS.md)
// until the Buildings renderer gives it models: rail lines as dark lines
// beside the roads, maglev lines raised on thin pillars, power lines strung
// between pylons. Highways need nothing here (they are laid road tiles).
// Reads game.civ.railLines() and game.civ.powerLines(); rebuilds when
// civ.infraVersion changes. Three draw calls at most.
const RAIL_Y = 0.07;
const MAGLEV_Y = 0.85;
const WIRE_Y = 1.55;

export class InfraRenderer {
  constructor(game) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.name = 'civ-infrastructure';
    game.scene.add(this.group);
    this.mats = {
      rail: new THREE.LineBasicMaterial({ color: 0x3b2f28 }),
      maglev: new THREE.LineBasicMaterial({ color: 0xe8f4f8 }),
      wire: new THREE.LineBasicMaterial({ color: 0x2a2c30, transparent: true, opacity: 0.85 }),
    };
    this.lines = {};
    this._ver = -1;
    this._hver = 0;
    game.events.on('world:height', () => this._hver++);
  }

  reset() {
    this._ver = -1;
  }

  _ground(x, z) {
    return Math.max(this.game.world.heightAt(x, z), SEA_LEVEL + 0.12);
  }

  _set(key, pts) {
    let L = this.lines[key];
    if (!pts.length) {
      if (L) L.visible = false;
      return;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.computeBoundingSphere();
    if (!L) {
      L = this.lines[key] = new THREE.LineSegments(geo, this.mats[key]);
      L.frustumCulled = true;
      this.group.add(L);
    } else {
      L.geometry.dispose();
      L.geometry = geo;
    }
    L.visible = true;
  }

  _rebuild() {
    const civ = this.game.civ;
    const rail = [],
      mag = [],
      wire = [];
    for (const l of civ.railLines?.() || []) {
      const P = l.pts;
      if (!P || P.length < 4) continue;
      const elevated = l.kind === 'maglev';
      const out = elevated ? mag : rail;
      // the rails run a little to one side of the road they follow
      for (let i = 0; i + 3 < P.length; i += 2) {
        const ax = P[i],
          az = P[i + 1],
          bx = P[i + 2],
          bz = P[i + 3];
        const dx = bx - ax,
          dz = bz - az;
        const L = Math.hypot(dx, dz) || 1;
        const ox = (-dz / L) * 0.45,
          oz = (dx / L) * 0.45;
        const ya = this._ground(ax + ox, az + oz) + (elevated ? MAGLEV_Y : RAIL_Y),
          yb = this._ground(bx + ox, bz + oz) + (elevated ? MAGLEV_Y : RAIL_Y);
        out.push(ax + ox, ya, az + oz, bx + ox, yb, bz + oz);
        // maglev pillars every few points
        if (elevated && (i / 2) % 3 === 0) out.push(ax + ox, ya, az + oz, ax + ox, ya - MAGLEV_Y, az + oz);
      }
    }
    for (const l of civ.powerLines?.() || []) {
      const P = [l.pts[0], l.pts[1], ...(l.pylons || []), l.pts[2], l.pts[3]];
      for (let i = 0; i + 3 < P.length; i += 2) {
        const ax = P[i],
          az = P[i + 1],
          bx = P[i + 2],
          bz = P[i + 3];
        const ya = this._ground(ax, az) + WIRE_Y,
          yb = this._ground(bx, bz) + WIRE_Y;
        // a sagging wire in two spans, and the pylon under its far end
        const mx = (ax + bx) / 2,
          mz = (az + bz) / 2,
          my = (ya + yb) / 2 - 0.25;
        wire.push(ax, ya, az, mx, my, mz, mx, my, mz, bx, yb, bz);
        if (i + 4 < P.length) wire.push(bx, yb, bz, bx, yb - WIRE_Y, bz);
      }
    }
    this._set('rail', rail);
    this._set('maglev', mag);
    this._set('wire', wire);
  }

  update() {
    const civ = this.game.civ;
    if (!civ) return;
    const v = (civ.infraVersion || 0) * 1000 + this._hver;
    if (v === this._ver) return;
    this._ver = v;
    this._rebuild();
  }
}
