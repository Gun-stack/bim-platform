-- 운영 이벤트 이력. 기존 "최근 이벤트"는 현재값(UpdatedAt)에서 유도해 다음 변경 때 이전 이벤트가 사라졌다.
-- append-only 로 "그때 값"을 남긴다. data 에 상태 패치 내용(계측값 포함)을 보존해 추후 트렌드 조회의 기반이 된다.
-- global_id 텍스트 참조: 재변환으로 element 행이 바뀌어도 이력이 살아남고, 조회 시 (model_id, global_id) 유니크로 조인한다.
CREATE TABLE op_event (
  id        bigserial PRIMARY KEY,
  model_id  uuid NOT NULL REFERENCES model ON DELETE CASCADE,
  at        timestamptz NOT NULL DEFAULT now(),
  kind      text NOT NULL CHECK (kind IN ('STATUS', 'WORK_ORDER')),
  global_id text,
  status    text,
  data      jsonb,
  wo_title  text
);
CREATE INDEX op_event_model_at ON op_event (model_id, at DESC);

-- 백필: 기존 화면이 유도해 보여주던 이벤트(현재값)를 실 이력의 첫 행으로 옮긴다
INSERT INTO op_event (model_id, at, kind, global_id, status)
SELECT model_id, (properties->'Pset_BimStatus'->>'UpdatedAt')::timestamptz, 'STATUS', global_id, properties->'Pset_BimStatus'->>'Status'
  FROM element WHERE properties->'Pset_BimStatus'->>'UpdatedAt' IS NOT NULL;
INSERT INTO op_event (model_id, at, kind, global_id, status, wo_title)
SELECT a.model_id, coalesce(w.updated_at, w.created_at), 'WORK_ORDER', e.global_id, w.status, w.title
  FROM work_order w JOIN asset a ON a.id = w.asset_id LEFT JOIN element e ON e.id = a.element_id;
