// Plague: a contagious sickness among humanoids. Infection state lives in
// unit.data.plague = {t, severity, prevColor}. Infected units lose health
// over time, may recover, and pass the disease to humanoids nearby. While
// sick a unit is tinted (unit.color, a public renderer hint) and trails a
// sickly green miasma (visuals emitted from Disasters.frame).

const SPREAD_RADIUS = 1.8;
const SICK_TINT = 0x9cc25a;

export class PlagueSim {
  constructor(game) {
    this.game = game;
    this.infected = new Set();
    this.rng = game.rng.fork('plague');
    this.total = 0;
    this.deaths = 0;
    game.events.on('unit:death', ({ unit, cause }) => {
      if (unit && unit.data?.plague) {
        this.infected.delete(unit);
        if (cause === 'plague') this.deaths++;
        try {
          game.fx?.emit('miasma', { x: unit.x, z: unit.z }, { count: 4, scale: 1.2 });
          game.fx?.emit('death', { x: unit.x, z: unit.z }, { color: 0x8aa040 });
        } catch (e) {
          /* visuals are best-effort */
        }
      }
    });
  }

  reset() {
    this.infected.clear();
    this.total = 0;
    this.deaths = 0;
  }

  canCatch(u) {
    return u && u.alive && u.def && u.def.kind === 'humanoid' && !u.data?.plague && !(u.data?.plagueImmune > this.game.time.total);
  }

  infect(u, severity = 1) {
    if (!this.canCatch(u)) return false;
    u.data = u.data || {};
    u.data.plague = { t: 0, severity, prevColor: u.color ?? null };
    u.color = SICK_TINT;
    this.infected.add(u);
    this.total++;
    return true;
  }

  cure(u) {
    const p = u.data?.plague;
    if (!p) return;
    u.color = p.prevColor;
    delete u.data.plague;
    u.data.plagueImmune = this.game.time.total + 120;
    this.infected.delete(u);
    try {
      this.game.fx?.emit('heal', { x: u.x, z: u.z }, { scale: 0.7 });
    } catch (e) {
      /* ignore */
    }
  }

  infectArea(x, z, r) {
    let n = 0;
    const units = this.game.units?.query?.(x, z, r) || [];
    for (const u of units) if (this.infect(u, 1)) n++;
    return n;
  }

  tick(step) {
    if (!this.infected.size) return;
    const g = this.game;
    const rng = this.rng;
    for (const u of [...this.infected]) {
      if (!u.alive) {
        this.infected.delete(u);
        continue;
      }
      const p = u.data.plague;
      if (!p) {
        this.infected.delete(u);
        continue;
      }
      p.t += step;
      // incubation, then sickness worsens
      const dps = p.t < 3 ? 0.2 : 1.1 * p.severity * Math.min(1.6, 0.6 + p.t / 25);
      u.hp -= dps * step;
      u.lastHurt = g.time.total;
      if (u.hp <= 0) {
        g.units.kill(u, 'plague');
        continue;
      }
      // recovery chance after the crisis
      if (p.t > 18 && rng.next() < step * 0.035) {
        this.cure(u);
        continue;
      }
      // contagion
      if (rng.next() < step * 1.4) {
        const near = g.units.query(u.x, u.z, SPREAD_RADIUS);
        for (const o of near) {
          if (o !== u && this.canCatch(o) && rng.next() < 0.35) this.infect(o, Math.max(0.6, p.severity * (0.85 + rng.next() * 0.3)));
        }
      }
    }
  }
}
