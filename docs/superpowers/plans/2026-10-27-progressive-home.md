# 홈·과거 자료 등록 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 승인된 Astryx 목업의 점진적 파일 등록과 독립적인 과거 원자료 등록을 실제 저장·검토·확정 흐름에 연결한다.

**Architecture:** 기존 파일 판독/reducer와 ManualEntrySession/생성·보관·재개 API를 재사용한다. domain/application/infrastructure/API/계산식/보고서 본문은 변경하지 않고 app/aifrm의 화면·클라이언트 조정만 한다. 월별 초안은 기존 SQLite에 보관되며 목업의 메모리 저장과 예시 산출은 옮기지 않는다.

**Tech Stack:** Node.js 26.12.1, Next.js 16.3.4, React 19, Astryx 0.5.4, Vitest.

**Spec:** 대화에서 승인된 목업 `/Users/dong-gyu/.codex/visualizations/2026/10/21/01a15bdd-6ba7-7072-93c3-2a7d0d43b29a/progressive-upload-mock/README.md`와 main.tsx/past-entry.tsx. 2026-10-27 사용자가 실제 반영 및 단계별 TDD·검토·QA·커밋·컨텍스트 정리를 명시 승인했다. 추가 승인 대기를 만들지 않는다.

## Global Constraints

- 기존 계산식과 리포트 템플릿은 절대 수정하지 않는다. domain/application/infrastructure/API와 보고서 모델/본문/SVG/CSS/서체/참고표는 시작 시점 해시로 보호한다.
- 실제 Astryx 컴포넌트와 토큰을 사용한다. 수작업 HTML 컨트롤·div/span 레이아웃·새 CSS·하드코딩 색상/내부 여백을 만들지 않는다.
- 월별 일반 흐름은 파일 선택→기준월 자동 판독→가능한 지표 산출→기존 보고서 검토→명시적 확정이다. 기준월 선택기를 업로드 전에 두지 않는다.
- 파일별 용도는 선택 전 펼쳐볼 수 있고, 선택 후에는 실제 부족한 기본 회차를 먼저 안내한다. 추이 보완은 선택 항목이다. ‘차트 기준 자세히’를 다시 만들지 않는다.
- 파일 추가는 기존 파일을 유지한다. 같은 회차 새 파일을 조용히 덮어쓰지 않으며 기존 중복 회차 판독 정책을 보존한다. 새 파일은 산출 전까지 기존 결과를 바꾸지 않는다.
- 과거 자료 등록은 홈/빈 이력에서도 독립 진입한다. 보고월 t→자금 기준회차 t+1을 유지하며 현재월·파일 유무로 막지 않는다. 실제 자료는 운영 담당자가 확인한다. 원자료 추정·0 채움·최종 지표 역산은 하지 않는다.
- 저장·검토·확정은 기존 CAS/멱등/오류/응답불명/충돌 의미를 유지한다. 저장 ACK 전 편집기 폐기나 다음 월 생성, 숨겨진 검토의 인쇄 소유권 유지를 허용하지 않는다.
- 업무 DB에는 QA 합성자료를 쓰지 않는다. 실행 중인 3002의 `.next`를 덮어쓰지 않고 별도 임시 앱에서 빌드/합성 QA 후 운영을 갱신한다.

## Review Focus

1. 파일 추가·제외·중복·판독 실패·선택 해제 후 기존 산출 원본과 결과가 보존되는가(H1).
2. 탭/보고서 이동 중 저장 실패·충돌·응답불명이면 현재 원값과 편집기를 유지하며 인쇄 host의 소유권이 맞는가(H2/H3).
3. 다음 월 기존 초안·확정월409·연말 이동·ACK 후 늦은 응답에서 다른 월 원값을 덮어쓰지 않는가(H2).
4. 접힌 자금 회차/기간이나 금리 참조값의 오류로 이동하면 해당 필드를 먼저 노출하고 초점을 맞추는가(H2).
5. 초기 0건·조회 실패·필터 결과0건을 구분하며 모바일/키보드/실제 HTML·PDF 경로에 기존 보고서 양식이 유지되는가(H1–H3).

## H1: 점진적 파일 등록

**Files:** src/app/aifrm/upload-panel.tsx(.test.tsx). 입력 합치기 보조 함수는 필요한 경우 같은 UI 모듈에 둔다.

**Interfaces:** 기존 UploadPanelProps(files,prepared,isApplied,onFilesChange,onSubmit)를 유지한다. onFilesChange에는 추가/제외 후 전체 File[]를 전달한다. 도메인 회차 판독/산출 계약은 변경하지 않는다.

