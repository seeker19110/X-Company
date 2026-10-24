// i18n-ignore-file: nhãn kỹ thuật cho vận hành/tài liệu (không tới người dùng cuối)
// Sổ đăng ký cột PII đã mã hoá lúc lưu (T-048). Nguồn sự thật cho: ghi/đọc ở miền nghiệp vụ, backfill, xoay khoá, và test khớp với
// COMMENT `enc=yes` trong CSDL + docs/privacy/data-map.yaml. Thêm cột mã hoá = thêm một dòng ở đây + migration + COMMENT.
//
// Mô hình expand/contract: cột bản rõ (`plain`) giữ cho dòng cũ/bản trước; ứng dụng mới ghi cột `enc` (và `bidx` nếu cần tìm)
// rồi để cột bản rõ NULL, đọc ưu tiên `enc`. Bước contract (bỏ cột bản rõ) là việc SAU — xem docs/security/encryption-at-rest.md.
import { blindIndex, decryptField, encryptField, normalizePhone, type Keyring } from "./index.ts";
import { keyProvider } from "./kms.ts";

export interface TextColumn {
  kind: "text";
  table: string;
  /** Cột bản rõ cũ (giữ cho dòng chưa backfill). */
  plain: string;
  enc: string;
  /** Cột chỉ mục mù (HMAC) để tìm khớp; không có = không cần tìm. */
  bidx?: string;
  /** Chuẩn hoá trước khi lập chỉ mục (mặc định: NFC + trim + chữ thường ở blindIndex). */
  normalize?: (v: string) => string;
}

/** Toạ độ GPS: bốn cột bản rõ gộp thành MỘT bản mã JSON (toạ độ + độ chính xác + thời điểm) để không lộ từng phần. */
export interface GeoColumn {
  kind: "geo";
  table: "attendance_event";
  plains: readonly ["geo_lat", "geo_lng", "geo_accuracy_m", "geo_captured_at"];
  enc: "geo_enc";
}

export type EncryptedColumn = TextColumn | GeoColumn;

export const ENCRYPTED_COLUMNS: readonly EncryptedColumn[] = [
  {
    kind: "text",
    table: "employee",
    plain: "phone",
    enc: "phone_enc",
    bidx: "phone_bidx",
    normalize: normalizePhone,
  },
  {
    kind: "text",
    table: "inquiry",
    plain: "phone",
    enc: "phone_enc",
    bidx: "phone_bidx",
    normalize: normalizePhone,
  },
  {
    kind: "text",
    table: "job_application",
    plain: "phone",
    enc: "phone_enc",
    bidx: "phone_bidx",
    normalize: normalizePhone,
  },
  { kind: "text", table: "leave_request", plain: "reason", enc: "reason_enc" },
  {
    kind: "geo",
    table: "attendance_event",
    plains: ["geo_lat", "geo_lng", "geo_accuracy_m", "geo_captured_at"],
    enc: "geo_enc",
  },
  // Bí mật TOTP (D-058): chỉ có bản mã; cột bản rõ bị CHECK buộc luôn NULL (backfill không có gì làm, xoay khoá vẫn áp).
  { kind: "text", table: "app_user", plain: "totp_secret", enc: "totp_secret_enc" },
];

/** Tập "bảng.cột bản rõ" mà COMMENT phải ghi `enc=yes`. */
export function encryptedPlainColumns(): string[] {
  return ENCRYPTED_COLUMNS.flatMap((c) =>
    c.kind === "geo" ? c.plains.map((p) => `${c.table}.${p}`) : [`${c.table}.${c.plain}`],
  );
}

export function textColumn(table: string, plain: string): TextColumn {
  const c = ENCRYPTED_COLUMNS.find(
    (x): x is TextColumn => x.kind === "text" && x.table === table && x.plain === plain,
  );
  if (!c) throw new Error(`cột ${table}.${plain} chưa đăng ký mã hoá`);
  return c;
}

/** Chỉ mục mù của một giá trị cho cột (null nếu cột không có chỉ mục hoặc giá trị rỗng). Dùng cả khi ghi lẫn khi tìm. */
export function bidxOf(c: TextColumn, value: string | null | undefined): string | null {
  if (c.bidx === undefined || value === null || value === undefined) return null;
  return blindIndex(`${c.table}.${c.plain}`, (c.normalize ?? ((v) => v))(value));
}

export interface Sealed {
  enc: string | null;
  bidx: string | null;
}

/**
 * Mã hoá giá trị của cột (null → cả hai null). `rowId` phải là id dòng sẽ ghi (AAD). Đồng bộ: dùng bộ khoá env (hoặc `ring` tiêm vào);
 * miền nghiệp vụ gọi bản `sealTextAsync` để đi qua nhà cung cấp khoá (env | KMS transit).
 */
