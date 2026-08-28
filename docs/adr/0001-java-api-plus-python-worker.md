# ADR 0001. 플랫폼 API는 Java, IFC 처리는 Python 워커

- 상태: 채택 (2026-08-28)

## 맥락

BIM 기하 엔진(OpenCASCADE 기반 IfcOpenShell)과 IFC 도구 생태계(IDS, BCF, COBie)는 Python/C++에 있다. Java 쪽 IFC 라이브러리는 기하 엔진이 없고 AGPL(BIMserver 계열)이거나 갱신이 뜸하다. 반면 이력서의 주력은 Java/Spring이다.

## 결정

- `api`: Java 17 + Spring Boot 3 WebFlux. 모든 HTTP 계약, 스키마(Flyway), 도메인 로직 소유.
- `ifc-worker`: Python 3.12 + IfcOpenShell. IFC 파싱·변환·추출만 담당. HTTP 없음, DB 큐와 MinIO로만 통신.

## 대안

1. Python 단일(FastAPI) — 통합은 가장 쉽지만 이력서 주력 스택 어필 불가.
2. Java에서 IfcConvert 서브프로세스 호출 — 컨테이너 하나 줄지만 Java 이미지에 IfcOpenShell 바이너리 동봉 필요, 속성 추출은 결국 Python API가 편함.
3. Node(NestJS) + web-ifc — 대용량 IFC에 한계.

## 결과

- 컨테이너 1개 추가, 언어 2개. 경계는 DB 테이블(`conversion_job`)과 오브젝트 키 규약뿐.
- 면접 설명: "플랫폼은 Java, 도메인 특화 연산은 해당 생태계 언어의 사이드카".
