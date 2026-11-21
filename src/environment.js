import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { cityUniforms } from './city.js';

const LAT = 43.6426 * Math.PI / 180;
const DECLINATION = 18 * Math.PI / 180; // mid-August sun path
const SOLAR_NOON = 13.3; // local clock time (EDT) of solar noon in Toronto

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Sun direction (unit vector, y up, x east, z south) for a clock hour. */
export function sunDirection(hour) {
  const H = (hour - SOLAR_NOON) * 15 * Math.PI / 180;
  const sinEl = Math.sin(LAT) * Math.sin(DECLINATION) + Math.cos(LAT) * Math.cos(DECLINATION) * Math.cos(H);
  const el = Math.asin(sinEl);
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT) - Math.tan(DECLINATION) * Math.cos(LAT)); // from south, + west
  return new THREE.Vector3(-Math.sin(az) * Math.cos(el), sinEl, Math.cos(az) * Math.cos(el));
}

export function createEnvironment(renderer, scene) {
  // Sky dome
  const sky = new Sky();
  sky.scale.setScalar(20000);
  const su = sky.material.uniforms;
  sky.renderOrder = -100; // draw first: ground layers do not write depth
  su.turbidity.value = 4;
  su.rayleigh.value = 1.4;
  su.mieCoefficient.value = 0.004;
  su.mieDirectionalG.value = 0.8;
  scene.add(sky);

  // Stars (fade in at night)
  const starGeo = new THREE.BufferGeometry();
  const sp = [];
  for (let i = 0; i < 2500; i++) {
    const u = Math.random() * 2 * Math.PI, v = Math.random() * 0.95 + 0.05;
    const r = 18000, c = Math.sqrt(1 - v * v);
    sp.push(r * c * Math.cos(u), r * v, r * c * Math.sin(u));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  // Additive and not transparent: stays in the opaque list, so renderOrder draws it after the sky
  // and before the ground layers, which then cover it. Brightness is set through the color.
  const starMat = new THREE.PointsMaterial({ color: 0x000000, size: 1.6, sizeAttenuation: false, blending: THREE.AdditiveBlending, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  stars.renderOrder = -99;
  scene.add(stars);

  // Lights
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 8000;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xdfe9f5, 0xb9ad98, 0.6);
  scene.add(hemi);

  scene.fog = new THREE.Fog(0xcfdbe6, 1500, 9000);

  // Environment map from the sky, for soft ambient light and water reflections.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  envScene.add(envSky);
  let envRT = null;
  let lastEnvHour = null;

  // Horizon probe: render the sky shader into a tiny float target and average the color just
  // above the horizon in four directions. Fog uses it so the ground blends into the sky.
  const probeRT = new THREE.WebGLRenderTarget(8, 8, { type: THREE.FloatType });
  const probeCam = new THREE.PerspectiveCamera(6, 1, 0.1, 5000);
  const probePx = new Float32Array(8 * 8 * 4);
  const fogNight = new THREE.Color(0x0b1120);
  function sampleHorizon(out) {
    out.setRGB(0, 0, 0);
    const prev = renderer.getRenderTarget();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + 0.4;
      probeCam.position.set(0, 0, 0);
      probeCam.lookAt(Math.cos(a), 0.02, Math.sin(a));
      renderer.setRenderTarget(probeRT);
      renderer.render(envScene, probeCam);
      renderer.readRenderTargetPixels(probeRT, 0, 0, 8, 8, probePx);
      for (let p = 0; p < 64; p++) { out.r += probePx[p * 4]; out.g += probePx[p * 4 + 1]; out.b += probePx[p * 4 + 2]; }
    }
    renderer.setRenderTarget(prev);
    return out.multiplyScalar(1 / 256);
  }
  const sunDay = new THREE.Color(0xfff4e6), sunLow = new THREE.Color(0xffb27a);
  const hemiSkyDay = new THREE.Color(0xdfe9f5), hemiSkyNight = new THREE.Color(0x24324f);
  const hemiGroundDay = new THREE.Color(0xb9ad98), hemiGroundNight = new THREE.Color(0x14161c);
  const tmp = new THREE.Color();

  // The horizon color depends only on the hour, so sample it once per FOG_STEP at load and
  // interpolate. Avoids GPU readback stalls while the clock plays.
  const FOG_STEP = 0.2;
  const fogLUT = [];
  for (let h = 0; h < 24; h += FOG_STEP) {
    envSky.material.uniforms.sunPosition.value.copy(sunDirection(h));
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) envSky.material.uniforms[k].value = su[k].value;
    fogLUT.push(sampleHorizon(new THREE.Color()));
  }
  function horizonColor(hour, out) {
    const x = (((hour % 24) + 24) % 24) / FOG_STEP;
    const i = Math.floor(x) % fogLUT.length, j = (i + 1) % fogLUT.length;
    return out.copy(fogLUT[i]).lerp(fogLUT[j], x - Math.floor(x));
  }
  const lightDir = new THREE.Vector3();

  const state = { hour: 17.5, dir: new THREE.Vector3(), night: 0, day: 1 };

  function setHour(hour) {
    state.hour = hour;
    const dir = sunDirection(hour);
    state.dir.copy(dir);
    const s = dir.y;
    const day = smooth(-0.06, 0.25, s);
    const golden = 1 - smooth(0.02, 0.35, s);
    const night = 1 - smooth(-0.14, 0.02, s);
    state.day = day;
    state.night = night;

    su.sunPosition.value.copy(dir);
    envSky.material.uniforms.sunPosition.value.copy(dir);
    for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) envSky.material.uniforms[k].value = su[k].value;

    sun.intensity = 3.2 * smooth(-0.02, 0.12, s);
    sun.color.copy(sunDay).lerp(sunLow, golden);
    hemi.intensity = 0.25 + 0.45 * day;
    hemi.color.copy(hemiSkyNight).lerp(hemiSkyDay, day);
    hemi.groundColor.copy(hemiGroundNight).lerp(hemiGroundDay, day);

    // Keep a little blue haze at night so distant ground does not vanish into pure black.
    scene.fog.color.copy(horizonColor(hour, tmp)).lerp(fogNight, night * 0.6);
    starMat.color.setScalar(night * 0.9);
    stars.visible = night > 0.001;
    // No sun, no shadow map work. The stale map is never visible because the light is off.
    renderer.shadowMap.autoUpdate = sun.intensity > 0;
    renderer.toneMappingExposure = 0.6 + 0.25 * night;
    cityUniforms.uNight.value = night;
    scene.environmentIntensity = 0.08 + 0.1 * day;

    // Refresh the env map at most every 0.25 h of change.
    if (lastEnvHour === null || Math.abs(hour - lastEnvHour) > 0.25) {
      lastEnvHour = hour;
      envRT?.dispose();
      envRT = pmrem.fromScene(envScene, 0, 0.1, 2000);
      scene.environment = envRT.texture;
    }
  }

  // Keep the shadow frustum around what the camera is looking at, and scale fog with view distance.
  function updateShadow(focus, viewDistance) {
    scene.fog.near = Math.max(1200, viewDistance * 1.2);
    scene.fog.far = scene.fog.near + 14000;
    const size = THREE.MathUtils.clamp(viewDistance * 1.1, 250, 2600);
    const cam = sun.shadow.camera;
    if (cam.right !== size) {
      cam.left = -size; cam.right = size; cam.top = size; cam.bottom = -size;
      cam.updateProjectionMatrix();
    }
    // Snap focus to shadow texels to reduce shimmering.
    const texel = (2 * size) / sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    sun.target.position.set(fx, 0, fz);
    // Keep the sun's azimuth near the horizon; only lift its elevation to a small minimum.
    const d = lightDir.copy(state.dir);
    if (d.y < 0.03) { d.y = 0.03; d.normalize(); }
    sun.position.set(fx + d.x * 3000, d.y * 3000, fz + d.z * 3000);
    sun.target.updateMatrixWorld();
  }

  setHour(state.hour);
  return { state, setHour, updateShadow, sun };
}
