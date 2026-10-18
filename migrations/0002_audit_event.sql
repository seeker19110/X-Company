-- Nhật ký kiểm toán chỉ thêm, chuỗi băm theo công ty (SPEC-identity-org F-002, THREAT-MODEL T3/T5).
CREATE TABLE audit_event (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  chain_key text NOT NULL,
  occurred_at timestamptz NOT NULL,
  actor_user_id uuid,
  company_id uuid,
  action text NOT NULL CHECK (action <> ''),
  object_type text NOT NULL,
  object_id text,
  reason text,
  result text NOT NULL CHECK (result IN ('ok', 'denied', 'error')),
  before jsonb,
  after jsonb,
  request_id text,
  prev_hash text NOT NULL,
  hash text NOT NULL UNIQUE
);
CREATE INDEX audit_event_chain_idx ON audit_event (chain_key, seq);
CREATE INDEX audit_event_object_idx ON audit_event (object_type, object_id);

-- Chỉ thêm: role ứng dụng không UPDATE/DELETE, và trigger chặn với mọi role (trừ khi tắt trigger — để lại dấu).
REVOKE UPDATE, DELETE, TRUNCATE ON audit_event FROM xc_app_rw;

CREATE FUNCTION audit_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event chỉ thêm (append-only)' USING ERRCODE = 'insufficient_privilege';
END
$$;
CREATE TRIGGER audit_event_no_update BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION audit_event_immutable();
