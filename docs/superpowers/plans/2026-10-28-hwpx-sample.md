# HWPX 샘플 생성과 3쪽 보고서 비교

> **현재 상태 정정:** 사용자가 확인한 실제 경로는 **네이버 MYBOX → HWPX 열기 → 인쇄/PDF 저장**이다. 반환된 `test_report.pdf`는 4쪽이며 겹침·넘침이 있어 이전 샘플은 이 경로의 호환성 **불합격**이다. 아래 완료 기록은 로컬 샘플 실험의 이력이며 배포 가능한 HWPX의 인수 완료를 뜻하지 않는다. 대응 계획은 아래의 2026-10-29 실행 기준 1~7단계를 따른다.

사용자 승인 범위는 HWPX 샘플을 먼저 만들고 기존 3쪽 보고서와 비교 검증하는 것이다. 웹 다운로드 버튼 추가는 이 단계에 포함하지 않는다. 기존 계산식·HTML/PDF 템플릿·앱 소스·의존성은 변경하지 않는다.

기준은 기존 합성 2026/08 확정 문서 JSON과 동일 문서의 PDF다. 업무 원장·환경변수·실제 금융 자료를 샘플로 내보내거나 외부 변환 서비스에 업로드하지 않는다. 앱 소스·정적 자산·주요 설정 205개 파일의 SHA를 별도 보관해 변경 여부를 확인한다.

- [x] 기존 표시 문구와 3쪽 구성을 기준으로 편집 가능한 문단·요약표, 기존 차트 5개·참고표 2개를 포함한 HWPX 샘플을 생성한다. 생성기는 앱과 분리하며 유효한 빈 HWPX 기반 파일의 출처·라이선스·해시를 기록한다.
- [x] TDD로 ZIP/XML·manifest·ID 참조·이미지 누락·본문 및 수치 동일성·원본 불변성을 검증한다.
- [x] 별도 HWPX 렌더러로 파일을 실제 해석하고 페이지 수와 3쪽별 배치·잘림·문자·이미지를 비교한다. XML이나 직접 만든 HTML만으로 렌더 성공을 주장하지 않는다.
- [x] 샘플과 비교 증거·검증 결과를 제공하고 실제 한글 프로그램에서 아직 확인하지 못한 항목이 있으면 명시한다. 현재 Mac에는 한글 프로그램이 없다.

샘플에서 확인한 한계와 다음 구현 접점을 기록한다. 샘플 파일과 렌더 도구는 visualizations 또는 임시 폴더에 보관하며, 기존 업무 DB와 실행 중인 3002 서버는 유지한다.


## 2026-10-28 샘플 단계 완료 기록

- 신규 로컬 CLI만 `ai-frm/scripts/hwpx-sample/`에 추가했다. 입력은 기존 합성 2026/08 `FinancialReport`와 PDF에서 읽은 줄 위치이며, 본문을 이미지화하지 않고 native 문단 35개·차트5/참고표2 PNG·장식 벡터4개로 직렬화한다. 원본 빈 패키지는 Apache-2.0 python-hwpx6.10.0의 Skeleton이며 출처·wheel/blank SHA와 라이선스를 포함했다.
- TDD: 최초 구조·본문·그림·멱등 직렬화 RED→GREEN, 시각 실패를 계기로 span별 단락을 줄 단위 styled runs와 실제 문단 여백/간격으로 변경했다. geometry·테두리·중복 본문 차단 회귀까지 최종9개 통과. 독립 리뷰에서 중복 제목도 포함검사를 통과하는 P2를 재현하고 페이지별 전체 정규화 본문 equality로 해결했다. 중요 미해결 코드 결함0.
- 독립 패키지/스키마: python-hwpx6.10.0으로 최종파일을 개방해 packageIssues0/documentIssues0,35문단/7그림 확인. 루트 별도 검사11항목 통과. 현재 생성기로 /tmp에 재생성한 파일도 바이트 동일했다.
- 실제 렌더: MIT npm `@rhwp/core@0.8.7` WASM과 직접 작성한 wasmtime host가 최종 HWPX를 읽어 A4 3쪽 SVG를 생성했다. 이전 구형 엔진의 이미지 placeholder와 첫 span 기반 본문 겹침은 통과로 처리하지 않고 수정/재렌더했다. 최종본의 차트5·참고표2·장식4·본문 흐름/쪽수/잘림·겹침을 독립 검토자와 root가 확인했다.
- 시각 비교로 발견한 요약 판정 색·굵기와 박스 테두리는 기존 HTML/CSS의 표현대로 신규 샘플에 반영했다. PDF Type3 글리프에서 추출할 때 색이 검정으로만 보고된 문제였으며 기존 템플릿을 수정한 것은 아니다. 서체 대체에 따른 글자 모양·굵기·자간 차이는 남는다. 픽셀 동등성을 주장하지 않는다.
- PNG 미리보기만 로컬 Apple SD Gothic Neo와 U2212 minus의 Arial fallback을 사용했다. 엔진 원본 SVG·HWPX의 문구를 바꾸거나 글꼴 파일을 배포하지 않았다. pyhwpxlib의 비상용 코어나 bridge는 최종 렌더에 사용하지 않았고 앱 의존성에도 추가하지 않았다.
- 원본 보호: 앱 소스·정적 자산·주요 설정205파일 SHA 변경0. 기존 계산식/리포트 양식/앱 dependency/API/업무 원장은 그대로다. 기존 앱 verify 타입 포함1,275 passed/기존2skipped. 샘플 생성기 밖의 제품 코드는 변경하지 않았으며 실제 3002 서버도 재시작하지 않았다.
- 산출물은 visualizations의 `hwpx-sample-20261028/`에 보관했다: `sample-report.hwpx`, `comparison.pdf`, `comparison-page-1~3.png`, `verification-report.md`, 입력JSON·원본PDF·독립파서/렌더manifest. 최종 HWPX SHA `ba96596d68319fa8058b082705bdfbfd184ab567c68401c23b0111047f174010`.
- 로그/검토: `/private/tmp/aifrm-hwpx-*{red,green}.log`, `aifrm-hwpx-final-tests.log`, `aifrm-hwpx-independent-code-review.md`, `aifrm-hwpx-regression.log`. 공개 패키지 설치의 자동 승인 검토가 한 번 시간 초과되어 허용된 단일 재시도로 설치를 완료했다. 작업이 승인 대기 상태로 남은 것은 아니다.

