-- 실시간 푸시(R2-1): 운영 이벤트·변환 진행률을 NOTIFY 로. API 의 Notifier 가 LISTEN bim → 모델별 SSE 로 팬아웃.
-- 트리거인 이유: 워커(Python)가 conversion_job 을 직접 갱신 — API 에서만 발행하면 진행률이 빠진다. NOTIFY 는 커밋 때만 전달.
CREATE FUNCTION notify_op_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('bim', json_build_object('m', NEW.model_id, 'k', lower(NEW.kind), 'g', NEW.global_id, 's', NEW.status)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER op_event_notify AFTER INSERT ON op_event FOR EACH ROW EXECUTE FUNCTION notify_op_event();

CREATE FUNCTION notify_conversion_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('bim', json_build_object('m', NEW.model_id, 'k', 'job', 's', NEW.status, 'p', NEW.progress)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER conversion_job_notify AFTER UPDATE OF status, progress ON conversion_job FOR EACH ROW EXECUTE FUNCTION notify_conversion_job();
