# 05. 실무 IFC 감각 — 공개 샘플을 우리 뷰어에 올려보기

> 폐쇄 루프(자기 생성 IFC ↔ 자기 추출기)를 실무 파일로 깨뜨리는 경험이 최고의 수업.
> 이 노트만 손을 움직이는 실습. 01~04와 병행.

## 공개 샘플 소스

- [ ] buildingSMART Sample-Test-Files: https://github.com/buildingSMART/Sample-Test-Files
- [ ] Schependomlaan (시공 실측 데이터 포함으로 유명한 네덜란드 주택 프로젝트): https://github.com/buildingSMART/Sample-Test-Files 및 `Schependomlaan` 검색
- [ ] Open IFC Model Repository: 검색어 `open ifc model repository`
- [ ] IfcOpenShell 테스트 파일들: https://github.com/IfcOpenShell/IfcOpenShell (test 디렉터리)
- [ ] (비교용 뷰어) BlenderBIM — 같은 파일을 열어 "제대로 된 도구는 뭘 보여주나" 확인

## 파일별 관찰 체크리스트

각 파일을 업로드할 때마다 아래 표를 복사해서 기록:

```
### 파일명: ____________  (스키마: IFC2X3 / IFC4 / IFC4X3, 출처 저작도구: ___)
- [ ] 변환 성공 여부 / 실패 시 워커 에러:
- [ ] 공간구조 트리가 온전한가 (Site→Building→Storey→Space):
- [ ] Pset이 붙어 있는가, 벤더 커스텀 Pset 이름 예시:
- [ ] IfcSystem이 있는가, 몇 개:
- [ ] 연결: IfcRelConnectsElements ___건 / IfcRelConnectsPorts ___건  ← 핵심
- [ ] 계통 추적(route API)이 실제로 동작하는가:
- [ ] 지리참조: IfcMapConversion / RefLatitude / 없음:
- [ ] 분류(IfcClassification) ___건, 재질(IfcMaterial) ___건, 타입(IfcTypeObject) ___건:
- [ ] 뷰어에서 이상하게 보이는 것:
```

빠른 사전 검사 (업로드 전 셸에서):
```bash
for e in IFCRELCONNECTSPORTS IFCRELCONNECTSELEMENTS IFCSYSTEM IFCDISTRIBUTIONPORT IFCCLASSIFICATION IFCZONE IFCTYPEOBJECT; do
  printf "%s: %s\n" "$e" "$(grep -c "^#[0-9]*= *$e" 파일.ifc)"
done
```

## 핵심 질문

- [ ] 실무 파일에서 우리 파이프라인이 가장 먼저 깨지는 지점은 어디였는가?
- [ ] MEP 연결이 포트 기반으로 표현된 파일에서 계통 추적은 어떻게 되는가? (예상: 빈 결과)
- [ ] GlobalId는 재출력 시 안정적인가? (같은 모델의 두 버전을 구했다면 비교)
- [ ] BlenderBIM이 보여주는데 우리 뷰어가 못 보여주는 정보 3가지는?

## 우리 프로젝트에 주는 시사점

_(실습 후 채우기 — 여기가 사실상 다음 마일스톤 백로그가 된다)_
