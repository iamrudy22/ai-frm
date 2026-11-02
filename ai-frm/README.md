# AIFRM — 월별 자금 리스크 모니터링

자금수지표 회차, 한국은행 ECOS 지표, 금융투자협회 채권 시가평가 금리로 다섯 지표를 판정한다.

| 지표 | 입력 | 판정 |
|---|---|---|
| 대금 회수 위험 | 연속한 두 회차 (7월 판단 = 6월 계획 vs 6월 실적) | 4단계 등급 |
| 유동성 Gap | 최신 회차 | 4단계 등급 |
| 적정 시재 | 최신 회차 | 안정적 / 적정시재 부족 |
| 건설경기 인식 지수 | ECOS 9종 + 최신 회차·석 달 전 회차의 분양회수 | 종합위기단계(4단계) |
| 조달위험 인식 지수 | 채권정보센터 금리(판단월 = 최신 회차의 달, 전달 말 금리) | 4단계 등급 |

정책과 설계는 저장소 루트의 `docs/`에 있다. 건설경기 인식 지수는
`docs/plans/2026-09-28-geonseol-gyeonggi-policy.md`와 같은 폴더의 `-impl-plan.md`를,
조달위험 인식 지수는 `docs/plans/2026-09-28-jodal-wiheom-policy.md`를 본다.

## 실행

```bash
npm install
npm run dev
```

`http://localhost:3000/aifrm`을 연다.
이력 저장 기능은 `package.json`에 지정한 Node.js **26.12.1**의 내장 SQLite를 사용한다. 별도 SQLite 서버나 패키지 설치는 필요 없다. 앱 폴더에서 서버를 실행하면 `data/report-history.sqlite`가 자동 생성되고 지원하는 기존 원장은 시작 시 스키마 5로 이관된다. 다른 작업 폴더에서 실행하면 저장 위치도 달라지므로 항상 `ai-frm`에서 실행한다. `data/`는 Git에서 제외된다.