- [x] RED: 선택 전 7회차 표가 접혀 있고 준비 안내를 열 수 있음; 8·7월 선택 후 5월(3개월 전) 부족 용도만 우선 노출; 기준월 자동 인식·연도 경계·단독 파일 부분 산출·판독 중/실패 상태 보존을 검증한다.
- [x] RED: 추가 선택이 기존 파일을 보존하고 정확히 같은 파일의 중복 선택을 늘리지 않으며 다른 파일의 동일 회차를 조용히 덮어쓰지 않음을 검증한다. 제외/전부 제외는 호출된 전체 배열로 확인한다.
- [x] GREEN: 실제 Astryx FileInput/List/Collapsible로 구현한다. 적용된 파일은 접어두되 미적용 선택/판독 실패가 숨지 않게 한다.
- [x] 검토·QA: 집중 테스트→타입/전체 테스트/린트, 보호 해시, 브라우저 준비 전·후/부분 산출/선택 복원을 확인한다.
- [x] 커밋 및 아래 진행 기록과 기존 UI 컨텍스트 문서 갱신.

## H2: 홈과 월별 과거 원자료 등록

**Files:** page.tsx, 필요한 home-workspace.tsx(.test.tsx), manual-entry-editor.tsx(.test.tsx), use-manual-entry.ts(.test.ts) 및 UI 보조 모듈. 필요 시 report-correction-editor.tsx의 외부 진입 표시만 조정한다.

**Interfaces:** Home workspace는 작성/보관 화면과 과거 등록 보조 진입을 제공한다. registerStart/registerNavigationGuard·ManualEntrySession.drain() 계약을 재사용한다. 자금 회차/기간 선택은 UI 상태이며 ManualEntryContentV1 구조를 바꾸지 않는다.

- [x] RED: 빈 홈의 주 작업은 업로드이고 빈 이력/외부 보완이 먼저 보이지 않음; 과거 등록은 파일/확정 이력 없이 실행 가능; 실제 저장 실패 시 화면 이동을 거부하는 행동을 검증한다.
- [x] RED: 자금 회차/기간을 바꿔도 원값을 유지하며 기존 숨겨진 오류 78/210개 순회·필드 초점 계약을 유지한다. 새 초안에서는 기준회차/기간이 새 reportCycle로 초기화되어야 한다.
- [x] RED: 임시보관은 drain만 사용해 미완성 원값을 보존한다. ACK 전에 다음 생성이 없고, 진행 중 이전 편집기는 잠기며 실패/unknown/409에서 이전 입력·동일 재시도 키가 유지된다. 다음 달 기존 초안 재개·12월→1월·연속 클릭 중복 방지를 검증한다.
- [x] GREEN: 화면의 라이트 Neutral 테마·목적지/보조 진입·편집 화면을 목업에 맞추고 실제 보관/재개를 연결한다. 기존 보고서 DocumentTheme/템플릿과 직접 입력 검토/확정/인쇄를 유지한다.
- [x] 검토·QA: 전체 회귀/타입/린트/보호 해시, 격리 앱에서 월별 작성→보관→새로고침→재개/다음 월/충돌/확정/인쇄를 검증한다.
- [x] 커밋 및 진행 기록/컨텍스트 갱신.

## H3: 전체 인수·운영 반영

**Files:** H1/H2에서 발견된 UI 결함 및 테스트, ai-frm/README.md, 기존 UI 컨텍스트 문서.

- [x] 전체 독립 검토. 중요한 발견은 실패 재현 테스트→수정→집중/전체 회귀로 해결한다.
- [x] 별도 앱에서 production webpack build와 합성 업무 흐름, 모바일·키보드·3쪽 보고서/차트/인쇄 host 및 PDF 경로를 확인한다. 보호 해시는 변경0이어야 한다.
- [x] 운영 DB online backup 후 기존 기록/무결성을 확인한다. 스키마 변경 없이 Node26.12.1 운영3002를 새 코드로 재시작하고 읽기/홈/진입만 확인한다. 합성 원본·키·DB·백업을 Git에 넣지 않는다.
- [x] 최종 커밋·컨텍스트 정리. 실제로 미검수한 항목과 기존 skip은 완료로 표시하지 않는다.

## 진행 기록

