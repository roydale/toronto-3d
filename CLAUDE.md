# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Origin

Roy (Roy Dale Caliwag, GitHub `roydale`) created this repository as a sandbox app built with Claude for Windows.

## Commands

- `npm run serve`: serve the repo statically on http://localhost:5173. No build step exists; the browser loads `index.html` and the ES modules in `src/` directly.
- `npm run fetch-data`: regenerate `data/toronto.json` from OpenStreetMap through the Overpass API. The raw response is cached in `tools/cache/overpass.json` (gitignored); pass `-- --refresh` to refetch instead of reusing the cache.
- There are no tests, linter, or bundler. Verify changes by loading the page and checking the console. `window.toronto` exposes `{ scene, camera, renderer, controls, env, postfx, data }` for debugging.

Deployment is GitHub Pages serving the `main` branch root as-is (live at http://moiraiden.me/toronto-3d/). Anything committed is shipped, including `data/toronto.json`.

## Architecture

**Dependencies.** Three.js 0.187.0 comes from jsDelivr through the importmap in `index.html` (`three` and `three/addons/`). The only npm dependency is `osmtogeojson`, used by the data tool alone. Do not add runtime npm packages; they would need a bundler.

**Coordinate system, shared in two places.** The world origin is the CN Tower (43.6426, −79.3871); x points east, z points south, y up, in meters. The projection is implemented twice and the copies must stay identical: `project()` in `src/geo.js` (runtime) and the one in `tools/fetch-osm.mjs` (build time). The JSON stores coordinates as integer decimeters; `src/data.js` converts them to meters in Float32Arrays.

**Data pipeline (`tools/fetch-osm.mjs`).** Overpass query over a fixed bbox, then clipping (Sutherland–Hodgman for polygons, Liang–Barsky for polylines). Building height comes from `height`, else `building:levels × 3.5`, else a per-type default (flagged estimated); `min_height` is honored. Outlines that contain `building:part`s are dropped in favor of the parts. Buildings near the CN Tower and Rogers Centre (and any named like them) are excluded because those two are hand-modeled in `src/landmarks/`. Lake Ontario is a water relation, not coastline, so land is a plane and the lake is drawn as water polygons. Only the Gardiner (`bridge` + name match) gets road elevation.

**Rendering (`src/main.js` orchestrates).**
- `src/city.js`: all OSM buildings become one merged mesh with an `aWall` attribute; a shader patch via `onBeforeCompile` draws the window grid and the night-lit windows, driven by the shared `cityUniforms.uNight`. Ground layers (land, water, parks, rails, roads) are flat and use `depthWrite: false`, so their stacking is set entirely by `renderOrder` (−30 to −24). The sky must stay at −100 or it covers the ground. `buildCollisionGrid` is the 2D footprint grid used by walk mode.
- `src/environment.js`: the time-of-day hub. `setHour()` computes the sun for Toronto's latitude and derives everything else from it: sky, sun/hemisphere light, exposure, environment intensity, PMREM env map (refreshed every 0.25 h of change), and the `night` value in `env.state.night`. Fog color is sampled from the rendered sky with a tiny FloatType render-target probe, not set by hand. `updateShadow()` runs every frame; it scales fog with view distance and moves a texel-snapped shadow frustum to follow the camera focus.
- Per-frame `night` consumers: `cn.userData.update`, `rogers.userData.update`, `ground.userData.update`, and `cityUniforms.uNight`. New night-dependent elements should follow the same pattern.
- `src/postfx.js`: EffectComposer with an MSAA HalfFloat target, GTAO, and OutputPass (tone mapping happens there). `main.js` switches AO off automatically if frames stay over 25 ms for 2.5 s.

**Interaction.** `src/controls.js` owns orbit mode, `flyTo` tweens, and walk mode (pointer lock, with a drag-to-look fallback when lock is refused; spawns on the nearest street point; collides against the grid). Camera near plane is adjusted dynamically from view distance. `src/ui.js` builds the panel, CSS2D landmark labels, and loading screen from the `LANDMARKS` catalog in `src/geo.js`; each entry's `view` is `[distance, azimuthDeg, elevationDeg]` and its `id` doubles as the URL hash deep link (`#cn`, `#rogers`, …).

## Docs

`docs/PROMPT.md` holds the original request and scoping answers; `docs/PLAN.md` holds the build plan. Keep them separate. OSM data is ODbL: the attribution footer in `index.html` must stay.
