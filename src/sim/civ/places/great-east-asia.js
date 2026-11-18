// Real realms on the Great East Asia map (East and Southeast Asia), most
// important first. Edge realms (Russia, India, Australia) are seated at their
// first city inside the window when their capital lies outside it. Realms
// with cities that must exist at the start (`must`) are always seated; the
// ROC is seated at Taipei, its temporary capital, as on the whole Earth.
import { country } from './countries.js';

export default [
  country('mainland', { must: true }),
  country('roc', { capital: 'Taipei', must: true }),
  country('japan', { must: true }),
  country('south-korea', { must: true }),
  country('indonesia'),
  country('philippines'),
  country('vietnam'),
  country('thailand'),
  country('myanmar'),
  country('malaysia'),
  country('mongolia'),
  country('north-korea', { must: true }),
  country('laos'),
  country('cambodia'),
  country('singapore'),
  country('brunei'),
  country('timor-leste'),
  country('russia', {
    edge: true,
    first: ['Vladivostok', 'Khabarovsk', 'Yuzhno-Sakhalinsk', 'Blagoveshchensk', 'Komsomolsk-on-Amur', 'Chita', 'Ulan-Ude', 'Irkutsk', 'Nakhodka', 'Magadan', 'Petropavlovsk-Kamchatsky', 'Yakutsk', 'Bratsk', 'Kyzyl'],
  }),
  country('india', { edge: true, first: ['Guwahati', 'Kolkata', 'Imphal', 'Shillong', 'Agartala', 'Dibrugarh', 'Kohima', 'Itanagar', 'Siliguri', 'Bhubaneswar', 'Patna', 'Port Blair'] }),
  country('bangladesh'),
  country('papua-new-guinea'),
  country('bhutan'),
  country('nepal'),
  country('australia', { edge: true, first: ['Darwin', 'Katherine', 'Kununurra', 'Broome', 'Weipa', 'Cairns', 'Townsville', 'Mount Isa', 'Tennant Creek', 'Port Hedland'] }),
];
