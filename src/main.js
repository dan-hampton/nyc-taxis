import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { loadTrips } from './data/loadTrips.js';
import { loadNYCMap } from './scene/map.js';
import { createPool } from './sim/pool.js';
import { Simulation } from './sim/simulation.js';

const canvas = document.getElementById('bg');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.autoClear = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color('#00000a');

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(1.77, 25.49, -10.27);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 15;
controls.maxDistance = 300;
controls.target.set(-1.34, 0.17, -12.09);
controls.update();

// Ambient feel
scene.add(new THREE.AmbientLight(0x18224a, 1.2));

// Post-processing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// Softer bloom to prevent oversized halos around trip orbs
// const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.9, 0.6, 0.18);
// bloom.threshold = 0.22; // raise threshold so only the brightest cores bloom
// bloom.strength = 0.78;  // lower strength
// bloom.radius = 0.48;    // tighter halo
// composer.addPass(bloom);
// composer.addPass(new FilmPass(0.25, 0.35, 648, false));
if (renderer.getPixelRatio() === 1) composer.addPass(new SMAAPass(window.innerWidth, window.innerHeight));

// Vignette pass (screen-space)
const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, offset: { value: 0.82 }, darkness: { value: 1.25 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */`varying vec2 vUv; uniform sampler2D tDiffuse; uniform float offset; uniform float darkness; void main(){ vec4 c=texture2D(tDiffuse,vUv); float dist = distance(vUv, vec2(0.5)); float vig = smoothstep(offset, 0.95, dist); c.rgb *= mix(1.0, 1.0 - darkness*0.35, vig); gl_FragColor=c; }`
};
composer.addPass(new ShaderPass(VignetteShader));

// HUD elements
const clockEl = document.getElementById('clock');
const speedIndicatorEl = document.getElementById('speedIndicator');
const speedValueEl = document.getElementById('speedValue');
const tripCounterEl = document.getElementById('tripCounter');
const tripsStartedEl = document.getElementById('tripsStarted');
const tripsActiveEl = document.getElementById('tripsActive');
const tripsCompletedEl = document.getElementById('tripsCompleted');
const fareTotalValueEl = document.getElementById('fareTotalValue');
const slider = document.getElementById('timeline');
const playPauseBtn = document.getElementById('playPause');
const speedSel = document.getElementById('speed');
const tooltip = document.getElementById('tooltip');
const coverageSlider = document.getElementById('coverage');
const coverageValueEl = document.getElementById('coverageValue');

let simulation; // will hold Simulation instance
let mapGroup; // reference to NYCMap group for heat layer
let tripsCompleted = 0;
let lastActiveIds = new Set();
let totalFare = 0; // accumulated fare of completed trips

function formatTime(sec) {
  sec = Math.max(0, Math.floor(sec) % 86400);
  const h = String(Math.floor(sec / 3600)).padStart(2,'0');
  const m = String(Math.floor(sec % 3600 / 60)).padStart(2,'0');
  const s = String(Math.floor(sec % 60)).padStart(2,'0');
  return `${h}:${m}:${s}`;
}

