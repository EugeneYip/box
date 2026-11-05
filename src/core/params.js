// URL parameters (used heavily by the screenshot tooling).
//   ?seed=42            world seed
//   ?size=256           world size in tiles (square)
//   ?preset=continent   continent | pangaea | archipelago | islands
//   ?cam=x,z,dist,yaw,pitch   initial camera (yaw/pitch in degrees; pitch optional)
//   ?hour=13.5          time of day (0-24)
//   ?ff=120             fast-forward N game seconds of simulation after load
//   ?speed=1            initial game speed (0 = paused)
//   ?weather=rain       clear | rain | storm | snow | fog
//   ?ui=0               hide the HTML UI (clean screenshots)
//   ?title=0            skip the title / intro screen
//   ?quality=high       low | medium | high | ultra
//   ?audio=0            disable audio
//   ?civs=3             number of starting villages to seed (0 for none)
export function readParams() {
  const q = new URLSearchParams(location.search);
  const num = (k, d) => (q.has(k) && q.get(k) !== '' && !isNaN(+q.get(k)) ? +q.get(k) : d);
  const cam = q.has('cam') ? q.get('cam').split(',').map(Number) : null;
  return {
    seed: num('seed', Math.floor(Math.random() * 1e9)),
    seedGiven: q.has('seed'),
    size: num('size', 256),
    preset: q.get('preset') || 'continent',
    cam,
    hour: q.has('hour') ? num('hour', 10) : null,
    ff: num('ff', 0),
    speed: num('speed', 1),
    weather: q.get('weather') || null,
    ui: q.get('ui') !== '0',
    title: q.get('title') !== '0',
    quality: q.get('quality') || null,
    audio: q.get('audio') !== '0',
    civs: num('civs', 3),
    debug: q.has('debug'),
    raw: q,
  };
}