- 시작 HEAD: 225d36b, branch codex/aifrm-ui-ux, working tree clean. 기존 작업 브랜치를 재사용한다. 보호 manifest와 실행 로그는 /private/tmp에 보관한다.
- 사전 탐색: 실제 보관/재개/같은월 초안 재사용이 있으므로 새 도메인/DB/API가 필요 없다. 새 파일 선택은 기존 reducer의 commit 전 원본 보존을 따른다.
- H1 완료: RED9→GREEN16, 초기 정보량 보완 RED3→GREEN17. 인접 page 초기 기대값의 비활성 산출 버튼도 승인된 새 행동(초기 버튼 없음)에 맞춰 갱신했다. 최종 root verify 타입/1215 passed·기존2skip, 전체 lint 통과. 독립 리뷰 spec/quality 승인, 미해결 결함0. 보호83파일 변경0.
- H1 실제 QA: 새 임시 앱 `/private/tmp/aifrm-progressive-ui-qa-20261027-J2GcTS/app`의 loopback3005, 업무 env/DB 미복사. 실제 FileInput에서 합성8·7월 두 파일 선택→기준월8월/부족5월 안내→산출4완료·1불가, 적용 파일 접힘과100.0%/2133.3%/0.281%p 원래 표시를 확인했다. 초기 안내7회차 펼침도 확인했다. 선택 복원/중복/취소/정확한 제외는 실제 UI콜백과 reducer의 자동 회귀로 검증했다. Native 파일 선택기 대기가 길어 후속 QA에서는 기존 합성 초안 재개·공개 API·상태 테스트를 우선한다.
- H1 로그: `/private/tmp/aifrm-h1-{upload-red,upload-followup-red,upload-followup-green,root-verify,root-lint}.log`, 리뷰 `/private/tmp/aifrm-h1-review.md`, 브라우저 `/private/tmp/aifrm-h1-browser-qa.txt`. 단계 커밋 제목 `feat(ui): reveal upload guidance progressively`.
- H1 추가 실제 QA: 적용 파일 펼침→8월 제외(선택 기준월7월, 기존결과8월 유지)→7월도 제외(선택해제/원본보존 안내)→이전 결과로 돌아가기에서 원래 선택 접힘·미적용 안내 제거·4완료1불가·100.0%/2133.3%/0.281%p 표시를 확인했다.

- H2 완료: 실제 Neutral Astryx 홈을 보고서 작성/보관으로 나누고 과거 원자료 등록을 독립 진입으로 연결했다. 파일 전·판독 후·산출 후 정보량을 구분하고, 기존 산출 값/등급을 요약 표와 접힌 세부 내역에 표시한다. 한 ManualEntryControls owner가 입력/목록을 제공하며 전체 화면을 인쇄 제외 class로 감싸지 않는다. 보관 목록 재개도 ACK 뒤 입력 영역으로 이동한다.
- H2 TDD·검토: 수동 입력 회차/기간별6행, 원값 보존·임시보관·다음 달/기존 월 재개·연말·unknown 동일 키 및 외부 guard를 RED→GREEN으로 검증했다. 독립 리뷰에서 늦은 확정본 응답의 탭 덮어쓰기와 충돌 비교의 선택월 불일치를 재현해 수정했다. 정정 확정의 성공 handoff와 응답불명 시 owner 보존도 추가 회귀로 해결했다. picker 초점과 중첩 Astryx bleed는 공식 props로 보완했다. 최종 verify(타입 포함)1253 passed/기존2skip, 전체 lint/diffcheck 통과, 보호83파일 변경0.
- H2 실제 합성 QA: 격리3005에서 이력0→1월 작성(원값123.45)→임시보관→2월→1월 재개→새로고침/보관 목록 재개 값을 확인했다. 저장된8월 검토 문서 hash/JSON은 H2 전과 같고, 명시 확정 후 기존3쪽 보고서가 열렸다. 보고서→과거 등록의 문서/인쇄 상태 정리도 확인했다. SQLite 쓰기 실패 주입에서 변경 원값456.78 유지·이동차단, 같은 보관 요청 재확인 후 보관됨→홈 이동을 확인했다.390px에서 자금/경제 탭 문서 가로 넘침0·표 내부 스크롤, viewport 원복. 모든 fixture/DB는 임시 QA 전용이며 업무DB는 변경하지 않았다.
- H2 증거: /private/tmp/aifrm-h2-{manual-report,manual-review,correction-report,home-review}.md, root-final-{verify,lint}.log, late-response-{red,green}.log. 최초 root lint는 ref 선언 순서의 React 규칙 오류1건으로 실패했고 선언을 callback 위로 옮긴 후 재통과했다. 다음 H3는 최종 독립 검토/production build·인쇄/운영 백업·재시작·최종 안내다.