function formatDate(date) {
  // Returns YYYY-MM-DD
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

// Raycaster for interaction
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoverOrb = null;
let hoverScaleBoost = 1.25;

function onPointerMove(e) {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
}
window.addEventListener('pointermove', onPointerMove);

let tooltipTimeout = null;

function showTripTooltip(orb, clientX, clientY) {
  const trip = orb.userData.trip;
  if (!trip) return;
  const fare = trip.fare.toFixed(2);
  // Only update content and position if not already showing for this orb
  if (tooltip.dataset.tripId !== String(trip.id)) {
    tooltip.innerHTML = `<h4>Trip</h4><b>Fare:</b> $${fare}<br><b>Passengers:</b> ${trip.passengers}<br><b>Start:</b> ${formatTime(trip.startTime)}<br><b>End:</b> ${formatTime(trip.endTime)}<br><b>Vendor:</b> ${trip.vendor}`;
    tooltip.style.left = clientX + 'px';
    tooltip.style.top = clientY + 'px';
    tooltip.dataset.tripId = String(trip.id);
  }
  tooltip.hidden = false;
  tooltip.classList.remove('fade-in', 'fade-out');
  void tooltip.offsetWidth;
  tooltip.classList.add('fade-in');
  if (tooltipTimeout) clearTimeout(tooltipTimeout);
  tooltipTimeout = setTimeout(() => {
    tooltip.classList.remove('fade-in');
    tooltip.classList.add('fade-out');
    setTimeout(() => {
      tooltip.hidden = true;
      tooltip.classList.remove('fade-out');
      tooltip.dataset.tripId = '';
    }, 200); // match fadeOut duration
  }, 1000);
}

// Remove click-based tooltip
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') tooltip.hidden = true; });

playPauseBtn.addEventListener('click', () => {
  if (!simulation) return;
  simulation.playing = !simulation.playing;
  playPauseBtn.textContent = simulation.playing ? 'Pause' : 'Play';
  playPauseBtn.setAttribute('aria-pressed', simulation.playing);
});

slider.addEventListener('input', () => {
  if (!simulation) return;
  if (!simulation.trips || simulation.trips.length === 0) return;
  const minTime = simulation.trips[0].startTime;
  const maxTime = simulation.trips[simulation.trips.length-1].endTime;
  let t = Number(slider.value);
  if (t < minTime) t = minTime;
  if (t > maxTime) t = maxTime;
  simulation.resetTo(t);
});

speedSel.addEventListener('change', () => {
  if (!simulation) return;
  simulation.userSpeed = Number(speedSel.value);
  if (!simulation.gapAccelActive) simulation.speed = simulation.userSpeed;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// Global status bar and setStatus
const statusId = 'init-status';
let statusEl = document.getElementById(statusId);
if (!statusEl) {
  statusEl = document.createElement('div');
  statusEl.id = statusId;
  statusEl.style.position='absolute';
  statusEl.style.top='8px';
  statusEl.style.right='12px';
  statusEl.style.padding='4px 8px';
  statusEl.style.background='rgba(0,0,0,0.55)';
  statusEl.style.font='12px/1.2 monospace';
  statusEl.style.color='#8ff';
  statusEl.style.zIndex='9999';
  statusEl.style.pointerEvents='none';
  document.body.appendChild(statusEl);
}
function setStatus(m) {
  statusEl.textContent = m;
  statusEl.style.transition = '';
  statusEl.style.opacity = '1';
  if (setStatus._timeout) clearTimeout(setStatus._timeout);
  setStatus._timeout = setTimeout(() => {
    statusEl.style.transition = 'opacity 0.5s';
    statusEl.style.opacity = '0';
    // Do NOT remove statusEl from DOM, just fade out
  }, 2500);
}

async function init() {
  // Debug: Show camera and pan position in status bar every second
  // setInterval(() => {
  //   const pos = camera.position;
  //   const tgt = controls.target;
  //   setStatus(
  //     `Camera: (${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}) | Pan: (${tgt.x.toFixed(2)}, ${tgt.y.toFixed(2)}, ${tgt.z.toFixed(2)})`
  //   );
  // }, 1000);
  try {
    setStatus('Loading map...');
  mapGroup = await loadNYCMap(scene, { coverageFactor: coverageSlider ? Number(coverageSlider.value) : 1 });
    // Build road filter panel once map & roads loaded
    if (mapGroup && mapGroup.userData && mapGroup.userData.roadTypes) {
      const container = document.getElementById('roadFilters');
      if (container) {
        container.innerHTML = '';
        const makeLabel = (type) => type.charAt(0).toUpperCase()+type.slice(1);
        for (const rt of mapGroup.userData.roadTypes) {
          const id = 'rf_' + rt.type;
          const wrap = document.createElement('label');
          wrap.htmlFor = id;
          wrap.title = 'Toggle ' + rt.type + ' roads';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.id = id;
          cb.checked = rt.enabled;
          cb.addEventListener('change', () => {
            if (mapGroup.userData.toggleRoadType) {
              mapGroup.userData.toggleRoadType(rt.type, cb.checked);
              // Invalidate cached paths for future trips (existing paths remain)
              if (simulation && simulation.trips) {
                for (const trip of simulation.trips) {
                  // Only clear if trip not yet started
                  if (!trip._started) {
                    delete trip._path; delete trip._segLengths; delete trip._totalLength;
                  }
                }
              }
            }
          });
          wrap.appendChild(cb);
          const span = document.createElement('span');
          span.textContent = makeLabel(rt.type);
          wrap.appendChild(span);
          container.appendChild(wrap);
        }
      }
    }
    setStatus('Loading trips...');
    let trips = [];
    try {
      trips = await loadTrips();
    } catch (e) {
      console.error('Trip load failed:', e);
      setStatus('Trip load failed; using empty set');
      trips = [];
    }
    // Convert per-day relative start/end (seconds since that day's midnight) into a single
    // continuous absolute timeline measured in seconds from the first trip's midnight.
    // This preserves chronological ordering across multiple days and fixes the issue where
    // re-sorting purely by startTime (seconds-of-day) jumbled dates.
    if (Array.isArray(trips) && trips.length > 0) {
      // Base midnight
      const baseMidnight = new Date(trips[0].pickupDate);
      baseMidnight.setHours(0,0,0,0);
      const baseMs = baseMidnight.getTime();
      for (const trip of trips) {
        const duration = trip.endTime - trip.startTime; // original same-day duration
        // Absolute seconds from base midnight
        const absStart = (trip.pickupTimestamp - baseMs) / 1000;
        trip.startTime = absStart;
        trip.endTime = absStart + duration;
      }
      trips.sort((a,b) => a.startTime - b.startTime);
    }
  setStatus('Allocating pool...');
  const pool = createPool(trips.length);
  pool.forEach(o => scene.add(o));
    setStatus('Starting simulation...');
  simulation = new Simulation(scene, pool, trips);
  // Initialize slider to exact first trip start time so UI reflects simulation baseline immediately
  if (trips.length) {
    const firstStart = Math.floor(trips[0].startTime);
    const lastEnd = Math.floor(trips[trips.length - 1].endTime);
    slider.min = firstStart;
    slider.max = lastEnd;
    slider.value = firstStart;
    // Pre-populate clock once (animate will keep updating)
    if (trips[0].pickupDate instanceof Date && !isNaN(trips[0].pickupDate)) {
      clockEl.textContent = `${formatDate(trips[0].pickupDate)} ${formatTime(firstStart)}`;
    } else {
      clockEl.textContent = formatTime(firstStart);
    }
  }
  setStatus('Simulation running');
  setStatus('Mouse: Camera angle, +SHIFT key to pan');
  } catch (e) {
    console.error('Init failed', e);
    setStatus('Init error: ' + e.message);
  }
}

let last = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = (now - last) / 1000; // seconds
  last = now;
  if (simulation) {
  simulation.update(dt, camera);
    // Show date and time in the clock panel with monotonic date logic
    if (simulation.trips && simulation.trips.length > 0 && typeof simulation.simulationTime === 'number') {
      const tripsArr = simulation.trips;
      const simT = simulation.simulationTime;
      const firstStart = tripsArr[0].startTime;
      const lastEnd = tripsArr[tripsArr.length - 1].endTime;
      if (simT >= firstStart && firstStart > 0) {
        // Binary search for last trip with startTime <= simT
        let lo = 0, hi = tripsArr.length - 1, best = 0;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
            if (tripsArr[mid].startTime <= simT) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
        }
        const tripDate = tripsArr[best].pickupDate;
        const dateStr2 = (tripDate instanceof Date && !isNaN(tripDate)) ? formatDate(tripDate) : '';
        clockEl.textContent = dateStr2 ? `${dateStr2} ${formatTime(simT)}` : formatTime(simT);
        // Update slider bounds once per animation frame (cheap) – assumes sorted
        slider.min = Math.floor(firstStart);
        slider.max = Math.floor(lastEnd);
        slider.value = Math.floor(simT);
      } else {
        clockEl.textContent = '';
        slider.value = 0;
      }
    }

    // --- Trip counter logic (from simulation) ---
    const activeCount = simulation.activeOrbs.length;
    if (tripsStartedEl) tripsStartedEl.textContent = simulation.startedCount;
    if (tripsActiveEl) tripsActiveEl.textContent = activeCount;
    if (tripsCompletedEl) tripsCompletedEl.textContent = simulation.completedCount;

    // Fare complete status for newly completed trips (iterate all; per-trip flag prevents repeats)
    if (simulation.trips && simulation.trips.length) {
      for (const trip of simulation.trips) {
        if (!trip._fareAnnounced && trip.endTime <= simulation.simulationTime) {
          trip._fareAnnounced = true;
          const fareNum = (typeof trip.fare === 'number') ? trip.fare : 0;
          totalFare += fareNum;
          if (fareTotalValueEl) fareTotalValueEl.textContent = totalFare.toFixed(2);
          const address = trip.destinationLabel || trip.dropoffAddress || trip.dropoff || 'Trip End';
          const cost = fareNum.toFixed(2);
          setStatus(`Dropoff: ${address} - $${cost}`);
        }
      }
    }

    // Update speed indicator
    if (simulation.gapAccelActive && speedIndicatorEl && speedValueEl) {
      speedIndicatorEl.hidden = false;
      speedValueEl.textContent = Math.round(simulation.speed);
    } else if (speedIndicatorEl && speedValueEl) {
      // Always visible: just update speed value, never hide
      speedValueEl.textContent = Math.round(simulation.speed);
    }
    // Heatmap update disabled (trails off)
    // if (mapGroup && mapGroup.userData.heat) { mapGroup.userData.heat.update(simulation.activeOrbs); }
  }

  // Hover detection (respect ongoing start/finish effects)
  if (simulation) {
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(simulation.activeOrbs, false);
    if (intersects.length) {
      const first = intersects[0].object;
      if (hoverOrb !== first) {
        if (hoverOrb) {
          if (!hoverOrb.userData.startEffectStart && !hoverOrb.userData.finishing) {
            hoverOrb.scale.setScalar(hoverOrb.userData.baseScale);
          }
        }
        hoverOrb = first;
        if (!hoverOrb.userData.startEffectStart && !hoverOrb.userData.finishing) {
          hoverOrb.scale.setScalar(hoverOrb.userData.baseScale * hoverScaleBoost);
        }
        // Show tooltip on hover
        showTripTooltip(hoverOrb, mouse.x * window.innerWidth / 2 + window.innerWidth / 2, -mouse.y * window.innerHeight / 2 + window.innerHeight / 2);
      } else {
        if (!hoverOrb.userData.startEffectStart && !hoverOrb.userData.finishing) {
          hoverOrb.scale.setScalar(hoverOrb.userData.baseScale * hoverScaleBoost);
        }
      }
    } else if (hoverOrb) {
      if (!hoverOrb.userData.startEffectStart && !hoverOrb.userData.finishing) {
        hoverOrb.scale.setScalar(hoverOrb.userData.baseScale);
      }
      hoverOrb = null;
      // Don't hide tooltip immediately; let timeout handle it
      // Only clear timeout if a new hover starts
    }
  }

  controls.update();
  composer.render();
}

init();
animate();

// Coverage slider logic: rebuild map when changed (debounced)
if (coverageSlider) {
  let covTimer = null;
  const applyCoverage = () => {
    if (coverageValueEl) coverageValueEl.textContent = Math.round(Number(coverageSlider.value)*100)+'%';
    if (mapGroup && mapGroup.userData && mapGroup.userData.setCoverageFactor) {
      mapGroup.userData.setCoverageFactor(Number(coverageSlider.value));
      if (simulation && mapGroup.userData.roadRouter) {
        simulation.router = mapGroup.userData.roadRouter;
      }
    }
  };
  coverageSlider.addEventListener('input', () => {
    if (coverageValueEl) coverageValueEl.textContent = Math.round(Number(coverageSlider.value)*100)+'%';
    if (covTimer) clearTimeout(covTimer);
    covTimer = setTimeout(applyCoverage, 80); // lighter debounce for incremental pruning
  });
}
