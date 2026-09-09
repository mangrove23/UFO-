# UFO 캐쳐 (하시와타시) 물리 프로토타입

Three.js + Rapier(3D, compat 빌드) 기반. 빌드 도구 없이 정적 파일만으로 동작한다.

## 실행

`start.bat` 더블클릭 → http://localhost:8123/ 이 열린다.
(Node/Python 불필요. PowerShell `HttpListener` 정적 서버 `serve.ps1` 사용)

수동 실행:
```
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1
```

### 친구들에게 공유하기 (단일 파일 배포본)

```
powershell -NoProfile -ExecutionPolicy Bypass -File build-artifact.ps1
```

→ `dist/ufo-catcher.html` (약 68KB) 하나가 나온다. src/*.js 와 styles.css 를 전부
인라인하고, three 와 rapier 만 jsdelivr 에서 전체 URL 로 import 한다. importmap 이
필요 없도록 three 의 OrbitControls 는 `src/orbitcam.js`(자체 구현)로 대체했다.

빌드하면 `dist/` 안에 세 개가 생긴다.

| 파일 | 용도 |
|---|---|
| `ufo-catcher.html` | 파일 하나만 보낼 때 |
| `index.html` | 같은 내용. 호스팅이 기본 문서로 찾는 이름 |
| `.nojekyll` | GitHub Pages 의 Jekyll 전처리 끄기 |

즉 **`dist` 폴더를 통째로 올리면 그대로 사이트가 된다.**

> Claude Artifact 로도 게시해 두었지만, 그 링크는 **보는 사람도 Claude 로그인이
> 필요**하다. 친구들에게 뿌릴 용도로는 아래 정적 호스팅이 맞다.

## GitHub Pages 로 배포하기

이 PC 에는 git 도 gh 도 설치돼 있지 않다. 아래 **웹 업로드 방식은 아무것도 설치할
필요가 없다.**

### 1. 리포지토리 만들기

<https://github.com/new> →
- Repository name: `ufo-catcher` (아무거나)
- **Public** 선택 (Private 은 Pages 가 유료 플랜에서만 동작한다)
- "Add a README file" 은 체크하지 않아도 된다
- **Create repository**

### 2. 파일 올리기

새 리포지토리 화면에서 **Add file → Upload files**.
탐색기에서 `dist` 폴더를 열고 **폴더 안의 파일들을** 드래그해 넣는다
(`index.html`, `ufo-catcher.html`, `.nojekyll`).

> `.nojekyll` 은 숨김 파일이라 안 보일 수 있다. 탐색기 상단 **보기 → 숨긴 항목**을
> 켜면 보인다. 없어도 이 프로젝트는 동작하지만, 넣어 두면 안전하다.

아래 **Commit changes** 클릭.

### 3. Pages 켜기

리포지토리 **Settings → Pages** →
- Source: **Deploy from a branch**
- Branch: **main** / 폴더는 **/ (root)**
- **Save**

1~2분 뒤 같은 화면에 주소가 뜬다:

```
https://<깃허브아이디>.github.io/ufo-catcher/
```

이 링크를 친구들에게 보내면 끝이다. 설치도 로그인도 필요 없다.

### 전체 프로젝트를 올리고 싶다면

`dist` 만이 아니라 **루트 폴더 전체**(`index.html`, `src/`, `styles.css`, `.nojekyll`)를
올려도 그대로 동작한다. 빌드 과정이 없는 순수 정적 파일이기 때문이다.
이쪽이 나중에 `src/` 를 고쳐 가며 계속 갱신하기 좋다. 이 경우 배포 주소는
`https://<아이디>.github.io/ufo-catcher/` 가 모듈 버전이 되고,
단일 파일 버전은 `.../ufo-catcher/dist/ufo-catcher.html` 로도 열린다.

### 고친 뒤 갱신하기

1. `build-artifact.ps1` 실행
2. GitHub 리포지토리에서 **Add file → Upload files** 로 바뀐 파일을 다시 올림
   (같은 이름이면 덮어쓴다)