export function sealText(
  c: TextColumn,
  rowId: string,
  value: string | null | undefined,
  ring?: Keyring,
): Sealed {
  if (value === null || value === undefined) return { enc: null, bidx: null };
  return {
    enc: encryptField({ table: c.table, column: c.enc, rowId }, value, ring),
    bidx: bidxOf(c, value),
  };
}

export async function sealTextAsync(
  c: TextColumn,
  rowId: string,
  value: string | null | undefined,
): Promise<Sealed> {
  if (value === null || value === undefined) return { enc: null, bidx: null };
  return sealText(c, rowId, value, await keyProvider().ringForWrite());
}

/** Đọc giá trị: ưu tiên cột mã hoá (giải mã, sai AAD → lỗi), rơi về cột bản rõ của dòng cũ. */
export function openText(
  c: TextColumn,
  rowId: string,
  row: Record<string, unknown>,
  ring?: Keyring,
): string | null {
  const enc = row[c.enc];
  if (typeof enc === "string") return decryptField({ table: c.table, column: c.enc, rowId }, enc, ring);
  const plain = row[c.plain];
  return typeof plain === "string" ? plain : null;
}

export async function openTextAsync(
  c: TextColumn,
  rowId: string,
  row: Record<string, unknown>,
): Promise<string | null> {
  const enc = row[c.enc];
  return openText(
    c,
    rowId,
    row,
    typeof enc === "string" ? await keyProvider().ringForRead([enc]) : undefined,
  );
}

export interface GeoValue {
  lat: number;
  lng: number;
  accuracy_m: number;
  /** ISO 8601 UTC. */
  captured_at: string;
}

const GEO_CTX = (rowId: string) => ({ table: "attendance_event", column: "geo_enc", rowId });

export function sealGeo(rowId: string, g: GeoValue, ring?: Keyring): string {
  return encryptField(GEO_CTX(rowId), JSON.stringify(g), ring);
}

export async function sealGeoAsync(rowId: string, g: GeoValue): Promise<string> {
  return sealGeo(rowId, g, await keyProvider().ringForWrite());
}

export async function openGeoAsync(rowId: string, row: Record<string, unknown>): Promise<GeoValue | null> {
  const enc = row.geo_enc;
  return openGeo(rowId, row, typeof enc === "string" ? await keyProvider().ringForRead([enc]) : undefined);
}

export function openGeo(rowId: string, row: Record<string, unknown>, ring?: Keyring): GeoValue | null {
  const enc = row.geo_enc;
  if (typeof enc === "string") return JSON.parse(decryptField(GEO_CTX(rowId), enc, ring)) as GeoValue;
  if (typeof row.geo_lat !== "number" || typeof row.geo_lng !== "number") return null;
  const at = row.geo_captured_at;
  return {
    lat: row.geo_lat,
    lng: row.geo_lng,
    accuracy_m: typeof row.geo_accuracy_m === "number" ? row.geo_accuracy_m : 0,
    captured_at: at instanceof Date ? at.toISOString() : typeof at === "string" ? at : "",
  };
}

/**
 * Giải mã cột cho danh sách dòng (có `id`): thay giá trị `plain` bằng bản đọc được (ưu tiên bản mã) và BỎ `enc`/`bidx` khỏi kết quả
 * để không lộ bản mã/chỉ mục ra API. Các dòng phải được SELECT cả cột `plain` lẫn `enc`.
 */
export function revealText<R extends Record<string, unknown>>(
  table: string,
  plain: string,
  rows: R[],
  ring?: Keyring,
): Record<string, unknown>[] {
  const c = textColumn(table, plain);
  return rows.map((r) => {
    const rest: Record<string, unknown> = { ...r };
    delete rest[c.enc];
    if (c.bidx !== undefined) delete rest[c.bidx];
    return { ...rest, [plain]: openText(c, String(r.id), r, ring) };
  });
}

/** Như `revealText` nhưng đi qua nhà cung cấp khoá: mở mọi DEK cần dùng một lần (gộp theo chuỗi bọc) rồi giải mã đồng bộ. */
export async function revealTextAsync<R extends Record<string, unknown>>(
  table: string,
  plain: string,
  rows: R[],
): Promise<Record<string, unknown>[]> {
  const c = textColumn(table, plain);
  const envs = rows.map((r) => r[c.enc]).filter((v): v is string => typeof v === "string");
  return revealText(table, plain, rows, envs.length > 0 ? await keyProvider().ringForRead(envs) : undefined);
}
