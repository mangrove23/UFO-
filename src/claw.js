import RAPIER from 'rapier';
import * as THREE from 'three';
import { syncMesh } from './physics.js';

const ARM_HALF_X = 0.011; // 발(팔) 두께의 절반 — 발가락은 이 안쪽 면에 붙는다

/**
 * 집게.
 *  - 헤드: kinematic (버튼 입력으로 위치를 직접 지정)
 *  - 발 2개: dynamic 강체 + revolute 조인트 + 위치 모터
 *  - 발끝: 납작한 판 (얇고 넓게) — 박스 위를 누르거나 옆면을 무는 부분
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
    this.torque = cfg.clawGripTorque;

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
    const dark = new THREE.MeshStandardMaterial({ color: 0x3a4150, roughness: 0.35, metalness: 0.75 });
    // 실기의 팔은 투명 아크릴이다
    const acrylic = new THREE.MeshPhysicalMaterial({
      color: 0xdfeaf5, transparent: true, opacity: 0.42,
      roughness: 0.08, metalness: 0.0, clearcoat: 1.0, side: THREE.DoubleSide,
    });

    // ---- 헤드 (kinematic) ----
    this.head = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x, p.y, p.z)
    );
    const headHalf = { x: cfg.clawPivotX + 0.026, y: 0.028, z: 0.038 };
    this.headHalf = headHalf;
    const hc = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(headHalf.x, headHalf.y, headHalf.z)
        .setFriction(0.4)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.head
    );
    this.myColliders.add(hc.handle);
    this.bodies.push(this.head);

    this.headMesh = new THREE.Mesh(
      new THREE.BoxGeometry(headHalf.x * 2, headHalf.y * 2, headHalf.z * 2), dark);
    this.headMesh.castShadow = true;
    this.group.add(this.headMesh);

    this.rodMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 12), metal);
    this.group.add(this.rodMesh);

    // ---- 발 2개 ----
    const armLen = cfg.clawArmLen;
    const tipThick = cfg.clawTipThick;
    const tipWidth = cfg.clawTipWidth;
    const tipY = -(armLen - tipThick);
    // 발가락 안쪽 끝이 정중앙(x=0)을 넘지 않도록 제한
    const tipHalf = Math.min(cfg.clawTipLen, (cfg.clawPivotX - ARM_HALF_X) / 2);
    this.tipY = tipY;

    this.fingers = [];
    for (const sign of [-1, +1]) {
      const px = sign * cfg.clawPivotX;
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(p.x + px, p.y, p.z)
          .setCanSleep(false)
          .setAngularDamping(0.7)
      );

      // 발가락은 발(팔)의 안쪽 면에 붙어서 안쪽으로 뻗는다.
      // 바깥쪽 끝을 팔에 고정하므로, 길이를 줄이면 안쪽 도달 거리가 그만큼 짧아진다.
      const tipX = -sign * (ARM_HALF_X + tipHalf);

      // ---- 팔: 팔꿈치에서 꺾인 2단 구조 ----
      // 실기(SEGA UFO CATCHER)처럼 축에서 바깥으로 벌어졌다가 다시 안쪽으로 모여
      // 두 팔이 마름모를 이룬다. 아래 끝은 다시 x=0 으로 돌아오므로 발가락 위치와
      // 파지 계산은 그대로 유지된다.
      const Ex = cfg.clawElbowOut;              // 팔꿈치가 바깥으로 벌어지는 양
      const Ey = armLen * cfg.clawElbowAt;      // 팔꿈치 높이
      const segments = [
        [{ x: 0, y: 0 },          { x: sign * Ex, y: -Ey }],       // 축 → 팔꿈치 (바깥으로)
        [{ x: sign * Ex, y: -Ey }, { x: 0, y: -armLen }],          // 팔꿈치 → 끝 (안쪽으로)
      ];

      const armCols = [];
      const armMeshes = [];
      for (const [a, b] of segments) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        // 기본 상자는 -Y 방향으로 서 있다. Z축으로 phi 만큼 돌려 세그먼트에 맞춘다.
        const phi = Math.atan2(dx, -dy);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), phi);

        armCols.push(this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(ARM_HALF_X, len / 2, 0.018)
            .setTranslation(mid.x, mid.y, 0)
            .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
            .setMass(cfg.clawFingerMass * 0.35)
            .setFriction(cfg.frictionClaw)
            .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Multiply)
            .setRestitution(0.0)
            .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
          body
        ));

        const m = new THREE.Mesh(new THREE.BoxGeometry(ARM_HALF_X * 2, len, 0.036), acrylic);
        m.position.set(mid.x, mid.y, 0);
        m.rotation.z = phi;
        m.castShadow = true;
        armMeshes.push(m);
      }

      // 납작한 발끝 판
      const tipCol = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(tipHalf, tipThick, tipWidth)
          .setTranslation(tipX, tipY, 0)
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
        { x: px, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }
      );
      const joint = this.world.createImpulseJoint(jd, this.head, body, true);
      if (typeof joint.setContactsEnabled === 'function') joint.setContactsEnabled(false);
      if (typeof joint.configureMotorModel === 'function') {
        joint.configureMotorModel(RAPIER.MotorModel.ForceBased);
      }

      // 메쉬
      const g = new THREE.Group();
      const tip = new THREE.Mesh(new THREE.BoxGeometry(tipHalf * 2, tipThick * 2, tipWidth * 2), dark);
      tip.position.set(tipX, tipY, 0);
      tip.castShadow = true;
      g.add(...armMeshes, tip);
      this.group.add(g);

      this.fingers.push({
        sign, body, joint, mesh: g,
        // 발가락 안쪽 끝점 = 팔 안쪽 면 + 발가락 전체 길이
        tipLocal: new THREE.Vector3(-sign * (ARM_HALF_X + tipHalf * 2), tipY, 0),
        padLocal: new THREE.Vector3(tipX, tipY - tipThick, 0),        // 발끝 판 아랫면 중앙
      });
    }

    this.applyMotor(true);
  }

  open() { this.targetSpread = this.cfg.clawOpenSpread; }
  close() { this.targetSpread = this.cfg.clawCloseSpread; }
  /** 파지 실패 — 모터가 버티지 못하고 발이 벌어진다 */
  slip() { this.targetSpread = Math.max(this.targetSpread, this.cfg.clawSlipSpread); }
  setGripTorque(t) { this.torque = t; }

  /** 발의 실제 각도 (Z축 회전) */
  angleOf(f) {
    const r = f.body.rotation();
    return Math.atan2(2 * (r.w * r.z), 1 - 2 * r.z * r.z);
  }

  applyMotor(snap = false) {
    const cfg = this.cfg;
    for (const f of this.fingers) {
      const target = f.sign * this.spread;
      const err = Math.abs(target - this.angleOf(f));
      // 일정 토크 = 강성 × 오차  →  강성 = 토크 / 오차
      const k = Math.min(cfg.clawMaxStiffness, this.torque / Math.max(0.03, err));
      f.joint.configureMotorPosition(target, k, cfg.clawGripDamping);
      f.motorError = err;
      if (snap) {
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), target);
        f.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      }
    }
  }

  update(dt) {
    const step = this.cfg.clawMotorSpeed * dt;
    const d = this.targetSpread - this.spread;
    this.spread += Math.max(-step, Math.min(step, d));
    this.applyMotor();
    this.head.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y, z: this.pos.z });
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

  /**
   * 파지 품질 0~1.
   *
   * 이 기계의 집게는 마찰로 옆면을 "무는" 것이 아니라, 납작한 발이 박스 **밑으로
   * 들어가 걷어 올리는** 방식이다. 따라서 품질은
   *   ① 발끝이 박스 바닥면보다 아래에 있는가 (밑으로 파고들었는가)
   *   ② 바닥면 안쪽으로 얼마나 깊이 들어갔는가 (모서리만 걸치면 낮음)
   * 로 정한다.
   */
  gripQuality(boxBody, half) {
    const bt = boxBody.translation();
    const br = boxBody.rotation();
    const inv = new THREE.Quaternion(br.x, br.y, br.z, br.w).invert();
    const origin = new THREE.Vector3(bt.x, bt.y, bt.z);
    const m = Math.max(1e-4, this.cfg.gripEdgeMargin);

    const q = this.fingers.map((f) => {
      const local = this.tipWorld(f).sub(origin).applyQuaternion(inv);
      // ① 바닥면보다 아래여야 걷어 올릴 수 있다 (약간의 여유 허용)
      const under = (-local.y) - half.y;
      if (under < -0.006) return 0;
      // ② 바닥면 안쪽으로 파고든 깊이
      const inX = half.x - Math.abs(local.x);
      const inZ = half.z - Math.abs(local.z);
      if (inX <= 0 || inZ <= 0) return 0;       // 발이 바닥 밑까지 안 들어옴
      return Math.min(1, Math.min(inX, inZ) / m);
    });

    return Math.sqrt(Math.max(0, q[0]) * Math.max(0, q[1]));
  }

  isMine(handle) { return this.myColliders.has(handle); }

  teleport(x, y, z) {
    this.pos.set(x, y, z);
    this.head.setTranslation({ x, y, z }, true);
    for (const f of this.fingers) {
      f.body.setTranslation({ x: x + f.sign * this.cfg.clawPivotX, y, z }, true);
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