Node.js 26.12.1은 Brotli 취약점 CVE-2026-111497 패치를 포함한 [보안 릴리스](https://nodejs.org/en/blog/release/v26.12.1/)다([공식 보안 공지](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases)). 실행 전 `node -p 'process.version'`으로 `v26.12.1`을 확인한다. 런타임 변경 뒤에는 기존 앱 서버를 완전히 종료하고 다시 시작하며, 관리 도구나 디버거에서 실제 서버 프로세스의 `process.version`도 `v26.12.1`인지 확인한다. `engines` 변경이나 새 터미널의 버전 확인만으로 이미 실행 중인 서버가 갱신되지는 않는다.

검증: `npm run verify`(tsc + vitest), `npm run lint`(전체 ESLint).

### Cloudflare Tunnel 외부 공유

기본값은 localhost 전용이다. 서버 런타임에 `AIFRM_PUBLIC_ORIGIN=https://aifrm.brainbackdoor.com`을 지정하면 이력 API의 요청 경계가 해당 공개 Host와 HTTPS Origin만 추가로 허용한다. URL은 경로 없는 origin이어야 하며, 다른 Host·포트·Origin과 임의 forwarded 헤더로 허용 범위를 넓힐 수 없다. Next가 요청 URL을 내부 loopback 주소로 정규화하는 경우에도 공개 Host는 정확히 일치해야 한다. 이 설정은 사용자 인증을 제공하지 않는다.

고정 도메인과 Cloudflare Access를 사용한다면 외부 공개 전에 **전체 호스트명**을 보호하고, 허용할 이메일을 제한하며, 터널의 **Protect with Access**에서 토큰을 검증한다. 화면뿐 아니라 `/api/*`도 보호해야 한다. 앱은 `127.0.0.1:3002`에 바인딩한다. 계산식·리포트 템플릿은 바꾸지 않는다.

현재 선택은 결제수단 등록이 필요 없는 **이메일 인증 Quick Tunnel**이다. `cloudflared tunnel --allowed-mail`로 명시한 이메일만 허용하며, 인증 옵션 없는 공개 터널로 대체하지 않는다. 가비아 네임서버 변경이나 Cloudflare Zero Trust 가입은 진행하지 않는다. 임시 `https://<발급된 이름>.trycloudflare.com` 주소는 터널 재시작마다 달라지므로 서버의 `AIFRM_PUBLIC_ORIGIN`도 발급된 origin 하나로 다시 지정한다. 와일드카드는 사용하지 않는다. [공식 절차와 제한](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)

인증 검증 중에는 터널을 합성 시험 응답만 제공하는 로컬 gate로 연결한다. 무인증 화면·API 요청이 origin에 도달하지 않는지와 허용 이메일의 인증 성공을 확인한 뒤, **같은 터널과 gate 주소를 유지**하며 gate만 실제 앱의 `127.0.0.1:3002`로 연결한다. 연결 대상을 바꾸기 위해 터널을 재시작하면 임시 주소와 기존 검증이 무효가 된다. 서비스 주소에는 `/aifrm` 경로를 넣지 않는다.

허용된 사용자는 현재 하나의 공통 원장을 공유한다. 데이터는 Mac의 `data/report-history.sqlite`에 계속 저장되며, Mac·앱·터널이 실행 중이어야 접속할 수 있다. 터널 토큰·계정 인증정보·업무 원본은 Git에 넣지 않는다.

2026-11-02 준비 기록: 요청 경계의 TDD(74건)·독립 리뷰·전체 회귀(1,366건 통과, 기존 2건 skipped)를 완료했다. 최초 전체 실행에서 HWPX ZIP 테스트 1건이 시간 초과했으나 해당 파일 재실행과 `--maxWorkers=4` 전체 실행은 통과했다. Turbopack은 실행 환경의 내부 포트 권한 오류로 실패하여 공식 `next build --webpack`으로 production 빌드를 검증했다. 실제 Next 서버의 Host/Origin 요청 10건도 업무 원장에 접근하지 않는 잘못된 조회 조건으로 통과했다.

가비아 원본 DNS 9개를 Cloudflare Free의 Pending 존에 복사하고 원본 TTL 600초와 DNS 전용 연결을 유지했다. 가비아 네임서버 변경 초안은 적용 전에 취소했으며 기존 가비아 네임서버가 유지된다. 사용자는 Zero Trust Free의 결제정보·초과 청구 동의를 진행하지 않고 임시 주소와 이메일 인증을 선택했다. 지정한 단일 이메일로 보호한 Quick Tunnel을 생성했고 무인증 외부 요청 20건(화면·API·정적 파일·시험 다운로드의 GET/POST/HEAD/OPTIONS와 가짜 인증 헤더)을 차단했다. 외부 검사 전후 전체 probe 도달 횟수가 변하지 않았고, 전후 로컬 합성 요청에서는 정상 증가하여 계측이 동작함을 확인했다. 새 임시 origin을 지정한 production 서버의 Host·Origin 경계 10건도 업무 원장을 읽거나 쓰지 않고 통과했다. 사용자가 웹에서 이메일 인증을 완료하고 합성 sentinel을 확인하는 긍정 검증은 아직 대기 중이다. 준비 완료를 외부 공유 완료로 취급하지 않는다. 임시 공개 주소·허용 이메일·인증번호·터널 인증정보는 이 문서에 기록하지 않는다.

시험 gate는 `/private/tmp/aifrm-quick-share-20261102/`에만 있으며 TDD 36건과 독립 리뷰를 통과했다. 제어 파일이 없거나 잘못되면 503으로 닫히고, probe 모드에서는 업무 앱에 연결하지 않는다. 전체 probe 도달 횟수를 Host·Origin 검사 전에 기록하여 인증 옵션이나 요청 헤더에 문제가 있어도 차단 검증이 잘못 통과하지 않도록 했다. 이 카운터는 probe 모드 전용이며 앱 연결 후의 인증 증거로 재사용하지 않는다. 현재 로컬 3013 게이트는 probe 모드로서 합성 응답만 제공하며 실제 앱은 외부에 연결하지 않았다. 로컬 `anonymous-boundary-qa.json`과 `temporary-origin-runtime-qa.json`에 검증 결과가 있다. `/private/tmp`의 시험 파일은 영구 운영 도구가 아니다.

## 홈과 과거 자료 등록

`/aifrm`의 **보고서 작성**에서는 자금수지표 업로드부터 시작한다. 작성 중인 월과 확정본은 **보관한 보고서**에서 확인한다. 외부 위험 이력 보완은 보관 영역에서 필요한 때 펼친다.

파일이나 확정 이력이 없어도 상단 **과거 자료 등록**으로 원자료를 등록할 수 있다. 예를 들어 현재 10월이어도 운영 담당자가 보유한 1~8월 자료를 월별로 보관할 수 있다. 과거 등록 화면의 **보관 목록으로 돌아가기**는 입력을 먼저 보관한 뒤 목록을 연다. 확정 이력의 조회 중·실패·전체 없음·조건에 맞는 보고서 없음은 서로 구분하며, 조건만 비어 있으면 **조건 초기화**로 기존 이력을 다시 볼 수 있다.

1. **보고 연도·보고월**을 고른다. 보고월이 `2026/09`면 자금자료 기준회차는 `2026/10`으로 자동 표시된다. **선택한 월 자료 입력**을 누르면 새 초안을 만들거나 같은 월의 작성 중인 초안을 연다. 보고월과 자료회차는 생성 후 고정된다.
2. **자금자료·경제지표·조달금리** 탭에서 원자료를 입력한다. 자금자료는 **자료회차·입력 대상월**을 선택해 여섯 항목씩 입력하며, 회차와 탭을 바꾸어도 원값은 유지된다. 원자료 기준일·평가일은 실제 날짜를 입력한다.
3. **임시보관**으로 미완성 원값도 저장할 수 있다. **보관하고 다음 달 입력**은 현재 월의 보관 성공을 확인한 뒤 다음 보고월을 만들거나 기존 초안을 연다. 나갈 때는 **보관하고 목록으로**를 사용한다. 다시 접속하면 **보관한 보고서 → 입력 중인 월 → 이어서 작성**으로 같은 초안을 연다. 목록은 보고월·자료회차·보관 시각과 작성 중·검토됨·재검토 필요 등의 상태를 표시한다.
4. **보고서 검토**로 보관된 원자료를 검증하고 실제 산출 문서를 확인한다. 포함·제외 자료회차, 항목 전체 자료 없음 사유, 경제 원값 공란, 평가일과 금리 결측도 용지 바깥에서 확인한다. 첫 오류의 탭과 입력으로 이동하며 **다음 오류로 이동**으로 나머지 오류를 차례로 확인할 수 있다.
5. 검토한 현재 내용에 대해 **보고서 확정**을 명시적으로 누른다. 성공하면 작성 중 목록에서 빠지고 월별 확정 이력에 1차가 생기며 보관된 확정 문서가 열린다. 이후 값 수정은 해당 확정본의 **새 수정안**으로 진행한다. 같은 월의 기존 확정본을 직접 입력으로 덮어쓸 수 없다.

| 탭 | 입력 방법 |
|---|---|
| 자금자료 | 현재 자료회차는 필수이며 이전 비교회차(한 달 전)·계획 비교회차(석 달 전)는 명시적으로 선택한다. 선택한 각 회차 안의 실제 원자료 기준일과 기초시재·수입계·수입·분양회수·기타수입·지출의 모든 표시 월 값을 억원으로 입력한다. 수입계는 독립 원값이며 합산하거나 시재를 이월하지 않는다. 한 항목 전체를 확보하지 못한 경우 **항목 전체 자료 없음**과 사유를 사용한다. 개별 공란을 0으로 바꾸지 않으며, 여섯 항목 모두 자료 없음으로 검토할 수는 없다. |
| 경제지표 | 화면에 정해진 9종의 현재월·비교월 공표 원값과 두 기간이 공유하는 단위·기준을 입력한다. 확보하지 못한 숫자는 공란으로 두며 값이 있으면 단위·기준이 필요하다. 대출금리는 공표 원금리(%)를 입력하고 bp 변화량으로 바꾸지 않는다. 자동 환산이나 기준연도 추정은 하지 않는다. |
| 조달금리 | 표시된 관측월의 **실제 평가일**을 추가하고 공사채 AAA 1년·국고채 1년의 **공표 3사 평균(%)**을 입력한다. 해당 월의 실제 마지막 평가일까지 확인하며 휴일의 날짜나 금리를 만들어 넣지 않는다. 평가사별 참조금리는 선택 입력이며 재평균하지 않는다. 공란 금리는 결측으로 남고 평가일이 전혀 없으면 자료 없음 사유를 입력한다. |

원값은 문자열로 입력한다. 실제 `0`·음수와 공란은 다르며, 일반 십진수를 사용하고 쉼표·통화기호·`%`·과학표기는 넣지 않는다. 미완성 숫자·빈 필수값·빈 사유도 초안에는 보관할 수 있지만 검토 시 수치·날짜·필수 항목 오류로 막힐 수 있다. 자동 반올림·범위 보정·빈 값 채우기는 하지 않는다. **원자료 메모**는 선택이다. 자동 보관은 완성·검토·확정을 뜻하지 않으며, 검토 결과에 산출 불가 지표가 있으면 그 상태와 사유를 확인한다.

마지막 입력 후 **1000ms**에 로컬 서버로 자동 보관한다. **보관 중 → 서버 성공 응답(ACK) → 보관됨** 순서이며, ACK 전 마지막 입력은 강제 종료나 새로고침 뒤 복구가 보장되지 않는다. 늦게 도착한 응답이 새 입력을 덮어쓰지 않는다. **임시보관·보관하고 목록으로·보관하고 다음 달 입력·보고서 검토**와 작업 영역 이동은 남은 보관의 성공을 기다리며 실패하면 전환하지 않는다. 미보관 입력이 있으면 지원 브라우저에서 이탈 경고가 표시될 수 있다. 메모를 포함해 입력을 바꾸면 기존 검토가 풀리므로 다시 검토해야 확정할 수 있다. 검토·인쇄·PDF 저장만으로는 확정되지 않는다.

**보관 실패** 시 입력은 화면에 유지된다. **보관 다시 시도**는 원래 보관 요청의 결과를 먼저 확인한다. 응답 결과를 알 수 없는 검토·확정은 **같은 요청으로 결과 확인**을 사용한다. 생성 결과가 불명확하면 **같은 요청으로 생성 결과 확인**으로 먼저 확인한다. 확정 결과를 확인하는 동안에는 추가 편집이 제한된다. 입력 분량이나 항목 오류는 안내에 따라 고친다. 두 탭의 변경이 충돌하면 **최신 내용 조회·비교** 후 **서버 내용으로 전환**을 선택하고, 확인창에서 **미보관 입력 버리고 전환**을 명시해야 서버 내용을 채택한다. **내 입력 유지**로 취소할 수 있다. 다른 탭에서 이미 확정한 뒤의 저장도 충돌로 안내된다. 최신 상태를 확인하고 월별 확정 이력에서 확정본이나 새 수정안을 연다. 보관 실패·충돌 상태에서 닫아야 한다면 별도 **미보관 입력 포기** 확인이 필요하며 마지막 ACK된 내용만 남는다.

## HTML 보고서와 PDF·한글(HWPX) 다운로드

직접 입력 보고서는 **보고서 검토**, 보관한 확정본은 **확정본 열기**로 문서를 확인한다. 기존 엑셀 산출도 계속 사용할 수 있으며 `/aifrm`에서 파일 선택 → 필요 회차 확인 → 산출 → 보고서 순서로 진행한다. 다음 등록·대시보드 안내는 엑셀 산출 흐름에 해당한다.
등록 화면은 Astryx FileInput의 드롭존으로 여러 파일을 선택한다. 추가 선택은 기존 선택에 합치며 개별 파일을 제외할 수 있다. 다른 파일의 같은 회차를 조용히 덮어쓰지 않는다.
선택 전에는 업로드와 접힌 **필요한 파일 안내**만 제공한다. 안내를 펼치면 기본 산출과 6개월 추이 보완에 쓰는 각 파일의 용도를 확인할 수 있다.
파일 선택은 드롭존 한 곳에서 제공하며 별도의 중복 선택 버튼은 두지 않는다.
선택 후에는 엑셀 내용에서 최신 기준월을 자동 확인하고 등록 파일·부족한 기본 회차를 먼저 표시한다. 추가 추이 회차는 필요한 때 펼쳐 확인한다.
기준월 수동 선택이나 ‘차트 기준 자세히’는 제공하지 않는다.
최신이 8월인 기본 산출에는 5·7·8월 회차가 필요하다. 회수율 6개월 추이 자료에는 2~8월 연속 7개 회차가 필요하다.
자료 준비는 실제 지표 산출 성공과 다르며, 회차가 부족해도 준비된 자료로 일부 지표를 산출할 수 있다.
산출하면 등록 영역을 접고 결과 제목으로 이동한다. **등록한 파일 확인·변경**에서 파일별 용도와 원본을 다시 확인할 수 있다.
보고서 버튼 옆에는 기존 결과의 산출 완료·조회 중·산출 불가 개수를 표시한다. 일부 산출 불가여도 보고서를 열 수 있다.
상세 산출표와 긴 기준 설명은 펼쳐서 확인하며, 오류 사유와 필요한 보완 행동은 계속 표시한다. 좁은 화면에서는 상세표 안에서 가로 스크롤한다.
엑셀 산출의 **보고서 보기**는 회차를 올려 산출한 현재 결과를 담아 보여 준다. 산출 전 양식 미리보기는 제공하지 않는다.
**대시보드로 돌아가기**를 눌러도 업로드한 회차와 월 선택은 유지된다.
요약의 **상세 보기**는 **지표별 산출 내역**을 펼쳐 해당 지표로 이동하며 키보드 포커스도 함께 이동한다.
새 파일을 고르는 동안에는 이전 결과와 원본을 유지한다. 새 회차는 **산출하기**를 눌러야 반영된다.
읽기 실패·선택 해제 뒤에는 **이전 결과로 돌아가기**로 기존 파일 선택을 복원할 수 있다.
건설경기 조회는 **다시 불러오기**로 재시도하며, 재조회 중인 이전 지수는 현재 요약 값으로 표시하지 않는다.

보고서는 종합 요약·대금 회수·유동성 Gap(1페이지), 건설경기·조달위험·적정 시재(2페이지),
산식과 위험단계 기준표(3페이지)로 구성된다. 골든셋에 없는 별도 월별 금액 참고 4쪽은 표시하지 않는다.
참고 3쪽의 위험단계 기준표(가중치 포함)와 LCR 산정표는 골든셋 원본에서 잘라낸 정적 이미지를 그대로 표시한다.
원본 표의 문구·수치·병합 셀·색상은 재작성하지 않으며 실제 산출에 사용하는 계산식·정책은 변경하지 않는다.
위험지표에 필요한 회차가 부족하면 해당 지표만 산출불가로 둔다.

보고서를 열면 상단 **한글(HWPX) 다운로드**로 현재 보이는 보고서를 내려받을 수 있다. 자금수지표 산출 결과·보관한 보고서·직접 입력의 검토 화면에서 사용할 수 있으며, 홈의 파일 선택 영역에는 표시하지 않는다. 본문은 편집 가능한 native 문단/요약표, 차트5개와 참고표2개는 문서에 포함된 이미지다. 클릭한 시점의 표시값·작성일을 보존하며 다운로드 때문에 재산출하거나 보고서를 확정하지 않는다. 생성 중에는 중복 클릭을 막고, 실패하면 같은 버튼으로 다시 시도할 수 있다.

HWPX는 검증된3쪽 의미 구성을 브라우저에서 생성한다. 글꼴과 편집기 조판 차이가 있을 수 있으며, 실제 MYBOX·한글 열기/인쇄의 최종 확인은 사용자 QA 대상이다. 기존 PDF 보고서 양식과 계산식은 유지한다.

**인쇄 / PDF 저장**은 브라우저 인쇄 창을 연다. 상단 고정 도구에서 산출 상태와 출력 쪽수를 확인할 수 있다.
산출 중·불가 지표도 현재 상태와 사유를 포함해 출력한다. HTML과 PDF 출력 구성은 3쪽으로 고정한다.
골든셋의 핵심 해석·산식·차트·위험기준·가중치·LCR 산식을 유지하고, 추가 출처·자료 상태·결측 상세와 중복 설명은 싣지 않는다.
대상에서 PDF 저장을 고르고 A4 세로, 배율 100%, 머리글/바닥글 끄기로 저장한다.
차트 배경색이 빠지면 배경 그래픽을 켠다. HWP 파일 변환은 제공하지 않는다.
리포트의 기본 배치·색상·차트·단위 표기는 UI 개선 전 기준(`b9b0768`)으로 유지한다. 2026-10-22 사용자 요청에 따른 부가 설명 삭제·원본 참고표 삽입·본문 서체 조정만 반영한다.
스캔 원본의 글꼴명은 확인되지 않아 돋움 계열(Dotum·돋움, macOS에서는 AppleGothic 대체)로 맞춘다. 본문·지표명은 13pt/줄간격 1.5, 주석은 9pt, 종합 요약은 14pt 굵게, 날짜는 12pt이며 화면과 인쇄에 동일하게 적용한다.
인쇄 용지·쪽 구분·차트 스타일은 유지한다. 그 밖의 UI 개선은 업로드 안내와 보고서 용지 바깥의 조작 기능으로 한정하며 작업 도구는 인쇄에서 제외된다.
기존 계산식과 표시값의 정밀도도 유지한다.

2026-10-27 합성 자료로 실제 PDF 저장본의 A4 3쪽 출력과 브라우저 기본 확대 기능의 200% 검수를 완료했다. 직접 입력 검토는 다른 월의 확정본 위와 빈 홈에서 모두 현재 보고월만 출력되며, 검토를 닫으면 원래 확정본 출력이 복원되는 것을 확인했다. 저장 PDF의 3쪽을 모두 렌더하여 본문·표의 잘림과 앱 버튼 노출이 없음을 검수했고, 인쇄 전후 원장과 미확정 검토 연결도 그대로 유지됐다. 이 검수는 실제 업무 자료의 수치 대조와는 별개다.

UI/UX 단계별 변경·검토·QA·재개 지점은 [진행 기록](../docs/superpowers/plans/2026-10-21-ui-ux.md)에 있다.

- 보고월은 최신 회차의 전달이다. 작성일과 핵심 해석, 건설경기 실제 통계 기준월을 보고서에 표시한다. 세부 회차·관측 구간은 대시보드에서 확인한다.
- 로컬 지표의 추이는 업로드된 각 회차의 당시 계획으로 다시 계산한다. 빠진 달은 선으로 잇거나 0으로 채우지 않는다.
- 위험 이력은 최대 18개 달력 월이다. 본문의 Gap·시재 기준월을 바꿔도 회차별 당시 위험 이력은 바뀌지 않는다.
- 숫자 확보, 비율 비적용, 결측을 구분한다. 정상 순유입·수지 균형의 Gap은 비적용이며 결측에 넣지 않는다.
  실제 0과 음수도 유효한 값이며, 현재 산출 중·불가 상태는 그대로 표시한다.
- 같은 회차의 파일을 다시 올려도 새 파일의 내용을 반영한다.
- 건설경기와 조달위험은 선택한 확정 이력과 과거 보완 산출을 바탕으로 최대 18개월을 표시한다. 해당 확정본의 차트·값은 이후 조회와 별개로 보관된다.
- 세 회차로 당월 지표를 채울 수 있어도 장기 추이가 모두 생기지는 않는다. 보고서는 없는 자료와 산출불가 사유를 표시한다.
- 샘플 PDF의 금액이나 과거 수치를 복사한 데이터는 포함하지 않는다. 실제 결과를 검증하려면 대응하는 원본 회차가 필요하다.

## 로컬 이력과 보고서 확정

외부 산출이 끝나면 해당 계산 입력, 외부 원천 응답과 산출 기록이 **서버가 실행 중인 PC의** `data/report-history.sqlite`에 보관된다. **정규화한 전체 자금수지표 회차 스냅샷과 문서 후보는 보고서를 열고 후보 준비에 성공했을 때** 저장된다. 용지 바깥의 **보고서 확정**을 눌러야 그 후보가 월별 확정 revision이 된다. 보고서 열기, 인쇄 창 열기, PDF 저장 시도는 확정이 아니다. 일부 지표가 산출 불가여도 그 상태를 확인한 보고서를 확정할 수 있다. 성공 응답 후에만 확정 상태를 표시하며, 같은 후보의 재시도는 새 버전을 만들지 않는다. 한 번 확정한 문서의 값·차트·작성일과 이전 revision은 그대로 남고, 정정은 새 revision을 만든다. 서버 또는 브라우저를 다시 열어도 같은 DB를 사용하는 동안 확정 이력을 다시 조회할 수 있다.

**과거 18회차 보완**은 현재 확보한 자금수지표 회차와 현재 조회한 외부 자료로 과거 달을 계산해 저장한다. 과거 당시에 확보하거나 확정한 값이라는 뜻은 아니다. 준비 상태를 보고 가능한 달부터 실행·재개할 수 있으며, 부족한 회차나 연말의 전년도 열 부재는 사유로 남는다. 확정 이력·보완 산출의 출처와 원천 수신 시각은 저장 기록에서 구분한다. 보완값이나 외부 자료 재조회가 기존 확정 문서와 다른 보고서의 확정값을 자동으로 바꾸지 않는다. 이 기능은 외부 스프레드시트·클라우드 DB 연결이나 정기 수집을 하지 않는다. 다만 기존 위험 산출에 필요한 ECOS·금투협 조회는 실행 시 발생한다.

## 웹에서 원자료 수정·자동 보관·정정 확정

**월별 확정 이력**은 저장된 최신 **보고월**을 끝으로 최근 12개월을 보여 준다. **보고 기간**에서 연도나 **전체 기간**을 선택할 수 있고, **전체 기간 미처리만**은 기간 선택에 가려진 오래된 수정안도 찾는다. 보고월은 자료회차의 전달이며 두 식별자는 화면에서 구분한다. 자료가 없는 달을 임의로 채우지 않는다. **확정본 열기**와 월별로 펼치는 이전 확정본 열기는 보관된 문서·출처를 그대로 읽는다.

작성 중인 수정안이 하나면 **이어서 작성**으로 같은 수정안과 보관된 입력을 연다. 여러 안은 **수정안 보기**에서 선택한다. 별도로 시작할 때는 **새 수정안**을 누른다. 편집은 **자금자료·경제지표·조달금리** 탭으로 나뉘며 자료회차·적용 월/평가일·단위를 확인한다. 탭을 바꾸어도 입력과 각 탭의 검색·필터는 유지된다.

| 대상 | 수정 가능한 원자료 | 고정 항목 |
|---|---|---|
| 자금자료 | 저장된 각 회차·월의 기초시재·수입계·수입·분양회수·기타수입·지출(억원) | 수입계는 독립 입력이며 자동 합산하지 않는다. 없는 월·개별 결측을 추가하지 않는다. 판독불가 항목의 복구는 기존 모든 월 값이 필요하다. |
| 경제지표 | 저장된 유효 ECOS 9종의 기준월·비교월 원값, 허용 행의 **값 없음** | 단위·통계/항목 코드·월은 고정이다. 조회 실패 계열을 새로 만들 수 없다. |
| 조달금리 | 저장된 평가일의 공사채 AAA 1년·국고채 1년 공표 3사 평균(%) | 날짜·채권·만기·기관별 참고값은 고정이며 참고값을 재평균하지 않는다. |

숫자는 문자열로 입력한다. **정정 화면의 빈 수정 칸은 변경 없음**이며 실제 숫자 `0`, 음수, 허용된 **값 없음**과 다르다. 최초 직접 입력의 공란과는 의미가 다르다. 쉼표·통화기호·`%`·과학표기 없는 일반 십진수를 사용하며 자동 반올림·범위 보정은 하지 않는다. 기존 수치의 정밀도는 유지된다. 지수·등급·산식·가중치·기준월 식별자는 직접 수정할 수 없고 서버가 저장된 편집 기준으로 검사한다. 최초 직접 입력 때 정한 경제지표의 단위·기준과 자료의 월 식별도 확정 후에는 기존 정정 정책에 따라 고정된다.

마지막 입력 후 **1000ms**에 이 PC의 로컬 서버로 자동 보관한다. 미완성 숫자나 빈 사유도 수정안으로 보관되지만 확정값은 아니다. **저장 중 → 서버 성공 응답(ACK) → 보관됨** 순서이며 ACK 전에 닫거나 강제 종료한 마지막 입력의 복구는 보장하지 않는다. 브라우저 캐시나 sessionStorage가 원장이 아니다. **저장 실패** 때 입력은 유지되며 **저장 다시 시도**로 같은 요청을 재확인한다. **목록으로** 이동하거나 검토하기 전에는 남은 저장을 기다리고, 실패하면 전환하지 않는다. 미전송 입력이 있으면 지원 브라우저에서 이탈 경고를 표시할 수 있다.

**전체 정정 사유**는 공백을 제외하고 비어 있지 않아야 하며 원문 최대 2000자다. **근거 메모**는 선택이며 최대 2000자다. **변경 내용 확인**은 보관된 정확한 버전을 검증해 원자료·산출 결과·영향 보고서를 보여 준다. 오류가 있으면 해당 입력을 고친다. 입력·사유·근거를 바꾸면 현재 검토와 확정 연결이 풀리므로 다시 확인한다. 검토를 통과한 현재 버전만 확정 대기이며, 별도의 **정정 확정** 성공 응답이 있어야 새 차수가 생긴다. 자동 보관·검토·인쇄·PDF 저장은 확정이 아니다. 값이 완전히 같으면 **변경 없음** 또는 **이미 반영됨**으로 처리하여 새 차수를 만들지 않는다. 수정한 원자료의 영향이 있어도 다른 보고서를 자동 정정하지 않는다. 이전 문서·작성일·차트·확정 차수와 원본 업무용 자금수지표는 보존된다.

**검토 종료**는 작업 목록을 정리하는 별도 동작으로 확정본을 바꾸지 않는다. 모든 안의 **내용 보기**는 보관 당시의 시작값·제안값·자료 식별·사유·근거·상태를 읽기 전용으로 보여 주며 조회만으로 새 작업이나 저장·정정을 실행하지 않는다. 수동 종료한 안의 **새 수정안으로 다시 검토**는 원본을 보존한 별도 안을 만든다. 원래 시작값·최신값·제안값을 비교하고 **제안값 재적용 → 변경 내용 확인 → 정정 확정**을 거친다. 비교 중 기준이 바뀌면 **최신값 다시 비교**를 사용한다. 이미 전부 동일하면 새 안이나 차수를 만들지 않는다.

두 탭의 저장이나 기준 변경이 충돌하면 **충돌 · 비교 필요** 상태에서 내 입력을 유지한다. **최신 내용 조회·비교**로 내 미보관 입력과 서버 최신 내용을 비교한다. **서버의 최신 내용으로 전환**은 확인창에서 **미보관 입력 버리고 전환**을 명시적으로 선택해야 한다. **내 입력 유지**로 취소할 수 있다. 이 전환은 서버 값을 덮어쓰지 않으며 오래된 버전을 최신으로 추정해 다시 저장하지 않는다. 내 제안을 다시 적용하려면 비교한 값과 사유를 확인하여 최신 기준에서 입력·검토한다.

정정용 엑셀 내보내기·수정본 업로드·파일 경로·내부 ID 관리는 일반 화면에서 제거되었다. 새 보고서의 웹 직접 입력과 기존 자금수지표 원본 선택, 보고서 열기·PDF 출력, 과거 보완은 함께 사용할 수 있다. 직접 입력의 검토·확정, 저장된 수정안의 검토·확정과 보관 문서 열기는 ECOS·금투협을 재조회하지 않는다. 구형 검증안은 **내용 보기**와 명시적 **정정 확정**으로 호환되지만 교환 API는 종료되어 `410 EXCHANGE_RETIRED`를 반환한다.

## 원장 백업·복구·PC 이전

앱에는 **자동 백업, 백업 버튼, 백업 API가 없다.** 아래 명령은 필요할 때 운영자가 `ai-frm` 폴더에서 Node.js 26.12.1로 직접 실행한다. 서버를 켠 상태의 백업은 SQLite 온라인 백업을 사용하며 `data/backups/report-history-<UTC시각>-<UUID>.sqlite`에 만든다. 실행 중인 WAL 원장의 `report-history.sqlite` 파일 하나만 복사하면 최근 기록이 빠질 수 있다. 백업 성공 경로를 확인하고 DB·백업을 접근 권한이 제한된 별도 저장소에도 보관한다. 원장에는 확정 문서·원천·계산뿐 아니라 최초 직접 입력 초안·수정안·검토·처리 이력이 함께 들어 있다. 일반 사용자는 웹에서 작업하며 DB 위치나 내부 ID를 입력하거나 DB를 직접 편집하지 않는다.

```bash
node --input-type=module <<'NODE'
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { backupWithWake } from './src/infrastructure/report-history/sqlite-backup-wake.mjs';

const expectedSchemaVersion = 5;
const expectedTables = [
  'schema_migration', 'workspace_scope', 'source_capture', 'report_input_snapshot',
  'backfill_batch', 'calculation_record', 'history_selection', 'report_document',
  'report_candidate', 'monthly_confirmation', 'monthly_head', 'idempotent_command',
  'backfill_step', 'batch_capture_slot', 'workbook_export', 'workbook_import',
  'correction_preview', 'correction_command', 'correction_draft',
  'correction_work_command', 'correction_resolution',
  'manual_entry_draft', 'manual_entry_command',
].sort();
const data = join(process.cwd(), 'data');
const original = join(data, 'report-history.sqlite');
const folder = join(data, 'backups');
if (!existsSync(original) || !lstatSync(original).isFile() || lstatSync(original).isSymbolicLink())
  throw Error('백업할 원장이 없습니다');
mkdirSync(folder, { recursive: true, mode: 0o700 });
if (!lstatSync(folder).isDirectory() || lstatSync(folder).isSymbolicLink()) throw Error('백업 폴더 확인 필요');
chmodSync(folder, 0o700);
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const target = join(folder, `report-history-${stamp}-${randomUUID()}.sqlite`);
closeSync(openSync(target, 'wx', 0o600));
let source;
try {
  source = new DatabaseSync(original, { readOnly: true });
  await backupWithWake(source, target);
  const copy = new DatabaseSync(target, { readOnly: true });
  try {
    if (copy.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' ||
        copy.prepare('PRAGMA foreign_key_check').all().length ||
        copy.prepare('PRAGMA user_version').get()?.user_version !== expectedSchemaVersion) throw Error('백업 검증 실패');
    const names = copy.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    if (JSON.stringify(names) !== JSON.stringify(expectedTables)) throw Error('원장 테이블 누락 또는 예상하지 않은 테이블');
    const migrations = copy.prepare('SELECT version FROM schema_migration ORDER BY version').all().map(row => row.version);
    if (JSON.stringify(migrations) !== JSON.stringify([1, 2, 3, 4, 5])) throw Error('원장 migration 검증 실패');
  } finally { copy.close(); }
  if (existsSync(target + '-wal') && statSync(target + '-wal').size !== 0) throw Error('백업 WAL 확인 필요');
  for (const suffix of ['-wal', '-shm']) rmSync(target + suffix, { force: true });
  chmodSync(target, 0o600);
  console.log('BACKUP_OK', target);
} catch (error) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(target + suffix, { force: true });
  throw error;
} finally { source?.close(); }
NODE
```

복구나 다른 PC 이전은 **앱 서버와 이 DB를 여는 모든 프로세스를 완전히 종료한 뒤** 진행한다. 복구할 백업을 대상 PC의 로컬 파일로 가져오고, 아래 명령의 `<백업 파일 경로>`를 실제 경로로 바꾼다. 스크립트는 복구용 복사본과 설치한 원장의 무결성·외래키·스키마 5·정확한 23개 테이블·migration 1~5를 검사하고 두 복사본의 테이블별 건수를 비교한다. 기존 원장과 `-wal`·`-shm`이 있으면 `data/recovery-before-restore-.../`에 함께 옮겨 보존하고, 실패하면 되돌린다. 명령이 성공하기 전에는 앱을 다시 시작하지 않는다.

```bash
node --input-type=module - "<백업 파일 경로>" <<'NODE'
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync, statSync, constants } from 'node:fs';
import { join, resolve } from 'node:path';

const backup = resolve(process.argv[2] ?? '');
const expectedSchemaVersion = 5;
const expectedTables = [
  'schema_migration', 'workspace_scope', 'source_capture', 'report_input_snapshot',
  'backfill_batch', 'calculation_record', 'history_selection', 'report_document',
  'report_candidate', 'monthly_confirmation', 'monthly_head', 'idempotent_command',
  'backfill_step', 'batch_capture_slot', 'workbook_export', 'workbook_import',
  'correction_preview', 'correction_command', 'correction_draft',
  'correction_work_command', 'correction_resolution',
  'manual_entry_draft', 'manual_entry_command',
].sort();
const data = join(process.cwd(), 'data');
if (!existsSync(data)) mkdirSync(data, { mode: 0o700 });
if (!lstatSync(data).isDirectory() || lstatSync(data).isSymbolicLink() ||
    !existsSync(backup) || !lstatSync(backup).isFile() || lstatSync(backup).isSymbolicLink())
  throw Error('data 폴더 또는 백업 파일 확인 필요');
function inspect(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok' ||
        db.prepare('PRAGMA foreign_key_check').all().length ||
        db.prepare('PRAGMA user_version').get()?.user_version !== expectedSchemaVersion)
      throw Error('원장 무결성·스키마 검증 실패');
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name);
    if (JSON.stringify(names) !== JSON.stringify(expectedTables)) throw Error('원장 테이블 누락 또는 예상하지 않은 테이블');
    const migrations = db.prepare('SELECT version FROM schema_migration ORDER BY version').all().map(row => row.version);
    if (JSON.stringify(migrations) !== JSON.stringify([1, 2, 3, 4, 5])) throw Error('원장 migration 검증 실패');
    return names.map(name => ({ name, count: db.prepare(`SELECT count(*) AS n FROM ${name}`).get()?.n }));
  } finally { db.close(); }
}
const original = join(data, 'report-history.sqlite');
const staged = join(data, `.report-history-restore-${randomUUID()}.sqlite`);
const saved = join(data, `recovery-before-restore-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}-${randomUUID()}`);
mkdirSync(saved, { mode: 0o700 });
chmodSync(saved, 0o700);
const moved = [];
let installed = false;
try {
  copyFileSync(backup, staged, constants.COPYFILE_EXCL);
  chmodSync(staged, 0o600);
  const expected = inspect(staged);
  if (existsSync(staged + '-wal') && statSync(staged + '-wal').size !== 0) throw Error('복구용 복사본 WAL 확인 필요');
  for (const suffix of ['-wal', '-shm']) rmSync(staged + suffix, { force: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const from = original + suffix;
    if (!existsSync(from)) continue;
    if (!lstatSync(from).isFile() || lstatSync(from).isSymbolicLink()) throw Error('기존 원장 파일 확인 필요');
    const to = join(saved, `report-history.sqlite${suffix}`);
    renameSync(from, to);
    moved.push({ from, to });
  }
  renameSync(staged, original);
  installed = true;
  if (JSON.stringify(inspect(original)) !== JSON.stringify(expected)) throw Error('복구 건수 불일치');
  console.log('RESTORE_OK; 이전 원장 보존:', saved);
} catch (error) {
  if (installed) for (const suffix of ['', '-wal', '-shm']) {
    const from = original + suffix;
    if (existsSync(from)) renameSync(from, join(saved, `failed-restored.sqlite${suffix}`));
  }
  for (const { from, to } of moved.reverse()) renameSync(to, from);
  for (const suffix of ['', '-wal', '-shm']) rmSync(staged + suffix, { force: true });
  throw error;
}
NODE
```

