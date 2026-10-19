// Tiếp nhận từ website (F-003, AT01): mỗi submission_id → đúng một hồ sơ có mã, người phụ trách, hạn xử lý.
// Chống spam nhiều lớp: honeypot (giả thành công, không lưu), điền quá nhanh (đánh dấu), giới hạn theo IP đã băm.
import { createHmac, randomInt, randomUUID } from "node:crypto";
import type pg from "pg";
import { z } from "zod";
import { appendAudit } from "../audit/index.ts";
import { sealTextAsync, textColumn } from "../crypto/columns.ts";
import { withTx, type Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { sessionSecret } from "../nen/config.ts";
import { addBusinessDays, BUSINESS_TZ, localDate } from "../nen/time.ts";
import { enqueue } from "../outbox/index.ts";
import { minutesToMs, msToSeconds } from "../nen/units.ts";
import { InquiryInput, phoneRe, type InquiryInputT } from "./schema.pure.ts";
import {
  CHANNEL_WEB_FORM,
  isProcessingBlocked,
  PURPOSE_TALENT_POOL,
  recordConsent,
} from "../privacy/consent.ts";
import { t } from "../i18n/index.ts";

export const CONSENT_NOTICE_VERSION = "2026-10-18";
export const RATE_LIMIT = { max: 5, windowMs: minutesToMs(10) };
export const MIN_FILL_MS = 3000;

export { InquiryInput, type InquiryInputT };

export const ApplicationInput = z.object({
  submission_id: z.uuid(),
  job_slug: z
    .string()
    .regex(/^[a-z0-9-]{1,80}$/)
    .nullish(),
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254),
  phone: z.string().trim().regex(phoneRe).nullish(),
  cover_letter: z.string().max(8000).nullish(),
  consent: z.literal(true, { error: t("validation.inquiry.consent") }),
  // Đồng ý RIÊNG "kho nhân tài" (D-030): không bắt buộc, mặc định false — không tích sẵn, không gộp với `consent`.
  talent_pool: z.boolean().optional().default(false),
  website: z.string().max(200).optional().default(""),
  elapsed_ms: z.number().int().nonnegative().optional(),
});

export function hashIp(ip: string): string {
  return createHmac("sha256", sessionSecret()).update(`ip:${ip}`).digest("hex").slice(0, 32);
}

/** Ghi một lần gửi và từ chối khi vượt RATE_LIMIT trong cửa sổ (giao dịch riêng — lần gửi bị chặn vẫn được tính). */
export async function checkRate(
  pool: pg.Pool,
  bucket: string,
  ip: string,
  now: Date = new Date(),
): Promise<void> {
  const key = hashIp(ip);
  const since = new Date(now.getTime() - RATE_LIMIT.windowMs);
  // Đếm và ghi dưới cùng một khoá theo (bucket, IP): request song song không vượt giới hạn (review PR #8 #7).
  const r = await withTx(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('rate:' || $1 || '|' || $2, 0))", [
      bucket,
      key,
    ]);
    const { rows } = await tx.query<{ n: number; oldest: Date | null }>(
      "SELECT count(*)::int AS n, min(at) AS oldest FROM public_rate_event WHERE bucket = $1 AND key_hash = $2 AND at > $3",
      [bucket, key, since],
    );
    await tx.query("INSERT INTO public_rate_event (bucket, key_hash, at) VALUES ($1, $2, $3)", [
      bucket,
      key,
      now,
    ]);
    return rows[0]!;
  }, pool);
  if (r.n >= RATE_LIMIT.max) {
    const oldest = r.oldest?.getTime() ?? now.getTime();
    const retryAfter = Math.max(1, Math.ceil(msToSeconds(oldest + RATE_LIMIT.windowMs - now.getTime())));
    throw new AppError("RATE_LIMITED", 429, t("err.inquiry.banGuiQuaNhieuLanVui"), { retryAfter });
  }
}

