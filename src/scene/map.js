import * as THREE from 'three';

// Utility to fetch and parse GeoJSON
async function fetchGeo(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed geo fetch ' + url);
  return res.json();
}

function projectLonLat(lon, lat, bounds, span, scale) {
  const x = ((lon - bounds.minLon) / span.lon - 0.5) * scale;
  const z = -((lat - bounds.minLat) / span.lat - 0.5) * scale;
  return new THREE.Vector3(x, 0, z);
}

function addLandmarkOutline(group, coords, color, name) {
  const shape = new THREE.Shape();
  coords.forEach(([lon, lat], i) => {
    const v = projectLonLat(lon, lat, group.userData.bounds, group.userData.span, group.userData.scale);
    if (i === 0) shape.moveTo(v.x, v.z); else shape.lineTo(v.x, v.z);
  });
  const pts = shape.getPoints(coords.length * 2);
  const geo = new THREE.BufferGeometry().setFromPoints(pts.map(p => new THREE.Vector3(p.x, 0.05, p.y)));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 });
  const line = new THREE.LineLoop(geo, mat);
  line.name = name;
  group.add(line);
}

// Create canvas-based text sprite label
function makeLabel(text, color = '#7ef', fontSize = 14) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.scale(2,2); // sharper
  ctx.font = `bold ${fontSize}px 'Helvetica Neue', Arial`;
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const gradient = ctx.createLinearGradient(0,0,0,canvas.height/2);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, '#0ff0');
  ctx.fillStyle = gradient;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.fillText(text, canvas.width/4, canvas.height/4); // because of scale(2,2)
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(20, 10, 1);
  return sprite;
}

function lonLatToXZ(lon, lat, bounds, span, scale) {
  return {
    x: ((lon - bounds.minLon) / span.lon - 0.5) * scale,
    z: -((lat - bounds.minLat) / span.lat - 0.5) * scale
  };
}

function addLabel(group, text, lon, lat, color) {
  const { bounds, span, scale } = group.userData;
  const p = lonLatToXZ(lon, lat, bounds, span, scale);
  const label = makeLabel(text, color);
  label.position.set(p.x, 1, p.z);
  label.renderOrder = 10;
  group.add(label);
  return label;
}

// Load a landmark outline from a GeoJSON file by matching feature name (or custom predicate)
async function addGeoLandmark(group, {
  url,
  name,            // feature properties.name to match (case sensitive)
  color = 0xffffff,
  label = name,    // label text (optional)
  bbox,            // optional {minLon,maxLon,minLat,maxLat} to further constrain the match
  minPoints = 40   // minimum coordinate count to treat as outer boundary
}) {
  try {
    const gj = await fetchGeo(url);
    if (!gj || !gj.features) return;
    let best = null;
    for (const f of gj.features) {
      if (!f || !f.geometry) continue;
      const props = f.properties || {};
      if (name && props.name !== name) continue;
      // Quick bbox filter based on first coord if provided
      const coordsCandidate = extractCoords(f.geometry);
      if (!coordsCandidate) continue;
      if (bbox) {
        const { minLon, maxLon, minLat, maxLat } = bbox;
        // Ensure at least one coord inside bbox
        if (!coordsCandidate.some(([lon,lat]) => lon>=minLon && lon<=maxLon && lat>=minLat && lat<=maxLat)) continue;
      }
      if (coordsCandidate.length < minPoints) continue;
      if (!best || coordsCandidate.length > best.coords.length) {
        best = { feature: f, coords: coordsCandidate };
      }
    }
    if (best) {
      // Ensure closed loop for LineString-derived outlines
      const coords = best.coords;
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) coords.push([...first]);
      addLandmarkOutline(group, coords, color, name || label || 'Landmark');
      // Derive centroid for label if not supplied explicitly
      if (label) {
        let cx = 0, cy = 0;
        coords.forEach(c => { cx += c[0]; cy += c[1]; });
        cx /= coords.length; cy /= coords.length;
        addLabel(group, label, cx, cy, '#' + color.toString(16).padStart(6,'0'));
      }
    }
  } catch(e) {
    // silent fail; landmark optional
  }
}