복구 후 앱을 시작해 이전·최신 확정본의 문서·출처, 작성 중인 새 보고서와 보관된 수정안의 이어쓰기, 종료안의 읽기 전용 내용과 새 복사·재적용 대기 상태를 확인한다. 새 PC로 이전할 때는 **앱 시작 전에** 이 백업을 배치한다. 앱을 먼저 실행하면 새 빈 원장이 만들어지며, 원본 자금수지표나 과거 교환 XLSX만 가져와서는 확정 문서·초안·수정안·처리 이력 전체를 복원할 수 없다. 기존 원장 파일을 백업으로 대체하기 전에는 이전 원장과 WAL/SHM을 함께 보관한다. 백업의 시점 이후 기록은 복구본에 없으므로 복구 전 보존 폴더를 삭제하지 않는다.

현재 실행 파일은 지원하는 schema1~4 원장을 schema5로 자동 이관한다. schema4에서 schema5로의 이관은 기존 21개 테이블·31개 trigger와 보관 내용을 재작성하지 않고 `manual_entry_draft`, `manual_entry_command` 및 불변성 trigger 3개를 추가한다. 최종 테이블은 23개, trigger는 34개이며 migration 이력은 1~5다. 현재 저장소의 읽기 전용 모드는 schema1~5를 이관 없이 열 수 있지만 구버전에 없던 기능·자료를 만들어 주지는 않는다. schema4까지 지원하는 구형 실행 파일은 schema5 원장을 거부하므로 새 원장을 구형 앱으로 열어 운영하지 않는다.

