-- 3D Tiles(R2-2): 워커가 GLB 를 대지 → 동 외피 → 층 타일로 나눠 glb/{model}/tiles/{lease}/ 에 올리고 glb_key 와 같은 트랜잭션에서 이 키를 공개한다.
-- NULL = 타일 없음(생성 실패·이전 모델) → 뷰어는 단일 GLB
ALTER TABLE model ADD COLUMN tileset_key text;

-- 홈 카드가 status 만 바뀌어도(진행률 갱신 전) 즉시 갱신되도록 — R2-3 이 이 함수를 CREATE OR REPLACE 한다
CREATE FUNCTION notify_model_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_notify('bim', json_build_object('m', NEW.id, 'k', 'job', 's', NEW.status)::text);
  RETURN NULL;
END $$;
CREATE TRIGGER model_status_notify AFTER UPDATE OF status ON model FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION notify_model_status();
