import RAPIER from 'rapier';
import * as THREE from 'three';
import { cylinderAlongX } from './physics.js';
import { cabDepthFront } from './config.js';

/**
 * 봉 4개의 배치.
 * 1번이 플레이어(카메라, +Z)에 가장 가깝다.
 *  - 2·3번: 낮음 + 고무 코팅(마찰 큼)
 *  - 1·4번: 높음 + 코팅 없음(미끄러움) → 박스가 걸치면 쉽게 피벗 회전
 */
export function barLayout(cfg) {
  return [
    { n: 1, z: +cfg.barOuterZ,   y: cfg.barLowY + cfg.barRaise, mu: cfg.frictionSlick,  slick: true },
    { n: 2, z: +cfg.barGapZ / 2, y: cfg.barLowY,                mu: cfg.frictionRubber, slick: false },
    { n: 3, z: -cfg.barGapZ / 2, y: cfg.barLowY,                mu: cfg.frictionRubber, slick: false },
    { n: 4, z: -cfg.barOuterZ,   y: cfg.barLowY + cfg.barRaise, mu: cfg.frictionSlick,  slick: true },
  ];
}

/** 2–3번 봉 사이 "열린 틈"의 실제 반폭 (봉 표면 기준) */
export function slotHalfWidth(cfg) {
  return cfg.barGapZ / 2 - cfg.barRadius;
}

const MUL = () => RAPIER.CoefficientCombineRule.Multiply;

export class Machine {
  constructor(world, scene, cfg) {
    this.world = world;
    this.scene = scene;
    this.cfg = cfg;
    this.bodies = [];
    this.barColliders = new Map(); // collider.handle -> 봉 번호
    this.group = new THREE.Group();
    scene.add(this.group);
    this.build();
  }