// Helper to flatten relevant geometry types to a single coordinate sequence (outer boundary heuristic)
function extractCoords(geom) {
  if (!geom) return null;
  const t = geom.type;
  if (t === 'LineString') return geom.coordinates.slice();
  if (t === 'Polygon') return (geom.coordinates[0]||[]).slice();
  if (t === 'MultiPolygon') {
    // choose largest ring by coordinate count
    let largest = [];
    for (const poly of geom.coordinates) {
      const ring = poly[0] || [];
      if (ring.length > largest.length) largest = ring;
    }
    return largest.slice();
  }
  if (t === 'MultiLineString') {
    let largest = [];
    for (const line of geom.coordinates) { if (line.length > largest.length) largest = line; }
    return largest.slice();
  }
  return null;
}

function buildBoroughs(group, gj) {
  const lineMat = new THREE.LineBasicMaterial({ color: 0x0de0ff, transparent: true, opacity: 0.55 });
  const fillMat = new THREE.MeshBasicMaterial({ color: 0x05070a, transparent: true, opacity: 0.55 });
  // Apply same NYC bounding box limiting as roads so we don't draw far away polygons
  const { bounds, span } = group.userData;
  const margin = 0.15;
  const minLon = bounds.minLon + margin, maxLon = bounds.minLon + span.lon - margin;
  const minLat = bounds.minLat + margin, maxLat = bounds.minLat + span.lat - margin;
  const ringWithin = (ring) => ring.some(([lon,lat]) => lon>=minLon && lon<=maxLon && lat>=minLat && lat<=maxLat);
  const pendingLabels = []; // { name, lon, lat }
  for (const f of gj.features) {
    const geom = f.geometry;
    if (!geom) continue;
    const name = (f.properties && (f.properties.boro_name || f.properties.name || f.properties.BoroName)) || null;
    if (geom.type === 'Polygon') {
      // geom.coordinates is array of rings for one polygon
      const filtered = geom.coordinates.filter(ringWithin);
      if (filtered.length) {
        drawPoly(filtered, group, lineMat, fillMat);
        if (name) {
          // Use first ring (outer boundary) for centroid
            const ring = filtered[0];
            let sx=0, sy=0; for (const [lon,lat] of ring) { sx+=lon; sy+=lat; }
            const count = ring.length || 1;
            pendingLabels.push({ name, lon: sx/count, lat: sy/count });
        }
      }
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        // each poly is array of rings
        const filtered = poly.filter(ringWithin);
        if (filtered.length) {
          drawPoly(filtered, group, lineMat, fillMat);
          if (name) {
            const ring = filtered[0];
            let sx=0, sy=0; for (const [lon,lat] of ring) { sx+=lon; sy+=lat; }
            const count = ring.length || 1;
            pendingLabels.push({ name, lon: sx/count, lat: sy/count });
          }
        }
      }
    }
  }
  // Add labels after geometry so sprites render on top
  const seen = new Set();
  for (const lbl of pendingLabels) {
    if (seen.has(lbl.name)) continue; // avoid duplicates across multipolygons
    seen.add(lbl.name);
    addLabel(group, lbl.name, lbl.lon, lbl.lat, '#7ef');
  }
}

function drawPoly(rings, group, lineMat, fillMat) {
  for (const ring of rings) {
    const shape = new THREE.Shape();
    ring.forEach(([lon, lat], i) => {
      const { bounds, span, scale } = group.userData;
      const p = lonLatToXZ(lon, lat, bounds, span, scale);
      if (i === 0) shape.moveTo(p.x, p.z); else shape.lineTo(p.x, p.z);
    });
    const points = shape.getPoints(ring.length * 1.5);
    const geo = new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(p.x, 0, p.y)));
    const line = new THREE.LineLoop(geo, lineMat);
    group.add(line);
    const fillGeo = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(fillGeo, fillMat);
    mesh.rotation.x = -Math.PI / 2;
    group.add(mesh);
  }
}

