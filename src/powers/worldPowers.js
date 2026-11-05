import { registerPower } from './registry.js';

// World-level tools (inspect etc.). UI owner may extend.
registerPower({
  id: 'inspect',
  name: 'Inspect',
  category: 'world',
  description: 'Click anything to learn about it.',
  mode: 'click',
  brush: null,
  apply: (g, c) => g.events.emit('inspect', c),
});
