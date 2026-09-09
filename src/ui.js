import { SCHEMA, DEFAULTS, saveConfig, clearConfig } from './config.js';
import { STATE } from './game.js';

// 값이 바뀌면 기구/박스를 다시 만들어야 하는 파라미터
const REBUILD_KEYS = new Set([
  'barRadius', 'barLength', 'barGapZ', 'barOuterZ', 'barLowY', 'barRaise',
  'frictionRubber', 'frictionSlick', 'frictionBox', 'frictionFloor', 'frictionClaw',
  'boxW', 'boxH', 'boxD', 'boxMass', 'boxRestitution', 'boxLinDamp', 'boxAngDamp',
  'clawPivotX', 'clawArmLen', 'clawFingerMass', 'clawTipThick', 'clawTipWidth', 'clawTipLen',
  'cabW', 'cabDback', 'frontGap', 'shelfDrop', 'chuteDrop', 'displayCount',
]);

export class UI {
  constructor({ cfg, app }) {
    this.cfg = cfg;
    this.app = app;      // { game, world, debug, setView }
    this.buttons = { move: false, fwd: false, stop: false };
    this.rebuildTimer = null;
    this.sliders = [];
    this.buildDom();
    this.bindKeys();
  }

  get game() { return this.app.game; }

  buildDom() {
    // ---------- HUD ----------
    this.hud = el('div', 'hud');
    this.hud.innerHTML = `
      <div class="row"><b id="hud-state">대기</b></div>
      <div class="row muted" id="hud-score">시도 0 · 성공 0</div>
      <hr>
      <div class="row"><span>박스 z</span><b id="hud-bz">–</b></div>
      <div class="row"><span>박스 기울기(X축)</span><b id="hud-tilt">–</b></div>
      <div class="row"><span>접촉 봉</span><b id="hud-bars">–</b></div>
      <hr>
      <div class="row"><span>파지 품질</span><b id="hud-q">–</b></div>
      <div class="row"><span>실패율/주사위</span><b id="hud-roll">–</b></div>
      <div class="row wrap"><span>정지 사유</span><b id="hud-stop">–</b></div>`;
    document.body.appendChild(this.hud);

    // ---------- 조작 버튼 3개 ----------
    const pad = el('div', 'pad');
    this.btnEls = {};
    const defs = [
      ['move', '① 이동', '좌우(봉과 평행)<br>A / ←'],
      ['fwd', '② 전진', '전후(봉과 수직)<br>W / ↑'],
      ['stop', '③ 정지', '하강 중 정지+오므림<br>Space / S'],
    ];
    for (const [key, label, sub] of defs) {
      const b = el('button', 'padbtn');
      b.innerHTML = `<span class="big">${label}</span><span class="sub">${sub}</span>`;
      const down = (e) => { e.preventDefault(); this.buttons[key] = true; b.classList.add('on'); };
      const up = (e) => { e.preventDefault(); this.buttons[key] = false; b.classList.remove('on'); };
      b.addEventListener('pointerdown', down);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
      pad.appendChild(b);
      this.btnEls[key] = b;
    }
    document.body.appendChild(pad);

    // ---------- 툴바 ----------
    const bar = el('div', 'toolbar');
    const mk = (label, fn, cls = '') => {
      const b = el('button', 'tool ' + cls);
      b.textContent = label;
      b.addEventListener('click', fn);
      bar.appendChild(b);
      return b;
    };
    mk('박스 초기위치', () => this.game.resetBox());
    mk('박스 → 1번 봉', () => this.game.resetBox(this.game.poseOnOuterBar(1)));
    mk('박스 → 4번 봉', () => this.game.resetBox(this.game.poseOnOuterBar(4)));
    this.freeBtn = mk('자유 조작: OFF', () => {
      this.game.freeMode = !this.game.freeMode;
      this.freeBtn.textContent = '자유 조작: ' + (this.game.freeMode ? 'ON' : 'OFF');
      this.freeBtn.classList.toggle('active', this.game.freeMode);
    });
    this.dbgBtn = mk('물리 와이어', () => {
      this.app.debug.visible = !this.app.debug.visible;
      this.dbgBtn.classList.toggle('active', this.app.debug.visible);
    });
    mk('정면', () => this.app.setView('front'));
    mk('측면', () => this.app.setView('side'));
    mk('위', () => this.app.setView('top'));
    this.panelBtn = mk('⚙ 튜닝', () => {
      this.panel.classList.toggle('open');
      this.panelBtn.classList.toggle('active', this.panel.classList.contains('open'));
    }, 'accent');
    document.body.appendChild(bar);

    // ---------- 튜닝 패널 ----------
    this.panel = el('div', 'panel');
    const head = el('div', 'panel-head');
    head.innerHTML = '<b>파라미터 튜닝</b>';
    const resetAll = el('button', 'tool');
    resetAll.textContent = '기본값 복원';
    resetAll.addEventListener('click', () => {
      Object.assign(this.cfg, DEFAULTS);
      clearConfig();
      this.syncSliders();
      this.scheduleRebuild(true);
    });
    head.appendChild(resetAll);
    this.panel.appendChild(head);

    for (const g of SCHEMA) {
      const sec = el('div', 'sec');
      sec.appendChild(Object.assign(el('div', 'sec-title'), { textContent: g.group }));
      for (const [key, label, min, max, step] of g.items) {
        const row = el('div', 'srow');
        const name = el('label', 'sname');
        name.textContent = label;
        const val = el('span', 'sval');
        const input = el('input', 'slider');
        input.type = 'range';
        input.min = min; input.max = max; input.step = step;
        input.value = this.cfg[key];
        val.textContent = fmt(this.cfg[key]);
        input.addEventListener('input', () => {
          this.cfg[key] = parseFloat(input.value);
          val.textContent = fmt(this.cfg[key]);
          saveConfig(this.cfg);
          if (REBUILD_KEYS.has(key)) this.scheduleRebuild();
          else this.app.applyLive();
        });
        row.append(name, input, val);
        sec.appendChild(row);
        this.sliders.push({ key, input, val });
      }
      this.panel.appendChild(sec);
    }
    document.body.appendChild(this.panel);

    // ---------- 승리 오버레이 ----------
    this.overlay = el('div', 'overlay');
    this.overlay.innerHTML = '<div class="win">GET!<span>상품이 2–3번 봉 틈으로 낙하</span></div>';
    document.body.appendChild(this.overlay);
  }

