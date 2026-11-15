// Real realms and cities for World Map worlds, by region id (contract:
// docs/REGIONS.md section 3). Each entry is a list of realms
//   { name, capital: { name, lon, lat }, cities: [{ name, lon, lat }], color?, culture?, edge? }
// most important first: a map seeds the first realms whose capitals fit, then
// a few of each realm's cities in list order. `edge: true` marks a realm at
// the window's edge that is seated at its first city inside the window when
// its capital lies outside it. `color` (hex) is matched to the nearest
// heraldic tincture; `culture` (vale | dune | frost | mire) overrides the
// culture read from the land.
import world from './world.js';
import greatEastAsia from './great-east-asia.js';
import asiaMainland from './asia-mainland.js';
import japan from './japan.js';
import taiwan from './taiwan.js';
import europe from './europe.js';
import northAmerica from './north-america.js';

export const REALMS_BY_REGION = {
  world,
  'great-east-asia': greatEastAsia,
  'asia-mainland': asiaMainland,
  japan,
  taiwan,
  europe,
  'north-america': northAmerica,
};

// The realms to seed on a map of this region, or null when there are none.
export function realmsFor(region) {
  return REALMS_BY_REGION[region] || null;
}