## 다음 단계와 확인 경계

이 요청의 샘플 생성과 기존 3쪽 문서 비교 결과 제공은 완료했다. 실제 한컴 한글 프로그램에서 열기·조판·본문 편집·재저장은 아직 검증하지 못했다. 샘플용 PDF 줄 좌표를 사용하는 도구이므로 범용 웹 내보내기 완성으로 취급하지 않는다. 실제 한글 확인, 다른 기준월·결측/긴 문장의 레이아웃 검증을 거친 뒤 공통 보고서 도구에 다운로드 버튼을 연결하는 단계가 남는다. 해당 버튼·라우트·다운로드 UI는 이번 샘플 단계에서 추가하지 않았다.


# HWPX 호환성 복구 구현 계획 — 2026-10-29 실행 기준

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 또는 superpowers:executing-plans. 이 절은 이전 R0–R5와 모듈 분해 보완을 통합한 최신 실행 계획이다. 단계마다 TDD·독립 검토·QA·커밋·컨텍스트 기록을 남긴다. 사용자가 단계별 실행을 승인했으며 아래 실행 기록을 이어 쓴다.

**Goal:** 기존 계산·리포트 양식을 유지한 편집 가능한 HWPX를 생성하고, **네이버 MYBOX에서 열기→인쇄/PDF 저장**한 결과가 정상 3쪽임을 입증한다.

**Architecture:** 계산 완료 `FinancialReport`를 읽기 전용으로 받아 의미 단위 문서를 만들고, 검증한 HWPX 전용 기준 구조에 채운 뒤 패키지 검증·원자 저장으로 내보낸다. PDF 줄 좌표 역산은 제거한다. 작은 문서의 MYBOX 검증이 끝난 뒤 전체 3쪽 투영을 구현하고, 웹 연결은 최종 샘플 인수 이후에 진행한다.

**Tech Stack:** 샘플은 Python 표준 XML/ZIP·기존 Apache-2.0 빈 패키지 기반, 앱은 기존 Node26.12.1·Next.js·React·Astryx. 독립 파서/RHWP는 보조 검사다. 스킬과 외부 구현은 버전·라이선스를 확인한 원칙/허용된 최소 코드만 참고한다.

**Spec:** 사용자의 HWPX 채택·기존 계산식/템플릿 변경 금지·샘플 우선·MYBOX 경로 확인·작은 단위 테스트·2026-10-29 구현 계획 요청. 실패 증거는 `/Users/dong-gyu/Downloads/test_report.pdf`; 원래3쪽 PDF/문서JSON/5 Whys 진단은 visualizations `hwpx-sample-20261028/`에 있다.

## Global Constraints

- 기존 계산식·정책·판정·보고서 모델·HTML/PDF 본문/서체/CSS/차트/참고표·DB/확정 이력을 변경하지 않는다. 내보내기에서는 금융값을 재계산·재반올림하지 않는다.
- 기존 본문은 편집 가능한 native 문단으로, 차트5·원본 참고표2는 자체 포함 이미지로 제공한다. 전체 쪽을 이미지로 바꾸지 않는다.
- PDF 한 줄=한 문단, 상대 문단 간격의 절대좌표 역산, 페이지 첫 문단에 모든 개체를 고정하는 실패 설계를 재사용하지 않는다. 줄 좌표 캐시를 직접 작성해 양식을 맞추지 않는다.
- 제목·설명·산식·차트를 같은 흐름의 지표 그룹으로 구성한다. 세 쪽의 의미 구분을 유지하며, 정상 기준 결과는 A4 3쪽·그림/본문 보존·잘림/겹침 없음이 필수다.
- 쪽 수만 맞추려고 자동 요약·수치 축약·본문 삭제·강제 축소하지 않는다. 임의 장문 편집 후에도 무조건3쪽이라는 보장은 하지 않는다. 정상적인 분량 증가와 원치 않은 빈 쪽/겹침을 구분한다.
- 실제 자료 대신 합성 fixture로 QA한다. MYBOX 접근이 없으면 사용자 반환 PDF를 기다리고 해당 검증을 `not_run`으로 기록한다. 독립 렌더 통과로 대신하지 않는다.
- 본문 구조 검사, 패키지 검사, 렌더, 육안 검토, MYBOX 확인은 각각 상태/입력해시/도구버전/출력해시를 기록한다. 미검증 후보는 검증 완료 파일로 소개하지 않는다.
- 제품 앱은 1~5단계에서 수정하지 않는다. 6단계는 화면의 출력 도구만 변경하며 기존 문서 본문/인쇄는 유지한다. 상시 Python subprocess를 웹 실행 의존성으로 자동 채택하지 않는다.

