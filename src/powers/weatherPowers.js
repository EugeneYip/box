import { registerPower } from './registry.js';

// Weather powers (owned by Atmosphere). Baseline: none yet beyond a toggle.
registerPower({
  id: 'weather-rain',
  name: 'Rain',
  category: 'world',
  description: 'Summon rain clouds over the world.',
  mode: 'click',
  brush: null,
  apply: (g) => {
    const w = g.env.weather;
    if (w.type === 'rain') { w.type = 'clear'; w.intensity = 0; }
    else { w.type = 'rain'; w.intensity = 1; }
  },
});
