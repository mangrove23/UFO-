import * as THREE from 'three';
import RAPIER from 'rapier';
import { OrbitCam } from './orbitcam.js';

import { loadConfig } from './config.js';
import { initRapier, createWorld, DebugLines } from './physics.js';
import { Game } from './game.js';
import { UI } from './ui.js';

const cfg = loadConfig();

// ------------------------------------------------------------------ three 셋업
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e13);
scene.fog = new THREE.Fog(0x0b0e13, 2.2, 5.0);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 50);
const controls = new OrbitCam(camera, renderer.domElement);

function setView(kind) {
  const y = cfg.barLowY;
  const t = new THREE.Vector3(0, y + 0.14, -0.06);
  const p = new THREE.Vector3(0.16, y + 0.60, 1.62);
  if (kind === 'side') { p.set(1.60, y + 0.18, 0.02); t.set(0, y + 0.06, -0.02); }
  else if (kind === 'top') p.set(0.02, y + 1.45, -0.05);
  controls.setView(p, t);
}
setView('front');

scene.add(new THREE.HemisphereLight(0xbcd8ff, 0x1c2230, 1.15));
const key = new THREE.DirectionalLight(0xffffff, 2.6);
key.position.set(0.9, 1.9, 1.2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 0.4;
key.shadow.camera.far = 5;
const sc = key.shadow.camera;
sc.left = -0.9; sc.right = 0.9; sc.top = 0.9; sc.bottom = -0.9;
sc.updateProjectionMatrix();
scene.add(key);
const fill = new THREE.DirectionalLight(0x9fc0ff, 0.75);
fill.position.set(-1.1, 0.9, -1.0);
scene.add(fill);

// 캐비닛 내부 조명 (실기의 상단 형광등)
const cabinet = new THREE.PointLight(0xfff2d8, 3.0, 2.2, 1.6);
cabinet.position.set(0, cfg.clawTopY + 0.06, -0.02);
scene.add(cabinet);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ------------------------------------------------------------------ 물리 + 게임
await initRapier();
let world = createWorld(cfg);
let eventQueue = new RAPIER.EventQueue(true);
let game = new Game(world, scene, cfg);
const debug = new DebugLines(scene);

const app = {
  get game() { return game; },
  debug,
  setView,
  applyLive() {
    world.gravity = { x: 0, y: cfg.gravity, z: 0 };
    if ('numSolverIterations' in world) world.numSolverIterations = cfg.solverIters;
  },
  rebuild() {
    game.rebuild();
    app.applyLive();
  },
};

const ui = new UI({ cfg, app });
app.applyLive();

// ------------------------------------------------------------------ 루프
let last = performance.now();
let acc = 0;
const FIXED = 1 / 120;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  game.setButtons(ui.buttons);
  game.update(dt);

  acc += dt;
  const maxSteps = Math.max(1, Math.round(cfg.subSteps)) * 2;
  let steps = 0;
  while (acc >= FIXED && steps < maxSteps) {
    world.step(eventQueue);
    eventQueue.drainCollisionEvents((h1, h2, started) => game.onCollision(h1, h2, started));
    acc -= FIXED;
    steps++;
  }
  if (acc > 0.25) acc = 0;

  game.render(dt);
  debug.update(world);
  controls.update();
  ui.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ 콘솔/테스트 도구
window.__ufo = {
  cfg, get game() { return game; }, world, THREE, RAPIER, ui, app,

  /** 화면과 무관하게 물리를 n초만큼 즉시 진행 (파라미터 검증용) */
  simulate(seconds, buttons = null) {
    const n = Math.max(1, Math.round(seconds / FIXED));
    for (let i = 0; i < n; i++) {
      if (buttons) game.setButtons(buttons);
      game.update(FIXED);
      world.step(eventQueue);
      eventQueue.drainCollisionEvents((h1, h2, st) => game.onCollision(h1, h2, st));
    }
    const t = game.boxBody.translation();
    const r = game.boxBody.rotation();
    const e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w), 'XYZ');
    return {
      state: game.state,
      box: { x: +t.x.toFixed(3), y: +t.y.toFixed(3), z: +t.z.toFixed(3) },
      tiltXdeg: +(e.x * 180 / Math.PI).toFixed(1),
      bars: game.barContacts(),
      grip: game.lastGrip,
    };
  },

  /** 집게를 원하는 위치로 순간이동시키고 벌림 상태 지정 */
  place(x, y, z, spreadOpen = false) {
    game.claw.teleport(x, y, z);
    if (spreadOpen) game.claw.open(); else game.claw.close();
    game.claw.spread = game.claw.targetSpread;
    game.claw.applyMotor(true);
  },
};
