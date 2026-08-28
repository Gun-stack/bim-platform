-- 작업지시 우선순위·설명 (보드용). 02-data-model.md 와 1:1.
ALTER TABLE work_order ADD COLUMN priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT'));
ALTER TABLE work_order ADD COLUMN description text;
