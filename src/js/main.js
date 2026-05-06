import { initTerrain } from './terrain.js';
import { initChrome }  from './chrome.js';

const canvas  = document.getElementById('terrain');
const terrain = initTerrain(canvas);
initChrome({ terrainState: terrain.state });
