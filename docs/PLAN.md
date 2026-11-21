# Plan

See [PROMPT.md](PROMPT.md) for the original prompt and scoping answers.


## Context
Browser-viewable 3D model of downtown Toronto, centered on the CN Tower and Rogers Centre, published on GitHub Pages. Choices made: real OSM geometry, stylized "architectural model" look, orbit + landmark fly-to + time-of-day + street-level walk.
## Stack
- **Three.js** (pinned version) loaded through an `<script type="importmap">` from jsDelivr. Plain ES modules, no bundler, no build step: the repo is served as-is by GitHub Pages.
- Three.js addons used: `OrbitControls`, `PointerLockControls`, `Sky`, `CSS2DRenderer` (labels), `EffectComposer` + `GTAOPass` (ambient occlusion), `OutputPass`, `BufferGeometryUtils` (merging).
- Node script (dev-only, not served) for the one-time OSM extraction; its only dependency is `osmtogeojson`.

## Area and coordinates
- Bounding box lat 43.603–43.662, lon −79.402 to −79.363 (Bathurst-ish to Jarvis, Toronto Islands to Queen's Park edge). Tunable in the extraction script.
- Projection: local metric ENU, origin at the CN Tower (43.6426, −79.3871); x = east, z = south, y = up. Coordinates quantized to 0.1 m.

## Data pipeline: `tools/fetch-osm.mjs`
1. Overpass API query for the bbox: `building=*` / `building:part=*`, `highway=*` (motorway → residential), `railway=rail`, `leisure=park` / `landuse=grass`, water areas.
2. `osmtogeojson` to assemble ways and multipolygons.
3. Heights: `height` → else `building:levels × 3.5 m` → else default by building type (estimated; flagged in data). `min_height` honored for `building:part`.
4. Drop OSM buildings whose footprint intersects the CN Tower and Rogers Centre (hand-modeled instead).
5. Lake: OSM maps Lake Ontario as a `natural=water` relation, not coastline. Land is the full bbox; the lake polygon, clipped to the bbox with the islands as holes, is drawn on top.
6. Write `data/toronto.json`: compact arrays (buildings: rings + height + min_height + type; roads: polylines + class/width; parks; water polygons). Target under ~5 MB raw (Pages serves it gzipped).

## Scene
- **Buildings**: extrude each footprint (`ExtrudeGeometry` / custom shape triangulation), merge into a few large geometries by material group for low draw counts. Shader patch (`onBeforeCompile`) draws a subtle floor/window grid from world position, and an emissive window pattern scaled by a `night` uniform with per-building random lit ratio.
- **Landmarks (hand-modeled from primitives/lathe)**:
  - CN Tower: Y-shaped tripod hexagonal shaft, main pod (~342–351 m), SkyPod (447 m), antenna to 553 m, night LED lighting.
  - Rogers Centre: dome with segmented roof panels, stadium bowl ring, base.
- **Ground**: lake plane (soft blue, slight specular), land polygon, roads as flat ribbons (width by class), Gardiner Expressway elevated, rail corridor, parks in green.
- **Style**: soft desaturated palette, `MeshStandardMaterial`, directional-light shadows sized to the downtown area, GTAO, light distance fog, ACES tone mapping.
- **Sky / time of day**: `Sky` shader driven by a sun position computed from a slider (0–24 h, Toronto latitude). Sun intensity/color, hemisphere light, fog color, and `night` uniform all keyed off sun elevation. Default: late afternoon.

## Interaction
- **Orbit** (default): damped `OrbitControls`, clamped above ground and within the bbox.
- **Fly-to**: panel buttons for CN Tower, Rogers Centre, Union Station, Financial District, Harbourfront, Nathan Phillips Square. Eased camera + target tween. CSS2D labels on those landmarks, fading with distance.
- **Street-level walk**: toggle button → `PointerLockControls`, WASD + Shift run, eye height 1.7 m, Esc to exit back to orbit. Collision against building footprints via a 2D spatial grid (point-in-polygon on nearby footprints).
- **UI**: small fixed glass-style panel (plain HTML/CSS): landmarks, time slider, mode toggle, controls help, loading screen with progress, OSM attribution (required by ODbL).

## Files
```
index.html            importmap, canvas, UI markup
styles.css
src/main.js           bootstrap, render loop, resize
src/data.js           load + parse data/toronto.json
src/city.js           buildings, roads, parks, land, water
src/landmarks/cnTower.js
src/landmarks/rogersCentre.js
src/environment.js    sky, lights, shadows, fog, time of day
src/postfx.js         composer, GTAO, output pass
src/controls.js       orbit, walk mode, collision grid, fly-to tweens
src/ui.js             panel, labels, loading screen
data/toronto.json     generated
tools/fetch-osm.mjs   extraction (dev only)
package.json          dev dependency for tools only
README.md             run locally, regenerate data, deploy
```

## Deployment (GitHub Pages)
`git init`, create repo with `gh`, push, enable Pages on `main` / root. These are public-facing steps; I will confirm the repo name and visibility with you before running them.

## Verification
1. Run `tools/fetch-osm.mjs`; check building count, how many heights are estimated, file size.
2. Serve locally (`npx serve .`), open in the browser pane: no console errors; landmarks sit at the right spots relative to OSM streets (CN Tower 43.6426, −79.3871; Rogers Centre 43.6414, −79.3894; Union Station across Front St).
3. Exercise each feature: orbit limits, every fly-to button, time slider through dawn/noon/dusk/night (windows and CN Tower lights on at night), walk mode with collision.
4. Check frame rate in orbit view at full extent; drop shadow map size / AO quality if it lags.
5. After deploy, load the Pages URL and repeat step 3 briefly.

## Known limits
- OSM heights are missing for some buildings; those use estimates, so a few towers will be off.
- Buildings are extrusions of footprints: no setbacks or spires except where OSM has `building:part` data.
