import { SCHEMA, DEFAULTS, FIGURES, saveConfig, clearConfig } from './config.js';
import { STATE } from './game.js';

// 값이 바뀌면 기구/박스를 다시 만들어야 하는 파라미터
const REBUILD_KEYS = new Set([
  'barRadius', 'barLength', 'barGapZ', 'barOuterZ', 'barLowY', 'barRaise',
  'frictionRubber', 'frictionSlick', 'frictionBox', 'frictionFloor', 'frictionClaw',
  'boxW', 'boxH', 'boxD', 'boxMass', 'boxRestitution', 'boxLinDamp', 'boxAngDamp',
  'clawPivotX', 'clawArmLen', 'clawElbowOut','clawFingerMass', 'clawTipThick', 'clawTipWidth', 'clawTipLen', 'clawTipRaise',
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
      <button class="hud-head" id="hud-toggle" aria-expanded="true">
        <b id="hud-state">대기</b><i class="hud-caret" aria-hidden="true"></i>
      </button>
      <div class="hud-body">
        <div class="row muted" id="hud-score">시도 0 · 성공 0</div>
        <hr>
        <div class="row"><span>박스 z</span><b id="hud-bz">–</b></div>
        <div class="row"><span>박스 기울기(X축)</span><b id="hud-tilt">–</b></div>
        <div class="row"><span>접촉 봉</span><b id="hud-bars">–</b></div>
        <div class="row wrap"><span>정지 사유</span><b id="hud-stop">–</b></div>
      </div>`;
    document.body.appendChild(this.hud);

    // 접힘 상태는 기기마다 기억한다. 저장값이 없으면 좁은 화면(모바일)에서 접힌 채로 시작.
    let collapsed = matchMedia('(max-width: 820px)').matches;
    try {
      const saved = localStorage.getItem(HUD_KEY);
      if (saved !== null) collapsed = saved === '1';
    } catch (e) {}
    const setCollapsed = (v) => {
      this.hud.classList.toggle('collapsed', v);
      q('#hud-toggle').setAttribute('aria-expanded', String(!v));
      try { localStorage.setItem(HUD_KEY, v ? '1' : '0'); } catch (e) {}
    };
    setCollapsed(collapsed);

    // 상태 표시 탭: 개발자 모드에서는 접기/펼치기. 동시에 "숨은 전환"(2초 안에 7번 탭)을 센다.
    let taps = [];
    let collapsedAtFirstTap = collapsed;
    q('#hud-toggle').addEventListener('click', () => {
      const now = performance.now();
      taps = taps.filter((t) => now - t < SECRET_TAP_WINDOW);
      if (!taps.length) collapsedAtFirstTap = this.hud.classList.contains('collapsed');
      taps.push(now);
      if (taps.length >= SECRET_TAP_COUNT) {
        taps = [];
        if (this.devMode) setCollapsed(collapsedAtFirstTap);   // 연타로 뒤집힌 접힘 상태는 되돌린다
        this.setDevMode(!this.devMode);
        return;
      }
      if (this.devMode) setCollapsed(!this.hud.classList.contains('collapsed'));
    });

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
    // 'dev-only' 클래스가 붙은 요소는 개발자 모드에서만 보인다 (styles.css)
    const bar = el('div', 'toolbar');
    this.toolbar = bar;
    const mk = (label, fn, cls = '', parent = bar) => {
      const b = el('button', 'tool ' + cls);
      b.textContent = label;
      b.addEventListener('click', fn);
      parent.appendChild(b);
      return b;
    };
    mk('박스 초기위치', () => this.game.resetBox());
    mk('박스 → 1번 봉', () => this.game.resetBox(this.game.poseOnOuterBar(1)), 'dev-only');
    mk('박스 → 4번 봉', () => this.game.resetBox(this.game.poseOnOuterBar(4)), 'dev-only');
    this.dbgBtn = mk('물리 와이어', () => {
      this.app.debug.visible = !this.app.debug.visible;
      this.dbgBtn.classList.toggle('active', this.app.debug.visible);
    }, 'dev-only');
    mk('정면', () => this.app.setView('front'));
    mk('측면', () => this.app.setView('side'));
    mk('위', () => this.app.setView('top'));
    this.panelBtn = mk('⚙ 튜닝', () => {
      this.panel.classList.toggle('open');
      this.panelBtn.classList.toggle('active', this.panel.classList.contains('open'));
      this.layout();
    }, 'accent dev-only');

    // 피규어 종류 선택 (두 모드 공통)
    const figs = el('div', 'figures');
    figs.appendChild(Object.assign(el('span', 'figures-label'), { textContent: '피규어' }));
    this.figureBtns = new Map();
    for (const f of FIGURES) {
      this.figureBtns.set(f.id, mk(f.name, () => this.selectFigure(f.id), 'figure', figs));
    }
    bar.appendChild(figs);
    document.body.appendChild(bar);

    // ---------- 튜닝 패널 ----------
    this.panel = el('div', 'panel dev-only');
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
    this.overlay.innerHTML =
      '<div class="win">축하합니다' +
      '<span>상품이 2–3번 봉 틈을 통과했습니다</span>' +
      '<button class="restart" id="btn-restart">다시하기</button></div>';
    document.body.appendChild(this.overlay);
    q('#btn-restart').addEventListener('click', () => this.game.restart());

    // ---------- 모드 전환 알림 ----------
    this.toast = el('div', 'toast');
    this.toast.setAttribute('role', 'status');
    document.body.appendChild(this.toast);

    // 모드·피규어 선택 상태 복원 (기기마다 기억)
    let dev = false, fig = FIGURES[0].id;
    try {
      dev = localStorage.getItem(DEV_KEY) === '1';
      const savedFig = Number(localStorage.getItem(FIGURE_KEY));
      if (FIGURES.some((f) => f.id === savedFig)) fig = savedFig;
    } catch (e) {}
    this.setDevMode(dev, { silent: true });
    this.markFigure(fig);
    addEventListener('resize', () => this.layout());
  }

  /** 개발자 모드 켜기/끄기. 끌 때는 개발용 표시(튜닝 패널, 물리 와이어)도 함께 닫는다. */
  setDevMode(on, { silent = false } = {}) {
    this.devMode = on;
    document.body.classList.toggle('dev', on);
    try { localStorage.setItem(DEV_KEY, on ? '1' : '0'); } catch (e) {}
    if (!on) {
      this.panel.classList.remove('open');
      this.panelBtn.classList.remove('active');
      this.app.debug.visible = false;
      this.dbgBtn.classList.remove('active');
    }
    if (!silent) this.showToast(on ? '개발자 모드 ON' : '개발자 모드 OFF');
    this.layout();
  }

  showToast(text) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.remove('show'), 1400);
  }

  /** 피규어 종류를 고르면 그 번호의 박스 크기·봉 위치로 바꾸고 기구를 다시 만든다 */
  selectFigure(id) {
    const fig = FIGURES.find((f) => f.id === id);
    if (!fig) return;
    Object.assign(this.cfg, fig.values);
    saveConfig(this.cfg);
    this.syncSliders();
    this.markFigure(id);
    this.scheduleRebuild(true);
  }

  markFigure(id) {
    for (const [fid, b] of this.figureBtns) b.classList.toggle('active', fid === id);
    try { localStorage.setItem(FIGURE_KEY, String(id)); } catch (e) {}
  }

  /**
   * 툴바 줄 수가 모드·화면 폭에 따라 달라지므로, 튜닝 패널과 HUD 를 툴바 아래로 맞춘다.
   * HUD 는 툴바와 가로로 겹칠 때(좁은 화면)만 내린다.
   */
  layout() {
    const tb = this.toolbar.getBoundingClientRect();
    this.panel.style.top = `${Math.round(tb.bottom + 6)}px`;
    this.hud.style.top = '';
    const hud = this.hud.getBoundingClientRect();
    if (hud.right > tb.left - 6) this.hud.style.top = `${Math.round(tb.bottom + 8)}px`;
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
    let typed = '';
    addEventListener('keydown', (e) => {
      // 숨은 전환 단어. e.code 를 먼저 읽어 한/영 입력 상태와 무관하게 같은 물리 키를 인식하고,
      // code 가 없는 환경에서는 e.key 로 대신한다.
      const letter = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase()
        : /^(Digit|Numpad)[0-9]$/.test(e.code) ? e.code.slice(-1)
        : (/^[a-z0-9]$/i.test(e.key) ? e.key.toLowerCase() : null);
      if (letter && !e.repeat) {
        typed = (typed + letter).slice(-SECRET_WORD.length);
        if (typed === SECRET_WORD) { typed = ''; this.setDevMode(!this.devMode); }
      }
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

    q('#hud-stop').textContent = g.stopReason || '–';

    this.overlay.classList.toggle('show', g.state === 'WIN');
  }
}

const HUD_KEY = 'ufo-catcher-hud-collapsed';
const DEV_KEY = 'ufo-catcher-dev';
const FIGURE_KEY = 'ufo-catcher-figure';

// 개발자 모드 숨은 전환: 상태 표시를 SECRET_TAP_WINDOW(ms) 안에 SECRET_TAP_COUNT 번 탭하거나,
// 키보드로 SECRET_WORD 를 입력한다. 정적 사이트라 소스를 보면 찾을 수 있다 — 보안이 아니라 가림막.
const SECRET_TAP_COUNT = 7;
const SECRET_TAP_WINDOW = 2000;
const SECRET_WORD = 'ssen8945';   // 영문 소문자·숫자

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
