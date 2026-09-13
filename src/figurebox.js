import * as THREE from 'three';

/**
 * 상품 박스 인쇄면 텍스처.
 * 아트에 imageDir 이 있으면 assets/boxart/<imageDir>/ 의 면별 PNG 를 입히고,
 * 없거나 불러오지 못하면 여기서 캔버스로 그리는 오리지널 디자인을 쓴다.
 *
 * 디자인은 "실제 박스를 세워 둔" 방향으로 그린다:
 *   front/back = 가로(boxW) × 세로(boxD), side = 두께(boxH) × 세로(boxD), top/bottom = 가로 × 두께
 * 기계 안에서는 눕혀서 앞면이 위(+Y)이고, 박스 윗면은 기계 뒤쪽(−Z)을 향한다.
 * 그래서 플레이어 쪽에서 앞면 그림이 똑바로 읽힌다. 각 면으로 옮길 때의 회전은 FACE_MAP 참고.
 */

const PX_PER_M = 6000;          // 12cm → 720px
// 면별 인쇄 이미지 폴더 (페이지 기준 상대 경로). 파일: front/back/left/right/top/bottom.png
const IMAGE_BASE = 'assets/boxart/';
const cache = new Map();
let boxEnv = null;          // 코팅 반사용 환경맵 (initBoxArt 에서 만든다)
let maxAniso = 8;

/**
 * 렌더러가 생긴 뒤, 박스를 만들기 전에 한 번 호출한다.
 * 코팅된 박스의 광택이 보이려면 비칠 주변이 필요하므로, 게임기 안을 흉내 낸 작은 조명 방
 * (천장 형광등 줄, 앞쪽 조명, 옅은 분홍·청록 LED)을 PMREM 환경맵으로 굽는다.
 * 이 환경맵은 박스 재질에만 쓰여 다른 물체의 모습은 바뀌지 않는다.
 */
export function initBoxArt(renderer) {
  maxAniso = renderer.capabilities.getMaxAnisotropy();
  const env = new THREE.Scene();
  const glow = (color, strength) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(strength), side: THREE.DoubleSide });
  env.add(new THREE.Mesh(new THREE.BoxGeometry(8, 8, 8), new THREE.MeshBasicMaterial({ color: 0x1b1e27, side: THREE.BackSide })));
  const panel = (w, h, color, strength, pos, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glow(color, strength));
    m.position.set(...pos);
    m.rotation.set(...rot);
    env.add(m);
  };
  panel(5, 1.2, 0xfff4e0, 5, [0, 3.5, -1.0], [Math.PI / 2, 0, 0]);   // 천장 형광등 줄
  panel(5, 1.2, 0xfff4e0, 5, [0, 3.5, 1.0], [Math.PI / 2, 0, 0]);
  panel(3, 1.6, 0xffffff, 2.5, [0, 1.2, 3.9], [0, Math.PI, 0]);      // 앞쪽(플레이어 쪽) 조명
  // 뒤쪽 벽 조명: 플레이어 시점(약 20° 위)에서 박스 윗면에 비치는 것은 기계 뒤쪽이라,
  // 여기가 밝아야 윗면에 코팅 광택이 보인다 (측정: 너무 밝으면 그림이 하얗게 날아간다)
  panel(6, 1.0, 0xfff6ea, 1.6, [0, 1.3, -3.9], [0, 0, 0]);
  panel(0.6, 4, 0xff5fb8, 1.6, [-3.9, 0.5, 0], [0, Math.PI / 2, 0]); // 옆 LED
  panel(0.6, 4, 0x6fd8ff, 1.4, [3.9, 0.5, 0], [0, -Math.PI / 2, 0]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  boxEnv = pmrem.fromScene(env, 0.01).texture;
  pmrem.dispose();
}

const FONT_EN = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';
const FONT_TITLE = '"Arial Black", "Segoe UI Black", "Helvetica Neue", Arial, sans-serif';
const FONT_JP = '"Yu Gothic", "Hiragino Sans", "Noto Sans JP", "Malgun Gothic", sans-serif';

const C = {
  night: '#140a2c',
  plum: '#3a1162',
  magenta: '#ff3d9a',
  pink: '#ff9ad5',
  cyan: '#7ce8ff',
  gold: '#ffd86b',
  paper: '#f8f3fb',
  ink: '#241536',
};

