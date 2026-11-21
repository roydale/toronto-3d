import * as THREE from 'three';

// Shared uniforms driven by the environment (time of day).
export const cityUniforms = {
  uNight: { value: 0 },
};

const PALETTE = {
  0: 0xe9e5dd, // generic
  1: 0xe1e5e9, // office / commercial
  2: 0xece3d5, // retail
  3: 0xede5d9, // residential
  4: 0xe6dccb, // civic, churches, schools
  5: 0xddd3c2, // stations
  6: 0xd6d4ce, // parking
};
const TOWER_TINT = new THREE.Color(0xc8d3dd); // glassier tone for tall towers

// Deterministic per-building random.
function rand(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function signedAreaXZ(ring) {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return a / 2;
}

// ---------------------------------------------------------------- buildings
export function buildBuildings(buildings) {
  const pos = [], nor = [], col = [], wall = [], idx = [];
  let v = 0;
  const c = new THREE.Color();

  const pushV = (x, y, z, nx, ny, nz, color, u, isWall, seed) => {
    pos.push(x, y, z); nor.push(nx, ny, nz); col.push(color.r, color.g, color.b); wall.push(u, isWall, seed);
    return v++;
  };

  buildings.forEach((b, bi) => {
    const seed = rand(bi + 1);
    const top = b.h, bottom = b.m;
    if (top - bottom < 0.5) return;

    c.setHex(PALETTE[b.t] ?? PALETTE[0]);
    if (top > 90) c.lerp(TOWER_TINT, 0.65);
    c.multiplyScalar(0.94 + seed * 0.1);
    const wallColor = c.clone();
    const roofColor = c.clone().multiplyScalar(0.9);

    // Walls
    b.rings.forEach((ring, ri) => {
      const n = ring.length / 2;
      if (n < 3) return;
      const ccw = signedAreaXZ(ring) > 0;
      const flip = (ccw ? 1 : -1) * (ri === 0 ? 1 : -1);
      let u = 0;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
        const dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 1e-3) continue;
        // Outward normal in XZ.
        const nx = (dz / len) * flip, nz = (-dx / len) * flip;
        const i0 = pushV(ax, bottom, az, nx, 0, nz, wallColor, u, 1, seed);
        const i1 = pushV(bx, bottom, bz, nx, 0, nz, wallColor, u + len, 1, seed);
        const i2 = pushV(bx, top, bz, nx, 0, nz, wallColor, u + len, 1, seed);
        const i3 = pushV(ax, top, az, nx, 0, nz, wallColor, u, 1, seed);
        // Winding so the face normal (b-a) x up = (-dz, 0, dx) agrees with the outward normal.
        if (-dz * nx + dx * nz > 0) idx.push(i0, i1, i2, i0, i2, i3);
        else idx.push(i0, i2, i1, i0, i3, i2);
        u += len;
      }
    });

    // Roof (and underside for raised building parts)
    const toV2 = (ring) => {
      const out = [];
      for (let i = 0; i < ring.length; i += 2) out.push(new THREE.Vector2(ring[i], ring[i + 1]));
      return out;
    };
    const contour = toV2(b.rings[0]);
    const holes = b.rings.slice(1).map(toV2).filter((h) => h.length >= 3);
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch { return; }
    const all = contour.concat(...holes);
    const caps = bottom > 0.5 ? [[top, 1], [bottom, -1]] : [[top, 1]];
    for (const [y, dir] of caps) {
      const base = v;
      for (const p of all) pushV(p.x, y, p.y, 0, dir, 0, roofColor, 0, 0, seed);
      for (const [a, b2, c2] of tris) {
        const A = all[a], B = all[b2], C = all[c2];
        // y-component of (B-A) x (C-A) in (x, y, z) with points (x, 0, z)
        const ny = (B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y);
        if (ny * dir > 0) idx.push(base + a, base + b2, base + c2);
        else idx.push(base + a, base + c2, base + b2);
      }
    }
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = cityUniforms.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aWall;
        varying vec3 vWall;
        varying float vWorldY;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vWall = aWall;
        vWorldY = (modelMatrix * vec4(transformed, 1.0)).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight;
        varying vec3 vWall;
        varying float vWorldY;
        float hash13(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.zyx + 31.32);
          return fract((p.x + p.y) * p.z);
        }
        float gWin; float gDetail; vec2 gCell;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 cell = vec2(vWall.x / 3.2, vWorldY / 3.6);
          vec2 f = fract(cell);
          vec2 fw = fwidth(cell);
          gDetail = 1.0 - smoothstep(0.2, 0.55, max(fw.x, fw.y));
          vec2 lo = smoothstep(vec2(0.2), vec2(0.2) + fw, f);
          vec2 hi = 1.0 - smoothstep(vec2(0.8) - fw, vec2(0.8), f);
          float floorOk = step(0.9, vWorldY);
          gWin = lo.x * lo.y * hi.x * hi.y * vWall.y * floorOk;
          gCell = floor(cell);
          // Daytime: windows read as slightly darker, cooler glass. Fades to an average tint far away.
          float tint = mix(0.36 * vWall.y, gWin, gDetail) * 0.5;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.66, 0.74, 0.84), tint);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uNight > 0.001 && vWall.y > 0.5) {
          float bLit = 0.25 + 0.35 * hash13(vec3(vWall.z * 91.0, 3.1, 7.7));
          float r = hash13(vec3(gCell, vWall.z * 113.0));
          float lit = step(r, bLit);
          float warmth = step(0.82, hash13(vec3(gCell.yx, vWall.z * 57.0)));
          vec3 lampCol = mix(vec3(1.0, 0.74, 0.42), vec3(0.78, 0.86, 1.0), warmth);
          float near = gWin * lit;
          float far = 0.36 * bLit * 0.15; // averaged glow when windows are sub-pixel
          totalEmissiveRadiance += lampCol * mix(far, near, gDetail) * uNight * 2.2;
        }`);
  };

  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'buildings';
  return mesh;
}

// ---------------------------------------------------------------- ground layers
// Ground layers are coplanar; they are drawn first, in renderOrder, without depth writes,
// so later layers paint over earlier ones and buildings always draw on top.
function groundMaterial(color, order, extra = {}) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, depthWrite: false, ...extra });
  m.userData.order = order;
  return m;
}
function groundMesh(geo, mat) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = mat.userData.order;
  mesh.receiveShadow = true;
  return mesh;
}

function polygonsGeometry(polys, y = 0) {
  const pos = [], idx = [];
  let v = 0;
  for (const rings of polys) {
    const toV2 = (ring) => {
      const out = [];
      for (let i = 0; i < ring.length; i += 2) out.push(new THREE.Vector2(ring[i], ring[i + 1]));
      return out;
    };
    const contour = toV2(rings[0]);
    if (contour.length < 3) continue;
    const holes = rings.slice(1).map(toV2).filter((h) => h.length >= 3);
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch { continue; }
    const all = contour.concat(...holes);
    for (const p of all) pos.push(p.x, y, p.y);
    for (const [a, b, c] of tris) {
      const A = all[a], B = all[b], C = all[c];
      const ny = (B.y - A.y) * (C.x - A.x) - (B.x - A.x) * (C.y - A.y);
      if (ny > 0) idx.push(v + a, v + b, v + c); else idx.push(v + a, v + c, v + b);
    }
    v += all.length;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const ROAD_WIDTH = [24, 18, 14, 12, 10, 7.5, 4.5, 4];
const ROAD_COLOR = [0xa8a49c, 0xaeaaa2, 0xb6b2aa, 0xbbb7af, 0xbfbbb3, 0xc5c1b9, 0xcac6be, 0xd0ccc3];

// Flat ribbon along a polyline (x,z pairs) at height y, with mitered joints.
function ribbon(points, width, y, out, color) {
  const n = points.length / 2;
  if (n < 2) return;
  const hw = width / 2;
  const base = out.pos.length / 3;
  for (let i = 0; i < n; i++) {
    const x = points[i * 2], z = points[i * 2 + 1];
    const px = i > 0 ? points[i * 2 - 2] : x, pz = i > 0 ? points[i * 2 - 1] : z;
    const nx2 = i < n - 1 ? points[i * 2 + 2] : x, nz2 = i < n - 1 ? points[i * 2 + 3] : z;
    let d1x = x - px, d1z = z - pz, d2x = nx2 - x, d2z = nz2 - z;
    const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1;
    d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    if (i === 0) { d1x = d2x; d1z = d2z; }
    if (i === n - 1) { d2x = d1x; d2z = d1z; }
    let tx = d1x + d2x, tz = d1z + d2z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    const miter = Math.min(2.5, 1 / Math.max(0.2, nx * -d1z + nz * d1x));
    out.pos.push(x + nx * hw * miter, y, z + nz * hw * miter, x - nx * hw * miter, y, z - nz * hw * miter);
    if (out.col) out.col.push(color.r, color.g, color.b, color.r, color.g, color.b);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
    // Left vertex a, right vertex b. Pick winding with upward normal.
    const ax = out.pos[a * 3], az = out.pos[a * 3 + 2];
    const bx = out.pos[b * 3], bz = out.pos[b * 3 + 2];
    const cx = out.pos[c * 3], cz = out.pos[c * 3 + 2];
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny > 0) out.idx.push(a, b, c, b, d, c); else out.idx.push(a, c, b, b, c, d);
  }
}

function ribbonGeometry(out) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  if (out.col) geo.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
  geo.setIndex(out.idx);
  geo.computeVertexNormals();
  return geo;
}

export function buildGround(data) {
  const group = new THREE.Group();
  group.name = 'ground';
  const { minX, maxX, minZ, maxZ } = data.bounds;
  const SHORE_Z = 250; // outside the data area, treat everything south of this as lake

  const landMat = groundMaterial(0xdcd6c9, -30);
  const waterMat = groundMaterial(0x8fb2c6, -29, { roughness: 0.22, metalness: 0.0, envMapIntensity: 1.2 });

  // Outer world beyond the data area.
  const BIG = 40000;
  const outerLand = new THREE.PlaneGeometry(2 * BIG, BIG + SHORE_Z).rotateX(-Math.PI / 2).translate(0, 0, (SHORE_Z - BIG) / 2);
  const outerLake = new THREE.PlaneGeometry(2 * BIG, BIG).rotateX(-Math.PI / 2).translate(0, 0, SHORE_Z + BIG / 2);
  group.add(groundMesh(outerLand, landMat));
  group.add(groundMesh(outerLake, waterMat));

  // Inside the data area: land rectangle then the lake/pond polygons.
  const landRect = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ).rotateX(-Math.PI / 2).translate((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  const innerLand = groundMaterial(0xdcd6c9, -28);
  group.add(groundMesh(landRect, innerLand));
  const water = groundMesh(polygonsGeometry(data.water), groundMaterial(0x8fb2c6, -27, { roughness: 0.22, envMapIntensity: 1.2 }));
  water.name = 'water';
  group.add(water);

  group.add(groundMesh(polygonsGeometry(data.parks), groundMaterial(0xb3c9a0, -26)));

  // Rails
  const railOut = { pos: [], idx: [] };
  for (const r of data.rails) ribbon(r, 3.2, 0, railOut);
  group.add(groundMesh(ribbonGeometry(railOut), groundMaterial(0xa9a398, -25)));

  // Roads at grade, drawn widest class last so major roads sit on top.
  const roadOut = { pos: [], idx: [], col: [] };
  const elevated = [];
  const sorted = [...data.roads].sort((a, b) => b.c - a.c);
  const col = new THREE.Color();
  for (const r of sorted) {
    if (r.e > 0) { elevated.push(r); continue; }
    col.setHex(ROAD_COLOR[r.c] ?? ROAD_COLOR[6]);
    ribbon(r.p, ROAD_WIDTH[r.c] ?? 5, 0, roadOut, col);
  }
  const roadMat = groundMaterial(0xffffff, -24, { vertexColors: true });
  group.add(groundMesh(ribbonGeometry(roadOut), roadMat));
  // Streetlight glow on roads at night.
  group.userData.update = (night) => roadMat.emissive.setRGB(1.0, 0.68, 0.38).multiplyScalar(night * 0.06);

  // Elevated expressway: deck + parapet skirts + columns. Normal depth handling.
  if (elevated.length) group.add(buildElevated(elevated));
  return group;
}

function buildElevated(roads) {
  const g = new THREE.Group();
  const deck = { pos: [], idx: [] };
  const skirtPos = [], skirtIdx = [];
  const columns = [];
  for (const r of roads) {
    const w = ROAD_WIDTH[r.c] ?? 12;
    const y = r.e;
    ribbon(r.p, w, y, deck);
    const n = r.p.length / 2;
    let acc = 0;
    for (let i = 0; i < n - 1; i++) {
      const ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[i * 2 + 2], bz = r.p[i * 2 + 3];
      const len = Math.hypot(bx - ax, bz - az);
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (const s of [1, -1]) {
        const ox = nx * w / 2 * s, oz = nz * w / 2 * s;
        const b = skirtPos.length / 3;
        skirtPos.push(ax + ox, y + 1.1, az + oz, bx + ox, y + 1.1, bz + oz, bx + ox, y - 1.6, bz + oz, ax + ox, y - 1.6, az + oz);
        skirtIdx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      }
      // columns every ~35 m
      for (let t = (35 - acc % 35); t < len; t += 35) {
        columns.push([ax + (bx - ax) * t / len, az + (bz - az) * t / len]);
      }
      acc += len;
    }
  }
  const concrete = new THREE.MeshStandardMaterial({ color: 0xcfcac0, roughness: 0.9 });
  const deckMesh = new THREE.Mesh(ribbonGeometry(deck), new THREE.MeshStandardMaterial({ color: 0xa8a49c, roughness: 0.9 }));
  deckMesh.castShadow = deckMesh.receiveShadow = true;
  const skirtGeo = new THREE.BufferGeometry();
  skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(skirtPos, 3));
  skirtGeo.setIndex(skirtIdx);
  skirtGeo.computeVertexNormals();
  const skirt = new THREE.Mesh(skirtGeo, new THREE.MeshStandardMaterial({ color: 0xcfcac0, roughness: 0.9, side: THREE.DoubleSide }));
  skirt.castShadow = skirt.receiveShadow = true;
  g.add(deckMesh, skirt);

  if (columns.length) {
    const colGeo = new THREE.BoxGeometry(2.2, 1, 2.2).translate(0, 0.5, 0);
    const inst = new THREE.InstancedMesh(colGeo, concrete, columns.length);
    const m = new THREE.Matrix4();
    columns.forEach(([x, z], i) => { m.makeScale(1, 10.4, 1).setPosition(x, 0, z); inst.setMatrixAt(i, m); });
    inst.castShadow = inst.receiveShadow = true;
    g.add(inst);
  }
  g.name = 'elevated';
  return g;
}

// ---------------------------------------------------------------- collision footprints
// 2D grid of ground-level footprints for walk-mode collision.
export function buildCollisionGrid(buildings, cellSize = 40) {
  const grid = new Map();
  const key = (gx, gz) => gx * 100003 + gz;
  for (const b of buildings) {
    if (b.m > 2.5) continue; // raised parts don't block the street
    const ring = b.rings[0];
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]);
      z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]);
    }
    const entry = { ring, x0, x1, z0, z1 };
    for (let gx = Math.floor(x0 / cellSize); gx <= Math.floor(x1 / cellSize); gx++)
      for (let gz = Math.floor(z0 / cellSize); gz <= Math.floor(z1 / cellSize); gz++) {
        const k = key(gx, gz);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(entry);
      }
  }
  const circles = [];
  return {
    addCircle(x, z, r) { circles.push({ x, z, r }); },
    blocked(x, z, pad = 0.4) {
      for (const c of circles) if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
      const list = grid.get(key(Math.floor(x / cellSize), Math.floor(z / cellSize)));
      if (!list) return false;
      for (const e of list) {
        if (x < e.x0 - pad || x > e.x1 + pad || z < e.z0 - pad || z > e.z1 + pad) continue;
        if (pointInRing(x, z, e.ring) || distToRing(x, z, e.ring) < pad) return true;
      }
      return false;
    },
  };
}

function pointInRing(x, z, r) {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function distToRing(x, z, r) {
  let best = Infinity;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const ax = r[j * 2], az = r[j * 2 + 1], bx = r[i * 2], bz = r[i * 2 + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
}
