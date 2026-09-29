/* =========================================================================
 *  Portland map · About page plate
 *
 *   · MapLibre over satellite imagery, with the Portland city limits as a
 *     single white outline so the city is the only thing marked
 *   · no attribution control: the plate stays clean
 *   · loaded only when the plate scrolls into view (maplibre-gl is heavy)
 *   · wheel-zoom stays off until the map is focused, so it can't trap the
 *     page scroll; the +/- buttons and keyboard always work
 * ========================================================================= */

const DATA_URL = '/data/portland.geojson';
const IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// west, south, east, north of the city limits
const BOUNDS = [[-122.837, 45.432], [-122.472, 45.653]];

async function build(el) {
  const [{ default: maplibregl }] = await Promise.all([
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ]);

  const map = new maplibregl.Map({
    container: el,
    style: {
      version: 8,
      sources: {
        imagery: { type: 'raster', tiles: [IMAGERY], tileSize: 256, maxzoom: 19 },
        portland: { type: 'geojson', data: DATA_URL },
      },
      layers: [
        { id: 'imagery', type: 'raster', source: 'imagery' },
        { id: 'city-line', type: 'line', source: 'portland',
          layout: { 'line-join': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 1 } },
      ],
    },
    bounds: BOUNDS,
    fitBoundsOptions: { padding: 24 },
    minZoom: 1,
    maxZoom: 17,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: false,
  });

  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

  // Wheel-zoom only while the map has focus or the pointer has clicked in.
  map.scrollZoom.disable();
  el.addEventListener('focusin', () => map.scrollZoom.enable());
  el.addEventListener('focusout', () => map.scrollZoom.disable());
  el.addEventListener('pointerdown', () => { map.scrollZoom.enable(); el.focus({ preventScroll: true }); });
}

export function initPortlandMap(el) {
  if (!el) return;
  el.tabIndex = 0;
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    build(el);
  }, { rootMargin: '200px' });
  io.observe(el);
}