/** 박스 아트 재질 6개 (BoxGeometry 면 순서: +X, −X, +Y, −Y, +Z, −Z). 아트가 없으면 null */
export function boxArtMaterials(cfg) {
  const art = ARTS[cfg.boxArt];
  if (!art) return null;
  const W = Math.round(cfg.boxW * PX_PER_M);   // 가로
  const T = Math.round(cfg.boxH * PX_PER_M);   // 두께 (기계 안에서의 높이)
  const L = Math.round(cfg.boxD * PX_PER_M);   // 세로 (가장 긴 변)
  const key = `${cfg.boxArt}:${W}:${T}:${L}`;
  if (!cache.has(key)) {
    // [이미지 파일 이름, 캔버스 폭, 높이, 디자인→면 변환, 디자인 폭, 높이, 절차적 그리기]
    const faces = [
      ['right', L, T, [0, 1, -1, 0, L, 0], T, L, art.side],    // +X: 오른쪽 옆면 (위쪽 = −Z)
      ['left', L, T, [0, -1, 1, 0, 0, T], T, L, art.side],     // −X: 왼쪽 옆면
      ['front', W, L, [1, 0, 0, 1, 0, 0], W, L, art.front],    // +Y: 앞면
      ['back', W, L, [-1, 0, 0, -1, W, L], W, L, art.back],    // −Y: 뒷면
      // 양 끝면: 실제 박스처럼 윗면은 그림의 머리 쪽(기계 뒤 −Z), 바닥면은 발 쪽(플레이어 쪽 +Z).
      // 글자는 각 끝면을 바깥에서 봤을 때 똑바로 읽히게 둔다.
      ['bottom', W, T, [1, 0, 0, 1, 0, 0], W, T, art.bottom],   // +Z: 바닥면 (플레이어 쪽)
      ['top', W, T, [1, 0, 0, 1, 0, 0], W, T, art.top],         // −Z: 윗면 (기계 뒤쪽)
    ];
    cache.set(key, faces.map(([name, cw, ch, m, dw, dh, draw]) => {
      const canvas = face(cw, ch, m, dw, dh, draw);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAniso;
      // 면별 이미지가 있으면 불러와 같은 방향 변환으로 덮어 그린다. 실패하면 절차적 디자인이 남는다.
      if (art.imageDir) {
        const img = new Image();
        img.onload = () => {
          const ctx = canvas.getContext('2d');
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, cw, ch);
          ctx.setTransform(...m);
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, dw, dh);
          tex.needsUpdate = true;
        };
        img.src = `${IMAGE_BASE}${art.imageDir}/${name}.png`;
      }
      return tex;
    }));
  }
  // 빳빳한 코팅 판지: 인쇄면(약간 거친 종이) 위에 매끈한 투명 코팅층.
  // 잉크를 살짝 어둡게(color) 해서 기계 안의 강한 조명과 코팅 반사가 더해져도 색이 날아가지 않게 한다.
  return cache.get(key).map((map) => new THREE.MeshPhysicalMaterial({
    map,
    color: 0xd6d6d6,
    roughness: 0.55,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMap: boxEnv,
    envMapIntensity: 0.7,
  }));
}

/** 디버그용: 실제 박스 방향 그대로의 디자인 캔버스 */
export function boxArtDesigns(cfg) {
  const art = ARTS[cfg.boxArt];
  const W = Math.round(cfg.boxW * PX_PER_M), T = Math.round(cfg.boxH * PX_PER_M), L = Math.round(cfg.boxD * PX_PER_M);
  const mk = (w, h, fn) => face(w, h, [1, 0, 0, 1, 0, 0], w, h, fn);
  return { front: mk(W, L, art.front), back: mk(W, L, art.back), side: mk(T, L, art.side), top: mk(W, T, art.top), bottom: mk(W, T, art.bottom) };
}

function face(cw, ch, m, dw, dh, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(...m);
  draw(ctx, dw, dh);
  return canvas;
}

// ============================================================ 공용 그리기 도구

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spaced(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 네 갈래 반짝임 */
function sparkle(ctx, x, y, r, color = '#fff', glow = 0) {
  ctx.save();
  ctx.translate(x, y);
  if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
  ctx.fillStyle = color;
  ctx.beginPath();
  const k = r * 0.16;
  ctx.moveTo(0, -r); ctx.quadraticCurveTo(k, -k, r, 0); ctx.quadraticCurveTo(k, k, 0, r);
  ctx.quadraticCurveTo(-k, k, -r, 0); ctx.quadraticCurveTo(-k, -k, 0, -r);
  ctx.fill();
  ctx.restore();
}

/** 다섯 꼭짓점 별 */
function star5(ctx, x, y, r, inner = 0.45) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rr = i % 2 ? r * inner : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
}

