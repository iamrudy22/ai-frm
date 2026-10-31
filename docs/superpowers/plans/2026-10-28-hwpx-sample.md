# HWPX 샘플 생성과 3쪽 보고서 비교

> **현재 상태 정정:** 사용자가 확인한 실제 경로는 **네이버 MYBOX → HWPX 열기 → 인쇄/PDF 저장**이다. 반환된 `test_report.pdf`는 4쪽이며 겹침·넘침이 있어 이전 샘플은 이 경로의 호환성 **불합격**이다. 아래 완료 기록은 로컬 샘플 실험의 이력이며 배포 가능한 HWPX의 인수 완료를 뜻하지 않는다. 대응 계획은 아래의 2026-10-29 실행 기준 1~7단계를 따른다.

아래 2026-10-28 기록은 최초 샘플 실험 범위다. 당시에는 웹 다운로드 버튼을 포함하지 않았으며, 현재의 후속 구현 범위와 순서는 아래 **2026-10-29 실행 기준**을 따른다. 계산식·기존 HTML/PDF 템플릿은 전 단계에서 보호한다.

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

**계획 갱신 당시 출발점:** HEAD `3505d98`, branch `codex/aifrm-ui-ux`. 1·2단계 완료, 3단계 코드/자동 테스트31개 완료, 당시 실제 MYBOX 요약표 probe 인쇄만 통과했다. 이후 실행 상태는 문서 끝의 최신 컨텍스트를 따른다. 전체 보고서 투영·웹 다운로드는 순서대로 구현한다.

**Goal:** 기존 계산·리포트 양식을 유지한 편집 가능한 HWPX를 생성하고, **네이버 MYBOX에서 열기→인쇄/PDF 저장**한 결과가 정상 3쪽임을 입증한다.

**Architecture:** 계산 완료 `FinancialReport`를 읽기 전용으로 받아 의미 단위 문서를 만들고, 검증한 HWPX 전용 기준 구조에 채운 뒤 패키지 검증·원자 저장으로 내보낸다. PDF 줄 좌표 역산은 제거한다. 작은 문서의 MYBOX 검증이 끝난 뒤 전체 3쪽 투영을 구현하고, 웹 연결은 최종 샘플 인수 이후에 진행한다.

**Tech Stack:** 샘플은 Python 표준 XML/ZIP·기존 Apache-2.0 빈 패키지 기반, 앱은 기존 Node26.12.1·Next.js·React·Astryx. 독립 파서/RHWP는 보조 검사다. 웹용 ZIP/차트 이미지 도구는6A에서 공개 API·라이선스·실제 브라우저 동작을 확인한 뒤 버전을 고정한다. 스킬과 외부 구현은 버전·라이선스를 확인한 원칙/허용된 최소 코드만 참고한다.

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
- HWPX의 본문은 native 문단/표, 그림은 기존 지표 차트5개와 원본 참고표2개다. 차트 이미지에는 기존 제목·범례·빈 자료 안내까지 포함한다. 보고서 본문 전체를 캡처하거나 별도 참고 추이 차트를 끼워 넣지 않는다.

## Review Focus

1. 글꼴 대체·두 줄 문장·기호가 문단 높이를 바꿔 그림과 겹침 → 3단계 최소 MYBOX probe와 5단계 변형 QA.
2. 명시적 쪽 나누기2개는 있어도 자동 넘침으로 빈4쪽이 생김 → 4·5단계 실제 반환PDF 전쪽 검토.
3. 결측·0·음수·순유입·긴 사유에서 값/본문을 잃거나 재계산함 → 4단계 투영 단위 테스트와 내용 비교.
4. 교체된 그림·스타일 참조가 깨지거나 저장 실패가 정상 파일을 덮어씀 → 2단계 패키지/원자 저장 및 3단계 XML 검사.
5. 수동 입력의 숨긴 인쇄 host와 보이는 문서가 중복 내보내거나 다른 문서를 다운로드함 → 6단계 명시적 콜백/문서 소유권 회귀.
6. SVG만 수집해 제목/범례/빈 자료 안내가 빠지거나 다른 월 차트가 섞임 → 6A 전체 figure 검증과6C 클릭 snapshot 계약.
7. probe의 글꼴/폭/색을 그대로 전체 양식에 사용하거나 Python 성공을 웹 결과에 승계함 → 4B 출력 전용 스타일과6D 최종 파일 재검증.

## 파일별 책임과 함수 계약

기본 경로는 `ai-frm/scripts/hwpx-sample/`다. 아래 모듈은 이미 분리되어 있다. 기존 파일을 보완하며 `test_report_projection.py`는4A에서 추가한다. 파일 수 자체를 목표로 삼지 않는다.

| 파일 | 책임·공개 함수 | 단위 테스트 |
|---|---|---|
| `report_projection.py` | 불변 문서형은 구현됨. `project_report(report: Mapping[str, object]) -> ReportDocument`는4A에서 구현 | `test_report_projection.py` (4A 추가) |
| `document_xml.py` | `build_parts(document: ReportDocument, template: Mapping[str, bytes], assets: Mapping[str, bytes]) -> dict[str, bytes]`. probe 지원 완료, `MetricBlock`·전체 보고서 스타일은4B에서 구현 | `test_document_xml.py` |
| `package_io.py` | `read_package(payload: bytes) -> dict[str, bytes]`, `validate_parts(parts) -> tuple[PackageIssue, ...]`, `build_package(parts) -> bytes`, `write_atomic(path: Path, payload: bytes) -> None`. 일반 무결성과 원자 저장 구현됨 | `test_package_io.py` |
| `generate_sample.py` (편집) | CLI의 JSON/자산 읽기→투영→XML→검증→후보 저장만 조정. `--report`, `--assets`, `--output`, `--mode probe-text/probe-image/probe-table/report` | 기존 `test_generate_sample.py`를 CLI·통합 테스트로 변경 |

