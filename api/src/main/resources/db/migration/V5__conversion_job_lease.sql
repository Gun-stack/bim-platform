ALTER TABLE conversion_job
  ADD COLUMN heartbeat_at timestamptz,
  ADD COLUMN lease_owner uuid;

CREATE INDEX conversion_job_running_heartbeat
  ON conversion_job (heartbeat_at)
  WHERE status = 'RUNNING';

-- A model may have history, but only one job may currently own or await conversion.
CREATE UNIQUE INDEX conversion_job_one_active_per_model
  ON conversion_job (model_id)
  WHERE status IN ('PENDING', 'RUNNING');
