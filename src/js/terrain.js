/* =========================================================================
 *  Wireframe DEM · Three.js
 *
 *  Mesh:
 *   · plane displaced by layered simplex noise (idle "breathing")
 *   · cursor radial bulge (raycast → ground, smoothstep falloff)
 *   · per-vertex color tint toward electric-blue at peak heights
 *
 *  Camera (orbit · yaw + pitch):
 *   · parallax mode  — yaw/pitch follow cursor by a small amount (default)
 *   · drag mode      — pointerdown + drag rotates the camera around scene
 *   · drift mode     — after IDLE_THRESHOLD_MS, slow ellipse orbit on its own
 *
 *  Exposes a mutable `state` object so chrome.js can read live yaw for the
 *  bottom-center BEARING compass readout.
 * ========================================================================= */

import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';

/* ── Visual tokens ─────────────────────────────────────────────────────── */
const COLOR_BORDER = 0x1A1D28;
const COLOR_PEAK   = 0x2E9BFF;
const COLOR_INK    = 0x080A0F;

/* ── Mesh ──────────────────────────────────────────────────────────────── */
const SIZE          = 60;
const SEGMENTS      = 96;
const NOISE_SCALE   = 0.10;
const NOISE_SCALE_2 = 0.28;
const NOISE_AMP     = 1.6;
const NOISE_AMP_2   = 0.45;
const TIME_SCALE    = 0.00018;

const CURSOR_RADIUS = 12;
const CURSOR_BUMP   = 2.4;

/* ── Camera (orbit) ────────────────────────────────────────────────────── */
const ORBIT_RADIUS  = 17;        // distance from look-at
const DEFAULT_YAW   = 0;
const DEFAULT_PITCH = 0.595;     // ~34° above horizon (matches old hard-coded look)

const PARALLAX_YAW   = 0.18;     // ±10° when cursor is in a corner
const PARALLAX_PITCH = 0.08;     // ±4.5°

const PITCH_MIN = 0.15;          // ~9° (don't dip below the mesh)
const PITCH_MAX = 1.20;          // ~69° (don't go straight overhead)

const DRAG_YAW_RATE   = 0.005;   // rad per pixel
const DRAG_PITCH_RATE = 0.003;

const IDLE_THRESHOLD_MS = 6000;
const DRIFT_FREQ_RAD_S  = 0.10;  // rad/s on the slow axis
const DRIFT_YAW_AMP     = 0.40;  // ±23°
const DRIFT_PITCH_AMP   = 0.10;  // ±5.7°

/* ── Helpers ───────────────────────────────────────────────────────────── */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smoothstep = (t) => t * t * (3 - 2 * t);

/* ───────────────────────────────────────────────────────────────────────── */

