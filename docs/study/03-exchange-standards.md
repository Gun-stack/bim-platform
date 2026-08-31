# 03. 교환 표준 3형제 — COBie / BCF / IDS

> 우리 M5 보류분의 정체. AEC에서 "데이터를 주고받는다"의 표준 형태.

## 핵심 질문

### COBie — 준공 자산 인수인계
- [ ] 시트 구성(Facility / Floor / Space / Zone / Type / Component / System / Spare / Job / Document...)에서 각 시트는 IFC의 어떤 엔티티와 대응하는가?
- [ ] Type과 Component를 왜 분리하는가? (우리 element 테이블에는 이 구분이 없다)
- [ ] 실제 COBie 엑셀 샘플 하나를 열어서: 필수 컬럼, 색상 규약(노랑/주황/보라), 검증 규칙을 확인
- [ ] 발주처는 COBie를 받아서 실제로 무엇을 하는가? (CMMS/FMS 임포트 흐름)

### BCF — 이슈 교환
- [ ] .bcfzip 안에는 뭐가 들어있는가? (markup.bcf, viewpoint.bcfv, snapshot.png 구조 열어보기)
- [ ] viewpoint의 카메라 정의 + 컴포넌트 선택/색상/가시성은 어떻게 표현되는가? → 우리 `work_order.viewpoint` {v, sel, clip}과 1:1 비교
- [ ] BCF-API(REST)와 파일 기반 BCF의 차이? 실무에선 어느 쪽을 쓰는가?
- [ ] 이슈의 생애주기(open → in progress → resolved → closed)를 누가 넘기는가?

### IDS — 납품 정보 검증
- [ ] IDS XML의 기본 구조: specification = applicability(어떤 요소에) + requirements(무엇을 요구)
- [ ] "모든 IfcDoor는 FireRating 속성 필수" 같은 규칙을 IDS로 실제로 하나 작성해보기
- [ ] IDS 검증 도구(ifctester 등)로 우리 mep-building.ifc를 검사하면 뭐가 나오는가?

## 참고 자료
- buildingSMART 공식: COBie / BCF / IDS 각 표준 소개 페이지 (technical.buildingsmart.org)
- COBie 샘플: NBIMS-US COBie 예제 스프레드시트
- BCF 샘플: buildingSMART/BCF-XML GitHub 저장소의 test cases
- IDS: buildingSMART/IDS GitHub (스키마 + 예제), IfcOpenShell `ifctester`

## 우리 프로젝트에 주는 시사점

_(공부 후 채우기 — 예: "asset 테이블에 ___ 컬럼이 없어서 COBie Component 시트를 못 만든다")_
