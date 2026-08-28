# ADR 0003. 잡 큐는 PostgreSQL 테이블 폴링

- 상태: 채택 (2026-08-28)

## 맥락

api가 변환 잡을 만들고 worker가 소비한다. 워커는 1개(많아야 2~3개), 잡은 분 단위. Redis/RabbitMQ 경험은 이력서에 있지만, 컨테이너 수와 운영 표면을 늘릴 이유가 없다.

## 결정

```sql
UPDATE conversion_job SET status='RUNNING', started_at=now()
WHERE id = (SELECT id FROM conversion_job WHERE status='PENDING'
            ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED)
RETURNING *;
```

worker는 2초 간격 폴링. 진행률은 같은 행의 `progress` 갱신. `RUNNING` 인데 `started_at` 이 10분 넘은 잡은 worker 기동 시 `PENDING` 으로 복구.

## 대안

- Redis Streams / RabbitMQ: 컨테이너 +1, 별도 장애 지점. 처리량이 필요할 때.
- LISTEN/NOTIFY: 폴링 지연을 없앨 수 있음. 2초 지연이 문제 되면 교체 (스키마 변경 없음).

## 결과

- 트랜잭션 하나로 잡 상태와 모델 상태를 원자적으로 갱신 가능.
- ponytail: 폴링 큐. 초당 잡 수십 건이 되면 브로커로.
