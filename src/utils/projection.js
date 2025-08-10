// Simple equirectangular / mercator-ish projection tuned for NYC bounds
// Converts lon/lat to X/Z plane coordinates scaled to a chosen size.

const NYC_BOUNDS = {
  minLon: -74.30,
  maxLon: -73.65,
  minLat: 40.45,
  maxLat: 40.95
};

const spanLon = NYC_BOUNDS.maxLon - NYC_BOUNDS.minLon;
const spanLat = NYC_BOUNDS.maxLat - NYC_BOUNDS.minLat;

export function project(lon, lat, scale = 100) {
  const xNorm = (lon - NYC_BOUNDS.minLon) / spanLon - 0.5; // -0.5..0.5
  const zNorm = (lat - NYC_BOUNDS.minLat) / spanLat - 0.5; // -0.5..0.5
  return { x: xNorm * scale, z: -zNorm * scale }; // invert z so north is up
}

export function projectVec3(lon, lat, scale = 100, target) {
  const p = project(lon, lat, scale);
  target.x = p.x;
  target.y = 0;
  target.z = p.z;
  return target;
}