async function nextCode(tx: Queryable, companyId: string, kind: "YC" | "UV", now: Date): Promise<string> {
  const day = localDate(now, BUSINESS_TZ);
  const { rows } = await tx.query<{ n: number }>(
    `INSERT INTO daily_counter (company_id, kind, day, n) VALUES ($1, $2, $3, 1)
     ON CONFLICT (company_id, kind, day) DO UPDATE SET n = daily_counter.n + 1 RETURNING n`,
    [companyId, kind, day],
  );
  return `${kind}-${day.replaceAll("-", "")}-${String(rows[0]!.n).padStart(4, "0")}`;
}

/** Mã giả cho honeypot — cùng dạng mã thật để bot không phân biệt được. */
function decoyCode(kind: "YC" | "UV", now: Date): string {
  return `${kind}-${localDate(now).replaceAll("-", "")}-${String(randomInt(1, 9999)).padStart(4, "0")}`;
}

export interface SubmitResult {
  code: string;
  created: boolean;
}

/** INSERT … ON CONFLICT không chèn được vì submission_id đã có (DB-TX-004) → quay lại giao dịch để không đốt số mã. */
class DuplicateSubmission extends Error {}

/** Mã của hồ sơ đã có theo submission_id (đường lặp lại: cùng id → cùng mã, created=false). */
async function existingCode(
  db: Queryable,
  table: "inquiry" | "job_application",
  companyId: string,
  submissionId: string,
): Promise<SubmitResult | null> {
  const { rows } = await db.query<{ code: string }>(
    // sql-interp-allow: `table` có kiểu hợp nhất "inquiry" | "job_application" (hằng của người gọi).
    `SELECT code FROM ${table} WHERE company_id = $1 AND submission_id = $2`,
    [companyId, submissionId],
  );
  return rows[0] ? { code: rows[0].code, created: false } : null;
}

export async function submitInquiry(
  pool: pg.Pool,
  companyId: string,
  input: InquiryInputT,
  meta: { ip: string; requestId?: string | null },
  now: Date = new Date(),
): Promise<SubmitResult> {
  if (input.website !== "") return { code: decoyCode("YC", now), created: false }; // honeypot: giả thành công, không lưu
  try {
    return await insertInquiry(companyId, input, meta, now);
  } catch (err) {
    // Hai lần gửi đồng thời cùng submission_id: UNIQUE quyết định (DB-TX-004), bên thua trả hồ sơ của bên thắng.
    if (err instanceof DuplicateSubmission) {
      const dup = await existingCode(pool, "inquiry", companyId, input.submission_id);
      if (dup) return dup;
    }
    throw err;
  }
}

