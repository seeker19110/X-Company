// Idempotency-Key cho POST ghi nghiệp vụ dưới /api/app/* (ARC-INT-001, BE-API-008) + giới hạn tần suất theo user
// (BE-REL-006). Dùng qua `withActor(handler, { idempotent: true, rateLimit })` — route không gọi trực tiếp.
//
// Luồng: (1) giao dịch ngắn dưới khoá advisory theo (công ty, user, khoá): chưa có → chèn `processing`; đã `done` cùng
// hash → phát lại nguyên văn; khác hash → 422; đang `processing` còn mới → 409. (2) chạy handler (các handler tự mở
// giao dịch nghiệp vụ của chúng). (3) 2xx → lưu phản hồi, `done`; lỗi/không-2xx → nhả khoá để thử lại được.
// Giới hạn đã biết: bước (3) là giao dịch riêng sau commit nghiệp vụ (handler tự `withTx`, không có giao dịch chung để
// bám) — nếu tiến trình chết đúng giữa hai commit, khoá còn `processing` tới hết STALE rồi cho chạy lại (có thể ghi
// trùng một lần, hiếm). Không áp cho chấm công/sync: chúng có khoá nghiệp vụ riêng trong DB (attendance_event
// UNIQUE theo idempotency_key / id bản ghi hàng chờ) nên đã idempotent theo bản ghi.
import { createHash } from "node:crypto";
import { getPool, withTx } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { log } from "../nen/log.ts";

export interface RateLimit {
  /** Nhóm đếm (mỗi nhóm route đắt một tên). */
  bucket: string;
  /** Số request tối đa mỗi cửa sổ. */
  max: number;
  windowSec: number;
}

export interface GuardOptions {
  /** true = bắt buộc header Idempotency-Key. */
  idempotent?: boolean;
  rateLimit?: RateLimit;
}

/** `processing` quá lâu coi như tiến trình đã chết, cho chạy lại (> statement_timeout 30 s × 2 + dư). */
const PROCESSING_STALE_SEC = 120;
/** Chặn đọc body khổng lồ khi băm; khớp trần tải lên (20 MB + biên). */
const MAX_HASH_BYTES = 21 * 1024 * 1024;
const KEY_RE = /^[\x21-\x7e]{8,255}$/;

export interface GuardCtx {
  req: Request;
  actor: { userId: string; companyId: string };
}

/** JSON → chuỗi chuẩn hoá (khoá đối tượng sắp xếp) để cùng nội dung khác thứ tự khoá vẫn cùng hash. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** sha256(method + route + body chuẩn hoá); multipart: băm trường + tên/nội dung tệp (biên giới multipart đổi mỗi lần gửi). */
export async function requestHash(req: Request): Promise<string> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > MAX_HASH_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", 413, "Dữ liệu quá lớn");
  const h = createHash("sha256");
  h.update(`${req.method}\n${new URL(req.url).pathname}\n`);
  const copy = req.clone();
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    let form: FormData;
    try {
      form = await copy.formData();
    } catch {
      throw new AppError("BAD_FORM", 400, "Cần multipart/form-data");
    }
    for (const [k, v] of [...form.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (typeof v === "string") h.update(`${k}=${v}\n`);
      else {
        const fileHash = createHash("sha256")
          .update(Buffer.from(await v.arrayBuffer()))
          .digest("hex");
        h.update(`${k}=file:${v.name}:${fileHash}\n`);
      }
    }
  } else {
    const text = await copy.text();
    let body = text;
    try {
      if (text !== "") body = canonicalJson(JSON.parse(text));
    } catch {
      // không phải JSON → băm nguyên văn; handler sẽ trả 400 BAD_JSON
    }
    h.update(body);
  }
  return h.digest("hex");
}

// Đồng hồ của cửa sổ đếm: null = now() của DB (production — một nguồn giờ cho mọi instance). Test cố định thời điểm
// để không vắt qua ranh giới cửa sổ giữa chừng (cửa sổ căn theo đồng hồ).
let rateClock: (() => Date) | null = null;
export function setRateClockForTest(fn: (() => Date) | null): void {
  rateClock = fn;
}

/** Đếm một lượt; vượt ngưỡng → 429 + retryAfter. Một câu lệnh upsert: nguyên tử giữa nhiều instance. */
export async function enforceRateLimit(userId: string, rl: RateLimit): Promise<void> {
  const r = await getPool().query<{ n: number; retry: number }>(
    `WITH t AS (SELECT COALESCE($4::timestamptz, now()) AS now)
     INSERT INTO api_rate_window (user_id, bucket, window_start, n)
     SELECT $1, $2, to_timestamp(floor(extract(epoch FROM t.now) / $3::int) * $3::int), 1 FROM t
     ON CONFLICT (user_id, bucket, window_start) DO UPDATE SET n = api_rate_window.n + 1
     RETURNING n, GREATEST(1, ceil(extract(epoch FROM window_start + make_interval(secs => $3::int)
       - (SELECT now FROM t))))::int AS retry`,
    [userId, rl.bucket, rl.windowSec, rateClock?.() ?? null],
  );
  const row = r.rows[0]!;
  if (row.n > rl.max) {
    log.warn("vượt giới hạn tần suất", { bucket: rl.bucket, actor_id: userId });
    throw new AppError("RATE_LIMITED", 429, "Bạn thao tác quá nhanh, vui lòng thử lại sau", {
      retryAfter: row.retry,
    });
  }
}