3. 1분쯤 뒤 자동 반영. 안 보이면 `Ctrl+F5` 로 강력 새로고침

### git 으로 하고 싶다면

<https://git-scm.com/download/win> 에서 Git 을 설치한 뒤, 프로젝트 폴더에서:

```
git init -b main
git add .
git commit -m "UFO catcher physics prototype"
git remote add origin https://github.com/<아이디>/ufo-catcher.git
git push -u origin main
```

이후 Pages 설정은 위 3번과 같다. 갱신은 `git add . && git commit -m "..." && git push`.

### 다른 선택지

- **Netlify Drop** — <https://app.netlify.com/drop> 에 `dist` 폴더를 드래그하면
  계정 없이도 즉시 공개 URL. GitHub 보다 빠르지만 주소가 임의 문자열이다.
- **Cloudflare Pages** — GitHub 리포지토리를 연결하면 push 할 때마다 자동 배포.

### 같은 공유기 안의 다른 기기에서 접속

`http://localhost:8123` 은 이 PC 전용이다. 같은 공유기 안의 다른 기기에서 열려면
관리자 PowerShell에서 한 번만:

```
netsh http add urlacl url=http://+:8123/ user=%USERNAME%
netsh advfirewall firewall add rule name="ufo-catcher" dir=in action=allow protocol=TCP localport=8123
```

그 다음 `serve.ps1` 의 `$prefix` 를 `http://+:$Port/` 로 바꾸고 실행하면,
다른 기기에서 `http://<이 PC의 LAN IP>:8123/` 로 접속된다.
인터넷 너머까지 열려면 별도 호스팅이 필요하다.

## 조작

집게는 **가장 오른쪽**에서 출발해 왼쪽으로 이동한다.

| 버튼 | 키 | 동작 |
|---|---|---|
| ① 이동 | A / ← | 누르는 동안 좌우축(봉과 평행) 이동, 떼면 정지 |
| ② 전진 | W / ↑ | 누르는 동안 전후축(봉과 수직) 이동, 떼면 **벌어지며 자동 하강** |
| ③ 정지 | Space / S | 하강 중 누르면 그 높이에서 정지 + 오므림 |

하강 중 집게가 박스나 봉에 닿으면 정지 버튼 없이도 자동 정지 후 오므린다.

`자유 조작: ON` 을 켜면 좌우/전진을 몇 번이든 다시 잡을 수 있고(누를 때마다 방향 반전),
정지 버튼으로 하강을 시작한다. 튜닝할 때 편하다.

## 구조

```
index.html          importmap (three / rapier) + 부트스트랩
src/config.js       모든 튜닝 파라미터 + UI 스키마 + localStorage
src/physics.js      Rapier 초기화, 디버그 와이어프레임
src/machine.js      봉 4개 / 벽 / 바닥판 / 앞 트렌치 / 뒤 진열대 / 틈
src/claw.js         집게(kinematic 헤드 + dynamic 발 2개 + revolute 모터)
src/paperbox.js     빳빳한 종이 상자 메쉬 + 눌림/복원 변형
src/game.js         상태머신, 승리 판정, grip 실패 판정
src/ui.js           HUD / 버튼 / 튜닝 패널
src/main.js         three 셋업, 고정 스텝 루프, 콘솔 도구
```

### 코인/광고 삽입 지점

`Game.startPlay()` (src/game.js) 한 곳만 고치면 된다.

```js
startPlay() {
  // if (!wallet.trySpend(1)) { ui.showNeedCoin(); return false; }
  ...
}
```

## 물리 설계

- **마찰 차등**: 봉 콜라이더는 `CoefficientCombineRule.Multiply`. 2·3번 봉 1.6(고무),
  1·4번 봉 0.045(미끄럼). 박스 표면 1.0 이므로 실효 마찰이 그대로 봉 값이 된다.