/** 밤하늘 → 자홍 무대 배경 + 조명 + 보케 */
function stageBackground(ctx, w, h, seed = 7) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, C.night);
  g.addColorStop(0.45, C.plum);
  g.addColorStop(0.8, '#8e1f7a');
  g.addColorStop(1, '#d0357f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // 무대 조명 줄기
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const ox = w * 0.5, oy = -h * 0.08;
  for (let i = 0; i < 9; i++) {
    const a = Math.PI / 2 + (i - 4) * 0.16;
    const spread = 0.045;
    const len = h * 1.3;
    const lg = ctx.createLinearGradient(ox, oy, ox + Math.cos(a) * len, oy + Math.sin(a) * len);
    lg.addColorStop(0, 'rgba(255,220,255,0.16)');
    lg.addColorStop(1, 'rgba(255,220,255,0)');
    ctx.fillStyle = lg;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + Math.cos(a - spread) * len, oy + Math.sin(a - spread) * len);
    ctx.lineTo(ox + Math.cos(a + spread) * len, oy + Math.sin(a + spread) * len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 보케
  const r = rng(seed);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const unit = Math.min(w, h);
  for (let i = 0; i < 34; i++) {
    const x = r() * w, y = r() * h;
    const rad = unit * (0.012 + r() * 0.05);
    const col = r() < 0.6 ? '255,120,200' : (r() < 0.5 ? '124,232,255' : '255,216,107');
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rad);
    rg.addColorStop(0, `rgba(${col},${0.10 + r() * 0.18})`);
    rg.addColorStop(0.7, `rgba(${col},${0.05 + r() * 0.06})`);
    rg.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
  }
  // 작은 반짝임
  for (let i = 0; i < 22; i++) {
    sparkle(ctx, r() * w, r() * h, unit * (0.006 + r() * 0.016), 'rgba(255,255,255,0.85)', unit * 0.02);
  }
  ctx.restore();
}

/** 홀로그램 박 띠 */
function holoStrip(ctx, x, y, w, h, vertical = true) {
  const g = vertical ? ctx.createLinearGradient(x, y, x, y + h) : ctx.createLinearGradient(x, y, x + w, y);
  const stops = ['#ffd6f2', '#b9f3ff', '#fff3b0', '#e2c6ff', '#ffc4e4', '#c2fff1', '#ffe6a8'];
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // 미세한 사선 결
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.04);
  const step = Math.min(w, h) * 0.35;
  for (let t = -Math.max(w, h); t < Math.max(w, h) * 2; t += step) {
    ctx.beginPath(); ctx.moveTo(x + t, y); ctx.lineTo(x + t - h, y + h); ctx.stroke();
  }
  ctx.restore();
}

/**
 * 아이돌 실루엣 (오리지널). 한 손을 높이 들어 검지를 세우고, 한 손은 허리에 올린 무대 포즈.
 * 100 × 140 단위 좌표의 부위별 윤곽점 — 매끄러운 곡선으로 이어 부위마다 따로 칠해 합친다.
 */
const IDOL_UNITS = { w: 100, h: 140 };
const IDOL_PARTS = [
  // 긴 머리 (오른쪽으로 흩날림)
  [[50, 13], [58, 14], [62, 20], [63, 30], [63.5, 40], [67, 50], [74, 58], [82, 63], [91, 68], [81, 71], [72, 67],
    [65, 61], [58, 56], [42, 56], [36, 61], [30, 66], [23, 72], [27, 62], [32, 52], [35, 42], [36.5, 30], [38, 20], [43, 14.5]],
  // 목
  [[47, 33], [53, 33], [53.6, 41], [46.4, 41]],
  // 몸통
  [[40, 42], [60, 42], [62, 46], [59, 52], [55.5, 60], [56.5, 66], [43.5, 66], [44.5, 60], [41, 52], [38, 46]],
  // 치마 (프릴 밑단)
  [[44, 59], [56, 59], [62, 67], [68, 75], [74, 83], [68.5, 82.5], [64, 86.5], [59, 83], [54, 87.5], [49, 83.5],
    [44, 87.5], [39, 83.5], [34, 86], [28, 84], [32, 76], [38, 67]],
  // 곧게 선 다리 + 부츠
  [[42.5, 83], [48.5, 83], [48, 100], [47.4, 112], [48.3, 126], [47.6, 133.5], [36.5, 134.5], [37.5, 130.5],
    [42.3, 126.5], [42.8, 112], [42.2, 100]],
  // 무릎을 굽힌 다리 + 부츠
  [[52, 83], [58, 83], [62.5, 95], [63.5, 104], [61.5, 114], [59.5, 125.5], [64.5, 130.5], [65.5, 134.5],
    [54.3, 134.8], [54.8, 126.5], [56.3, 114], [57, 104], [53.5, 94]],
  // 들어 올린 팔 (검지)
  [[58, 44], [63, 40], [67, 32], [70, 22], [72, 12], [73, 6], [73.4, 1.2], [75, 0.4], [75.7, 5.5], [76.6, 9.5],
    [76, 14.5], [73.4, 24], [70.4, 34], [66.5, 44], [62, 49]],
  // 허리에 올린 팔
  [[40, 44], [35, 48], [30.5, 55], [32.5, 61.5], [40, 65.5], [45, 64.5], [44.2, 61], [38.5, 59], [36.4, 55], [39.3, 50], [42, 48]],
];
const IDOL_HEAD = { x: 50, y: 25.5, rx: 8.8, ry: 10.2 };
const IDOL_SLEEVES = [[39, 45.5, 4.6], [61, 45, 4.6]];
export const IDOL_FINGERTIP = { x: 74.4, y: 0.4 };

