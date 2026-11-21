// One-time extraction of downtown Toronto from OpenStreetMap (Overpass API)
// into a compact, locally projected JSON file: data/toronto.json.
// Usage: node tools/fetch-osm.mjs [--refresh]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import osmtogeojson from 'osmtogeojson';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'tools/cache/overpass.json');
const OUT = path.join(ROOT, 'data/toronto.json');

// Bounding box (south, west, north, east) and projection origin (CN Tower).
const BBOX = { s: 43.603, w: -79.402, n: 43.662, e: -79.363 };
const ORIGIN = { lat: 43.6426, lon: -79.3871 };
const LANDMARK_EXCLUDE = [
  { name: 'CN Tower', lat: 43.6426, lon: -79.3871, r: 40 },
  { name: 'Rogers Centre', lat: 43.6414, lon: -79.3894, r: 125 },
];

const R = 6378137;
const COS0 = Math.cos((ORIGIN.lat * Math.PI) / 180);
// Planar projection with y = north (math orientation). Converted to z = -y on output.
const proj = ([lon, lat]) => [
  ((lon - ORIGIN.lon) * Math.PI / 180) * R * COS0,
  ((lat - ORIGIN.lat) * Math.PI / 180) * R,
];
const [minX, minY] = proj([BBOX.w, BBOX.s]);
const [maxX, maxY] = proj([BBOX.e, BBOX.n]);
const RECT = { minX, minY, maxX, maxY };

