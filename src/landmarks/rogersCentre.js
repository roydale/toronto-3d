import * as THREE from 'three';

// Rogers Centre: ~205 m diameter, retractable segmented dome, apex ~86 m.
export function buildRogersCentre() {
  const g = new THREE.Group();
  g.name = 'rogers-centre';

  const concrete = new THREE.MeshStandardMaterial({ color: 0xe4dfd5, roughness: 0.85 });
  const band = new THREE.MeshStandardMaterial({ color: 0x9fa9b2, roughness: 0.5, metalness: 0.2, emissive: 0x000000 });
  const roof = new THREE.MeshStandardMaterial({ color: 0xf1efea, roughness: 0.55, metalness: 0.05, flatShading: true });
  const seam = new THREE.MeshStandardMaterial({ color: 0xa7a59f, roughness: 0.6 });

  const add = (geo, mat) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    return m;
  };

  const R = 102;
  const RIM = 52;
  // Podium and stadium walls.
  add(new THREE.CylinderGeometry(R + 6, R + 8, 6, 64).translate(0, 3, 0), concrete);
  add(new THREE.CylinderGeometry(R, R + 2, 30, 64, 1, true).translate(0, 21, 0), concrete);
  add(new THREE.CylinderGeometry(R - 0.5, R, 14, 64, 1, true).translate(0, 43, 0), band);       // glazed band
  add(new THREE.CylinderGeometry(R, R - 0.5, 4, 64, 1, true).translate(0, RIM - 2, 0), concrete);
  add(new THREE.TorusGeometry(R, 1.6, 8, 96).rotateX(Math.PI / 2).translate(0, RIM, 0), concrete);

  // Dome as a spherical cap from the rim to an apex at 86 m.
  const capH = 86 - RIM;
  const Rs = (R * R + capH * capH) / (2 * capH);
  const theta = Math.asin(R / Rs);
  const dome = new THREE.SphereGeometry(Rs, 64, 14, 0, Math.PI * 2, 0, theta).translate(0, 86 - Rs, 0);
  add(dome, roof);

  // Panel seams: arcs across the dome in vertical planes (x = const).
  const cy = 86 - Rs;
  for (const d of [-62, -22, 22, 62]) {
    const rr = Math.sqrt(Rs * Rs - d * d);
    const pts = [];
    for (let i = 0; i <= 48; i++) {
      const a = -Math.PI / 2 + (i / 48) * Math.PI;
      const z = rr * Math.sin(a), y = cy + rr * Math.cos(a);
      if (y < RIM - 0.5 || Math.hypot(d, z) > R) continue;
      pts.push(new THREE.Vector3(d, y + 0.3, z));
    }
    if (pts.length > 2) add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.9, 6), seam);
  }

  g.userData.update = (time, night) => {
    band.emissive.setRGB(0.95, 0.85, 0.7).multiplyScalar(night * 0.5);
  };
  return g;
}