/** Catmull-Rom 을 베지어로 바꿔 닫힌 매끄러운 윤곽을 그린다 */
function smoothClosed(ctx, pts) {
  const n = pts.length;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const t = 1 / 6;
    ctx.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) * t, p1[1] + (p2[1] - p0[1]) * t,
      p2[0] - (p3[0] - p1[0]) * t, p2[1] - (p3[1] - p1[1]) * t,
      p2[0], p2[1]
    );
  }
  ctx.closePath();
}

/** 실루엣 마스크 (흰색) — 단위 좌표 1 = scale px, 여백 pad px */
function idolMask(scale, pad) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(IDOL_UNITS.w * scale + pad * 2);
  c.height = Math.ceil(IDOL_UNITS.h * scale + pad * 2);
  const x = c.getContext('2d');
  x.translate(pad, pad);
  x.scale(scale, scale);
  x.fillStyle = '#fff';
  for (const part of IDOL_PARTS) { x.beginPath(); smoothClosed(x, part); x.fill(); }
  x.beginPath(); x.ellipse(IDOL_HEAD.x, IDOL_HEAD.y, IDOL_HEAD.rx, IDOL_HEAD.ry, -0.08, 0, Math.PI * 2); x.fill();
  for (const [sx, sy, r] of IDOL_SLEEVES) { x.beginPath(); x.arc(sx, sy, r, 0, Math.PI * 2); x.fill(); }
  return c;
}

function tinted(mask, paint) {
  const c = document.createElement('canvas');
  c.width = mask.width; c.height = mask.height;
  const x = c.getContext('2d');
  x.drawImage(mask, 0, 0);
  x.globalCompositeOperation = 'source-in';
  paint(x, c.width, c.height);
  return c;
}

/**
 * 실루엣 키비주얼: 어두운 몸체 + 윤곽 바깥쪽에만 생기는 림라이트(오른쪽 위 분홍, 왼쪽 청록).
 * (cx, top) 은 실루엣 박스의 가운데 위, hgt 는 높이(px).
 */
function drawIdol(ctx, cx, top, hgt, { glow = true, hairClip = true } = {}) {
  const scale = hgt / IDOL_UNITS.h;
  const pad = Math.ceil(hgt * 0.04);
  const mask = idolMask(scale, pad);

  const body = tinted(mask, (x, w, h) => {
    const g = x.createLinearGradient(w * 0.2, 0, w * 0.8, h);
    g.addColorStop(0, '#34185e'); g.addColorStop(0.5, '#1a0c36'); g.addColorStop(1, '#0d0620');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  });
  const rim = (color, dx, dy) => {
    const c = tinted(mask, (x, w, h) => { x.fillStyle = color; x.fillRect(0, 0, w, h); });
    const x = c.getContext('2d');
    x.globalCompositeOperation = 'destination-out';
    x.drawImage(mask, dx, dy);
    return c;
  };
  const d = Math.max(1, hgt * 0.009);
  const rimPink = rim('#ffb3e6', -d, d);
  const rimCyan = rim('rgba(124,232,255,0.8)', d * 0.8, 0);

  const ox = cx - (IDOL_UNITS.w / 2) * scale - pad, oy = top - pad;
  ctx.save();
  if (glow) { ctx.shadowColor = 'rgba(255,80,190,0.85)'; ctx.shadowBlur = hgt * 0.07; }
  ctx.drawImage(body, ox, oy);
  ctx.shadowBlur = 0;
  ctx.drawImage(rimCyan, ox, oy);
  ctx.drawImage(rimPink, ox, oy);
  if (hairClip) {
    ctx.fillStyle = C.gold;
    ctx.shadowColor = C.gold; ctx.shadowBlur = hgt * 0.02;
    star5(ctx, ox + pad + 57.5 * scale, oy + pad + 17.5 * scale, 3.2 * scale);
    ctx.fill();
  }
  ctx.restore();
}