async function insertInquiry(
  companyId: string,
  input: InquiryInputT,
  meta: { ip: string; requestId?: string | null },
  now: Date,
): Promise<SubmitResult> {
  return withTx(async (tx) => {
    const existing = await existingCode(tx, "inquiry", companyId, input.submission_id); // đường nhanh, không phải cổng chặn
    if (existing) return existing;

    const route = await tx.query<{ assignee_user_id: string }>(
      `SELECT r.assignee_user_id FROM inquiry_route r JOIN app_user u ON u.id = r.assignee_user_id AND u.disabled_at IS NULL
       WHERE r.company_id = $1 AND (r.service_slug = $2 OR r.service_slug IS NULL)
       ORDER BY r.service_slug NULLS LAST LIMIT 1`,
      [companyId, input.service ?? null],
    );
    const assignee = route.rows[0]?.assignee_user_id ?? null;
    const status = assignee ? "assigned" : "new";
    const code = await nextCode(tx, companyId, "YC", now);
    const spam = input.elapsed_ms !== undefined && input.elapsed_ms < MIN_FILL_MS;
    // SĐT ghi dạng mã hoá (T-048): id sinh trước vì AAD gắn id dòng; cột bản rõ để NULL.
    const newId = randomUUID();
    const phone = await sealTextAsync(textColumn("inquiry", "phone"), newId, input.phone);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO inquiry (id, company_id, code, submission_id, name, email, phone_enc, phone_bidx, message, service_slug, source, consent_at,
         consent_notice_version, status, assignee_user_id, due_at, suspected_spam, ip_hash, created_at)
       VALUES ($18,$1,$2,$3,$4,$5,$6,$17,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$10)
       ON CONFLICT (company_id, submission_id) DO NOTHING RETURNING id`,
      [
        companyId,
        code,
        input.submission_id,
        input.name,
        input.email?.toLowerCase() ?? null,
        phone.enc,
        input.message,
        input.service ?? null,
        input.source ?? null,
        now,
        CONSENT_NOTICE_VERSION,
        status,
        assignee,
        addBusinessDays(now, 1),
        spam,
        hashIp(meta.ip),
        phone.bidx,
        newId,
      ],
    );
    if (!rows[0]) throw new DuplicateSubmission();
    const id = rows[0].id;
    // Đồng ý theo mục đích (CMP-VN-001): bằng chứng ghi cùng giao dịch với hồ sơ — không có đồng ý thì không có hồ sơ.
    await recordConsent(tx, {
      companyId,
      subjectType: "inquiry",
      subjectId: id,
      purposeId: "inquiry_contact",
      policyVersion: CONSENT_NOTICE_VERSION,
      channel: CHANNEL_WEB_FORM,
      at: now,
    });
    await tx.query(
      "INSERT INTO inquiry_history (company_id, inquiry_id, from_status, to_status, note, at) VALUES ($1, $2, NULL, $3, $4, $5)",
      [companyId, id, status, assignee ? t("msg.inquiry.autoRouted") : t("msg.inquiry.noRoutingRule"), now],
    );
    await appendAudit(tx, {
      actorUserId: null,
      companyId,
      action: "inquiry.create",
      objectType: "inquiry",
      objectId: id,
      after: { code, status, assignee, spam },
      requestId: meta.requestId ?? null,
    });
    if (assignee)
      await enqueue(tx, companyId, "inquiry.assigned", { inquiryId: id, code, assigneeUserId: assignee });
    return { code, created: true };
  });
}

export async function submitApplication(
  pool: pg.Pool,
  companyId: string,
  input: z.infer<typeof ApplicationInput>,
  meta: { ip: string; requestId?: string | null },
  now: Date = new Date(),
): Promise<SubmitResult> {
  if (input.website !== "") return { code: decoyCode("UV", now), created: false };
  try {
    return await insertApplication(companyId, input, meta, now);
  } catch (err) {
    if (err instanceof DuplicateSubmission) {
      const dup = await existingCode(pool, "job_application", companyId, input.submission_id);
      if (dup) return dup;
    }
    throw err;
  }
}

async function insertApplication(
  companyId: string,
  input: z.infer<typeof ApplicationInput>,
  meta: { ip: string; requestId?: string | null },
  now: Date,
): Promise<SubmitResult> {
  return withTx(async (tx) => {
    const existing = await existingCode(tx, "job_application", companyId, input.submission_id);
    if (existing) return existing;
    let jobPageId: string | null = null;
    if (input.job_slug) {
      const j = await tx.query<{ id: string }>(
        "SELECT id FROM cms_page WHERE company_id = $1 AND type = 'job' AND slug = $2 AND archived_at IS NULL",
        [companyId, input.job_slug],
      );
      if (!j.rows[0]) throw new AppError("NOT_FOUND", 404, t("err.inquiry.khongTimThayViTriTuyen"));
      jobPageId = j.rows[0].id;
    }
    const code = await nextCode(tx, companyId, "UV", now);
    const newId = randomUUID();
    const phone = await sealTextAsync(textColumn("job_application", "phone"), newId, input.phone);
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO job_application (id, company_id, code, submission_id, job_page_id, name, email, phone_enc, phone_bidx, cover_letter,
         consent_at, consent_notice_version, suspected_spam, ip_hash, created_at)
       VALUES ($13,$1,$2,$3,$4,$5,$6,$7,$14,$8,$9,$10,$11,$12,$9)
       ON CONFLICT (company_id, submission_id) DO NOTHING RETURNING id`,
      [
        companyId,
        code,
        input.submission_id,
        jobPageId,
        input.name,
        input.email.toLowerCase(),
        phone.enc,
        input.cover_letter ?? null,
        now,
        CONSENT_NOTICE_VERSION,
        input.elapsed_ms !== undefined && input.elapsed_ms < MIN_FILL_MS,
        hashIp(meta.ip),
        newId,
        phone.bidx,
      ],
    );
    if (!rows[0]) throw new DuplicateSubmission();
    await recordConsent(tx, {
      companyId,
      subjectType: "job_application",
      subjectId: rows[0].id,
      purposeId: "job_application",
      policyVersion: CONSENT_NOTICE_VERSION,
      channel: CHANNEL_WEB_FORM,
      at: now,
    });
    if (input.talent_pool)
      await recordConsent(tx, {
        companyId,
        subjectType: "job_application",
        subjectId: rows[0].id,
        purposeId: PURPOSE_TALENT_POOL,
        policyVersion: CONSENT_NOTICE_VERSION,
        channel: CHANNEL_WEB_FORM,
        at: now,
      });
    await appendAudit(tx, {
      actorUserId: null,
      companyId,
      action: "application.create",
      objectType: "job_application",
      objectId: rows[0].id,
      after: { code, talent_pool: input.talent_pool },
      requestId: meta.requestId ?? null,
    });
    await enqueue(tx, companyId, "application.received", { applicationId: rows[0]!.id, code });
    return { code, created: true };
  });
}

