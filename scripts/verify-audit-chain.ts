// npm run audit:verify — kiểm chuỗi băm audit_event; exit 1 và in id hàng đầu tiên sai (S-ID-08).
import pg from "pg";
import { verifyAuditChain } from "../lib/audit/index.ts";

const url = process.env.DATABASE_URL?.trim();
if (url === undefined || url === "") {
  console.error("Thiếu DATABASE_URL");
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  const r = await verifyAuditChain(pool);
  if (r.ok) console.log(`✓ Chuỗi audit hợp lệ (${r.checked} bản ghi).`);
  else {
    console.error(`✗ Chuỗi audit sai tại ${r.firstBadId}: ${r.problem}`);
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
