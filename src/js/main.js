import { initTerrain } from './terrain.js';
import { initChrome }  from './chrome.js';
import { initTheme }   from './theme.js';

initTheme();

const canvas  = document.getElementById('terrain');
const terrain = initTerrain(canvas);
initChrome({ terrainState: terrain.state });
