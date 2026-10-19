// i18n-ignore-file: báo cáo/nhật ký cho vận hành (không tới người dùng cuối)
// Công cụ vận hành mã hoá lúc lưu (T-048): `backfill` mã hoá dữ liệu cũ, `rotateKeys` đọc bằng khoá cũ → ghi bằng khoá hiện hành,
// `rotateFiles` bọc lại khoá tệp. Cả ba: idempotent (chạy lại an toàn), theo lô (giao dịch ngắn, SKIP LOCKED / so-sánh-rồi-đặt), dừng
// giữa chừng rồi chạy lại tiếp được. Không bao giờ in bản rõ/khoá — báo cáo chỉ có số dòng.
// Chạy bằng `npm run -s crypto:rotate` / `crypto:backfill` (scripts/crypto-*.ts) với role ứng dụng (DATABASE_URL).
import { createReadStream, createWriteStream } from "node:fs";
import { open, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type pg from "pg";
import { withTx } from "../db/index.ts";
import {
  collect,
  decryptFileStream,
  encryptFileStream,
  FILE_MAGIC,
  isEncryptedFile,
  rewrapHeader,
} from "./file.ts";
import {
  ENCRYPTED_COLUMNS,
  bidxOf,
  openGeo,
  sealGeo,
  sealText,
  type EncryptedColumn,
  type TextColumn,
} from "./columns.ts";
import { decryptField, encryptField, keyring, type Keyring } from "./index.ts";

export interface ColumnReport {
  target: string;
  encrypted: number;
  scrubbed: number;
  reindexed: number;
  /** Số dòng còn bản rõ chưa có bản mã (phải = 0 sau backfill). */
  remainingUnencrypted: number;
  /** Số dòng còn bản rõ (kể cả đã có bản mã) — = 0 sau `scrub`. */
  remainingPlain: number;
  /** Số dòng có bản mã (kiểm số dòng). */
  withEnc: number;
}

export interface BackfillOptions {
  batchSize?: number;
  /** Xoá bản rõ sau khi giải mã thử khớp (bước tách khỏi mã hoá để còn đường lùi). */
  scrub?: boolean;
  /** Tính lại chỉ mục mù cho dòng đã có bản mã (khi đổi DATA_INDEX_KEY). */
  reindex?: boolean;
}

const label = (c: EncryptedColumn) => (c.kind === "geo" ? `${c.table}.geo` : `${c.table}.${c.plain}`);
const BATCH = 200;

/** Điều kiện "có bản rõ" của mục tiêu. Tên bảng/cột lấy từ sổ đăng ký hằng (không phải đầu vào). */
function hasPlain(c: EncryptedColumn): string {
  return c.kind === "geo" ? "geo_lat IS NOT NULL" : `${c.plain} IS NOT NULL`;
}

async function counts(pool: pg.Pool, c: EncryptedColumn) {
  // sql-interp-allow: bảng/cột từ ENCRYPTED_COLUMNS (hằng trong mã), không có giá trị người dùng.
  const r = await pool.query<{ unenc: string; plain: string; withenc: string }>(
    `SELECT count(*) FILTER (WHERE ${hasPlain(c)} AND ${c.enc} IS NULL) AS unenc,
            count(*) FILTER (WHERE ${hasPlain(c)}) AS plain,
            count(*) FILTER (WHERE ${c.enc} IS NOT NULL) AS withenc
       FROM ${c.table}`,
  );
  const row = r.rows[0]!;
  return { unenc: Number(row.unenc), plain: Number(row.plain), withEnc: Number(row.withenc) };
}

interface Row {
  id: string;
  [k: string]: unknown;
}

/** Mã hoá một lô dòng chưa có bản mã. Trả số dòng đã mã hoá (0 = hết). */
async function encryptBatch(pool: pg.Pool, c: EncryptedColumn, size: number): Promise<number> {
  return withTx(async (tx) => {
    const cols = c.kind === "geo" ? c.plains.join(", ") : c.plain;
    // sql-interp-allow: bảng/cột từ ENCRYPTED_COLUMNS (hằng); số lô qua $1.
    const { rows } = await tx.query<Row>(
      `SELECT id::text AS id, ${cols} FROM ${c.table}
        WHERE ${hasPlain(c)} AND ${c.enc} IS NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [size],
    );
    for (const r of rows) {
      if (c.kind === "geo") {
        const g = openGeo(r.id, r);
        if (!g) continue;
        // sql-interp-allow: bảng/cột từ ENCRYPTED_COLUMNS (hằng); giá trị qua tham số.
        await tx.query(`UPDATE ${c.table} SET ${c.enc} = $2 WHERE id = $1 AND ${c.enc} IS NULL`, [
          r.id,
          sealGeo(r.id, g),
        ]);
      } else {
        const s = sealText(c, r.id, r[c.plain] as string);
        // sql-interp-allow: bảng/cột từ ENCRYPTED_COLUMNS (hằng); giá trị qua tham số.
        await tx.query(
          `UPDATE ${c.table} SET ${c.enc} = $2${c.bidx ? `, ${c.bidx} = $3` : ""} WHERE id = $1 AND ${c.enc} IS NULL`,
          c.bidx ? [r.id, s.enc, s.bidx] : [r.id, s.enc],
        );
      }
    }
    return rows.length;
  }, pool);
}

/** Xoá bản rõ của lô dòng đã có bản mã — chỉ khi giải mã thử khớp bản rõ (nếu lệch: dừng, không xoá). */
async function scrubBatch(pool: pg.Pool, c: EncryptedColumn, size: number): Promise<number> {
  return withTx(async (tx) => {
    const cols = c.kind === "geo" ? c.plains.join(", ") : c.plain;
    // sql-interp-allow: bảng/cột từ ENCRYPTED_COLUMNS (hằng); số lô qua $1.
    const { rows } = await tx.query<Row>(
      `SELECT id::text AS id, ${cols}, ${c.enc} FROM ${c.table}
        WHERE ${hasPlain(c)} AND ${c.enc} IS NOT NULL ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [size],
    );
    for (const r of rows) {
      if (c.kind === "geo") {
        const before = openGeo(r.id, { ...r, geo_enc: undefined });
        const now = openGeo(r.id, r);
        if (JSON.stringify(before) !== JSON.stringify(now))
          throw new Error(`bản mã ${label(c)} không khớp bản rõ (dòng ${r.id}) — dừng, không xoá bản rõ`);
        // sql-interp-allow: bảng từ ENCRYPTED_COLUMNS (hằng).
        await tx.query(
          `UPDATE ${c.table} SET geo_lat = NULL, geo_lng = NULL, geo_accuracy_m = NULL, geo_captured_at = NULL WHERE id = $1`,
          [r.id],
        );
      } else {
        const dec = decryptField({ table: c.table, column: c.enc, rowId: r.id }, r[c.enc] as string);
        if (dec !== r[c.plain])
          throw new Error(`bản mã ${label(c)} không khớp bản rõ (dòng ${r.id}) — dừng, không xoá bản rõ`);
        // sql-interp-allow: bảng/cột từ ENCRYPTED_COLUMNS (hằng).
        await tx.query(`UPDATE ${c.table} SET ${c.plain} = NULL WHERE id = $1`, [r.id]);
      }
    }
    return rows.length;
  }, pool);
}

/** Tính lại chỉ mục mù cho mọi dòng có bản mã (giải mã → HMAC bằng khoá chỉ mục hiện hành). */
async function reindexColumn(pool: pg.Pool, c: TextColumn, size: number): Promise<number> {
  if (c.bidx === undefined) return 0;
  let total = 0;
  let after: string | null = null;
  for (;;) {
    const page: number = await withTx(async (tx) => {
      // sql-interp-allow: bảng/cột từ ENCRYPTED_COLUMNS (hằng); khoá phân trang/lô qua tham số.
      const { rows } = await tx.query<Row>(
        `SELECT id::text AS id, ${c.enc}, ${c.bidx} FROM ${c.table}
          WHERE ${c.enc} IS NOT NULL AND ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT $2 FOR UPDATE`,
        [after, size],
      );
      for (const r of rows) {
        const plain = decryptField({ table: c.table, column: c.enc, rowId: r.id }, r[c.enc] as string);
        const next = bidxOf(c, plain);
        if (next !== r[c.bidx!]) {
          // sql-interp-allow: bảng/cột từ ENCRYPTED_COLUMNS (hằng).
          await tx.query(`UPDATE ${c.table} SET ${c.bidx} = $2 WHERE id = $1`, [r.id, next]);
          total += 1;
        }
      }
      after = rows.at(-1)?.id ?? after;
      return rows.length;
    }, pool);
    if (page < size) return total;
  }
}

/**
 * Mã hoá dữ liệu cũ (và tuỳ chọn xoá bản rõ / lập lại chỉ mục). Idempotent: chạy lại → 0 dòng đổi. Báo cáo kèm số dòng đối chiếu:
 * sau chạy `remainingUnencrypted` phải = 0; sau `--scrub` thì `remainingPlain` cũng = 0.
 */
export async function backfill(pool: pg.Pool, opts: BackfillOptions = {}): Promise<ColumnReport[]> {
  const size = opts.batchSize ?? BATCH;
  const out: ColumnReport[] = [];
  for (const c of ENCRYPTED_COLUMNS) {
    let encrypted = 0;
    for (let n = await encryptBatch(pool, c, size); n > 0; n = await encryptBatch(pool, c, size))
      encrypted += n;
    let scrubbed = 0;
    if (opts.scrub)
      for (let n = await scrubBatch(pool, c, size); n > 0; n = await scrubBatch(pool, c, size)) scrubbed += n;
    const reindexed = opts.reindex && c.kind === "text" ? await reindexColumn(pool, c, size) : 0;
    const k = await counts(pool, c);
    out.push({
      target: label(c),
      encrypted,
      scrubbed,
      reindexed,
      remainingUnencrypted: k.unenc,
      remainingPlain: k.plain,
      withEnc: k.withEnc,
    });
  }
  return out;
}

export interface RotateReport {
  target: string;
  rotated: number;
  /** Số dòng còn dùng khoá khác khoá hiện hành sau khi chạy (phải = 0). */
  stale: number;
}

export interface RotateOptions {
  batchSize?: number;
  ring?: Keyring;
}

async function staleCount(pool: pg.Pool, c: EncryptedColumn, prefix: string): Promise<number> {
  // sql-interp-allow: bảng/cột từ ENCRYPTED_COLUMNS (hằng); tiền tố qua $1.
  const r = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM ${c.table} WHERE ${c.enc} IS NOT NULL AND NOT starts_with(${c.enc}, $1)`,
    [prefix],
  );
  return Number(r.rows[0]!.n);
}

/**
 * Xoay khoá cột: đọc bằng khoá cũ (bất kỳ khoá nào trong bộ khoá), ghi bằng khoá hiện hành. Theo lô, mỗi dòng cập nhật kiểu
 * "so sánh rồi đặt" (không đè nếu dòng đổi giữa chừng). Idempotent: dòng đã dùng khoá hiện hành bị bỏ qua. Dòng giải mã lỗi
 * (khoá cũ đã bị bỏ khỏi cấu hình, bản mã hỏng) → ném lỗi nêu id dòng, KHÔNG ghi đè.
 */
export async function rotateKeys(pool: pg.Pool, opts: RotateOptions = {}): Promise<RotateReport[]> {
  const ring = opts.ring ?? keyring();
  const size = opts.batchSize ?? BATCH;
  const prefix = `v1:${ring.current.id}:`;
  const out: RotateReport[] = [];
  for (const c of ENCRYPTED_COLUMNS) {
    let rotated = 0;
    let after: string | null = null;
    for (;;) {
      const page: number = await withTx(async (tx) => {
        // sql-interp-allow: bảng/cột từ ENCRYPTED_COLUMNS (hằng); tiền tố, khoá phân trang, cỡ lô qua tham số.
        const { rows } = await tx.query<Row>(
          `SELECT id::text AS id, ${c.enc} AS v FROM ${c.table}
            WHERE ${c.enc} IS NOT NULL AND NOT starts_with(${c.enc}, $1) AND ($2::uuid IS NULL OR id > $2::uuid)
            ORDER BY id LIMIT $3 FOR UPDATE SKIP LOCKED`,
          [prefix, after, size],
        );
        for (const r of rows) {
          const ctx = { table: c.table, column: c.enc, rowId: r.id };
          const plain = decryptField(ctx, r.v as string, ring);
          const next = encryptField(ctx, plain, ring);
          // sql-interp-allow: bảng/cột từ ENCRYPTED_COLUMNS (hằng).
          const u = await tx.query(`UPDATE ${c.table} SET ${c.enc} = $3 WHERE id = $1 AND ${c.enc} = $2`, [
            r.id,
            r.v,
            next,
          ]);
          rotated += u.rowCount ?? 0;
        }
        after = rows.at(-1)?.id ?? after;
        return rows.length;
      }, pool);
      if (page < size) break;
    }
    out.push({ target: label(c), rotated, stale: await staleCount(pool, c, prefix) });
  }
  return out;
}

export interface FileRotateReport {
  rewrapped: number;
  encryptedLegacy: number;
  alreadyCurrent: number;
}

const STORAGE_NAME = /^[0-9a-f]{40}$/;
const HEAD_BYTES = FILE_MAGIC.length + 1 + 255 + 12 + 16 + 32;

async function replaceFile(file: string, build: () => Readable): Promise<void> {
  const tmp = `${file}.rot-${process.pid}`;
  try {
    await pipeline(build(), createWriteStream(/* turbopackIgnore: true */ tmp, { mode: 0o600, flags: "wx" }));
    await rename(tmp, file);
  } catch (err) {
    try {
      await unlink(tmp);
    } catch (e) {
      if ((e as { code?: string }).code !== "ENOENT") throw e;
    }
    throw err;
  }
}

/**
 * Tệp tải lên: bọc lại khoá tệp bằng khoá hiện hành (chỉ đổi đầu tệp, nội dung giữ nguyên); tệp cũ chưa mã hoá thì mã hoá luôn
 * (`encryptLegacy`). Ghi qua tệp tạm + rename (không để tệp dở dang). Idempotent.
 */
export async function rotateFiles(
  root: string,
  opts: { ring?: Keyring; encryptLegacy?: boolean } = {},
): Promise<FileRotateReport> {
  const ring = opts.ring ?? keyring();
  const rep: FileRotateReport = { rewrapped: 0, encryptedLegacy: 0, alreadyCurrent: 0 };
  let dirs: string[];
  try {
    dirs = (await readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return rep;
    throw err;
  }
  for (const d of dirs) {
    if (!/^[0-9a-f]{2}$/.test(d)) continue;
    for (const name of await readdir(path.join(root, d))) {
      if (!STORAGE_NAME.test(name)) continue; // bỏ qua tệp tạm/lạ
      const key = `${d}/${name}`;
      const file = path.join(root, d, name);
      const fh = await open(file, "r");
      const head = Buffer.alloc(Math.min(HEAD_BYTES, (await fh.stat()).size));
      await fh.read(head, 0, head.length, 0);
      await fh.close();
      if (!isEncryptedFile(head)) {
        if (opts.encryptLegacy === false) continue;
        await replaceFile(file, () =>
          Readable.from(encryptFileStream(createReadStream(file), { storageKey: key }, ring)),
        );
        rep.encryptedLegacy += 1;
        continue;
      }
      const re = rewrapHeader(head, { storageKey: key }, ring);
      if (!re.changed) {
        rep.alreadyCurrent += 1;
        continue;
      }
      await replaceFile(file, () =>
        Readable.from(
          (async function* () {
            yield re.header;
            yield* createReadStream(file, { start: re.oldLength });
          })(),
        ),
      );
      rep.rewrapped += 1;
    }
  }
  return rep;
}

/** Kiểm đọc được MỌI tệp trong kho (giải mã/đọc rõ) — dùng sau xoay khoá để chứng minh không mất tệp. Trả số tệp. */
export async function verifyFiles(root: string, ring: Keyring = keyring()): Promise<number> {
  let n = 0;
  for (const d of await readdir(root)) {
    for (const name of await readdir(path.join(root, d))) {
      if (!STORAGE_NAME.test(name)) continue;
      const file = path.join(root, d, name);
      // Mở trước rồi hỏi kích thước trên chính tay cầm (không stat-rồi-mở: tránh đua tệp đổi giữa hai bước).
      const fh = await open(file, "r");
      const head = Buffer.alloc(FILE_MAGIC.length);
      let bytesRead: number;
      let size: number;
      try {
        size = (await fh.stat()).size;
        ({ bytesRead } = await fh.read(head, 0, head.length, 0));
      } finally {
        await fh.close();
      }
      if (size === 0) continue;
      if (isEncryptedFile(head.subarray(0, bytesRead)))
        await collect(decryptFileStream(createReadStream(file), { storageKey: `${d}/${name}` }, ring));
      n += 1;
    }
  }
  return n;
}