- **파지 방식 = 밑으로 걷어 올리기.** 이 기계의 집게는 마찰로 옆면을 무는 것이
  아니다(`frictionClaw` 는 0.2 로 낮다). 납작한 발이 박스 **밑으로 파고들어**
  기하적으로 떠올린다. 그래서 `clawMinY`(고정 하강 깊이)가 박스 바닥보다 아래여야
  하고, 봉이 있는 z 에서는 발이 봉에 먼저 닿아 멈추므로 **2–3번 틈 위에서만**
  끝까지 내려간다.
- **집게 구동력 = 일정 토크**: 발은 dynamic 강체 + revolute 조인트의 위치 모터로
  구동하되, 매 프레임 `강성 = clawGripTorque / |목표각 − 현재각|` 으로 역산한다.
  덕분에 박스 폭이 달라져도 힘이 `clawGripTorque`(N·m)로 일정하게 유지된다.
- **grip 실패 확률**: 오므린 직후 두 발끝을 박스 로컬 좌표로 변환해 파지 품질(0~1)을
  계산한다. 발끝이 박스 바닥면보다 아래에 있고 바닥 안쪽으로 깊이 들어갔으면 1,
  모서리만 걸치면 0에 근접, 밑으로 못 들어갔으면 0.
  `failP = gripFailMin + (gripFailBase - gripFailMin) * (1 - quality)`.
  실패하면 토크를 `clawSlipTorque` 로 떨어뜨리고, `clawSlipDelay` 뒤 발이
  `clawSlipSpread` 만큼 벌어져 **들어올리는 도중 놓친다**.
- **종이 찌그러짐**: 물리 형상은 강체 직육면체 그대로 두고, 집게 발끝·헤드·닿아
  있는 봉의 위치에서 "누르는 지점"을 기하적으로 구해 메쉬 정점만 법선 방향으로
  밀어 넣는다. 힘이 사라지면 지수적으로 복원(`paperAttack` / `paperRecover`).
  접촉력을 쓰지 않으므로 물리 엔진 버전에 의존하지 않는다.
- **접촉 후 추가 하강(`descendOvertravel`)**: 닿는 즉시 완전 정지하면 "눌러서
  떨어뜨리기"가 물리적으로 불가능하다. 실기처럼 조금 더 눌리게 한다.

## 튜닝하며 확인한 것 (측정값)

봉 간격 등 기본값은 아래 실측 결과를 반영한 것이다.

1. **`barRaise` 12cm 는 성립하지 않는다.**
   1·4번 봉이 2·3번보다 12 / 8 / 5cm 높은 경우, 박스를 1번 봉에 올려도 항상
   2·3번 봉 위로 미끄러져 돌아오거나 바깥 바닥으로 떨어진다. 강체 박스는 둥근 봉
   **하나** 위에서 안정 평형을 가질 수 없기 때문이고, 마찰(0.045 / 0.15 / 0.30)을
   올려도 바뀌지 않는다(마찰은 미끄러짐을 막을 뿐 넘어짐을 막지 못한다).
   **3cm 이하**에서 비로소 1번+2번 봉에 동시에 걸친 기울어진 안정 자세가 생긴다.
   → 기본값 `barRaise = 0.03`. 사양대로 12cm 를 보고 싶으면 패널에서 올리면 된다.

2. **걸침 자세** (기본값, `박스 → 1번 봉` 버튼): 기울기 −18.3°, 중심 z=0.138,
   1번+2번 봉 접촉. 1번 봉(z=0.18) 기준 바깥쪽과 안쪽(틈 방향) 양쪽으로 삐져나온
   상태로, 사양의 출발 자세와 일치한다.

3. **기법 A (들어서 뒤집기) 는 통한다.** 걸침 자세에서 바깥쪽 삐져나온 부분을
   노려 반복 시도하면 박스가 봉을 축으로 회전하며 2–3번 틈으로 낙하한다.
   (아래 "난이도" 참고)

