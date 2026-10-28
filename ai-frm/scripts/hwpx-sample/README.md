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