위 백업·복구 명령은 **schema5 전용**이다. 구형 원장은 앱 업데이트 전에 해당 구버전의 백업 절차로 별도 보존하고, 구형 백업을 복구할 때도 그 버전의 검증 절차를 사용한 뒤 현재 앱에서 이관한다. 위 스크립트의 검사값만 낮춰 구형 백업을 통과시키지 않는다. 운영 스크립트의 무결성·외래키·스키마·23개 테이블 건수 확인은 모든 body/hash의 동일성을 증명하는 검사가 아니다. 합성 원장의 전체 행·trigger 비교 QA와 구분한다.

## ECOS 인증키

건설경기 인식 지수는 서버가 한국은행 ECOS Open API를 부른다. 키가 없으면 카드가
산출불가와 함께 "ECOS_API_KEY가 설정되지 않았습니다"를 보인다.

1. https://ecos.bok.or.kr/api/ → 서비스 이용 → 인증키 신청(무료, 즉시 발급).
2. 이 폴더의 `.env.local`에 한 줄을 넣는다. `.env*`는 커밋되지 않는다.

   ```
   ECOS_API_KEY=발급받은키
   ```

키는 서버(`src/app/api/_lib/composition.ts`)에서만 읽는다. `NEXT_PUBLIC_` 접두어를
붙이지 않는다 — 붙이면 브라우저 번들에 들어간다.

