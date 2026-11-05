import { registerPower } from './registry.js';

// Weather powers (owned by Atmosphere). Each one summons a weather spell over
// the whole world through game.atmosphere.setWeather(); clicking the active
// weather again clears the skies. Spells last a few in-game minutes, then
// auto weather (if enabled) takes over again.

const SPELL_SECONDS = 150;

function summon(g, type, intensity, notice) {
  const atm = g.atmosphere;
  if (!atm?.setWeather) return;
  const current = atm.weather?.type;
  if (current === type && type !== 'clear') {
    atm.setWeather('clear', 0, null);
    g.notify?.('The skies clear.', 'info');
    return;
  }
  atm.setWeather(type, intensity, type === 'clear' ? null : SPELL_SECONDS);
  if (notice) g.notify?.(notice, 'info');
}

registerPower({
  id: 'weather-rain',
  name: 'Rain',
  category: 'world',
  description: 'Gather rain clouds over the world. Rain soaks the land and dampens fires.',
  mode: 'click',
  brush: null,
  apply: (g) => summon(g, 'rain', 0.85, 'Rain clouds gather.'),
});

registerPower({
  id: 'weather-storm',
  name: 'Thunderstorm',
  category: 'world',
  description: 'Unleash a thunderstorm: driving rain, gales and lightning.',
  mode: 'click',
  brush: null,
  apply: (g) => summon(g, 'storm', 1, 'A thunderstorm rolls in.'),
});

registerPower({
  id: 'weather-snow',
  name: 'Snowfall',
  category: 'world',
  description: 'Let snow drift down over the land.',
  mode: 'click',
  brush: null,
  apply: (g) => summon(g, 'snow', 0.9, 'Snow begins to fall.'),
});

registerPower({
  id: 'weather-fog',
  name: 'Mist',
  category: 'world',
  description: 'Roll a thick ground mist through the valleys.',
  mode: 'click',
  brush: null,
  apply: (g) => summon(g, 'fog', 1, 'A heavy mist rolls in.'),
});

registerPower({
  id: 'weather-clear',
  name: 'Clear Skies',
  category: 'world',
  description: 'Part the clouds and bring back fair weather.',
  mode: 'click',
  brush: null,
  apply: (g) => summon(g, 'clear', 0, 'The skies clear.'),
});
