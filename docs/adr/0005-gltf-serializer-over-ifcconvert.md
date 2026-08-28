# ADR 0005. glb 변환은 ifcopenshell.geom.serializers.gltf, IfcConvert 바이너리 없음

- 상태: 채택 (2026-08-28)

## 맥락

M0 worker 이미지는 `pip install ifcopenshell==0.8.5` 만으로 만들었고 IfcConvert 실행 파일은 없다. glb를 만드는 방법은 셋:

1. IfcConvert 바이너리를 이미지에 추가해 서브프로세스 호출
2. `geom.iterator` 로 순회하며 glb를 직접 조립(별도 glTF 라이브러리 필요)
3. `geom.iterator` + `geom.serializers.gltf` — IfcConvert 내부와 같은 C++ 직렬화기를 Python에서 호출

## 검증 (샘플 4종, 컨테이너 내부, 2026-08-28)

| 파일 | 요소 | 삼각형 | 시간 | glb |
|---|---|---|---|---|
| Building-Architecture | 14 | 1.2k | 0.1s | 0.1MB |
| Duplex_A_20110907 | 286 | 27.7k | 0.4s | 1.9MB |
| AC20-FZK-Haus | 107 | 24.2k | 0.6s | 1.4MB |
| example-project-location | 570 | 167k | 2.9s | 11.6MB |

- 3번 방식 4종 모두 성공. 결과 glb 2.0 헤더·길이 정상, node 이름 = IFC GlobalId(`use-element-guids`), material 포함.
- 1·2번 대비 시간 차이 없음(같은 iterator 위에서 돎). 2번은 직접 조립 코드와 의존성만 늘어남.

## 결정

3번. `worker/convert.py` 한 파일, 외부 바이너리·추가 의존성 없음.

설정: `use-world-coords=True`(glb는 월드좌표 필요), `weld-vertices=False`, serializer `use-element-guids=True`, 단위 METER. 스레드 = CPU 수.

## 결과

- 이미지 크기·빌드 그대로. Python 쪽에서 요소별 진행률(iterator 순회 카운트) 집계 가능 → M1-4 SSE 진행률에 그대로 쓴다.
- ADR 0002의 "IfcConvert `--use-element-guids`" 표현은 serializer 설정으로 읽으면 된다.
- glb 압축(Draco/meshopt)은 필요해지면 gltf-transform 후처리. 11.6MB/570요소면 아직 불필요.
