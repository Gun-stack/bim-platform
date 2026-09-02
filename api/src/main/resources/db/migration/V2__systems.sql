-- 설비 계통(M6).
CREATE TABLE system (
  id              bigserial PRIMARY KEY,
  model_id        uuid NOT NULL REFERENCES model ON DELETE CASCADE,
  global_id       text NOT NULL,
  name            text,
  predefined_type text,                       -- ELECTRICAL | DOMESTICCOLDWATER | WASTEWATER | FIREPROTECTION ...
  UNIQUE (model_id, global_id)
);

CREATE TABLE element_system (
  element_id bigint NOT NULL REFERENCES element ON DELETE CASCADE,
  system_id  bigint NOT NULL REFERENCES system ON DELETE CASCADE,
  PRIMARY KEY (element_id, system_id)
);
CREATE INDEX element_system_system ON element_system (system_id);

-- 흐름 방향 연결: from(상류) → to(하류). IfcRelConnectsElements(Description='FLOW') 에서 추출
CREATE TABLE connection (
  id              bigserial PRIMARY KEY,
  model_id        uuid NOT NULL REFERENCES model ON DELETE CASCADE,
  from_element_id bigint NOT NULL REFERENCES element ON DELETE CASCADE,
  to_element_id   bigint NOT NULL REFERENCES element ON DELETE CASCADE,
  UNIQUE (from_element_id, to_element_id)
);
CREATE INDEX connection_from ON connection (from_element_id);
CREATE INDEX connection_to   ON connection (to_element_id);
