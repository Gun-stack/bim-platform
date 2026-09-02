-- 02-data-model.md 와 1:1. 변경 시 문서도 갱신.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE project (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  location   geometry(Point, 4326),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES project ON DELETE CASCADE,
  name           text NOT NULL,
  ifc_schema     text CHECK (ifc_schema IN ('IFC2X3', 'IFC4', 'IFC4X3')),
  status         text NOT NULL DEFAULT 'UPLOADED'
                 CHECK (status IN ('UPLOADED', 'PROCESSING', 'READY', 'FAILED')),
  ifc_key        text NOT NULL,
  glb_key        text,
  footprint      geometry(Polygon, 4326),
  map_conversion jsonb,
  element_count  bigint,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX model_footprint_gist ON model USING GIST (footprint);

CREATE TABLE spatial_node (
  id        bigserial PRIMARY KEY,
  model_id  uuid NOT NULL REFERENCES model ON DELETE CASCADE,
  parent_id bigint REFERENCES spatial_node ON DELETE CASCADE,
  global_id text NOT NULL,
  ifc_class text NOT NULL,
  name      text,
  elevation real
);
CREATE INDEX spatial_node_model ON spatial_node (model_id);

CREATE TABLE element (
  id              bigserial PRIMARY KEY,
  model_id        uuid NOT NULL REFERENCES model ON DELETE CASCADE,
  global_id       text NOT NULL,
  ifc_class       text NOT NULL,
  name            text,
  spatial_node_id bigint REFERENCES spatial_node ON DELETE SET NULL,
  properties      jsonb NOT NULL DEFAULT '{}',
  UNIQUE (model_id, global_id)
);
CREATE INDEX element_model_class ON element (model_id, ifc_class);
CREATE INDEX element_properties  ON element USING GIN (properties jsonb_path_ops);

CREATE TABLE conversion_job (
  id          bigserial PRIMARY KEY,
  model_id    uuid NOT NULL REFERENCES model ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'PENDING'
              CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')),
  progress    int NOT NULL DEFAULT 0,
  attempts    int NOT NULL DEFAULT 0,
  error       text,
  started_at  timestamptz,
  finished_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversion_job_status ON conversion_job (status);

CREATE TABLE asset (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id     uuid NOT NULL REFERENCES model ON DELETE CASCADE,
  element_id   bigint REFERENCES element ON DELETE SET NULL,
  tag          text NOT NULL,
  category     text,
  status       text NOT NULL DEFAULT 'ACTIVE'
               CHECK (status IN ('ACTIVE', 'OUT_OF_SERVICE', 'RETIRED')),
  installed_on date,
  attributes   jsonb NOT NULL DEFAULT '{}',
  UNIQUE (model_id, tag)
);

CREATE TABLE inspection (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id     uuid NOT NULL REFERENCES asset ON DELETE CASCADE,
  inspected_on date NOT NULL DEFAULT CURRENT_DATE,
  result       text NOT NULL CHECK (result IN ('OK', 'DEFECT')),
  note         text
);

CREATE TABLE work_order (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id      uuid NOT NULL REFERENCES asset ON DELETE CASCADE,
  inspection_id uuid REFERENCES inspection ON DELETE SET NULL,
  title         text NOT NULL,
  status        text NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN', 'IN_PROGRESS', 'DONE')),
  assignee      text,
  due_on        date,
  viewpoint     jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