4. **기법 B (눌러서 떨어뜨리기) 는 좌우 오프셋이 필수다.**
   벌어진 발끝 간격은 ±15.6cm, 박스는 ±9cm 다. 좌우 중앙에 맞추면 두 발이
   박스를 양옆으로 비껴가므로, 한 발이 박스 위에 올라타도록 x 를 어긋나게 대야
   위를 누를 수 있다.

5. **끼임**: 박스가 틈에서 45° 정도로 걸리면 그 상태로 멈춘다. 실효 틈 16.0cm 대비
   45°일 때 박스의 z 투영폭이 28cm 라 통과할 수 없기 때문이고, 90°에 가깝게
   세워야(15cm, 여유 1cm) 빠진다. 계속 시도해 세우는 것이 곧 게임 플레이다.

## 난이도

봇(박스 위치를 정확히 알고 매번 최적 지점을 노리는 스크립트)으로 10세션 측정:
**평균 11시도, 분포 4~21, 60시도 내 미클리어 20%**. 사람은 조준이 더 거칠어
체감 20~30시도쯤 된다. 각 파라미터를 단독으로 올렸을 때의 측정 효과(8세션):

| 변경 | 봇 평균 시도 |
|---|---|
| 기준값 | 8.1 |
| `gripFailMin` 0.22 → 0.34 | 10.8 |
| `clawGripTorque` 0.62 → 0.54 | 15.5 |
| `frictionSlick` 0.10 → 0.14 | 15.6 |
| `boxMass` 0.40 → 0.46 | 25 (5/8 미클리어 — 과함) |

네 개를 동시에 올리면 0/12 미클리어가 되니 한 번에 하나씩 조정할 것.
현재 기본값은 이 중 세 개를 약하게 섞은 조합이다.

## 기구 배치 (현재 기본값)

- 실효 틈(2–3번 봉) **16.0cm**, 박스 최소 통과폭 15cm → 여유 1cm
- 1번 봉 표면 ~ 앞 유리 **20.0cm** = 박스 가로 18cm + 2cm.
  박스가 여기 빠지면 서서 껴 버리고, 집게 하강 깊이로는 윗모서리밖에 못 닿아
  사실상 회수 불가 — 실수에 대한 벌칙 구간.
- 4번 봉 뒤: 2·3번 봉 윗면과 같은 높이의 진열대 + 장식용 피규어 박스 5개(고정).
  집게의 후방 이동 한계(`limitZback`)가 4번 봉 바로 뒤라 여기엔 갈 수 없다.
- 집게 홈: **가장 오른쪽**(x=+0.42), z=0(틈 위). 홈을 앞 트렌치 위에 두면
  파지에 성공할 때마다 박스가 거기 빠져 버려서 z=0 으로 두었다.

## 튜닝 패널

우상단 `⚙ 튜닝`. 값은 localStorage 에 저장되며 `기본값 복원` 으로 되돌린다.
기하/마찰/질량 계열은 자동으로 기구를 재구성하고, 속도·강성·확률 계열은 즉시 반영된다.

`물리 와이어` 로 Rapier 콜라이더를 그대로 볼 수 있다.

## 콘솔 도구 (F12)

```js
__ufo.simulate(3)            // 화면과 무관하게 물리를 3초 진행하고 상태 반환
__ufo.place(x, y, z, true)   // 집게 순간이동 (마지막 인자 true = 벌린 상태)
__ufo.game.resetBox(__ufo.game.poseOnOuterBar(1))  // 1번 봉 걸침 자세
__ufo.cfg                    // 파라미터 직접 수정
__ufo.app.rebuild()          // 기구 재구성
```

브라우저 탭이 백그라운드면 `requestAnimationFrame` 이 멈춰 물리도 정지한다.
자동 검증에는 `simulate()` 를 쓸 것.

## 아직 안 한 것

- 화폐/광고 (0단계 방침대로 무제한 플레이)
- 사운드, 상품 종류 다양화, 모바일 터치 최적화
