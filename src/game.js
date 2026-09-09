import RAPIER from 'rapier';
import * as THREE from 'three';
import { syncMesh } from './physics.js';
import { Machine, barLayout } from './machine.js';
import { Claw } from './claw.js';
import { PaperDeform, makePaperBoxMesh } from './paperbox.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export const STATE = {
  IDLE: '대기 — 이동 버튼으로 플레이 시작',
  AIM_X: '좌우 이동 중 (버튼을 놓으면 정지)',
  AIM_X_DONE: '좌우 정지 — 전진 버튼을 누르세요',
  AIM_Z: '전진 중 (버튼을 놓으면 하강)',
  AIM_FREE: '자유 조작 — 이동/전진 반복 가능, 정지 버튼으로 하강',
  DESCEND: '하강 중 — 정지 버튼 / 접촉 시 자동 정지',
  CLOSE: '집게 오므리는 중',
  LIFT: '들어올리는 중',
  RELEASE: '집게 벌리는 중',
  RETURN: '시작점으로 복귀 중',
  WIN: '성공! 상품이 틈으로 낙하',
};

export class Game {
  constructor(world, scene, cfg) {
    this.world = world;
    this.scene = scene;
    this.cfg = cfg;

    this.machine = new Machine(world, scene, cfg);
    this.claw = new Claw(world, scene, cfg);

    this.boxBody = null;
    this.boxMesh = null;
    this.clawBoxPairs = new Set();   // 집게↔박스 활성 접촉
    this.boxBarPairs = new Map();    // 박스↔봉 활성 접촉 (colliderHandle → 봉 번호)
    this.createBox();

    this.state = 'IDLE';
    this.timer = 0;
    this.freeMode = false;      // true 면 좌우/전진을 몇 번이든 다시 조작 가능
    this.axisEngaged = false;
    this.dirX = -1;             // 홈이 가장 오른쪽이므로 왼쪽(-X)으로 진행
    this.dirZ = -1;             // 앞(+Z)에서 뒤(-Z)로 진행
    this.btn = { move: false, fwd: false, stop: false };
    this.prevBtn = { move: false, fwd: false, stop: false };
    this.lastGrip = { quality: 0, failP: 0, roll: 0, failed: false };
    this.contactStop = false;
    this.pressUntil = null;
    this.stopReason = '';
    this.attempts = 0;
    this.wins = 0;
    this.onStateChange = () => {};
  }

  // ---------------------------------------------------------------- 상품 박스

  createBox(pose = null) {
    const cfg = this.cfg;
    if (this.boxBody) { this.world.removeRigidBody(this.boxBody); this.boxBody = null; }
    if (this.boxMesh) {
      this.scene.remove(this.boxMesh);
      this.boxMesh.geometry.dispose();
      this.boxMesh.material.dispose();
    }

    this.clawBoxPairs = new Set();
    this.boxBarPairs = new Map();

    const half = { x: cfg.boxW / 2, y: cfg.boxH / 2, z: cfg.boxD / 2 };
    this.boxHalf = half;

    const p = pose || this.defaultPose();
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setLinearDamping(cfg.boxLinDamp)
      .setAngularDamping(cfg.boxAngDamp)
      .setCcdEnabled(true);
    if (p.q) desc.setRotation(p.q);
    this.boxBody = this.world.createRigidBody(desc);

    const density = cfg.boxMass / (cfg.boxW * cfg.boxH * cfg.boxD);
    this.boxCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
        .setDensity(density)
        .setFriction(cfg.frictionBox)
        .setRestitution(cfg.boxRestitution)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      this.boxBody
    );