/** 제목 로고타입 */
function titleLogo(ctx, cx, cy, size, { sub = true, maxWidth = Infinity } = {}) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const word = 'LUMINA';
  ctx.font = `italic 900 ${size}px ${FONT_TITLE}`;
  spaced(ctx, size * 0.02);
  // 실제 글자 폭을 재서 주어진 폭 안에 들어가게 줄인다 (외곽선 두께 포함)
  const measured = ctx.measureText(word).width + size * 0.2;
  if (measured > maxWidth) {
    size *= maxWidth / measured;
    ctx.font = `italic 900 ${size}px ${FONT_TITLE}`;
    spaced(ctx, size * 0.02);
  }
  ctx.lineJoin = 'round';
  // 그림자 + 두꺼운 외곽
  ctx.shadowColor = 'rgba(40,0,60,0.6)';
  ctx.shadowBlur = size * 0.18;
  ctx.shadowOffsetY = size * 0.05;
  ctx.strokeStyle = C.night;
  ctx.lineWidth = size * 0.2;
  ctx.strokeText(word, cx, cy);
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.09;
  ctx.strokeText(word, cx, cy);
  const g = ctx.createLinearGradient(0, cy - size * 0.8, 0, cy);
  g.addColorStop(0, '#fff6c9');
  g.addColorStop(0.45, C.gold);
  g.addColorStop(0.55, '#ff8fcb');
  g.addColorStop(1, C.magenta);
  ctx.fillStyle = g;
  ctx.fillText(word, cx, cy);
  // 로고 위 반짝임
  const wText = ctx.measureText(word).width;
  sparkle(ctx, cx + wText * 0.5 - size * 0.05, cy - size * 0.78, size * 0.26, '#fff', size * 0.3);
  sparkle(ctx, cx - wText * 0.5 + size * 0.1, cy - size * 0.05, size * 0.14, '#fff', size * 0.2);

  if (sub) {
    ctx.font = `italic 600 ${size * 0.24}px ${FONT_EN}`;
    spaced(ctx, size * 0.05);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(255,80,180,0.9)';
    ctx.shadowBlur = size * 0.12;
    ctx.fillText('— Starlight Stage —', cx, cy + size * 0.42);
  }
  ctx.restore();
}

function brandMark(ctx, x, y, size, color = '#ffffff', align = 'left') {
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${size}px ${FONT_EN}`;
  spaced(ctx, size * 0.12);
  ctx.fillStyle = color;
  const text = 'PRISMA';
  const tail = 'PRIZE';
  const w1 = ctx.measureText(text).width;
  ctx.font = `300 ${size}px ${FONT_EN}`;
  const w2 = ctx.measureText(tail).width;
  const gap = size * 0.9;
  const total = w1 + gap + w2;
  const left = align === 'center' ? x - total / 2 : (align === 'right' ? x - total : x);
  ctx.textAlign = 'left';
  ctx.font = `800 ${size}px ${FONT_EN}`;
  ctx.fillText(text, left, y);
  ctx.fillStyle = C.gold;
  star5(ctx, left + w1 + gap / 2, y, size * 0.36);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = `300 ${size}px ${FONT_EN}`;
  ctx.fillText(tail, left + w1 + gap, y);
  ctx.restore();
}

function chip(ctx, x, y, text, size, { bg = '#ffffff', fg = C.ink, align = 'left' } = {}) {
  ctx.save();
  ctx.font = `800 ${size}px ${FONT_EN}`;
  spaced(ctx, size * 0.14);
  const tw = ctx.measureText(text).width;
  const padX = size * 0.7, h = size * 1.7;
  const w = tw + padX * 2;
  const left = align === 'center' ? x - w / 2 : (align === 'right' ? x - w : x);
  roundRect(ctx, left, y, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + padX, y + h / 2 + size * 0.04);
  ctx.restore();
  return w;
}

function barcode(ctx, x, y, w, h, seed = 3) {
  const r = rng(seed);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  const innerX = x + w * 0.08, innerW = w * 0.84, barH = h * 0.72;
  let cur = innerX;
  ctx.fillStyle = '#111';
  // 바와 공백을 번갈아 (폭 1~3 모듈) — 실제 EAN 처럼 촘촘하게
  const module = innerW / 95;
  let bar = true;
  while (cur < innerX + innerW) {
    const mw = module * (1 + Math.floor(r() * 3));
    if (bar) ctx.fillRect(cur, y + h * 0.08, Math.min(mw, innerX + innerW - cur), barH);
    cur += mw;
    bar = !bar;
  }
  const fs = Math.min(h * 0.14, w * 0.075);
  ctx.font = `500 ${fs}px ${FONT_EN}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  spaced(ctx, fs * 0.15);
  ctx.fillText('4 999999 012345', x + w / 2, y + h * 0.95, w * 0.92);
  ctx.restore();
}

// ============================================================ LUMINA 박스

