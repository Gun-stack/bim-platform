package com.bim.api;

import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.*;

/** 지도(M3): 풋프린트 GeoJSON, 수동 핀. 좌표계 변환은 전부 PostGIS. */
@RestController
@RequestMapping("/api")
class MapController {
	private final JdbcClient db;
	MapController(JdbcClient db) { this.db = db; }

	/** 지도용 FeatureCollection: 풋프린트 있는 모델 (bbox 는 "minLon,minLat,maxLon,maxLat", 없으면 전체) */
	@GetMapping("/map/footprints")
	Map<String, Object> footprints(@RequestParam(required = false) String bbox) {
		double[] b = bbox == null ? null : Arrays.stream(bbox.split(",")).mapToDouble(Double::parseDouble).toArray();
		if (b != null && b.length != 4) throw new ApiErrors.BadRequest("bbox=minLon,minLat,maxLon,maxLat");
		var rows = db.sql("""
			SELECT m.id, m.name, m.ifc_schema "ifcSchema", m.element_count "elementCount", m.status, p.name "projectName",
			       m.map_conversion->>'source' "georefSource", m.map_conversion->>'crs' crs, (m.map_conversion->>'manual')::boolean manual,
			       ST_AsGeoJSON(m.footprint)::text geom, ST_X(ST_Centroid(m.footprint)) lon, ST_Y(ST_Centroid(m.footprint)) lat,
			       round(ST_Area(m.footprint::geography)) "areaM2"
			  FROM model m JOIN project p ON p.id = m.project_id
			 WHERE m.footprint IS NOT NULL
			   AND (:b0::float8 IS NULL OR m.footprint && ST_MakeEnvelope(:b0, :b1, :b2, :b3, 4326))
			 ORDER BY m.created_at DESC""")
			.param("b0", b == null ? null : b[0]).param("b1", b == null ? null : b[1]).param("b2", b == null ? null : b[2]).param("b3", b == null ? null : b[3])
			.query().listOfRows();
		List<Map<String, Object>> features = rows.stream().map(r -> {
			var geom = Json.parse((String) r.remove("geom"));
			return Map.of("type", "Feature", "id", r.get("id").toString(), "geometry", geom, "properties", r);
		}).toList();
		return Map.of("type", "FeatureCollection", "features", features);
	}

	/** 지리참조 없는 모델의 수동 배치: 핀(lon, lat) + 회전(deg, 기본 0).
	 *  기하 XY 폭(worker 가 map_conversion.bbox 에 저장)으로 사각형을 만들고, 핀 중심의 정거방위 투영(aeqd, m) → 4326 으로 옮긴다. 위도 왜곡 없음. */
	record Pin(double lon, double lat, Double rotation) {}
	@PutMapping("/models/{id}/footprint")
	Map<String, Object> pin(@PathVariable UUID id, @RequestBody Pin p) {
		if (Math.abs(p.lat()) > 90 || Math.abs(p.lon()) > 180) throw new ApiErrors.BadRequest("lon/lat out of range");
		double rot = p.rotation() == null ? 0 : p.rotation();
		int n = db.sql("""
			WITH b AS (SELECT coalesce((map_conversion->'bbox'->>0)::float8, -10) x0, coalesce((map_conversion->'bbox'->>1)::float8, -10) y0,
			                  coalesce((map_conversion->'bbox'->>2)::float8, 10) x1, coalesce((map_conversion->'bbox'->>3)::float8, 10) y1
			             FROM model WHERE id = :id)
			UPDATE model SET
			  footprint = ST_SetSRID(ST_Transform(
			                ST_SetSRID(ST_Rotate(ST_MakeEnvelope(-(b.x1 - b.x0) / 2, -(b.y1 - b.y0) / 2, (b.x1 - b.x0) / 2, (b.y1 - b.y0) / 2), radians(:rot)), 0),
			                '+proj=aeqd +lat_0=' || :lat || ' +lon_0=' || :lon || ' +datum=WGS84 +units=m +no_defs', 'EPSG:4326'), 4326),
			  map_conversion = coalesce(map_conversion, '{}'::jsonb) || jsonb_build_object('source', 'manual', 'manual', true, 'lon', :lon, 'lat', :lat, 'rotation', :rot)
			FROM b WHERE model.id = :id""")
			.param("id", id).param("lon", p.lon()).param("lat", p.lat()).param("rot", rot).update();
		if (n == 0) throw new ApiErrors.NotFound("model " + id);
		return db.sql("SELECT id, ST_AsGeoJSON(footprint)::text geom, map_conversion::text mc FROM model WHERE id = :id").param("id", id).query().listOfRows().stream()
			.map(r -> Map.<String, Object>of("id", r.get("id"), "footprint", Json.parse((String) r.get("geom")), "mapConversion", Json.parse((String) r.get("mc")))).findFirst().orElseThrow();
	}
}