## Review Focus

1. 글꼴 대체·두 줄 문장·기호가 문단 높이를 바꿔 그림과 겹침 → 3단계 최소 MYBOX probe와 5단계 변형 QA.
2. 명시적 쪽 나누기2개는 있어도 자동 넘침으로 빈4쪽이 생김 → 4·5단계 실제 반환PDF 전쪽 검토.
3. 결측·0·음수·순유입·긴 사유에서 값/본문을 잃거나 재계산함 → 4단계 투영 단위 테스트와 내용 비교.
4. 교체된 그림·스타일 참조가 깨지거나 저장 실패가 정상 파일을 덮어씀 → 2단계 패키지/원자 저장 및 3단계 XML 검사.
5. 수동 입력의 숨긴 인쇄 host와 보이는 문서가 중복 내보내거나 다른 문서를 다운로드함 → 6단계 명시적 콜백/문서 소유권 회귀.

## 파일별 책임과 함수 계약

기본 경로는 `ai-frm/scripts/hwpx-sample/`다. 기존 파일을 편집하고 새 책임 모듈3개만 추가한다. 테스트4개는 각 책임 옆에 둔다. 파일 수 자체를 목표로 삼지 않는다.

| 파일 | 책임·공개 함수 | 단위 테스트 |
|---|---|---|
| `report_projection.py` (신규) | `project_report(report: Mapping[str, object]) -> ReportDocument`. 불변 문서형 `ReportDocument`, `PageSpec`, `TextBlock`, `MetricBlock`, `ImageBlock`도 이 파일에 정의 | `test_report_projection.py` (신규) |
| `document_xml.py` (신규) | `build_parts(document: ReportDocument, template: Mapping[str, bytes], assets: Mapping[str, bytes]) -> dict[str, bytes]`. 의미 단위 문단/그림을 XML 부품으로 구성 | `test_document_xml.py` (신규) |
| `package_io.py` (신규) | `read_package(payload: bytes) -> dict[str, bytes]`, `validate_parts(parts) -> tuple[PackageIssue, ...]`, `build_package(parts) -> bytes`, `write_atomic(path: Path, payload: bytes) -> None` | `test_package_io.py` (신규) |
| `generate_sample.py` (편집) | CLI의 JSON/자산 읽기→투영→XML→검증→후보 저장만 조정. `--report`, `--assets`, `--output`, `--mode probe-text/probe-image/probe-table/report` | 기존 `test_generate_sample.py`를 CLI·통합 테스트로 변경 |

- `ReportDocument`는 reportMonth·generatedOn과 순서 있는 `PageSpec`을 갖고 각 쪽은 block tuple이다. `MetricBlock`은 표시 title/value/status/narrative/basis/formula/image_role을 보존한다. PDF x/y·행별 문장은 계약에 넣지 않는다.
- probe는 같은 불변 block형으로 CLI 내부의 고정 합성 예제를 조립한다. 전체5개 지표·7개 그림을 요구하는 `project_report`와 구분한다. XML/ZIP 계층은 probe의 그림1개도 지원한다.
- core는 파일경로·DB·네트워크를 모르고 `Mapping[str, bytes]`를 받는다. 파일 I/O는 CLI 읽기와 `write_atomic`에만 둔다. 단일 저장 경로는 저장 전 payload를 다시 열어 검증하여 우회 쓰기를 막는다.
- `PackageIssue`는 part/code/message의 불변 자료형으로 `package_io.py`에 정의한다. 문서형/함수 이름을 이후 단계에서 그대로 사용한다.

## 1단계: 실패 fixture와 보호 기준 고정

**Files:** 이 문서·샘플 README·기존 provenance. 합성 input/원본3쪽/실패4쪽은 visualizations에 보존하고 업무 자료를 테스트 폴더에 넣지 않는다.

