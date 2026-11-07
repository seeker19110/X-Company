// i18n-ignore-file: CLI vận hành (stderr/stdout cho người vận hành)
// Kho tệp trên S3 (FILE_STORAGE=s3, T-126) — bước Node của sao lưu/khôi phục; vỏ restic ở scripts/backup-files.sh và
// scripts/restore-files-drill.sh. Lõi ở lib/files/object-admin.ts (không mạng), mạng ở adapters/s3-http.ts.
//   tsx scripts/files-s3.ts export <thư-mục>               chụp mọi đối tượng (bản mã) + files-manifest.json; giải mã thử từng tệp
//   tsx scripts/files-s3.ts verify <thư-mục>               kiểm bản chụp: sha256 bản mã + đọc qua đường giải mã của ứng dụng
//   tsx scripts/files-s3.ts restore <thư-mục> [--overwrite]  ghi bản chụp vào bucket S3_* hiện hành rồi đọc lại kiểm sha256
// Cần khoá giải mã như ứng dụng (DATA_ENCRYPTION_KEYS / KMS_*); export/restore cần S3_* (FILE_STORAGE=s3).
// Stdout: một dòng JSON (số liệu, không bản rõ/khoá). Exit: 0 đạt · 1 dữ liệu lỗi (đối tượng lạ, lệch sha256, S3 lỗi) · 2 cấu hình/tham số.
import { registerKms } from "../adapters/register-kms.ts";
import { s3ConfigFromEnv } from "../adapters/register-storage.ts";
import { s3Transport } from "../adapters/s3-http.ts";
import {
  exportObjects,
  ForeignObjectsError,
  restoreSnapshot,
  verifySnapshot,
} from "../lib/files/object-admin.ts";
import { env, EnvError } from "../lib/nen/env.ts";

const say = (msg: string) => process.stderr.write(`files-s3: ${msg}\n`);
class UsageError extends Error {}

function s3(): ReturnType<typeof s3Transport> {
  if (env("FILE_STORAGE") !== "s3")
    throw new UsageError("FILE_STORAGE khác s3 — lệnh này chỉ cho kho đối tượng");
  try {
    s3ConfigFromEnv();
  } catch (err) {
    throw new UsageError(err instanceof Error ? err.message : "thiếu cấu hình S3_*");
  }
  return s3Transport(s3ConfigFromEnv);
}

async function main(argv: string[]): Promise<number> {
  const [cmd, dir, ...rest] = argv;
  if (dir === undefined || dir === "" || !["export", "verify", "restore"].includes(cmd ?? ""))
    throw new UsageError("dùng: files-s3.ts export|verify|restore <thư-mục> [--overwrite]");
  const unknown = rest.filter((a) => !(cmd === "restore" && a === "--overwrite"));
  if (unknown.length > 0) throw new UsageError(`tham số lạ: ${unknown.join(" ")}`);
  registerKms(() => process.exit(2));
  if (cmd === "export") {
    const m = await exportObjects(s3(), dir);
    console.log(
      JSON.stringify({ ok: true, objects: m.objects, total_bytes: m.total_bytes, vanished: m.vanished }),
    );
    say(`đã chụp ${m.objects} đối tượng (${m.total_bytes} byte)`);
    return 0;
  }
  if (cmd === "verify") {
    const v = await verifySnapshot(dir);
    console.log(JSON.stringify({ ok: v.problems.length === 0, checked: v.checked, problems: v.problems }));
    for (const p of v.problems) say(`LỖI ${p}`);
    return v.problems.length === 0 ? 0 : 1;
  }
  const r = await restoreSnapshot(dir, s3(), { overwrite: rest.includes("--overwrite") });
  console.log(
    JSON.stringify({
      ok: r.problems.length === 0,
      restored: r.restored,
      skipped_existing: r.skippedExisting,
      checked: r.checked,
      problems: r.problems,
    }),
  );
  for (const p of r.problems) say(`LỖI ${p}`);
  return r.problems.length === 0 ? 0 : 1;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (err) {
  if (err instanceof UsageError || err instanceof EnvError) {
    say(err.message);
    process.exitCode = 2;
  } else {
    say(err instanceof ForeignObjectsError || err instanceof Error ? err.message : "lỗi không rõ");
    process.exitCode = 1;
  }
}
