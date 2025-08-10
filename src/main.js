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
camera.position.set(40, 60, 40);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 15;
controls.maxDistance = 300;
controls.target.set(0, 0, 0);
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
const slider = document.getElementById('timeline');
const playPauseBtn = document.getElementById('playPause');
const speedSel = document.getElementById('speed');
const tooltip = document.getElementById('tooltip');

let simulation; // will hold Simulation instance
let mapGroup; // reference to NYCMap group for heat layer

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
  const t = Number(slider.value);
  simulation.resetTo(t);
});

speedSel.addEventListener('change', () => {
  if (!simulation) return;
  simulation.speed = Number(speedSel.value);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

async function init() {
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
    statusEl.style.zIndex='20';
    document.body.appendChild(statusEl);
  }
  const setStatus = (m) => { statusEl.textContent = m; };
  try {
    setStatus('Loading map...');
    mapGroup = await loadNYCMap(scene);
    setStatus('Loading trips...');
    let trips = [];
    try {
      trips = await loadTrips();
    } catch (e) {
      console.error('Trip load failed:', e);
      setStatus('Trip load failed; using empty set');
      trips = [];
    }
    setStatus('Allocating pool...');
    const pool = createPool(700);
    pool.forEach(o => scene.add(o));
    setStatus('Starting simulation...');
    simulation = new Simulation(scene, pool, trips);
    simulation.resetTo(0);
    setStatus('Simulation running');
    setTimeout(()=>statusEl.remove(), 4000);
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
    simulation.update(dt);
    // Show date and time in the clock panel
    let dateStr = '';
    if (simulation.trips && simulation.trips.length > 0) {
      // Find the trip whose pickup time is closest to the current simulation time
      let idx = simulation.trips.findIndex(trip => {
        return Math.floor(trip.startTime) >= Math.floor(simulation.simulationTime);
      });
      if (idx === -1) idx = simulation.trips.length - 1;
      if (idx < 0) idx = 0;
      const tripDate = simulation.trips[idx].pickupDate;
      if (tripDate instanceof Date && !isNaN(tripDate)) {
        dateStr = formatDate(tripDate);
      }
    }
    clockEl.textContent = dateStr ? `${dateStr} ${formatTime(simulation.simulationTime)}` : formatTime(simulation.simulationTime);
    slider.value = Math.floor(simulation.simulationTime);
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
