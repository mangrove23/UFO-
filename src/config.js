// 모든 튜닝 가능한 파라미터. 단위는 m / kg / s (1cm = 0.01)
// 값을 바꾸면 UI 패널에서 바로 반영되며, localStorage 에 저장된다.

export const DEFAULTS = {
  // ---- 봉(bar) 배치 ----
  barRadius: 0.009,      // 봉 반지름 (1.8cm 굵기)
  barLength: 0.92,       // 봉 길이 (좌우축 X 방향)
  barGapZ: 0.140,        // 2번-3번 봉 중심 간격 (틈). 실효 틈 = 이 값 - 2*barRadius
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
  frictionClaw: 0.20,

  // ---- 상품 박스 (빳빳한 종이) ----
  boxW: 0.12,            // X (가로, 봉과 평행)
  boxH: 0.10,            // Y (세로/높이)
  boxD: 0.20,            // Z (봉과 수직 — 가장 긴 변)
  boxMass: 0.20,
  boxRestitution: 0.02,
  boxLinDamp: 0.15,
  boxAngDamp: 0.25,

  // ---- 종이 찌그러짐 (시각 전용, 물리 형상은 강체 유지) ----
  paperDent: 0.014,      // 최대 눌림 깊이
  paperRadius: 0.060,    // 눌림이 퍼지는 반경
  paperAttack: 0.06,     // 눌리는 속도(시정수, 작을수록 즉각)
  paperRecover: 0.30,    // 되돌아오는 속도(시정수, 클수록 천천히)

  // ---- 집게 ----
  // 벌림각 spread: 0 = 두 발끝이 정중앙에서 맞닿음, 클수록 벌어짐.
  clawPivotX: 0.100,     // 발 회전축의 |x| (= 발끝이 안쪽으로 뻗는 길이와 동일)
  clawArmLen: 0.170,     // 발 길이
  clawTipThick: 0.006,   // 발끝 판 두께의 절반 (납작한 판)
  clawTipWidth: 0.021,   // 발끝 판 폭의 절반 (Z 방향)
  // 발가락(안쪽으로 꺾인 판) 길이의 절반.
  // 발가락은 발(팔)의 안쪽 면에 붙어 있고 거기서부터 안쪽으로 뻗는다.
  // 따라서 이 값을 줄이면 박스 밑으로 파고드는 도달 거리도 같이 짧아진다.
  clawTipLen: 0.0225,
  clawOpenSpread: 0.85,  // 벌어졌을 때 (rad)
  clawCloseSpread: 0.00,  // 발가락이 짧아져 서로 부딪히지 않으므로 끝까지 오므린다
  // 파지력은 "각도 오차 × 강성" 이 아니라 일정한 토크로 준다.
  // (모터 강성을 매 프레임 torque/오차 로 역산 → 박스 폭과 무관하게 힘이 일정)
  clawGripTorque: 1.00,  // N·m. 발 하나가 박스를 무는 힘
  clawSlipTorque: 1.00,  // grip 실패 시 토크
  // grip 실패 시: 들어올리는 도중 모터가 버티지 못하고 발이 이만큼 벌어진다.
  // (실기에서도 상승 직후 파지압이 빠지면서 놓친다)
  clawSlipSpread: 0.20,
  clawSlipDelay: 0.40,   // 오므린 뒤 이 시간이 지나면 벌어짐
  clawGripDamping: 0.35,
  clawMaxStiffness: 400, // 역산 강성 상한 (수치 안정용)
  clawFingerMass: 0.18,
  clawMotorSpeed: 2.4,   // 발 개폐 속도 (rad/s)

  // ---- 집게 이동 ----
  clawSpeedX: 0.19,      // m/s
  clawSpeedZ: 0.19,
  clawSpeedDown: 0.15,
  clawSpeedUp: 0.22,
  // 접촉 후에도 더 내려가는 양. 0 이면 닿는 즉시 정지하고, 이 경우 기법 B(눌러서
  // 떨어뜨리기)가 물리적으로 불가능하다. 실제 기계도 관성 때문에 조금 더 눌린다.
  descendOvertravel: 0.014,
  clawTopY: 1.06,        // 집게 헤드 최상단 높이
  // 하강 한계(실기처럼 고정 깊이). 벌린 발끝은 헤드보다 약 18cm 아래다.
  // 이 집게는 마찰로 무는 게 아니라 발이 박스 "밑으로" 들어가 걷어 올리므로,
  // 발끝이 2·3번 봉 윗면(=박스 바닥)보다 더 내려가야 한다. 봉이 있는 z 에서는
  // 발이 봉에 닿아 먼저 멈추고, 2–3번 틈 위에서만 이 깊이까지 내려간다.
  clawMinY: 0.720,
  homeX: 0.33,           // 홈 = 가장 오른쪽 (벌린 발끝이 옆 유리에 닿지 않는 한계)
  homeZ: 0.16,           // 1번 봉 위. 여기서 출발하고 여기로 복귀한다
  limitX: 0.33,          // cabW(0.50) - 벌렸을 때 발끝 도달거리(약 0.156) - 여유
  limitZfront: 0.32,
  limitZback: -0.185,     // 4번 봉 뒤 진열대에는 못 간다

  // ---- grip 실패 확률 ----
  gripFailBase: 0.50,    // 파지 품질이 0일 때의 실패 확률
  gripFailMin: 0.30,     // 완벽하게 잡았을 때의 실패 확률
  gripEdgeMargin: 0.016, // 발가락이 박스 밑으로 파고들 수 있는 최대 깊이(약 1.6cm)에 맞춘 판정 스케일

  // ---- 기구/월드 ----
  cabW: 0.50,            // 캐비닛 반폭 |x|
  // 앞 유리와 1번 봉 사이 간격 = boxW + frontGap.
  // 박스가 여기 빠지면 껴서 회수하기 어렵다 (실수했을 때의 벌칙).
  frontGap: 0.020,
  cabDback: 0.62,        // 뒤쪽 깊이 (4번 봉 뒤 진열대 포함)
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

// UI 패널 생성용 스키마
export const SCHEMA = [
  { group: '마찰 (핵심)', items: [
    ['frictionRubber', '2·3번 봉 마찰(고무)', 0.05, 3.0, 0.05],
    ['frictionSlick',  '1·4번 봉 마찰(미끄럼)', 0.0, 1.0, 0.005],
    ['frictionBox',    '박스 표면 마찰', 0.05, 2.0, 0.05],
    ['frictionClaw',   '집게 발 마찰', 0.05, 2.0, 0.05],
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
    ['clawGripTorque', '파지 토크(N·m)', 0.05, 4.0, 0.02],
    ['clawSlipTorque', '실패 시 토크', 0.0, 1.5, 0.02],
    ['clawSlipSpread', '실패 시 벌어짐(rad)', 0.0, 1.0, 0.02],
    ['clawSlipDelay',  '실패 발현 지연(s)', 0.0, 2.0, 0.05],
    ['clawGripDamping', '파지 감쇠', 0, 3, 0.05],
    ['clawOpenSpread',  '벌림각 — 열림(rad)', 0.1, 1.3, 0.01],
    ['clawCloseSpread', '벌림각 — 닫힘(rad)', 0.0, 0.8, 0.01],
    ['clawPivotX',   '발 축 간격 |x|', 0.03, 0.18, 0.005],
    ['clawArmLen',   '발 길이', 0.06, 0.28, 0.005],
    ['clawTipThick', '발끝 두께(절반)', 0.002, 0.03, 0.001],
    ['clawTipWidth', '발끝 폭(절반)', 0.005, 0.06, 0.001],
    ['clawTipLen',   '발끝 길이(절반)', 0.008, 0.06, 0.001],
    ['clawFingerMass', '발 질량(kg)', 0.02, 1.0, 0.01],
    ['clawMotorSpeed', '개폐 속도', 0.5, 15, 0.1],
  ]},
  { group: 'grip 실패 확률', items: [
    ['gripFailBase', '최악 파지 실패율', 0, 1, 0.01],
    ['gripFailMin',  '최선 파지 실패율', 0, 1, 0.01],
    ['gripEdgeMargin', '파지 깊이 판정 스케일', 0.004, 0.06, 0.001],
  ]},
  { group: '집게 이동', items: [
    ['clawSpeedX', '좌우 속도', 0.05, 1.0, 0.01],
    ['clawSpeedZ', '전후 속도', 0.05, 1.0, 0.01],
    ['clawSpeedDown', '하강 속도', 0.05, 1.0, 0.01],
    ['clawSpeedUp', '상승 속도', 0.05, 1.0, 0.01],
    ['clawMinY', '하강 한계(헤드 y)', 0.55, 0.95, 0.005],
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

const KEY = 'ufo-catcher-cfg-v7';

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
