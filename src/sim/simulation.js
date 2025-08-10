import * as THREE from 'three';
import { activateOrb, deactivateOrb } from './pool.js';

export class Simulation {
  constructor(scene, pool, trips) {
    this.scene = scene;
    this.pool = pool;
    this.trips = trips;
    this.simulationTime = 0;
    this.playing = true;
    this.speed = 60; // seconds simulated per real second
    this.nextTripIndex = 0;
    this.activeOrbs = [];
    this.tmpV1 = new THREE.Vector3();
    this.tmpV2 = new THREE.Vector3();
    this.tmpCtrl = new THREE.Vector3();
    // Road router (if map loaded) - lazy lookup
    const mapGroup = scene.getObjectByName('NYCMap');
    this.router = mapGroup && mapGroup.userData.roadRouter ? mapGroup.userData.roadRouter : null;
  }

  resetTo(timeSec) {
    this.simulationTime = timeSec;
    // Reset active orbs
    for (const orb of this.activeOrbs) deactivateOrb(orb);
    this.activeOrbs.length = 0;
    // Find first trip index >= time
    this.nextTripIndex = this.trips.findIndex(t => t.startTime >= timeSec);
    if (this.nextTripIndex < 0) this.nextTripIndex = this.trips.length;
    // Activate all trips already in-flight
    const inFlight = this.trips.filter(t => t.startTime < timeSec && t.endTime > timeSec);
    for (const trip of inFlight) {
      const orb = this.pool.find(o => !o.userData.active);
      if (!orb) break;
  const color = trip.vendor === 1 ? 0xfff15c : 0x27ff6c;
  this.prepareTripPath(trip);
  activateOrb(orb, trip, color);
      // Set position along curve
      this.positionOrb(orb, trip, (timeSec - trip.startTime) / (trip.endTime - trip.startTime));
      this.activeOrbs.push(orb);
    }
  }

  update(dt) {
    if (this.playing) {
      this.simulationTime += dt * this.speed;
      if (this.simulationTime > 86400) this.simulationTime -= 86400; // loop day
    }

    // Activate new trips
    while (this.nextTripIndex < this.trips.length) {
      const trip = this.trips[this.nextTripIndex];
      if (trip.startTime > this.simulationTime) break;
      const orb = this.pool.find(o => !o.userData.active);
      if (!orb) break; // pool exhausted
  const color = trip.vendor === 1 ? 0xfff15c : 0x27ff6c;
  this.prepareTripPath(trip);
  activateOrb(orb, trip, color);
      this.activeOrbs.push(orb);
      this.nextTripIndex++;
    }

    // Update active ones
    for (let i = this.activeOrbs.length - 1; i >= 0; i--) {
      const orb = this.activeOrbs[i];
      const trip = orb.userData.trip;
      if (!trip) { this.activeOrbs.splice(i,1); continue; }
      const progress = (this.simulationTime - trip.startTime) / (trip.endTime - trip.startTime);
      // Trigger finish effect slightly before end to allow animation
      if (progress >= 1) {
        // ensure finish effect ran; now deactivate
        deactivateOrb(orb);
        this.activeOrbs.splice(i,1);
        continue;
      }

      // Position along path
      this.positionOrb(orb, trip, THREE.MathUtils.clamp(progress, 0, 1));

      const now = performance.now();
      const base = orb.userData.baseScale || 0.5;

      // Start pulse: expand + brighten for first N ms
      if (orb.userData.startEffectStart) {
        const t = (now - orb.userData.startEffectStart) / orb.userData.startEffectDuration;
        if (t < 1) {
          const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
          const extra = (1 + Math.sin(t * Math.PI)) * 0.35 * (1 - t);
          const scalePulse = base * (1 + extra);
          orb.scale.setScalar(scalePulse);
          // Temporarily ramp opacity
          orb.material.opacity = 0.9 - 0.25 * t;
        } else {
          orb.userData.startEffectStart = null; // finished
          orb.material.opacity = 0.65;
        }
      }

      // Finish pulse trigger when within last 6% of time and not yet started
      const remaining = 1 - progress;
      if (!orb.userData.finishing && remaining < 0.06) {
        orb.userData.finishing = true;
        orb.userData.finishEffectStart = now;
      }

      if (orb.userData.finishing && orb.userData.finishEffectStart) {
        const t = (now - orb.userData.finishEffectStart) / orb.userData.finishEffectDuration;
        if (t < 1) {
          const easeIn = t * t;
          // Grow then shrink
          const grow = Math.sin(t * Math.PI);
          orb.scale.setScalar(base * (1.0 + grow * 0.6));
          // Fade out
          orb.material.opacity = THREE.MathUtils.lerp(0.65, 0.0, easeIn);
        } else {
          // Mark trip complete next loop by forcing progress >=1
          // (Leave as very low opacity until removal)
          orb.material.opacity = 0.0;
        }
      }

      // Idle subtle pulse if no special effect active
      if (!orb.userData.startEffectStart && !orb.userData.finishing) {
        const pulse = 1 + Math.sin(now * 0.0035 + base) * 0.04;
        orb.scale.setScalar(base * pulse);
      }
    }
  }

  prepareTripPath(trip) {
    if (trip._path) return; // already prepared
    // Build route along roads if router exists; fallback: straight line
    if (this.router) {
      const start = new THREE.Vector3(trip.startPos.x, 0.02, trip.startPos.z);
      const end = new THREE.Vector3(trip.endPos.x, 0.02, trip.endPos.z);
      const path = this.router.route(start, end);
      if (path && path.length >= 2) {
        // Precompute cumulative lengths
        let total = 0;
        const segLengths = [];
        for (let i=0;i<path.length-1;i++) { const d = path[i].distanceTo(path[i+1]); segLengths.push(d); total += d; }
        trip._path = path;
        trip._segLengths = segLengths;
        trip._totalLength = total || start.distanceTo(end);
        return;
      }
    }
    // Fallback straight path
    trip._path = [new THREE.Vector3(trip.startPos.x,0.02,trip.startPos.z), new THREE.Vector3(trip.endPos.x,0.02,trip.endPos.z)];
    trip._segLengths = [trip._path[0].distanceTo(trip._path[1])];
    trip._totalLength = trip._segLengths[0];
  }

  positionOrb(orb, trip, t) {
    this.prepareTripPath(trip);
    const path = trip._path;
    if (!path || path.length < 2) return;
    // Distance along path based on linear progress in time (could adjust for realistic speed distributions later)
    const targetDist = t * trip._totalLength;
    let acc = 0;
    for (let i=0;i<path.length-1;i++) {
      const segLen = trip._segLengths[i];
      if (acc + segLen >= targetDist) {
        const localT = (targetDist - acc) / segLen;
        orb.position.lerpVectors(path[i], path[i+1], localT);
        // lock y near ground with minimal jitter
        orb.position.y = 0.12; // constant ground offset
        return;
      }
      acc += segLen;
    }
    // End fallback
    const last = path[path.length-1];
    orb.position.copy(last);
    orb.position.y = 0.12;
  }
}