export function initTerrain(canvas) {
  const noise2D = createNoise2D();

  /* ── Renderer / scene / camera ─────────────────────────────────────── */
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(COLOR_INK, 1);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(COLOR_INK, 18, 36);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);

  /* ── Geometry ──────────────────────────────────────────────────────── */
  const geometry = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  const vertCount = positions.count;

  const colors = new Float32Array(vertCount * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const baseColor = new THREE.Color(COLOR_BORDER);
  const peakColor = new THREE.Color(COLOR_PEAK);
  const tmpColor  = new THREE.Color();
  for (let i = 0; i < vertCount; i++) {
    colors[i * 3]     = baseColor.r;
    colors[i * 3 + 1] = baseColor.g;
    colors[i * 3 + 2] = baseColor.b;
  }

  const material = new THREE.MeshBasicMaterial({
    wireframe: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  // Cache vertex x/z (these never change — only y is animated).
  const xs = new Float32Array(vertCount);
  const zs = new Float32Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    xs[i] = positions.getX(i);
    zs[i] = positions.getZ(i);
  }

  /* ── Mouse state ───────────────────────────────────────────────────── */
  // Normalized device coordinates (-1..1) and a smoothed copy.
  const mouseNDC       = new THREE.Vector2(0, 0);
  const mouseSmoothNDC = new THREE.Vector2(0, 0);

  /* ── Camera state ──────────────────────────────────────────────────── */
  // Currently-applied angles, eased toward target each frame.
  let yaw         = DEFAULT_YAW;
  let pitch       = DEFAULT_PITCH;
  let targetYaw   = DEFAULT_YAW;
  let targetPitch = DEFAULT_PITCH;

  // Drag state.
  let isDragging      = false;
  let dragStartX      = 0;
  let dragStartY      = 0;
  let dragStartYaw    = 0;
  let dragStartPitch  = 0;

  // Idle / drift state.
  let lastInputT      = performance.now();
  let driftPhaseStart = 0;

  // Externally-readable state (chrome.js reads `state.yaw`).
  const state = {
    yaw:        DEFAULT_YAW,
    pitch:      DEFAULT_PITCH,
    isDragging: false,
    isDrifting: false,
  };

  /* ── Raycaster (cursor → ground plane) ─────────────────────────────── */
  const raycaster   = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint    = new THREE.Vector3();
  const cursorWorld = new THREE.Vector2(0, 0);   // (x, z) on the ground

  /* ── Input handlers ────────────────────────────────────────────────── */
  function isInteractive(target) {
    if (!target || !target.closest) return false;
    return !!target.closest('a, button, .wordmark');
  }

  function onPointerMove(e) {
    mouseNDC.x =  (e.clientX / window.innerWidth)  * 2 - 1;
    mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
    lastInputT = performance.now();

    if (isDragging) {
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      targetYaw   = dragStartYaw   + dx * DRAG_YAW_RATE;
      targetPitch = clamp(dragStartPitch - dy * DRAG_PITCH_RATE, PITCH_MIN, PITCH_MAX);
    }
  }

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (isInteractive(e.target)) return;
    isDragging      = true;
    state.isDragging = true;
    dragStartX      = e.clientX;
    dragStartY      = e.clientY;
    dragStartYaw    = yaw;
    dragStartPitch  = pitch;
    lastInputT      = performance.now();
    document.body.classList.add('is-dragging');
  }

  function onPointerUp() {
    if (!isDragging) return;
    isDragging       = false;
    state.isDragging = false;
    lastInputT       = performance.now();
    document.body.classList.remove('is-dragging');
  }

  window.addEventListener('pointermove',   onPointerMove, { passive: true });
  window.addEventListener('pointerdown',   onPointerDown);
  window.addEventListener('pointerup',     onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);

  /* ── Resize ────────────────────────────────────────────────────────── */
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // Initial camera placement so the first frame looks right.
  applyCameraFromAngles();

  /* ── Camera math ───────────────────────────────────────────────────── */
  function applyCameraFromAngles() {
    const cosP = Math.cos(pitch);
    camera.position.x = ORBIT_RADIUS * cosP * Math.sin(yaw);
    camera.position.y = ORBIT_RADIUS * Math.sin(pitch);
    camera.position.z = ORBIT_RADIUS * cosP * Math.cos(yaw);
    camera.lookAt(0, 0, 0);
  }

  /* ── Animate ───────────────────────────────────────────────────────── */
  // Color-blend thresholds (world-space y).
  const PEAK_LO = 0.4;
  const PEAK_HI = 1.9;

  let frameId = 0;
  let lastT   = performance.now();

  function animate(now) {
    const dt = Math.min(64, now - lastT);  // clamp delta on tab-resume
    lastT = now;
    const t = now * TIME_SCALE;

    /* Smooth NDC for terrain bulge & parallax. */
    const k = 1 - Math.pow(0.001, dt / 1000);   // frame-rate-independent ease (~0.06 @ 60fps)
    mouseSmoothNDC.x += (mouseNDC.x - mouseSmoothNDC.x) * k;
    mouseSmoothNDC.y += (mouseNDC.y - mouseSmoothNDC.y) * k;

    /* Decide camera target by mode. */
    const idleMs = now - lastInputT;

    if (isDragging) {
      // targetYaw / targetPitch already set by the move handler.
      state.isDrifting = false;
      driftPhaseStart  = 0;
    } else if (idleMs > IDLE_THRESHOLD_MS) {
      // Drift mode — slow ellipse orbit.
      if (driftPhaseStart === 0) driftPhaseStart = now;
      const driftT = (now - driftPhaseStart) * 0.001 * DRIFT_FREQ_RAD_S;
      targetYaw   = DEFAULT_YAW   + Math.sin(driftT)         * DRIFT_YAW_AMP;
      targetPitch = DEFAULT_PITCH + Math.cos(driftT * 0.7)   * DRIFT_PITCH_AMP;
      state.isDrifting = true;
    } else {
      // Parallax mode — small cursor-driven offset from defaults.
      driftPhaseStart  = 0;
      state.isDrifting = false;
      targetYaw   = DEFAULT_YAW   + mouseSmoothNDC.x * PARALLAX_YAW;
      targetPitch = DEFAULT_PITCH + mouseSmoothNDC.y * PARALLAX_PITCH;
    }

    // Ease current angles toward target.
    yaw   += (targetYaw   - yaw)   * k;
    pitch += (targetPitch - pitch) * k;

    /* Apply to camera so the raycast below uses fresh matrices. */
    applyCameraFromAngles();
    camera.updateMatrixWorld();

    /* Cursor → ground intersection (proper world position of the cursor). */
    raycaster.setFromCamera(mouseNDC, camera);
    const hit = raycaster.ray.intersectPlane(groundPlane, hitPoint);
    if (hit) {
      cursorWorld.x = hitPoint.x;
      cursorWorld.y = hitPoint.z;     // store z in .y for 2D distance
    }
    // While dragging, fade the bulge out (avoid weird pulls during orbit).
    const bumpStrength = isDragging ? 0 : CURSOR_BUMP;
    const cursorR2     = CURSOR_RADIUS * CURSOR_RADIUS;

    /* Update vertex y + color. */
    for (let i = 0; i < vertCount; i++) {
      const x = xs[i];
      const z = zs[i];

      // Layered noise — slow primary + faster detail.
      const n1 = noise2D(x * NOISE_SCALE   + t,       z * NOISE_SCALE   + t * 0.6);
      const n2 = noise2D(x * NOISE_SCALE_2 + t * 1.4, z * NOISE_SCALE_2 - t * 0.9);
      let y = n1 * NOISE_AMP + n2 * NOISE_AMP_2;

      // Cursor radial bulge.
      if (bumpStrength > 0) {
        const dx = x - cursorWorld.x;
        const dz = z - cursorWorld.y;
        const d2 = dx * dx + dz * dz;
        if (d2 < cursorR2) {
          const f = 1 - Math.sqrt(d2) / CURSOR_RADIUS;
          y += smoothstep(f) * bumpStrength;
        }
      }

      positions.setY(i, y);

      // Height → blend toward peak color.
      let heightT = (y - PEAK_LO) / (PEAK_HI - PEAK_LO);
      if (heightT < 0) heightT = 0;
      else if (heightT > 1) heightT = 1;
      const blend = heightT * 0.7;
      tmpColor.copy(baseColor).lerp(peakColor, blend);
      const ci = i * 3;
      colors[ci]     = tmpColor.r;
      colors[ci + 1] = tmpColor.g;
      colors[ci + 2] = tmpColor.b;
    }
    positions.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;

    /* Publish state for chrome readouts. */
    state.yaw   = yaw;
    state.pitch = pitch;

    renderer.render(scene, camera);
    frameId = requestAnimationFrame(animate);
  }
  frameId = requestAnimationFrame(animate);

  /* ── Reduced motion · render one quiet frame, no loop ──────────────── */
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  function applyReducedMotion() {
    if (!reduce.matches) return;
    cancelAnimationFrame(frameId);
    for (let i = 0; i < vertCount; i++) {
      const y =
        noise2D(xs[i] * NOISE_SCALE,   zs[i] * NOISE_SCALE)   * NOISE_AMP +
        noise2D(xs[i] * NOISE_SCALE_2, zs[i] * NOISE_SCALE_2) * NOISE_AMP_2;
      positions.setY(i, y);
    }
    positions.needsUpdate = true;
    yaw = DEFAULT_YAW;
    pitch = DEFAULT_PITCH;
    applyCameraFromAngles();
    state.yaw = yaw;
    state.pitch = pitch;
    renderer.render(scene, camera);
  }
  reduce.addEventListener('change', applyReducedMotion);
  applyReducedMotion();

  /* ── Public API ────────────────────────────────────────────────────── */
  return {
    state,
    dispose() {
      cancelAnimationFrame(frameId);
      window.removeEventListener('pointermove',   onPointerMove);
      window.removeEventListener('pointerdown',   onPointerDown);
      window.removeEventListener('pointerup',     onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('resize',        resize);
      reduce.removeEventListener('change',        applyReducedMotion);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };
}
