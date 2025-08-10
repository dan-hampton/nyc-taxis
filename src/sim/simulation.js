import * as THREE from 'three';
import { activateOrb, deactivateOrb } from './pool.js';
import { createTextLabel } from '../utils/textLabel.js';

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
  // Auto fast-forward if there's a gap larger than this (in sim seconds)
  // AND there are no currently active trips. This keeps the visualization
  // lively by skipping dead air periods in the sparse sample dataset.
  this.fastForwardGap = 5; // configurable; user-facing control could be added later
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
    // Debug: log active orbs every ~1s (remove later)
    if (!this._dbgLast || performance.now() - this._dbgLast > 1000) {
      this._dbgLast = performance.now();
      // console.debug('Active orbs:', this.activeOrbs.length);
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
      // Create destination label sprite (simple lat/lon for now; could plug reverse geocode)
      if (!orb.userData.label) {
        let textLabel;
        // Attempt to derive nearest road name to destination
        if (this.router && this.scene) {
          const mapGroup = this.scene.getObjectByName('NYCMap');
          const idx = mapGroup && mapGroup.userData.roadIndex;
          if (idx && idx.nearestRoadName) {
            const destWorld = new THREE.Vector3(trip.endPos.x, 0.02, trip.endPos.z);
            const roadName = idx.nearestRoadName(destWorld, 4.0);
            if (roadName) textLabel = roadName;
          }
        }
        if (!textLabel) {
          const lon = trip.endPos.lon.toFixed(4);
            const lat = trip.endPos.lat.toFixed(4);
            textLabel = `${lat},${lon}`;
        }
        const label = createTextLabel(textLabel, { font: '9px monospace', color: '#bbb' });
        label.position.set(0, 0.9, 0);
        orb.add(label);
        orb.userData.label = label;
      }
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
      const remaining = 1 - progress;
      const spawnTime = orb.userData.spawnTime;
      if (spawnTime) {
        const tStart = (now - spawnTime) / orb.userData.startDuration;
        if (tStart < 1) {
          // Ease-out growth from tiny to base, color fade from white to intended
          const ease = 1 - Math.pow(1 - tStart, 3);
          orb.scale.setScalar(base * (0.05 + ease * 0.95));
          orb.material.color.copy(orb.userData.intendedColor).lerp(new THREE.Color(0xffffff), 1 - ease);
          orb.material.opacity = 1.0 - 0.3 * ease;
        } else {
          // Idle subtle pulse
          const pulse = 1 + Math.sin(now * 0.004 + base) * 0.05;
          orb.scale.setScalar(base * pulse);
          orb.material.color.copy(orb.userData.intendedColor);
          orb.material.opacity = 0.7;
          // Trigger finish if near end and not already started
          if (!orb.userData.finishStarted && remaining < 0.05) {
            orb.userData.finishStarted = true;
            orb.userData.finishStart = now;
          }
        }
      }
      if (orb.userData.finishStarted) {
        const tFin = (now - orb.userData.finishStart) / orb.userData.finishDuration;
        if (tFin < 1) {
          const easeF = Math.pow(tFin, 0.7);
          orb.scale.setScalar(base * (1 + easeF * 2.0));
          orb.material.opacity = 0.7 * (1 - easeF);
          orb.material.color.copy(orb.userData.intendedColor).offsetHSL(0.02, 0.2 * easeF, 0.15 * easeF);
        } else {
          orb.material.opacity = 0.0;
        }
      }
      // Keep label above orb (if added)
      if (orb.userData.label) {
        orb.userData.label.position.y = Math.max(0.5, orb.scale.x * 0.7 + 0.3);
        // Ensure it faces camera: handled by Sprite automatically, but avoid depth fighting
      }
    }

    // If playing, and there are no active trips, and the next trip is sufficiently far in the future,
    // jump time forward to its start so user doesn't wait through empty gaps.
    if (this.playing && this.activeOrbs.length === 0 && this.nextTripIndex < this.trips.length) {
      const nextTrip = this.trips[this.nextTripIndex];
      const gap = nextTrip.startTime - this.simulationTime;
      if (gap > this.fastForwardGap) {
        this.simulationTime = nextTrip.startTime;
        // Activate any trips starting at this new time (multiple may share the timestamp)
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
