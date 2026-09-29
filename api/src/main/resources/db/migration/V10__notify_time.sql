-- 관측성(R2-3): 알림 payload 에 발생 시각 t(ms epoch). clock_timestamp() = 트랜잭션 시작(now())이 아닌 실제 트리거 시각.
-- Notifier 가 dispatch 시각과의 차이를 bim_notify_lag_seconds 로, 부하 스크립트(load/sse-clients.mjs)가 수신 시각과의 차이를 종단 지연으로 잰다.
-- V8·V9 는 체크섬 때문에 수정 금지 → 같은 이름으로 CREATE OR REPLACE (트리거는 이름으로 함수를 부르므로 그대로). 웹은 t 를 쓰지 않는다(재조회 신호 규약 불변)
CREATE OR REPLACE FUNCTION notify_op_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('bim', json_build_object('m', NEW.model_id, 'k', lower(NEW.kind), 'g', NEW.global_id, 's', NEW.status,
    't', (extract(epoch FROM clock_timestamp()) * 1000)::bigint)::text);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION notify_conversion_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('bim', json_build_object('m', NEW.model_id, 'k', 'job', 's', NEW.status, 'p', NEW.progress,
    't', (extract(epoch FROM clock_timestamp()) * 1000)::bigint)::text);
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION notify_model_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('bim', json_build_object('m', NEW.id, 'k', 'job', 's', NEW.status,
    't', (extract(epoch FROM clock_timestamp()) * 1000)::bigint)::text);
  RETURN NULL;
END $$;