async function buildRoads(group) {
  const roadFiles = ['src/geo/roads-simplified1.geojson','src/geo/roads-simplified2.geojson','src/geo/roads-simplified3.geojson'];
  const matPrimary = new THREE.LineBasicMaterial({ color: 0x148aff, transparent: true, opacity: 0.52 });
  const matMinor = new THREE.LineBasicMaterial({ color: 0x0da0ff, transparent: true, opacity: 0.22 });
  const roadGroup = new THREE.Group();
  roadGroup.name = 'RoadLayer';
  let added = 0;
  const { bounds, span, scale } = group.userData;
  // NYC bbox for filtering
  const minLon = bounds.minLon, maxLon = bounds.minLon + span.lon;
  const minLat = bounds.minLat, maxLat = bounds.minLat + span.lat;
  // Collect polylines of THREE.Vector3 (x,y,z) for graph after loading
  const polylines = [];
  const namedPolylines = []; // { name, points:[Vector3] }
  for (const file of roadFiles) {
    try {
      const gj = await fetchGeo(file);
      for (const f of (gj.features||[])) {
  const geom = f.geometry;
        if (!geom) continue;
        const highway = (f.properties && f.properties.highway) || '';
        if (!/motorway|trunk|primary|secondary|tertiary|unclassified|residential|service/.test(highway)) continue; //residential removed
        const major = /motorway|trunk|primary|secondary/.test(highway);
  const roadName = (f.properties && f.properties.name) || '';
        // Helper to test if any coord inside bbox
        const within = (coords) => coords.some(([lon,lat]) => lon>=minLon && lon<=maxLon && lat>=minLat && lat<=maxLat);
        if (geom.type === 'LineString') {
          if (!within(geom.coordinates)) continue;
          const pts = addRoadLine(group, roadGroup, geom.coordinates, major ? matPrimary : matMinor); if (pts) { polylines.push(pts); if (roadName) namedPolylines.push({ name: roadName, points: pts }); added++; }
        } else if (geom.type === 'MultiLineString') {
          for (const seg of geom.coordinates) { if (!within(seg)) continue; const pts = addRoadLine(group, roadGroup, seg, major ? matPrimary : matMinor); if (pts) { polylines.push(pts); if (roadName) namedPolylines.push({ name: roadName, points: pts }); added++; } }
        } else if (geom.type === 'Polygon') {
          const ring = geom.coordinates[0]; if (!within(ring)) continue; const pts = addRoadLine(group, roadGroup, ring, major ? matPrimary : matMinor); if (pts) { polylines.push(pts); if (roadName) namedPolylines.push({ name: roadName, points: pts }); added++; }
        } else if (geom.type === 'MultiPolygon') {
          for (const poly of geom.coordinates) { const ring = poly[0]; if (!within(ring)) continue; const pts = addRoadLine(group, roadGroup, ring, major ? matPrimary : matMinor); if (pts) { polylines.push(pts); if (roadName) namedPolylines.push({ name: roadName, points: pts }); added++; } }
        }
      }
    } catch(e) { /* ignore */ }
  }
  console.log('[NYCMap] Roads added:', added);
  group.add(roadGroup);
  // Build routing graph & expose
  group.userData.roadRouter = buildRoadRouter(polylines);
  // Build simple nearest-road name lookup (linear scan for now)
  function nearestRoadName(worldPos, maxDist = 3.0) { // maxDist in world units
    let bestName = '';
    let bestD2 = maxDist * maxDist;
    const px = worldPos.x, pz = worldPos.z;
    for (const r of namedPolylines) {
      const pts = r.points;
      for (let i=0;i<pts.length-1;i++) {
        const a = pts[i];
        const b = pts[i+1];
        // segment distance squared in XZ plane
        const abx = b.x - a.x; const abz = b.z - a.z;
        const apx = px - a.x; const apz = pz - a.z;
        const abLen2 = abx*abx + abz*abz; if (abLen2 === 0) continue;
        let t = (apx*abx + apz*abz) / abLen2; if (t < 0) t = 0; else if (t > 1) t = 1;
        const cx = a.x + abx * t; const cz = a.z + abz * t;
        const dx = px - cx; const dz = pz - cz;
        const d2 = dx*dx + dz*dz;
        if (d2 < bestD2) { bestD2 = d2; bestName = r.name; }
      }
    }
    return bestName;
  }
  group.userData.roadIndex = { nearestRoadName };
}

function addRoadLine(rootGroup, roadGroup, coords, mat) {
  const pts = [];
  for (const [lon, lat] of coords) {
    const { bounds, span, scale } = rootGroup.userData;
    const p = lonLatToXZ(lon, lat, bounds, span, scale);
    pts.push(new THREE.Vector3(p.x, 0.02, p.z));
  }
  if (pts.length < 2) return;
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geo, mat);
  roadGroup.add(line);
  return pts;
}