- [x] 기존 실패 HWPX·반환PDF·원본PDF의 SHA와 MYBOX의 실제 글꼴/인쇄 설정을 evidence manifest에 기록한다. 실패 증거를 정상 golden으로 사용하지 않는다.
- [x] 실행 시작 HEAD와 보호 파일 SHA를 새로 기록한다. 기존205개 목록을 참고하고 제품 파일의 변경0을 확인한다.
- [x] 위 참고 스킬의 정확한 source/version/license와 차용·제외 범위를 기록한다. 설치/대량 코드복사 없이 원칙부터 적용한다.
- [x] 기존9개 테스트를 실행해 기준 상태를 기록한다. 구현을 따라 위치 숫자만 검사하는 테스트는 이후 대체하고 본문/참조/이미지 보존 검사는 살린다.
- [x] 검토·QA·컨텍스트 기록 후 커밋: `docs(qa): pin MYBOX failure and HWPX acceptance contract`.

## 2단계: 패키징과 저장 분리 — 일반 무결성만 먼저 보장

**Files:** `package_io.py`, `test_package_io.py`, 기존 생성기의 패키징/저장 호출부.

- [x] RED: `test_rejects_missing_part_and_broken_reference`, `test_rejects_duplicate_entries_and_corrupt_crc`, `test_preserves_existing_output_on_validation_or_replace_failure`를 먼저 작성한다. 실패가 실제 미구현 기능 때문인지 실행 로그로 확인한다.
- [x] GREEN: XML/manifest/spine·이미지/스타일 참조 검사와 무압축 첫 MIME 엔트리, 고정 메타데이터의 결정적 ZIP을 구현한다. 실패 payload는 최종 경로를 바꾸지 않는다.
- [x] 기존 원본 bytes/이미지SHA 불변, 같은 입력의 반복 결과, PNG 누락, `os.replace` 실패를 검증한다. 입력 경로를 아는 CLI/생성기에서 output과 템플릿·JSON·이미지의 resolve/samefile 충돌을 차단한다. package_io에 입력 경로 지식을 넣지 않는다. ZIP 읽기는 CRC/중복 파일명을 검사한다.
- [x] Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/hwpx-sample -p 'test_package_io.py' -v` (cwd `ai-frm`). 전체 PASS가 기준이다. 통과를 페이지 호환성으로 표현하지 않는다.
- [x] 독립 검토·생성기 관련 회귀·커밋·컨텍스트 기록. 커밋: `refactor(hwpx): isolate package validation and atomic output`.

## 3단계: 의미 문서형·최소 XML probe와 MYBOX 첫 gate

**Files:** `report_projection.py`의 불변 자료형만 우선 정의; `document_xml.py`, `test_document_xml.py`, CLI probe모드·테스트. 전체 보고서 projection은 아직 구현하지 않는다.

- [x] RED: 텍스트/runs 순서·`& < >`/한글/`× ÷ − Σ` 보존, 잘못된 스타일/이미지 ID 거부, 의미 블록의 본문 완전 일치·역할 중복/그림 누락 거부, 그림 삽입 전후 본문 불변 테스트를 작성한다. placeholder 엔진은 추가하지 않는다.
- [x] GREEN: 유효 빈 패키지에서 제목·날짜·두 줄 본문·산식의 작은 native 문서를 만든다. 포인트/밀리미터 변환은 순수 함수에 집중시켜 `1pt=100HWPUNIT`, `25.4mm=7200HWPUNIT`을 검사한다.
- [x] `probe-text`→`probe-image`(기존 차트1개 inline)→`probe-table`(요약 TextBlock을 배경/테두리 있는 한 셀 표로 표현)의 순서로 생성한다. 범용 표 모델은 추가하지 않는다. 본문/차트를 같은 흐름에 둔다. 수작업 줄 좌표 캐시나 PDF 역산 fallback은 허용하지 않는다.
- [ ] MYBOX에서 각 최종 파일을 열어 인쇄/PDF 저장하고 예상 쪽수·문구/그림 보존·잘림/겹침 없음·정상 줄바꿈을 확인한다. 편집 기능이 제공되는 환경이면 짧은 수정→저장→재열기도 수행한다.
- [ ] 첫 어긋남이 생기는 probe에서 원인을 고친다. 결과가 없거나 실패면 전체3쪽으로 넘어가지 않는다. 유효한 원본 HWPX가 이미 있다고 가정하지 않으며 이 과정의 성공 구조를 HWPX 전용 기준으로 고정한다.
- [x] Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/hwpx-sample -v`. 단위/통합 PASS와 MYBOX gate의 실제 증거가 모두 필요하다.
- [ ] 검토·QA·커밋·컨텍스트 기록. 커밋: `feat(hwpx): establish MYBOX-verified document flow`.

## 4단계: 계산 완료 데이터 투영과 전체3쪽 생성

**Files:** `report_projection.py`의 `project_report`, `test_report_projection.py`; 검증한 XML 구성·기준 양식·CLI·기존 테스트를 필요한 만큼 확장한다.

