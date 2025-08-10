import * as THREE from 'three';

export function createPool(size = 600) {
  const pool = [];
  const geom = new THREE.SphereGeometry(0.25, 12, 12);
  for (let i = 0; i < size; i++) {
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffaa, transparent: true, opacity: 0.55 });
    const m = new THREE.Mesh(geom, mat);
    m.visible = false;
    m.userData.active = false;
    pool.push(m);
  }
  return pool;
}

export function activateOrb(orb, trip, color) {
  orb.visible = true;
  orb.userData.active = true;
  orb.userData.trip = trip;
  orb.position.set(trip.startPos.x, 0.0, trip.startPos.z);
  const s = Math.max(0.35, Math.log10(trip.fare + 1) * 0.45 + 0.15);
  orb.userData.baseScale = s;
  // Start effect: begin tiny and flash
  orb.scale.setScalar(s * 0.05); // tiny seed
  orb.material.color.set(0xffffff); // start flash white
  orb.material.opacity = 1.0;
  const now = performance.now();
  orb.userData.spawnTime = now;
  orb.userData.startDuration = 500; // ms
  orb.userData.finishDuration = 500; // ms
  orb.userData.finishStarted = false;
  orb.userData.finishStart = 0;
  orb.userData.intendedColor = new THREE.Color(color);
}

export function deactivateOrb(orb) {
  orb.visible = false;
  orb.userData.active = false;
  orb.userData.trip = null;
  orb.userData.baseScale = 0.4;
}
