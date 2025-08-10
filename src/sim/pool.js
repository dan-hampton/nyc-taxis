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
  orb.scale.setScalar(s);
  orb.material.color.set(color);
  orb.material.opacity = 0.65;
  // Start effect metadata
  const now = performance.now();
  orb.userData.startEffectStart = now;
  orb.userData.startEffectDuration = 800; // ms
  orb.userData.finishing = false;
  orb.userData.finishEffectStart = null;
  orb.userData.finishEffectDuration = 700; // ms
  orb.userData.originalColor = orb.material.color.clone();
}

export function deactivateOrb(orb) {
  orb.visible = false;
  orb.userData.active = false;
  orb.userData.trip = null;
  orb.userData.baseScale = 0.4;
}
