package com.bim.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/** 3D Tiles(R2-2): tileset_key 가 있을 때만 모델 응답에 tilesetUrl — glbUrl 과 같은 /files/{bucket}/ 경로 규칙 */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class TilesetUrlTests {
	@Autowired JdbcClient db;
	@Autowired ModelController models;

	@Test
	void tilesetUrlOnlyWhenPublished() {
		db.sql("DELETE FROM project").update();
		UUID pid = db.sql("INSERT INTO project (name) VALUES ('t') RETURNING id").query(UUID.class).single();
		UUID tiled = db.sql("INSERT INTO model (project_id, name, ifc_key, glb_key, tileset_key) VALUES (:p, 'a', 'k', 'glb/a/l.glb', 'glb/a/tiles/l/tileset.json') RETURNING id")
			.param("p", pid).query(UUID.class).single();
		UUID plain = db.sql("INSERT INTO model (project_id, name, ifc_key, glb_key) VALUES (:p, 'b', 'k', 'glb/b/l.glb') RETURNING id").param("p", pid).query(UUID.class).single();

		assertThat(models.get(tiled).get("tilesetUrl")).isEqualTo("/files/bim/glb/a/tiles/l/tileset.json");
		assertThat(models.get(tiled).get("glbUrl")).isEqualTo("/files/bim/glb/a/l.glb");   // 단일 GLB 도 그대로 — ?tiles=0·작은 모델
		assertThat(models.get(plain)).doesNotContainKey("tilesetUrl");
		assertThat(models.list(pid)).anySatisfy(m -> assertThat(m.get("tilesetUrl")).isEqualTo("/files/bim/glb/a/tiles/l/tileset.json"));
	}
}
