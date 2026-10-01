package com.bim.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

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

	@Test
	void hugeIntervalRejectedWithoutBreakingAssetsQuery() {
		assertThatThrownBy(() -> fm.patchAsset(assetId, new FmService.AssetPatch(null, null, 3600000)))
			.isInstanceOf(ApiErrors.BadRequest.class);
		assertThat(fm.assets(modelId)).hasSize(1);   // 거부된 값이 저장되지 않아 쿼리 전체가 깨지지 않는다
	}

	@Test
	void boundaryIntervalMonths600AcceptedAnd601Rejected() {
		fm.patchAsset(assetId, new FmService.AssetPatch(null, null, 600));
		assertThat(((Map<?, ?>) fm.asset(assetId).get("attributes")).get("intervalMonths")).isEqualTo(600);
		assertThatThrownBy(() -> fm.patchAsset(assetId, new FmService.AssetPatch(null, null, 601)))
			.isInstanceOf(ApiErrors.BadRequest.class);
	}

	@Test
	void createAssetRejectsHugeOrNonNumericIntervalInAttributes() {
		assertThatThrownBy(() -> fm.createAsset(modelId, new FmService.AssetIn(null, "A-1", null, null, Map.of("intervalMonths", 3600000))))
			.isInstanceOf(ApiErrors.BadRequest.class);
		assertThatThrownBy(() -> fm.createAsset(modelId, new FmService.AssetIn(null, "A-2", null, null, Map.of("intervalMonths", "abc"))))
			.isInstanceOf(ApiErrors.BadRequest.class);
		assertThat(fm.assets(modelId)).hasSize(1);   // 둘 다 거부 — seed 의 PUMP-01만 남는다
	}

	@Test
	void readSideGuardsBadIntervalWrittenDirectly() {
		// patchAsset/createAsset 검증을 우회해 attributes 에 직접 쓴 값 — NEXT_DUE 가 이 값을 다시 신뢰하지 않아야 한다
		db.sql("UPDATE asset SET attributes = '{\"intervalMonths\": \"abc\"}'::jsonb WHERE id = :id").param("id", assetId).update();
		assertThat(fm.assets(modelId)).hasSize(1);
		assertThat(nextDueOn()).isNull();
		db.sql("UPDATE asset SET attributes = '{\"intervalMonths\": 3600000}'::jsonb WHERE id = :id").param("id", assetId).update();
		assertThat(fm.assets(modelId)).hasSize(1);
		assertThat(nextDueOn()).isNull();
	}
}