// ---------------------------------------------------------------- fetch
async function fetchOverpass() {
  if (fs.existsSync(CACHE) && !process.argv.includes('--refresh')) {
    console.log('Using cached Overpass response');
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  }
  const b = `${BBOX.s},${BBOX.w},${BBOX.n},${BBOX.e}`;
  const query = `[out:json][timeout:240];
(
  way["building"](${b}); relation["building"](${b});
  way["building:part"](${b}); relation["building:part"](${b});
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|residential|unclassified|living_street|pedestrian|service)$"](${b});
  way["railway"="rail"](${b});
  way["leisure"~"^(park|garden|pitch|playground)$"](${b}); relation["leisure"="park"](${b});
  way["landuse"~"^(grass|recreation_ground|village_green)$"](${b});
  way["natural"="water"](${b}); relation["natural"="water"](${b});
);
out body; >; out skel qt;`;
  console.log('Querying Overpass API…');
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'toronto-3d-extract/1.0' },
    body: 'data=' + encodeURIComponent(query),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${await res.text()}`);
  const json = await res.json();
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(json));
  return json;
}

// ---------------------------------------------------------------- geometry helpers
const area = (ring) => {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2; // > 0 means counter-clockwise (y up)
};
const centroid = (ring) => {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
};
const pointInRing = (pt, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const openRing = (ring) => {
  const r = ring.slice();
  const a = r[0], b = r[r.length - 1];
  if (r.length > 1 && a[0] === b[0] && a[1] === b[1]) r.pop();
  return r;
};
const inRect = (p) => p[0] >= RECT.minX && p[0] <= RECT.maxX && p[1] >= RECT.minY && p[1] <= RECT.maxY;

// Sutherland–Hodgman polygon clip to RECT.
function clipPolygon(ring) {
  const edges = [
    (p) => p[0] >= RECT.minX, (p) => p[0] <= RECT.maxX,
    (p) => p[1] >= RECT.minY, (p) => p[1] <= RECT.maxY,
  ];
  const inter = [
    (a, b) => lerpAt(a, b, 0, RECT.minX), (a, b) => lerpAt(a, b, 0, RECT.maxX),
    (a, b) => lerpAt(a, b, 1, RECT.minY), (a, b) => lerpAt(a, b, 1, RECT.maxY),
  ];
  let out = ring;
  for (let k = 0; k < 4 && out.length; k++) {
    const input = out; out = [];
    for (let i = 0; i < input.length; i++) {
      const cur = input[i], prev = input[(i + input.length - 1) % input.length];
      const ci = edges[k](cur), pi = edges[k](prev);
      if (ci) { if (!pi) out.push(inter[k](prev, cur)); out.push(cur); }
      else if (pi) out.push(inter[k](prev, cur));
    }
  }
  return out;
}
function lerpAt(a, b, axis, v) {
  const t = (v - a[axis]) / (b[axis] - a[axis]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

// Liang–Barsky segment clip; returns [p, q] or null.
function clipSegment(a, b) {
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const checks = [[-dx, a[0] - RECT.minX], [dx, RECT.maxX - a[0]], [-dy, a[1] - RECT.minY], [dy, RECT.maxY - a[1]]];
  for (const [p, q] of checks) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
    else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy], t0 > 0, t1 < 1];
}

// Clip a polyline into pieces fully inside RECT.
function clipPolyline(line) {
  const pieces = [];
  let cur = null;
  for (let i = 0; i < line.length - 1; i++) {
    const c = clipSegment(line[i], line[i + 1]);
    if (!c) { if (cur) { pieces.push(cur); cur = null; } continue; }
    const [p, q, enteredMid, exitedMid] = c;
    if (!cur || enteredMid) { if (cur) pieces.push(cur); cur = [p]; }
    cur.push(q);
    if (exitedMid) { pieces.push(cur); cur = null; }
  }
  if (cur) pieces.push(cur);
  return pieces.filter((p) => p.length >= 2);
}

// ---------------------------------------------------------------- tag parsing
const num = (v) => {
  if (v == null) return NaN;
  const s = String(v).trim();
  const ft = /(\d+(?:\.\d+)?)\s*(?:'|ft)/.exec(s);
  if (ft) return parseFloat(ft[1]) * 0.3048;
  return parseFloat(s.replace(',', '.'));
};
const DEFAULT_HEIGHT = {
  house: 8, detached: 8, semidetached_house: 8, terrace: 9, garage: 3.5, garages: 3.5, shed: 3, kiosk: 3,
  church: 18, cathedral: 25, train_station: 16, transportation: 10, parking: 14, retail: 8, school: 12,
  university: 18, college: 18, hospital: 30, hotel: 40, office: 40, commercial: 24, apartments: 30,
  residential: 15, industrial: 10, warehouse: 9, stadium: 30, public: 16, civic: 16, government: 20,
};
const TYPE_CODE = { office: 1, commercial: 1, retail: 2, apartments: 3, residential: 3, house: 3, terrace: 3, hotel: 1, church: 4, cathedral: 4, train_station: 5, transportation: 5, university: 4, college: 4, school: 4, civic: 4, public: 4, government: 4, parking: 6, garage: 6 };

function heights(tags) {
  let h = num(tags.height);
  let estimated = false;
  const levels = num(tags['building:levels']);
  if (!(h > 0)) {
    if (levels > 0) h = levels * 3.5 + (tags['roof:levels'] ? num(tags['roof:levels']) * 3 || 0 : 0);
    else { h = DEFAULT_HEIGHT[tags.building] ?? DEFAULT_HEIGHT[tags['building:part']] ?? 12; estimated = true; }
  }
  let m = num(tags.min_height);
  if (!(m >= 0)) {
    const ml = num(tags['building:min_level']);
    m = ml > 0 ? ml * 3.5 : 0;
  }
  if (m >= h) m = Math.max(0, h - 3);
  return { h, m, estimated };
}

// ---------------------------------------------------------------- main
const q = (v) => Math.round(v * 10); // decimeters, integer
const flat = (ring) => ring.flatMap(([x, y]) => [q(x), q(-y)]); // to x east, z south
const polysOf = (geom) => (geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []);

const osm = await fetchOverpass();
console.log(`Elements: ${osm.elements.length}`);
const gj = osmtogeojson(osm, { flatProperties: true });

const excl = LANDMARK_EXCLUDE.map((l) => ({ ...l, p: proj([l.lon, l.lat]) }));
const buildingFeatures = [], parts = [];
const roads = [], rails = [], parks = [], water = [];
const ROAD_CLASS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'pedestrian'];
const roadClass = (hw) => {
  const base = hw.replace('_link', '');
  if (base === 'unclassified' || base === 'living_street') return 5;
  const i = ROAD_CLASS.indexOf(base);
  return i < 0 ? 6 : i;
};

for (const f of gj.features) {
  const t = f.properties;
  const g = f.geometry;
  if (!g) continue;
  if ((t.building || t['building:part']) && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
    if (['roof', 'bridge', 'no', 'demolished'].includes(t.building) || t['building:part'] === 'roof' && !t.min_height) continue;
    for (const poly of polysOf(g)) {
      const rings = poly.map((r) => openRing(r.map(proj)));
      if (rings[0].length < 3) continue;
      const c = centroid(rings[0]);
      if (!inRect(c)) continue;
      if (excl.some((e) => Math.hypot(c[0] - e.p[0], c[1] - e.p[1]) < e.r) || /CN Tower|Rogers Cent/i.test(t.name || '')) continue;
      const rec = { rings, c, tags: t, isPart: !!t['building:part'] && !t.building };
      (rec.isPart ? parts : buildingFeatures).push(rec);
    }
  } else if (t.highway && g.type === 'LineString') {
    const bridge = t.bridge && t.bridge !== 'no';
    // Only the elevated Gardiner is raised; other bridges stay at grade (their approaches are not modeled).
    const elev = /Gardiner/i.test(t.name || '') && bridge ? 12 : 0;
    for (const piece of clipPolyline(g.coordinates.map(proj))) {
      roads.push({ c: roadClass(t.highway), e: elev, p: flat(piece) });
    }
  } else if (t.railway === 'rail' && g.type === 'LineString') {
    if (t.tunnel && t.tunnel !== 'no') continue;
    for (const piece of clipPolyline(g.coordinates.map(proj))) rails.push(flat(piece));
  } else if ((t.leisure || t.landuse || t.natural === 'water') && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
    const target = t.natural === 'water' ? water : parks;
    for (const poly of polysOf(g)) {
      const rings = poly.map((r) => clipPolygon(openRing(r.map(proj)))).filter((r) => r.length >= 3);
      if (rings.length && Math.abs(area(rings[0])) > 30) target.push(rings.map(flat));
    }
  }
}

// Outlines that have building:part children are replaced by those parts (OSM Simple 3D Buildings).
const cell = 50, grid = new Map();
const gk = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
for (const p of parts) { const k = gk(...p.c); (grid.get(k) || grid.set(k, []).get(k)).push(p); }
const outlines = buildingFeatures.filter((b) => {
  const xs = b.rings[0].map((p) => p[0]), ys = b.rings[0].map((p) => p[1]);
  for (let gx = Math.floor(Math.min(...xs) / cell); gx <= Math.floor(Math.max(...xs) / cell); gx++)
    for (let gy = Math.floor(Math.min(...ys) / cell); gy <= Math.floor(Math.max(...ys) / cell); gy++)
      for (const p of grid.get(`${gx},${gy}`) || []) if (pointInRing(p.c, b.rings[0])) return false;
  return true;
});

let estimatedCount = 0;
const buildings = [...outlines, ...parts].map((b) => {
  const { h, m, estimated } = heights(b.tags);
  if (estimated) estimatedCount++;
  const type = TYPE_CODE[b.tags.building] ?? TYPE_CODE[b.tags['building:part']] ?? 0;
  return { h: Math.round(h * 10) / 10, m: Math.round(m * 10) / 10, t: type, e: estimated ? 1 : 0, r: b.rings.map(flat) };
});


const out = {
  origin: ORIGIN,
  units: 'decimeters; x east, z south, origin at CN Tower',
  bounds: { minX: q(RECT.minX), maxX: q(RECT.maxX), minZ: q(-RECT.maxY), maxZ: q(-RECT.minY) },
  roadClasses: ROAD_CLASS,
  buildings, roads, rails, parks, water,
};
fs.writeFileSync(OUT, JSON.stringify(out));
const size = fs.statSync(OUT).size;
console.log(`Buildings: ${buildings.length} (${parts.length} parts, ${estimatedCount} estimated heights)`);
console.log(`Roads: ${roads.length}, rails: ${rails.length}, parks: ${parks.length}, water: ${water.length}`);
console.log(`Wrote ${OUT} (${(size / 1e6).toFixed(2)} MB)`);
