// i18n-ignore-file: báo cáo/lỗi cho người vận hành (CLI sao lưu/xoay khoá), không tới người dùng cuối
// Vận hành kho tệp trên kho ĐỐI TƯỢNG (FILE_STORAGE=s3, T-126): chụp nhanh (export) toàn bộ đối tượng ra thư mục để đẩy lên kho
// off-site (restic — scripts/backup-files.sh), kiểm bản chụp, khôi phục bản chụp vào kho đối tượng, kiểm đọc được cả kho.
// Bản chụp giữ NGUYÊN BẢN MÃ (đối tượng chỉ chứa bản mã — objectStorage); mọi bước kiểm đọc lại qua `objectStorage(...).get`, tức
// ĐÚNG đường giải mã của ứng dụng (đầu XCFILE bắt buộc, AAD gắn khoá lưu, xác thực từng khối).
// Bố cục bản chụp: `<dir>/objects/<xx>/<40 hex>` (cùng bố cục kho đĩa) + `<dir>/files-manifest.json` ghi CUỐI (chưa có manifest =
// bản chụp chưa hoàn chỉnh). Manifest: khoá, kích thước, sha256 bản mã (toàn vẹn bản sao) và sha256 bản rõ (= `file_object.sha256`
// trong DB, đối chiếu sau khôi phục). Đối tượng không phải của ứng dụng (khoá sai dạng / thiếu đầu mã hoá) → lỗi nêu khoá, KHÔNG âm
// thầm bỏ qua. Không in bản rõ/khoá.
// Không có mạng ở đây (DB-TX-003): transport S3 tiêm từ adapters/s3-http.ts; `dirObjects` là transport trên thư mục cục bộ.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { collect, decryptFileStream, FILE_HEAD_MAX_BYTES, isEncryptedFile } from "../crypto/file.ts";
import { objectStorage, STORAGE_KEY_RE, type ObjectInventory } from "./storage.ts";

export const MANIFEST_NAME = "files-manifest.json";
export const OBJECTS_DIR = "objects";
const PREVIEW = 5;

export interface ObjectEntry {
  key: string;
  size_bytes: number;
  /** sha256 bản mã (đúng byte trên kho). */
  sha256: string;
  /** sha256 bản rõ sau giải mã (= file_object.sha256). */
  plain_sha256: string;
}

export interface ObjectManifest {
  format: 1;
  kind: "xc-files";
  created_at_utc: string;
  objects: number;
  total_bytes: number;
  /** Có trong danh sách nhưng bị xoá trước lúc đọc (ứng dụng xoá song song). */
  vanished: number;
  entries: ObjectEntry[];
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const preview = (keys: readonly string[]) =>
  keys
    .slice(0, PREVIEW)
    .map((k) => JSON.stringify(k.slice(0, 120)))
    .join(", ") + (keys.length > PREVIEW ? ` … (+${keys.length - PREVIEW})` : "");

/** Kho có đối tượng không phải của ứng dụng (khoá sai dạng `xx/<40 hex>` hoặc thiếu đầu mã hoá XCFILE). */
export class ForeignObjectsError extends Error {
  constructor(
    readonly keys: readonly string[],
    action: string,
  ) {
    super(
      `kho có ${keys.length} đối tượng không phải của ứng dụng (khoá sai dạng hoặc thiếu đầu mã hoá XCFILE): ${preview(keys)} — ` +
        `${action}; chuyển chúng ra khỏi bucket rồi chạy lại`,
    );
    this.name = "ForeignObjectsError";
  }
}

/** Đối tượng có đầu mã hoá của ứng dụng (đọc đủ đầu — như rotateFiles). */
const looksOurs = (key: string, body: Buffer) =>
  STORAGE_KEY_RE.test(key) && isEncryptedFile(body.subarray(0, Math.min(FILE_HEAD_MAX_BYTES, body.length)));

async function writeAtomic(file: string, data: Buffer | string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    await writeFile(/* turbopackIgnore: true */ tmp, data, { mode: 0o600, flag: "wx" });
    await rename(/* turbopackIgnore: true */ tmp, /* turbopackIgnore: true */ file);
  } catch (err) {
    try {
      await unlink(/* turbopackIgnore: true */ tmp);
    } catch (e) {
      if ((e as { code?: string }).code !== "ENOENT") throw e;
    }
    throw err;
  }
}

/**
 * Transport kho đối tượng trên THƯ MỤC cục bộ (bố cục `<root>/<xx>/<40 hex>`): đích khôi phục thử, và để đọc bản chụp qua đúng
 * `objectStorage(...).get`. Ghi qua tệp tạm + rename (không để đối tượng dở). Liệt kê trả MỌI tệp `<thư mục>/<tên>` (kể cả lạ).
 */