- `ReportDocument`는 reportMonth·generatedOn과 순서 있는 `PageSpec`을 갖고 각 쪽은 block tuple이다. `MetricBlock`은 표시 title/value/status/narrative/basis/formula/image_role을 보존한다. PDF x/y·행별 문장은 계약에 넣지 않는다.
- 4A에서 exporter 전용 불변 `SummaryItem(label, status, tone)`·`SummaryBlock(items)`를 추가하고 지표의 표시 색도 명시한다. `tone`은 기존 출력의 색 선택을 복제하는 표현 정보다. 금융값에서 등급·판정을 새로 계산하지 않는다. 요약의 검정 제목/상태별 색을 하나의 평문으로 합쳐 잃지 않는다.
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
- [x] `probe-text`·`probe-image`를 **MYBOX 더보기→인쇄→PDF로 저장** 경로로 저장한다. 각 A4 1쪽·원문/그림·기호·줄바꿈·겹침/잘림 없음이 기준이다. `probe-table`은 입력SHA가 유지되면 이미 통과한 실제 PDF를 재사용하며 불필요하게 반복하지 않는다.
- [x] 직접 docviewer 탭의 브라우저 일반 인쇄는 통과 증거에서 제외한다. 같은 이름의 PDF가 있어도 SHA/인쇄 경로를 대조한다. 저장 도구 timeout 뒤에는 실제 파일 존재·크기·SHA부터 확인하고, UI가 다른 창으로 바뀌면 네이티브 조작을 중단한다.
- [x] 편집 환경을 별도 기록했다. 현재 검증한 MYBOX 뷰어는 보기/인쇄만 제공하고 한컴오피스 Web 편집 링크는 미검증이므로 `edit=not_run`으로5단계에 남긴다. 사용 가능한 편집기에서 짧은 본문 수정→저장→재열기→인쇄를 수행한다. 링크의 존재를 편집 성공으로 단정하지 않는다.
- [x] 세 probe의 **정상 인쇄 결과가 모두 통과**해야4단계로 간다. 실패하면 첫 어긋남이 생기는 계층에서 실패 테스트→최소 수정→새 후보 생성→영향받은 probe의 실제 인쇄 재검증 순서로 해결한다. 코드나 입력이 바뀌면 이전 SHA의 통과 결과를 새 파일에 승계하지 않는다.
- [x] Run: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/hwpx-sample -v`. 단위/통합 PASS와 MYBOX gate의 실제 증거가 모두 필요하다.
- [x] 검토·QA·컨텍스트 기록을 마쳤다. 코드 `3505d98` 이후 추가한 검증을 `docs(qa): complete minimal MYBOX flow acceptance`로 커밋한다. 실제 편집 미검증은 별도 상태로 유지한다.

## 4단계: 계산 완료 데이터 투영과 전체3쪽 생성

**착수 조건:** 3단계 세 probe의 실제 MYBOX 인쇄 통과. 제품 앱은 계속 변경하지 않는다.

### 4A. 표시 데이터만 읽는 순수 투영

**Files:** `report_projection.py`, 신규 `test_report_projection.py`, 신규 `fixtures/report-contract.json`(샘플 디렉터리 안). JSON은 작은 합성 입력과 독립 기대 문구/순서/색/이미지 역할을 담으며6단계 TypeScript와 공통으로 사용한다. 실제 업무 자료나 PDF 좌표는 넣지 않는다.

- [x] RED: `test_projection_preserves_display_strings_and_input`에서 `1.00`, `0`, 음수, `—`, 순유입·로딩 문구를 완전 일치로 검증한다. `test_projection_rejects_duplicate_or_missing_metric`에서 지표5개 ID의 중복/누락을 거부한다. 환경/문법 오류가 아니라 현재 미구현 계약 때문에 실패하는지 확인한 다음 구현한다.
- [x] `test_projection_preserves_summary_order_and_fixed_body_order`: 종합은 입력 `metrics` 배열 순서, 본문은 recovery/liquidity→construction/funding/cash 고정 순서를 검증한다. 입력 배열을 정렬하거나 값/등급을 다시 계산하지 않는다. 제목·작성일·기존 표시 문자열도 그대로 사용한다.
- [x] `test_failure_reason_matches_print_codepoint_boundaries`: 산출 불가·산출 중만60 유니코드 코드포인트까지 원문,61부터 앞59개+`… (상세는 HTML 참고)`. 59/60/61·emoji·결합문자·ZWJ 경계를 고정한다. 일반 설명을 새로 축약하지 않는다.
- [x] `test_projection_excludes_non_print_details`: basis는 건설경기에만 표시하고 숨긴 출처·경고·이력/회차 안내는 제외한다. 종합의 정상/위험/기본 색은 기존 표시 조건을 그대로 옮기며 금융 수치에서 재판정하지 않는다.
- [x] GREEN: `project_report`와 `SummaryItem`/`SummaryBlock`을 구현한다. `ReportDocument`/`PageSpec`의 불변 tuple 계약은 유지한다. 계산 모듈·DB·파일·네트워크는 이 계층에 넣지 않는다.
- [x] Run(cwd `ai-frm`): `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/hwpx-sample -p 'test_report_projection.py' -v`. 같은 명령의 RED→GREEN과 전체 샘플 회귀·독립 검토를 기록한다.
- [x] 커밋·컨텍스트: `feat(hwpx): project saved report values without recalculation`.

### 4B. 전체 보고서 XML과 HWPX 전용 스타일

**Files:** `document_xml.py`, `test_document_xml.py`, 필요 시 exporter 전용 문서형. 기존 HTML/PDF 템플릿·CSS·글꼴 설정은 수정하지 않는다.

- [x] RED: `test_metric_block_keeps_text_and_image_in_flow`, `test_summary_preserves_mixed_status_colors`, `test_report_styles_match_existing_print_contract`, `test_native_footer_and_page_breaks`를 먼저 추가한다. 현재 `MetricBlock` 직렬화 미구현과 probe 스타일 차이가 실제 실패로 드러나야 한다.
- [x] GREEN: 지표 제목/값·상태·설명·산식·차트를 한 의미 그룹으로 직렬화하고, 종합은 색 있는 native 문구를 가진 한 셀 표로 구성한다. native 문단·그림의 흐름을 유지하며 절대좌표/줄 캐시 fallback을 만들지 않는다.
- [x] HWPX 전용 스타일은 기존 출력의 A4 세로·좌우12mm/상하10mm·본문13pt/종합14pt/날짜12pt·산식/기준9pt·본문/종합/날짜 줄간격1.5·종합 굵게·파란 선·노란 종합 박스·상태 색·실제 바닥글 쪽번호를 재현한다. 서체 지정은 기존 Dotum/돋움→AppleGothic→Noto Sans KR 순서를 기준으로 하되 설치 여부에 따른 실제 대체 글꼴을 기록한다. 차트 내부 서체 정책은 유지한다. 기존 실제 출력과 대조해 단위 변환/가용 본문 폭을 확정한다. probe의 본문11pt·160%·맑은고딕·skeleton 폭425.2pt를 전체 보고서에 그대로 쓰지 않는다.
- [x] 이미지 역할은 `recovery`, `liquidity`, `construction`, `funding`, `cash`, `referenceRisk`, `referenceLcr`의7개다. 원본 PNG의 종횡비를 유지해 가용 폭 안에 놓는 테스트를 추가한다. probe의 명시적400×110 시험 치수를 전체 보고서에 재사용하지 않는다. 누락/중복·가용 폭 초과를 보고서 구성 계층에서 거부한다. 범용 package 계층에5지표/7그림/3쪽 규칙을 넣지 않는다.
- [x] Run(cwd `ai-frm`): `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/hwpx-sample -p 'test_document_xml.py' -v`, 이후 전체 샘플 테스트·독립 파서 재개방. 본문/이미지SHA·참조·색·흐름 검사를 수행한다. 명시적 쪽나눔2개는 실제3쪽의 증명이 아니다.
- [x] 커밋·컨텍스트: `feat(hwpx): serialize report groups with native styles and page numbers`. 실제3쪽 인수는4C까지 미완료로 표시한다.

### 4C. CLI 전환과 실제 전체3쪽 검증

**Files:** `generate_sample.py`, `test_generate_sample.py`, README·검증 manifest. 입력은 `--mode report --report /abs/report.json --assets /abs/assets.json --output /abs/report.hwpx`이며 기존 wrapper JSON 지원은 유지한다.

- [x] RED: 전체 보고서 통합 테스트에서 내용/순서·7개 이미지·출력 경로 충돌·실패 시 원본 보존을 검증한다. `--layout` 없는 실행 성공과 구형 `--layout` 인자의 명확한 거부를 고정한다. CLI 오류 뒤 부분 파일을 남기지 않는다.
- [x] GREEN: JSON→투영→XML→패키지→원자 저장으로 연결한다. PDF 줄 좌표 계약/legacy fallback을 삭제하고 실패 재현물은 증거 폴더에만 보존한다. 위치/FIXED 속성만 검사하던 테스트는 새 내용·흐름 계약으로 대체한다.
- [x] 합성 기준월 JSON과 이미지7개를 고정하고 기존3쪽 PDF와 같은 내용인지 검사한다. 그림5개의 제목·범례·빈 자료 안내까지 보존하고, 참고표2개는 원본PNG bytes/SHA를 그대로 사용한다.
- [x] **MYBOX 정상 인쇄 PDF 전3쪽**을 원본과 나란히 비교한다. 쪽수·페이지별 문구/판정·그림7개·선/박스/색·서체/크기·기호·쪽번호·겹침/잘림·불필요한 빈쪽을 확인한다. 글꼴 대체로 차이가 나면 잔여 차이와 영향을 기록한다. 본문 삭제/강제 축소로 맞추지 않는다.
- [x] Run: 전체 Python 단위/통합·독립 파서·보호205파일SHA·독립 검토. 원본 HWPX→반환PDF→전쪽PNG를 연결하고 커밋·컨텍스트: `feat(hwpx): validate the full three-page report through MYBOX`.

## 5단계: 변형 자료·재저장 회귀와 샘플 인수

**Files:** 4A의 합성 fixture·책임별 테스트·CLI 통합 테스트·검증 manifest·README. 제품 코드는 변경하지 않는다.

- [x] RED→GREEN: 정상월/연말연초,0·음수·순유입,일부/전체 지표의 산출 불가/산출 중·긴 사유,빈/한 점/18개월 차트·긴 축 라벨을 조합한 작은 fixture를 추가한다. 값/본문 누락·참조 오류·불필요한 추가쪽을 재현하면 해당 책임만 수정한다.
- [ ] 자동 검증은 본문/수치·순서·원본 불변·이미지7개·참조·저장 실패 복구를 담당한다. 실제 MYBOX는 기준 정상본,0/음수/순유입,일부/전체 결측과 긴 사유,연말연초/긴 축 라벨의 대표 후보를 **각각 정상 인쇄→전쪽 비교**한다. 결과를 아직 받지 않은 후보는 `not_run`이다.
- [ ] 기존 양식의 기본 생성 범위는 실제3쪽이어야 한다. 임의 장문 편집으로 분량이 늘어난 경우는 내용 손실 없이 자연스럽게 넘기는지 별도 확인하며 무조건3쪽을 보장하지 않는다. 대체 글꼴 환경은 사용된 글꼴과 줄바꿈 차이를 따로 기록한다.
- [ ] 지원할 편집기에서 본문/표의 짧은 수정→저장→재열기→MYBOX 인쇄를 확인한다. 수정한 문구만 달라지고 나머지 문구/그림/기본3쪽이 유지되어야 한다. 편집기 확보가 안 되면 편집 인수는 `not_run`으로 남기며 **편집 지원까지 포함한 최종 완료를 선언하지 않는다**. 별도 서비스 이용/인증을 시험 성공으로 가정하지 않는다.
- [ ] HWPX SHA→MYBOX 반환PDF SHA→전쪽PNG→검토 결과/도구 버전을 연결한다. 반환PDF가 통짜 이미지면 HWPX 원문 검사와 전쪽 시각 비교를 함께 사용한다. PDF의 텍스트 추출 결과가 비었다는 사실만으로 내용 누락을 단정하지 않는다.
- [ ] 독립 검토 후 샘플·비교PDF·상태표를 제공하고 커밋·컨텍스트: `test(hwpx): cover report variations and MYBOX round trips`. 인쇄 검증 실패/누락이면6단계로 가지 않는다. 편집 미검증은 이후 단계로 넘어가도 완료 상태로 승격하지 않는다.

## 6단계: 웹용 변환 경계와 다운로드 도구

**착수 조건 갱신(사용자 승인, 2026-10-30):** 사용자가 “네 추가하세요. qa 는 제가 직접해볼게요”라고 명시했다. 따라서 MYBOX 선행 인쇄 gate를 버튼 구현의 중단 조건에서 해제하고, 실제 한글/MYBOX 인쇄·편집 최종 QA는 사용자에게 이관한다. 미수행 인수 상태는 그대로 기록하며 자동 통과로 승격하지 않는다. 구현 전 repo `AGENTS.md`의 해당 Next 로컬 문서와 Astryx CLI를 읽는다. 계산/저장/보고서 본문과 출력 어댑터를 분리한다. 새 aggregate·업무 저장소·변환 API를 추가하지 않는다.

기본 경로는 `ai-frm/src/app/aifrm/`. 작은 순수 함수와 경계별 테스트로 나누며 기존 exporter 한 파일에 XML/ZIP/DOM/클릭 상태를 몰아넣지 않는다.

| 파일 | 책임/함수 계약 |
|---|---|
| `report-hwpx-document.ts` + `.test.ts` | exporter 전용 불변 문서형·`ReportImageRole`·`ReportHwpxAssets = Readonly<Record<ReportImageRole, Uint8Array>>`, `projectReport(report: FinancialReport): ReportDocument`. Python과 같은 합성 계약 사용 |
| `report-hwpx-xml.ts` + `.test.ts` | `buildReportParts(document: ReportDocument, template: HwpxParts, assets: ReportHwpxAssets): HwpxParts`. 값 escape·스타일·본문/그림 참조·페이지/바닥글. DOM/UI 접근 없음 |
| `report-hwpx-package.ts` + `.test.ts` | `HwpxParts = Readonly<Record<string, Uint8Array>>`, `readHwpxPackage(payload: Uint8Array): HwpxParts`, `buildHwpxPackage(parts: HwpxParts): Uint8Array`, `validateHwpxPackage(payload: Uint8Array): readonly PackageIssue[]`. 일반 무결성만 검사하고 전체 HWPX 스키마 검증으로 주장하지 않음 |
| `report-hwpx-export.ts` + `.test.ts` | `exportReportHwpx(report: FinancialReport, assets: ReportHwpxAssets): Promise<Blob>`. 원본 template 로딩·투영→XML→ZIP·성공 Blob만 반환. 공개 자산형은 document 모듈에서 재수출 |
| `report-hwpx-assets.tsx` + `.test.tsx` | `collectReportHwpxAssets(report: FinancialReport, signal?: AbortSignal): Promise<ReportHwpxAssets>`. 같은 snapshot의 기존 차트 전체5개 PNG + 원본 참고표2개, 임시 host/리소스 정리 |
| `use-report-hwpx-download.ts` + `.test.tsx` | `useReportHwpxDownload(report: FinancialReport \| null)`. 클릭 순간 snapshot·동기 중복 잠금·busy/error·unmount 취소·Blob URL 해제를 한 곳에서 관리 |

### 6A. 웹 자산 생성과 의존성의 작은 검증

- [x] 현재 의존성에는 브라우저 ZIP/DOM 이미지 도구가 없다. ZIP 후보 [fflate](https://github.com/101arrowz/fflate), DOM 전체 PNG 후보 [html-to-image](https://github.com/bubkoo/html-to-image)는 공개 API/MIT를 확인했다. **채택 확정은 구현 시점**의 실제 Chrome 동작·버전/라이선스·번들·필요 API 확인 뒤로 둔다. XML 참조 검사도 Node/브라우저에서 시험 가능한 공개 API를 선택하며 문자열 regex를 XML 파서처럼 쓰지 않는다. 기존 xlsx/Next 내부 ZIP API와 전이 sharp를 브라우저 구현에 전용하지 않는다.
- [x] RED→GREEN: 대표 정상·빈 차트1개씩을 기존 `ReportChart`+`DocumentThemeProvider`로 독립 렌더링해 PNG를 만든다. **SVG만 추출하지 않고 `.report-chart` figure 전체**의 제목/범례/빈 자료 안내·경계선까지 검사한다. 자료가 없어 SVG가 없는 경우도 유효한 PNG여야 한다.
- [x] 기준 폭/문서 테마·폰트/이미지 로딩 완료를 기다리고 CSS 변수·외부 이미지 참조가 남지 않게 한다. 기존 차트 소스/표현 정책/문서 테마는 고치지 않는다. 임시 렌더 host는 출력 전용 어댑터에 두며 숨김 인쇄 host를 재사용하지 않는다.
- [x] 이 단계의 브라우저 증거가 실패하면 패키지 선택/자산 어댑터만 조정하고 버튼 연결을 보류한다. 선택한 의존성만 정확한 버전으로 package/lock에 고정한다. 커밋·컨텍스트: `feat(hwpx): capture existing chart figures for document export`.

### 6B. Python 인수 계약을 웹 직렬화로 이식

- [x] RED: 공통 `fixtures/report-contract.json`의 기대 문서와 `projectReport` 결과를 비교한다. Unicode 축약·종합/본문 순서·색·0/음수/결측·입력 불변을 검증한다. serializer/ZIP은 한글/특수문자 escape·그림 누락·참조·첫 MIME 무압축·정해진 메타데이터·재개방을 검사한다.
- [x] GREEN: document→XML→ZIP→export 모듈을 차례로 구현한다. 검증된 blank 패키지는 `ai-frm/public/aifrm/hwpx/blank.hwpx`에 출처·SHA/라이선스 고지와 함께 제공한다. same-origin 정적 template·참고표 fetch 외에 계산/확정/원장 저장/외부 변환 API를 호출하지 않는다. template 로딩 실패나 자산 누락은 성공 Blob 대신 오류다.
- [x] Python/TypeScript는 같은 의미 문서·표시 문자열·이미지SHA·패키지 불변식을 공유한다. ZIP 구현 간 전체 바이트 동일성은 요구하지 않고 각 구현 안에서 결정적 출력을 검사한다. TypeScript 결과를 Python 독립 파서/일반 패키지 검증기로 다시 열어 교차 확인한다. 런타임 Python 의존성은 만들지 않는다.
- [x] 자산형의 readonly만으로 바이트 불변성을 가정하지 않고 입력을 복사/보존한다. 날짜를 다운로드 시각으로 다시 만들지 않는다. 임의 글꼴 파일을 추가 배포하지 않는다.
- [x] Run(cwd `ai-frm`): `npm test -- src/app/aifrm/report-hwpx-document.test.ts src/app/aifrm/report-hwpx-xml.test.ts src/app/aifrm/report-hwpx-package.test.ts src/app/aifrm/report-hwpx-export.test.ts`. RED 로그·GREEN·독립 검토 후 커밋·컨텍스트: `feat(hwpx): port the verified document contract to browser export`.

### 6C. Astryx 다운로드 도구와 클릭 시점 문서 고정

**Files:** hook·자산 어댑터의 경합/정리 테스트, `report-preview.tsx`의 `.report-controls`/선택적 props와 테스트, `page.tsx`, `manual-entry-editor.tsx`의 보이는 문서 콜백·기존 테스트. `manual-entry-print-host.tsx`는 콜백을 받지 않는다.

- [x] preview props는 `onDownloadHwpx?: () => void`, `isDownloadingHwpx?: boolean`(기본 false), `hwpxDownloadError?: string | null`(기본 null). 콜백이 없으면 버튼도 없다. hook은 `{downloadHwpx, isDownloadingHwpx, hwpxDownloadError}`를 반환하고 양쪽 보이는 문서 소유자가 같은 계약을 사용한다.
- [x] RED: 업로드/보관본은 **최종 `displayReport`**, 직접 입력 검토는 **`state.review.document.json`**을 클릭 순간 복제하는지 검사한다. 비동기 도중 월/문서가 바뀌어도 최초 snapshot과 그 차트만 담아야 한다. 중간 `report`/`projectedReport`나 뒤늦게 읽은 화면DOM을 사용하지 않는다.
- [x] RED: 빠른 중복 클릭은 한 번만 실행, 자산/template/ZIP 실패는 다운로드 없음·오류 표시·재시도 가능, unmount 시 작업/임시 host/URL 정리, 숨김 print host에는 버튼/호출 없음, 재산출·확정·이력 저장 API 호출0을 검증한다. 모든 다운로드는 명시 클릭으로만 시작한다.
- [x] GREEN: 실제 Astryx Button·기존 상태/오류 컴포넌트를 출력 도구 영역에 추가한다. 기존 본문 `Sheet`/`MetricSection`/`ReferencePage`, 인쇄 CSS/폰트·PDF 동작은 그대로 둔다. 버튼 문구는 `한글(HWPX) 다운로드`, 생성 중에는 중복 실행을 막는다.
- [x] Vitest는 Node 환경이므로 기존 SSR 계약 테스트/React hook 모의 harness를 재사용한다. DOM→PNG 품질은 실제 브라우저 QA로 별도 검증한다. 새 테스트 프레임워크를 도입하는 것 자체를 목표로 삼지 않는다.
- [x] Run: 신규 hook/자산 테스트 및 기존 `report-preview.test.tsx`, `report-chart-view.test.ts`, `manual-entry-editor.test.tsx`, `manual-entry-print-host.test.tsx`. 독립 검토·커밋·컨텍스트: `feat(report): add Astryx HWPX download controls`.

### 6D. 웹에서 받은 파일의 실제 MYBOX 재검증

- [ ] 격리 합성 앱에서 업로드 결과·직접 입력 검토·과거 확정본의3경로로 다운로드한다. 비동기 중 월 전환·실패 후 재시도·짧은 시간 연속 클릭을 실제 브라우저에서 확인한다.
- [ ] **최종 웹 다운로드 파일**로 기준 정상/결측/경계 후보의 MYBOX 인쇄·전쪽 비교를 반복한다. Python 샘플 통과를 웹 이식 결과에 자동 승계하지 않는다. 편집 round trip도 지원 환경에서 최종 웹 파일로 다시 확인한다.
- [ ] `npm run verify`, `npm run lint`, 격리 production `npm run build`·기존 PDF 3쪽 회귀를 수행한다. 계산/템플릿 보호와 허용된 도구/props 변경은 SHA와 diff로 구분한다. 발견한 실패는 해당 모듈 RED→GREEN 뒤 영향 범위만 재검증한다.
- [ ] 증거·독립 검토·커밋·컨텍스트: `test(report): verify web HWPX exports through MYBOX`. 인쇄 gate가 미통과면 운영 반영하지 않는다.

## 7단계: 운영 반영과 인계

- [ ] 6D 통과 후 업무 DB/env가 없는 격리 앱의 결과를 확인하고, 업무 원장에 합성 자료를 만들지 않는다. 해당 HEAD·Node26.12.1·빌드 입력을 고정한다.
- [ ] 기존 업무 원장을 SQLite에 맞는 방법으로 백업하고 무결성/전후 상태를 확인한다. 실행 중 WAL 때문에 파일 SHA만으로 데이터 불변을 판정하지 않고 기존 원장 검증 절차를 따른다. 환경변수/키 값을 출력하지 않는다.
- [ ] 검증된 HEAD로 로컬3002 서버를 갱신한다. HTTP·실제 UI 접근·다운로드 도구·기존 PDF를 확인한다. 실패하면 직전 검증 HEAD로 복구하고 DB/원장은 바꾸지 않는다. 외부 공개/배포는 별도 요청 범위다.
- [ ] 최종 HWPX·MYBOX 반환PDF·전쪽 비교·계산/템플릿 불변 증거·커밋·지원/미검증 환경을 인계한다. MYBOX 인쇄 미통과 또는 편집 미검증 상태를 전체 완료로 보고하지 않는다.
- [ ] 문서/컨텍스트 커밋: `docs(qa): record HWPX rollout and acceptance evidence`.

## 단계별 공통 검증·테스트 구분

- 순서: **논리/DDD 계약 확인→실패 테스트 확인→최소 구현→단위/통합 QA→독립 검토→해당 단계의 실제 브라우저/MYBOX 검증→커밋→컨텍스트 기록**. 4A/4B/6B 등 순수 모듈의 완료를 실제3쪽 호환성 완료로 표현하지 않는다.
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
- 4단계는 투영/전체 스타일/CLI 실제3쪽 검증으로,6단계는 자산 검증/직렬화 이식/클릭 도구/최종 MYBOX로 나눴다. 모든 소단계에 테스트·검토·커밋·재개 지점을 둔다.
- Python/TypeScript의 공유 계약은 같은 표시 문서/이미지이며 각 ZIP 구현의 바이트 일치와 구분한다. 차트 전체 figure·0/결측·Unicode 경계·화면 변경 경합·숨김 인쇄본·편집 미검증 상태를 빠뜨리지 않았다.
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

### 후속 구현 계획 보완 — 계획만 갱신

- 현재 HEAD `3505d98`에서 기존 계획의3~7단계를 보완했다. 앱/샘플 코드·의존성·DB·서버는 변경하지 않았다. 문서 변경만 있어 기능 테스트를 새로 실행하지 않으며 `git diff --check`와 계획 자체 검토를 수행한다.
- 다음 실행은3단계의 남은 text/image 정상 MYBOX 인쇄부터다. 세 probe 인쇄가4단계 착수 조건이고, 제공되는 환경의 편집 검증은 별도 추적한다. 편집 환경이 없으면5단계 미검증으로 남기며 최종 편집 지원 완료를 선언하지 않는다.
- DDD 경계: 저장된 보고서는 읽기 전용 표시 DTO, HWPX는 출력 어댑터다. 투영/문서XML/일반ZIP/브라우저 자산/클릭 조정의 책임을 나누고 새 금융 계산·업무 저장을 추가하지 않는다.
- 읽기 전용 코드 조사에서 현재 `MetricBlock` 미구현·probe와 본문 스타일 차이·종합/본문 순서 차이·SVG 밖 차트 제목/범례/빈 자료 안내·실제 `displayReport` 소유권을 확인해 계획에 반영했다. 구현 시 각 책임의 RED→GREEN과 실제 파일 검증으로 다시 입증한다.

### 3단계 인쇄 gate 통과 — 전체 보고서 구현 전 재개 지점

- text 정상 MYBOX 인쇄: `mybox-probe-text.pdf`, A4 1쪽/48,115bytes/SHA `5a212ddc5e32c971ac21685bb4a1a552360c15b50e8a56d056746853de7107eb`. image 정상 인쇄: `mybox-probe-image.pdf`, A4 1쪽/86,688bytes/SHA `80d8fe73eaccb4fc26ded10985db50434e3c4949a7b718f940ae22f5a25b7fc6`. 원본 table PDF는 기존 hash 그대로 재사용했다.
- 두 새 PDF는 Title 네이버MYBOX/Chrome154/Skia154이며 root와 독립 검토자가 실제 PDF 재렌더 전체쪽을 확인했다. 원문·기호·차트 제목/범례/값·산식·마지막 문장 보존, 자연스러운 줄바꿈, 겹침/잘림 없음. PDF는 통이미지 출력이라 검색 가능한 텍스트로 소개하지 않는다.
- 기존 image 리소스의 MYBOX iframe은 blank/일시적 오류였다. 새 탭·새로고침·직접 뷰어 진단 후에도 정상 인쇄가 안 돼 **같은 SHA의 승인된 합성 파일**을 `probe-image-recheck-20261029.hwpx`로 재업로드했다. 기존 파일은 덮어쓰지 않았다. 새 리소스에서 실제 MYBOX 더보기→인쇄→PDF 저장이 성공했다. 실제 업무 파일 업로드 없음.
- probe는 흐름 검증용400×110 크기라 차트 원본 종횡비까지 통과한 것은 아니다. 전체 보고서의 이미지 비율 보존은4B의 명시적 테스트/구현 대상이다. 한컴오피스 Web 편집·재저장은 여전히 `not_run`,5단계 인수에 남는다.
- 이번 단계의 코드 변경은 없고 추가 인쇄 QA이므로 인위적인 RED 테스트는 추가하지 않았다. 재개 시 전체31개 PASS·보호205파일 변경0·probe SHA 동일을 독립 감사했다. 다음: 4A의 표시 데이터 투영을 TDD로 구현, 전체3쪽 인수는4C에서 별도 확인한다.

### 4A 완료 — 순수 투영 TDD·검토·QA

- 시작 커밋 a18ac78 이후 report_projection.py·test_report_projection.py·합성 fixtures/report-contract.json만 구현했다. 표시 문자열/순서/상태색/Unicode60축약/입력불변을 보존하며 계산·원장·제품앱·HTML/PDF템플릿·XML·CLI·의존성은 변경하지 않았다.
- TDD 최초8개 RED→GREEN, 명시 style_profile 추가 RED→GREEN, 독립 리뷰 P2 두 건을 별도 실패 테스트로 재현→수정했다. 참고는 reference-header, 생략 basis는 None/빈 construction basis는 빈문자열로 구분한다. 재검토 승인. 최종 투영11개/전체Python42개 PASS, 앱1275개 PASS·기존2skip. root의 최종 전체Python42 PASS 및 보호205파일 변경0 확인.
- ImageBlock의 None 치수는4B에서 PNG비율/가용폭으로 맞추라는 의미다. ReportDocument.style_profile 기본probe/투영결과report를 분리해 기존 승인 probe3개가 바이트까지 그대로임을 확인했다. 새 SummaryBlock/MetricBlock/참고머리말/basis는4B에서 직렬화하므로 아직 전체보고서HWPX 생성완료가 아니다.
- 상세RED/GREEN·검토는 .superpowers/sdd/2026-10-28-hwpx-sample/task-4a-* 로그/보고서, 인수 요약은 recovery-20261029/stage4a-qa.json. 다음은4B 전체보고서의 native XML/스타일/바닥글/그림 비율을 TDD로 구현한다.

### 4B 완료 — native XML·전체 스타일·그림/바닥글

- document_xml.py/test_document_xml.py만 구현했다. report/probe profile을 분리해 본문13·종합14bold·날짜12·산식/기준9pt·150%·Dotum지정·A4상하10/좌우12mm, 혼합색1셀 종합, reference-header, 지표 흐름, native footer 자동쪽번호쌍과7PNG 원본비율을 직렬화한다. 모델/계산/제품템플릿/CLI/DB/의존성은 변경하지 않았다.
- TDD: 최초XML24개에서 신규20assertion RED→GREEN, 표준border폭enum 교정RED→GREEN. 독립검토P2(손상IDAT/PLTE수용)·P3(제목안쪽여백누락)을 RED→GREEN으로 해결했다. PNG는8bit noninterlaced grayscale/RGB/gray-alpha/RGBA만 지원하며,64MiB bounded zlib/CRC/정확행길이/filter0–4/PLTE·IDAT배치/criticalchunk를 검증한다. 현재원본7PNG는모두RGB8로통과하고바이트는그대로다. 범용PNG코덱이나재인코딩은추가하지않았다.
- 제목 padding3=12px→9pt를border offset에옮긴뒤작성일과선이겹치는보조QA회귀를발견했다. 원본header gap2=8px→6pt와하단padding9pt를합한title next15pt(case1500/default3000)를신규실패테스트로보호하고수정했다. 재검토승인,root보조재렌더에서겹침해소확인.
- 최종Python62개PASS(원래31+투영11+XML추가20), 독립package/doc검증0/0, 보호205파일변경0. 실제인수probe3개 bytes/SHA동일. 원본8월합성자료+7PNG의최종후보report-stage4b-v3.hwpx SHA a313fd7867f0b3644c209f86c241e77bd160017ed795be52e05daf79e6c6178b는승인MIT RHWP0.8.7에서보조3쪽이다. v1/v2는과거후보이며새후보의증거로승계하지않는다.
- 실제MYBOX 전체3쪽/폰트/쪽번호·편집 인수는아직미완료다. 다음4C에서--layout/legacy생성경로를삭제하고새CLI산출물로MYBOX 정상인쇄를검증한다. RED/GREEN/리뷰근거는recovery-20261029/reviews 아래에보존했다.

### 4C 완료 — CLI 전환·실제 MYBOX3쪽 인수

- 구형PDF layout/좌표 fallback을 삭제하고 JSON→순수 투영→native XML→일반 패키징→원자 저장으로 연결했다. raw/wrapper 입력·7PNG·실패보존·출력 alias·구형인자 거부를 CLI 통합 테스트로 보호한다. 독립 코드/DDD 검토 승인, 제품 파일/DB/서버/의존성 변경 없음.
- 최초 실제 MYBOX 후보 a313fd78은3쪽이지만 제목 아래 파란선이 작성일과 겹쳐 불합격했다. 보조 렌더 성공을 실제 성공으로 승계하지 않았다. 한컴 문단 테두리는 ignoreMargin=0이면 위아래 문단여백도 포함한다. 제목만 ignoreMargin=1로 바꾸는 실패 테스트→최소수정→66개PASS→독립 재검토 후 새 CLI 후보를 실제 MYBOX로 다시 인쇄했다.
- 최종 report-cli-native-v2.hwpx SHA f4228892c4559ff63a1bfef063c8a209659df05d20041bcd39b2af8b6ae592d3. MYBOX의 report-native-202608-f4228892.hwpx를 더보기→인쇄→PDF저장해 mybox-report-native-202608-f4228892-default.pdf 확보: SHA1e44740d2092ce1d4f6db551b56265fa231c7286f5d316f9deacff1641e0f86e/1,141,687bytes/A4세로/실제3쪽/Chrome154·Skia154. 인쇄여백·배율은 관측된 기본값이다.
- root/독립 검토자가 전3쪽을 확인했다. 작성일/파란선 겹침 해소·모든 지표/본문/기호·5차트/2참고표·자동쪽번호1/2/3 보존·겹침/잘림/빈추가쪽 없음. 새2/3쪽 래스터는 이전후보와 픽셀동일이다. 본문은native, PDF는페이지별통이미지이므로 빈텍스트추출을 누락으로 판정하지 않았다.
- 잔여 차이: 종합 건설경기 항목의 상태가 다음 줄로 흐르고, 글꼴/굵기/자간과 외곽인쇄여백 차이가 있다. 내용 손실 없는 경미한 가독성 차이로 기록하며 픽셀동등성은 주장하지 않는다. 실제 대체글꼴과 약0.91배폭 차이의 원인은 미확정이다. 기존HTML요약도wrap허용이며 억지축소/본문삭제로 맞추지 않았다.
- 증거는 recovery-20261029/stage4c-qa.json, mybox-report-f422-default-page-1~3.png와 reviews/task-4c/. Python66개·독립파서0/0·보호205SHA변경0 확인. 기존계산식/HTML·PDF템플릿불변. 실제편집재저장은not_run,5단계로이관한다. 다음: 변형자료별 실제figure생성·MYBOX인쇄와편집환경확인.

### 5A 자동 QA 완료·5단계 실제 인쇄 gate 대기 — 2026-10-30

- 4C 커밋 f6511f8 이후 합성 fixture 순수 helper/test2파일만 추가했다. baseline/2026연말/2027연초/0음수순유입/일부결측·산출중/전체결측/한점7종이다. 유효YearMonth18개+긴제목/기준으로 부하를 주며 임의잘못된축문자열을 생성하지 않는다. 앱/계산/템플릿/업무저장소 수정없음.
- helper 계약6개 RED→GREEN, 기존 XML은 새 변형 coverage가 처음부터 통과해 가짜 실패/불필요한 수정을 만들지 않았다. 독립리뷰P2는 새 fixtureCLI 순차저장의 부분쓰기 문제였다. 원래범위는 재사용함수 또는CLI이므로 불필요한 저장경계전체를 삭제해 순수factory만 유지했다. 영향6개·최종root전체72개PASS, 독립재검토 명세/품질승인.
- 격리SSR호스트에서 실제 ReportChart+DocumentThemeProvider+원본printCSS로 figure전체35개(제목/범례/빈사유포함)를 캡처했다. 산출불가/중인사유는 기존preview동일60Unicode규칙을 전달한다. 캡처도구JPEG를RGB픽셀손실없이PNG로저장했고원본JPEG도보존했다. 고정baseline그림을다른변형에재사용하지않았다. 참고표2개는원본bytes그대로다.
- 독립검증:7HWPX 모두python-hwpx package/document문제0, 승인MIT RHWP0.8.7명시WASM으로각3쪽/엔진오류0. source35figure·보조21쪽전수검토에서새4쪽/블록겹침/잘림없음.49임베드bytes/35metric표시필드/35JPEG→PNG RGB동일. 보조본문emoji대체글리프·기존cash정수포맷·703px/JPEG기원화질·자연줄바꿈관찰은MYBOX결함/원문손실로단정하지않았다.
- 한컴오피스Web v2에서합성f422파일의대금두곳(종합/지표제목)에(검증)을추가→저장완료→재열기3쪽/953글자확인→편집HWPX다운로드성공. SHA b48ee50e9bab6f92d77dfbb5d020a4f0e0c923ff45199c6cb30de1d05d406c8b, 두marker제거후native본문완전동일·원본7imageSHA동일. 기존합성cloud파일은편집본으로바뀌었고로컬인수원본f422는별도로보존했다. 새업무파일/약관승인/권한확장없음.
- **미완료:**7변형과편집본의실제MYBOX정상인쇄/전쪽대조. Chrome다른창초점이동으로파일선택시도후실제업로드가확인되지않았고,확장fileChooser.setFiles가로컬fileURL접근권한부족을명시적으로반환했다. 권한을임의변경하지않았다. 사용자준비응답후에도전달실패가남아합성8파일수동업로드를요청한다. /private/tmp/aifrm-hwpx-stage5-mybox-batch-20261029/에는새이름8파일만있다. 아직업로드성공으로기록하지않는다.
- 증거: recovery-20261029/stage5/status.json·candidates.json·independent-aux-qa.json/md·rhwp/와reviews/task-5/. 보호205SHA변경0. 자동QA는별도체크포인트커밋하고5단계인수는열어둔다. **5단계인쇄gate미통과이므로6·7단계미착수**다.6A는공식의존성/API읽기전용조사만보존했다.다음작업은합성8파일업로드확인→MYBOX정상인쇄→전쪽대조→5단계인수커밋이다.

### 6A 완료 — 실제 차트 전체 PNG·출력 자원 경계

- 사용자가 버튼 추가와 직접QA를 명시해 선행MYBOXgate를 해제했다. 외부 인수는not_run/user-owned로 유지하며 원장/계산/기존보고서본문은 보호한다.
- exactfflate0.8.3/html-to-image1.11.13/devxmldom0.9.12를 공개공식MIT출처로 확인해pin했다. 기존package에추가3개외의업그레이드는없다. 어댑터는클릭snapshot의실제ReportChart5개를DocumentThemeProvider+원본인쇄chart규칙의host스코프사본으로렌더한다. SVG내부computedstyle까지동결하고라이브stylesheet폰트스캔을끄며1406×316 PNG로제목/축/범례를포함한다. 빈자료안내는figure전체로캡처한다. 참고표2개원본bytes유지.
- TDD최초5개RED→GREEN, 혼합fixture의SVG한점기대정정과전체결측Unicode사례추가, 독립리뷰P2청크대기취소를신규회귀RED→abortableimport를DOM생성전으로이동→7PASS/ESLint0/재검토승인. 항상capture session/root/clone/host를정리한다.
- 격리앱(업무DB/env미복사)실제IAB클릭으로정상·전체결측HWPX다운로드성공. 정상chart5개는실제PNG1406×316이고제목/범례/색/기호를전수확인했다. 빈자료도7이미지패키지생성과임시host0/오류없음을확인했다. 원본HTML/PDF CSS·font·chart소스변경없음. 상세증거hwpx-web-20261030/와task-6a-*기록. 이단계의웹문서전체/도구연결은6B/6C가담당하며현재변경은순서대로별도커밋한다.

### 6B 완료 — 브라우저 문서/XML/ZIP 이식

- 6A커밋a49cd5c. 불변표시문서→nativeXML→일반ZIP→Blob어댑터를작게분리했다. 기존Python의저장표시값/날짜·종합순서/본문순서·색·60Unicode사유·빈basis구분·A4/요약표/문단/바닥글/그림비율을이식했다. HTTP계산/원장/확정API나Python런타임은사용하지않는다. 공개blank/Apachelicense원본SHA를그대로보존하고web출처고지를추가했다.
- TDD문서/XML12개(독립Huffman불완전코드수용회귀RED→GREEN포함),일반패키지/내보내기22개통과. CRC·중복/비정규경로·XML실파서/참조·boundedPNG/ZIP·MIME첫무압축·고정DOS날짜·바이트복사·동일입력결정성·실패Blob없음/재시도를검사한다. 독립6B검토/통합최종검토P0–P2미해결0.
- 실제IAB다운로드normal SHAfb230d5846a0cb18b8e8acf3fc28f1f9fb03bb59b23576235fab176877ece760/465303bytes,empty SHA87905867150a10434778a36483fa04c7a700f4d2a5815d8a340b82ca06071c7a/391469bytes. Python독립파서두파일문제0/0·ZIPCRC0,승인RHWP각3쪽/오류0. 독립검토자6쪽/10figure전수검토:10metric인쇄필드/날짜/기준/14임베드bytes/참고2SHA/native쪽번호보존·새4쪽/블록겹침/잘림없음. 보조본문emoji대체글리프/자연줄바꿈과실제MYBOX미검증은명시해사용자QA로이관한다.
- 기존report본문함수/Sheet JSX subtree가이전HEAD와TypeScriptAST상완전동일하다. 보호205파일중허용controls/test/dependency8개외변경0,금융계산/차트/CSS/폰트/원본참고표변경0. 전체타입+테스트1327PASS/기존2skip,전체lint무진단. 격리productionbuild는시험fixture복사누락1건을QA환경에서보완한뒤성공했다. 제품소스오류수정은없다.

### 6C 완료 — 실제 Astryx 다운로드 도구와 현재 문서 소유권

- 6B커밋60c8dc4. 보고서상단기존PDF버튼옆에실제Astryx한글(HWPX)다운로드를추가했다. callback없는숨김print host에는버튼이없고,기존Sheet/MetricSection/ReferencePage와printCSS는그대로다. 메인화면은최종displayReport,직접입력은보이는review.document.json을받는다.
- hook은명시클릭때첫await전structuredClone과동기잠금으로월전환/빠른중복실행을격리하고,생성중표시·재시도안내·unmount취소·late결과억제·BlobURL/앵커정리를담당한다. 화면마운트나effect에서파일을생성하지않고계산/확정/이력API쓰기0이다. 타겟109개및최종전체1327개PASS/기존2skip,타입/전체lint통과. 독립6C및전체변경재검토명세/품질승인·중요미해결0.
- 실제IAB정상/전체결측두문서에서버튼클릭→HWPX다운로드성공,빈자료에서도제목/안내5개를생성하고임시host0을확인했다. 사용자가직접할MYBOX최종QA는완료로승격하지않는다. 다음은검증빌드로3002서버갱신·최종도구노출/HTTP확인·인계다.
