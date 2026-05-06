/* =========================================================================
 *  Instrument-panel chrome
 *
 *   · live lat/lon readout (Dundee Hills-centered fake projection)
 *   · idle GPS jitter on last decimal
 *   · local + UTC clocks
 *   · cursor crosshair via CSS vars
 *   · wordmark hover → etymology fade-in
 * ========================================================================= */

// Center the fake coordinate field on Dundee Hills, OR (a wink to WVWA).
const CENTER_LAT = 45.3418;
const CENTER_LON = -123.1854;
const SPAN_DEG   = 0.42;                  // degrees across the viewport

const IDLE_JITTER_MS = 600;               // start jittering after this idle
const JITTER_AMP_LAT = 0.00012;           // ~13 m at this latitude
const JITTER_AMP_LON = 0.00018;

export function initChrome({ terrainState } = {}) {
  const latEl         = document.getElementById('lat');
  const lonEl         = document.getElementById('lon');
  const localEl       = document.getElementById('clock-local');
  const utcEl         = document.getElementById('clock-utc');
  const wordmarkEl    = document.getElementById('wordmark');
  const etymologyEl   = document.getElementById('etymology');
  const crosshairEl   = document.getElementById('crosshair');
  const compassDegEl  = document.getElementById('compass-deg');
  const compassCardEl = document.getElementById('compass-card');

  // ── Cursor state ──────────────────────────────────────────────────────
  let cursorX = window.innerWidth / 2;
  let cursorY = window.innerHeight / 2;
  let lastMoveT = 0;                    // 0 = never moved → show defaults

  const root = document.documentElement;

  function onMove(e) {
    cursorX = e.clientX;
    cursorY = e.clientY;
    lastMoveT = performance.now();
    root.style.setProperty('--cursor-x', cursorX + 'px');
    root.style.setProperty('--cursor-y', cursorY + 'px');
    if (!crosshairEl.classList.contains('is-active')) {
      crosshairEl.classList.add('is-active');
    }
  }
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('mouseleave', () => {
    crosshairEl.classList.remove('is-active');
  });

  // ── Coordinate readout ────────────────────────────────────────────────
  function pixelToCoord(x, y) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // X → lon (left = west, right = east)
    const lon = CENTER_LON + ((x / w) - 0.5) * SPAN_DEG;
    // Y → lat (top = north, bottom = south); aspect-correct
    const aspect = h / w;
    const lat = CENTER_LAT + (0.5 - (y / h)) * SPAN_DEG * aspect;
    return { lat, lon };
  }

  function fmtCoord(value, hemi) {
    const sign = value < 0 ? -1 : 1;
    const abs = Math.abs(value);
    const dir = sign >= 0 ? hemi[0] : hemi[1];
    return abs.toFixed(4) + '° ' + dir;
  }

  function updateCoords() {
    if (lastMoveT === 0) {
      // Untouched defaults — show the center.
      latEl.textContent = fmtCoord(CENTER_LAT, ['N', 'S']);
      lonEl.textContent = fmtCoord(CENTER_LON, ['E', 'W']);
    } else {
      const idle = (performance.now() - lastMoveT) > IDLE_JITTER_MS;
      const jLat = idle ? (Math.random() - 0.5) * 2 * JITTER_AMP_LAT : 0;
      const jLon = idle ? (Math.random() - 0.5) * 2 * JITTER_AMP_LON : 0;
      const { lat, lon } = pixelToCoord(cursorX, cursorY);
      latEl.textContent = fmtCoord(lat + jLat, ['N', 'S']);
      lonEl.textContent = fmtCoord(lon + jLon, ['E', 'W']);
    }
    requestAnimationFrame(updateCoords);
  }
  updateCoords();

  // ── Dual clock (local + UTC) ──────────────────────────────────────────
  function pad(n) { return String(n).padStart(2, '0'); }

  function tickClocks() {
    const now = new Date();
    localEl.textContent =
      pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    utcEl.textContent =
      pad(now.getUTCHours()) + ':' + pad(now.getUTCMinutes()) + ':' + pad(now.getUTCSeconds());
  }
  tickClocks();
  // Align ticks to the second boundary, then 1Hz.
  const msToNextSecond = 1000 - (Date.now() % 1000);
  setTimeout(() => {
    tickClocks();
    setInterval(tickClocks, 1000);
  }, msToNextSecond);

  // ── Compass · BEARING readout (reads terrain camera yaw) ─────────────
  const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  function bearingToCardinal(deg) {
    const idx = Math.round(deg / 45) % 8;
    return CARDINALS[idx];
  }

  function tickCompass() {
    if (terrainState && compassDegEl && compassCardEl) {
      // Convert orbit yaw (rad) to a compass bearing in degrees [0, 360).
      let deg = (terrainState.yaw * 180 / Math.PI) % 360;
      if (deg < 0) deg += 360;
      const rounded = Math.round(deg) % 360;
      compassDegEl.textContent  = String(rounded).padStart(3, '0') + '°';
      compassCardEl.textContent = bearingToCardinal(rounded);
    }
    requestAnimationFrame(tickCompass);
  }
  tickCompass();

  // ── Etymology · wordmark hover ────────────────────────────────────────
  let etymTimer = null;
  function showEtymology() {
    clearTimeout(etymTimer);
    etymologyEl.classList.add('is-visible');
  }
  function hideEtymology() {
    clearTimeout(etymTimer);
    // Tiny delay so a fast bounce-off doesn't jitter the fade.
    etymTimer = setTimeout(() => {
      etymologyEl.classList.remove('is-visible');
    }, 80);
  }
  wordmarkEl.addEventListener('mouseenter', showEtymology);
  wordmarkEl.addEventListener('mouseleave', hideEtymology);
  wordmarkEl.addEventListener('focus',      showEtymology);
  wordmarkEl.addEventListener('blur',       hideEtymology);
  wordmarkEl.tabIndex = 0;
}