export function dirObjects(root: string): ObjectInventory {
  const fileOf = (key: string) => {
    if (!STORAGE_KEY_RE.test(key)) throw new Error("Khoá tệp không hợp lệ");
    return path.join(/* turbopackIgnore: true */ root, key);
  };
  return {
    async putObject(key, body) {
      const file = fileOf(key);
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeAtomic(file, body);
    },
    async getObject(key) {
      try {
        return await readFile(/* turbopackIgnore: true */ fileOf(key));
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") return null;
        throw err;
      }
    },
    async deleteObject(key) {
      try {
        await unlink(/* turbopackIgnore: true */ fileOf(key));
      } catch (err) {
        if ((err as { code?: string }).code !== "ENOENT") throw err;
      }
    },
    async *listKeys() {
      let dirs: string[];
      try {
        dirs = (await readdir(/* turbopackIgnore: true */ root, { withFileTypes: true }))
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
          .sort();
      } catch (err) {
        if ((err as { code?: string }).code === "ENOENT") return;
        throw err;
      }
      for (const d of dirs)
        for (const name of (await readdir(/* turbopackIgnore: true */ path.join(root, d))).sort())
          yield `${d}/${name}`;
    },
  };
}

/** Giải mã một đối tượng qua đúng đường của ứng dụng; lỗi → nêu khoá (không nêu nội dung). */
async function plainSha(store: ObjectInventory, key: string): Promise<string> {
  try {
    return sha256(await objectStorage(store).get(key));
  } catch (err) {
    throw new Error(
      `đối tượng ${key} không đọc/giải mã được (${err instanceof Error ? err.message : "không rõ"})`,
      { cause: err },
    );
  }
}

/**
 * Chụp nhanh mọi đối tượng của `src` vào `dir` (phải chưa có manifest). Mỗi đối tượng: kiểm của ứng dụng → giải mã thử (bản hỏng /
 * khoá đã gỡ → lỗi, không đẩy bản hỏng đi) → ghi bản mã. Đối tượng lạ: quét hết rồi ném `ForeignObjectsError` liệt kê, KHÔNG ghi
 * manifest. Kho rỗng → manifest 0 đối tượng.
 */
export async function exportObjects(
  src: ObjectInventory,
  dir: string,
  now: () => Date = () => new Date(),
): Promise<ObjectManifest> {
  const objRoot = path.join(dir, OBJECTS_DIR);
  await mkdir(objRoot, { recursive: true, mode: 0o700 });
  const manifestPath = path.join(dir, MANIFEST_NAME);
  let hasManifest = true;
  try {
    await stat(/* turbopackIgnore: true */ manifestPath);
  } catch (err) {
    if ((err as { code?: string }).code !== "ENOENT") throw err;
    hasManifest = false;
  }
  if (hasManifest) throw new Error(`thư mục đích đã có ${MANIFEST_NAME} — không ghi đè bản chụp cũ`);
  const out = dirObjects(objRoot);
  const foreign: string[] = [];
  const entries: ObjectEntry[] = [];
  let vanished = 0;
  const createdAt = now().toISOString();
  for await (const key of src.listKeys()) {
    if (!STORAGE_KEY_RE.test(key)) {
      foreign.push(key);
      continue;
    }
    const body = await src.getObject(key);
    if (body === null) {
      vanished += 1;
      continue;
    }
    if (!looksOurs(key, body)) {
      foreign.push(key);
      continue;
    }
    let plain: Buffer;
    try {
      plain = await collect(decryptFileStream([body], { storageKey: key }));
    } catch (err) {
      throw new Error(
        `đối tượng ${key} không giải mã được (${err instanceof Error ? err.message : "không rõ"}) — không sao lưu bản hỏng`,
        { cause: err },
      );
    }
    await out.putObject(key, body);
    entries.push({ key, size_bytes: body.length, sha256: sha256(body), plain_sha256: sha256(plain) });
  }
  if (foreign.length > 0) throw new ForeignObjectsError(foreign, "không sao lưu");
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const manifest: ObjectManifest = {
    format: 1,
    kind: "xc-files",
    created_at_utc: createdAt,
    objects: entries.length,
    total_bytes: entries.reduce((s, e) => s + e.size_bytes, 0),
    vanished,
    entries,
  };
  await writeAtomic(manifestPath, `${JSON.stringify(manifest)}\n`);
  return manifest;
}

/** Đọc + kiểm hình manifest (đầu vào từ đĩa/kho off-site: không tin). */
export async function readManifest(dir: string): Promise<ObjectManifest> {
  const raw = JSON.parse(
    await readFile(/* turbopackIgnore: true */ path.join(dir, MANIFEST_NAME), "utf8"),
  ) as Partial<ObjectManifest>;
  const hex64 = /^[0-9a-f]{64}$/;
  if (raw.format !== 1 || raw.kind !== "xc-files" || !Array.isArray(raw.entries))
    throw new Error(`${MANIFEST_NAME} không đúng định dạng (format 1, kind xc-files)`);
  for (const e of raw.entries)
    if (
      typeof e?.key !== "string" ||
      !STORAGE_KEY_RE.test(e.key) ||
      !Number.isSafeInteger(e.size_bytes) ||
      !hex64.test(String(e.sha256)) ||
      !hex64.test(String(e.plain_sha256))
    )
      throw new Error(`${MANIFEST_NAME}: mục không hợp lệ ${JSON.stringify(e).slice(0, 160)}`);
  if (raw.entries.length !== raw.objects)
    throw new Error(`${MANIFEST_NAME}: số mục (${raw.entries.length}) khác "objects" (${raw.objects})`);
  return raw as ObjectManifest;
}