- [ ] RED: `test_projection_preserves_all_display_values_and_input`, `test_projection_distinguishes_zero_negative_missing_and_net_inflow`, `test_projection_rejects_duplicate_or_missing_metric`, `test_projection_preserves_print_text_and_excludes_hidden_details`를 작성한다. 독립적인 기대 문구/순서를 fixture에 명시한다.
- [ ] GREEN: 기존 `FinancialReport`만 읽어 1쪽 종합·회수·Gap / 2쪽 건설경기·조달위험·적정시재 / 3쪽 원본 참고표를 구성한다. 기존 출력의 긴 사유 축약 규칙 외에 새 문구 수정/요약을 하지 않는다.
- [ ] 제목·설명·산식·차트는 지표 단위로 연결하고 쪽 경계와 정상 쪽번호/바닥글을 사용한다. 이미지7개는 role→bytes로 전달하고 참고표 원본 hash를 검사한다. 기존 금융값 계산 모듈은 import하지 않는다.
- [ ] CLI report모드는 JSON→투영→XML→패키지→독립 파서 재개방으로 통합 테스트한다. PDF 줄 좌표 `--layout` 계약과 legacy 생성 fallback을 제거한다. 실패 파일은 별도 증거로 보존한다.
- [ ] 실제 MYBOX 반환 PDF의 전체3쪽을 원본과 비교한다. 제목·판정·문구·7개 이미지·파란 선/요약 박스·기호·쪽번호가 유지되고 겹침/잘림이 없어야 한다. RHWP는 보조 증거다.
- [ ] 모든 단위/통합 테스트·보호 hash·독립 검토를 확인하고 커밋: `feat(hwpx): compose the original three-page report from saved values`.

## 5단계: 변형 자료·재저장 회귀와 샘플 인수

**Files:** 세 책임별 테스트·CLI 통합 테스트·합성 fixture·검증 manifest와 README. 제품 코드 변경 없음.

- [ ] 정상월/연말·연초,0·음수·순유입,일부/전체 산출 불가·긴 사유,빈/한 점/18개월 차트·긴 축 라벨·대체 글꼴을 포함한다.
- [ ] 자동 단위 테스트는 본문/수치·순서·이미지·참조·불변성과 저장 실패 복구를, 실제 MYBOX QA는 쪽수·겹침·잘림·그림 가독성을 검사한다. 자동 테스트만 통과하면 `mybox=not_run`이다.
- [ ] 기본 생성 범위는 실제3쪽을 유지해야 한다. 사용자 임의 장문 편집으로 내용이 늘면 정상적인 추가쪽은 구분하되 본문 삭제·강제 축소로 통과시키지 않는다. 편집 불가능한 뷰어 경로면 편집 검증은 미수행으로 명시한다.
- [ ] HWPX hash→MYBOX 변환PDF hash→전쪽PNG→검토 결과를 연결한다. 반환PDF가 통짜 이미지일 경우 HWPX 내용 검사와 시각 비교를 함께 사용한다. PDF 텍스트 추출이 비었다는 사실만으로 내용 누락이라고 판정하지 않는다.
- [ ] 최종 독립 검토 후 샘플·비교PDF·통과/미검증 환경을 제공한다. 커밋: `test(hwpx): cover report variations and MYBOX round trips`. 6단계는 이 인수가 끝나야 착수한다.

## 6단계: 웹용 변환 경계와 다운로드 도구

**Files:** 신규 `ai-frm/src/app/aifrm/report-hwpx-export.ts`·`.test.ts`, 필요 시 `report-hwpx-assets.ts`·`.test.ts`. `report-preview.tsx`의 출력 도구·props만 최소 변경, `page.tsx`와 `manual-entry-editor.tsx`의 보이는 문서 소유자에서 콜백 연결. 인쇄 host에는 연결하지 않는다.

**Interfaces:** `exportReportHwpx(report: FinancialReport, assets: ReportHwpxAssets): Promise<Blob>`. `ReportHwpxAssets`는 검증한 이미지7개의 role/bytes 계약이며 exporter 파일에서 정의한다. 공통 미리보기는 선택적 `onDownloadHwpx?: () => void`, `isDownloadingHwpx?: boolean`(기본 false), `hwpxDownloadError?: string | null`(기본 null)을 받는다. 콜백이 없으면 해당 도구를 표시하지 않는다. 진행/실패 상태는 보이는 문서 소유자가 관리하며 재시도도 같은 명시적 콜백을 사용한다.

