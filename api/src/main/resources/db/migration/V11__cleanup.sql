-- R3-1 Task 9: 호출처 없는 열·인덱스 삭제 (P108·P100)
-- element_properties: jsonb_path_ops GIN, @>/jsonpath 사용처 없음(idx_scan 0) — 상태 PATCH 마다 쓰기만 증폭
DROP INDEX IF EXISTS element_properties;
-- project.location: 어디서도 조회·기록 안 함(ProjectController "M3" 주석만 남아 있었음)
ALTER TABLE project DROP COLUMN IF EXISTS location;
-- model_footprint_gist: bbox 필터(유일한 공간 술어) 삭제로 && 질의가 없어짐 — 남은 footprint 사용은 ST_AsGeoJSON/Centroid/Area 뿐, GiST 불필요
DROP INDEX IF EXISTS model_footprint_gist;