    // 빳빳한 종이 상자 — 눌린 자국이 보이도록 분할된 메쉬
    const mesh = makePaperBoxMesh(cfg);
    this.scene.add(mesh);
    this.boxMesh = mesh;
    this.paper = new PaperDeform(mesh, half, cfg);
    this._pressers = [];
  }

  /** 시작 자세: 25cm 변이 봉과 수직이 되도록 2–3번 봉 위에 걸침 */
  defaultPose() {
    const cfg = this.cfg;
    return { x: 0, y: cfg.barLowY + cfg.barRadius + cfg.boxH / 2 + 0.002, z: 0, q: null };
  }

  /** 1번 또는 4번 봉 위에 걸쳐 놓기 (기법 A/B 테스트용) */
  poseOnOuterBar(which) {
    const cfg = this.cfg;
    const bar = barLayout(cfg).find((b) => b.n === which);
    // 무게중심을 봉보다 살짝 안쪽(틈 방향)에 두면 안쪽으로 기울며 1+2번(또는 4+3번)
    // 봉에 걸친 자세로 안착한다 — 기법 A/B 의 출발 자세.
    return {
      x: 0,
      y: bar.y + cfg.barRadius + cfg.boxH / 2 + 0.004,
      z: bar.z - Math.sign(bar.z) * 0.02,
      q: null,
    };
  }

  resetBox(pose = null) {
    this.createBox(pose);
  }

  // ---------------------------------------------------------------- 플레이 흐름

  /**
   * 플레이 1회 시작.
   * ─ 0단계에서는 무제한. 이후 코인/광고 단계를 넣을 지점은 딱 여기 한 곳이다.
   *   예)  if (!wallet.trySpend(1)) { ui.showNeedCoin(); return false; }
   */
  startPlay() {
    if (this.state !== 'IDLE') return false;
    this.attempts++;
    if (!this.clawTouchingBox()) this.claw.close();  // 박스가 얹혀 있으면 벌린 채로 시작
    this.claw.setGripTorque(this.cfg.clawGripTorque);
    this.setState('AIM_X');
    return true;
  }

  /** 집게를 벌리고 자동 하강 시작 */
  beginDescend() {
    this.claw.open();
    this.contactStop = false;
    this.pressUntil = null;
    this.setState('DESCEND');
  }

  setState(s) {
    this.state = s;
    this.timer = 0;
    this.onStateChange(s);
  }

  setButtons(b) {
    this.prevBtn = { ...this.btn };
    this.btn = { ...b };
  }

  pressed(name) { return this.btn[name] && !this.prevBtn[name]; }
  released(name) { return !this.btn[name] && this.prevBtn[name]; }

  /**
   * 접촉 이벤트 처리 (main 루프의 이벤트 큐에서 호출).
   * 실제 접촉 시작/종료만 오므로 브로드페이즈 오탐이 없다.
   */
  onCollision(h1, h2, started) {
    const bh = this.boxCollider.handle;
    const mine1 = this.claw.isMine(h1), mine2 = this.claw.isMine(h2);

    // 박스 ↔ 집게
    if ((mine1 && h2 === bh) || (mine2 && h1 === bh)) {
      const key = `${Math.min(h1, h2)}|${Math.max(h1, h2)}`;
      if (started) this.clawBoxPairs.add(key); else this.clawBoxPairs.delete(key);
    }
    // 박스 ↔ 봉
    for (const [a, b] of [[h1, h2], [h2, h1]]) {
      if (a !== bh) continue;
      const n = this.machine.barColliders.get(b);
      if (!n) continue;
      if (started) this.boxBarPairs.set(b, n); else this.boxBarPairs.delete(b);
    }

    // 하강 중 집게가 무언가에 닿으면 자동 정지
    if (started && mine1 !== mine2 && this.state === 'DESCEND') this.contactStop = true;
  }

  update(dt) {
    const cfg = this.cfg;
    const claw = this.claw;
    this.timer += dt;

    switch (this.state) {
      case 'IDLE':
        if (this.pressed('move')) this.startPlay();
        break;

      // ① 좌우 버튼: 누르는 동안 X(봉과 평행) 이동, 떼면 그 자리에서 정지
      case 'AIM_X':
        if (this.btn.move) {
          this.axisEngaged = true;
          claw.pos.x = clamp(claw.pos.x + this.dirX * cfg.clawSpeedX * dt, -cfg.limitX, cfg.limitX);
        } else if (this.axisEngaged) {
          this.axisEngaged = false;
          if (this.freeMode) { this.dirX *= -1; this.setState('AIM_FREE'); }
          else this.setState('AIM_X_DONE');
        }
        break;

      case 'AIM_X_DONE':
        if (this.pressed('fwd')) this.setState('AIM_Z');
        break;

      // ② 전진 버튼: 누르는 동안 Z(봉과 수직) 이동, 떼면 벌어지며 자동 하강
      case 'AIM_Z':
        if (this.btn.fwd) {
          this.axisEngaged = true;
          claw.pos.z = clamp(claw.pos.z + this.dirZ * cfg.clawSpeedZ * dt, cfg.limitZback, cfg.limitZfront);
        } else if (this.axisEngaged) {
          this.axisEngaged = false;
          if (this.freeMode) { this.dirZ *= -1; this.setState('AIM_FREE'); }
          else { this.beginDescend(); }
        }
        break;

      // 자유 조작 모드: 좌우/전진을 몇 번이든 다시 조작, 정지 버튼으로 하강 시작
      case 'AIM_FREE':
        if (this.pressed('move')) { this.setState('AIM_X'); break; }
        if (this.pressed('fwd')) { this.setState('AIM_Z'); break; }
        if (this.pressed('stop')) {
          this.beginDescend();
        }
        break;

      case 'DESCEND': {
        claw.pos.y = Math.max(cfg.clawMinY, claw.pos.y - cfg.clawSpeedDown * dt);
        const bottom = claw.pos.y <= cfg.clawMinY + 1e-6;
        const stopBtn = this.pressed('stop');
        // 발이 벌어지기 전(0.15초)엔 접촉 정지를 무시해 헛정지 방지
        const touched = this.contactStop && this.timer > 0.15;

        // 접촉하면 곧바로 멈추지 않고 overtravel 만큼 더 눌러 준다 (기법 B의 근거)
        if (touched && this.pressUntil === null) {
          this.pressUntil = claw.pos.y - cfg.descendOvertravel;
        }
        const pressed = this.pressUntil !== null && claw.pos.y <= this.pressUntil;

        if (bottom || stopBtn || pressed) {
          this.stopReason = stopBtn ? '정지 버튼'
            : (pressed ? `접촉 자동 정지 (+${(cfg.descendOvertravel * 100).toFixed(1)}cm 누름)` : '하강 한계');
          claw.close();
          this.setState('CLOSE');
        }
        break;
      }

      case 'CLOSE':
        if (this.timer > 0.55) {
          this.rollGrip();
          this.setState('LIFT');
        }
        break;

      case 'LIFT':
        claw.pos.y = Math.min(cfg.clawTopY, claw.pos.y + cfg.clawSpeedUp * dt);
        // 파지 실패는 들어올리는 도중 발이 벌어지며 드러난다
        if (this.lastGrip.failed && this.timer > cfg.clawSlipDelay) claw.slip();
        // 끝까지 올라가면 그 자리에서 먼저 벌린다 (박스는 집어 올린 자리로 떨어진다)
        if (claw.pos.y >= cfg.clawTopY - 1e-4) {
          claw.open();
          this.setState('RELEASE');
        }
        break;

      // 벌린 채로 박스가 발에서 떨어질 때까지 기다린다 (닫으면 다시 잡혀 버림)
      case 'RELEASE':
        if (this.timer > 0.9 && (!this.clawTouchingBox() || this.timer > 2.5)) {
          claw.setGripTorque(cfg.clawGripTorque);
          this.setState('RETURN');
        }
        break;

      // 벌린 채로 시작점까지 돌아간 뒤 오므린다
      case 'RETURN': {
        const dx = cfg.homeX - claw.pos.x;
        const dz = cfg.homeZ - claw.pos.z;
        const sx = cfg.clawSpeedX * dt, sz = cfg.clawSpeedZ * dt;
        claw.pos.x += Math.max(-sx, Math.min(sx, dx));
        claw.pos.z += Math.max(-sz, Math.min(sz, dz));
        if (Math.abs(dx) < 1e-3 && Math.abs(dz) < 1e-3) {
          if (!this.clawTouchingBox()) claw.close();
          this.setState('IDLE');
        }
        break;
      }

      case 'WIN':
        if (this.timer > 2.2) {
          this.resetBox();
          claw.teleport(cfg.homeX, cfg.clawTopY, cfg.homeZ);
          claw.close();
          claw.setGripTorque(cfg.clawGripTorque);
          this.setState('IDLE');
        }
        break;
    }

    // 승리 판정: 박스가 틈을 완전히 통과해 아래로 떨어짐
    if (this.state !== 'WIN') {
      const t = this.boxBody.translation();
      if (t.y < cfg.barLowY - 0.20) {
        this.wins++;
        this.setState('WIN');
      }
    }

    claw.update(dt);
  }

  /** 파지 품질을 계산하고 확률적으로 grip 실패를 판정 */
  rollGrip() {
    const cfg = this.cfg;
    const quality = this.claw.gripQuality(this.boxBody, this.boxHalf);
    const failP = cfg.gripFailMin + (cfg.gripFailBase - cfg.gripFailMin) * (1 - quality);
    const roll = Math.random();
    const failed = roll < failP;
    this.claw.setGripTorque(failed ? cfg.clawSlipTorque : cfg.clawGripTorque);
    this.lastGrip = { quality, failP, roll, failed };
    return this.lastGrip;
  }

  /** 집게(헤드/발)가 박스에 닿아 있는가 */
  clawTouchingBox() { return this.clawBoxPairs.size > 0; }

  /** 지금 박스가 닿아 있는 봉 번호 목록 (튜닝용 계측) */
  barContacts() {
    return [...new Set(this.boxBarPairs.values())].sort();
  }

  render(dt = 1 / 60) {
    syncMesh(this.boxMesh, this.boxBody);
    this.claw.render();
    this.updatePaper(dt);
  }

  /** 집게·봉이 누르고 있는 지점을 모아 종이 상자를 찌그러뜨린다 */
  updatePaper(dt) {
    const pressers = this.claw.pressers(this._pressers);
    const t = this.boxBody.translation();
    // 하중이 실린 지지점(닿아 있는 봉)도 옅은 자국을 남긴다
    for (const n of this.barContacts()) {
      const bar = this.machine.bars.find((b) => b.n === n);
      if (!bar) continue;
      pressers.push({
        point: new THREE.Vector3(t.x, bar.y + this.cfg.barRadius, bar.z),
        strength: 0.12,
      });
    }
    this.paper.update(dt, t, this.boxBody.rotation(), pressers);
  }

  /** 파라미터 변경 후 전체 재구성 */
  rebuild() {
    this.machine.dispose();
    this.claw.dispose();
    this.machine = new Machine(this.world, this.scene, this.cfg);
    this.claw = new Claw(this.world, this.scene, this.cfg);
    this.resetBox();
    this.setState('IDLE');
  }
}
