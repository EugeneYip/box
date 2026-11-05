import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/800.css';
import '@fontsource-variable/inter';
import './ui/style.css';
import { readParams } from './core/params.js';
import { Game } from './core/Game.js';

const params = readParams();
const container = document.getElementById('viewport');
const game = new Game(container, params);
window.game = game;
game.start();
// Signal to tooling that the first frames are about to render.
requestAnimationFrame(() => requestAnimationFrame(() => (window.__ready = true)));
