# 04. 시공 단계 BIM — 간섭검토, 4D/5D

> 만들 계획은 없지만 개념은 알아야 하는 영역. 유튜브 데모 영상 2~3개면 충분.

## 핵심 질문

### 간섭검토 (Clash Detection)
- [ ] 왜 AEC 협업의 심장이 "조정(coordination) 회의"인가? 회의에서 실제로 무슨 일이 일어나는가?
- [ ] Hard clash vs soft clash(이격 거리) vs workflow clash의 차이는?
- [ ] 간섭 결과는 어떻게 관리되는가? (그룹핑, 책임 분야 지정, BCF로 전달 — 03 노트와 연결)
- [ ] Navisworks 간섭검토 데모 영상 1개 시청: 검사 셋 정의 → 결과 → 보고서 흐름 확인

### 4D — 공정 연동
- [ ] 모델 요소와 공정표(Primavera/MS Project) 액티비티를 어떻게 매핑하는가?
- [ ] 4D 시뮬레이션은 실제로 뭘 잡아내는가? (양중 충돌, 가설 간섭, 작업 순서 오류)
- [ ] IFC에는 공정이 어떻게 들어가는가? (IfcTask / IfcWorkSchedule — 스키마만 훑기)

### 5D — 물량·원가
- [ ] 물량산출(QTO)은 모델에서 어떻게 뽑는가? Qto_* 수량 셋과 측정 규칙(예: 벽 면적에서 개구부 공제)의 관계는?
- [ ] 왜 "모델 물량 ≠ 계약 물량"인가? 실무에서 모델 기반 물량을 어디까지 신뢰하는가?
- [ ] 분류체계(Uniclass, OmniClass, 한국 건설정보분류체계)가 물량·원가 집계의 근간인 이유는?

## 참고 자료
- 유튜브 검색: `Navisworks clash detection demo`, `4D BIM Synchro demo`
- 검색어: `BIM QTO quantity takeoff`, `Uniclass 2015 overview`

## 우리 프로젝트에 주는 시사점

_(공부 후 채우기 — 예: "extract.py가 분류체계를 안 뽑는데, ___ 때문에 필요해진다")_
