// 모든 튜닝 가능한 파라미터. 단위는 m / kg / s (1cm = 0.01)
// 값을 바꾸면 UI 패널에서 바로 반영되며, localStorage 에 저장된다.

export const DEFAULTS = {
  // ---- 봉(bar) 배치 ----
  barRadius: 0.009,      // 봉 반지름 (1.8cm 굵기)
  barLength: 0.92,       // 봉 길이 (좌우축 X 방향)
  barGapZ: 0.130,        // 2번-3번 봉 중심 간격 (틈). 실효 틈 = 이 값 - 2*barRadius = 11.2cm
  barOuterZ: 0.160,      // 1번/4번 봉 중심의 |z|
  barLowY: 0.55,         // 2·3번 봉 중심 높이
  // 1·4번 봉이 2·3번보다 높은 양.
  // (사양서의 12cm 로 올리면 박스가 1번 봉에 걸쳐 머무는 안정 자세가 사라진다 — README 참고)
  barRaise: 0.045,

  // ---- 마찰 (게임성의 핵심) ----
  frictionRubber: 1.60,  // 2·3번 봉: 고무 코팅
  frictionSlick: 0.125,  // 1·4번 봉: 코팅 없음 (미끄럼)
  frictionBox: 1.0,      // 박스 표면 (봉 쪽 Multiply 규칙으로 결합)
  frictionFloor: 0.75,
  frictionClaw: 0.05,

  // ---- 상품 박스 (빳빳한 종이) ----
  boxW: 0.12,            // X (가로, 봉과 평행)
  boxH: 0.10,            // Y (세로/높이)
  boxD: 0.20,            // Z (봉과 수직 — 가장 긴 변)
  boxMass: 0.20,
  boxRestitution: 0.02,
  boxLinDamp: 0.15,
  boxAngDamp: 0.25,
  boxArt: 'lumina',      // 박스 인쇄면 디자인 (src/figurebox.js 의 ARTS 키). 없는 키면 단색 박스

  // ---- 종이 찌그러짐 (시각 전용, 물리 형상은 강체 유지) ----
  // 빳빳한 코팅 판지: 얕게만 눌리고 금방 튀어 돌아온다
  paperDent: 0.004,      // 최대 눌림 깊이
  paperRadius: 0.050,    // 눌림이 퍼지는 반경
  paperAttack: 0.08,     // 눌리는 속도(시정수, 작을수록 즉각)
  paperRecover: 0.15,    // 되돌아오는 속도(시정수, 클수록 천천히)

  // ---- 집게 ----
  // 벌림각 spread: 0 = 두 발끝이 정중앙에서 맞닿음, 클수록 벌어짐.
  // 팔은 팔꿈치에서 직각으로 꺾인 ㄱ자다. 아래 치수는 "벌린 상태(⊓ 자)" 기준이며,
  // 오므리면 발끝이 정중앙에서 맞닿는 마름모가 된다. 벌림각은 형상에서 자동 계산.
  clawPivotX: 0.0948,    // 발 회전축의 |x| (캡슐 헤드 양 끝의 5시·7시 위치. 헤드 길이도 여기서 정해진다)
  clawElbowOut: 0.081,   // 축 → 팔꿈치 수평 길이 (벌린 상태)
  clawArmLen: 0.1485,    // 팔꿈치 → 발끝 수직 길이 (벌린 상태)
  clawTipThick: 0.00135, // 발끝 금속판 두께의 절반 (2.7mm 판)
  clawTipWidth: 0.0144,  // 발끝 판 폭의 절반 (Z 방향)
  // 발가락(안쪽으로 뻗은 판) 길이의 절반.
  // 발가락은 발(팔)의 안쪽 면에 붙어 있고 거기서부터 안쪽으로 뻗는다.
  // 따라서 이 값을 줄이면 박스 밑으로 파고드는 도달 거리도 같이 짧아진다.
  clawTipLen: 0.02025,
  clawTipRaise: 0.0027,  // 발바닥이 붙는 높이: 수직 팔 아래 끝에서 이만큼 위 (벌린 상태 기준)
  clawCloseSpread: 0.00,  // 0 = 발끝이 맞닿은 마름모
  // 파지력은 "각도 오차 × 강성" 이 아니라 일정한 토크로 준다.
  // (모터 강성을 매 프레임 torque/오차 로 역산 → 박스 폭과 무관하게 힘이 일정)
  // N·m. 발 하나가 오므리는 힘 (들어올리는 힘과는 별개 — 헤드 상승은 kinematic 이라 무제한).
  // 들어올리는 동안 박스 무게에 발이 벌어지지 않게 버티는 힘이기도 하다.
  // 측정: 0.10 이하면 박스를 못 들고, 1.0 이면 발이 모서리에 걸릴 때 박스를 튕겨 낸다
  // (0.55 m/s, 7 rad/s). 0.20 은 튕김이 거의 없고(0.03 m/s) 들기에는 2배 여유.
  clawGripTorque: 0.20,
  // N·m. 아무것에도 닿지 않은 발을 개폐 속도(clawMotorSpeed)대로 움직이는 구동력.
  // 파지 토크와 분리되어 있어, 파지력을 약하게 해도 벌리고 오므리는 속도는 그대로다.
  clawMoveTorque: 1.00,
  clawGripDamping: 0.35,
  clawMaxStiffness: 400, // 역산 강성 상한 (수치 안정용)
  clawFingerMass: 0.18,
  clawMotorSpeed: 2.4,   // 발 개폐 속도 (rad/s)

  // ---- 집게 이동 ----
  clawSpeedX: 0.19,      // m/s
  clawSpeedZ: 0.19,
  clawSpeedDown: 0.15,
  clawSpeedUp: 0.22,
  clawPause: 1.0,        // 자동 시퀀스의 각 동작 사이 멈춤 시간 (s)
  // 하강하면서 집게가 수직축을 중심으로 도는 각도(도, 위에서 봤을 때 시계방향이 +).
  // 끝까지 내려갔을 때 이 각도가 된다. 잡고 올리고 옮기는 동안 유지되고, 벌린 뒤 복귀하며 풀린다.
  clawDescendYaw: 7,
  // 접촉 후에도 더 내려가는 양. 0 이면 닿는 즉시 정지하고, 이 경우 기법 B(눌러서
  // 떨어뜨리기)가 물리적으로 불가능하다. 실제 기계도 관성 때문에 조금 더 눌린다.
  descendOvertravel: 0.005,
  clawTopY: 1.06,        // 집게 헤드 최상단 높이
  // 하강 한계(실기처럼 고정 깊이). 벌린 발끝은 헤드보다 약 17cm 아래다.
  // 이 집게는 마찰로 무는 게 아니라 발이 박스 "밑으로" 들어가 걷어 올리므로,
  // 발끝이 2·3번 봉 윗면(=박스 바닥)보다 충분히 내려가야 한다.
  // 실기처럼 헤드가 박스를 들이받는 깊이까지 내려간다 — 봉이나 박스에 닿으면
  // 접촉 자동 정지가 먼저 걸리고, 2–3번 틈 위에서만 이 깊이까지 내려간다.
  clawMinY: 0.600,
  homeX: 0.28,           // 홈 = 가장 오른쪽
  homeZ: 0.16,           // 1번 봉 위. 여기서 출발하고 여기로 복귀한다
  limitX: 0.28,          // cabW(0.50) - 벌렸을 때 팔 최대반경(약 0.199) - 여유
  limitZfront: 0.32,
  // 4번 봉(z=-0.16)과 진열대 앞 모서리(z≈-0.259) 사이까지 간다.
  // 하강 회전(clawDescendYaw 7°)으로 다리 하나는 뒤(진열대 쪽), 하나는 앞(4번 봉 쪽)으로 돈다.
  // 측정(7°): -0.220 은 진열대 모서리에 스침, -0.215 ~ -0.210 통과, -0.205 는 4번 봉에 걸림.
  // 그 가운데 값. 회전 각도를 바꾸면 이 범위도 달라진다. 진열대 위로는 못 간다.
  limitZback: -0.212,

  // ---- 기구/월드 ----
  cabW: 0.50,            // 캐비닛 반폭 |x|
  // 앞 유리와 1번 봉 사이 간격 = boxW + frontGap.
  // 박스가 여기 빠지면 껴서 회수하기 어렵다 (실수했을 때의 벌칙).
  frontGap: 0.020,
  cabDback: 0.710,       // 뒤쪽 깊이 (4번 봉 뒤 진열대 포함)
  shelfDrop: 0.10,       // 봉(2·3번) 대비 바깥 바닥판이 낮은 양
  chuteDrop: 0.45,       // 상품 출구 바닥 깊이
  displayCount: 5,       // 4번 봉 뒤 진열대에 올릴 장식용 피규어 박스 개수
  gravity: -9.81,
  subSteps: 2,           // 프레임당 물리 스텝 (timestep = 1/120)
  solverIters: 8,
};

