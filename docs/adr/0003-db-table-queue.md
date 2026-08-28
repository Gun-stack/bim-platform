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

worker는 2초 간격 폴링. 진행률은 같은 행의 `progress` 갱신. `RUNNING` 인데 `started_at` 이 10분 넘은 잡은 매 폴링 회전에서 `PENDING` 으로 복구 (기동 시에만 하면 hang된 잡을 못 잡는다).

**갱신 (2026-08-28, V5)**: `started_at` 기준 회수는 오래 걸리는 정상 변환도 회수해 버린다 → `heartbeat_at`(worker 가 30초마다 갱신) 기준으로 바꾸고, 잡을 잡을 때 `lease_owner`(worker 인스턴스 uuid) 를 기록해 진행률·완료·실패 UPDATE 는 owner 일치 시에만. 회수된 잡을 원래 worker 가 뒤늦게 덮어쓰는 경합을 막는다. 모델당 활성 잡(PENDING/RUNNING)은 부분 unique 인덱스로 1개.

## 대안

- Redis Streams / RabbitMQ: 컨테이너 +1, 별도 장애 지점. 처리량이 필요할 때.
- LISTEN/NOTIFY: 폴링 지연을 없앨 수 있음. 2초 지연이 문제 되면 교체 (스키마 변경 없음).

## 결과

- 트랜잭션 하나로 잡 상태와 모델 상태를 원자적으로 갱신 가능.
- ponytail: 폴링 큐. 초당 잡 수십 건이 되면 브로커로.
