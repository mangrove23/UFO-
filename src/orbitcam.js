import * as THREE from 'three';

/**
 * 최소 궤도 카메라.
 * three 의 OrbitControls 는 내부에서 bare specifier('three')를 import 하기 때문에
 * importmap 이 필요하다. 단일 파일 배포본에서 importmap 없이 돌리려고 직접 만든다.
 *
 * 좌드래그 = 회전, 휠 = 줌, 우드래그/Shift+드래그 = 팬.
 */
export class OrbitCam {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.target = new THREE.Vector3();

    this.minDistance = 0.35;
    this.maxDistance = 4.0;
    this.minPolar = 0.05;
    this.maxPolar = Math.PI - 0.05;
    this.damping = 0.12;

    this.sph = new THREE.Spherical();
    this.sphGoal = new THREE.Spherical();
    this.targetGoal = new THREE.Vector3();

    this._drag = null;
    this._v = new THREE.Vector3();
    this._offset = new THREE.Vector3();

    dom.style.touchAction = 'none';
    dom.addEventListener('pointerdown', (e) => this.onDown(e));
    dom.addEventListener('pointermove', (e) => this.onMove(e));
    dom.addEventListener('pointerup', (e) => this.onUp(e));
    dom.addEventListener('pointercancel', (e) => this.onUp(e));
    dom.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    this.sync();
  }

  /** 현재 카메라/타깃 위치를 내부 상태로 흡수 (외부에서 position 을 바꾼 뒤 호출) */
  sync() {
    this._offset.copy(this.camera.position).sub(this.target);
    this.sph.setFromVector3(this._offset);
    this.sphGoal.copy(this.sph);
    this.targetGoal.copy(this.target);
  }

  onDown(e) {
    if (e.button === 2 || e.shiftKey) this._drag = { mode: 'pan', x: e.clientX, y: e.clientY };
    else this._drag = { mode: 'orbit', x: e.clientX, y: e.clientY };
    this.dom.setPointerCapture(e.pointerId);
  }

  onUp(e) {
    this._drag = null;
    try { this.dom.releasePointerCapture(e.pointerId); } catch (err) { /* 이미 해제됨 */ }
  }

  onMove(e) {
    if (!this._drag) return;
    const dx = e.clientX - this._drag.x;
    const dy = e.clientY - this._drag.y;
    this._drag.x = e.clientX;
    this._drag.y = e.clientY;
    const h = this.dom.clientHeight || 1;

    if (this._drag.mode === 'orbit') {
      this.sphGoal.theta -= (dx / h) * Math.PI * 1.4;
      this.sphGoal.phi -= (dy / h) * Math.PI * 1.4;
      this.sphGoal.phi = Math.max(this.minPolar, Math.min(this.maxPolar, this.sphGoal.phi));
    } else {
      const scale = (this.sphGoal.radius * 1.2) / h;
      const right = this._v.setFromMatrixColumn(this.camera.matrix, 0).multiplyScalar(-dx * scale);
      this.targetGoal.add(right);
      const up = this._v.setFromMatrixColumn(this.camera.matrix, 1).multiplyScalar(dy * scale);
      this.targetGoal.add(up);
    }
  }

  onWheel(e) {
    e.preventDefault();
    const k = Math.exp(e.deltaY * 0.0011);
    this.sphGoal.radius = Math.max(this.minDistance, Math.min(this.maxDistance, this.sphGoal.radius * k));
  }

  /** 외부에서 카메라 위치를 지정할 때 사용 (뷰 프리셋) */
  setView(position, target) {
    this.camera.position.copy(position);
    this.target.copy(target);
    this.sync();
  }

  update() {
    const k = this.damping;
    this.sph.theta += (this.sphGoal.theta - this.sph.theta) * k;
    this.sph.phi += (this.sphGoal.phi - this.sph.phi) * k;
    this.sph.radius += (this.sphGoal.radius - this.sph.radius) * k;
    this.target.lerp(this.targetGoal, k);

    this._offset.setFromSpherical(this.sph);
    this.camera.position.copy(this.target).add(this._offset);
    this.camera.lookAt(this.target);
  }
}
