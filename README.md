# Downtown Toronto 3D

Interactive 3D model of downtown Toronto in the browser: real OpenStreetMap building footprints and heights, hand-modeled CN Tower and Rogers Centre, time-of-day lighting, landmark fly-to, and a street-level walk mode.

Plain ES modules plus [Three.js](https://threejs.org) from a CDN. No build step.

## Run locally

```powershell
npm run serve
```

Open http://localhost:5173. Any static server works; opening `index.html` from disk does not, because the page fetches `data/toronto.json`.

## Controls

- **Orbit:** drag to rotate, right-drag to pan, scroll to zoom.
- **Explore:** landmark buttons or labels fly the camera there. Deep links work: `#cn`, `#rogers`, `#union`, `#scotiabank`, `#financial`, `#nps`, `#harbourfront`, `#islands`.
- **Time of day:** slider, presets, or ▶ to animate.
- **Street-level walk:** WASD to move, Shift to run, mouse (pointer lock) or drag to look, Esc to exit.

## Regenerate the map data

```powershell
npm install
npm run fetch-data
```

`tools/fetch-osm.mjs` queries the Overpass API for the bounding box, projects to local meters (origin at the CN Tower, x east, z south), and writes `data/toronto.json`. The raw response is cached in `tools/cache/`; pass `--refresh` to refetch. Buildings without a `height` or `building:levels` tag get an estimated height by building type (about a third of them).

## Layout

| Path | Purpose |
|---|---|
| `index.html`, `styles.css` | Page, import map, UI |
| `src/main.js` | Bootstrap and render loop |
| `src/city.js` | Buildings (with window shader), ground layers, collision grid |
| `src/landmarks/` | CN Tower, Rogers Centre |
| `src/environment.js` | Sky, sun path, fog, stars, environment map |
| `src/postfx.js` | Ambient occlusion (GTAO) |
| `src/controls.js` | Orbit, fly-to, walk mode |
| `src/ui.js` | Panel, labels, loading screen |
| `docs/` | Original prompt and build plan |

## Data license

Map data © OpenStreetMap contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright).