## 건설경기 인식 지수의 기준월

기준월 = 올린 최신 회차 − 2개월이다. 8월 기준(최신 회차 8월)이면 6월, 7월 기준이면 5월이다.
8월 기준은 5·7·8월 회차를 올린다 — 이 세 개로 모든 지표가 채워진다. 카드의 **건설경기 기준월** 선택 상자로 다른 달을 볼 수 있다. 회차를
새로 올리면 기본값으로 돌아간다. 회차 없이 API를 부르면 오늘이 속한 달 − 2개월이다. 유동성 Gap·적정 시재의 **Gap·시재 기준월**(기본값 최신 회차의
기준월)과는 따로 움직인다. 화면의 달은 모두 `YYYY/MM`으로 보인다.

고른 달의 값이 아직 없으면 이전 달로 옮기지 않고 산출불가와 사유(공표 전 / 조회
실패 / 필요한 회차)를 보인다. 건설·주택 통계는 익월 말에 수록되므로, 기준월이 아직
공표 전이면 그 지표들이 "공표 전"으로 나온다. 과거 달은 지금의 ECOS 값으로 계산하므로 당시 보고한
값과 다를 수 있다. ECOS 응답은 서버에서 10분 동안 재사용한다.

## 분양회수 예측오차 — 회차 두 개

