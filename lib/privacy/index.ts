// Quyền chủ thể dữ liệu (DSAR, T-040): tiếp nhận yêu cầu (access | delete | withdraw_consent | restrict), hạn xử lý cấu hình
// (DSAR_DAYS), xử lý từng loại, truy vấn quá hạn. Mọi ghi nằm trong giao dịch của người gọi kèm `appendAudit` (không PII:
// chỉ mã nghiệp vụ/đếm/danh mục). Quyền `privacy.manage` kiểm ở route (lib/privacy/routes.ts); hàm ở đây tin người gọi.
import { z } from "zod";
import { appendAudit } from "../audit/index.ts";
import type { Queryable } from "../db/index.ts";
import { getStorage } from "../files/storage.ts";
import { AppError } from "../nen/app-error.ts";
import { env } from "../nen/env.ts";
import { fetchLimit, MAX_PAGE, toPage, type Page, type PageRequest } from "../nen/pagination.ts";
import { BUSINESS_TZ } from "../nen/time.ts";
import { anonymizeById } from "../worker/retention.ts";
import { activePurposes, listConsents, withdrawConsent, type SubjectType } from "./consent.ts";
import { CATEGORY_AUDIT_LOG, CATEGORY_CONSENT_EVIDENCE, RETAINED_BY_SUBJECT } from "./retained.ts";
import { MS_PER_DAY } from "../nen/units.ts";
import { t } from "../i18n/index.ts";

export { type SubjectType } from "./consent.ts";

const DAY_MS = MS_PER_DAY;
export const KINDS = ["access", "delete", "withdraw_consent", "restrict"] as const;
export type RequestKind = (typeof KINDS)[number];
export type RequestStatus = "received" | "in_progress" | "done" | "rejected";
const SUBJECT_TYPES = ["inquiry", "job_application", "employee"] as const;

export interface PrivacyActor {
  userId: string;
  companyId: string;
  requestId?: string | null;
}

/** Hạn xử lý (ngày) — CMP-INTL-007. Giá trị mặc định là giả định, pháp chế xác minh theo NĐ 356/2025. */
export const dsarDays = (): number => env("DSAR_DAYS");

export const CreateRequestInput = z.object({
  subject_type: z.enum(SUBJECT_TYPES),
  // Mã nghiệp vụ (YC-…/UV-…/mã nhân viên) hoặc uuid — KHÔNG nhận email/SĐT (không đưa PII vào bảng yêu cầu).
  subject_ref: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, t("err.privacy.subjectRefHint")),
  kind: z.enum(KINDS),
  note: z.string().trim().max(1000).nullish(),
});
export type CreateRequestInputT = z.infer<typeof CreateRequestInput>;

export interface RequestRow {
  id: string;
  company_id: string;
  subject_type: SubjectType;
  subject_ref: string;
  subject_id: string;
  kind: RequestKind;
  status: RequestStatus;
  received_at: Date;
  due_at: Date;
  closed_at: Date | null;
  handler: string | null;
  note: string | null;
  reject_reason: string | null;
  result: unknown;
}

const COLS =
  "id, company_id, subject_type, subject_ref, subject_id, kind, status, received_at, due_at, closed_at, handler, note, reject_reason, result";

const TABLE_OF = { inquiry: "inquiry", job_application: "job_application", employee: "employee" } as const;

