-- Role nhóm của ứng dụng: không superuser, không BYPASSRLS, không owner bảng (THREAT-MODEL T12).
-- Môi trường thật: DBA tạo trước role đăng nhập và GRANT xc_app_rw cho nó; migration chạy bằng role owner riêng.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xc_app_rw') THEN
    CREATE ROLE xc_app_rw NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO xc_app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO xc_app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO xc_app_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO xc_app_rw;