분양회수 예측오차는 엑셀 `분양회수data` G·H열의 식으로 계산하되, 실적은 **최신 회차 한 장**에서 읽는다.

```
(t월 회차의 t−3~t−1월 실적 − t−3월 회차의 t−3~t−1월 계획) ÷ 같은 계획
8월 = (8월 회차의 5·6·7월 실적 − 5월 회차 5·6·7월 계획) ÷ 같은 계획   (엑셀 "2026/08" 행과 같은 창)
```

N월 기준(기준월 N−2)에는 N월 회차의 실적과 N−3월 회차의 계획을 쓴다 — **회차 두 개**면 된다.
엑셀 `위기단계`는 기준월에 한 달 앞 행(6월 지수에 "2026/07")을 써서 한 달 다르다.

값은 엑셀 H열과 조금 다를 수 있다. 엑셀 C열은 각 달 실적을 그 달 직후 회차에서 적어 두고
고치지 않지만, 여기서는 최신 회차에 적힌(뒤에 고쳐진) 실적을 쓴다. 8월 기준이면 23.35%, 엑셀은 24.11%다.

브라우저는 올린 자금수지표 원본을 읽어 계산에 필요한 입력을 서버에 보낸다. 원본 `.xlsx` 파일 자체는 서버에 업로드·저장하지 않는다. 외부 산출 때 계산 입력·원천 응답·산출 기록을 저장하고, 보고서 후보 준비에 성공하면 **정규화된 전체 회차 스냅샷**과 문서를 저장한다. 새로고침 후 현재 대시보드에서 새 산출을 하려면 원본 회차 파일을 다시 선택해야 한다. 이전에 확정한 보고서는 **월별 확정 이력**에서 다시 열 수 있다.