- [ ] RED: 업로드 결과·직접 입력 검토·저장된 확정본 각각의 클릭 시점 표시 문서가 그대로 내보내짐, 새 계산/확정/저장 API 호출 없음, 중복 클릭 제어, 실패 재시도, 숨긴 print host에 버튼/내보내기 없음을 검사한다.
- [ ] GREEN: 샘플에서 검증한 의미 문서/스타일·패키지 계약을 Node/브라우저 환경으로 옮긴다. 패키지 선정이 필요하면 버전/라이선스를 검토·고정하고 동일 합성 fixture/내용·이미지 hash를 재검증한다. Python 내부 구현을 무조건 복제하거나 상시 subprocess로 실행하지 않는다.
- [ ] 자산 어댑터는 기존 `ReportChart` 표현과 문서 테마를 재사용해 독립 이미지로 만들고, CSS 변수·외부 리소스가 남지 않게 한다. 샘플용 PDF 차트 클립을 실제 다른 월의 다운로드에 재사용하지 않는다. 차트의 산식·표현 정책은 변경하지 않는다.
- [ ] 클릭 시 문서/자산을 고정해 다른 월로 화면이 바뀌어도 다른 결과를 섞지 않는다. mount/effect나 인쇄 portal 생성으로 다운로드를 실행하지 않는다. 명시 클릭만 처리한다.
- [ ] Astryx 출력 도구만 추가하고 기존 PDF/인쇄와 보고서 본문은 유지한다. 실패 시 부분파일을 성공으로 제공하지 않는다. 다운로드는 보고서 확정과 별개다.
- [ ] 웹에서 내려받은 최종 파일로 MYBOX 전체 QA를 반복한다. Python 샘플에서의 성공이 이식 후 성공을 의미하지 않는다. `npm run verify`, `npm run lint`, 격리 production 빌드·기존 PDF 회귀를 수행한다.
- [ ] 독립 검토·단계 커밋: `feat(report): add verified HWPX download controls`. 본문/계산 보호 hash와 출력 도구의 허용 변경을 구분해 기록한다.

## 7단계: 운영 반영과 인계

- [ ] 업무 DB/env가 없는 격리 앱에서 확인하고, 업무 원장에 합성 자료를 만들지 않는다.
- [ ] 기존 절차대로 업무 원장 백업·전후 hash·빌드 원본 대조 후 Node26.12.1 로컬 서버를 갱신하고 HTTP·다운로드를 확인한다.
- [ ] 최종 원본 HWPX·MYBOX 반환PDF·비교 결과·계산/템플릿 불변 증거·커밋·남은 미검증 환경·재개 지점을 문서화한다.
- [ ] 문서/컨텍스트 커밋: `docs(qa): record HWPX rollout and acceptance evidence`. MYBOX 필수 gate가 미검증이면 완료로 보고하지 않는다.

## 단계별 공통 검증·테스트 구분

- 순서: **실패 테스트 확인→최소 구현→단위/통합 QA→독립 검토→해당 단계의 MYBOX 반환 검증→커밋→컨텍스트 기록**.
- 단위 테스트는 함수의 계약과 원본 보존을, 통합 테스트는 실제 파일 생성·재개방을, MYBOX는 실제 레이아웃 호환성을 검증한다. 서로 대체하지 않는다.
- 기존 9개 중 유효한 보존/참조 검사는 이동하고, PDF 위치나 FIXED 속성 존재만 검사하는 테스트는 실패한 설계를 고착시키므로 대체한다. 테스트 개수/줄 수를 완료 기준으로 사용하지 않는다.
- 실제 한컴 데스크톱 지원을 주장하려면 해당 버전·OS를 별도로 시험한다. 이번 MYBOX 결과를 모든 한글 프로그램의 호환성으로 확대하지 않는다.

## 참고 스킬 조사 기록


2026-10-29 공개 저장소·SKILL.md를 직접 읽었다. skills.sh 목록도 확인했으나 후보별 검증 가능한 설치 수는 확보하지 못했다. GitHub 별/포크는 관심·재사용의 보조 지표이며 실사용량·호환성 품질을 뜻하지 않는다.