export interface VerifyReport {
  checked: number;
  /** Mỗi dòng nêu khoá + vấn đề (không nội dung). Rỗng = đạt. */
  problems: string[];
}

/**
 * Kiểm bản chụp tại chỗ: mỗi mục manifest có tệp, sha256 bản mã khớp, đọc qua `objectStorage(dirObjects(...)).get` (đường giải mã
 * của ứng dụng) ra bản rõ có sha256 khớp. Tệp có trong bản chụp mà không có trong manifest → vấn đề.
 */
export async function verifySnapshot(dir: string): Promise<VerifyReport> {
  const m = await readManifest(dir);
  const store = dirObjects(path.join(dir, OBJECTS_DIR));
  return checkEntries(store, m.entries, true);
}

async function checkEntries(
  store: ObjectInventory,
  entries: readonly ObjectEntry[],
  cipherMustMatch: boolean,
): Promise<VerifyReport> {
  const problems: string[] = [];
  const listed = new Set(entries.map((e) => e.key));
  for (const e of entries) {
    const body = await store.getObject(e.key);
    if (body === null) {
      problems.push(`${e.key}: thiếu đối tượng`);
      continue;
    }
    if (cipherMustMatch && sha256(body) !== e.sha256) {
      problems.push(`${e.key}: sha256 bản mã lệch manifest`);
      continue;
    }
    try {
      if ((await plainSha(store, e.key)) !== e.plain_sha256)
        problems.push(`${e.key}: sha256 bản rõ lệch manifest`);
    } catch (err) {
      problems.push(err instanceof Error ? err.message : `${e.key}: lỗi không rõ`);
    }
  }
  if (cipherMustMatch)
    for await (const key of store.listKeys())
      if (!listed.has(key)) problems.push(`${key}: có trong bản chụp nhưng không có trong manifest`);
  return { checked: entries.length, problems };
}

export interface RestoreReport extends VerifyReport {
  restored: number;
  /** Đối tượng đã có ở đích (không ghi đè trừ khi `overwrite`): bản trên đích có thể đã được xoay khoá — ghi đè bằng bản cũ sẽ
   * gắn lại khoá cũ có thể đã bị gỡ. */
  skippedExisting: number;
}

/**
 * Khôi phục bản chụp vào kho đối tượng `dst`: kiểm sha256 bản mã của MỌI mục trước (bản chụp hỏng → không ghi gì), bỏ qua khoá đã
 * có ở đích (trừ `overwrite`), ghi, rồi đọc lại MỌI mục qua đường giải mã của ứng dụng, so sha256 bản rõ. Idempotent (chạy lại an toàn).
 */
export async function restoreSnapshot(
  dir: string,
  dst: ObjectInventory,
  opts: { overwrite?: boolean } = {},
): Promise<RestoreReport> {
  const m = await readManifest(dir);
  const snap = dirObjects(path.join(dir, OBJECTS_DIR));
  const bad: string[] = [];
  for (const e of m.entries) {
    const body = await snap.getObject(e.key);
    if (body === null || sha256(body) !== e.sha256) bad.push(e.key);
  }
  if (bad.length > 0)
    throw new Error(`bản chụp hỏng/thiếu ${bad.length} đối tượng: ${preview(bad)} — không khôi phục`);
  const existing = new Set<string>();
  if (opts.overwrite !== true) for await (const k of dst.listKeys()) existing.add(k);
  let restored = 0;
  let skippedExisting = 0;
  for (const e of m.entries) {
    if (existing.has(e.key)) {
      skippedExisting += 1;
      continue;
    }
    await dst.putObject(e.key, (await snap.getObject(e.key))!);
    restored += 1;
  }
  const v = await checkEntries(dst, m.entries, false);
  return { restored, skippedExisting, ...v };
}

export interface StoreReadReport {
  readable: number;
  problems: string[];
  foreign: string[];
}

/** Đọc thử MỌI đối tượng của kho qua đường giải mã của ứng dụng (sau xoay khoá: chứng minh không mất tệp trước khi gỡ khoá cũ). */
export async function verifyObjectStore(store: ObjectInventory): Promise<StoreReadReport> {
  const rep: StoreReadReport = { readable: 0, problems: [], foreign: [] };
  for await (const key of store.listKeys()) {
    if (!STORAGE_KEY_RE.test(key)) {
      rep.foreign.push(key);
      continue;
    }
    const body = await store.getObject(key);
    if (body === null) continue; // xoá song song
    if (!looksOurs(key, body)) {
      rep.foreign.push(key);
      continue;
    }
    try {
      await collect(decryptFileStream([body], { storageKey: key }));
      rep.readable += 1;
    } catch (err) {
      rep.problems.push(`${key}: ${err instanceof Error ? err.message : "không rõ"}`);
    }
  }
  return rep;
}