async function resolveSubject(
  db: Queryable,
  companyId: string,
  type: SubjectType,
  ref: string,
): Promise<string> {
  // sql-interp-allow: `TABLE_OF[type]` là bảng hằng theo SubjectType (zod enum); giá trị qua $1, $2.
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM ${TABLE_OF[type]} WHERE company_id = $1 AND (code = $2 OR id::text = $2)`,
    [companyId, ref],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", 404, t("err.privacy.khongTimThayChuTheTheo"));
  return rows[0].id;
}

async function lockRequest(tx: Queryable, companyId: string, id: string): Promise<RequestRow> {
  // sql-interp-allow: `COLS` là hằng danh sách cột nội bộ của tệp này; mọi giá trị qua $n.
  const { rows } = await tx.query<RequestRow>(
    `SELECT ${COLS} FROM data_subject_request WHERE company_id = $1 AND id = $2 FOR UPDATE`,
    [companyId, id],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", 404, t("err.shared.khongTimThayYeuCau"));
  return rows[0];
}

/** Người phụ trách ghi nhận yêu cầu nhận qua kênh liên hệ; hạn = lúc nhận + DSAR_DAYS. */
export async function createRequest(
  tx: Queryable,
  actor: PrivacyActor,
  input: CreateRequestInputT,
  now: Date = new Date(),
  days: number = dsarDays(),
): Promise<RequestRow> {
  const subjectId = await resolveSubject(tx, actor.companyId, input.subject_type, input.subject_ref);
  let row: RequestRow;
  try {
    // sql-interp-allow: `COLS` là hằng danh sách cột nội bộ của tệp này; mọi giá trị qua $n.
    const r = await tx.query<RequestRow>(
      `INSERT INTO data_subject_request (company_id, subject_type, subject_ref, subject_id, kind, received_at, due_at, note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${COLS}`,
      [
        actor.companyId,
        input.subject_type,
        input.subject_ref,
        subjectId,
        input.kind,
        now,
        new Date(now.getTime() + days * DAY_MS),
        input.note ?? null,
      ],
    );
    row = r.rows[0]!;
  } catch (err) {
    if ((err as { code?: string }).code === "23505")
      throw new AppError("DUPLICATE_REQUEST", 409, t("err.privacy.daCoYeuCauCungLoai"));
    throw err;
  }
  await audit(tx, actor, "privacy.request.create", row, null, { kind: row.kind, due_at: row.due_at });
  return row;
}

async function audit(
  tx: Queryable,
  actor: PrivacyActor,
  action: string,
  req: Pick<RequestRow, "id" | "kind" | "subject_type">,
  before: unknown,
  after: unknown,
  reason?: string | null,
): Promise<void> {
  await appendAudit(tx, {
    actorUserId: actor.userId,
    companyId: actor.companyId,
    action,
    objectType: "data_subject_request",
    objectId: req.id,
    before,
    after: { subject_type: req.subject_type, ...(after as object) },
    reason: reason ?? null,
    requestId: actor.requestId ?? null,
  });
}

export interface ListOptions {
  status?: RequestStatus;
  overdueOnly?: boolean;
  now?: Date;
  /** Mặc định trang lớn nhất (200) cho nơi gọi nội bộ; route truyền trang người dùng xin (XC-PERF-006). */
  page?: PageRequest;
}

export async function listRequestsPage(
  db: Queryable,
  companyId: string,
  opts: ListOptions = {},
): Promise<Page<RequestRow & { overdue: boolean }>> {
  const now = opts.now ?? new Date();
  const page = opts.page ?? MAX_PAGE;
  // sql-interp-allow: `COLS` là hằng danh sách cột nội bộ của tệp này; mọi giá trị qua $n.
  const { rows } = await db.query<RequestRow & { overdue: boolean }>(
    `SELECT ${COLS}, (status IN ('received', 'in_progress') AND due_at < $2) AS overdue
       FROM data_subject_request
      WHERE company_id = $1
        AND ($3::text IS NULL OR status = $3)
        AND (NOT $4::boolean OR (status IN ('received', 'in_progress') AND due_at < $2))
      ORDER BY (status IN ('done', 'rejected')), due_at, id LIMIT $5 OFFSET $6`,
    [companyId, now, opts.status ?? null, opts.overdueOnly ?? false, fetchLimit(page), page.offset],
  );
  return toPage(rows, page);
}

export async function listRequests(
  db: Queryable,
  companyId: string,
  opts: ListOptions = {},
): Promise<(RequestRow & { overdue: boolean })[]> {
  return (await listRequestsPage(db, companyId, opts)).items;
}

/** Yêu cầu quá hạn chưa đóng (cho dashboard/cảnh báo — CMP-INTL-007: số quá hạn phải = 0). */
export const listOverdue = (db: Queryable, companyId: string, now: Date = new Date()) =>
  listRequests(db, companyId, { overdueOnly: true, now });

export async function startRequest(tx: Queryable, actor: PrivacyActor, id: string): Promise<RequestRow> {
  const cur = await lockRequest(tx, actor.companyId, id);
  if (cur.status !== "received")
    throw new AppError("INVALID_STATE", 409, t("err.privacy.cannotStartInState", { status: cur.status }));
  // sql-interp-allow: `COLS` là hằng danh sách cột nội bộ của tệp này; mọi giá trị qua $n.
  const { rows } = await tx.query<RequestRow>(
    `UPDATE data_subject_request SET status = 'in_progress', handler = $3 WHERE company_id = $1 AND id = $2
      RETURNING ${COLS}`,
    [actor.companyId, id, actor.userId],
  );
  await audit(tx, actor, "privacy.request.start", cur, { status: cur.status }, { status: "in_progress" });
  return rows[0]!;
}

export async function rejectRequest(
  tx: Queryable,
  actor: PrivacyActor,
  id: string,
  reason: string,
  now: Date = new Date(),
): Promise<RequestRow> {
  const why = reason.trim();
  if (why.length < 1 || why.length > 1000)
    throw new AppError("VALIDATION", 422, t("err.privacy.canNeuCanCuTuChoi"));
  const cur = await lockRequest(tx, actor.companyId, id);
  if (cur.status === "done" || cur.status === "rejected")
    throw new AppError("INVALID_STATE", 409, t("err.privacy.requestClosed", { status: cur.status }));
  // sql-interp-allow: `COLS` là hằng danh sách cột nội bộ của tệp này; mọi giá trị qua $n.
  const { rows } = await tx.query<RequestRow>(
    `UPDATE data_subject_request SET status = 'rejected', closed_at = $3, handler = $4, reject_reason = $5
      WHERE company_id = $1 AND id = $2 RETURNING ${COLS}`,
    [actor.companyId, id, now, actor.userId, why],
  );
  await audit(tx, actor, "privacy.request.reject", cur, { status: cur.status }, { status: "rejected" }, why);
  return rows[0]!;
}

/** Thực hiện yêu cầu theo `kind` rồi đóng `done` (cùng giao dịch). */
export async function completeRequest(
  tx: Queryable,
  actor: PrivacyActor,
  id: string,
  now: Date = new Date(),
): Promise<RequestRow> {
  const cur = await lockRequest(tx, actor.companyId, id);
  if (cur.status !== "received" && cur.status !== "in_progress")
    throw new AppError("INVALID_STATE", 409, t("err.privacy.requestClosed", { status: cur.status }));
  let result: Record<string, unknown>;
  switch (cur.kind) {
    case "access":
      result = { delivered_via: "export" };
      break;
    case "withdraw_consent":
      result = await executeWithdraw(tx, actor, cur, now);
      break;
    case "restrict":
      result = await executeRestrict(tx, actor, cur);
      break;
    case "delete":
      result = await executeDelete(tx, actor, cur, now);
      break;
  }
  // sql-interp-allow: `COLS` là hằng danh sách cột nội bộ của tệp này; mọi giá trị qua $n.
  const { rows } = await tx.query<RequestRow>(
    `UPDATE data_subject_request SET status = 'done', closed_at = $3, handler = $4, result = $5
      WHERE company_id = $1 AND id = $2 RETURNING ${COLS}`,
    [actor.companyId, id, now, actor.userId, JSON.stringify(result)],
  );
  await audit(tx, actor, "privacy.request.complete", cur, { status: cur.status }, { status: "done", result });
  return rows[0]!;
}

/** Dừng xử lý: trạng thái nghiệp vụ của chủ thể (inquiry → processing_stopped, ứng viên → withdrawn). */
async function stopSubject(tx: Queryable, actor: PrivacyActor, r: RequestRow, note: string): Promise<void> {
  if (r.subject_type === "inquiry") {
    const cur = await tx.query<{ status: string }>(
      "SELECT status FROM inquiry WHERE company_id = $1 AND id = $2 FOR UPDATE",
      [actor.companyId, r.subject_id],
    );
    const from = cur.rows[0]?.status;
    if (from && from !== "processing_stopped") {
      await tx.query("UPDATE inquiry SET status = 'processing_stopped' WHERE company_id = $1 AND id = $2", [
        actor.companyId,
        r.subject_id,
      ]);
      await tx.query(
        "INSERT INTO inquiry_history (company_id, inquiry_id, from_status, to_status, actor_user_id, note) VALUES ($1,$2,$3,'processing_stopped',$4,$5)",
        [actor.companyId, r.subject_id, from, actor.userId, note],
      );
    }
  } else if (r.subject_type === "job_application") {
    await tx.query(
      "UPDATE job_application SET status = 'withdrawn' WHERE company_id = $1 AND id = $2 AND status <> 'withdrawn'",
      [actor.companyId, r.subject_id],
    );
  }
}

async function executeWithdraw(
  tx: Queryable,
  actor: PrivacyActor,
  r: RequestRow,
  now: Date,
): Promise<Record<string, unknown>> {
  const purposes = await withdrawConsent(tx, actor.companyId, r.subject_type, r.subject_id, now);
  if (purposes.length === 0)
    throw new AppError("NO_ACTIVE_CONSENT", 422, t("err.privacy.khongCoDongYDangHieu"));
  await stopSubject(tx, actor, r, t("msg.privacy.stopWithdrawConsent"));
  return { withdrawn_purposes: purposes, processing_stopped: true };
}

async function executeRestrict(
  tx: Queryable,
  actor: PrivacyActor,
  r: RequestRow,
): Promise<Record<string, unknown>> {
  const ins = await tx.query(
    `INSERT INTO processing_restriction (company_id, subject_type, subject_id, kind, reason, request_id)
     VALUES ($1, $2, $3, 'restrict', $4, $5)
     ON CONFLICT (subject_type, subject_id, kind) WHERE released_at IS NULL DO NOTHING`,
    [actor.companyId, r.subject_type, r.subject_id, r.note ?? t("msg.privacy.stopRestrictRequest"), r.id],
  );
  return { restricted: true, newly_restricted: (ins.rowCount ?? 0) > 0 };
}

const OUTBOX_KEY = { inquiry: "inquiryId", job_application: "applicationId" } as const;

/** Ghi tệp thuộc chủ thể công khai (vd CV) để yêu cầu xoá dọn được cả blob — gọi cùng giao dịch với bản ghi chủ thể. */
export async function registerSubjectFile(
  tx: Queryable,
  companyId: string,
  subjectType: "inquiry" | "job_application",
  subjectId: string,
  storageKey: string,
): Promise<void> {
  await tx.query(
    "INSERT INTO subject_file (company_id, subject_type, subject_id, storage_key) VALUES ($1, $2, $3, $4)",
    [companyId, subjectType, subjectId, storageKey],
  );
}

async function executeDelete(
  tx: Queryable,
  actor: PrivacyActor,
  r: RequestRow,
  now: Date,
): Promise<Record<string, unknown>> {
  const retained = RETAINED_BY_SUBJECT[r.subject_type].map((c) => ({
    category: c.category,
    reason: c.reason,
  }));
  if (r.subject_type === "employee") {
    // Hồ sơ lao động/bảng công phải giữ theo luật: không xoá, đánh dấu hạn chế xử lý + ghi lý do giữ (CMP-RIGHTS-007).
    const reason = t("msg.privacy.retainedByLaw", {
      categories: retained
        .filter((c) => c.category !== CATEGORY_CONSENT_EVIDENCE && c.category !== CATEGORY_AUDIT_LOG)
        .map((c) => c.category)
        .join("; "),
    });
    await tx.query(
      `INSERT INTO processing_restriction (company_id, subject_type, subject_id, kind, reason, request_id)
       VALUES ($1, 'employee', $2, 'retained_by_law', $3, $4)
       ON CONFLICT (subject_type, subject_id, kind) WHERE released_at IS NULL DO NOTHING`,
      [actor.companyId, r.subject_id, reason, r.id],
    );
    await audit(tx, actor, "privacy.erase", r, null, { retained: retained.map((c) => c.category) });
    return { erased: false, outcome: "retained_by_law", retained };
  }

  const subjectType = r.subject_type;
  // 1) Dừng xử lý (ghi dòng rút nếu còn đồng ý) trước khi xoá — worker bỏ qua sự kiện còn sót.
  const withdrawn = await withdrawConsent(tx, actor.companyId, subjectType, r.subject_id, now);
  if (subjectType === "inquiry")
    await tx.query(
      "UPDATE inquiry_history SET note = NULL WHERE company_id = $1 AND inquiry_id = $2 AND actor_user_id IS NOT NULL",
      [actor.companyId, r.subject_id],
    ); // ghi chú tự do của người xử lý có thể chứa PII; ghi chú hệ thống (actor rỗng) giữ nguyên
  await stopSubject(tx, actor, r, t("msg.privacy.stopErase"));
  // 2) Kho tệp: xoá blob trong giao dịch (xoá idempotent; giao dịch lỗi → chạy lại vẫn xoá được, hàng dữ liệu còn nguyên).
  const files = await tx.query<{ id: string; storage_key: string }>(
    "SELECT id, storage_key FROM subject_file WHERE company_id = $1 AND subject_type = $2 AND subject_id = $3 FOR UPDATE",
    [actor.companyId, subjectType, r.subject_id],
  );
  const storage = getStorage();
  for (const f of files.rows) await storage.remove(f.storage_key);
  await tx.query("DELETE FROM subject_file WHERE company_id = $1 AND subject_type = $2 AND subject_id = $3", [
    actor.companyId,
    subjectType,
    r.subject_id,
  ]);
  // 3) DB: ẩn danh bằng đúng hàm của retention.
  const anonymized = await anonymizeById(tx, TABLE_OF[subjectType], actor.companyId, r.subject_id, now);
  // 4) Outbox: payload chứa id/mã hồ sơ → che; việc chưa gửi bị đóng (không gửi tin cho chủ thể đã yêu cầu xoá).
  const key = OUTBOX_KEY[subjectType];
  const ob = await tx.query(
    `UPDATE outbox_event
        SET payload = '{"redacted": true}'::jsonb,
            status = CASE WHEN status IN ('pending', 'processing') THEN 'done' ELSE status END,
            processed_at = CASE WHEN status IN ('pending', 'processing') THEN $3 ELSE processed_at END,
            locked_until = NULL,
            last_error = NULL
      WHERE company_id = $1 AND payload ->> $4 = $2`,
    [actor.companyId, r.subject_id, now, key],
  );
  const result = {
    erased: true,
    outcome: "anonymized",
    anonymized_rows: anonymized ? 1 : 0,
    files_removed: files.rows.length,
    outbox_redacted: ob.rowCount ?? 0,
    consent_withdrawn: withdrawn,
    retained,
  };
  await audit(tx, actor, "privacy.erase", r, null, {
    anonymized_rows: result.anonymized_rows,
    files_removed: result.files_removed,
    outbox_redacted: result.outbox_redacted,
  });
  return result;
}

export interface SubjectExport {
  request: { id: string; kind: RequestKind; subject_type: SubjectType; received_at: Date; due_at: Date };
  generated_at: Date;
  data: Record<string, unknown>;
}

/** Xuất dữ liệu của CHÍNH chủ thể của yêu cầu `access` (không lộ dữ liệu người khác: bỏ id nhân sự khác/người phụ trách). */
export async function exportSubject(
  tx: Queryable,
  actor: PrivacyActor,
  id: string,
  now: Date = new Date(),
): Promise<SubjectExport> {
  const req = await lockRequest(tx, actor.companyId, id);
  if (req.kind !== "access") throw new AppError("INVALID_STATE", 409, t("err.privacy.chiYeuCauTruyCapMoi"));
  if (req.status === "rejected") throw new AppError("INVALID_STATE", 409, t("err.privacy.yeuCauDaBiTuChoi"));
  const { subject_type: type, subject_id: sid } = req;
  const one = async (sql: string, params: unknown[]) => (await tx.query(sql, params)).rows[0] ?? null;
  const many = async (sql: string, params: unknown[]) => (await tx.query(sql, params)).rows;
  const c = actor.companyId;
  let data: Record<string, unknown>;
  if (type === "inquiry") {
    data = {
      inquiry: await one(
        `SELECT code, name, email, phone, message, service_slug, source, status, consent_at, consent_notice_version,
                created_at, anonymized_at FROM inquiry WHERE company_id = $1 AND id = $2`,
        [c, sid],
      ),
      history: await many(
        "SELECT from_status, to_status, note, at FROM inquiry_history WHERE company_id = $1 AND inquiry_id = $2 ORDER BY id",
        [c, sid],
      ),
      consents: await listConsents(tx, type, sid),
    };
  } else if (type === "job_application") {
    data = {
      application: await one(
        `SELECT a.code, a.name, a.email, a.phone, a.cover_letter, a.status, a.consent_at, a.consent_notice_version,
                a.created_at, a.anonymized_at, p.slug AS job_slug
           FROM job_application a LEFT JOIN cms_page p ON p.company_id = a.company_id AND p.id = a.job_page_id
          WHERE a.company_id = $1 AND a.id = $2`,
        [c, sid],
      ),
      consents: await listConsents(tx, type, sid),
    };
  } else {
    data = {
      employee: await one(
        `SELECT code, full_name, work_email, phone, hired_on, terminated_on, created_at
           FROM employee WHERE company_id = $1 AND id = $2`,
        [c, sid],
      ),
      employment_history: await many(
        `SELECT title, department_id, valid_from, valid_to FROM employment_history
          WHERE company_id = $1 AND employee_id = $2 ORDER BY valid_from`,
        [c, sid],
      ),
      attendance_summary: await many(
        `SELECT to_char(device_time AT TIME ZONE $3, 'YYYY-MM') AS month, count(*)::int AS events,
                (count(*) FILTER (WHERE status = 'accepted'))::int AS accepted
           FROM attendance_event WHERE company_id = $1 AND employee_id = $2 GROUP BY 1 ORDER BY 1`,
        [c, sid, BUSINESS_TZ],
      ),
      consents: await listConsents(tx, type, sid),
    };
  }
  data.active_purposes = (await activePurposes(tx, type, sid)).map((p) => p.purpose_id);
  await audit(tx, actor, "privacy.export", req, null, { keys: Object.keys(data) });
  return {
    request: {
      id: req.id,
      kind: req.kind,
      subject_type: req.subject_type,
      received_at: req.received_at,
      due_at: req.due_at,
    },
    generated_at: now,
    data,
  };
}
