/* =========================================================================
 *  Content pages (about, projects)
 *
 *   · same wireframe DEM as the landing, drag-to-orbit off so text stays
 *     selectable; parallax, drift and reduced-motion behave as on the landing
 *   · light/dark toggle in the header
 * ========================================================================= */

import { initTerrain } from './terrain.js';
import { initTheme }   from './theme.js';
import { initPortlandMap } from './portland-map.js';

initTheme();
initTerrain(document.getElementById('terrain'), { drag: false });
initPortlandMap(document.getElementById('portland-map'));