  build() {
    const cfg = this.cfg;
    const bars = barLayout(cfg);
    this.bars = bars;

    const shelfY = cfg.barLowY - cfg.shelfDrop;
    const chuteY = cfg.barLowY - cfg.chuteDrop;
    const slotHalf = slotHalfWidth(cfg);
    const dFront = cabDepthFront(cfg);
    const dBack = cfg.cabDback;
    const bar4Back = cfg.barOuterZ + cfg.barRadius; // 4번 봉 뒤쪽 면
    this.dFront = dFront;

    // ---- 봉 4개 ----
    const rot = cylinderAlongX();
    const matRubber = new THREE.MeshStandardMaterial({ color: 0x23262c, roughness: 0.95, metalness: 0.05 });
    const matSlick = new THREE.MeshStandardMaterial({ color: 0xd7dde6, roughness: 0.12, metalness: 0.95 });

    for (const b of bars) {
      const rb = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(0, b.y, b.z)
      );
      const col = this.world.createCollider(
        RAPIER.ColliderDesc.cylinder(cfg.barLength / 2, cfg.barRadius)
          .setRotation(rot)
          .setFriction(b.mu)
          .setFrictionCombineRule(MUL())
          .setRestitution(0.0)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        rb
      );
      this.barColliders.set(col.handle, b.n);
      this.bodies.push(rb);

      const geo = new THREE.CylinderGeometry(cfg.barRadius, cfg.barRadius, cfg.barLength, 20);
      geo.rotateZ(Math.PI / 2);
      const mesh = new THREE.Mesh(geo, b.slick ? matSlick : matRubber);
      mesh.position.set(0, b.y, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      // 1·2번, 3·4번이 화면에서 겹치지 않게 라벨을 번갈아 밀어 둔다
      const tag = makeLabel(String(b.n));
      tag.position.set(cfg.barLength / 2 + 0.035 + (b.n % 2 ? 0.055 : 0), b.y + 0.02, b.z);
      this.group.add(tag);
    }

    const matShelf = new THREE.MeshStandardMaterial({ color: 0x2e3440, roughness: 0.8, metalness: 0.15 });

    // ---- 앞쪽 바닥판(트렌치): 1번 봉 앞 ~ 앞 유리 ----
    // 1번 봉과 앞 유리 사이가 박스 가로보다 조금 넓어서, 박스가 여기 빠지면 낀다.
    const bar1Front = cfg.barOuterZ + cfg.barRadius;
    this.addBox(cfg.cabW, 0.01, (dFront - bar1Front) / 2, 0, shelfY, (bar1Front + dFront) / 2,
      matShelf, cfg.frictionFloor);

    // ---- 1번 봉 ~ 4번 봉 구간은 바닥이 없다 ----
    // 실기와 같이 봉 자체가 바닥이고 그 아래는 상품 출구까지 뚫려 있다.
    // 그래도 통과할 수 있는 곳은 2–3번 봉 사이뿐이다:
    //   1–2번, 3–4번 봉 사이 간격은 박스의 최소 통과폭보다 좁아 박스가 끼어 버린다.

    // ---- 4번 봉 뒤 진열대: 2·3번 봉 윗면과 같은 높이 ----
    const dispTop = cfg.barLowY + cfg.barRadius;
    const dispHalfD = (dBack - bar4Back) / 2;
    this.addBox(cfg.cabW, 0.01, dispHalfD, 0, dispTop - 0.01, -(bar4Back + dBack) / 2,
      new THREE.MeshStandardMaterial({ color: 0x333b49, roughness: 0.75 }), cfg.frictionFloor);
    this.addDisplayPrizes(dispTop, bar4Back, dBack);

    // ---- 상품 출구 바닥 ----
    this.addBox(cfg.cabW, 0.01, (dFront + dBack) / 2, 0, chuteY, (dFront - dBack) / 2,
      new THREE.MeshStandardMaterial({ color: 0x11141a, roughness: 1.0 }), 0.9);

    // ---- 벽 ----
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xaee0ff, transparent: true, opacity: 0.10, roughness: 0.05,
      metalness: 0.0, side: THREE.DoubleSide, depthWrite: false,
    });
    // 옆면도 반투명 — 측면 뷰에서 봉 단면과 박스 기울기를 관찰할 수 있어야 한다
    const side = new THREE.MeshStandardMaterial({
      color: 0x8fb6d6, transparent: true, opacity: 0.07, roughness: 0.3,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const wallTop = cfg.clawTopY + 0.10;
    const wallH = (wallTop - chuteY) / 2;
    const wallCY = (wallTop + chuteY) / 2;
    const halfD = (dFront + dBack) / 2;
    const midZ = (dFront - dBack) / 2;

    this.addBox(0.01, wallH, halfD, -cfg.cabW, wallCY, midZ, side, 0.4);
    this.addBox(0.01, wallH, halfD, +cfg.cabW, wallCY, midZ, side, 0.4);
    this.addBox(cfg.cabW, wallH, 0.01, 0, wallCY, +dFront, glass, 0.3);   // 앞 유리
    this.addBox(cfg.cabW, wallH, 0.01, 0, wallCY, -dBack, side, 0.3);     // 뒷벽

    // ---- 틈(승리 통로) 하이라이트 ----
    const slotGeo = new THREE.PlaneGeometry(cfg.barLength, slotHalf * 2);
    slotGeo.rotateX(-Math.PI / 2);
    const slot = new THREE.Mesh(slotGeo, new THREE.MeshBasicMaterial({
      color: 0x35d07f, transparent: true, opacity: 0.13, side: THREE.DoubleSide,
    }));
    slot.position.set(0, chuteY + 0.004, 0);
    this.group.add(slot);
  }

  /** 장식용 피규어 박스들 (직원이 리필해 두는 재고). 물리적으로는 고정. */
  addDisplayPrizes(topY, zNear, zFar) {
    const cfg = this.cfg;
    const n = Math.max(0, Math.round(cfg.displayCount));
    if (!n) return;
    const palette = [0x4dabf7, 0xffd43b, 0x69db7c, 0xff8787, 0xb197fc, 0xffa94d];
    const w = cfg.boxW * 0.9, h = cfg.boxH * 0.95, d = cfg.boxD * 0.85;
    const usable = cfg.cabW * 2 - 0.06;
    const step = Math.min(w + 0.02, usable / Math.max(1, n));
    const z = -(zNear + Math.min(zFar - zNear - d / 2 - 0.02, d / 2 + 0.05));

    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * step;
      const mat = new THREE.MeshStandardMaterial({
        color: palette[i % palette.length], roughness: 0.85, metalness: 0.0,
      });
      const mesh = this.addBox(w / 2, h / 2, d / 2, x, topY + h / 2, z, mat, 0.8);
      // 앞면에 밝은 띠 — 상품 박스처럼 보이게
      const band = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.005, h * 0.16, d * 1.005),
        new THREE.MeshStandardMaterial({ color: 0xf8f9fa, roughness: 0.9 })
      );
      band.position.y = h * 0.28;
      mesh.add(band);
    }
  }

  addBox(hx, hy, hz, x, y, z, material, friction) {
    const rb = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(friction).setRestitution(0.0), rb
    );
    this.bodies.push(rb);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), material);
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  dispose() {
    for (const b of this.bodies) this.world.removeRigidBody(b);
    this.bodies.length = 0;
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
  }
}

function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#0b0e13';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#ffd166';
  g.font = 'bold 44px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(0.05, 0.05, 0.05);
  return sp;
}