// --- Road routing graph ---
function buildRoadRouter(polylines) {
  // Node dedupe precision in world units (smaller -> more nodes)
  const PREC = 0.5; // ~0.5 world units ~ small geo distance
  const nodeMap = new Map(); // key -> node
  function keyFor(x,z){ return (Math.round(x/PREC)*PREC).toFixed(2)+','+(Math.round(z/PREC)*PREC).toFixed(2); }
  function getNode(v){
    const k = keyFor(v.x, v.z);
    let n = nodeMap.get(k);
    if (!n) { n = { x: v.x, z: v.z, edges: [] }; nodeMap.set(k,n); }
    return n;
  }
  for (const line of polylines) {
    for (let i=0;i<line.length-1;i++) {
      const a = getNode(line[i]);
      const b = getNode(line[i+1]);
      if (a === b) continue;
      const dx = a.x - b.x, dz = a.z - b.z;
      const w = Math.hypot(dx,dz);
      a.edges.push({ to: b, w });
      b.edges.push({ to: a, w });
    }
  }
  const nodes = [...nodeMap.values()];
  console.log('[NYCMap] Road graph nodes:', nodes.length);
  const pathCache = new Map();
  function nearestNode(v){
    let best=null, bestD=Infinity; const vx=v.x, vz=v.z;
    for (const n of nodes){ const dx=n.x-vx, dz=n.z-vz; const d=dx*dx+dz*dz; if (d<bestD){ bestD=d; best=n; } }
    return best;
  }
  function route(start, end){
    if (!start || !end) return null;
    const k = keyFor(start.x,start.z)+'|'+keyFor(end.x,end.z);
    if (pathCache.has(k)) return pathCache.get(k);
    const s = nearestNode(start), t = nearestNode(end);
    if (!s || !t) return null;
    // Dijkstra (naive priority queue)
    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    dist.set(s,0);
    let frontier = [s];
    while (frontier.length){
      // pick node with smallest dist
      let bestI=0, bestN=frontier[0], bestD=dist.get(bestN);
      for (let i=1;i<frontier.length;i++){ const n=frontier[i]; const d=dist.get(n); if (d<bestD){ bestD=d; bestI=i; bestN=n; } }
      const u = bestN; frontier.splice(bestI,1);
      if (u===t) break;
      if (visited.has(u)) continue;
      visited.add(u);
      for (const {to,w} of u.edges){
        if (w===0) continue;
        const alt = dist.get(u)+w;
        if (alt < (dist.get(to)??Infinity)) { dist.set(to,alt); prev.set(to,u); frontier.push(to); }
      }
    }
    if (!prev.has(t) && s!==t) { pathCache.set(k,null); return null; }
    const rev=[]; let cur=t; while (cur){ rev.push(cur); if (cur===s) break; cur=prev.get(cur); if (!cur) break; }
    rev.reverse();
    const path = rev.map(n => new THREE.Vector3(n.x, 0.02, n.z));
    pathCache.set(k,path);
    return path;
  }
  return { route };
}

