# HWPX 샘플 생성기

> **호환성 불합격 (2026-10-29):** 기존 `sample-report.hwpx`를 네이버 MYBOX에서 열어 인쇄/PDF 저장한 결과는 4쪽이며 본문·그림이 겹친다. 아래 좌표 기반 생성기는 실패 재현용이다. 단위 테스트9개와 RHWP3쪽 결과를 실제 MYBOX 통과로 해석하면 안 된다. 웹 다운로드에는 아직 연결하지 않는다.

복구 기준: 저장된 `FinancialReport`를 읽기 전용으로 의미 단위 문단에 투영하고, 차트도 같은 흐름에 넣는다. 패키징 계층은 지표·그림 개수·쪽수를 모르며, 실제 MYBOX 최소 probe 검증 후 전체3쪽 조립으로 진행한다. 기존 계산식·HTML/PDF 보고서 본문은 변경하지 않는다.

실패 원본·합성 입력·새 보호 기준205파일·SHA·관측/미확인 인쇄 설정은 visualizations의 `hwpx-sample-20261028/recovery-20261029/baseline-evidence.json`과 `protected-baseline.json`에 고정했다. 원본PDF3쪽, 반환PDF4쪽이며 글꼴 선택·배율·여백은 기록이 없어 미확인이다. 참고 스킬 출처·버전·라이선스·차용/제외 원칙은 `template-provenance.json`에 기록했다.

이 디렉터리는 다운로드 기능을 붙이기 전의 로컬 검증 도구다. 웹 앱·계산식·기존 HTML/PDF 템플릿을 호출하거나 변경하지 않는다. 입력은 이미 계산된 `FinancialReport` JSON과 기존 PDF에서 측정한 표시 위치다. 업무 SQLite·환경변수·외부 변환 서버를 사용하지 않는다.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/hwpx-sample -v
python3 scripts/hwpx-sample/generate_sample.py \
  --report /absolute/path/report-document.json \
  --layout /absolute/path/layout.json \
  --output /absolute/path/report-sample.hwpx
