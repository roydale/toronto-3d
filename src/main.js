import * as THREE from 'three';
import { loadCityData } from './data.js';
import { buildBuildings, buildGround, buildCollisionGrid } from './city.js';
import { buildCNTower } from './landmarks/cnTower.js';
import { buildRogersCentre } from './landmarks/rogersCentre.js';
import { createEnvironment } from './environment.js';
import { createPostFX } from './postfx.js';
import { createControls } from './controls.js';
import { createUI, setLoading, hideLoading, showError } from './ui.js';
import { LANDMARKS, project } from './geo.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function main() {
  const canvas = document.querySelector('#scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 1, 40000);

  // Data
  setLoading('Downloading map data…', 0.05);
  const EXPECTED = 1.5e6;
  const data = await loadCityData('data/toronto.json', (bytes) =>
    setLoading(`Downloading map data… ${(bytes / 1e6).toFixed(1)} MB`, 0.05 + 0.55 * Math.min(1, bytes / EXPECTED)));

  setLoading(`Building ${data.buildings.length.toLocaleString()} buildings…`, 0.65);
  await nextFrame();
  scene.add(buildBuildings(data.buildings));

  setLoading('Laying streets, parks and the lake…', 0.8);
  await nextFrame();
  const ground = buildGround(data);
  scene.add(ground);

  setLoading('Raising the CN Tower…', 0.9);
  await nextFrame();
  const cn = buildCNTower();
  scene.add(cn);
  const rogers = buildRogersCentre();
  const rc = project(43.6414, -79.3894);
  rogers.position.set(rc.x, 0, rc.z);
  scene.add(rogers);

  const collision = buildCollisionGrid(data.buildings);
  collision.addCircle(0, 0, 36);
  collision.addCircle(rc.x, rc.z, 110);

  const env = createEnvironment(renderer, scene);
  const postfx = createPostFX(renderer, scene, camera);

  let ui;
  // Street centerline samples for walk-mode spawning (skip motorways and service lanes).
  const streetPoints = [];
  for (const r of data.roads) if (r.e === 0 && r.c >= 1 && r.c <= 5) for (let i = 0; i < r.p.length; i += 2) streetPoints.push(r.p[i], r.p[i + 1]);
  const controls = createControls(camera, canvas, data.bounds, collision, { onModeChange: (m) => ui?.onModeChange(m), streetPoints });
  ui = createUI({ scene, camera, controls, env, postfx });

  // Opening view: from the southwest over the lake toward the CN Tower and the core.
  camera.position.set(-1450, 520, 1500);
  controls.orbit.target.set(150, 120, -250);
  controls.orbit.update();

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    postfx.setSize(innerWidth, innerHeight);
    ui.setSize(innerWidth, innerHeight);
  }
  addEventListener('resize', resize);
  resize();

  // Deep links: #cn, #rogers, … fly to that landmark.
  const fromHash = () => {
    const lm = LANDMARKS.find((l) => l.id === location.hash.slice(1));
    if (lm) controls.flyTo(lm, 0.01);
  };
  addEventListener('hashchange', fromHash);
  fromHash();

  const timer = new THREE.Timer();
  timer.connect(document);
  setLoading('Ready', 1);
  hideLoading();

  // Adaptive quality: if the frame rate stays under ~40 fps, switch ambient occlusion off once.
  const aoBox = document.querySelector('#ao');
  let aoTouched = false, slowTime = 0;
  aoBox.addEventListener('change', () => { aoTouched = true; });
  function adaptQuality(rawDt) {
    if (aoTouched || !aoBox.checked || timer.getElapsed() < 4 || document.hidden) return;
    slowTime = rawDt > 1 / 40 ? slowTime + rawDt : Math.max(0, slowTime - rawDt);
    if (slowTime > 2.5) { aoBox.checked = false; postfx.setAO(false); aoTouched = true; }
  }

  renderer.setAnimationLoop(() => {
    timer.update();
    const rawDt = timer.getDelta();
    const dt = Math.min(rawDt, 0.1);
    adaptQuality(rawDt);
    const t = timer.getElapsed();
    controls.update(dt);
    env.updateShadow(controls.focus(), controls.viewDistance());
    cn.userData.update(t, env.state.night);
    rogers.userData.update(t, env.state.night);
    ground.userData.update(env.state.night);
    postfx.composer.render(dt);
    ui.update(dt);
  });

  // Exposed for debugging in the console.
  window.toronto = { scene, camera, renderer, controls, env, postfx, data };
}

main().catch((err) => {
  console.error(err);
  showError(`Something went wrong: ${err.message}`);
});
