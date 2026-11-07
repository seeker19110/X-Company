// npm run -s crypto:rotate [-- --kms-rotate] — xoay khoá mã hoá dữ liệu lúc lưu (T-048, T-052).
//  · KMS_PROVIDER=env: đặt khoá MỚI lên ĐẦU DATA_ENCRYPTION_KEYS và giữ khoá cũ phía sau. Việc: cột PII (đọc bằng khoá cũ, ghi bằng
//    khoá mới) + tệp tải lên (bọc lại khoá tệp).
//  · KMS_PROVIDER=transit: `--kms-rotate` tạo phiên bản khoá chủ MỚI trong KMS (cần token vận hành có quyền rotate — token ứng dụng
//    không có); rồi `rewrap` mọi DEK cũ sang phiên bản mới MÀ KHÔNG đọc dữ liệu rõ (bản mã dữ liệu giữ nguyên); phong bì v1 cũ (khoá
//    env) được mã hoá lại bằng KMS. Không có `--kms-rotate` thì chỉ đưa dữ liệu về phiên bản khoá chủ mới nhất hiện có.
//  · Tệp: FILE_STORAGE=disk → thư mục FILE_STORAGE_DIR (rotateFiles); s3 → mọi đối tượng trong bucket (rotateObjects, T-126) rồi đọc
//    thử toàn kho; đối tượng lạ (không phải của ứng dụng) hoặc không đọc được → exit 1.
// Idempotent, theo lô, chạy lại được. Xong khi mọi `stale` = 0 → mới được bỏ khoá cũ khỏi cấu hình / thu hồi phiên bản khoá KMS cũ.
// Không in bản rõ/khoá/token.
import path from "node:path";
import { registerKms } from "../adapters/register-kms.ts";
import { s3ConfigFromEnv } from "../adapters/register-storage.ts";
import { s3Transport } from "../adapters/s3-http.ts";
import { closePool, getPool } from "../lib/db/index.ts";
import { rotateFiles, rotateKeys, rotateObjects, verifyFiles } from "../lib/crypto/rotate.ts";
import { ForeignObjectsError, verifyObjectStore } from "../lib/files/object-admin.ts";
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
  if (env("FILE_STORAGE") === "s3") {
    // T-126: bọc lại khoá tệp trên kho đối tượng (ghi đè từng đối tượng bằng một PUT — idempotent, chạy lại được), rồi đọc thử
    // MỌI đối tượng qua đường giải mã. Chỉ "xong" (exit 0) khi không có đối tượng lạ/không đọc được — trước đó KHÔNG bỏ khoá cũ.
    const store = s3Transport(s3ConfigFromEnv);
    const f = await rotateObjects(store);
    const v = await verifyObjectStore(store);
    console.log(
      `[crypto:rotate] tệp (S3): bọc lại ${f.rewrapped}, đã hiện hành ${f.alreadyCurrent}, đã bị xoá giữa chừng ${f.vanished}, đọc kiểm được ${v.readable}`,
    );
    const foreign = [...new Set([...f.foreign, ...v.foreign])];
    if (foreign.length > 0) {
      console.error(
        `[crypto:rotate] ${new ForeignObjectsError(foreign, "không xoay khoá các đối tượng này").message}`,
      );
      process.exitCode = 1;
    }
    if (v.problems.length > 0) {
      for (const p of v.problems.slice(0, 20)) console.error(`[crypto:rotate] tệp (S3) không đọc được: ${p}`);
      console.error(
        `[crypto:rotate] ${v.problems.length} tệp trên S3 không đọc được — KHÔNG bỏ khoá cũ khỏi cấu hình/KMS`,
      );
      process.exitCode = 1;
    }
  } else {
    const root = env("FILE_STORAGE_DIR") ?? path.join(process.cwd(), ".data", "files");
    const f = await rotateFiles(root);
    const readable = await verifyFiles(root).catch(() => 0);
    console.log(
      `[crypto:rotate] tệp: bọc lại ${f.rewrapped}, mã hoá tệp cũ ${f.encryptedLegacy}, đã hiện hành ${f.alreadyCurrent}, đọc kiểm được ${readable}`,
    );
  }
  if (cols.some((c) => c.stale > 0)) process.exitCode = 1;
} catch (err) {
  console.error(`[crypto:rotate] lỗi: ${err instanceof Error ? err.message : "không rõ"}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
