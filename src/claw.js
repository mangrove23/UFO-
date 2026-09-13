import RAPIER from 'rapier';
import * as THREE from 'three';
import { syncMesh } from './physics.js';

const ARM_HALF_X = 0.0099; // 발(팔) 두께의 절반 — 발가락은 이 안쪽 면에 붙는다
const ARM_HALF_Z = 0.0162; // 발(팔) 앞뒤 폭의 절반
const HEAD_RADIUS = 0.0408; // 캡슐 헤드의 반지름 (높이의 절반)
const PIVOT_BELOW = Math.PI / 3; // 발 축 위치: 반구 중심에서 수평 아래 60° (시계의 5시/7시)

/**
 * 집게.
 *  - 헤드: kinematic (버튼 입력으로 위치를 직접 지정)
 *  - 발 2개: dynamic 강체 + revolute 조인트 + 위치 모터
 *  - 팔: 투명 아크릴, 팔꿈치에서 직각으로 꺾인 ㄱ자 (벌리면 ⊓, 오므리면 마름모)
 *  - 발끝: 아주 얇은 금속판 — 박스 밑으로 파고들거나 위를 누르는 부분
 *
 * 발은 X축(봉과 평행한 방향)으로 마주 보고 닫힌다.
 * 회전축은 Z축이고, 상태는 "벌림각 spread" 하나로 표현한다:
 *   spread = 0  → 두 발끝이 정중앙(x=0)에서 맞닿음
 *   spread 증가 → 벌어짐
 * 조인트 목표각 θ = sign * spread  (왼발 sign=-1, 오른발 sign=+1)
 *
 * 파지력은 "일정 토크"로 준다. 모터는 위치 제어뿐이라, 매 프레임
 *   강성 = 토크 / |목표각 - 현재각|
 * 으로 역산해 박스 폭이 달라져도 무는 힘이 일정하게 유지된다.
 */
export class Claw {
  constructor(world, scene, cfg) {
    this.world = world;
    this.scene = scene;
    this.cfg = cfg;

    this.pos = new THREE.Vector3(cfg.homeX, cfg.clawTopY, cfg.homeZ);
    this.spread = cfg.clawCloseSpread;
    this.targetSpread = cfg.clawCloseSpread;
    this.spreadVel = 0;
    this.yaw = 0;          // 수직축 회전각(rad, 위에서 봤을 때 시계방향 +). Game 이 높이에 따라 정한다.

    this.group = new THREE.Group();
    scene.add(this.group);
    this.bodies = [];
    this.myColliders = new Set();

    this.build();
  }

