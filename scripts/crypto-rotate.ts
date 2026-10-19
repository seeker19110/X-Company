// npm run -s crypto:rotate — xoay khoá mã hoá dữ liệu lúc lưu (T-048). Điều kiện: đặt khoá MỚI lên ĐẦU DATA_ENCRYPTION_KEYS và giữ
// các khoá cũ phía sau. Việc: cột PII (đọc bằng khoá cũ, ghi bằng khoá mới) + tệp tải lên (bọc lại khoá tệp). Idempotent, theo lô,
// chạy lại được. Xong khi mọi `stale` = 0 → mới được bỏ khoá cũ khỏi cấu hình. Không in bản rõ/khoá.
import path from "node:path";
import { closePool, getPool } from "../lib/db/index.ts";
import { rotateFiles, rotateKeys, verifyFiles } from "../lib/crypto/rotate.ts";
import { keyring } from "../lib/crypto/index.ts";
import { env } from "../lib/nen/env.ts";

try {
  const ring = keyring();
  console.log(
    `[crypto:rotate] khoá hiện hành: ${ring.current.id}; khoá giải mã: ${[...ring.byId.keys()].join(", ")}`,
  );
  const cols = await rotateKeys(getPool());
  for (const c of cols)
    console.log(`[crypto:rotate] ${c.target}: đã xoay ${c.rotated}, còn khoá cũ ${c.stale}`);
  const root = env("FILE_STORAGE_DIR") ?? path.join(process.cwd(), ".data", "files");
  const f = await rotateFiles(root);
  const readable = await verifyFiles(root).catch(() => 0);
  console.log(
    `[crypto:rotate] tệp: bọc lại ${f.rewrapped}, mã hoá tệp cũ ${f.encryptedLegacy}, đã hiện hành ${f.alreadyCurrent}, đọc kiểm được ${readable}`,
  );
  if (cols.some((c) => c.stale > 0)) process.exitCode = 1;
} catch (err) {
  console.error(`[crypto:rotate] lỗi: ${err instanceof Error ? err.message : "không rõ"}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
