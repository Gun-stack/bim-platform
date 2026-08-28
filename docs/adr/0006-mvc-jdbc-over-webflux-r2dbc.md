# ADR 0006. api 는 Spring MVC + JDBC (WebFlux + R2DBC 에서 전환)

- 상태: 채택 (2026-08-28). ADR 0001 의 "WebFlux / R2DBC" 결정을 대체한다.

## 맥락

M0 골격은 WebFlux + R2DBC 로 생성했다. M1 컨트롤러를 짜기 시작한 시점에서 재검토.

## 결정

Spring MVC (Tomcat) + Spring Data JDBC(`JdbcClient`) + Java 25 가상 스레드(`spring.threads.virtual.enabled=true`).

## 이유

1. **PostGIS**: R2DBC(r2dbc-postgresql)도 JTS 를 두면 geometry 코덱이 붙고, JDBC(pgjdbc)도 기본은 `PGobject` 텍스트다. 양쪽 다 `ST_AsGeoJSON`/`ST_GeomFromGeoJSON` 텍스트 우회가 실용적이라 결정적 차이는 없다. 그럴 거면 단순한 쪽.
2. **데이터소스 이중화 해소**: Flyway 가 JDBC 를 요구해 R2DBC 와 두 개를 들고 있었다.
3. **논블로킹 이득 없음**: 무거운 작업(IFC 변환)은 worker 가 전담. api 는 CRUD + 업로드 중계. 동시 사용자 수십 명 규모.
4. **가상 스레드**: 블로킹 I/O 의 스레드 비용이 사라져 리액티브 체인 없이도 동일 효과. 코드·스택트레이스가 단순. Java 25 는 JEP 491(`synchronized` 핀닝 해소) 포함이라 pgjdbc·Tomcat 과 궁합 문제 없음 — "이제야 MVC 로 돌아가도 되는" 이유.

## 영향

- SSE 진행률: `SseEmitter` (1초 폴링 방식 그대로).
- 업로드: `MultipartFile` → 임시파일 → S3 `putObject`. 상한 `spring.servlet.multipart.max-file-size=500MB`, nginx 와 동일.
- 리액티브 타입(`Mono/Flux`) 코드 없음. 트랜잭션은 `TransactionTemplate` (같은 클래스 내부 호출은 `@Transactional` 프록시를 안 탄다).
- 업로드 순서는 S3 put → DB insert. DB 실패 시 방금 올린 객체를 삭제한다 (2PC 없음, 삭제마저 실패하면 고아 — 현 규모에선 허용).
- 에러 메시지 노출은 `spring.web.error.include-message` (Boot 4 에서 `server.error.*` 가 옮겨감).
- 테스트: `testcontainers-r2dbc` 제거, `spring-boot-starter-webmvc-test` + `data-jdbc-test`. `@ServiceConnection` PostgreSQLContainer 는 JDBC 에 그대로 적용.
- 설정 파일 `application.yaml`(r2dbc) 삭제, `application.yml` 로 일원화.
