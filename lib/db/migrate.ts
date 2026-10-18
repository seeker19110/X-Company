// Bộ chạy migration không ORM: áp các file `migrations/NNNN_*.sql` theo thứ tự tên, mỗi file một giao dịch, ghi
// `schema_migrations` kèm checksum SHA-256. File đã áp mà bị sửa → lỗi (migration append-only — ARCHITECTURE).
// Chép có chọn lọc từ xboss@e64b77b:lib/db/migrate.ts (khoá advisory, mỗi file một giao dịch, role migration
// riêng), thêm checksum và tham số thư mục để test.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";

export const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");
const MIGRATION_LOCK_KEY = 731_904_552;
const NAME_RE = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export function listMigrations(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  const names = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const seen = new Set<string>();
  return names.map((name) => {
    if (!NAME_RE.test(name)) throw new Error(`Tên migration sai quy ước NNNN_ten.sql: ${name}`);
    const num = name.slice(0, 4);
    if (seen.has(num)) throw new Error(`Trùng số migration ${num}`);
    seen.add(num);
    const sql = readFileSync(path.join(dir, name), "utf8");
    return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  });
}

/** Áp mọi migration chưa chạy; trả danh sách vừa áp. Chạy bằng role migration (owner), không phải role ứng dụng. */
export async function runMigrations(pool: Pool, dir: string = MIGRATIONS_DIR): Promise<string[]> {
  const files = listMigrations(dir);
  const client = await pool.connect();
  const ran: string[] = [];
  try {
    await client.query("SET statement_timeout = 0");
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM schema_migrations",
    );
    const applied = new Map(rows.map((r) => [r.name, r.checksum]));
    for (const [name, checksum] of applied) {
      const f = files.find((x) => x.name === name);
      if (!f) throw new Error(`Migration đã áp ${name} không còn trong thư mục — migration là append-only`);
      if (f.checksum !== checksum)
        throw new Error(`Migration đã áp ${name} bị sửa (checksum khác) — tạo file mới`);
    }
    for (const f of files) {
      if (applied.has(f.name)) continue;
      try {
        await client.query("BEGIN");
        await client.query(f.sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [
          f.name,
          f.checksum,
        ]);
        await client.query("COMMIT");
        ran.push(f.name);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Migration ${f.name} lỗi: ${err instanceof Error ? err.message : String(err)}`, {
          cause: err,
        });
      }
    }
    return ran;
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}
