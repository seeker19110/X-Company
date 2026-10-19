// i18n-ignore-file: báo cáo diễn tập cho vận hành (không tới người dùng cuối)
// npm run -s kms:drill — diễn tập xoay khoá KMS (SEC-SECRET-008): OpenBao THẬT cục bộ (scripts/kms-dev.sh run) + Postgres tạm.
// Ghi N dòng dữ liệu mã hoá + vài tệp → `rotate` khoá chủ (token vận hành) → `rotateKeys`/`rotateFiles` (rewrap, không đọc dữ liệu rõ) →
// đọc lại TẤT CẢ → đo thời lượng → thêm một dòng vào docs/security/rotation-log.md. Nhãn: faithful-fixture (máy dev, không staging thật).
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { registerKms } from "../adapters/register-kms.ts";
import { openTextAsync, textColumn } from "../lib/crypto/columns.ts";
import { rotateFiles, rotateKeys, verifyFiles } from "../lib/crypto/rotate.ts";
import { TransitKms, keyProvider, transitConfig } from "../lib/crypto/kms.ts";
import { withTx } from "../lib/db/index.ts";
import { diskStorage } from "../lib/files/storage.ts";
import { createEmployee } from "../lib/org/index.ts";
import { env } from "../lib/nen/env.ts";
import { freshDb } from "../tests/helpers/db.ts";
import { seedCompany, setTestEnv } from "../tests/helpers/fixtures.ts";

const ROWS = Number(process.env.KMS_DRILL_ROWS ?? 200);
const LOG = "docs/security/rotation-log.md";
setTestEnv();
registerKms();
const opsToken = process.env.KMS_TRANSIT_OPS_TOKEN;
if (keyProvider().name !== "transit" || !opsToken) {
  console.error("kms:drill cần KMS thật: chạy qua `npm run -s kms:drill` (scripts/kms-dev.sh run).");
  process.exit(2);
}
const db = await freshDb();
const root = mkdtempSync(path.join(tmpdir(), "xc-drill-files-"));
let status = "ĐẠT";
let detail = "";
const t0 = Date.now();
try {
  const { companyId } = await seedCompany();
  const ids: string[] = [];
  for (let i = 0; i < ROWS; i++)
    ids.push(
      await withTx((tx) =>
        createEmployee(tx, { userId: null }, companyId, {
          code: `D${i}`,
          fullName: `NV ${i}`,
          phone: `09${String(i).padStart(8, "0")}`,
        }),
      ),
    );
  const st = diskStorage(root);
  for (let i = 0; i < 5; i++) await st.put(randomBytes(70_000));
  const col = textColumn("employee", "phone");
  const readAll = async () => {
    for (const [i, id] of ids.entries()) {
      const r = (await db.admin.query("SELECT phone_enc FROM employee WHERE id = $1", [id])).rows[0]!;
      if ((await openTextAsync(col, id, r)) !== `09${String(i).padStart(8, "0")}`)
        throw new Error("đọc sai dữ liệu");
    }
    return ids.length;
  };
  await readAll();
  const tRot = Date.now();
  const cfg = transitConfig();
  const ops = new TransitKms(
    { ...cfg, token: opsToken },
    (await import("../adapters/kms-transit-http.ts")).fetchTransitTransport(() => cfg.addr),
  );
  const version = await ops.rotate();
  const rep = (await rotateKeys(db.app)).find((x) => x.target === "employee.phone")!;
  const files = await rotateFiles(root);
  const n = await readAll();
  const nf = await verifyFiles(root);
  if (rep.stale !== 0 || rep.reencrypted !== 0 || rep.rewrapped === 0)
    throw new Error(`rotateKeys bất thường: ${JSON.stringify(rep)}`);
  detail = `khoá chủ → v${version}; rewrap ${rep.rewrapped} dòng + ${files.rewrapped} tệp; đọc lại ${n} dòng, ${nf} tệp`;
  const sec = ((Date.now() - tRot) / 1000).toFixed(2);
  const row = `| ${new Date().toISOString().slice(0, 10)} | OpenBao ${process.env.KMS_DRILL_VERSION ?? "2.7.1"} cục bộ (raft+TLS tự ký), Postgres tạm, máy dev | ${ROWS} dòng + 5 tệp | ${detail} | ${sec} s (< 60 phút) | ${status} |\n`;
  try {
    // "wx": tạo nguyên tử, không kiểm-rồi-mở (CWE-367); đã có thì giữ nguyên và chỉ nối dòng
    writeFileSync(
      LOG,
      "---\ntitle: Nhật ký diễn tập xoay khoá (SEC-SECRET-008)\nstatus: faithful-fixture — diễn tập cục bộ tự động, KHÔNG phải staging/production\n---\n\n# Nhật ký xoay khoá\n\n> Sinh bởi `npm run -s kms:drill` (scripts/kms-rotation-drill.ts): OpenBao thật cục bộ, thời lượng đo từ lúc `rotate` tới khi đọc lại xong mọi dữ liệu. Chưa có diễn tập trên staging/hạ tầng thật (việc của chủ dự án).\n\n| Ngày (UTC) | Môi trường | Dữ liệu | Việc đã làm | Thời lượng | Kết quả |\n|---|---|---|---|---|---|\n",
      { flag: "wx" },
    );
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  appendFileSync(LOG, row);
  console.log(`kms:drill ${status}: ${detail}; ${sec}s`);
} catch (err) {
  status = "HỎNG";
  console.error(`kms:drill HỎNG: ${err instanceof Error ? err.message : "lỗi"}`);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
  await db.close();
  void env;
  void t0;
}
