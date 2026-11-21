import * as THREE from 'three';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { LANDMARKS, project } from './geo.js';

const $ = (sel) => document.querySelector(sel);

export function setLoading(text, fraction) {
  $('#loading-text').textContent = text;
  if (fraction != null) $('#loading-bar').style.width = `${Math.round(fraction * 100)}%`;
}
export function hideLoading() {
  const el = $('#loading');
  el.classList.add('done');
  setTimeout(() => el.remove(), 900);
}
export function showError(msg) {
  setLoading(msg, null);
  $('#loading').classList.add('error');
}

const fmtHour = (h) => {
  const hh = Math.floor(h) % 24, mm = Math.floor((h % 1) * 60);
  const ampm = hh < 12 ? 'AM' : 'PM';
  return `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')} ${ampm}`;
};

export function createUI({ scene, camera, controls, env, postfx }) {
  // ---------------------------------------------------------- labels
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.domElement.className = 'labels';
  document.body.appendChild(labelRenderer.domElement);
  const labels = [];
  for (const lm of LANDMARKS) {
    const div = document.createElement('div');
    div.className = 'label';
    div.innerHTML = `<span>${lm.name}</span>`;
    div.addEventListener('click', () => controls.flyTo(lm));
    const obj = new CSS2DObject(div);
    const p = project(lm.lat, lm.lon);
    obj.position.set(p.x, lm.labelY, p.z);
    scene.add(obj);
    labels.push({ obj, div });
  }

  // ---------------------------------------------------------- landmark buttons
  const list = $('#landmarks');
  for (const lm of LANDMARKS) {
    const b = document.createElement('button');
    b.textContent = lm.name;
    b.addEventListener('click', () => controls.flyTo(lm));
    list.appendChild(b);
  }

  // ---------------------------------------------------------- time of day
  const slider = $('#time');
  const timeLabel = $('#time-label');
  const playBtn = $('#play');
  let playing = false;
  // The clock lives here, not in the slider: the slider rounds to its step and clamps to its max.
  let hour = env.state.hour;
  const applyHour = (h) => {
    hour = h;
    env.setHour(h);
    timeLabel.textContent = fmtHour(h);
  };
  slider.value = env.state.hour;
  applyHour(env.state.hour);
  slider.addEventListener('input', () => applyHour(parseFloat(slider.value)));
  playBtn.addEventListener('click', () => {
    playing = !playing;
    playBtn.classList.toggle('active', playing);
    playBtn.setAttribute('aria-label', playing ? 'Pause time' : 'Play time');
    playBtn.textContent = playing ? '❚❚' : '▶';
  });
  document.querySelectorAll('[data-hour]').forEach((b) =>
    b.addEventListener('click', () => { slider.value = b.dataset.hour; applyHour(parseFloat(b.dataset.hour)); }));

  // ---------------------------------------------------------- mode + quality
  const walkBtn = $('#walk');
  walkBtn.addEventListener('click', () => (controls.mode === 'walk' ? controls.exitWalk() : controls.enterWalk()));
  $('#ao').addEventListener('change', (e) => postfx.setAO(e.target.checked));
  $('#labels-toggle').addEventListener('change', (e) => labelRenderer.domElement.classList.toggle('hidden', !e.target.checked));
  $('#panel-toggle').addEventListener('click', () => $('#panel').classList.toggle('collapsed'));

  function onModeChange(mode) {
    walkBtn.textContent = mode === 'walk' ? 'Exit street view' : 'Street-level walk';
    walkBtn.classList.toggle('active', mode === 'walk');
    $('#walk-help').classList.toggle('visible', mode === 'walk');
    $('#orbit-help').classList.toggle('hidden', mode === 'walk');
    labelRenderer.domElement.classList.toggle('walking', mode === 'walk');
  }

  const tmp = new THREE.Vector3();
  function update(dt, size) {
    if (playing) {
      const h = (hour + dt * 0.4) % 24; // ~1 game hour per 2.5 s
      slider.value = h;
      applyHour(h);
    }
    // Fade labels with distance; hide in walk mode when far.
    for (const { obj, div } of labels) {
      const d = tmp.copy(obj.position).distanceTo(camera.position);
      const max = controls.mode === 'walk' ? 900 : 5500;
      const o = THREE.MathUtils.clamp(1.4 - d / max, 0, 1);
      div.style.opacity = o.toFixed(2);
      div.style.pointerEvents = o > 0.2 ? 'auto' : 'none';
    }
    labelRenderer.render(scene, camera);
  }

  return {
    update,
    onModeChange,
    setSize(w, h) { labelRenderer.setSize(w, h); },
  };
}
