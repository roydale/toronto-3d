import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { project } from './geo.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createControls(camera, dom, bounds, collision, { onModeChange, streetPoints = [] } = {}) {
  // ---------------------------------------------------------- orbit
  const orbit = new OrbitControls(camera, dom);
  orbit.enableDamping = true;
  orbit.dampingFactor = 0.08;
  orbit.minDistance = 40;
  orbit.maxDistance = 6000;
  orbit.maxPolarAngle = THREE.MathUtils.degToRad(86);
  orbit.screenSpacePanning = false;
  orbit.zoomToCursor = true;

  const clampTarget = () => {
    const t = orbit.target;
    t.x = THREE.MathUtils.clamp(t.x, bounds.minX, bounds.maxX);
    t.z = THREE.MathUtils.clamp(t.z, bounds.minZ, bounds.maxZ);
    t.y = THREE.MathUtils.clamp(t.y, 0, 600);
    if (camera.position.y < 8) camera.position.y = 8;
  };

  // ---------------------------------------------------------- fly-to
  let tween = null;
  function flyTo(lm, duration = 2.4) {
    if (mode === 'walk') exitWalk();
    const p = project(lm.lat, lm.lon);
    const target = new THREE.Vector3(p.x, lm.y, p.z);
    const [dist, azDeg, elDeg] = lm.view;
    const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
    const pos = new THREE.Vector3(
      target.x - Math.sin(az) * Math.cos(el) * dist,
      target.y + Math.sin(el) * dist,
      target.z + Math.cos(az) * Math.cos(el) * dist,
    );
    // Arc up a little when traveling far.
    const travel = camera.position.distanceTo(pos);
    tween = {
      t: 0, duration,
      fromPos: camera.position.clone(), toPos: pos,
      fromTarget: orbit.target.clone(), toTarget: target,
      lift: Math.min(800, travel * 0.25),
    };
  }

  // ---------------------------------------------------------- walk
  const walk = new PointerLockControls(camera, document.body);
  const keys = new Set();
  let mode = 'orbit';
  const savedOrbit = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  const EYE = 1.7;
  // Request pointer lock without an unhandled rejection when the browser refuses it.
  const tryLock = () => { try { document.body.requestPointerLock?.()?.catch?.(() => {}); } catch {} };

  // Spawn on the nearest street centerline with clearance, falling back to a spiral search.
  function findFreeSpot(x, z) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < streetPoints.length; i += 2) {
      const d = (streetPoints[i] - x) ** 2 + (streetPoints[i + 1] - z) ** 2;
      if (d < bestD && !collision.blocked(streetPoints[i], streetPoints[i + 1], 3)) { bestD = d; best = [streetPoints[i], streetPoints[i + 1]]; }
    }
    if (best && bestD < 400 * 400) return best;
    for (let r = 4; r < 300; r += 4) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
        const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
        if (!collision.blocked(px, pz, 3)) return [px, pz];
      }
    }
    return [x, z];
  }

  function enterWalk() {
    if (mode === 'walk') return;
    tween = null;
    savedOrbit.pos.copy(camera.position);
    savedOrbit.target.copy(orbit.target);
    const [x, z] = findFreeSpot(orbit.target.x, orbit.target.z);
    // Face the direction the orbit camera was looking.
    const look = new THREE.Vector3().subVectors(orbit.target, camera.position).setY(0).normalize();
    camera.position.set(x, EYE, z);
    camera.lookAt(x + look.x, EYE, z + look.z);
    orbit.enabled = false;
    mode = 'walk';
    camera.near = 0.1;
    camera.updateProjectionMatrix();
    tryLock();
    onModeChange?.(mode);
  }

  function exitWalk() {
    if (mode !== 'walk') return;
    mode = 'orbit';
    if (walk.isLocked) walk.unlock();
    keys.clear();
    // Return to an orbit view above where the walk ended.
    const here = camera.position.clone().setY(0);
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion).setY(0).normalize();
    orbit.target.copy(here);
    camera.position.copy(here).addScaledVector(back, 320).setY(220);
    orbit.enabled = true;
    orbit.update();
    onModeChange?.(mode);
  }

  walk.addEventListener('unlock', () => { if (mode === 'walk') exitWalk(); });
  addEventListener('keydown', (e) => {
    if (mode !== 'walk') return;
    keys.add(e.code);
    if (e.code === 'Escape' && !walk.isLocked) exitWalk();
  });

  // Mouse look: pointer lock when the browser grants it, otherwise drag to look.
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let drag = null;
  dom.addEventListener('pointerdown', (e) => {
    if (mode !== 'walk' || walk.isLocked) return;
    drag = { x: e.clientX, y: e.clientY };
    tryLock();
  });
  addEventListener('pointermove', (e) => {
    if (!drag || walk.isLocked || mode !== 'walk') return;
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= (e.clientX - drag.x) * 0.004;
    euler.x = THREE.MathUtils.clamp(euler.x - (e.clientY - drag.y) * 0.004, -1.45, 1.45);
    camera.quaternion.setFromEuler(euler);
    drag = { x: e.clientX, y: e.clientY };
  });
  addEventListener('pointerup', () => { drag = null; });
  document.addEventListener('pointerlockerror', () => {});
  addEventListener('keyup', (e) => keys.delete(e.code));

  const fwd = new THREE.Vector3(), right = new THREE.Vector3();
  function updateWalk(dt) {
    const speed = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 14 : 4.5) * dt;
    camera.getWorldDirection(fwd).setY(0).normalize();
    right.crossVectors(fwd, camera.up).normalize();
    let mx = 0, mz = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) { mx += fwd.x; mz += fwd.z; }
    if (keys.has('KeyS') || keys.has('ArrowDown')) { mx -= fwd.x; mz -= fwd.z; }
    if (keys.has('KeyD') || keys.has('ArrowRight')) { mx += right.x; mz += right.z; }
    if (keys.has('KeyA') || keys.has('ArrowLeft')) { mx -= right.x; mz -= right.z; }
    const len = Math.hypot(mx, mz);
    if (!len) return;
    mx = (mx / len) * speed; mz = (mz / len) * speed;
    const p = camera.position;
    const clampX = (x) => THREE.MathUtils.clamp(x, bounds.minX, bounds.maxX);
    const clampZ = (z) => THREE.MathUtils.clamp(z, bounds.minZ, bounds.maxZ);
    // Slide along walls: try full move, then each axis.
    if (!collision.blocked(p.x + mx, p.z + mz)) { p.x = clampX(p.x + mx); p.z = clampZ(p.z + mz); }
    else if (!collision.blocked(p.x + mx, p.z)) p.x = clampX(p.x + mx);
    else if (!collision.blocked(p.x, p.z + mz)) p.z = clampZ(p.z + mz);
    p.y = EYE;
  }

  // ---------------------------------------------------------- per frame
  function update(dt) {
    if (mode === 'walk') { updateWalk(dt); return; }
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / tween.duration);
      const k = ease(tween.t);
      camera.position.lerpVectors(tween.fromPos, tween.toPos, k);
      camera.position.y += Math.sin(Math.PI * k) * tween.lift;
      orbit.target.lerpVectors(tween.fromTarget, tween.toTarget, k);
      if (tween.t >= 1) tween = null;
    }
    orbit.update();
    clampTarget();
    // Dynamic near plane keeps depth precision good from street level to overview.
    const d = camera.position.distanceTo(orbit.target);
    const near = THREE.MathUtils.clamp(d * 0.01, 0.5, 30);
    if (Math.abs(camera.near - near) > 0.05) { camera.near = near; camera.updateProjectionMatrix(); }
  }

  // Interrupt a fly-to when the user grabs the camera.
  orbit.addEventListener('start', () => { tween = null; });

  return {
    orbit, walk, update, flyTo, enterWalk, exitWalk,
    get mode() { return mode; },
    focus() { return mode === 'walk' ? camera.position : orbit.target; },
    viewDistance() { return mode === 'walk' ? 300 : camera.position.distanceTo(orbit.target); },
  };
}
