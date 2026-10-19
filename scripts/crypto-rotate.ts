// npm run -s crypto:rotate [-- --kms-rotate] — xoay khoá mã hoá dữ liệu lúc lưu (T-048, T-052).
//  · KMS_PROVIDER=env: đặt khoá MỚI lên ĐẦU DATA_ENCRYPTION_KEYS và giữ khoá cũ phía sau. Việc: cột PII (đọc bằng khoá cũ, ghi bằng
//    khoá mới) + tệp tải lên (bọc lại khoá tệp).
//  · KMS_PROVIDER=transit: `--kms-rotate` tạo phiên bản khoá chủ MỚI trong KMS (cần token vận hành có quyền rotate — token ứng dụng
//    không có); rồi `rewrap` mọi DEK cũ sang phiên bản mới MÀ KHÔNG đọc dữ liệu rõ (bản mã dữ liệu giữ nguyên); phong bì v1 cũ (khoá
//    env) được mã hoá lại bằng KMS. Không có `--kms-rotate` thì chỉ đưa dữ liệu về phiên bản khoá chủ mới nhất hiện có.
// Idempotent, theo lô, chạy lại được. Xong khi mọi `stale` = 0 → mới được bỏ khoá cũ khỏi cấu hình / thu hồi phiên bản khoá KMS cũ.
// Không in bản rõ/khoá/token.
import path from "node:path";
import { registerKms } from "../adapters/register-kms.ts";
import { closePool, getPool } from "../lib/db/index.ts";
import { rotateFiles, rotateKeys, verifyFiles } from "../lib/crypto/rotate.ts";
import { keyring } from "../lib/crypto/index.ts";
import { keyProvider, transitClient } from "../lib/crypto/kms.ts";
import { env } from "../lib/nen/env.ts";

try {
  registerKms();
  const provider = keyProvider();
  if (provider.name === "transit") {
    if (process.argv.includes("--kms-rotate")) {
      const v = await transitClient().rotate();
      console.log(`[crypto:rotate] KMS: đã tạo phiên bản khoá chủ mới v${v}`);
    }
    console.log(`[crypto:rotate] KMS transit: khoá chủ mới nhất v${await transitClient().latestVersion()}`);
  } else {
    const ring = keyring();
    console.log(
      `[crypto:rotate] khoá hiện hành: ${ring.current.id}; khoá giải mã: ${[...ring.byId.keys()].join(", ")}`,
    );
  }
  const cols = await rotateKeys(getPool());
  for (const c of cols)
    console.log(
      `[crypto:rotate] ${c.target}: đã xoay ${c.rotated}` +
        (provider.name === "transit"
          ? ` (đổi DEK bọc ${c.rewrapped}, mã hoá lại từ khoá env ${c.reencrypted})`
          : "") +
        `, còn khoá cũ ${c.stale}`,
    );
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
