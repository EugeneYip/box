// Minimal synchronous event bus shared by every module (game.events).
//
// Well-known events (payloads in braces):
//   'world:height'  {x0,y0,x1,y1}  heights changed in this inclusive tile rect
//   'world:type'    {x0,y0,x1,y1}  surface types changed
//   'world:flora'   {x0,y0,x1,y1}  vegetation changed
//   'world:owner'   {x0,y0,x1,y1}  territory ownership changed
//   'world:fire'    {x0,y0,x1,y1}  fire intensity changed
//   'world:regenerated' {}         the whole world was regenerated / loaded
//   'unit:spawn'    {unit}         'unit:death' {unit, cause}
//   'power:select'  {power}        'power:apply' {power, x, z, tx, ty, radius}
//   'notify'        {text, kind, x?, z?}  kind: 'info'|'good'|'bad'|'war'|'disaster'
//   'speed'         {speed, paused}
export class Events {
  constructor() {
    this._map = new Map();
  }
  on(name, fn) {
    let set = this._map.get(name);
    if (!set) this._map.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }
  once(name, fn) {
    const off = this.on(name, (p) => {
      off();
      fn(p);
    });
    return off;
  }
  off(name, fn) {
    this._map.get(name)?.delete(fn);
  }
  emit(name, payload) {
    const set = this._map.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] handler for "${name}" threw`, err);
      }
    }
  }
}
