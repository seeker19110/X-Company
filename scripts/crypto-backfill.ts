// npm run -s crypto:backfill [-- --scrub] [-- --reindex] — mã hoá dữ liệu CŨ (bản rõ → cột *_enc) và tệp tải lên cũ (T-048).
// Idempotent, theo lô. `--scrub`: xoá bản rõ sau khi giải mã thử khớp (chỉ làm sau khi đã kiểm bản mã đọc đúng — mất đường lùi
// "bản trước đọc cột rõ"). `--reindex`: tính lại chỉ mục mù (khi đổi DATA_INDEX_KEY). Báo cáo số dòng để đối chiếu.
import path from "node:path";
import { backfill, rotateFiles } from "../lib/crypto/rotate.ts";
import { closePool, getPool } from "../lib/db/index.ts";
import { env } from "../lib/nen/env.ts";

const args = new Set(process.argv.slice(2));
try {
  const rows = await backfill(getPool(), { scrub: args.has("--scrub"), reindex: args.has("--reindex") });
  for (const r of rows)
    console.log(
      `[crypto:backfill] ${r.target}: mã hoá ${r.encrypted}, xoá bản rõ ${r.scrubbed}, lập lại chỉ mục ${r.reindexed}; ` +
        `có bản mã ${r.withEnc}, còn bản rõ chưa mã hoá ${r.remainingUnencrypted}, còn bản rõ ${r.remainingPlain}`,
    );
  const root = env("FILE_STORAGE_DIR") ?? path.join(process.cwd(), ".data", "files");
  const f = await rotateFiles(root, { encryptLegacy: true });
  console.log(
    `[crypto:backfill] tệp: mã hoá tệp cũ ${f.encryptedLegacy}, bọc lại ${f.rewrapped}, đã hiện hành ${f.alreadyCurrent}`,
  );
  if (rows.some((r) => r.remainingUnencrypted > 0 || (args.has("--scrub") && r.remainingPlain > 0)))
    process.exitCode = 1;
} catch (err) {
  console.error(`[crypto:backfill] lỗi: ${err instanceof Error ? err.message : "không rõ"}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
