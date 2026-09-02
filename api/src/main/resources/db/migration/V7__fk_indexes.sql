-- 규모 측정(2026-09-02)에서 나온 것: 모니터링·자산 대장 쿼리는 자산마다 inspection·work_order 를 상관 서브쿼리로 읽는데
-- FK 열에 인덱스가 없어 행마다 seq scan 이었다 (자산 566개 모델에서 서브플랜 loops=566 × 4). 지금은 표가 작아 100ms 대지만 자산 수에 비례해 커진다.
CREATE INDEX inspection_asset ON inspection (asset_id, inspected_on DESC);
CREATE INDEX work_order_asset ON work_order (asset_id, status);
CREATE INDEX asset_element ON asset (element_id);
-- 경보 통계(monitor/stats)는 요소별 이벤트 순서를 본다
CREATE INDEX op_event_model_gid_at ON op_event (model_id, global_id, at);
