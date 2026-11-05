import * as THREE from 'three';

// BASELINE implementation (to be replaced by the Atmosphere owner).
// Responsibilities: sun / moon / ambient lighting, shadows that follow the
// camera, sky, fog, day-night cycle, clouds, weather visuals (rain / snow /
// storm / lightning) and writing game.env each frame.
export class Atmosphere {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    scene.background = new THREE.Color(0x9fc6e8);
    scene.fog = new THREE.Fog(0x9fc6e8, 300, 900);

    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a4a32, 0.9);
    scene.add(this.hemi);

    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    const c = sun.shadow.camera;
    c.left = -60;
    c.right = 60;
    c.top = 60;
    c.bottom = -60;
    c.near = 1;
    c.far = 400;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;
  }

  tick() {}

  update(dt) {
    const g = this.game;
    const env = g.env;
    const hour = g.time.hour;
    const ang = ((hour - 6) / 12) * Math.PI; // 0 at 6:00, PI at 18:00
    const elev = Math.sin(ang);
    env.sunDir.set(Math.cos(ang) * 0.8, Math.max(0.05, elev), 0.45).normalize();
    env.daylight = THREE.MathUtils.smoothstep(elev, -0.1, 0.25);

    const rig = g.cameraRig;
    const span = THREE.MathUtils.clamp(rig.cur.dist * 0.9, 30, 200);
    const cam = this.sun.shadow.camera;
    cam.left = -span;
    cam.right = span;
    cam.top = span;
    cam.bottom = -span;
    cam.updateProjectionMatrix();
    this.sun.target.position.copy(rig.target);
    this.sun.position.copy(rig.target).addScaledVector(env.sunDir, 200);
    this.sun.intensity = 2.6 * env.daylight + 0.05;
    this.hemi.intensity = 0.25 + 0.7 * env.daylight;
    const sky = new THREE.Color(0x0b1424).lerp(new THREE.Color(0x9fc6e8), env.daylight);
    g.scene.background.copy(sky);
    g.scene.fog.color.copy(sky);
  }
}
