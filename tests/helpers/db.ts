// DB thật cho test: mỗi file test có một database riêng sinh từ database mẫu đã migrate (nhanh, cô lập).
// Thiếu DATABASE_URL → ném lỗi (không skip — bẫy XBOSS TRAPS #2). Chạy qua scripts/with-test-db.sh.
import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { listMigrations, runMigrations } from "../../lib/db/migrate.ts";
import { PG_SESSION_OPTIONS, setPool } from "../../lib/db/index.ts";

export const APP_LOGIN = "xc_app_test";
// Mật khẩu của role test trên cụm test (không phải bí mật: cụm tạm/CI service, không có dữ liệu thật).
const APP_LOGIN_PW = "xc_app_test_pw";

function adminUrl(): URL {
  const raw = process.env.DATABASE_URL;
  if (raw === undefined || raw === "")
    throw new Error("Thiếu DATABASE_URL — chạy test qua scripts/with-test-db.sh (test DB không skip)");
  return new URL(raw);
}

function urlFor(db: string, login?: { user: string; password: string }): string {
  const u = adminUrl();
  u.pathname = `/${db}`;
  if (login) {
    u.username = login.user;
    u.password = login.password;
  }
  return u.toString();
}

async function adminQuery(sql: string, db = adminUrl().pathname.slice(1)): Promise<void> {
  const c = new pg.Client({ connectionString: urlFor(db) });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

async function ensureTemplate(): Promise<string> {
  const hash = createHash("sha256")
    .update(
      listMigrations()
        .map((m) => m.checksum)
        .join(),
    )
    .digest("hex")
    .slice(0, 12);
  const name = `xc_tpl_${hash}`;
  const c = new pg.Client({ connectionString: adminUrl().toString() });
  await c.connect();
  try {
    await c.query("SELECT pg_advisory_lock(424242)");
    const exists = await c.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (exists.rowCount === 0) {
      // Dựng dưới tên tạm rồi đổi tên: tiến trình bị giết giữa chừng không để lại template dở dang mang tên thật.
      const building = `${name}_build_${randomBytes(3).toString("hex")}`;
      await c.query(`CREATE DATABASE ${building}`);
      const pool = new pg.Pool({ connectionString: urlFor(building), max: 1 });
      try {
        await runMigrations(pool);
      } finally {
        await pool.end();
      }
      await c.query(`ALTER DATABASE ${building} RENAME TO ${name}`);
    }
    await c.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_LOGIN}') THEN
        CREATE ROLE ${APP_LOGIN} LOGIN NOSUPERUSER NOBYPASSRLS INHERIT;
      END IF;
    END $$`);
    await c.query(
      `ALTER ROLE ${APP_LOGIN} WITH LOGIN NOSUPERUSER NOBYPASSRLS INHERIT PASSWORD '${APP_LOGIN_PW}'`,
    );
    await c.query(`GRANT xc_app_rw TO ${APP_LOGIN}`);
    await c.query("SELECT pg_advisory_unlock(424242)");
  } finally {
    await c.end();
  }
  return name;
}

export interface TestDb {
  name: string;
  /** Pool role owner (dựng dữ liệu, kiểm bằng quyền cao). */
  admin: pg.Pool;
  /** Pool role ứng dụng — đúng quyền production. Đã gắn vào lib/db (getPool). */
  app: pg.Pool;
  close(): Promise<void>;
}

/** Database mới đã migrate cho một file test. Nhớ `after(() => db.close())`. */
export async function freshDb(): Promise<TestDb> {
  const tpl = await ensureTemplate();
  const name = `xc_t_${randomBytes(6).toString("hex")}`;
  await adminQuery(`CREATE DATABASE ${name} TEMPLATE ${tpl}`);
  const admin = new pg.Pool({ connectionString: urlFor(name), max: 4 });
  // Giống production: đăng nhập bằng role ứng dụng (thừa kế xc_app_rw), không SET ROLE.
  const app = new pg.Pool({
    connectionString: urlFor(name, { user: APP_LOGIN, password: APP_LOGIN_PW }),
    max: 6,
    options: PG_SESSION_OPTIONS,
  });
  setPool(app);
  return {
    name,
    admin,
    app,
    async close() {
      setPool(undefined);
      await app.end();
      await admin.end();
      await adminQuery(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    },
  };
}

/** Database trống chưa migrate (test bộ chạy migration). */
export async function emptyDb(): Promise<{ name: string; pool: pg.Pool; close(): Promise<void> }> {
  const name = `xc_e_${randomBytes(6).toString("hex")}`;
  await adminQuery(`CREATE DATABASE ${name}`);
  const pool = new pg.Pool({ connectionString: urlFor(name), max: 2 });
  return {
    name,
    pool,
    async close() {
      await pool.end();
      await adminQuery(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    },
  };
}
