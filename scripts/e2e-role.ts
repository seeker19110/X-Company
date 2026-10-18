// Tạo role đăng nhập cho ứng dụng trong E2E (thành viên xc_app_rw, không superuser) và in DATABASE_URL tương ứng.
import pg from "pg";

const admin = new URL(process.env.DATABASE_URL!);
const c = new pg.Client({ connectionString: admin.toString() });
await c.connect();
await c.query(`DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'xc_e2e_app') THEN
    CREATE ROLE xc_e2e_app LOGIN NOSUPERUSER NOBYPASSRLS INHERIT;
  END IF;
END $$`);
await c.query("ALTER ROLE xc_e2e_app WITH PASSWORD 'xc_e2e_app_pw'");
await c.query("GRANT xc_app_rw TO xc_e2e_app");
await c.end();
admin.username = "xc_e2e_app";
admin.password = "xc_e2e_app_pw";
process.stdout.write(admin.toString());
