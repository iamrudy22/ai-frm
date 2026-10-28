# HWPX 샘플 생성기

계산 완료 `FinancialReport` 표시값을 읽기 전용으로 투영하는 로컬 검증 도구다. 금융값을 재계산하지 않으며 제품 앱·기존 HTML/PDF 양식·업무 DB·환경변수·외부 변환 API를 호출하거나 변경하지 않는다. 웹 다운로드는 아직 연결하지 않았다.

## 사용법

앱 디렉터리 `ai-frm`에서 실행한다.

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/hwpx-sample -v
python3 scripts/hwpx-sample/generate_sample.py \
  --mode report --report /absolute/path/report.json \
  --assets /absolute/path/assets.json \
  --output /absolute/path/report.hwpx
```

`--report`는 `FinancialReport` 자체 또는 `{json: FinancialReport}` wrapper다. 자산 JSON은 다음7개 역할을 모두 포함한다. 상대 파일 경로는 자산 JSON의 폴더 기준이다.

```json
{
  "recovery": "recovery.png",
  "liquidity": "liquidity.png",
  "construction": "construction.png",
  "funding": "funding.png",
  "cash": "cash.png",
  "referenceRisk": "referenceRisk.png",
  "referenceLcr": "referenceLcr.png"
}
```

차트 PNG는 기존 figure 전체의 제목·범례·빈 자료 안내를 포함해야 한다. 참고표2개는 원본 PNG다. 본문은 native 문단, 종합은 혼합색 한 셀 표, 쪽번호는 native 바닥글이다. PNG bytes를 바꾸지 않고 원본 비율로 배치한다. 생성 시점 날짜나 추가 설명을 본문에 넣지 않는다. 산출 중/불가 사유는 기존 인쇄와 같은 Unicode60 축약만 적용한다.

**구형 `--layout`은 거부한다.** PDF 줄 위치·고정 줄간격·절대좌표 캐시를 사용하던 최초 실험은 MYBOX에서4쪽/겹침으로 불합격했다. 실패물은 증거 폴더와 git 이력에 보존하며 현재 생성 경로에 fallback으로 남기지 않는다.

최소 흐름 시험:

```sh
python3 scripts/hwpx-sample/generate_sample.py --mode probe-text --output /absolute/path/probe-text.hwpx
python3 scripts/hwpx-sample/generate_sample.py --mode probe-image --assets /absolute/path/probe-assets.json --output /absolute/path/probe-image.hwpx
python3 scripts/hwpx-sample/generate_sample.py --mode probe-table --assets /absolute/path/probe-assets.json --output /absolute/path/probe-table.hwpx
```

probe 자산은 `{"chart": "/absolute/path/synthetic-chart.png"}`다. probe는 고정 합성 문단과 명시적400×110 그림 치수를 쓰는 흐름 시험이며 전체 보고서의 비율/양식 인수를 대신하지 않는다.

## 책임과 지원 범위

- `report_projection.py`: 불변 의미 문서형·저장된 표시 문자열/순서/상태색 투영. DB·금융 계산을 모른다.
- `document_xml.py`: 문단/표/그림/스타일/바닥글 직렬화. 파일·네트워크를 모른다. report/자동맞춤 PNG는8bit noninterlaced grayscale/RGB/gray-alpha/RGBA를 지원하며 CRC·IDAT·행/필터·64MiB 한도를 검사한다. 지원 밖 형식은 오류다.
- `package_io.py`: 일반 XML/manifest/spine/스타일/이미지 참조·ZIP CRC/경로 검사, 결정적 패키징, 재개방 검증 후 원자 저장. 지표 개수/3쪽 규칙을 모른다.
- `generate_sample.py`: 입력 읽기→투영→XML→검증→저장 조정. 입력/출력 동일 경로·심링크·하드링크를 거부하고 실패 시 기존 파일을 보존한다.

`declaredPageLayouts`/`declaredPageBreaks`는 선언한 구조의 개수다. 실제 출력 쪽수·편집 호환성은 별도 검사해야 한다. 자동 테스트는 전체 HWPX 스키마 검증이나 실제 MYBOX 조판을 대체하지 않는다.

빈 패키지와 참고 구조는 Apache-2.0 `python-hwpx`6.10.0의 Skeleton/문단/그림/표다. wheel·빈 패키지 SHA와 사용/제외 범위는 `template-provenance.json`, 라이선스는 이 디렉터리에 보관한다. 글꼴 파일을 배포하지 않는다.

## 2026-10-29 검증 상태

최소 probe3개는 실제 **MYBOX 더보기→인쇄→PDF로 저장** 경로에서 각 A4 1쪽을 확인했다. 직접 docviewer의 브라우저 일반 인쇄는 UI가 섞이는 실패 경로이므로 인수에서 제외한다.

전체 합성2026/08 보고서의 CLI·패키지/본문/이미지 검사와 독립 검토를 통과했다. 실제 MYBOX A4/세로/기본 여백/기본 배율에서 **3쪽**, 본문·지표·기호·차트5/참고표2·쪽번호1/2/3 보존과 겹침/잘림 없음이 확인됐다. 제목 border가 작성일과 겹친 첫 후보는 불합격 기록 후, 제목 전용 `ignoreMargin=1` 회귀 테스트와 수정으로 해결했다. [한컴 문단 테두리 문서](https://help.hancom.com/hoffice130/ko-KR/Hwp/format/paragraph/paragraph%28border%29.htm)의 문단 여백 제외 의미를 적용했으며 원본 제품 양식을 수정하지 않았다.

- 통과 HWPX SHA: `f4228892c4559ff63a1bfef063c8a209659df05d20041bcd39b2af8b6ae592d3`
- MYBOX 반환 PDF SHA: `1e44740d2092ce1d4f6db551b56265fa231c7286f5d316f9deacff1641e0f86e`
- Python66개 PASS·독립 package/document 문제0/0·보호205파일 변경0·원본7PNG 보존.

원본 PDF와 픽셀 동등한 결과는 아니다. 종합 문장의 자연스러운 줄바꿈·글꼴 모양/굵기·인쇄 바깥 여백 차이는 남으며 내용 손실은 없다. MYBOX의 실제 대체 글꼴/폭 차이의 원인은 아직 확정하지 않았다. 변형 자료와 실제 편집→저장→재열기 QA는5단계, 웹 연결은6단계에 남는다. 편집 지원을 검증 완료로 소개하지 않는다.

실행 계획/과거 실패 이력은 `docs/superpowers/plans/2026-10-28-hwpx-sample.md`, 상세 인수물은 visualizations의 `hwpx-sample-20261028/recovery-20261029/`에 있다. 각 HWPX SHA→반환 PDF SHA→전쪽 PNG→검토 결과를 연결한다.
