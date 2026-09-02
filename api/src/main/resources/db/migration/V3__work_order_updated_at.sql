-- 작업지시 상태 변경 시각 (시간창 중복 억제용).
ALTER TABLE work_order ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