```

`--report`는 `FinancialReport` 자체 또는 `{json: FinancialReport}` 문서 wrapper를 받는다. `--layout`은 다음 구조다. 실제 PDF line 그룹이 있으면 각 page의 `lines` 배열을 우선 사용하며, 각 line의 `runs`에 문구·글자 크기·굵기·색을 줄 수 있다. `texts` span 입력은 같은 y좌표를 한 줄로 묶는 호환 입력이다. 모든 위치·크기는 PDF point(1/72 inch) 단위이며 HWPUNIT으로 직렬화할 때만 100을 곱한다.

```json
{
  "pageWidthPt": 595.28,
  "pageHeightPt": 841.89,
  "fontFamily": "맑은 고딕",
  "pages": [
    {"texts": [{"text": "기존 보고서에 실제 표시된 한 줄", "xPt": 24, "yPt": 20, "widthPt": 500, "heightPt": 14, "fontSizePt": 10, "baselinePt": 11, "bold": false, "color": "#000000"}]},
    {"texts": []},
    {"texts": []}
  ],
  "images": {
    "recovery": {"path": "/absolute/path/recovery.png", "page": 1, "xPt": 24, "yPt": 300, "widthPt": 500, "heightPt": 100}
  }
}
```

위 JSON은 필드 설명 예시이며 그대로는 검증을 통과하지 않는다. 세 페이지의 모든 기존 본문이 필요하고 그림도 `recovery`, `liquidity`, `construction`, `funding`, `cash`, `referenceRisk`, `referenceLcr` 7개가 모두 있어야 한다. `baselinePt`는 한 줄 내부에서의 baseline 위치다. 실제 PDF가 한 문장을 여러 줄로 나누면 줄별 text 항목으로 준다.

본문과 요약·산식·지표값은 편집 가능한 HWPX native 문단이다. 기존 차트 5개와 원본 참고표 2개만 PNG로 넣는다. PNG 바이트는 재가공하지 않는다. 숨겨진 출처·경고·이력 문구를 추가 본문으로 싣지 않으며, 산출 중/불가 사유의 축약은 기존 PDF의 60 code-point 규칙을 따른다.

빈 패키지는 Apache-2.0 `python-hwpx` 6.10.0의 `hwpx/data/Skeleton.hwpx`다. `template-provenance.json`에 원본 wheel URL·digest·빈 패키지 digest를 기록했고 라이선스를 함께 둔다. 그림 도형의 구조도 같은 프로젝트의 `hwpx/oxml/objects.py`를 참고했다. 생성 시 첫 ZIP 엔트리 `mimetype`을 무압축으로 쓰고, 명시적 쪽 나누기 두 개와 편집 가능한 문단을 만든다. PDF 한 줄은 여러 스타일 run을 가진 native 문단 하나로 구성하고, 실제 문단 좌우 여백·이전 간격·고정 줄 간격을 함께 기록한다. line cache에만 절대 배치를 맡기지 않는다. 장식용 파란 선·노란 요약 배경은 native 벡터 사각형이다. 원본 패키지의 header 참조 테이블은 유지한다.

단위 테스트 9개는 package/XML 참조·원문 전체 일치와 중복 거부·그림 바이트·역할별 페이지 배치·결정적 출력·요약 박스 테두리를 검증한다. 이 테스트나 section 개수만으로 실제 한글의 렌더링과 편집 호환성을 증명하지는 않는다. 실제 생성 파일의 독립 렌더링 결과와 기존 3쪽 PDF를 비교하고, 한컴 한글에서 여는 검증 결과를 별도로 기록해야 한다.

생성기의 `declaredPageLayouts`와 `declaredPageBreaks`는 선언된 구조 개수다. 실제 출력 페이지 수는 별도 렌더러 결과에서 확인한다. 최종 샘플은 `layout-v3.json` 입력을 사용하며, 첫 span별 문단 버전의 시각 실패는 통과로 취급하지 않는다.

장식 사각형은 page의 `shapes` 배열에서 `xPt`, `yPt`, `widthPt`, `heightPt`, `fill`을 받는다. 원본 요약 박스의 얇은 테두리는 `stroke: "#B9B9B9"`, `strokeWidthPt: 0.75`로 기록한다. `stroke`가 없는 파란 선 사각형은 테두리 없이 채움만 유지한다.

## 복구 2단계: 패키지와 저장 경계

`package_io.py`는 보고서 지표/쪽수와 독립적으로 XML/manifest/spine·글꼴/문단/스타일·이미지 참조, ZIP CRC·중복/비정규 경로를 검사한다. `build_package`는 입력 바이트를 보존한 결정적 ZIP을 만들며, `write_atomic`은 후보 재개방 검증·임시 파일 fsync 후 단일 replace로 저장한다. 검증/교체 실패 시 기존 파일을 보존하고 임시 파일을 정리한다. 생성기/CLI는 입력 파일과 출력의 동일 경로·심링크·하드링크를 차단한다.

패키지8개·생성기10개 테스트가 통과하며, 기존 실패 샘플은 재생성 SHA까지 동일하다. 이 단계는 파일 무결성 보완이며 기존 레이아웃이 고쳐졌다는 의미가 아니다. 구조 검증은 이 내보내기가 쓰는 참조에 한정되고 전체 HWPX 스키마/뷰어 조판 검증을 대체하지 않는다.

## 복구 3단계: 최소 native flow 시험

```sh
python3 scripts/hwpx-sample/generate_sample.py --mode probe-text --output /absolute/path/probe-text.hwpx
python3 scripts/hwpx-sample/generate_sample.py --mode probe-image --assets /absolute/path/assets.json --output /absolute/path/probe-image.hwpx
python3 scripts/hwpx-sample/generate_sample.py --mode probe-table --assets /absolute/path/assets.json --output /absolute/path/probe-table.hwpx
```

`assets.json`은 `{"chart": "/absolute/path/synthetic-chart.png"}` 형식이다. 상대 경로는 자산 JSON의 폴더 기준이다. probe는 원자료/보고서 JSON·PDF layout을 받지 않고 고정 합성 문단만 쓴다. 문서형은 불변 값이며 XML 조립은 bytes만 받아 파일·DB·네트워크에 접근하지 않는다. 전체 FinancialReport 투영은 최소 MYBOX 인수 이후의 작업이다.

본문은 의미 문단, 그림은 같은 흐름의 글자처럼 취급하는 개체, 요약은 편집 가능한 한 셀 표다. 수동 줄 좌표 캐시와 FIXED 줄간격을 쓰지 않는다. 참고한 Apache-2.0 python-hwpx6.10.0의 문단·그림·표 구조, 굵기 순서, case/default 여백1배/2배, version manifest 등록을 테스트로 고정했다.

현재 자동 테스트31개, 독립 파서 문제0, RHWP 보조 렌더 각1쪽이다. 실제 MYBOX 열기·인쇄/PDF·편집 재저장 인수는 별도 기록하며 자동 통과로 대신하지 않는다. 복구 증거 `recovery-20261029/stage3-qa.json`이 최신 인수 상태다.

### 2026-10-29 실제 MYBOX 확인

사용자 승인 후 합성 probe3개를 MYBOX에 올렸으며 실제 Naver 변환 뷰어에서 각1쪽과 정상 흐름을 확인했다. `probe-table`은 MYBOX **더보기→인쇄→PDF로 저장** 경로로 A4 1쪽 PDF를 확보했고 독립 육안 검토도 통과했다. 이 결과를 전체3쪽 보고서나 편집/재저장 성공으로 확대하지 않는다.

3단계의 text/image 정상 인쇄 PDF도 확보해 **세 probe의 MYBOX 인쇄 gate를 통과**했다. text는 A4 1쪽/48,115bytes/SHA `5a212ddc5e32c971ac21685bb4a1a552360c15b50e8a56d056746853de7107eb`, image는 A4 1쪽/86,688bytes/SHA `80d8fe73eaccb4fc26ded10985db50434e3c4949a7b718f940ae22f5a25b7fc6`다. 두 PDF 전쪽을 root/독립 검토자가 원문과 대조했다. image의 기존 MYBOX 리소스는 일시적 뷰어 오류가 있어 같은 SHA의 합성 파일을 새 이름으로 올린 후 정상 인쇄했다. 기존 파일은 보존했다.

편집/재저장 환경은 여전히 미검증이며5단계에 남는다. probe의400×110 그림 치수는 흐름 시험용으로, 전체 보고서는 원본 그림 비율을 보존해야 한다. 이 결과를 전체3쪽 보고서 양식 재현이나 편집성 검증 완료로 확대하지 않는다. 정확한 상태는 visualizations의 `recovery-20261029/stage3-verification.md`/`stage3-qa.json`. 직접 docviewer 브라우저 일반 인쇄는 실패 진단물이며 인수 증거에서 제외한다. 다음 단계는4A의 계산 완료 표시값 투영이다.
