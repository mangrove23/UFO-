import * as THREE from 'three';

/**
 * 빳빳한 종이 상자의 "눌리면 들어갔다가 되돌아오는" 변형.
 *
 * 물리 형상은 강체 직육면체 그대로 두고(안정성·예측 가능성 유지), 메쉬 정점만
 * 눌린 지점 주변에서 법선 방향으로 밀어 넣는다. 힘이 사라지면 지수적으로 복원된다.
 *
 * 누르는 지점(presser)은 집게 발끝/헤드/닿아 있는 봉의 위치에서 기하적으로 구한다.
 * 접촉력을 직접 쓰지 않으므로 물리 엔진 버전에 의존하지 않는다.
 */
export class PaperDeform {
  constructor(mesh, half, cfg) {
    this.mesh = mesh;
    this.half = half;
    this.cfg = cfg;

    const g = mesh.geometry;
    this.pos = g.attributes.position;
    this.nrm = g.attributes.normal;
    this.count = this.pos.count;
    this.base = new Float32Array(this.pos.array);      // 원본 정점
    this.baseN = new Float32Array(this.nrm.array);     // 원본 법선
    this.dent = new Float32Array(this.count);          // 현재 눌림량
    this.target = new Float32Array(this.count);        // 이번 프레임 목표 눌림량

    this._p = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  /**
   * @param dt          초
   * @param bodyPos     박스 월드 위치 {x,y,z}
   * @param bodyRot     박스 월드 회전 {x,y,z,w}
   * @param pressers    [{ point: THREE.Vector3(월드), strength: 0~1 }]
   */
  update(dt, bodyPos, bodyRot, pressers) {
    const cfg = this.cfg;
    const maxDent = cfg.paperDent;
    const R = cfg.paperRadius;
    this.target.fill(0);

    if (maxDent > 0 && pressers.length) {
      const inv = this._q.set(bodyRot.x, bodyRot.y, bodyRot.z, bodyRot.w).invert();
      const origin = this._v.set(bodyPos.x, bodyPos.y, bodyPos.z);

      for (const pr of pressers) {
        if (pr.strength <= 0.01) continue;
        // 월드 → 박스 로컬
        const lp = pr.point.clone().sub(origin).applyQuaternion(inv);
        // 박스 표면으로 투영 (가장 가까운 면 기준)
        const surf = this.projectToSurface(lp);
        if (!surf) continue;
        const amt = maxDent * Math.min(1, pr.strength);

        for (let i = 0; i < this.count; i++) {
          const bx = this.base[i * 3], by = this.base[i * 3 + 1], bz = this.base[i * 3 + 2];
          const dx = bx - surf.x, dy = by - surf.y, dz = bz - surf.z;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > R * R) continue;
          // 눌린 면과 같은 방향의 정점만 (반대쪽 면이 딸려 들어가지 않게)
          const nx = this.baseN[i * 3], ny = this.baseN[i * 3 + 1], nz = this.baseN[i * 3 + 2];
          const facing = nx * surf.nx + ny * surf.ny + nz * surf.nz;
          if (facing < 0.35) continue;
          const t = Math.sqrt(d2) / R;
          const fall = Math.cos(t * Math.PI * 0.5) ** 2;   // 부드러운 감쇠
          const v = amt * fall * facing;
          if (v > this.target[i]) this.target[i] = v;
        }
      }
    }

    // 눌릴 때는 빠르게, 되돌아올 때는 천천히
    const kA = 1 - Math.exp(-dt / Math.max(0.005, cfg.paperAttack));
    const kR = 1 - Math.exp(-dt / Math.max(0.005, cfg.paperRecover));
    let dirty = false;
    for (let i = 0; i < this.count; i++) {
      const tgt = this.target[i];
      const k = tgt > this.dent[i] ? kA : kR;
      const next = this.dent[i] + (tgt - this.dent[i]) * k;
      if (Math.abs(next - this.dent[i]) > 1e-6 || next > 1e-6) dirty = true;
      this.dent[i] = next;
    }
    if (!dirty && !this.wasDirty) return;
    this.wasDirty = dirty;

    // 정점 = 원본 - 법선 * 눌림량
    const arr = this.pos.array;
    for (let i = 0; i < this.count; i++) {
      const d = this.dent[i];
      arr[i * 3]     = this.base[i * 3]     - this.baseN[i * 3]     * d;
      arr[i * 3 + 1] = this.base[i * 3 + 1] - this.baseN[i * 3 + 1] * d;
      arr[i * 3 + 2] = this.base[i * 3 + 2] - this.baseN[i * 3 + 2] * d;
    }
    this.pos.needsUpdate = true;
    this.mesh.geometry.computeVertexNormals();
  }

  /** 로컬 점을 박스의 가장 가까운 면으로 투영. 면에서 너무 멀면 null. */
  projectToSurface(lp) {
    const h = this.half;
    const skin = 0.025; // 이 거리 안쪽/바깥쪽이면 "누르고 있다"고 본다
    const dx = h.x - Math.abs(lp.x);
    const dy = h.y - Math.abs(lp.y);
    const dz = h.z - Math.abs(lp.z);
    if (dx < -skin || dy < -skin || dz < -skin) return null;

    // 가장 얕은 축 = 그 면
    let axis = 0, m = dx;
    if (dy < m) { axis = 1; m = dy; }
    if (dz < m) { axis = 2; m = dz; }
    if (m > skin) return null; // 박스 한가운데 = 표면을 누르는 게 아님

    const out = { x: lp.x, y: lp.y, z: lp.z, nx: 0, ny: 0, nz: 0 };
    if (axis === 0) { const s = Math.sign(lp.x) || 1; out.x = s * h.x; out.nx = s; }
    if (axis === 1) { const s = Math.sign(lp.y) || 1; out.y = s * h.y; out.ny = s; }
    if (axis === 2) { const s = Math.sign(lp.z) || 1; out.z = s * h.z; out.nz = s; }
    // 면 안쪽으로 클램프
    out.x = Math.max(-h.x, Math.min(h.x, out.x));
    out.y = Math.max(-h.y, Math.min(h.y, out.y));
    out.z = Math.max(-h.z, Math.min(h.z, out.z));
    return out;
  }
}

/** 빳빳한 종이 느낌의 상품 박스 메쉬 */
export function makePaperBoxMesh(cfg) {
  // 눌림이 보이려면 면 분할이 필요하다
  const seg = (len) => Math.max(4, Math.min(14, Math.round(len / 0.018)));
  const geo = new THREE.BoxGeometry(
    cfg.boxW, cfg.boxH, cfg.boxD,
    seg(cfg.boxW), seg(cfg.boxH), seg(cfg.boxD)
  );
  const mat = new THREE.MeshStandardMaterial({
    color: 0xe05a52,       // 인쇄된 판지
    roughness: 0.94,
    metalness: 0.0,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // 포장 띠 (변형과 무관한 별도 메쉬)
  const band = new THREE.Mesh(
    new THREE.BoxGeometry(cfg.boxW * 1.004, cfg.boxH * 0.15, cfg.boxD * 1.004),
    new THREE.MeshStandardMaterial({ color: 0xf1c40f, roughness: 0.9, metalness: 0.0 })
  );
  band.position.y = cfg.boxH * 0.28;
  mesh.add(band);
  return mesh;
}