  build() {
    const cfg = this.cfg;
    const p = this.pos;

    const metal = new THREE.MeshStandardMaterial({ color: 0xc8ccd4, roughness: 0.28, metalness: 0.9 });
    // 헤드 외장: 광택 있는 은백색 플라스틱
    const shell = new THREE.MeshPhysicalMaterial({
      color: 0xe4e8ee, roughness: 0.22, metalness: 0.35, clearcoat: 1.0, clearcoatRoughness: 0.15,
    });
    // 실기의 팔은 투명 아크릴이다
    const acrylic = new THREE.MeshPhysicalMaterial({
      color: 0xdfeaf5, transparent: true, opacity: 0.42,
      roughness: 0.08, metalness: 0.0, clearcoat: 1.0, side: THREE.DoubleSide,
    });

    // ---- 헤드 (kinematic): 좌우로 누운 둥근 캡슐 ----
    this.head = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z)
    );
    const headR = HEAD_RADIUS;
    // 발 회전축은 캡슐 양 끝 반구의 5시·7시 위치(수평에서 60° 아래)에 있다.
    // 축 간격(clawPivotX)을 기준으로 캡슐 원통부 길이를 역산한다.
    const headHalfLen = Math.max(0.005, cfg.clawPivotX - headR * Math.cos(PIVOT_BELOW));  // 원통부 길이의 절반
    this.pivotY = -headR * Math.sin(PIVOT_BELOW);
    // Rapier 캡슐은 Y축 방향이므로 Z축으로 90° 눕힌다
    const lay = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    const hc = this.headCollider = this.world.createCollider(
      RAPIER.ColliderDesc.capsule(headHalfLen, headR)
        .setRotation({ x: lay.x, y: lay.y, z: lay.z, w: lay.w })
        .setFriction(0.4)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.head
    );
    this.myColliders.add(hc.handle);
    this.bodies.push(this.head);

    const headGeo = new THREE.CapsuleGeometry(headR, headHalfLen * 2, 10, 28);
    headGeo.rotateZ(Math.PI / 2);
    this.headMesh = new THREE.Mesh(headGeo, shell);
    this.headMesh.castShadow = true;
    // 앞면(플레이어 쪽) 장식 점 세 개
    [0xe8467c, 0xf5c518, 0x2f8fd8].forEach((color, i) => {
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(headR * 0.2, 20),
        new THREE.MeshStandardMaterial({ color, roughness: 0.4 })
      );
      dot.position.set((i - 1) * headR * 0.55, headR * 0.12, headR + 0.0005);
      this.headMesh.add(dot);
    });
    this.group.add(this.headMesh);

    this.rodMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 12), metal);
    this.group.add(this.rodMesh);

    // ---- 발 2개 ----
    // 팔 하나는 팔꿈치에서 직각으로 꺾인 ㄱ자 강체다. 치수는 "벌린 상태" 기준:
    //   축 ──(수평, reach)── 팔꿈치
    //                         │ (수직, drop)
    //                         ┘ 발 아래 끝
    // 두 발을 벌리면 ⊓ 자가 되어 각진 박스를 감싸기 좋고, 이 모양을 축 기준으로
    // 안쪽으로 openSpread 만큼 돌리면 발끝이 정중앙에서 맞닿는 마름모가 된다.
    //
    // 발바닥(납작한 금속판)은 "오므린 상태"에서 수평이다. 판은 수직 팔의 안쪽 면,
    // 아래 끝에서 clawTipRaise 만큼 올라간 지점에 붙어 안쪽으로 수평하게 뻗는다.
    // 그 아래로는 팔 끝이 조금 삐져나온다. 벌리면 팔과 함께 돌아가 판이 안쪽 위로 기운다.
    const reach = cfg.clawElbowOut;
    const drop = cfg.clawArmLen;
    const tipThick = cfg.clawTipThick;
    const tipWidth = cfg.clawTipWidth;
    const tipHalf = cfg.clawTipLen;
    const TIP_GAP = 0.001;   // 오므렸을 때 발끝과 정중앙 사이 (두 발가락이 서로 밀지 않게)

    // 벌린 상태(오른발 기준)에서 발바닥이 붙는 점: 수직 팔 안쪽 면, 아래 끝에서 raise 위
    const mountU = reach - ARM_HALF_X;
    const mountV = drop - cfg.clawTipRaise;
    // 오므린 상태에서 발바닥 안쪽 끝(= 붙는 점 x − 판 길이)이 x = TIP_GAP 에 오는 회전각:
    //   mountV·sinθ − mountU·cosθ = pivotX − 판 길이 − TIP_GAP
    const R = Math.hypot(mountU, mountV);
    this.openSpread = Math.atan2(mountU, mountV)
      + Math.asin(Math.max(-1, Math.min(1, (cfg.clawPivotX - tipHalf * 2 - TIP_GAP) / R)));

    this.fingers = [];
    for (const sign of [-1, +1]) {
      const px = sign * cfg.clawPivotX;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p.x + px, p.y + this.pivotY, p.z)
          .setCanSleep(false)
          .setAngularDamping(0.7)
      );

      // 조인트 각 0 = 오므린 상태이므로, 벌린 상태 좌표를 안쪽으로 openSpread 만큼 돌려 둔다
      const rest = -sign * this.openSpread;
      const cr = Math.cos(rest), sr = Math.sin(rest);
      const toLocal = (x, y) => ({ x: x * cr - y * sr, y: x * sr + y * cr });

      // 팔꿈치 모서리가 비지 않도록 각 구간을 팔 두께의 절반만큼 연장한다
      const segments = [
        [{ x: 0, y: 0 },            { x: sign * (reach + ARM_HALF_X), y: 0 }],  // 축 → 팔꿈치 (수평)
        [{ x: sign * reach, y: ARM_HALF_X }, { x: sign * reach, y: -drop }],    // 팔꿈치 → 끝 (수직)
      ];

      const armCols = [];
      const armMeshes = [];
      for (const [a0, b0] of segments) {
        const a = toLocal(a0.x, a0.y), b = toLocal(b0.x, b0.y);
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        // 기본 상자는 -Y 방향으로 서 있다. Z축으로 phi 만큼 돌려 세그먼트에 맞춘다.
        const phi = Math.atan2(dx, -dy);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), phi);

        armCols.push(this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(ARM_HALF_X, len / 2, ARM_HALF_Z)
            .setTranslation(mid.x, mid.y, 0)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setMass(cfg.clawFingerMass * 0.35)
            .setFriction(cfg.frictionClaw)
            .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
            .setRestitution(0.0)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
          body
        ));

        const m = new THREE.Mesh(new THREE.BoxGeometry(ARM_HALF_X * 2, len, ARM_HALF_Z * 2), acrylic);
        m.position.set(mid.x, mid.y, 0);
        m.rotation.z = phi;
        m.castShadow = true;
        armMeshes.push(m);
      }

      // 납작한 금속 발바닥: 조인트 각 0(오므림)에서 수평. 바깥 끝을 팔 속으로 조금 묻어 틈이 안 보이게 한다.
      const mount = toLocal(sign * mountU, -mountV);
      const tipLen = tipHalf * 2 + ARM_HALF_X;                     // 팔 속에 묻히는 길이 포함
      const tip = { x: mount.x - sign * (tipHalf * 2 - tipLen / 2), y: mount.y };
      const tipCol = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(tipLen / 2, tipThick, tipWidth)
          .setTranslation(tip.x, tip.y, 0)
          .setMass(cfg.clawFingerMass * 0.3)
          .setFriction(cfg.frictionClaw)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
          .setRestitution(0.0)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        body
      );
      for (const c of armCols) this.myColliders.add(c.handle);
      this.myColliders.add(tipCol.handle);
      this.bodies.push(body);

      const jd = RAPIER.JointData.revolute(
        { x: px, y: this.pivotY, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }
      );
      const joint = this.world.createImpulseJoint(jd, this.head, body, true);
      if (typeof joint.setContactsEnabled === 'function') joint.setContactsEnabled(false);
      if (typeof joint.configureMotorModel === 'function') {
        joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
      }

      // 메쉬
      const g = new THREE.Group();
      const tipMesh = new THREE.Mesh(new THREE.BoxGeometry(tipLen, tipThick * 2, tipWidth * 2), metal);
      tipMesh.position.set(tip.x, tip.y, 0);
      tipMesh.castShadow = true;
      g.add(...armMeshes, tipMesh);
      this.group.add(g);

      this.fingers.push({
        sign, body, joint, mesh: g,
        colliders: [...armCols, tipCol],
        tipLocal: new THREE.Vector3(mount.x - sign * tipHalf * 2, mount.y, 0),          // 발바닥 안쪽 끝점
        padLocal: new THREE.Vector3(mount.x - sign * tipHalf, mount.y - tipThick, 0),   // 발바닥 아랫면 중앙
      });
    }

    this.applyMotor(true);
  }

  /** 벌림각은 형상에서 역산한다 — 이 각도에서 두 발이 정확히 ⊓ 자가 된다 */
  open() { this.targetSpread = this.openSpread; }
  close() { this.targetSpread = this.cfg.clawCloseSpread; }

  /** 명령 벌림각이 목표에 도달했는가 (발이 박스에 막혀 있어도 true) */
  reachedTarget() { return Math.abs(this.targetSpread - this.spread) < 1e-6; }

  /** 명령값 도달 + 실제 발 각도도 목표에서 tol(rad) 이내 */
  settled(tol) {
    return this.reachedTarget() && this.fingers.every((f) => (f.motorError ?? Infinity) < tol);
  }

  /** 발의 실제 개폐 각도 — 헤드 기준 Z축 회전 (헤드가 수직축으로 돌아 있어도 개폐각만 뽑는다) */
  angleOf(f) {
    const h = this.head.rotation(), r = f.body.rotation();
    const q = new THREE.Quaternion(h.x, h.y, h.z, h.w).invert()
      .multiply(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    return Math.atan2(2 * (q.w * q.z), 1 - 2 * q.z * q.z);
  }

  /** 이 발이 다른 물체(박스·봉·벽·반대쪽 발)와 실제로 접촉 중인가 */
  isTouching(f) {
    const w = this.world;
    const skip = new Set(f.colliders.map((c) => c.handle));
    skip.add(this.headCollider.handle);
    let hit = false;
    for (const c of f.colliders) {
      w.contactPairsWith(c, (other) => {
        if (hit || skip.has(other.handle)) return;
        w.contactPair(c, other, (m) => { if (m.numSolverContacts() > 0) hit = true; });
      });
      if (hit) break;
    }
    return hit;
  }

  /**
   * 발 모터. 실기처럼 "움직이는 속도"와 "무는 힘"을 분리한다.
   *  - 아무것에도 닿지 않았을 때: clawMoveTorque 로 개폐 램프(clawMotorSpeed)를 그대로 따라간다.
   *    목표 속도를 함께 넘겨, 댐핑이 움직임 자체에 브레이크를 걸지 않게 한다.
   *  - 무언가에 닿았을 때: clawGripTorque 로만 민다 → 약한 파지력이어도 개폐 속도는 그대로.
   */
  applyMotor(snap = false) {
    const cfg = this.cfg;
    for (const f of this.fingers) {
      const target = f.sign * this.spread;
      const err = Math.abs(target - this.angleOf(f));
      f.touching = !snap && this.isTouching(f);
      const torque = f.touching ? cfg.clawGripTorque : Math.max(cfg.clawGripTorque, cfg.clawMoveTorque);
      // 일정 토크 = 강성 × 오차  →  강성 = 토크 / 오차
      const k = Math.min(cfg.clawMaxStiffness, torque / Math.max(0.03, err));
      if (f.touching) f.joint.configureMotorPosition(target, k, cfg.clawGripDamping);
      else f.joint.configureMotor(target, f.sign * this.spreadVel, k, cfg.clawGripDamping);
      f.motorError = err;
      if (snap) {
        const h = this.head.rotation();
        const q = new THREE.Quaternion(h.x, h.y, h.z, h.w)
          .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), target));
        f.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      }
    }
  }

  update(dt) {
    const step = this.cfg.clawMotorSpeed * dt;
    const d = this.targetSpread - this.spread;
    const move = Math.max(-step, Math.min(step, d));
    this.spread += move;
    this.spreadVel = dt > 0 ? move / dt : 0;   // 개폐 램프 속도 (모터 목표 속도로 쓴다)
    this.applyMotor();
    this.head.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
    // 수직축(Y) 회전. yaw 는 위에서 봤을 때 시계방향이 + → 오른손 법칙으로는 −Y 회전.
    const half = -this.yaw / 2;
    this.head.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
  }

  render() {
    syncMesh(this.headMesh, this.head);
    const t = this.head.translation();
    this.rodMesh.position.set(t.x, t.y + 0.53, t.z);
    for (const f of this.fingers) syncMesh(f.mesh, f.body);
  }

  toWorld(f, local) {
    const t = f.body.translation();
    const r = f.body.rotation();
    return local.clone()
      .applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w))
      .add(new THREE.Vector3(t.x, t.y, t.z));
  }

  /** 발끝(안쪽 끝) 월드 좌표 */
  tipWorld(f) { return this.toWorld(f, f.tipLocal); }

  /**
   * 종이 상자를 누르고 있는 지점들. paperbox.js 로 넘긴다.
   * strength 는 발이 얼마나 힘을 쓰고 있는지(모터 오차)로 근사한다.
   */
  pressers(out = []) {
    out.length = 0;
    for (const f of this.fingers) {
      const eff = Math.min(1, (f.motorError || 0) / 0.35);
      if (eff < 0.02) continue;
      // 발끝 판을 따라 세 점 — 납작한 면이 눌린 자국을 남기도록
      for (const s of [-0.6, 0, 0.6]) {
        const p = f.padLocal.clone();
        p.z += s * this.cfg.clawTipWidth;
        out.push({ point: this.toWorld(f, p), strength: eff });
      }
      out.push({ point: this.tipWorld(f), strength: eff });
    }
    return out;
  }

  isMine(handle) { return this.myColliders.has(handle); }

  teleport(x, y, z) {
    this.pos.set(x, y, z);
    this.yaw = 0;
    this.head.setTranslation({ x, y, z }, true);
    this.head.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    for (const f of this.fingers) {
      f.body.setTranslation({ x: x + f.sign * this.cfg.clawPivotX, y: y + this.pivotY, z }, true);
      f.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      f.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.applyMotor(true);
  }

  dispose() {
    for (const b of this.bodies) this.world.removeRigidBody(b);
    this.bodies.length = 0;
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => mm.dispose());
    });
  }
}