function buildLatLonGrid(group) {
  const { bounds, span, scale } = group.userData;
  const stepLon = 0.05; // degrees
  const stepLat = 0.05;
  const gridMat = new THREE.LineBasicMaterial({ color: 0x0a4a6f, transparent: true, opacity: 1.0 });
  const grid = new THREE.Group();
  grid.name = 'LatLonGrid';
  for (let lon = bounds.minLon; lon <= bounds.minLon + span.lon + 1e-6; lon += stepLon) {
    const pts = [];
    for (let lat = bounds.minLat; lat <= bounds.minLat + span.lat + 1e-6; lat += stepLat) {
      const p = lonLatToXZ(lon, lat, bounds, span, scale);
      pts.push(new THREE.Vector3(p.x, 0.005, p.z));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    grid.add(new THREE.Line(geo, gridMat));
  }
  for (let lat = bounds.minLat; lat <= bounds.minLat + span.lat + 1e-6; lat += stepLat) {
    const pts = [];
    for (let lon = bounds.minLon; lon <= bounds.minLon + span.lon + 1e-6; lon += stepLon) {
      const p = lonLatToXZ(lon, lat, bounds, span, scale);
      pts.push(new THREE.Vector3(p.x, 0.005, p.z));
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    grid.add(new THREE.Line(geo, gridMat));
  }
  group.add(grid);
}

function buildHeatmapLayer(group) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0,0,size,size);
  const tex = new THREE.DataTexture(data.data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const uniforms = {
    uTex: { value: tex },
    uIntensity: { value: 1.0 }
  };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: /* glsl */`
      varying vec2 vUv; void main(){ vUv=uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */`
      varying vec2 vUv; uniform sampler2D uTex; uniform float uIntensity;
      vec3 palette(float t){
        return mix(vec3(0.0,0.05,0.2), vec3(0.0,0.9,1.0), smoothstep(0.0,0.35,t)) +
               smoothstep(0.4,0.8,t)*vec3(1.2,0.6,0.0) + smoothstep(0.75,1.0,t)*vec3(1.2,0.0,1.2);
      }
      void main(){ float a = texture2D(uTex,vUv).a; if(a<0.02) discard; float t=clamp(a*uIntensity,0.0,1.0); vec3 col=palette(t); gl_FragColor=vec4(col, t*0.55); }
    `
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(group.userData.scale*1.02, group.userData.scale*1.02,1,1), mat);
  plane.rotation.x = -Math.PI/2;
  plane.position.y = 0.07;
  plane.name = 'Heatmap';
  group.add(plane);

  function splat(x, y) { // x,y in [0,size)
    const r = 6;
    for (let dy=-r; dy<=r; dy++) {
      const yy = y+dy; if (yy<0||yy>=size) continue;
      for (let dx=-r; dx<=r; dx++) {
        const xx = x+dx; if (xx<0||xx>=size) continue;
        const dist = Math.sqrt(dx*dx+dy*dy);
        if (dist > r) continue;
        const fall = Math.exp(-(dist*dist)/(r*r*0.6));
        const idx = (yy*size+xx)*4 + 3; // alpha channel only
        data.data[idx] = Math.min(255, data.data[idx] + fall*22);
      }
    }
  }
  function fade() {
    for (let i=3; i<data.data.length; i+=4) {
      data.data[i] = data.data[i]*0.90; // exponential decay
    }
  }
  function update(activeOrbs) {
    fade();
    const { bounds, span } = group.userData;
    for (const orb of activeOrbs) {
      const trip = orb.userData.trip; if (!trip) continue;
      // Use current position (projected) -> normalized
      const x = orb.position.x / group.userData.scale + 0.5; // 0..1
      const z = -orb.position.z / group.userData.scale + 0.5;
      const px = Math.floor(x * size);
      const py = Math.floor(z * size);
      splat(px, py);
    }
    ctx.putImageData(data,0,0);
    tex.needsUpdate = true;
  }
  group.userData.heat = { update };
}

export async function loadNYCMap(scene) {
  const group = new THREE.Group();
  group.name = 'NYCMap';
  const scale = 220;
  const bounds = { minLon: -74.30, minLat: 40.45 };
  const span = { lon: -73.65 - bounds.minLon, lat: 40.95 - bounds.minLat };
  group.userData = { scale, bounds, span };

  // Water plane
  // const water = new THREE.Mesh(new THREE.PlaneGeometry(1000,1000), new THREE.MeshBasicMaterial({ color: 0x00011a }));
  // water.rotation.x = -Math.PI/2; water.position.y = -0.15; water.name='Water';
  // group.add(water);

  // Detailed borough polygons (fallback order: simplified3->2->1)
  const boroughFiles = ['src/geo/boroughs-simplified3.geojson','src/geo/boroughs-simplified2.geojson','src/geo/boroughs-simplified1.geojson','src/geo/nyc-simple.geojson'];
  for (const f of boroughFiles) {
    try { const gj = await fetchGeo(f); buildBoroughs(group, gj); break; } catch(e) { continue; }
  }

  // Roads (await so routing graph is ready when returned)
  await buildRoads(group);
  // Grid overlay
  buildLatLonGrid(group);
  // Heat layer (disabled to remove persistent trail effect)
  const HEAT_ENABLED = false;
  if (HEAT_ENABLED) buildHeatmapLayer(group);

  // Data-driven landmark outlines from GeoJSON assets
  await addGeoLandmark(group, {
    url: 'src/geo/centralpark.geojson',
    name: 'Central Park',
    color: 0x4cff92,
    label: 'Central Park',
    bbox: { minLon: -73.99, maxLon: -73.94, minLat: 40.76, maxLat: 40.81 },
    minPoints: 200
  });
  await addGeoLandmark(group, {
    url: 'src/geo/airports.geojson',
    name: 'John F. Kennedy International Airport',
    color: 0xff5ce1,
    label: 'JFK',
    bbox: { minLon: -73.90, maxLon: -73.75, minLat: 40.60, maxLat: 40.67 },
    minPoints: 300
  });
  await addGeoLandmark(group, {
    url: 'src/geo/airports.geojson',
    name: 'LaGuardia Airport',
    color: 0xff9f43,
    label: 'LaGuardia',
    bbox: { minLon: -73.92, maxLon: -73.84, minLat: 40.75, maxLat: 40.78 },
    minPoints: 150
  });

  scene.add(group);
  return group;
}
