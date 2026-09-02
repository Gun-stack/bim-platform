package com.bim.api;

import java.util.List;

/** 여러 쿼리가 같이 쓰는 SQL 조각 — 업무 규칙은 여기 한 곳에서만 고친다.
 *  별칭 약속: e = element, a = asset, sn = 요소의 공간 노드(층 또는 실), st = 그 부모 층. */
final class Sql {
	private Sql() {}

	/** 배관·덕트·트레이·케이블 같은 '선'. 장비 목록·자산 일괄 등록에서 제외 (IFC2x3 일반 클래스 IfcFlowSegment/Fitting 포함) */
	static final String SEGMENT_CLASSES = "('IfcPipeSegment', 'IfcCableCarrierSegment', 'IfcCableSegment', 'IfcDuctSegment', 'IfcFlowSegment', 'IfcFlowFitting')";

	/** 요소의 층·구역 — SELECT 열과 그에 필요한 JOIN. 실(IfcSpace)에 속하면 구역 = 실 이름, 층 = 그 부모 */
	static final String STOREY_ZONE_COLS = "coalesce(st.name, sn.name) storey, CASE WHEN sn.ifc_class = 'IfcSpace' THEN sn.name END zone";
	static final String STOREY_ZONE_JOIN = "LEFT JOIN spatial_node sn ON sn.id = e.spatial_node_id LEFT JOIN spatial_node st ON st.id = sn.parent_id AND st.ifc_class = 'IfcBuildingStorey'";

	/** 요소가 속한 계통 이름들(쉼표 결합, csv() 로 풀기) */
	static final String SYSTEMS_AGG = "(SELECT string_agg(s.name, ',' ORDER BY s.id) FROM element_system es JOIN system s ON s.id = es.system_id WHERE es.element_id = e.id) systems";

	/** 자산 롤업: 최근 점검일·결과, 열린 작업지시 수 */
	static final String ASSET_ROLLUP = """
		(SELECT max(inspected_on) FROM inspection i WHERE i.asset_id = a.id) "lastInspectedOn",
		(SELECT result FROM inspection i WHERE i.asset_id = a.id ORDER BY inspected_on DESC, id DESC LIMIT 1) "lastResult",
		(SELECT count(*) FROM work_order w WHERE w.asset_id = a.id AND w.status <> 'DONE') "openWorkOrders"
		""";

	/** 다음 점검일 = 마지막 점검(없으면 설치일, 그것도 없으면 오늘) + attributes.intervalMonths. 주기 없으면 NULL */
	static final String NEXT_DUE = """
		CASE WHEN a.id IS NOT NULL AND jsonb_exists(a.attributes, 'intervalMonths') THEN
		  (coalesce((SELECT max(inspected_on) FROM inspection i WHERE i.asset_id = a.id), a.installed_on, CURRENT_DATE)
		   + (a.attributes->>'intervalMonths')::int * interval '1 month')::date END "nextDueOn"
		""";

	/** 출발 요소(:id, :gid)가 속한 계통 집합 — 추적을 같은 계통 안으로 제한할 때 `es.system_id IN SYSTEM_SCOPE` */
	static final String SYSTEM_SCOPE = "(SELECT es0.system_id FROM element_system es0 JOIN element e0 ON e0.id = es0.element_id WHERE e0.model_id = :id AND e0.global_id = :gid)";

	/** string_agg 결과 → 리스트 (NULL 이면 빈 리스트) */
	static List<String> csv(Object agg) { return agg == null ? List.of() : List.of(((String) agg).split(",")); }
}
