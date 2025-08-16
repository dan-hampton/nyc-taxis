import * as THREE from 'three';


// Load and plot a .poly boundary file as a magenta outline
// params: group: the parent group to add the outline to
//         polyPath: path to the .poly file
//         color: color of the outline
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


// Utility to fetch and parse GeoJSON
async function fetchGeo(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed geo fetch ' + url);
  return res.json();
}

// Utility to project longitude/latitude to 3D space
// params: lon: longitude in degrees
//         lat: latitude in degrees
//         bounds: bounding box of the map
//         span: span of the map in world units
//         scale: scale factor for the map
function projectLonLat(lon, lat, bounds, span, scale) {
  const x = ((lon - bounds.minLon) / span.lon - 0.5) * scale;
  const z = -((lat - bounds.minLat) / span.lat - 0.5) * scale;
  return new THREE.Vector3(x, 0, z);
}


// Utility to add landmark outline
// params: group: the parent group to add the outline to
//         coords: array of [lon, lat] coordinates defining the outline
//         color: color of the outline
//         name: name of the outline (for identification)
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
// params: group: the parent group to add the polygon to
//         coords: array of [lon, lat] coordinates defining the polygon
//         fillColor: color of the filled area
//         outlineColor: color of the outline
//         name: name of the polygon (for identification)
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
// params: text: the text content of the label
//         color: the color of the label text
//         fontSize: the font size of the label text
function makeLabel(text, color = '#c8c8c8', fontSize = 10) {
  // Normalize color to hex string if numeric
  let baseColor;
  if (typeof color === 'number') {
    baseColor = '#' + color.toString(16).padStart(6, '0');
  } else {
    baseColor = color;
  }
  // Always render at 50% opacity regardless of input alpha
  function colorWithAlpha(c, a = 0.5) {
    // If already rgba(...), just replace alpha
    const m = /^rgba?\(([^)]+)\)$/.exec(c);
    if (m) {
      const parts = m[1].split(',').map(s => s.trim());
      while (parts.length < 3) parts.push('0');
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${a})`;
    }
    // If hex (#rgb or #rrggbb)
    if (c.startsWith('#')) {
      if (c.length === 4) { // #rgb -> expand
        c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
      }
      const r = parseInt(c.slice(1,3),16);
      const g = parseInt(c.slice(3,5),16);
      const b = parseInt(c.slice(5,7),16);
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }
    // Fallback
    return `rgba(200,200,200,${a})`;
  }

  const padding = Math.round(fontSize * 0.3); // tighter; smaller texture
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${fontSize}px 'Helvetica Neue', Arial, sans-serif`;
  // Measure text to size canvas tightly (not stretched)
  const metrics = ctx.measureText(text);
  const textW = Math.ceil(metrics.width);
  const textH = Math.ceil(fontSize * 1.2);
  canvas.width = textW + padding * 2;
  canvas.height = textH + padding * 2;
  // Need to reset font after resizing canvas
  ctx.font = `bold ${fontSize}px 'Helvetica Neue', Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = colorWithAlpha(baseColor, 0.3); // already semi transparent
  ctx.fillText(text, canvas.width/2, canvas.height/2);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  // World size: scale down vs previous (dynamic by font size)
  const worldHeight = fontSize * 0.15; // much smaller world footprint
  const aspect = canvas.width / canvas.height;
  // Clamp max width multiplier to keep very long labels reasonable
  const maxAspect = 2.5; // stricter width clamp
  const finalAspect = Math.min(aspect, maxAspect);
  sprite.scale.set(worldHeight * finalAspect, worldHeight, 1);
  sprite.userData.labelText = text;
  return sprite;
}


// Utility to convert longitude/latitude to 3D coordinates
// params: lon: longitude in degrees
//         lat: latitude in degrees
//         bounds: bounding box of the map
//         span: span of the map in world units
//         scale: scale factor for the map
function lonLatToXZ(lon, lat, bounds, span, scale) {
  return {
    x: ((lon - bounds.minLon) / span.lon - 0.5) * scale,
    z: -((lat - bounds.minLat) / span.lat - 0.5) * scale
  };
}


// Utility to add label to the map
// params: group: the parent group to add the label to
//         text: the text content of the label
//         lon: longitude in degrees
//         lat: latitude in degrees
//         color: the color of the label text
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
  } catch(e) {
    // silent fail; landmark optional
  }
}


// Helper to flatten relevant geometry types to a single coordinate sequence (outer boundary heuristic)
// params: geom: GeoJSON geometry object
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

// Build borough outlines and labels
// params: group: the parent group to add the boroughs to
//         gj: GeoJSON object containing the borough features
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
    addLabel(group, lbl.name, lbl.lon, lbl.lat, 'rgba(167, 167, 167, 1)');
  }
}

// Draw filled polygon with outline
// params: rings: array of rings defining the polygon
//         group: the parent group to add the polygon to
//         lineMat: material for the polygon outline
//         fillMat: material for the filled area
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

// Utility to build road network from GeoJSON
// params: group: the parent group to add the roads to
async function buildRoads(group) {
  const roadFiles = ['src/geo/roads.geojson'];
  const matPrimary = new THREE.LineBasicMaterial({ color: 0x148aff, transparent: true, opacity: 0.52 });
  const matMinor = new THREE.LineBasicMaterial({ color: 0x0da0ff, transparent: true, opacity: 0.32 });
  const allowedTypes = ['motorway','trunk','primary','secondary','tertiary','unclassified','residential','service'];
  // Data store per road type
  const typeData = {};
  for (const t of allowedTypes) typeData[t] = { lines: [], polylines: [], named: [], enabled: true };
  const roadGroup = new THREE.Group();
  roadGroup.name = 'RoadLayer';
  let added = 0;
  const { bounds, span } = group.userData;
  // Slightly extend filtering bbox by 2% to avoid clipping near edges
  const padLon = span.lon * 0.02, padLat = span.lat * 0.02;
  const minLon = bounds.minLon - padLon, maxLon = bounds.minLon + span.lon + padLon;
  const minLat = bounds.minLat - padLat, maxLat = bounds.minLat + span.lat + padLat;
  // Helper bbox test
  const within = (coords) => coords.some(([lon,lat]) => lon>=minLon && lon<=maxLon && lat>=minLat && lat<=maxLat);
  for (const file of roadFiles) {
    try {
      const gj = await fetchGeo(file);
      for (const f of (gj.features||[])) {
        const geom = f.geometry; if (!geom) continue;
        const highway = (f.properties && f.properties.highway) || '';
        if (!allowedTypes.includes(highway)) continue;
        const major = ['motorway','trunk','primary','secondary'].includes(highway);
        const roadName = (f.properties && f.properties.name) || '';
        const draw = (coords) => {
          if (!within(coords)) return;
          const pts = addRoadLine(group, roadGroup, coords, major ? matPrimary : matMinor);
          if (pts) {
            typeData[highway].lines.push(roadGroup.children[roadGroup.children.length-1]);
            typeData[highway].polylines.push(pts);
            if (roadName) typeData[highway].named.push({ name: roadName, points: pts });
            added++;
          }
        };
        if (geom.type === 'LineString') draw(geom.coordinates);
        else if (geom.type === 'MultiLineString') for (const seg of geom.coordinates) draw(seg);
        else if (geom.type === 'Polygon') { const ring = geom.coordinates[0]; draw(ring); }
        else if (geom.type === 'MultiPolygon') { for (const poly of geom.coordinates) { const ring = poly[0]; draw(ring); } }
      }
    } catch (e) { /* ignore file */ }
  }
  console.log('[NYCMap] Roads added:', added);
  group.add(roadGroup);

  function rebuildRouter() {
    const allPolys = [];
    const namedPolys = [];
    for (const t of allowedTypes) if (typeData[t].enabled) { allPolys.push(...typeData[t].polylines); namedPolys.push(...typeData[t].named); }
    group.userData.roadRouter = buildRoadRouter(allPolys);
    // nearestRoadName only over enabled types
    function nearestRoadName(worldPos, maxDist = 3.0) {
      let bestName = ''; let bestD2 = maxDist * maxDist; const px=worldPos.x, pz=worldPos.z;
      for (const r of namedPolys) {
        const pts = r.points;
        for (let i=0;i<pts.length-1;i++) {
          const a=pts[i], b=pts[i+1];
          const abx=b.x-a.x, abz=b.z-a.z; const apx=px-a.x, apz=pz-a.z;
            const abLen2=abx*abx+abz*abz; if (!abLen2) continue;
          let t=(apx*abx+apz*abz)/abLen2; if (t<0) t=0; else if (t>1) t=1;
          const cx=a.x+abx*t, cz=a.z+abz*t; const dx=px-cx, dz=pz-cz; const d2=dx*dx+dz*dz;
          if (d2<bestD2) { bestD2=d2; bestName=r.name; }
        }
      }
      return bestName;
    }
    group.userData.roadIndex = { nearestRoadName };
  }

  function toggleRoadType(type, enabled) {
    if (!typeData[type]) return; if (typeData[type].enabled === enabled) return;
    typeData[type].enabled = enabled;
    // Add/remove line objects
    if (!enabled) {
      for (const l of typeData[type].lines) { if (l.parent) l.parent.remove(l); }
    } else {
      for (const l of typeData[type].lines) { if (!l.parent) roadGroup.add(l); }
    }
    rebuildRouter();
  }

  // Initial router build
  rebuildRouter();
  group.userData.roadTypes = allowedTypes.map(t => ({ type: t, enabled: typeData[t].enabled }));
  group.userData.toggleRoadType = toggleRoadType;
  group.userData.rebuildRoadRouter = rebuildRouter; // exposed if needed
}


// Utility to add road line to the map
// params: rootGroup: the root group to add the road line to
//         roadGroup: the specific group for the road line
//         coords: array of [lon, lat] pairs defining the road line
//         mat: material to use for the road line
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


// Utility to build road routing graph
// params: polylines: array of road polylines
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

// Utility to build latitude/longitude grid
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


// Utility to build heatmap layer
async function buildHeatmapLayer(group) {
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


// Utility to load NYC map
// params: scene: the parent scene to add the map to
export async function loadNYCMap(scene, opts = {}) {
  const { radiusKm = 15, roadPadFactor = 0.02, fullExtent = true, coverageFactor = 1.0 } = opts;
  const group = new THREE.Group();
  group.name = 'NYCMap';
  const FIXED_SCALE = 220;
  // If fullExtent, derive bounds from roads file before anything else
  let bounds, span;
  const ext = await (async()=>{ const gj = await fetchGeo('src/geo/roads.geojson'); if(!gj||!gj.features) return null; let minLon=Infinity,maxLon=-Infinity,minLat=Infinity,maxLat=-Infinity; const scan=(arr)=>{ for(const [lo,la] of arr){ if(lo<minLon)minLon=lo; if(lo>maxLon)maxLon=lo; if(la<minLat)minLat=la; if(la>maxLat)maxLat=la; } }; for(const f of gj.features){ const g=f.geometry; if(!g) continue; const t=g.type; const c=g.coordinates; if(t==='LineString') scan(c); else if(t==='MultiLineString') for(const line of c) scan(line); else if(t==='Polygon') for(const ring of c) scan(ring); else if(t==='MultiPolygon') for(const poly of c) for(const ring of poly) scan(ring); } if(minLon===Infinity) return null; return {minLon,maxLon,minLat,maxLat}; })();
  bounds = { minLon: ext.minLon, minLat: ext.minLat }; span = { lon: ext.maxLon - ext.minLon, lat: ext.maxLat - ext.minLat };
  // Apply coverage factor (crop bounding box around center) to reduce map size & road build cost
  const cf = THREE.MathUtils.clamp(coverageFactor, 0.1, 1.0);
  if (cf < 0.999) {
    const cropLon = span.lon * (1 - cf) * 0.5;
    const cropLat = span.lat * (1 - cf) * 0.5;
    bounds.minLon += cropLon;
    bounds.minLat += cropLat;
    span.lon *= cf;
    span.lat *= cf;
  }
  const center = { lon: bounds.minLon + span.lon/2, lat: bounds.minLat + span.lat/2 };
  group.userData = { scale: FIXED_SCALE, bounds, span, center, radiusKm, roadPadFactor, fullExtent, coverageFactor: cf };
  const gj = await fetchGeo('src/geo/boroughs.geojson'); buildBoroughs(group, gj);
  await buildRoads(group);
  // buildLatLonGrid(group);
  // await buildHeatmapLayer(group);
  await addGeoLandmark(group, { url: 'src/geo/centralpark.geojson', name: 'Central Park', color: 0x4cff92, label: 'Central Park', bbox: { minLon: -73.99, maxLon: -73.94, minLat: 40.76, maxLat: 40.81 }, minPoints: 200 });
  await addGeoLandmark(group, { url: 'src/geo/airports.geojson', name: 'John F. Kennedy International Airport', color: 0xff5ce1, label: 'JFK', bbox: { minLon: -73.90, maxLon: -73.75, minLat: 40.60, maxLat: 40.67 }, minPoints: 300 });
  await addGeoLandmark(group, { url: 'src/geo/airports.geojson', name: 'LaGuardia Airport', color: 0xff9f43, label: 'LaGuardia', bbox: { minLon: -73.92, maxLon: -73.84, minLat: 40.75, maxLat: 40.78 }, minPoints: 150 });
  await addPolyOutline(group, 'src/geo/new-york.poly');
  scene.add(group); return group;
}