- H3 코드·검토 인수: 최종 독립 검토에서 copy/reapply의 명확4xx 뒤 미확인 명령 ref가 남아 이동이 막히는 문제와 종료unknown 뒤 명령 회복 경계를 RED5→수정했다. 명확 거절은 원안·오류를 유지하며 보류 명령만 해제하고, network/408/429/503은 원래 key/command로 재확인한다. 공통 배너가 동일 요청을 실행하므로 상세·확인창을 닫아도 결과를 확인할 수 있다. 요청 진행 중은 닫기 차단, settle된unknown은 검토 복귀를 허용하되 외부 이동은 ACK 전까지 차단한다. 최종 scoped77개(정정UI33+Session44)·독립 검토 중요 미해결0.
- H3 최종 자동 QA: release verify(타입 포함)1269passed/기존2skip, 전체lint 및 별도 실제소스 production webpack build 통과. 보호83파일 변경0. 단계 로그 /private/tmp/aifrm-h3-release-{verify,lint,build}.log, 최종 검토 /private/tmp/aifrm-h3-final-review.md. README를 새 홈·과거 등록/입력 중인 월·다음 달·파일 안내 흐름에 맞췄다.
- H3 실제 종료 복구 QA: 격리3005에서 합성 수정 원값/사유 저장→ACK후 목록 복귀를 확인했다. correction_resolution INSERT 실패 주입에서 종료503 뒤 기록0 유지→원요청 재확인 ACK로1건 생성, 두 번째 실패에서도 기존1건 유지→확인창 닫기/배너유지/홈이동차단→원요청 재확인 후2건/홈정상 이동을 확인했다. 주입trigger는 제거했으며 업무 원장은 사용하지 않았다.
- H3 PDF 인수: 실제소스 production3006의 합성7월 검토 보고서를 nativeChrome에서 PDF 저장했다. 868714bytes/3A4, 독립 검수자가3쪽 전체 PNG를 확인해 올바른7월 제목/페이지1·2·3/5차트/두원본참고표·잘림/앱버튼혼입없음을 통과했다. 증거 progressive-home-qa-20261027/synthetic-past-review-202607.pdf, /private/tmp/aifrm-h3-pdf-review.md. 수치의 독립 기대값·골든셋 픽셀동등성을 새 입증한 것은 아니다.
- H3 운영 준비: 업무23테이블/schema5의 행hash·schema/triggerhash를 읽기 전용으로 보관하고 README 원문 online backup을 실행해 전체 동일함·integrityok/FK0을 확인했다. data/backups 내부의 백업은 Git 제외이며 실제값/키를 로그·fixture로 내보내지 않았다. 로컬3002 재시작 및 최종 기록 비교는 다음에 수행한다.

- H3 운영 반영 완료: 코드 커밋8fc6bd5의 최종 실제소스 빌드를 원래 app/.next에 설치하고 Node26.12.1 production을127.0.0.1:3002(PID92293)에 재시작했다. 이전 빌드는 임시 staging의 previous-next에 보존해 rollback 가능하다. 첫 preflight에서 마지막 테스트 파일1개의 staging 불일치가 발견되어 서버를 내리지 않고 동기화/전체verify1269pass·2skip 재통과 후 설치했다. 실제 제품코드·빌드는 이미 일치했고 새 계산/템플릿 수정은 없었다.
- 운영 QA: 실제 홈·과거 등록 진입/제목초점·보고서 작성 복귀를 확인하고 생성/수정/확정은 실행하지 않았다. 홈과 두 읽기API200, 이력API no-store, 실제 서버 실행 바이너리v26.12.1 확인. 최초 수동 probe의 목록 query에 limit가 없어422를 받았으며 실제client와 같은 ?limit=12로 교정해200을 확인했다. 기존 strict API 검증은 완화하지 않았다.
- 운영 원장 보존: 재시작/실제 UI 확인 후 모든23테이블의 전체행 hash·schema/triggerhash가 직전/온라인백업과 동일, schema5/integrityok/FK0. 합성자료를 업무DB에 만들지 않았다. 비밀값·DB·백업·PDF fixture는 Git에 추가하지 않았다. 보호83파일 SHA변경0이며 source/domain/application/infrastructure/API/리포트모델·본문·차트·CSS·서체·참고표도 그대로다.
- 종료 컨텍스트: H1(b24c7f2)→H2(cf7653e)→H3복구보완(8fc6bd5) 순서로 TDD/검토/QA/단계커밋을 완료했고 본 기록은 별도 최종문서 커밋에 포함한다. 현재 요청 범위의 필수 구현·QA·로컬반영은 완료다. 기존2skip(독립 기대값CSV 미보유/opt-in KOFIA live)은 유지하며 새로 통과 처리하지 않았다. 외부공개/Tunnel·push·merge는 이번 요청으로 실행하지 않았다. 실제 새 홈을 사용자 브라우저에 열어두었으며 증거는 progressive-home-qa-20261027/local-product-home-final.png.
