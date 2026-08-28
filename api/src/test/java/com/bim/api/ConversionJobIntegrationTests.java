package com.bim.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.simple.JdbcClient;

/** PostgreSQL contracts shared by the API migrations and the polling worker. */
@Import(TestcontainersConfiguration.class)
@SpringBootTest
class ConversionJobIntegrationTests {

	private static final String RECOVER_STALE_JOBS = """
		WITH recovered AS (
		  UPDATE conversion_job
		     SET status = CASE WHEN attempts >= 3 THEN 'FAILED' ELSE 'PENDING' END,
		         error = CASE WHEN attempts >= 3 THEN 'stale after ' || attempts || ' attempts' END,
		         finished_at = CASE WHEN attempts >= 3 THEN now() END,
		         lease_owner = NULL
		   WHERE status='RUNNING'
		     AND COALESCE(heartbeat_at, started_at) < now() - interval '10 minutes'
		  RETURNING model_id, status
		)
		UPDATE model m SET status='FAILED'
		 WHERE m.id IN (SELECT model_id FROM recovered WHERE status='FAILED')
		""";

	@Autowired JdbcClient db;
	@Autowired ModelController models;

	@BeforeEach
	void cleanDatabase() {
		db.sql("DELETE FROM project").update();
	}

	@Test
	void v5AddsLeaseColumnsAndOneActiveJobConstraint() {
		var columns = db.sql("""
			SELECT column_name FROM information_schema.columns
			 WHERE table_schema='public' AND table_name='conversion_job'
			   AND column_name IN ('heartbeat_at', 'lease_owner')
			 ORDER BY column_name
			""").query(String.class).list();
		assertThat(columns).containsExactly("heartbeat_at", "lease_owner");

		UUID modelId = newModel("UPLOADED");
		newJob(modelId, "PENDING", 0, "now()", null);
		assertThatThrownBy(() -> newJob(modelId, "RUNNING", 1, "now()", UUID.randomUUID()))
			.isInstanceOf(DataIntegrityViolationException.class);

		db.sql("UPDATE conversion_job SET status='DONE' WHERE model_id=:id")
			.param("id", modelId).update();
		newJob(modelId, "PENDING", 0, "now()", null);
		assertThat(jobCount(modelId)).isEqualTo(2);
	}

	@Test
	void recoveryFailsTerminalStaleJobAndSynchronizesModel() {
		UUID modelId = newModel("PROCESSING");
		newJob(modelId, "RUNNING", 3, "now() - interval '11 minutes'", UUID.randomUUID());

		db.sql(RECOVER_STALE_JOBS).update();

		Map<String, Object> job = latestJob(modelId);
		assertThat(job.get("status")).isEqualTo("FAILED");
		assertThat(job.get("error")).isEqualTo("stale after 3 attempts");
		assertThat(job.get("finished_at")).isNotNull();
		assertThat(job.get("lease_owner")).isNull();
		assertThat(modelStatus(modelId)).isEqualTo("FAILED");
	}

	@Test
	void recoveryUsesHeartbeatAndOnlyRequeuesExpiredLease() {
		UUID healthyModel = newModel("PROCESSING");
		UUID expiredModel = newModel("PROCESSING");
		UUID healthyOwner = UUID.randomUUID();
		newJob(healthyModel, "RUNNING", 1, "now()", healthyOwner);
		newJob(expiredModel, "RUNNING", 1, "now() - interval '11 minutes'", UUID.randomUUID());

		db.sql(RECOVER_STALE_JOBS).update();

		assertThat(latestJob(healthyModel))
			.containsEntry("status", "RUNNING")
			.containsEntry("lease_owner", healthyOwner);
		assertThat(modelStatus(healthyModel)).isEqualTo("PROCESSING");
		assertThat(latestJob(expiredModel))
			.containsEntry("status", "PENDING")
			.containsEntry("attempts", 1)
			.containsEntry("lease_owner", null);
		assertThat(modelStatus(expiredModel)).isEqualTo("PROCESSING");
	}

	@Test
	void retryPreservesHistoryAndReturnsNewPendingState() {
		UUID modelId = newModel("FAILED");
		newJob(modelId, "FAILED", 3, "now() - interval '11 minutes'", null);

		Map<String, Object> result = models.retry(modelId);

		assertThat(result)
			.containsEntry("status", "UPLOADED")
			.containsEntry("jobStatus", "PENDING")
			.containsEntry("progress", 0)
			.containsEntry("attempts", 0);
		assertThat(jobCount(modelId)).isEqualTo(2);
	}

	private UUID newModel(String status) {
		UUID projectId = db.sql("INSERT INTO project (name) VALUES ('test') RETURNING id")
			.query(UUID.class).single();
		return db.sql("""
			INSERT INTO model (project_id, name, status, ifc_key)
			VALUES (:project, 'test.ifc', :status, 'models/test/source.ifc') RETURNING id
			""").param("project", projectId).param("status", status).query(UUID.class).single();
	}

	private void newJob(UUID modelId, String status, int attempts, String heartbeatExpression, UUID owner) {
		db.sql("""
			INSERT INTO conversion_job
			  (model_id, status, attempts, started_at, heartbeat_at, lease_owner)
			VALUES (:model, :status, :attempts, now() - interval '30 minutes',
			        %s, :owner)
			""".formatted(heartbeatExpression))
			.param("model", modelId).param("status", status).param("attempts", attempts)
			.param("owner", owner).update();
	}

	private Map<String, Object> latestJob(UUID modelId) {
		return db.sql("""
			SELECT status, attempts, error, finished_at, lease_owner
			  FROM conversion_job WHERE model_id=:id ORDER BY id DESC LIMIT 1
			""").param("id", modelId).query().singleRow();
	}

	private long jobCount(UUID modelId) {
		return db.sql("SELECT count(*) FROM conversion_job WHERE model_id=:id")
			.param("id", modelId).query(Long.class).single();
	}

	private String modelStatus(UUID modelId) {
		return db.sql("SELECT status FROM model WHERE id=:id")
			.param("id", modelId).query(String.class).single();
	}
}