- 파일은 페이지 위쪽 **"자금수지표 회차"** 한 곳에서 여러 개를 한 번에 올린다. 가장 늦은
  회차가 최신 회차, 바로 전 달 회차가 이전 회차가 되고, 올린 회차 전부가 분양회수 이력에 들어간다.
- 고르면 바로 읽어, 산출 전에 지표마다 필요한 회차와 빠진 회차를 표로 보인다. 최신 회차가
  L이면 Gap·시재는 L, 대금 회수 위험은 L−1·L, 건설경기(기본 기준월 L−2)는 L−3(계획)·L(실적)이다.
- 1~3월 회차는 시트가 그해 1월부터라 전년 달 실적이 없다. 그 회차가 실적 회차인 달(기준월 전년 11월~1월)은
  산출불가다(구현 계획 R7에서 정한다).

1·2월 회차는 `잠정운영기준` 시트, 3월 회차부터는 `본운영반영` 시트를 읽는다.

### 엑셀 동등성 fixture

```bash
node scripts/extract-perception-fixtures.mjs "<3. 건설경기인식지수(2026).xlsx>"
```

이 추출 스크립트는 다음 세 CSV만 `fixtures/`에 만든다.

- `건설경기인식지수-원값.csv`: ECOS 9종 원값
- `분양회수-오차율-엑셀.csv`: 라벨을 보정한 분양회수 오차율
- `건설경기인식지수-엑셀결과.csv`: 엑셀의 지수·단계 결과

독립 기대값은 별도로 준비한다. 같은 정책·기준월에 대응하는 인계 자료의
`fixture_expected.csv`를 사람이 확인하여 `fixtures/건설경기인식지수-기대값.csv`로 둔다.
추출 스크립트는 이 네 번째 CSV를 만들지 않는다.
세 추출 CSV만 있으면 엑셀 원본 대조 두 건은 실행하고, 독립 기대값 대조 한 건만 건너뛴다.
독립 기대값은 앱의 계산 결과나 추출 CSV의 복사로 대체하지 않는다.

별도 인계 CSV가 없는 경우에도 앱 실행·보고서 생성·세 추출 CSV의 원본 대조는 가능하다.
독립 기대값 대조 한 건은 ‘추가 정답 자료 부재로 미검증’으로 남긴다. 이를 통과로 바꾸거나
CSV 확보를 앱 사용의 필수 조건으로 두지 않는다. 준비 점검 CLI의 exit 2는 전체 검증 입력이
갖춰지지 않았다는 뜻이며, 서버 실행 실패나 현재 실행 가능한 검증의 실패가 아니다.

분양회수 예측오차는 `fixtures/자금수지표`의 회차 파일로 계산하고, 실적을 직후 회차
값으로 바꿔 넣으면 엑셀 `분양회수data` H열과 같아지는지로 창을 검증한다.
앱은 `분양회수data` 시트를 읽지 않는다.

### 골든 입력 준비 상태와 실물 검증

앱 폴더에서 다음 명령으로 입력의 메타데이터 준비 상태를 확인한다.

```bash
npm run check:golden-inputs
```