export const INQUIRY_TRANSITIONS: Record<string, readonly string[]> = {
  new: ["assigned", "closed"],
  assigned: ["in_progress", "assigned", "closed"],
  in_progress: ["qualified", "closed", "assigned"],
  qualified: ["closed"],
  closed: [],
  // Rút đồng ý/xoá (T-040): dừng xử lý, không chuyển tiếp được.
  processing_stopped: [],
};

/** Đổi trạng thái / người phụ trách — lịch sử + audit. */
export async function updateInquiry(
  tx: Queryable,
  actor: { userId: string; companyId: string; requestId?: string | null },
  inquiryId: string,
  change: { status: string; assigneeUserId?: string | null; note?: string | null },
): Promise<void> {
  const { rows } = await tx.query<{ status: string; assignee_user_id: string | null }>(
    "SELECT status, assignee_user_id FROM inquiry WHERE company_id = $1 AND id = $2 FOR UPDATE",
    [actor.companyId, inquiryId],
  );
  const cur = rows[0];
  if (!cur) throw new AppError("NOT_FOUND", 404, t("err.shared.khongTimThayYeuCau"));
  if (await isProcessingBlocked(tx, "inquiry", inquiryId, "inquiry_contact"))
    throw new AppError("PROCESSING_RESTRICTED", 409, t("err.inquiry.chuTheDaRutDongY"));
  if (!INQUIRY_TRANSITIONS[cur.status]!.includes(change.status))
    throw new AppError(
      "INVALID_STATE",
      409,
      t("err.inquiry.invalidTransition", { from: cur.status, to: change.status }),
    );
  const assignee = change.assigneeUserId === undefined ? cur.assignee_user_id : change.assigneeUserId;
  if (change.status === "assigned" && !assignee)
    throw new AppError("VALIDATION", 422, t("err.inquiry.canNguoiPhuTrach"));
  try {
    await tx.query("UPDATE inquiry SET status = $2, assignee_user_id = $3 WHERE id = $1", [
      inquiryId,
      change.status,
      assignee,
    ]);
  } catch (err) {
    if ((err as { code?: string }).code === "23503")
      throw new AppError("INVALID_REFERENCE", 422, t("err.inquiry.nguoiPhuTrachKhongHopLe"));
    throw err;
  }
  await tx.query(
    "INSERT INTO inquiry_history (company_id, inquiry_id, from_status, to_status, actor_user_id, note) VALUES ($1,$2,$3,$4,$5,$6)",
    [actor.companyId, inquiryId, cur.status, change.status, actor.userId, change.note ?? null],
  );
  await appendAudit(tx, {
    actorUserId: actor.userId,
    companyId: actor.companyId,
    action: "inquiry.update",
    objectType: "inquiry",
    objectId: inquiryId,
    before: cur,
    after: { status: change.status, assignee },
    reason: change.note ?? null,
    requestId: actor.requestId ?? null,
  });
  if (assignee && assignee !== cur.assignee_user_id)
    await enqueue(tx, actor.companyId, "inquiry.assigned", { inquiryId, assigneeUserId: assignee });
}
