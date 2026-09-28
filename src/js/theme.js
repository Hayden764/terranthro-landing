/* =========================================================================
 *  Light / dark theme
 *
 *   · follows the OS setting (prefers-color-scheme) by default, live
 *   · the toggle sets data-theme on <html> as an override, remembered in
 *     localStorage; choosing the mode the OS already uses clears the
 *     override so the site goes back to following the OS
 *   · an inline script in each page's <head> applies a stored override
 *     before first paint, so there's no flash of the wrong theme
 *   · fires `themechange` on document so the terrain can recolor
 * ========================================================================= */

const STORAGE_KEY = 'terranthro-theme';
const systemLight = window.matchMedia('(prefers-color-scheme: light)');
const root = document.documentElement;

export function currentTheme() {
  const forced = root.dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return systemLight.matches ? 'light' : 'dark';
}

function store(value) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage blocked — the choice just won't persist */ }
}

function announce() {
  document.dispatchEvent(new CustomEvent('themechange', { detail: currentTheme() }));
}

function setTheme(next) {
  const system = systemLight.matches ? 'light' : 'dark';
  if (next === system) {
    delete root.dataset.theme;
    store(null);
  } else {
    root.dataset.theme = next;
    store(next);
  }
  announce();
}

const SUN = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1"><circle cx="6" cy="6" r="2.2"/><path d="M6 .5v1.6M6 9.9v1.6M.5 6h1.6M9.9 6h1.6M2.1 2.1l1.1 1.1M8.8 8.8l1.1 1.1M2.1 9.9l1.1-1.1M8.8 3.2l1.1-1.1"/></svg>';
const MOON = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1"><path d="M10.2 7.6A4.6 4.6 0 0 1 4.4 1.8a4.6 4.6 0 1 0 5.8 5.8z"/></svg>';

export function initTheme() {
  systemLight.addEventListener('change', announce);

  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    const icon  = btn.querySelector('.nav-index');
    const label = btn.querySelector('.theme-label');

    // The button names the mode it switches *to*.
    function render() {
      const target = currentTheme() === 'dark' ? 'light' : 'dark';
      icon.innerHTML    = target === 'light' ? SUN : MOON;
      label.textContent = target === 'light' ? 'Light' : 'Dark';
    }

    btn.addEventListener('click', () => {
      setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    });
    document.addEventListener('themechange', render);
    render();
  });
}
