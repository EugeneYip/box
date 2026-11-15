// Real realms on the North America map (Alaska and Canada to Panama and the
// Caribbean), most important first.
import { country } from './countries.js';

export default [
  country('united-states'),
  country('canada'),
  country('mexico', { extra: [['La Paz', -110.31, 24.14]] }),
  country('cuba'),
  country('guatemala'),
  country('honduras'),
  country('nicaragua'),
  country('panama'),
  country('costa-rica'),
  country('el-salvador'),
  country('belize'),
  country('dominican-republic'),
  country('haiti'),
  country('jamaica'),
  country('bahamas'),
  country('puerto-rico'),
  country('greenland'),
  country('colombia', { edge: true, first: ['Barranquilla', 'Cartagena', 'Santa Marta', 'Riohacha', 'Montería', 'Medellín'] }),
  country('venezuela', { edge: true }),
];
