package com.bim.api;

import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;

/** 운영 이벤트(op_event) 적재. 상태·작업지시의 "그때 값"을 append — 현재값 유도 방식은 다음 변경에 이전 이벤트가 사라졌다 (V6). */
final class OpEvents {
	private OpEvents() {}

	/** 상태 패치 직후: 병합 결과의 Status 와 패치 내용(data — 계측값 포함)을 남긴다 */
	static void status(JdbcClient db, UUID modelId, String globalId, String patchJson) {
		db.sql("""
			INSERT INTO op_event (model_id, kind, global_id, status, data)
			SELECT :m, 'STATUS', :g, properties->'Pset_BimStatus'->>'Status', :d::jsonb
			  FROM element WHERE model_id = :m AND global_id = :g""")
			.param("m", modelId).param("g", globalId).param("d", patchJson).update();
	}

	/** 작업지시 생성·재오픈·상태 변경 직후 */
	static void workOrder(JdbcClient db, UUID woId) {
		db.sql("""
			INSERT INTO op_event (model_id, kind, global_id, status, wo_title)
			SELECT a.model_id, 'WORK_ORDER', e.global_id, w.status, w.title
			  FROM work_order w JOIN asset a ON a.id = w.asset_id LEFT JOIN element e ON e.id = a.element_id
			 WHERE w.id = :w""").param("w", woId).update();
	}
}
