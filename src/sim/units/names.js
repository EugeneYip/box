import { hashString } from '../../core/Random.js';

// Procedural, original name generator. Four syllable "tongues" are picked by
// the unit's culture string (unit.data.culture) so neighbouring kingdoms sound
// different without any hand-written name lists.
const TONGUES = [
  {
    start: ['Al', 'Bre', 'Cor', 'Da', 'El', 'Fen', 'Gar', 'Hal', 'Is', 'Jor', 'Ka', 'Lio', 'Mer', 'Nol', 'Os', 'Per', 'Ros', 'Sel', 'Tam', 'Wil'],
    mid: ['', '', 'a', 'e', 'i', 'o', 'an', 'el', 'ri', 'wy'],
    endM: ['ric', 'den', 'win', 'mund', 'bert', 'ton', 'rin', 'las', 'mar', 'ford'],
    endF: ['wen', 'na', 'lie', 'ra', 'beth', 'sa', 'lyn', 'ria', 'mae', 'dra'],
  },
  {
    start: ['Ba', 'Ki', 'Mo', 'Na', 'Ri', 'Sa', 'Ta', 'Yu', 'Ha', 'Ko', 'Mi', 'Su', 'To', 'Ze', 'Ai'],
    mid: ['', 'ka', 'ri', 'no', 'mi', 'su', 'ta', 'ra'],
    endM: ['ro', 'shi', 'ta', 'ken', 'ji', 'mon', 'do', 'zan'],
    endF: ['ko', 'mi', 'na', 'ri', 'ya', 'ne', 'sa', 'ki'],
  },
  {
    start: ['Ash', 'Bor', 'Dag', 'Ein', 'Fro', 'Grim', 'Hild', 'In', 'Kjel', 'Lof', 'Mag', 'Rag', 'Sig', 'Tor', 'Ulf', 'Ves'],
    mid: ['', '', 'a', 'e', 'i', 'ar', 'un'],
    endM: ['mund', 'rik', 'ulf', 'grim', 'bjorn', 'var', 'stein', 'dor'],
    endF: ['hild', 'dis', 'ra', 'unn', 'veig', 'run', 'frid', 'ny'],
  },
  {
    start: ['Ama', 'Bel', 'Cas', 'Dor', 'Esh', 'Far', 'Hes', 'Ira', 'Jas', 'Kal', 'Lur', 'Mir', 'Naz', 'Om', 'Qir', 'Ras', 'Sab', 'Tal', 'Zar'],
    mid: ['', 'a', 'i', 'u', 'ra', 'li', 'ha'],
    endM: ['im', 'ar', 'un', 'os', 'eth', 'ad', 'ir', 'esh'],
    endF: ['ia', 'a', 'ine', 'ah', 'iya', 'el', 'ira', 'ana'],
  },
];

function pick(arr, r) {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

export function makeName(rng, culture = null, sex = 'm') {
  const r = () => rng.next();
  const t = culture ? TONGUES[hashString(String(culture)) % TONGUES.length] : pick(TONGUES, r);
  let n = pick(t.start, r) + pick(t.mid, r) + pick(sex === 'f' ? t.endF : t.endM, r);
  n = n.replace(/(.)\1\1/g, '$1$1');
  return n.charAt(0).toUpperCase() + n.slice(1).toLowerCase();
}

const MONSTER_A = ['Grum', 'Mor', 'Thal', 'Kor', 'Vel', 'Ash', 'Bryn', 'Oss', 'Ul', 'Drav', 'Sk', 'Neth', 'Quor', 'Zeph'];
const MONSTER_B = ['hollow', 'gast', 'mire', 'thorn', 'veil', 'cinder', 'mark', 'deep', 'fang', 'crag', 'wane', 'loch'];
const TITLES = {
  golem: ['the Unmoving', 'Mossback', 'the Old Stone', 'Cairnheart', 'the Hill That Walks'],
  serpent: ['of the Deep', 'the Coiled', 'Tidebreaker', 'the Drowned Crown', 'Saltscale'],
  skywyrm: ['Ashwing', 'the Ember Sky', 'Cloudrender', 'the Kindled', 'Stormtongue'],
};

export function makeMonsterName(rng, species) {
  const r = () => rng.next();
  const n = pick(MONSTER_A, r) + pick(MONSTER_B, r);
  const titles = TITLES[species];
  return titles ? n + ' ' + pick(titles, r) : n;
}
