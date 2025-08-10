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
  orb.material.opacity = 0.70;
  // Effect state
  const now = performance.now();
  orb.userData.effect = {
    phase: 'start', // 'start' | 'idle' | 'finish'
    startTime: now,
    startDuration: 650, // ms
    finishDuration: 600,
    finished: false
  };
  // Lazy sprite flare (billboard) for pulses
  if (!orb.userData.flare) {
    const texSize = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = texSize;
    const ctx = canvas.getContext('2d');
    const grd = ctx.createRadialGradient(texSize/2, texSize/2, 0, texSize/2, texSize/2, texSize/2);
    grd.addColorStop(0,'rgba(255,255,255,1)');
    grd.addColorStop(0.25,'rgba(255,255,255,0.85)');
    grd.addColorStop(0.6,'rgba(255,255,255,0.15)');
    grd.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle = grd; ctx.fillRect(0,0,texSize,texSize);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    const sm = new THREE.SpriteMaterial({ map: tex, color: color, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending });
    const sprite = new THREE.Sprite(sm);
    sprite.scale.setScalar(s * 4); // big at peak, animated down
    sprite.position.set(0,0,0);
    orb.add(sprite);
    orb.userData.flare = sprite;
  }
  const flare = orb.userData.flare;
  flare.material.color.set(color);
  flare.material.opacity = 0.0; // will animate in update
}

export function deactivateOrb(orb) {
  orb.visible = false;
  orb.userData.active = false;
  orb.userData.trip = null;
  orb.userData.baseScale = 0.4;
}
