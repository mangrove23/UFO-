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
  OPEN: '집게 벌리는 중',
  OPEN_WAIT: '벌림 완료 — 잠시 대기',
  DESCEND: '하강 중 — 정지 버튼 / 접촉 시 자동 정지',
  BOTTOM_WAIT: '하강 완료 — 잠시 대기',
  CLOSE: '집게 오므리는 중',
  CLOSE_WAIT: '오므림 완료 — 잠시 대기',
  LIFT: '들어올리는 중',
  TOP_WAIT: '상승 완료 — 잠시 대기',
  CARRY: '중앙으로 이동 중',
  CENTER_WAIT: '중앙 도착 — 잠시 대기',
  RELEASE: '집게 벌림 — 잠시 대기',
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
    this.axisEngaged = false;
    this.yaw = 0;               // 집게 수직축 회전 (rad) — update() 참고
    this.dirX = -1;            // 홈이 가장 오른쪽이므로 왼쪽(-X)으로 진행
    this.dirZ = -1;             // 앞(+Z)에서 뒤(-Z)로 진행
    this.btn = { move: false, fwd: false, stop: false };
    this.prevBtn = { move: false, fwd: false, stop: false };
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
      // 인쇄면 텍스처는 figurebox.js 가 캐시해 재사용하므로 재질만 버린다
      for (const m of [].concat(this.boxMesh.material)) m.dispose();
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
    this.setState('AIM_X');
    return true;
  }

  /** 승리 화면의 "다시하기" — 기구와 집게를 처음 상태로 되돌린다 */
  restart() {
    const cfg = this.cfg;
    this.resetBox();
    this.claw.teleport(cfg.homeX, cfg.clawTopY, cfg.homeZ);
    this.claw.close();
    this.yaw = 0;
    this.stopReason = '';
    this.setState('IDLE');
  }

  /** 조준이 끝나면 발을 먼저 끝까지 벌린다. 다 벌어지면 OPEN 이 하강을 시작한다. */
  beginDescend() {
    this.claw.open();
    this.contactStop = false;
    this.pressUntil = null;
    this.setState('OPEN');
  }

  /**
   * 집게 헤드를 (x, z) 로 한 프레임만큼 옮긴다. 두 축은 각자의 속도로 동시에 움직인다.
   * @returns 도착했으면 true
   */
  moveToward(x, z, dt) {
    const { claw, cfg } = this;
    const dx = x - claw.pos.x;
    const dz = z - claw.pos.z;
    const sx = cfg.clawSpeedX * dt, sz = cfg.clawSpeedZ * dt;
    claw.pos.x += clamp(dx, -sx, sx);
    claw.pos.z += clamp(dz, -sz, sz);
    return Math.abs(dx) <= sx && Math.abs(dz) <= sz;
  }

  /** 박스를 내려놓는 중앙 지점: 좌우 정중앙, 앞뒤는 2–3번 봉 사이 한가운데 */
  centerPoint() {
    const bars = barLayout(this.cfg);
    const z2 = bars.find((b) => b.n === 2).z;
    const z3 = bars.find((b) => b.n === 3).z;
    return { x: 0, z: (z2 + z3) / 2 };
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
          this.setState('AIM_X_DONE');
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
          this.beginDescend();
        }
        break;

      // ─── 여기부터는 실기와 같은 자동 시퀀스 ───
      // 벌림 → (대기) → 하강 → (대기) → 오므림 → (대기) → 상승 → (대기)
      // → 닫은 채 중앙으로 이동 → (대기) → 벌림 → (대기) → 시작점 복귀

      // 발이 끝까지 벌어진 뒤, 잠시 기다렸다가 내려가기 시작한다
      case 'OPEN':
        if (claw.settled(0.05) || this.timer > 1.0) this.setState('OPEN_WAIT');
        break;

      case 'OPEN_WAIT':
        if (this.timer >= cfg.clawPause) this.setState('DESCEND');
        break;

      case 'DESCEND': {
        claw.pos.y = Math.max(cfg.clawMinY, claw.pos.y - cfg.clawSpeedDown * dt);
        const bottom = claw.pos.y <= cfg.clawMinY + 1e-6;
        const stopBtn = this.pressed('stop');

        // 접촉하면 곧바로 멈추지 않고 overtravel 만큼 더 눌러 준다 (기법 B의 근거)
        if (this.contactStop && this.pressUntil === null) {
          this.pressUntil = claw.pos.y - cfg.descendOvertravel;
        }
        const pressed = this.pressUntil !== null && claw.pos.y <= this.pressUntil;

        if (bottom || stopBtn || pressed) {
          this.stopReason = stopBtn ? '정지 버튼'
            : (pressed ? `접촉 자동 정지 (+${(cfg.descendOvertravel * 100).toFixed(1)}cm 누름)` : '하강 한계');
          this.setState('BOTTOM_WAIT');
        }
        break;
      }

      case 'BOTTOM_WAIT':
        if (this.timer >= cfg.clawPause) {
          claw.close();
          this.setState('CLOSE');
        }
        break;

      // 박스를 물면 발이 끝까지 닫히지 않으므로, 실제 각도가 아니라 명령값 기준으로 판단
      case 'CLOSE':
        if (claw.reachedTarget()) this.setState('CLOSE_WAIT');
        break;

      case 'CLOSE_WAIT':
        if (this.timer >= cfg.clawPause) this.setState('LIFT');
        break;

      case 'LIFT':
        claw.pos.y = Math.min(cfg.clawTopY, claw.pos.y + cfg.clawSpeedUp * dt);
        if (claw.pos.y >= cfg.clawTopY - 1e-4) this.setState('TOP_WAIT');
        break;

      case 'TOP_WAIT':
        if (this.timer >= cfg.clawPause) this.setState('CARRY');
        break;

      // 발을 닫은(= 잡은) 채로 중앙 지점까지 옮긴다
      case 'CARRY': {
        const c = this.centerPoint();
        if (this.moveToward(c.x, c.z, dt)) this.setState('CENTER_WAIT');
        break;
      }

      case 'CENTER_WAIT':
        if (this.timer >= cfg.clawPause) {
          claw.open();
          this.setState('RELEASE');
        }
        break;

      // 벌린 뒤 잠시 기다려 박스가 발에서 떨어지게 한다
      case 'RELEASE':
        if (this.timer >= cfg.clawPause) this.setState('RETURN');
        break;

      // 벌린 채로 시작점까지 돌아간 뒤 오므린다 (닫은 채 이동하면 박스가 다시 잡힐 수 있다)
      case 'RETURN':
        if (this.moveToward(cfg.homeX, cfg.homeZ, dt)) {
          if (!this.clawTouchingBox()) claw.close();
          this.setState('IDLE');
        }
        break;

      // 자동 복귀하지 않는다. UI 의 "다시하기" 버튼이 restart() 를 부를 때까지 대기.
      case 'WIN':
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

    // 케이블이 풀리며 집게가 수직축으로 살짝 돈다.
    // 하강 중에는 내려간 깊이에 비례해 돌고, 잡고·올리고·옮기는 동안은 그 각도를 유지한다
    // (박스를 문 채로 되돌리면 박스가 비틀려 옮기는 도중 떨어진다 — 측정으로 확인).
    // 발을 벌린 뒤부터 1초에 최대 각도만큼씩 풀린다.
    const yawMax = cfg.clawDescendYaw * Math.PI / 180;
    if (this.state === 'DESCEND') {
      const depth = clamp((cfg.clawTopY - claw.pos.y) / Math.max(1e-6, cfg.clawTopY - cfg.clawMinY), 0, 1);
      this.yaw = depth * yawMax;
    } else if (this.state === 'RELEASE' || this.state === 'RETURN' || this.state === 'IDLE') {
      const s = Math.abs(yawMax) * dt;
      this.yaw -= clamp(this.yaw, -s, s);
    }
    claw.yaw = this.yaw;

    claw.update(dt);
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
    this.yaw = 0;
    this.resetBox();
    this.setState('IDLE');
  }
}