CLI는 현재 작업 폴더를 기준으로 다음 고정 경로를 검사한다. 파일은 읽을 수 있는
비어 있지 않은 regular file이어야 한다.

| 검증군 | 메타데이터 준비 조건 |
|---|---|
| 최신 실물 판독 | `fixtures/자금수지표-최신회차.xlsx` |
| 회차 판독 | `fixtures/자금수지표/`에서 소문자 `.xlsx` 파일 1개 이상 |
| 분양회수 예측오차 | 같은 폴더의 소문자 `.xlsx` 파일 8개 이상 + `fixtures/분양회수-오차율-엑셀.csv` |
| 건설경기 엑셀 원본 대조 (`constructionWorkbook`) | 위의 세 추출 CSV |
| 건설경기 전체 동등성 (`constructionPerception`) | 위의 세 추출 CSV + 별도 `fixtures/건설경기인식지수-기대값.csv` |

회차 개수에는 디렉터리, 빈 파일, 읽을 수 없는 파일, 대문자 `.XLSX`를 넣지 않는다.
8개라는 개수만으로 기존 실물 테스트에 필요한 실제 연도·월별 회차 구성이 보장되지는 않는다.
JSON의 `rounds.compositionVerified`는 항상 `false`다.

출력 JSON에는 고정 필수 경로의 상태, 회차 개수, `validationGroups`별 `inputsReady`와
전체 `inputsReady`만 담는다. 실제 회차 파일명 목록·내용·수치·예외 원문은 출력하지 않는다.
경로 상태는 `ready`, `missing`, `empty`, `not-regular-file`, `not-directory`, `unreadable`,
`error`로 구분한다. 종료 코드는 전체 메타데이터 준비 시 0, 입력 미준비 시 2,
예기치 않은 메타데이터 오류 시 1이다. 자료가 없을 때 exit 2는 올바른 차단 결과다.
독립 기대값 CSV만 없으면 `constructionWorkbook.inputsReady`는 `true`,
`constructionPerception.inputsReady`와 전체 `inputsReady`는 `false`이며 exit 2다.
이 경우에도 엑셀 원본 대조 두 건은 실행할 수 있다.

이 명령의 `scope`는 `fixture-input-metadata`다. 파일 내용을 열거나 파싱하지 않으므로
손상 여부, CSV 헤더, 기준월, 정책, 수치 일치는 확인하지 않는다. `numericValidation`과
`pdfGoldenComparison`은 exit 0이어도 항상 `not-run`이다. KOFIA 실호출이나 실물 테스트를
실행하지 않으며, 네트워크 요청도 보내지 않는다.

실물 정답 검증은 담당자가 승인된 로컬 환경에서 다음 순서로 진행한다.

1. 비교할 PDF와 원본 엑셀의 보고월·기준월, 회차, 정책 버전, 외부 통계·금리의 관측 시점을
   맞춘다. 같은 월이라도 뒤에 수정된 엑셀 실적이나 현재 다시 조회한 통계는 당시 PDF와 다를 수 있다.
2. 최신 회차와 필요한 월별 원본을 위 경로에 두고, 세 CSV를 추출한 뒤 독립 기대값을 별도로 확인한다.
   `npm run check:golden-inputs`로 준비 상태를 확인하고 누락된 입력을 보완한다.
3. `npm run verify`와 `npm run lint`를 실행한다. 일반 verify는 타입과 자동 테스트를 확인하며,
   실물 자료가 없으면 관련 테스트를 건너뛴다. 일반 verify 통과만으로 실물 정답이 검증되지는 않는다.
   건설경기의 세 추출 CSV가 있으면 원본 대조 두 건이 실행되며, 독립 기대값이 없으면 그 대조 한 건만 건너뛴다.
   실물 테스트가 실행됐는지와 건너뛴 항목을 따로 확인한다.
4. 대응하는 원본을 앱에 올려 보고서를 생성하고, 각 지표의 기준월·출처·적용 정책과
   계산 결과를 원본 및 PDF와 항목별로 대조한다. 자동 fixture 테스트의 통과는 PDF 전체의
   수치·문구·페이지 구성이 같다는 보장이 아니다. 인쇄 결과도 사람이 별도로 확인한다.

원본·기대값·PDF와 추출 수치는 로컬에서 관리하고 커밋하거나 대화·이슈·공유 로그에 붙이지 않는다.
준비 점검 결과를 공유할 때도 고정 경로·상태·집계만 사용한다.

### 기존 계산식 동결과 스냅샷 비교

기존 계산식·가중치·임계값·판정 규칙은 변경하지 않는다. 엑셀은 특정 시점의 통계
스냅샷이고 ECOS는 현재 조회한 값이므로, 같은 기준월에도 입력과 결과가 달라질 수 있다.
골든 PDF와 맞추기 위한 수식 변경·가중치 재조정·임의 값 보정은 하지 않는다.

대조할 때는 동일 계산 경로에 스냅샷 입력과 실조회 입력을 각각 넣어 재현 여부를 확인한다.
기준월·업로드 회차·분양회수 예측오차를 고정하고 달라진 원천 입력만 교체하여 차이를
구분한다. 이 재현은 입력 차이의 영향을 확인하는 검사이며, 독립 정답 검증이나 모든 지표의
과거 개정 사유를 입증하는 검사가 아니다. 보고서의 두 금리·금리차·판정도 하나의 계산 결과로
연결되는지 확인하며, 원문 내부 불일치를 맞추기 위해 앱 계산식을 바꾸지 않는다.

검증 기록과 실제 자료·PDF 검수의 확인 범위는
[`docs/superpowers/plans/2026-10-21-report-history.md`](../docs/superpowers/plans/2026-10-21-report-history.md)의 §9에 있다.

## 조달위험 인식 지수 — 채권정보센터 금리

```
금리 차이 = 공사채 AAA 1년 − 국고채 1년   (나이스피앤아이·한국자산평가·KIS자산평가 3사 평균, %p)
0.24 미만 정상 · 0.52 미만 주의 · 0.79 미만 경고 · 0.79 이상 위기
```

판단월은 최신 회차의 달이고(대금 회수 위험과 같다), 금리는 그 전달 마지막 평가일 값이다.
8월 기준이면 7/31이다. 말일이 주말·휴일이면 그 전 평가일을 쓰고 화면에 밝힌다(5/31 일요일 → 5/29).

서버가 금융투자협회 채권정보센터(www.kofiabond.or.kr → 시가평가 → 채권시가평가수익률 → 기간별)의
내부 XML 서비스를 부른다. 인증키는 필요 없다. 공개 API가 아니어서 사이트가 바뀌면 깨질 수 있다 —
그러면 카드에 조회 실패 사유가 보인다. 응답 형식이 그대로인지는 실제 사이트를 부르는 확인 테스트로 본다.

```bash
KOFIA_LIVE=1 npx vitest run src/infrastructure/kofia
```

## 사내 데이터

`fixtures/`(자금수지표 회차, 엑셀 기대값)는 커밋하지 않는다.
이 파일이 있을 때만 도는 테스트가 있고, 없으면 건너뛴다.