/** 앞 유리 위치 (1번 봉 표면에서 boxW + frontGap 만큼 앞) */
export function cabDepthFront(cfg) {
  return cfg.barOuterZ + cfg.barRadius + cfg.boxW + cfg.frontGap;
}

// 피규어 종류. 고르면 values 의 값(박스 크기·봉 위치)으로 세팅이 바뀌고 기구를 다시 만든다.
// 새 종류는 여기에 { id, name, values } 를 추가하면 UI 에 번호 버튼이 자동으로 생긴다.
export const FIGURES = [
  {
    id: 1,
    name: '1번',
    values: {
      boxW: 0.12, boxH: 0.10, boxD: 0.20,               // 박스 크기
      barGapZ: 0.130, barOuterZ: 0.160, barRaise: 0.045, // 봉 위치
      boxArt: 'lumina',                                  // 박스 디자인
    },
  },
];

// UI 패널 생성용 스키마
export const SCHEMA = [
  { group: '마찰 (핵심)', items: [
    ['frictionRubber', '2·3번 봉 마찰(고무)', 0.05, 3.0, 0.05],
    ['frictionSlick',  '1·4번 봉 마찰(미끄럼)', 0.0, 1.0, 0.005],
    ['frictionBox',    '박스 표면 마찰', 0.05, 2.0, 0.05],
    ['frictionClaw',   '집게 발 마찰', 0.0, 2.0, 0.01],
    ['frictionFloor',  '바닥판 마찰', 0.05, 2.0, 0.05],
  ]},
  { group: '봉 배치', items: [
    ['barGapZ',   '2–3번 봉 간격', 0.10, 0.30, 0.002],
    ['barOuterZ', '1·4번 봉 위치 |z|', 0.11, 0.38, 0.005],
    ['barRaise',  '1·4번 봉 높이차', 0.0, 0.25, 0.005],
    ['barRadius', '봉 반지름', 0.004, 0.02, 0.001],
    ['frontGap',  '앞 유리 여유(박스폭 대비)', 0.0, 0.15, 0.005],
  ]},
  { group: '상품 박스', items: [
    ['boxW', '가로(X, 봉과 평행)', 0.05, 0.34, 0.005],
    ['boxH', '세로(Y, 높이)', 0.05, 0.35, 0.005],
    ['boxD', '깊이(Z, 봉과 수직)', 0.08, 0.40, 0.005],
    ['boxMass', '질량(kg)', 0.05, 3.0, 0.01],
    ['boxAngDamp', '회전 감쇠', 0.0, 2.0, 0.05],
    ['boxLinDamp', '이동 감쇠', 0.0, 2.0, 0.05],
  ]},
  { group: '종이 찌그러짐', items: [
    ['paperDent',    '최대 눌림 깊이', 0.0, 0.05, 0.001],
    ['paperRadius',  '눌림 반경', 0.01, 0.15, 0.005],
    ['paperAttack',  '눌리는 시정수', 0.01, 0.4, 0.01],
    ['paperRecover', '복원 시정수', 0.02, 2.0, 0.02],
  ]},
  { group: '집게', items: [
    ['clawGripTorque', '파지 토크(N·m, 접촉 시)', 0.05, 4.0, 0.02],
    ['clawMoveTorque', '개폐 구동력(N·m, 비접촉)', 0.1, 4.0, 0.05],
    ['clawGripDamping', '파지 감쇠', 0, 3, 0.05],
    ['clawCloseSpread', '벌림각 — 닫힘(rad)', 0.0, 0.8, 0.01],
    ['clawPivotX',   '발 축 간격 |x|', 0.03, 0.18, 0.005],
    ['clawElbowOut', '팔 수평 길이(벌림 기준)', 0.03, 0.16, 0.002],
    ['clawArmLen',   '팔 수직 길이(벌림 기준)', 0.06, 0.28, 0.005],
    ['clawTipThick', '발끝 두께(절반)', 0.0005, 0.01, 0.0005],
    ['clawTipWidth', '발끝 폭(절반)', 0.005, 0.06, 0.001],
    ['clawTipLen',   '발끝 길이(절반)', 0.008, 0.06, 0.001],
    ['clawTipRaise', '발바닥 붙는 높이', 0.0, 0.06, 0.0005],
    ['clawFingerMass', '발 질량(kg)', 0.02, 1.0, 0.01],
    ['clawMotorSpeed', '개폐 속도', 0.5, 15, 0.1],
  ]},
  { group: '집게 이동', items: [
    ['clawSpeedX', '좌우 속도', 0.05, 1.0, 0.01],
    ['clawSpeedZ', '전후 속도', 0.05, 1.0, 0.01],
    ['clawSpeedDown', '하강 속도', 0.05, 1.0, 0.01],
    ['clawSpeedUp', '상승 속도', 0.05, 1.0, 0.01],
    ['clawPause', '동작 사이 멈춤(s)', 0.0, 3.0, 0.05],
    ['clawDescendYaw', '하강 시 회전(°, 시계방향+)', -20, 20, 0.5],
    ['clawMinY', '하강 한계(헤드 y)', 0.50, 0.95, 0.005],
    ['descendOvertravel', '접촉 후 추가 하강(누름)', 0.0, 0.08, 0.002],
    ['homeX', '홈 위치 x', -0.45, 0.45, 0.01],
    ['homeZ', '홈 위치 z', -0.34, 0.34, 0.01],
  ]},
  { group: '월드', items: [
    ['displayCount', '뒤 진열대 피규어 수', 0, 9, 1],
    ['gravity', '중력', -25, -1, 0.1],
    ['subSteps', '프레임당 물리 스텝', 1, 4, 1],
    ['solverIters', '솔버 반복', 2, 20, 1],
  ]},
];

const KEY = 'ufo-catcher-cfg-v29';

export function loadConfig() {
  const cfg = { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(cfg, JSON.parse(raw));
  } catch (e) { /* 저장소 접근 불가 시 기본값 */ }
  return cfg;
}

export function saveConfig(cfg) {
  try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {}
}

export function clearConfig() {
  try { localStorage.removeItem(KEY); } catch (e) {}
}
