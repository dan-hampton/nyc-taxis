// Load and plot a .poly boundary file as a magenta outline
async function addPolyOutline(group, polyPath, color = 0xff00ff) {
  // Fetch and parse poly file
  const res = await fetch(polyPath);
  if (!res.ok) { console.warn('Failed to load poly file', polyPath); return; }
  const text = await res.text();
  // Extract coordinates (lines with two floats)
  const coords = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/(-?\d+\.\d+E?[+-]?\d*)\s+(-?\d+\.\d+E?[+-]?\d*)/);
    if (m) coords.push([parseFloat(m[1]), parseFloat(m[2])]);
  }
  if (coords.length < 3) { console.warn('Poly file has too few coords'); return; }
  // Project and plot
  const { bounds, span, scale } = group.userData;
  const pts = coords.map(([lon,lat]) => {
    const v = projectLonLat(lon, lat, bounds, span, scale);
    return new THREE.Vector3(v.x, 0.12, v.z);
  });
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color, transparent:true, opacity:0.8 }));
  line.name = 'NYPolyOutline';
  group.add(line);
}
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

// Draw filled polygon with outline
function addFilledPolygon(group, coords, fillColor, outlineColor, name) {
  const shape = new THREE.Shape();
  coords.forEach(([lon, lat], i) => {
    const v = projectLonLat(lon, lat, group.userData.bounds, group.userData.span, group.userData.scale);
    if (i === 0) shape.moveTo(v.x, v.z); else shape.lineTo(v.x, v.z);
  });
  // Filled mesh
  const meshGeo = new THREE.ShapeGeometry(shape);
  const meshMat = new THREE.MeshBasicMaterial({ color: fillColor, transparent: true, opacity: 0.35, depthWrite: false });
  const mesh = new THREE.Mesh(meshGeo, meshMat);
  mesh.position.y = 0.04;
  mesh.name = name + '_fill';
  group.add(mesh);
  // Outline
  addLandmarkOutline(group, coords, outlineColor, name + '_outline');
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
      // Draw boundary outline as before
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
    // Always draw inner details for Central Park, regardless of boundary match
    if (url.includes('centralpark.geojson')) {
      drawCentralParkInnerDetails(group, gj.features, color);
    }
// Draw inner features of Central Park (paths, lakes, playgrounds, etc.)
function drawCentralParkInnerDetails(group, features, baseColor) {
  const pathColor = 0x00eaff;
  const waterFill = 0x3f8fff, waterOutline = 0x1a4a99;
  const playgroundFill = 0xffe600, playgroundOutline = 0xffa600;
  const fieldFill = 0x4cff92, fieldOutline = 0x1a994c;
  for (const f of features) {
    if (!f.geometry || !f.properties) continue;
    const t = f.geometry.type;
    // Paths: draw as Line
    if (f.properties.highway && ['path','footway','cycleway'].includes(f.properties.highway)) {
      const coords = t === 'LineString' ? f.geometry.coordinates : (t === 'MultiLineString' ? f.geometry.coordinates.flat() : null);
      if (coords && coords.length > 1) {
        // Use Line, not LineLoop, for paths
        const pts = coords.map(([lon, lat]) => {
          const v = projectLonLat(lon, lat, group.userData.bounds, group.userData.span, group.userData.scale);
          return new THREE.Vector3(v.x, 0.06, v.z);
        });
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color: pathColor, transparent: true, opacity: 0.7 });
        const line = new THREE.Line(geo, mat);
        line.name = 'CP_Path';
        group.add(line);
      }
    }
    // Water: draw as filled Mesh with outline
    if (f.properties.natural === 'water') {
      const coords = t === 'Polygon' ? f.geometry.coordinates[0] : (t === 'MultiPolygon' ? f.geometry.coordinates.flat(2) : null);
      if (coords && coords.length > 2) {
        addFilledPolygon(group, coords, waterFill, waterOutline, 'CP_Lake');
      }
    }
    // Playgrounds: filled Mesh with outline
    if (f.properties.leisure === 'playground') {
      const coords = t === 'Polygon' ? f.geometry.coordinates[0] : (t === 'MultiPolygon' ? f.geometry.coordinates.flat(2) : null);
      if (coords && coords.length > 2) {
        addFilledPolygon(group, coords, playgroundFill, playgroundOutline, 'CP_Playground');
      }
    }
    // Fields (park, pitch): filled Mesh with outline
    if (f.properties.leisure && ['park','pitch'].includes(f.properties.leisure)) {
      const coords = t === 'Polygon' ? f.geometry.coordinates[0] : (t === 'MultiPolygon' ? f.geometry.coordinates.flat(2) : null);
      if (coords && coords.length > 2) {
        addFilledPolygon(group, coords, fieldFill, fieldOutline, 'CP_Field');
      }
    }
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
  // Dynamic margin proportional to current span (older fixed 0.15 over-cropped small spans)
  const marginLon = span.lon * 0.03; // 3% each side
  const marginLat = span.lat * 0.03;
  const minLon = bounds.minLon + marginLon, maxLon = bounds.minLon + span.lon - marginLon;
  const minLat = bounds.minLat + marginLat, maxLat = bounds.minLat + span.lat - marginLat;
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
  const roadFiles = ['src/geo/roads.geojson'];
  const matPrimary = new THREE.LineBasicMaterial({ color: 0x148aff, transparent: true, opacity: 0.52 });
  const matMinor = new THREE.LineBasicMaterial({ color: 0x0da0ff, transparent: true, opacity: 0.22 });
  const roadGroup = new THREE.Group();
  roadGroup.name = 'RoadLayer';
  let added = 0;
  const { bounds, span, scale } = group.userData;
  // NYC bbox for filtering
  // Slightly extend filtering bbox by 2% to avoid clipping near edges
  const padLon = span.lon * 0.02, padLat = span.lat * 0.02;
  const minLon = bounds.minLon - padLon, maxLon = bounds.minLon + span.lon + padLon;
  const minLat = bounds.minLat - padLat, maxLat = bounds.minLat + span.lat + padLat;
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
        if (!/motorway|trunk|primary|secondary|tertiary|unclassified|residential|service/.test(highway)) continue; 
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

// Helper: compute center (lon,lat) of Central Park from its GeoJSON (no hard-coded coords)
async function computeCentralParkCenter(url) {
  try {
    const gj = await fetchGeo(url);
    if (!gj || !gj.features) return null;
    let target = null;
    for (const f of gj.features) {
      if (!f || !f.geometry) continue;
      const props = f.properties || {};
      if (props.name === 'Central Park') { target = f; break; }
      // Fallback: keep largest feature by coordinate count
      if (!target) target = f; else {
        const prev = extractCoords(target.geometry) || [];
        const cur = extractCoords(f.geometry) || [];
        if (cur.length > prev.length) target = f;
      }
    }
    if (!target) return null;
    const coords = extractCoords(target.geometry) || [];
    if (!coords.length) return null;
    let sx = 0, sy = 0; for (const [lon,lat] of coords) { sx += lon; sy += lat; }
    return { lon: sx/coords.length, lat: sy/coords.length };
  } catch(e) { return null; }
}

// /**
//  * Load NYC map centered on Central Park with dynamic geographic span.
//  * Visual world size now scales with radius (previously fixed size, so radius appeared to have no effect).
//  * @param {THREE.Scene} scene
//  * @param {object} opts
//  * @param {number} opts.radiusKm Approx radius (km) to include around Central Park (default 12)
//  * @param {number} opts.unitsPerKm World units per kilometer (default 4; original ~4 units/km baseline)
//  */
// export async function loadNYCMap(scene, opts = {}) {
//   const { radiusKm = 12, unitsPerKm = 4 } = opts; // radiusKm previously ineffective; now drives scale
//   const group = new THREE.Group();
//   group.name = 'NYCMap';
//   // Derive central park center first (async)
//   const cpCenter = await computeCentralParkCenter('src/geo/centralpark.geojson');
//   // Fallback: if central park load failed, retain previous hard-coded bounds to avoid crash
//   let bounds, span;
//   if (cpCenter) {
//     const centerLon = cpCenter.lon;
//     const centerLat = cpCenter.lat;
//     // Convert radius (km) to degree spans. 1 deg lat ~111 km. 1 deg lon ~ 111 * cos(lat) km.
//     const latSpanDeg = (radiusKm * 2) / 111.0;
//     const lonKmPerDeg = 111.0 * Math.cos(centerLat * Math.PI/180);
//     const lonSpanDeg = (radiusKm * 2) / lonKmPerDeg;
//     bounds = { minLon: centerLon - lonSpanDeg/2, minLat: centerLat - latSpanDeg/2 };
//     span = { lon: lonSpanDeg, lat: latSpanDeg };
//   } else {
//     bounds = { minLon: -74.30, minLat: 40.45 }; // legacy fallback
//     span = { lon: -73.65 - bounds.minLon, lat: 40.95 - bounds.minLat };
//   }
//   // Derive world scale from requested radius: diameter = 2*radiusKm -> scale = diameter * unitsPerKm
//   const scale = radiusKm * 2 * unitsPerKm;
//   const center = { lon: bounds.minLon + span.lon/2, lat: bounds.minLat + span.lat/2 };
//   group.userData = { scale, bounds, span, center, radiusKm, unitsPerKm };
//   console.log('[NYCMap] Centered bounds', { center, bounds, span, radiusKm, unitsPerKm, scale });

//   // Water plane
//   // const water = new THREE.Mesh(new THREE.PlaneGeometry(1000,1000), new THREE.MeshBasicMaterial({ color: 0x00011a }));
//   // water.rotation.x = -Math.PI/2; water.position.y = -0.15; water.name='Water';
//   // group.add(water);

//   // Detailed borough polygons (fallback order: simplified3->2->1)
//   const boroughFiles = ['src/geo/boroughs.geojson'];
//   for (const f of boroughFiles) {
//     try { const gj = await fetchGeo(f); buildBoroughs(group, gj); break; } catch(e) { continue; }
//   }

//   // Roads (await so routing graph is ready when returned)
//   await buildRoads(group);
//   // Grid overlay
//   buildLatLonGrid(group);
//   // Heat layer (disabled to remove persistent trail effect)
//   const HEAT_ENABLED = false;
//   if (HEAT_ENABLED) buildHeatmapLayer(group);

//   // Data-driven landmark outlines from GeoJSON assets (Central Park already used for centering but fetched again here for outline)
//   await addGeoLandmark(group, {
//     url: 'src/geo/centralpark.geojson',
//     name: 'Central Park',
//     color: 0x4cff92,
//     label: 'Central Park',
//     bbox: { minLon: -73.99, maxLon: -73.94, minLat: 40.76, maxLat: 40.81 },
//     minPoints: 200
//   });
//   await addGeoLandmark(group, {
//     url: 'src/geo/airports.geojson',
//     name: 'John F. Kennedy International Airport',
//     color: 0xff5ce1,
//     label: 'JFK',
//     bbox: { minLon: -73.90, maxLon: -73.75, minLat: 40.60, maxLat: 40.67 },
//     minPoints: 300
//   });
//   await addGeoLandmark(group, {
//     url: 'src/geo/airports.geojson',
//     name: 'LaGuardia Airport',
//     color: 0xff9f43,
//     label: 'LaGuardia',
//     bbox: { minLon: -73.92, maxLon: -73.84, minLat: 40.75, maxLat: 40.78 },
//     minPoints: 150
//   });

//   scene.add(group);
//   return group;
// }

// New implementation variant fixing radius effect
export async function loadNYCMap(scene, opts = {}) {
  const { radiusKm = 15, showBounds = false, roadPadFactor = 0.02, fullExtent = false } = opts;
  const group = new THREE.Group();
  group.name = 'NYCMap';
  const FIXED_SCALE = 220;
  // If fullExtent, derive bounds from roads file before anything else
  let bounds, span;
  if (fullExtent) {
    try {
      const ext = await (async()=>{ const gj = await fetchGeo('src/geo/roads.geojson'); if(!gj||!gj.features) return null; let minLon=Infinity,maxLon=-Infinity,minLat=Infinity,maxLat=-Infinity; const scan=(arr)=>{ for(const [lo,la] of arr){ if(lo<minLon)minLon=lo; if(lo>maxLon)maxLon=lo; if(la<minLat)minLat=la; if(la>maxLat)maxLat=la; } }; for(const f of gj.features){ const g=f.geometry; if(!g) continue; const t=g.type; const c=g.coordinates; if(t==='LineString') scan(c); else if(t==='MultiLineString') for(const line of c) scan(line); else if(t==='Polygon') for(const ring of c) scan(ring); else if(t==='MultiPolygon') for(const poly of c) for(const ring of poly) scan(ring); } if(minLon===Infinity) return null; return {minLon,maxLon,minLat,maxLat}; })();
      if (ext) { bounds = { minLon: ext.minLon, minLat: ext.minLat }; span = { lon: ext.maxLon - ext.minLon, lat: ext.maxLat - ext.minLat }; console.log('[NYCMap] fullExtent bounds derived from roads', ext); }
    } catch(e) { console.warn('[NYCMap] fullExtent extent failed', e); }
  }
  if (!bounds) {
    const cpCenter = await computeCentralParkCenter('src/geo/centralpark.geojson');
    if (cpCenter) {
      const centerLon = cpCenter.lon; const centerLat = cpCenter.lat;
      const latSpanDeg = (radiusKm * 2) / 111.0; const lonKmPerDeg = 111.0 * Math.cos(centerLat * Math.PI/180); const lonSpanDeg = (radiusKm * 2) / lonKmPerDeg;
      bounds = { minLon: centerLon - lonSpanDeg/2, minLat: centerLat - latSpanDeg/2 }; span = { lon: lonSpanDeg, lat: latSpanDeg };
    } else { bounds = { minLon: -74.30, minLat: 40.45 }; span = { lon: -73.65 - bounds.minLon, lat: 40.95 - bounds.minLat }; }
  }
  const center = { lon: bounds.minLon + span.lon/2, lat: bounds.minLat + span.lat/2 };
  group.userData = { scale: FIXED_SCALE, bounds, span, center, radiusKm, roadPadFactor, fullExtent };
  console.log('[NYCMap] Centered bounds (new impl)', { center, bounds, span, radiusKm, fullExtent, scale: FIXED_SCALE });
  if (showBounds) {
    const cornerVecs = [ projectLonLat(bounds.minLon, bounds.minLat, bounds, span, FIXED_SCALE), projectLonLat(bounds.minLon + span.lon, bounds.minLat, bounds, span, FIXED_SCALE), projectLonLat(bounds.minLon + span.lon, bounds.minLat + span.lat, bounds, span, FIXED_SCALE), projectLonLat(bounds.minLon, bounds.minLat + span.lat, bounds, span, FIXED_SCALE) ].map(v => new THREE.Vector3(v.x, 0.08, v.z));
    const geo = new THREE.BufferGeometry().setFromPoints(cornerVecs);
    const loop = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xff00ff, transparent:true, opacity:0.5 }));
    loop.name = 'DebugBounds'; group.add(loop);
  }
  try { const gj = await fetchGeo('src/geo/boroughs.geojson'); buildBoroughs(group, gj); } catch(e) {}
  await buildRoads(group);
  buildLatLonGrid(group);
  const HEAT_ENABLED = false; if (HEAT_ENABLED) buildHeatmapLayer(group);
  await addGeoLandmark(group, { url: 'src/geo/centralpark.geojson', name: 'Central Park', color: 0x4cff92, label: 'Central Park', bbox: { minLon: -73.99, maxLon: -73.94, minLat: 40.76, maxLat: 40.81 }, minPoints: 200 });
  await addGeoLandmark(group, { url: 'src/geo/airports.geojson', name: 'John F. Kennedy International Airport', color: 0xff5ce1, label: 'JFK', bbox: { minLon: -73.90, maxLon: -73.75, minLat: 40.60, maxLat: 40.67 }, minPoints: 300 });
  await addGeoLandmark(group, { url: 'src/geo/airports.geojson', name: 'LaGuardia Airport', color: 0xff9f43, label: 'LaGuardia', bbox: { minLon: -73.92, maxLon: -73.84, minLat: 40.75, maxLat: 40.78 }, minPoints: 150 });
  // Plot poly boundary if present
  await addPolyOutline(group, 'src/geo/new-york.poly');
  scene.add(group); return group;
}
