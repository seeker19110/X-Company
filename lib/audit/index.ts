// Nhật ký kiểm toán (F-002): ghi trong CÙNG giao dịch với thay đổi nghiệp vụ, chuỗi băm tuyến tính theo công ty.
// hash = sha256(prev_hash + "\n" + canonicalJson(bản ghi)); khoá advisory theo chuỗi để hai giao dịch không chen nhau.
import { createHash, randomUUID } from "node:crypto";
import type { Queryable } from "../db/index.ts";

export const GENESIS = "0".repeat(64);
const SENSITIVE_KEY = /pass|token|secret|hash|totp|otp|cookie|session/i;
export const MASK = "[đã che]";

export interface AuditInput {
  actorUserId: string | null;
  companyId: string | null;
  action: string;
  objectType: string;
  objectId?: string | null;
  reason?: string | null;
  result?: "ok" | "denied" | "error";
  before?: unknown;
  after?: unknown;
  requestId?: string | null;
}

export interface AuditRecord {
  id: string;
  chainKey: string;
  occurredAt: string;
  actorUserId: string | null;
  companyId: string | null;
  action: string;
  objectType: string;
  objectId: string | null;
  reason: string | null;
  result: "ok" | "denied" | "error";
  before: unknown;
  after: unknown;
  requestId: string | null;
  prevHash: string;
}

/** Che trường nhạy cảm (đệ quy) trước khi ghi before/after. */
export function maskSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSensitive);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? MASK : maskSensitive(v);
    }
    return out;
  }
  return value;
}

/** JSON chuẩn hoá: khoá sắp xếp, không khoảng trắng — để băm ổn định. */
export function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashRecord(rec: AuditRecord): string {
  return createHash("sha256")
    .update(rec.prevHash + "\n" + canonicalJson(rec))
    .digest("hex");
}

export function chainKeyOf(companyId: string | null): string {
  return companyId ?? "system";
}

/** Ghi một sự kiện kiểm toán bằng `tx` của giao dịch nghiệp vụ. Trả id. */
export async function appendAudit(tx: Queryable, input: AuditInput): Promise<string> {
  const chainKey = chainKeyOf(input.companyId);
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('audit:' || $1, 0))", [chainKey]);
  const last = await tx.query<{ hash: string }>(
    "SELECT hash FROM audit_event WHERE chain_key = $1 ORDER BY seq DESC LIMIT 1",
    [chainKey],
  );
  const rec: AuditRecord = {
    id: randomUUID(),
    chainKey,
    occurredAt: new Date().toISOString(),
    actorUserId: input.actorUserId,
    companyId: input.companyId,
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId ?? null,
    reason: input.reason ?? null,
    result: input.result ?? "ok",
    before: input.before === undefined ? null : maskSensitive(input.before),
    after: input.after === undefined ? null : maskSensitive(input.after),
    requestId: input.requestId ?? null,
    prevHash: last.rows[0]?.hash ?? GENESIS,
  };
  const hash = hashRecord(rec);
  await tx.query(
    `INSERT INTO audit_event (id, chain_key, occurred_at, actor_user_id, company_id, action, object_type, object_id,
       reason, result, before, after, request_id, prev_hash, hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      rec.id,
      rec.chainKey,
      rec.occurredAt,
      rec.actorUserId,
      rec.companyId,
      rec.action,
      rec.objectType,
      rec.objectId,
      rec.reason,
      rec.result,
      rec.before === null ? null : JSON.stringify(rec.before),
      rec.after === null ? null : JSON.stringify(rec.after),
      rec.requestId,
      rec.prevHash,
      hash,
    ],
  );
  return rec.id;
}

interface Row {
  id: string;
  chain_key: string;
  occurred_at: Date;
  actor_user_id: string | null;
  company_id: string | null;
  action: string;
  object_type: string;
  object_id: string | null;
  reason: string | null;
  result: "ok" | "denied" | "error";
  before: unknown;
  after: unknown;
  request_id: string | null;
  prev_hash: string;
  hash: string;
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  firstBadId: string | null;
  problem: string | null;
}

/** Kiểm lại toàn bộ chuỗi (hoặc một chuỗi): mỗi hàng băm đúng và nối đúng hàng trước. */
export async function verifyAuditChain(db: Queryable, chainKey?: string): Promise<VerifyResult> {
  const { rows } = await db.query<Row>(
    `SELECT * FROM audit_event ${chainKey ? "WHERE chain_key = $1" : ""} ORDER BY chain_key, seq`,
    chainKey ? [chainKey] : [],
  );
  const lastHash = new Map<string, string>();
  let checked = 0;
  for (const r of rows) {
    const expectedPrev = lastHash.get(r.chain_key) ?? GENESIS;
    if (r.prev_hash !== expectedPrev) {
      return { ok: false, checked, firstBadId: r.id, problem: "đứt chuỗi (prev_hash không khớp)" };
    }
    const rec: AuditRecord = {
      id: r.id,
      chainKey: r.chain_key,
      occurredAt: r.occurred_at.toISOString(),
      actorUserId: r.actor_user_id,
      companyId: r.company_id,
      action: r.action,
      objectType: r.object_type,
      objectId: r.object_id,
      reason: r.reason,
      result: r.result,
      before: r.before,
      after: r.after,
      requestId: r.request_id,
      prevHash: r.prev_hash,
    };
    if (hashRecord(rec) !== r.hash) {
      return { ok: false, checked, firstBadId: r.id, problem: "nội dung bị sửa (hash không khớp)" };
    }
    lastHash.set(r.chain_key, r.hash);
    checked++;
  }
  return { ok: true, checked, firstBadId: null, problem: null };
}