| 참고 사례 | 확인한 공개 지표 | 우리 코드에 반영할 원칙 | 적용하지 않을 부분 |
|---|---|---|---|
| [Canine89/hwpxskill](https://github.com/Canine89/hwpxskill), [SKILL](https://github.com/Canine89/hwpxskill/blob/main/SKILL.md) | 별327·포크94 | 검증한 양식의 문단/셀 슬롯과 스타일·이미지 참조 보존, 변경 대상만 채우기, 잔여 placeholder·내용 누락 검사 | 쪽수 맞춤을 위한 문구 요약·압축, 99% 같은 자기 선언을 인수 근거로 쓰기. 라이선스가 명시되지 않아 코드는 복사하지 않고 원칙만 참고 |
| [jkf87/hwpx-skill](https://github.com/jkf87/hwpx-skill), [SKILL](https://github.com/jkf87/hwpx-skill/blob/main/SKILL.md), [입출력 계약](https://github.com/jkf87/hwpx-skill/blob/main/references/one-shot.md) | 별292·포크66 | 의미 있는 입력 블록을 코드로 조립, 본문/이미지 보존 검사, 실패 후보의 원자적 저장, 구조 검사와 실제 페이지 검토 분리 | 내장 공문·보고서 양식으로 우리 양식 교체, 한컴 Windows 전용 도구를 현재 Mac/MYBOX에 그대로 가정 |
| [airmang/hwpx-plugins](https://github.com/airmang/hwpx-plugins), [python-hwpx](https://github.com/airmang/python-hwpx) | 스킬 별34; 코어 별118 | 필요한 대상만 편집, 단일 검증/저장 경로, 엔진·입출력 해시가 연결된 검증 증거 | 스킬 설치 자체를 MYBOX 호환성의 증명으로 취급, 버전이 다른 MCP/코어 조합을 검토 없이 채택 |

참고한 airmang는 해당 Python 프로젝트의 first-party 스킬이며 한컴 공식 스킬이라는 뜻은 아니다. 현재 확인한 코어는6.10.0/Apache-2.0, 플러그인의 조합 버전은 별개다. 재사용이 필요한 파일은 실행 단계에서 정확한 commit/version·라이선스·NOTICE를 고정하고, 허가가 불분명하면 독립 구현한다. 원문 지시 중 우리 요구와 충돌하는 자동 요약·템플릿 교체·추가 기능/계산·설치/업데이트 명령은 적용하지 않는다.

참고 원칙의 핵심은 **스킬은 작성·검증 방법의 참고 자료, 실행 결과는 결정적인 코드와 테스트로 고정**하는 것이다. 요청마다 모델이 XML/좌표/문구를 새로 판단하게 하지 않는다. 스킬의 내용을 대량 복사하거나 모든 스킬을 전역 설치할 필요는 없다.


## 계획 자체 검토

- 패키징의 성공은 일반 파일 무결성까지만 보장한다. 최소 probe와 전체보고서의 요구를 패키지 계층에 섞지 않았다.
- 3단계 실제 MYBOX gate 전에 전체 5지표 투영/3쪽 조립이나 웹 UI를 구현하지 않는다.
- 함수/자료형 이름을 파일별 계약과 단계에서 일치시켰다. 숨긴 인쇄 host의 중복 동작은 선택적 콜백의 기본값 없음으로 차단한다.
- 기존 계산식·본문 양식 보호와 출력 도구 추가 범위를 구분했다. 제품 변경은6단계부터다.
- 최초 계획 작성 시점에는 구현하지 않았으며, 실행 진행 상태는 아래 기록이 기준이다.


## 실행 컨텍스트 — 2026-10-29

### 1단계: 실패 기준 고정 완료

- 시작 HEAD `d33a57f`; branch `codex/aifrm-ui-ux`. 기존 앱 소스·자산·설정205파일 SHA 변경0. 보호 기준과 증거 원본은 visualizations `hwpx-sample-20261028/recovery-20261029/`에 별도 보존했다. 실패 증거를 성공 golden으로 사용하지 않는다.
- 원본3쪽 PDF SHA `442d539a000446e55e49ed7cdcf71148d7a275f4e071a098fb260f015f4868bb`, 실패 HWPX SHA `ba96596d68319fa8058b082705bdfbfd184ab567c68401c23b0111047f174010`, MYBOX4쪽 반환PDF SHA `92cc86d61ecd8e06c09eefc7f19898ce21c6dfeff7c43b17befa63d17fb1f48e`. A4/세로·Chrome154는 PDF에서 관측, 선택 글꼴/배율/여백은 미확인으로 남겼다.
- 기준 QA: 기존 테스트9개 PASS. 구조 검사일 뿐 MYBOX 호환성 불합격을 뒤집지 않는다. 문서 정정 단계는 실행 코드 변경이 없으므로 인위적인 RED 테스트를 추가하지 않았다. 코드 단계부터 RED→GREEN을 수행한다.
- 논리/DDD 검토: 내보내기는 계산 완료 보고서의 표현 어댑터이며 도메인 재계산·업무 저장을 하지 않는다. ZIP 무결성은 일반 인프라 책임이고 금융 지표/7그림/3쪽은 상위 문서 구성 책임이다. 작은 probe 성공 전 전체 투영을 구현하지 않는다.
- 참고 스킬은 원칙만 채택하고 허가 불명 코드는 복사하지 않는다. 정확한 버전/고정 commit이 있는 원본만 재사용 기록에 명시했다.
- 다음: 2단계 패키지 검증/원자 저장을 TDD로 분리. 3002 서버·업무 DB·제품 코드 변경 없음.

- 1단계 독립 검토 완료: MYBOX 미확인 설정은 추정하지 않음. 다음 단계의 경로 alias 차단은 CLI 책임, font ID는 언어별 범위, probe-table은 요약 TextBlock→한 셀 표, 슬롯 검사는 의미 블록 완전성으로 구체화했다. 계산/템플릿 보호와 순서에 모순 없음.

### 2단계: 패키지/원자 저장 검증

- 1단계 커밋 `be62a84`. 2단계는 `package_io.py`/테스트를 분리하고 기존 CLI에 단일 검증/저장 경계를 연결했다. 패키지 계층에는 지표 개수·3쪽·업무 도메인 지식이 없다.
- TDD: 패키지7개 최초 RED(errors0)→GREEN, section 없는 spine/이미지 아닌 참조 추가 RED→GREEN으로 최종8개. CLI 입력파일 덮어쓰기 RED→GREEN 및 심링크/하드링크/JSON 보존. 통합 총18개 PASS. 실패 검증/`os.replace` 오류에서 기존파일·임시파일 정리 확인.
- 실제 합성JSON/기존 layout로 CLI 재생성: SHA `ba96596d68319fa8058b082705bdfbfd184ab567c68401c23b0111047f174010`, 기존 실패 샘플 바이트 동일. 내용을 바꾸지 않는 추출임을 확인했으며 레이아웃 복구로 소개하지 않는다. 빈 템플릿·샘플 재개방/결정적 재패키징, 보호205파일 변경0.
- 증거: visualizations `hwpx-sample-20261028/recovery-20261029/stage2-qa.json`과 RED/GREEN 로그. 다음은 의미 문서형·최소 native flow probe이며 전체 보고서 투영은 아직 구현하지 않았다.

- 2단계 독립 코드/DDD 재검토: 중요·치명 결함0, 독립 실행18/18 PASS. 입력경로 차단은 CLI, 일반 참조/원자 저장은 인프라로 책임이 일치한다. 실제 MYBOX 호환성은 아직 미검증이다.

### 3단계: 최소 문서 구현·자동 QA 완료, MYBOX gate 진행 중

- 2단계 커밋 `542d995`. 불변 문서형과 native flow XML 조립을 분리하고 CLI에 probe-text/image/table을 추가했다. 전체 project_report와 제품 앱은 수정하지 않았다.
- TDD: CLI mode 미지원 RED→GREEN, 의미문서9개 RED→GREEN, 굵기 순서·여백 case/default 배율·version manifest ID충돌 회귀 RED→GREEN. 최종31개 PASS. 독립 리뷰 중요 미해결0.
- 합성 probe3개: text `09506e780332d4de493dbf6d160fac3db163f7abf42a897366008793334fc0b3`, image `3a8417c638c894e52e3fa01f0a0011fd71b8205ea3d80b7c6a41a5723a876ccb`, table `b6c6df230b921cfd4ce42704a05d71078c337aba4de72ad86a50843199d3e84b`. 각 python-hwpx6.10.0 package/document issues0, RHWP0.8.7 보조 렌더1쪽. 보조 미리보기 원문/그림/줄바꿈 육안 확인, MYBOX 인수와 구분한다.
- 보호205파일 SHA 변경0. 계산식·HTML/PDF 보고서·앱 의존성·DB·3002 서버 변경 없음.
- 사용자에게 외부 업로드 확인을 받고 세 합성 HWPX만 MYBOX에 업로드했다. Chrome 확장 경로는 file URL 권한이 없어 실패했으나 권한 변경 없이 native 파일 선택창으로 성공(3/3). 실제 업무 파일은 업로드하지 않았다.
- 현재 probe-text 뷰어 iframe이 about:blank에 머물러 아직 실제 쪽수·인쇄PDF·편집을 확인하지 못했다. 로딩 경로 진단 중이며 4단계 전체 투영을 시작하지 않는다. 증거와 테스트 로그는 visualizations `hwpx-sample-20261028/recovery-20261029/`.

### 3단계 최신 재개 지점: 자동 QA 완료·MYBOX 요약표 PDF 통과, 인수 미완료

- 이전 about:blank 로딩은 이후 정상 해소됐다. 합성 probe3개가 실제 Naver 변환 뷰어에서 각1쪽, 본문/그림/표 순서와 정상 줄바꿈을 유지했다.
- **정상 인쇄 경로** MYBOX 더보기→인쇄→PDF로 저장으로 `mybox-probe-table.pdf` 확보. Title 네이버MYBOX/Chrome154·Skia154/A4/실제1쪽/96,279bytes, SHA `113e7cc97a6f18c22e226cb52d635bf2f14e10fb4950ac84be327936b226ed6f`. root·독립 검토에서 요약표2줄·본문·차트·산식·기호·마지막문장 보존, 겹침/잘림없음 확인.
- 직접 docviewer 탭의 일반 브라우저 인쇄는 UI까지 출력되어 실패했다. `diagnostic-direct-viewer-print-clipped.pdf`로 구분했고 통과 증거에서 제외했다.
- 파일 대화상자는 `com.apple.appkit.xpc.openAndSavePanelService`의 SavePanel에 연결해야 한다. Chrome 본체에 키 입력하면 다른 창으로 갈 수 있으므로 파일명 AX 설정+저장 클릭을 사용한다. 도구 timeout이어도 저장은 끝날 수 있어 재실행 전 파일 존재/SHA부터 확인한다.
- Chrome 화면 변경이 이어져 text/image 두 인쇄 저장은 중단 상태. 사용자 업로드 승인은 유지된다(합성 probe3개 현재 MYBOX에 있음). 남은 text/image 정상 MYBOX 반환PDF와 제공되는 편집환경의 수정→저장→재열기를 검증해야 단계가 통과한다. MYBOX 뷰어 자체는 편집이 없고 별도 한컴오피스 Web 링크만 있어 해당 환경은 미확인이다.
- 코드/DDD 독립 재검토 중요 미해결0, 전체31개 PASS. 3단계 코드는 재개 가능한 중간 커밋으로 보존하며 **3단계 인수 완료/4단계 착수로 처리하지 않는다**. 증거 `recovery-20261029/stage3-verification.md`, `stage3-qa.json`.
- 다음 작업: 파일 hash를 새 후보와 연결해 남은 MYBOX PDF/편집을 검증→3단계 인수 기록→4단계 전체3쪽 projection. 현재 계산식·HTML/PDF 템플릿·제품205파일·DB·운영서버는 그대로다.
