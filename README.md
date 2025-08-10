# NYC Taxi Flux

A cinematic, neo‑futuristic real‑time (sped up) visualization of NYC taxi trips rendered in WebGL / three.js.

## Features Implemented
- Dark neon scene with ambient glow.
- Stylized NYC borough map (simplified GeoJSON) with water plane + landmark outlines (Central Park, JFK, LGA).
- CSV trip parsing (subset.csv) via PapaParse ES module CDN.
- Post-processing: Bloom + Film grain + SMAA (when pixel ratio == 1).
- Object pool of glowing orbs representing active trips (no per-frame allocations).
- Quadratic Bezier arc paths (elevated control midpoint) for graceful motion.
- Orb sizing by logarithmic fare scaling; color by vendor.
- Raycast interaction: tooltip on click; hover scaling highlight.
- Timeline scrubber + play/pause + speed control; looping 24h cycle.

## Quick Start
Just open `index.html` in a modern Chromium or Firefox browser (serving via local server recommended for fetch). For macOS:

```
python3 -m http.server 8000
# then visit http://localhost:8000
```

Or using Node (optional):
```
npx serve .
```

## File Structure
- `index.html` Root HTML and HUD.
- `styles.css` UI styling / glow.
- `src/main.js` Entry point: sets up scene, controls, post‑processing, loop.
- `src/scene/map.js` Renders simplified borough outlines & water.
- `src/data/loadTrips.js` Fetch + parse CSV + transform to simulation objects.
- `src/utils/projection.js` Geographic projection utilities.
- `src/sim/pool.js` Orb pooling helpers.
- `src/sim/simulation.js` Core simulation logic (activation, movement, lifecycle).
- `src/geo/nyc-simple.geojson` Simplified geometry for borough boundaries.

## Customization Ideas
- Replace simplified GeoJSON with detailed borough boundaries.
- Add Central Park & airports outlines as separate highlight layers.
- Introduce color grading / film grain passes.
- Add SMAA / FXAA for extra smoothness.
- Implement GPU instancing for >10k simultaneous trips.
- Add temporal trail effects (afterimage or line streaks using custom shaders).

## Performance Notes
The object pool prevents GC spikes. For larger datasets:
- Batch update positions in a single loop; consider merging geometry with InstancedMesh.
- Use half‑resolution bloom render pass for speed.

## Implementation Notes
- Uses an ES Module import map to load `three` + addons from a CDN (jsDelivr). If you saw a previous error like `Module name 'three' does not resolve`, ensure the `<script type="importmap">` block in `index.html` is present and you are not blocking cross‑origin requests.
- Inline SVG favicon added to remove 404 warnings.

## License
MIT (add a LICENSE file if distributing). Data subject to NYC Taxi & Limousine Commission terms.