type Claim = { kind: "run" } | { kind: "replay"; status: number; body: string };

async function claim(ctx: GuardCtx, key: string, hash: string): Promise<Claim> {
  const { companyId, userId } = ctx.actor;
  return withTx(async (tx) => {
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('idem:' || $1 || '|' || $2 || '|' || $3, 0))",
      [companyId, userId, key],
    );
    const r = await tx.query<{
      request_hash: string;
      state: "processing" | "done";
      response_status: number | null;
      response_body: string | null;
      expired: boolean;
      stale: boolean;
    }>(
      `SELECT request_hash, state, response_status, response_body, expires_at <= now() AS expired,
              created_at <= now() - make_interval(secs => $4::int) AS stale
       FROM idempotency_record WHERE company_id = $1 AND user_id = $2 AND key = $3`,
      [companyId, userId, key, PROCESSING_STALE_SEC],
    );
    const row = r.rows[0];
    if (row && !row.expired) {
      if (row.request_hash !== hash)
        throw new AppError(
          "IDEMPOTENCY_KEY_REUSED",
          422,
          "Khoá Idempotency-Key này đã dùng cho một yêu cầu khác",
        );
      if (row.state === "done")
        return { kind: "replay", status: row.response_status!, body: row.response_body! };
      if (!row.stale)
        throw new AppError(
          "IDEMPOTENCY_IN_PROGRESS",
          409,
          "Yêu cầu trùng khoá đang được xử lý, thử lại sau",
          {
            retryAfter: 1,
          },
        );
    }
    await tx.query(
      `INSERT INTO idempotency_record (company_id, user_id, key, request_hash, state)
       VALUES ($1, $2, $3, $4, 'processing')
       ON CONFLICT (company_id, user_id, key) DO UPDATE
         SET request_hash = EXCLUDED.request_hash, state = 'processing', response_status = NULL,
             response_body = NULL, created_at = now(), expires_at = now() + interval '24 hours'`,
      [companyId, userId, key, hash],
    );
    return { kind: "run" };
  });
}

async function release(ctx: GuardCtx, key: string): Promise<void> {
  try {
    await getPool().query(
      "DELETE FROM idempotency_record WHERE company_id = $1 AND user_id = $2 AND key = $3 AND state = 'processing'",
      [ctx.actor.companyId, ctx.actor.userId, key],
    );
  } catch (err) {
    log.error("không nhả được khoá idempotency", { err }); // hết STALE sẽ tự cho chạy lại
  }
}

/** Bọc `run` bằng giới hạn tần suất và/hoặc idempotency theo `opts`. */
export async function guarded(
  ctx: GuardCtx,
  opts: GuardOptions,
  run: () => Promise<Response>,
): Promise<Response> {
  if (opts.rateLimit) await enforceRateLimit(ctx.actor.userId, opts.rateLimit);
  if (!opts.idempotent) return run();

  const key = ctx.req.headers.get("idempotency-key");
  if (key === null || key === "")
    throw new AppError("IDEMPOTENCY_KEY_REQUIRED", 400, "Thiếu header Idempotency-Key");
  if (!KEY_RE.test(key))
    throw new AppError(
      "IDEMPOTENCY_KEY_REQUIRED",
      400,
      "Idempotency-Key phải gồm 8–255 ký tự in được, không khoảng trắng",
    );

  const c = await claim(ctx, key, await requestHash(ctx.req));
  if (c.kind === "replay")
    return new Response(c.body, {
      status: c.status,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "idempotent-replayed": "true",
      },
    });

  let res: Response;
  try {
    res = await run();
  } catch (err) {
    await release(ctx, key);
    throw err;
  }
  if (res.status < 200 || res.status > 299) {
    await release(ctx, key);
    return res;
  }
  const body = await res.text();
  try {
    await getPool().query(
      `UPDATE idempotency_record SET state = 'done', response_status = $4, response_body = $5
       WHERE company_id = $1 AND user_id = $2 AND key = $3`,
      [ctx.actor.companyId, ctx.actor.userId, key, res.status, body],
    );
  } catch (err) {
    log.error("không lưu được phản hồi idempotency", { err });
  }
  return new Response(body, { status: res.status, headers: res.headers });
}
