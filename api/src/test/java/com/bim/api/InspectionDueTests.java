package com.bim.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

/** 점검 주기(attributes.intervalMonths)와 다음 점검일 계산: 마지막 점검(없으면 설치일, 그것도 없으면 오늘) + 주기. */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class InspectionDueTests {
	@Autowired JdbcClient db;
	@Autowired FmService fm;

	UUID modelId, assetId;

	@BeforeEach
	void seed() {
		db.sql("DELETE FROM project").update();
		UUID pid = db.sql("INSERT INTO project (name) VALUES ('t') RETURNING id").query(UUID.class).single();
		modelId = db.sql("INSERT INTO model (project_id, name, ifc_key) VALUES (:p, 'm', 'k') RETURNING id").param("p", pid).query(UUID.class).single();
		assetId = db.sql("INSERT INTO asset (model_id, tag) VALUES (:m, 'PUMP-01') RETURNING id").param("m", modelId).query(UUID.class).single();
	}

	private Object nextDueOn() { return fm.assets(modelId).getFirst().get("nextDueOn"); }

	@Test
	void nextDueFromLastInspectionPlusInterval() {
		assertThat(nextDueOn()).isNull();   // 주기 없으면 계산 안 함
		fm.patchAsset(assetId, new FmService.AssetPatch(null, null, 6));
		fm.inspect(assetId, new FmService.InspectionIn(LocalDate.of(2026, 1, 15), "OK", null));
		assertThat(String.valueOf(nextDueOn())).isEqualTo("2026-07-15");
		fm.patchAsset(assetId, new FmService.AssetPatch(null, null, 0));   // 0 = 해제
		assertThat(nextDueOn()).isNull();
	}

	@Test
	void nextDueWithoutInspectionFallsBackToToday() {
		fm.patchAsset(assetId, new FmService.AssetPatch(null, null, 3));
		assertThat(String.valueOf(nextDueOn())).isEqualTo(LocalDate.now().plusMonths(3).toString());
		Map<String, Object> a = fm.asset(assetId);
		assertThat(((Map<?, ?>) a.get("attributes")).get("intervalMonths")).isEqualTo(3);
	}
}
