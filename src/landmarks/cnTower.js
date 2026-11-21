import * as THREE from 'three';

// CN Tower, 553.3 m. Origin of the world is the tower's center.
// Dimensions are approximate, tuned for silhouette.
export function buildCNTower() {
  const g = new THREE.Group();
  g.name = 'cn-tower';

  const concrete = new THREE.MeshStandardMaterial({ color: 0xe6e1d8, roughness: 0.75 });
  // Shaft lighting at night (the tower is lit in slowly shifting colors).
  const lit = new THREE.MeshStandardMaterial({ color: 0xe6e1d8, roughness: 0.75, emissive: 0x000000 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x3b4a58, roughness: 0.25, metalness: 0.4, emissive: 0x000000 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.45, metalness: 0.6 });
  const beacon = new THREE.MeshBasicMaterial({ color: 0xff2a1a });

  const add = (geo, mat, y = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };

  // Hexagonal core shaft from ground to the SkyPod.
  add(new THREE.CylinderGeometry(6.2, 9.5, 450, 6, 1).translate(0, 225, 0), lit);

  // Three tapering buttress legs forming the Y-shaped base.
  const leg = new THREE.Shape();
  leg.moveTo(0, 0);
  leg.lineTo(34, 0);
  leg.bezierCurveTo(24, 40, 12, 160, 7.5, 335);
  leg.lineTo(0, 335);
  leg.closePath();
  const legGeo = new THREE.ExtrudeGeometry(leg, { depth: 8, bevelEnabled: false, curveSegments: 24 }).translate(0, 0, -4);
  for (let i = 0; i < 3; i++) {
    const m = add(legGeo, lit);
    m.rotation.y = (i * 2 * Math.PI) / 3 + Math.PI / 2;
  }

  // Main pod (~335–370 m): white microwave "doughnut", dark glass band, white decks.
  const lathe = (pts, mat, segs = 48) =>
    add(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), segs), mat);
  lathe([[7, 330], [19, 336], [24, 340], [24.5, 343], [21, 345]], white);           // lower ring
  lathe([[21, 345], [23.5, 347], [23.5, 354], [20.5, 357]], glass);                    // windows
  lathe([[20.5, 357], [21.5, 358], [21.5, 361], [17, 364], [12, 366], [7, 368]], white); // upper decks
  lathe([[16.5, 361.5], [17.2, 362.5]], glass);

  // SkyPod (~447 m).
  lathe([[6.2, 440], [9.5, 443], [10, 446], [10, 450], [8, 452], [5, 454]], white);
  lathe([[9.6, 446], [10.2, 448], [9.6, 450]], glass);

  // Antenna mast to 553 m.
  add(new THREE.CylinderGeometry(3.2, 4.8, 12, 12).translate(0, 460, 0), white);
  add(new THREE.CylinderGeometry(1.6, 3.2, 60, 12).translate(0, 496, 0), metal);
  add(new THREE.CylinderGeometry(0.5, 1.6, 27.3, 8).translate(0, 539.6, 0), metal);

  // Aviation beacons.
  const beacons = [];
  for (const y of [553.3, 520, 470]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(y > 550 ? 1.6 : 1.1, 10, 8), beacon);
    b.position.y = y;
    g.add(b);
    beacons.push(b);
  }

  // Night lighting update: color cycles slowly, beacons blink.
  const hue = new THREE.Color();
  g.userData.update = (time, night) => {
    hue.setHSL((time * 0.02) % 1, 0.6, 0.5);
    lit.emissive.copy(hue).multiplyScalar(night * 0.3);
    glass.emissive.setRGB(1.0, 0.78, 0.5).multiplyScalar(night * 0.6);
    const on = night > 0.05 ? (Math.sin(time * 3) > 0 ? 1 : 0.15) : 0.6;
    for (const b of beacons) b.material.color.setRGB(on, on * 0.15, on * 0.08);
  };
  return g;
}