  syncSliders() {
    for (const s of this.sliders) {
      s.input.value = this.cfg[s.key];
      s.val.textContent = fmt(this.cfg[s.key]);
    }
  }

  scheduleRebuild(now = false) {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => this.app.rebuild(), now ? 0 : 220);
  }

  bindKeys() {
    const map = { KeyA: 'move', ArrowLeft: 'move', KeyW: 'fwd', ArrowUp: 'fwd', Space: 'stop', KeyS: 'stop', ArrowDown: 'stop' };
    addEventListener('keydown', (e) => {
      const k = map[e.code];
      if (!k) return;
      e.preventDefault();
      this.buttons[k] = true;
      this.btnEls[k].classList.add('on');
    });
    addEventListener('keyup', (e) => {
      const k = map[e.code];
      if (!k) return;
      e.preventDefault();
      this.buttons[k] = false;
      this.btnEls[k].classList.remove('on');
    });
    addEventListener('blur', () => {
      for (const k of Object.keys(this.buttons)) {
        this.buttons[k] = false;
        this.btnEls[k].classList.remove('on');
      }
    });
  }

  update() {
    const g = this.game;
    q('#hud-state').textContent = STATE[g.state] || g.state;
    q('#hud-score').textContent = `시도 ${g.attempts} · 성공 ${g.wins}`;

    const t = g.boxBody.translation();
    const r = g.boxBody.rotation();
    q('#hud-bz').textContent = (t.z * 100).toFixed(1) + ' cm';
    q('#hud-tilt').textContent = tiltX(r).toFixed(0) + '°';
    const bars = g.barContacts();
    q('#hud-bars').textContent = bars.length ? bars.map((n) => n + '번').join(', ') : '없음';

    const gr = g.lastGrip;
    q('#hud-q').textContent = gr.quality.toFixed(2);
    q('#hud-roll').textContent =
      `${(gr.failP * 100).toFixed(0)}% / ${gr.roll.toFixed(2)} ${gr.failed ? '✕' : '○'}`;
    q('#hud-roll').className = gr.failed ? 'bad' : 'good';
    q('#hud-stop').textContent = g.stopReason || '–';

    this.overlay.classList.toggle('show', g.state === 'WIN');
  }
}

// ---- 유틸 ----
function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
function q(sel) { return document.querySelector(sel); }
function fmt(v) { return Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, ''); }

/** 쿼터니언에서 X축 회전 성분(도) — 봉을 축으로 한 기울기 */
function tiltX(r) {
  const sinp = 2 * (r.w * r.x + r.y * r.z);
  const cosp = 1 - 2 * (r.x * r.x + r.y * r.y);
  return Math.atan2(sinp, cosp) * 180 / Math.PI;
}
