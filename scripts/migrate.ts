// npm run db:migrate — áp migration bằng role owner (MIGRATE_DATABASE_URL), không bao giờ dùng DATABASE_URL.
import pg from "pg";
import { runMigrations } from "../lib/db/migrate.ts";

const url = process.env.MIGRATE_DATABASE_URL?.trim();
if (!url) {
  console.error("Thiếu MIGRATE_DATABASE_URL (role migration riêng; DATABASE_URL chỉ cho runtime).");
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const ran = await runMigrations(pool);
  console.log(ran.length ? `Đã áp: ${ran.join(", ")}` : "Không có migration mới.");
} finally {
  await pool.end();
}