const lumina = {
  // 면별 이미지 (AI 로 생성한 캐릭터 일러스트 박스). 이미지가 없을 때만 아래 절차적 디자인을 쓴다.
  imageDir: 'lumina',

  front(ctx, w, h) {
    stageBackground(ctx, w, h, 11);

    // 뒤쪽 큰 별 광배
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const cy = h * 0.4;
    const halo = ctx.createRadialGradient(w * 0.5, cy, 0, w * 0.5, cy, w * 0.62);
    halo.addColorStop(0, 'rgba(255,170,230,0.55)');
    halo.addColorStop(0.35, 'rgba(255,90,190,0.25)');
    halo.addColorStop(1, 'rgba(255,90,190,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,220,250,0.35)';
    ctx.lineWidth = w * 0.006;
    star5(ctx, w * 0.5, cy, w * 0.44, 0.42);
    ctx.stroke();
    ctx.lineWidth = w * 0.003;
    star5(ctx, w * 0.5, cy, w * 0.5, 0.42);
    ctx.stroke();
    ctx.restore();

    // 무대 바닥 빛
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const fy = h * 0.735;
    const floor = ctx.createRadialGradient(w * 0.5, fy, 0, w * 0.5, fy, w * 0.42);
    floor.addColorStop(0, 'rgba(255,240,255,0.7)');
    floor.addColorStop(0.3, 'rgba(255,120,210,0.35)');
    floor.addColorStop(1, 'rgba(255,120,210,0)');
    ctx.fillStyle = floor;
    ctx.save();
    ctx.translate(w * 0.5, fy); ctx.scale(1, 0.22); ctx.translate(-w * 0.5, -fy);
    ctx.beginPath(); ctx.arc(w * 0.5, fy, w * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.restore();

    // 실루엣 키비주얼
    const figH = h * 0.6, figTop = h * 0.13;
    drawIdol(ctx, w * 0.47, figTop, figH);
    // 들어 올린 손끝의 별
    const s = figH / IDOL_UNITS.h;
    const tipX = w * 0.47 + (IDOL_FINGERTIP.x - IDOL_UNITS.w / 2) * s, tipY = figTop + IDOL_FINGERTIP.y * s - w * 0.03;
    sparkle(ctx, tipX, tipY, w * 0.075, '#ffffff', w * 0.08);
    ctx.save(); ctx.fillStyle = C.gold; ctx.shadowColor = C.gold; ctx.shadowBlur = w * 0.04;
    star5(ctx, tipX, tipY, w * 0.03); ctx.fill(); ctx.restore();

    // 왼쪽 세로 홀로그램 띠 + 세로 문구
    holoStrip(ctx, 0, 0, w * 0.045, h, true);
    ctx.save();
    ctx.translate(w * 0.024, h * 0.5);
    ctx.rotate(-Math.PI / 2);
    ctx.font = `700 ${w * 0.024}px ${FONT_EN}`;
    spaced(ctx, w * 0.012);
    ctx.fillStyle = 'rgba(60,20,90,0.8)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STARLIGHT STAGE COLLECTION  ·  No.01', 0, 0);
    ctx.restore();

    // 상단 배지들
    chip(ctx, w * 0.085, h * 0.03, 'PRIZE FIGURE', w * 0.036, { bg: '#ffffff', fg: C.plum });
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${w * 0.034}px ${FONT_JP}`;
    ctx.fillText('全1種', w * 0.955, h * 0.034);
    ctx.font = `600 ${w * 0.022}px ${FONT_EN}`;
    spaced(ctx, w * 0.006);
    ctx.globalAlpha = 0.8;
    ctx.fillText('ALL 1 TYPE', w * 0.955, h * 0.034 + w * 0.045);
    ctx.restore();

    // 제목
    titleLogo(ctx, w * 0.52, h * 0.84, w * 0.2);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = `700 ${w * 0.03}px ${FONT_JP}`;
    spaced(ctx, w * 0.012);
    ctx.fillText('ルミナ ‐ スターライトステージ ‐', w * 0.52, h * 0.915);
    ctx.restore();

    // 하단 정보 띠
    const by = h * 0.94;
    ctx.fillStyle = 'rgba(12,5,26,0.72)';
    ctx.fillRect(0, by, w, h - by);
    holoStrip(ctx, 0, by, w, h * 0.004, false);
    brandMark(ctx, w * 0.075, by + (h - by) / 2, w * 0.03);
    ctx.save();
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${w * 0.026}px ${FONT_EN}`;
    spaced(ctx, w * 0.004);
    ctx.fillText('FIGURE SIZE  approx. 20cm', w * 0.955, by + (h - by) / 2);
    ctx.restore();
  },

  back(ctx, w, h) {
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, w, h);
    // 옅은 별 무늬
    ctx.save();
    ctx.fillStyle = 'rgba(200,120,200,0.07)';
    const r = rng(5);
    for (let i = 0; i < 40; i++) { star5(ctx, r() * w, r() * h, w * (0.01 + r() * 0.03)); ctx.fill(); }
    ctx.restore();

    // 헤더
    const hh = h * 0.16;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, hh); ctx.clip();
    stageBackground(ctx, w, hh * 2.2, 23);
    ctx.restore();
    holoStrip(ctx, 0, hh, w, h * 0.006, false);
    titleLogo(ctx, w * 0.5, hh * 0.62, w * 0.13, { sub: false });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = `italic 600 ${w * 0.03}px ${FONT_EN}`;
    spaced(ctx, w * 0.008);
    ctx.fillText('— Starlight Stage —', w * 0.5, hh * 0.86);
    ctx.restore();

    // 3면도 카드
    const cardsTop = hh + h * 0.035;
    const cw = w * 0.28, ch = h * 0.34, gap = (w - cw * 3) / 4;
    const views = [['FRONT', 1], ['SIDE', 0.62], ['BACK', 1]];
    views.forEach(([label, squeeze], i) => {
      const x = gap + i * (cw + gap);
      ctx.save();
      roundRect(ctx, x, cardsTop, cw, ch, w * 0.02);
      const cg = ctx.createLinearGradient(0, cardsTop, 0, cardsTop + ch);
      cg.addColorStop(0, '#2a0f4e'); cg.addColorStop(1, '#8e1f7a');
      ctx.fillStyle = cg;
      ctx.fill();
      ctx.clip();
      ctx.globalCompositeOperation = 'lighter';
      const rg = ctx.createRadialGradient(x + cw / 2, cardsTop + ch * 0.9, 0, x + cw / 2, cardsTop + ch * 0.9, cw * 0.6);
      rg.addColorStop(0, 'rgba(255,160,220,0.6)'); rg.addColorStop(1, 'rgba(255,160,220,0)');
      ctx.fillStyle = rg; ctx.fillRect(x, cardsTop, cw, ch);
      ctx.globalCompositeOperation = 'source-over';
      ctx.translate(x + cw / 2, 0);
      ctx.scale(i === 2 ? -squeeze : squeeze, 1);
      drawIdol(ctx, 0, cardsTop + ch * 0.1, ch * 0.8, { glow: false, hairClip: i !== 2 });
      ctx.restore();
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = C.plum;
      ctx.font = `800 ${w * 0.026}px ${FONT_EN}`;
      spaced(ctx, w * 0.01);
      ctx.fillText(label, x + cw / 2, cardsTop + ch + h * 0.028);
      ctx.restore();
    });

    // 사양
    let y = cardsTop + ch + h * 0.075;
    ctx.save();
    ctx.fillStyle = C.ink;
    ctx.textBaseline = 'top';
    const specs = [
      ['商品名', 'LUMINA ‐Starlight Stage‐ フィギュア'],
      ['サイズ', '全高 約20cm'],
      ['素材', 'PVC・ABS'],
      ['種類', '全1種'],
    ];
    const lx = w * 0.08, vx = w * 0.3;
    specs.forEach(([k, v]) => {
      ctx.font = `700 ${w * 0.03}px ${FONT_JP}`;
      ctx.fillStyle = C.magenta;
      ctx.fillText(k, lx, y);
      ctx.font = `500 ${w * 0.03}px ${FONT_JP}`;
      ctx.fillStyle = C.ink;
      ctx.fillText(v, vx, y);
      y += h * 0.028;
    });
    ctx.restore();

    // 구분선
    y += h * 0.01;
    ctx.fillStyle = 'rgba(60,20,90,0.15)';
    ctx.fillRect(w * 0.08, y, w * 0.84, Math.max(1, h * 0.0015));
    y += h * 0.018;

    // 주의 문구
    ctx.save();
    ctx.fillStyle = 'rgba(36,21,54,0.72)';
    ctx.font = `500 ${w * 0.021}px ${FONT_JP}`;
    ctx.textBaseline = 'top';
    const notes = [
      '●本品はプライズ専用景品です。販売はしておりません。',
      '●対象年齢15才以上。小さな部品があります。',
      '●火のそばに置かないでください。',
      '●画像はイメージです。実際の商品とは異なる場合があります。',
      'This item is a prize. Not for sale. Ages 15+.',
    ];
    notes.forEach((t) => { ctx.fillText(t, w * 0.08, y); y += h * 0.022; });
    ctx.restore();

    // 하단: 연령 마크, 재활용 마크, 바코드, 브랜드
    const fy = h * 0.87;
    ctx.save();
    // 15+ 마크
    ctx.lineWidth = w * 0.008;
    ctx.strokeStyle = C.ink;
    ctx.beginPath(); ctx.arc(w * 0.13, fy + h * 0.035, w * 0.05, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `900 ${w * 0.04}px ${FONT_EN}`;
    ctx.fillText('15+', w * 0.13, fy + h * 0.036);
    // 종이 재활용 마크 (일반 도형)
    const mx = w * 0.27, my = fy + h * 0.035, ms = w * 0.045;
    ctx.beginPath();
    ctx.moveTo(mx - ms, my + ms * 0.8); ctx.lineTo(mx, my - ms); ctx.lineTo(mx + ms, my + ms * 0.8); ctx.closePath();
    ctx.lineWidth = w * 0.006; ctx.stroke();
    ctx.font = `800 ${w * 0.03}px ${FONT_JP}`;
    ctx.fillText('紙', mx, my + ms * 0.2);
    ctx.restore();
    barcode(ctx, w * 0.52, fy, w * 0.4, h * 0.08, 9);

    ctx.fillStyle = C.plum;
    ctx.fillRect(0, h * 0.965, w, h * 0.035);
    brandMark(ctx, w * 0.5, h * 0.9825, w * 0.028, '#ffffff', 'center');
  },

  side(ctx, w, h) {
    stageBackground(ctx, w, h, 31);
    // 옆 모서리 홀로그램 띠
    holoStrip(ctx, 0, 0, w * 0.035, h, true);
    holoStrip(ctx, w * 0.965, 0, w * 0.035, h, true);

    // 상단 번호 배지
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${w * 0.16}px ${FONT_TITLE}`;
    ctx.shadowColor = 'rgba(255,80,180,0.9)';
    ctx.shadowBlur = w * 0.08;
    ctx.fillText('01', w * 0.5, h * 0.1);
    ctx.shadowBlur = 0;
    ctx.font = `700 ${w * 0.05}px ${FONT_EN}`;
    spaced(ctx, w * 0.02);
    ctx.fillText('PRIZE FIGURE', w * 0.5, h * 0.135);
    ctx.restore();

    // 실루엣
    drawIdol(ctx, w * 0.5, h * 0.165, h * 0.25);

    // 세로 제목 (아래 → 위로 읽힘). 글자 길이(약 3.9 × 크기)가 옆면 세로 공간에 들어가게 맞춘다.
    const ts = w * 0.3;
    ctx.save();
    ctx.translate(w * 0.5, h * 0.69);
    ctx.rotate(-Math.PI / 2);
    titleLogo(ctx, 0, ts * 0.36, ts, { sub: false, maxWidth: h * 0.44 });
    ctx.restore();

    ctx.save();
    ctx.translate(w * 0.84, h * 0.69);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = `italic 600 ${w * 0.06}px ${FONT_EN}`;
    spaced(ctx, w * 0.02);
    ctx.fillText('— Starlight Stage —', 0, 0);
    ctx.restore();

    // 하단 브랜드
    ctx.fillStyle = 'rgba(12,5,26,0.72)';
    ctx.fillRect(0, h * 0.95, w, h * 0.05);
    brandMark(ctx, w * 0.5, h * 0.975, w * 0.06, '#ffffff', 'center');
  },

  top(ctx, w, h) {
    stageBackground(ctx, w, h, 41);
    holoStrip(ctx, 0, 0, w, h * 0.05, false);
    holoStrip(ctx, 0, h * 0.95, w, h * 0.05, false);
    titleLogo(ctx, w * 0.5, h * 0.58, w * 0.17, { sub: false });
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = `italic 600 ${w * 0.04}px ${FONT_EN}`;
    spaced(ctx, w * 0.01);
    ctx.fillText('— Starlight Stage —', w * 0.5, h * 0.76);
    ctx.restore();
    chip(ctx, w * 0.5, h * 0.12, 'PRIZE FIGURE', w * 0.032, { bg: '#ffffff', fg: C.plum, align: 'center' });
  },

  bottom(ctx, w, h) {
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = C.plum;
    ctx.fillRect(0, 0, w, h * 0.2);
    holoStrip(ctx, 0, h * 0.2, w, h * 0.03, false);
    brandMark(ctx, w * 0.5, h * 0.1, w * 0.04, '#ffffff', 'center');
    titleLogo(ctx, w * 0.36, h * 0.62, w * 0.12, { sub: false });
    ctx.save();
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'center';
    ctx.font = `700 ${w * 0.03}px ${FONT_JP}`;
    ctx.fillText('プライズ専用景品', w * 0.36, h * 0.82);
    ctx.restore();
    barcode(ctx, w * 0.66, h * 0.38, w * 0.28, h * 0.46, 17);
  },
};

const ARTS = { lumina };
