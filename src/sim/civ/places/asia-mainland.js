// Real realms on the Asia Mainland map: the East Asian mainland only
// (docs/REGIONS.md section 4). China (the Mainland Region in the north, the
// ROC's mainland lands in the south, with its seat at Nanjing), Mongolia and
// the Korean peninsula; no island cities. Other countries' land at the edges
// is unclaimed wilderness: no realm of theirs is seeded and they name no
// places. Most important first.
import { country } from './countries.js';

export default [
  country('mainland'),
  country('roc', { drop: ['Taipei', 'Kaohsiung', 'Taichung', 'Haikou', 'Sanya'] }),
  country('south-korea', { drop: ['Jeju'] }),
  country('mongolia'),
  country('north-korea'),
];
