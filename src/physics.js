import RAPIER from 'rapier';
import * as THREE from 'three';

export async function initRapier() {
  await RAPIER.init();
  return RAPIER;
}

export function createWorld(cfg) {
  const world = new RAPIER.World({ x: 0, y: cfg.gravity, z: 0 });
  world.timestep = 1 / 120;
  if ('numSolverIterations' in world) world.numSolverIterations = cfg.solverIters;
  return world;
}

/** 봉처럼 X축 방향으로 눕힌 실린더용 쿼터니언 */
export function cylinderAlongX() {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** Rapier 디버그 와이어프레임 */
export class DebugLines {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(0), 4));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthTest: false });
    this.mesh = new THREE.LineSegments(geo, mat);
    this.mesh.visible = false;
    this.mesh.renderOrder = 999;
    scene.add(this.mesh);
  }
  set visible(v) { this.mesh.visible = v; }
  get visible() { return this.mesh.visible; }
  update(world) {
    if (!this.mesh.visible) return;
    const { vertices, colors } = world.debugRender();
    this.mesh.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    this.mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  }
}

/** Rapier 강체 → three 메쉬 동기화 */
export function syncMesh(mesh, body) {
  const t = body.translation();
  const r = body.rotation();
  mesh.position.set(t.x, t.y, t.z);
  mesh.quaternion.set(r.x, r.y, r.z, r.w);
}
