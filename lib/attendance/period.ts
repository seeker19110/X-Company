// Kỳ công + sửa công (SPEC-attendance F-006, AT06): open → employee_review → manager_confirmed → hr_closed → locked
// (chỉ đi tới). Khoá: mọi ngoại lệ trọng yếu đã xử lý hoặc có giải trình → chụp số liệu (period_line phiên bản 1) +
// xuất v1. Sau khoá chỉ thay đổi qua điều chỉnh do HR duyệt → phiên bản số liệu + xuất mới; bản cũ giữ nguyên.
import { createHash } from "node:crypto";
import { can, type ActorContext } from "../authz/index.ts";
import type { Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { addDays, computeShift, localDateOf, type ShiftEvent } from "./compute.ts";
import { findAssignment } from "./events.ts";
import { auditDecision, employeeResource, requireNotSelf, requireOn } from "./scope.ts";

export const PERIOD_FLOW = ["open", "employee_review", "manager_confirmed", "hr_closed", "locked"] as const;
export type PeriodStatus = (typeof PERIOD_FLOW)[number];

export interface Period {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  status: PeriodStatus;
  currentVersion: number;
}

export interface Line {
  employeeId: string;
  businessDate: string;
  shiftAssignmentId: string | null;
  status: "ok" | "incomplete" | "absent" | "leave_only" | "ot_only";
  presentMinutes: number | null;
  otApprovedMinutes: number;
  leaveMinutes: number;
}

/** Đồng bộ (không async): gọi không cần await nên không thể vô tình bỏ qua kiểm quyền. */
function requireHr(actor: ActorContext, id: string): void {
  if (!can(actor, "period.manage", { companyId: actor.companyId }))
    throw new AppError("FORBIDDEN", 403, "Bạn không có quyền quản lý kỳ công", {
      action: "period.manage",
      object: { type: "attendance_period", id },
    });
}

export async function createPeriod(
  tx: Queryable,
  actor: ActorContext,
  p: { code: string; startDate: string; endDate: string },
): Promise<string> {
  requireHr(actor, p.code);
  try {
    const { rows } = await tx.query<{ id: string }>(
      "INSERT INTO attendance_period (company_id, code, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING id",
      [actor.companyId, p.code, p.startDate, p.endDate],
    );
    await auditDecision(tx, actor, "period.create", "attendance_period", rows[0]!.id, { after: p });
    return rows[0]!.id;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "23505" || code === "23P01")
      throw new AppError("PERIOD_OVERLAP", 409, "Kỳ công trùng mã hoặc chồng ngày");
    throw err;
  }
}

async function loadPeriod(db: Queryable, companyId: string, periodId: string, lock = false): Promise<Period> {
  const { rows } = await db.query<{
    id: string;
    code: string;
    start_date: string;
    end_date: string;
    status: PeriodStatus;
    current_version: number;
  }>(`SELECT * FROM attendance_period WHERE company_id = $1 AND id = $2 ${lock ? "FOR UPDATE" : ""}`, [
    companyId,
    periodId,
  ]);
  const r = rows[0];
  if (!r) throw new AppError("NOT_FOUND", 404, "Không tìm thấy kỳ công");
  return {
    id: r.id,
    code: r.code,
    startDate: r.start_date,
    endDate: r.end_date,
    status: r.status,
    currentVersion: r.current_version,
  };
}

/** Kỳ đã khoá chứa ngày nghiệp vụ `date` (null nếu không). */
export async function lockedPeriodFor(
  db: Queryable,
  companyId: string,
  date: string,
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM attendance_period WHERE company_id = $1 AND status = 'locked' AND $2::date BETWEEN start_date AND end_date",
    [companyId, date],
  );
  return rows[0]?.id ?? null;
}

// ---- Tính số liệu ------------------------------------------------------------------------------------------------

export async function computeLines(
  db: Queryable,
  companyId: string,
  start: string,
  end: string,
  employeeId?: string,
): Promise<Line[]> {
  const empFilter = employeeId ? "AND a.employee_id = $4" : "";
  const params: unknown[] = [companyId, start, end];
  if (employeeId) params.push(employeeId);
  const asg = await db.query<{
    id: string;
    employee_id: string;
    business_date: string;
    start_time: string;
    end_time: string;
    break_minutes: number;
    early_grace_minutes: number;
    late_grace_minutes: number;
    tz: string;
  }>(
    `SELECT a.id, a.employee_id, a.business_date, to_char(s.start_time, 'HH24:MI') AS start_time,
            to_char(s.end_time, 'HH24:MI') AS end_time, s.break_minutes, s.early_grace_minutes, s.late_grace_minutes, s.tz
     FROM shift_assignment a JOIN shift_template s ON s.id = a.shift_template_id
     WHERE a.company_id = $1 AND a.business_date BETWEEN $2::date AND $3::date ${empFilter}
     ORDER BY a.employee_id, a.business_date, s.start_time`,
    params,
  );
  const evParams: unknown[] = [companyId, addDays(start, -1), addDays(end, 2)];
  if (employeeId) evParams.push(employeeId);
  const ev = await db.query<{
    id: string;
    employee_id: string;
    kind: ShiftEvent["kind"];
    device_time: Date;
    device: string | null;
  }>(
    `SELECT id, employee_id, kind, device_time, device FROM attendance_event
     WHERE company_id = $1 AND status = 'accepted' AND voided_by_adjustment_id IS NULL
       AND device_time >= $2::date AND device_time < $3::date ${employeeId ? "AND employee_id = $4" : ""}`,
    evParams,
  );
  const byEmp = new Map<string, ShiftEvent[]>();
  for (const e of ev.rows) {
    (byEmp.get(e.employee_id) ?? byEmp.set(e.employee_id, []).get(e.employee_id)!).push({
      id: e.id,
      kind: e.kind,
      at: e.device_time,
      device: e.device,
    });
  }
  const ot = await db.query<{ employee_id: string; business_date: string; m: string }>(
    `SELECT employee_id, business_date, sum(minutes) AS m FROM ot_request
     WHERE company_id = $1 AND status = 'approved' AND business_date BETWEEN $2::date AND $3::date
     ${employeeId ? "AND employee_id = $4" : ""} GROUP BY 1, 2`,
    params,
  );
  // Phút nghỉ phép tính vào ngày (giờ VN) bắt đầu của đơn đã duyệt.
  const lv = await db.query<{ employee_id: string; d: string; m: string }>(
    `SELECT employee_id, (start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS d, sum(minutes) AS m FROM leave_request
     WHERE company_id = $1 AND status = 'approved'
       AND (start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $2::date AND $3::date
     ${employeeId ? "AND employee_id = $4" : ""} GROUP BY 1, 2`,
    params,
  );
  const key = (e: string, d: string) => `${e}|${d}`;
  const otMap = new Map(ot.rows.map((r) => [key(r.employee_id, r.business_date), Number(r.m)]));
  const lvMap = new Map(lv.rows.map((r) => [key(r.employee_id, r.d), Number(r.m)]));
  const lines: Line[] = [];
  const seen = new Set<string>();
  for (const a of asg.rows) {
    const k = key(a.employee_id, a.business_date);
    const first = !seen.has(k);
    seen.add(k);
    const r = computeShift(
      {
        businessDate: a.business_date,
        start: a.start_time,
        end: a.end_time,
        breakMinutes: a.break_minutes,
        tz: a.tz,
        earlyGraceMinutes: a.early_grace_minutes,
        lateGraceMinutes: a.late_grace_minutes,
      },
      byEmp.get(a.employee_id) ?? [],
    );
    lines.push({
      employeeId: a.employee_id,
      businessDate: a.business_date,
      shiftAssignmentId: a.id,
      status: r.status,
      presentMinutes: r.presentMinutes,
      // OT và phép của ngày gán vào ca đầu tiên trong ngày (không cộng trùng khi một ngày có nhiều ca).
      otApprovedMinutes: first ? (otMap.get(k) ?? 0) : 0,
      leaveMinutes: first ? (lvMap.get(k) ?? 0) : 0,
    });
  }
  for (const [k, m] of lvMap) {
    if (seen.has(k)) continue;
    seen.add(k);
    const [employeeId2, d] = k.split("|") as [string, string];
    lines.push({
      employeeId: employeeId2,
      businessDate: d,
      shiftAssignmentId: null,
      status: "leave_only",
      presentMinutes: null,
      otApprovedMinutes: otMap.get(k) ?? 0,
      leaveMinutes: m,
    });
  }
  // OT đã duyệt vào ngày không có ca, không có phép (vd trực CN) — không được mất khỏi bảng công (review PR #8 #1).
  for (const [k, m] of otMap) {
    if (seen.has(k)) continue;
    const [employeeId3, d] = k.split("|") as [string, string];
    lines.push({
      employeeId: employeeId3,
      businessDate: d,
      shiftAssignmentId: null,
      status: "ot_only",
      presentMinutes: null,
      otApprovedMinutes: m,
      leaveMinutes: 0,
    });
  }
  return lines.sort((a, b) =>
    a.employeeId === b.employeeId
      ? a.businessDate < b.businessDate
        ? -1
        : 1
      : a.employeeId < b.employeeId
        ? -1
        : 1,
  );
}

// ---- Ngoại lệ chặn khoá --------------------------------------------------------------------------------------------

export interface PeriodException {
  ref: string;
  kind: "MISSING_CHECKOUT" | "NEEDS_REVIEW" | "PENDING_REQUEST";
  employeeId: string;
  note: string | null;
}

export async function periodExceptions(
  db: Queryable,
  companyId: string,
  p: Period,
): Promise<PeriodException[]> {
  const lines = await computeLines(db, companyId, p.startDate, p.endDate);
  const out: PeriodException[] = [];
  for (const l of lines)
    if (l.status === "incomplete")
      out.push({
        ref: `line:${l.employeeId}:${l.businessDate}`,
        kind: "MISSING_CHECKOUT",
        employeeId: l.employeeId,
        note: null,
      });
  const review = await db.query<{ id: string; employee_id: string }>(
    `SELECT id, employee_id FROM attendance_event WHERE company_id = $1 AND status = 'needs_review'
     AND voided_by_adjustment_id IS NULL
     AND (device_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $2::date AND $3::date`,
    [companyId, p.startDate, p.endDate],
  );
  for (const r of review.rows)
    out.push({ ref: `event:${r.id}`, kind: "NEEDS_REVIEW", employeeId: r.employee_id, note: null });
  const pending = await db.query<{ ref: string; employee_id: string }>(
    `SELECT 'leave:' || id AS ref, employee_id FROM leave_request WHERE company_id = $1 AND status = 'pending'
       AND (start_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date BETWEEN $2::date AND $3::date
     UNION ALL
     SELECT 'ot:' || id, employee_id FROM ot_request WHERE company_id = $1 AND status = 'pending'
       AND business_date BETWEEN $2::date AND $3::date
     UNION ALL
     SELECT 'adjustment:' || id, employee_id FROM attendance_adjustment WHERE company_id = $1 AND status = 'pending'
       AND period_id IS NOT DISTINCT FROM $4`,
    [companyId, p.startDate, p.endDate, p.id],
  );
  for (const r of pending.rows)
    out.push({ ref: r.ref, kind: "PENDING_REQUEST", employeeId: r.employee_id, note: null });
  const notes = await db.query<{ ref: string; note: string }>(
    "SELECT ref, note FROM period_exception_note WHERE period_id = $1",
    [p.id],
  );
  const noteMap = new Map(notes.rows.map((n) => [n.ref, n.note]));
  return out.map((e) => ({ ...e, note: noteMap.get(e.ref) ?? null }));
}

export async function explainException(
  tx: Queryable,
  actor: ActorContext,
  periodId: string,
  ref: string,
  note: string,
) {
  requireHr(actor, periodId);
  await loadPeriod(tx, actor.companyId, periodId);
  if (!note.trim()) throw new AppError("VALIDATION", 422, "Cần nội dung giải trình");
  await tx.query(
    `INSERT INTO period_exception_note (period_id, ref, note, created_by_user_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (period_id, ref) DO UPDATE SET note = EXCLUDED.note, created_by_user_id = EXCLUDED.created_by_user_id`,
    [periodId, ref, note, actor.userId],
  );
  await auditDecision(tx, actor, "period.explain", "attendance_period", periodId, {
    after: { ref },
    reason: note,
  });
}

// ---- Chuyển trạng thái, khoá, xuất -------------------------------------------------------------------------------

/** Chuyển kỳ sang bước KẾ TIẾP (không nhảy, không lùi). Bước cuối (khoá) dùng `lockPeriod`. */
export async function advancePeriod(tx: Queryable, actor: ActorContext, periodId: string, to: PeriodStatus) {
  requireHr(actor, periodId);
  const p = await loadPeriod(tx, actor.companyId, periodId, true);
  const next = PERIOD_FLOW[PERIOD_FLOW.indexOf(p.status) + 1];
  if (to === "locked") throw new AppError("INVALID_STATE", 409, "Khoá kỳ dùng thao tác khoá riêng");
  if (to !== next)
    throw new AppError("INVALID_STATE", 409, `Kỳ đang ở ${p.status}, bước kế tiếp là ${next ?? "không có"}`);
  await tx.query("UPDATE attendance_period SET status = $2 WHERE id = $1", [periodId, to]);
  await auditDecision(tx, actor, "period.advance", "attendance_period", periodId, {
    before: { status: p.status },
    after: { status: to },
  });
}

export async function lockPeriod(
  tx: Queryable,
  actor: ActorContext,
  periodId: string,
): Promise<{ version: number; checksum: string }> {
  requireHr(actor, periodId);
  const p = await loadPeriod(tx, actor.companyId, periodId, true);
  if (p.status !== "hr_closed") throw new AppError("INVALID_STATE", 409, "Chỉ khoá kỳ đã được HR chốt");
  const open = (await periodExceptions(tx, actor.companyId, p)).filter((e) => !e.note);
  if (open.length)
    throw new AppError("PERIOD_HAS_EXCEPTIONS", 409, "Còn ngoại lệ chưa xử lý hoặc chưa giải trình", {
      exceptions: open.map((e) => ({ ref: e.ref, kind: e.kind, employeeId: e.employeeId })),
    });
  const lines = await computeLines(tx, actor.companyId, p.startDate, p.endDate);
  await insertLines(tx, p.id, 1, lines);
  await tx.query(
    "UPDATE attendance_period SET status = 'locked', locked_at = now(), locked_by_user_id = $2, current_version = 1 WHERE id = $1",
    [p.id, actor.userId],
  );
  const exp = await writeExport(tx, actor, p, 1, null);
  await auditDecision(tx, actor, "period.lock", "attendance_period", p.id, {
    after: { version: 1, checksum: exp.checksum },
  });
  return { version: 1, checksum: exp.checksum };
}

async function insertLines(tx: Queryable, periodId: string, version: number, lines: Line[]) {
  for (const l of lines) {
    await tx.query(
      `INSERT INTO period_line (period_id, version, employee_id, business_date, shift_assignment_id, status, present_minutes,
         ot_approved_minutes, leave_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        periodId,
        version,
        l.employeeId,
        l.businessDate,
        l.shiftAssignmentId,
        l.status,
        l.presentMinutes,
        l.otApprovedMinutes,
        l.leaveMinutes,
      ],
    );
  }
}

const CSV_HEADER = [
  "ma_nv",
  "ho_ten",
  "ngay",
  "trang_thai",
  "co_mat_phut",
  "ot_duyet_phut",
  "nghi_phep_phut",
];

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Chống CSV injection khi mở bằng Excel: ô bắt đầu bằng = + - @ được thêm nháy đơn.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

async function writeExport(
  tx: Queryable,
  actor: ActorContext,
  p: Period,
  version: number,
  reason: string | null,
) {
  const { rows } = await tx.query<{
    code: string;
    full_name: string;
    business_date: string;
    status: string;
    present_minutes: number | null;
    ot: string;
    lv: string;
  }>(
    `SELECT e.code, e.full_name, l.business_date, l.status, l.present_minutes,
            l.ot_approved_minutes AS ot, l.leave_minutes AS lv
     FROM period_line l JOIN employee e ON e.id = l.employee_id
     WHERE l.period_id = $1 AND l.version = $2 ORDER BY e.code, l.business_date, l.shift_assignment_id NULLS LAST`,
    [p.id, version],
  );
  const body = [CSV_HEADER.join(",")]
    .concat(
      rows.map((r) =>
        [r.code, r.full_name, r.business_date, r.status, r.present_minutes, r.ot, r.lv]
          .map(csvCell)
          .join(","),
      ),
    )
    .join("\r\n");
  const content = "﻿" + body + "\r\n";
  const checksum = createHash("sha256").update(content, "utf8").digest("hex");
  await tx.query(
    `INSERT INTO period_export (period_id, version, generated_by_user_id, row_count, checksum, content, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [p.id, version, actor.userId, rows.length, checksum, content, reason],
  );
  return { checksum, rowCount: rows.length };
}

export interface ExportFile {
  periodCode: string;
  version: number;
  generatedAt: Date;
  generatedByUserId: string;
  rowCount: number;
  checksum: string;
  content: string;
}

/** Bản xuất (mặc định phiên bản mới nhất) — HR hoặc kế toán đọc bảng công đã khoá. */
export async function getExport(
  db: Queryable,
  actor: ActorContext,
  periodId: string,
  version?: number,
): Promise<ExportFile> {
  const res = { companyId: actor.companyId };
  if (!can(actor, "period.manage", res) && !can(actor, "period.read_locked", res))
    throw new AppError("FORBIDDEN", 403, "Bạn không có quyền xem bảng công", {
      action: "period.read_locked",
      object: { type: "attendance_period", id: periodId },
    });
  const p = await loadPeriod(db, actor.companyId, periodId);
  if (p.status !== "locked") throw new AppError("INVALID_STATE", 409, "Kỳ chưa khoá, chưa có bản xuất");
  const { rows } = await db.query<{
    version: number;
    generated_at: Date;
    generated_by_user_id: string;
    row_count: number;
    checksum: string;
    content: string;
  }>("SELECT * FROM period_export WHERE period_id = $1 AND version = $2", [
    p.id,
    version ?? p.currentVersion,
  ]);
  const r = rows[0];
  if (!r) throw new AppError("NOT_FOUND", 404, "Không có phiên bản xuất này");
  return {
    periodCode: p.code,
    version: r.version,
    generatedAt: r.generated_at,
    generatedByUserId: r.generated_by_user_id,
    rowCount: r.row_count,
    checksum: r.checksum,
    content: r.content,
  };
}

// ---- Sửa công ------------------------------------------------------------------------------------------------------

export interface AdjustmentInput {
  employeeId: string;
  action: "add_event" | "void_event";
  targetEventId?: string;
  newKind?: ShiftEvent["kind"];
  newAt?: Date;
  reason: string;
}

async function periodOfDate(db: Queryable, companyId: string, date: string, lock = false) {
  const { rows } = await db.query<{ id: string; status: PeriodStatus }>(
    `SELECT id, status FROM attendance_period WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date
     ${lock ? "FOR UPDATE" : ""}`,
    [companyId, date],
  );
  return rows[0] ?? null;
}

/** Ngày nghiệp vụ của một thời điểm: ngày của ca được giao chứa nó (ca qua đêm), không thì ngày lịch giờ VN. */
export async function businessDateOf(
  db: Queryable,
  companyId: string,
  employeeId: string,
  t: Date,
): Promise<string> {
  const a = await findAssignment(db, companyId, employeeId, t);
  return a?.business_date ?? localDateOf(t, "Asia/Ho_Chi_Minh");
}

/**
 * Thay đổi số liệu công của `employeeId` ở ngày nghiệp vụ `date` (duyệt điều chỉnh/OT/nghỉ, huỷ nghỉ): xác định kỳ
 * NGAY LÚC DUYỆT dưới khoá kỳ (không dùng cờ lưu lúc đề nghị — review PR #8 #2). Kỳ đã khoá → bắt buộc quyền HR;
 * trả hàm `finish` để gọi SAU khi ghi thay đổi: phát hành phiên bản số liệu + xuất mới.
 */
export async function guardPeriodChange(
  tx: Queryable,
  actor: ActorContext,
  employeeId: string,
  date: string,
  reason: string,
): Promise<{ locked: boolean; finish: () => Promise<number | null> }> {
  const p = await periodOfDate(tx, actor.companyId, date, true);
  if (!p || p.status !== "locked") return { locked: false, finish: async () => null };
  requireHr(actor, p.id);
  return { locked: true, finish: () => reissueAfterAdjustment(tx, actor, p.id, employeeId, reason) };
}

/** Đề nghị sửa công (chính chủ hoặc người quản lý) — có trước/sau, lý do; sau khoá đánh dấu post_lock. */
export async function requestAdjustment(
  tx: Queryable,
  actor: ActorContext,
  a: AdjustmentInput,
): Promise<string> {
  const self = a.employeeId === actor.employeeId;
  const res = await employeeResource(tx, actor.companyId, a.employeeId);
  await requireOn(tx, actor, self ? "leave.request" : "attendance.approve", res, {
    type: "employee",
    id: a.employeeId,
  });
  if (!a.reason.trim()) throw new AppError("VALIDATION", 422, "Sửa công cần lý do");
  let before: unknown = null;
  let after: unknown;
  let at: Date;
  if (a.action === "void_event") {
    const { rows } = await tx.query<{
      kind: string;
      device_time: Date;
      status: string;
      voided_by_adjustment_id: string | null;
    }>(
      "SELECT kind, device_time, status, voided_by_adjustment_id FROM attendance_event WHERE company_id = $1 AND id = $2 AND employee_id = $3",
      [actor.companyId, a.targetEventId, a.employeeId],
    );
    const t = rows[0];
    if (!t) throw new AppError("NOT_FOUND", 404, "Không tìm thấy sự kiện của nhân viên");
    if (t.voided_by_adjustment_id) throw new AppError("INVALID_STATE", 409, "Sự kiện đã bị huỷ");
    before = { kind: t.kind, at: t.device_time.toISOString(), status: t.status };
    after = { voided: true };
    at = t.device_time;
  } else {
    if (!a.newKind || !a.newAt) throw new AppError("VALIDATION", 422, "Thiếu loại và thời điểm sự kiện mới");
    after = { kind: a.newKind, at: a.newAt.toISOString() };
    at = a.newAt;
  }
  const period = await periodOfDate(
    tx,
    actor.companyId,
    await businessDateOf(tx, actor.companyId, a.employeeId, at),
  );
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO attendance_adjustment (company_id, employee_id, action, target_event_id, new_kind, new_at, reason, before, after,
       post_lock, period_id, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [
      actor.companyId,
      a.employeeId,
      a.action,
      a.targetEventId ?? null,
      a.newKind ?? null,
      a.newAt ?? null,
      a.reason,
      JSON.stringify(before),
      JSON.stringify(after),
      period?.status === "locked",
      period?.id ?? null,
      actor.userId,
    ],
  );
  await auditDecision(tx, actor, "adjustment.request", "attendance_adjustment", rows[0]!.id, {
    before,
    after,
    reason: a.reason,
  });
  return rows[0]!.id;
}

export async function decideAdjustment(
  tx: Queryable,
  actor: ActorContext,
  id: string,
  decision: "approve" | "reject",
  note?: string | null,
): Promise<{ newExportVersion: number | null }> {
  const { rows } = await tx.query<{
    employee_id: string;
    action: "add_event" | "void_event";
    target_event_id: string | null;
    new_kind: ShiftEvent["kind"] | null;
    new_at: Date | null;
    status: string;
    post_lock: boolean;
    period_id: string | null;
    created_by_user_id: string;
    reason: string;
  }>("SELECT * FROM attendance_adjustment WHERE company_id = $1 AND id = $2 FOR UPDATE", [
    actor.companyId,
    id,
  ]);
  const adj = rows[0];
  if (!adj) throw new AppError("NOT_FOUND", 404, "Không tìm thấy đề nghị sửa công");
  const res = await employeeResource(tx, actor.companyId, adj.employee_id);
  await requireOn(tx, actor, "attendance.approve", res, { type: "attendance_adjustment", id });
  requireNotSelf(actor, adj.created_by_user_id, adj.employee_id);
  if (adj.status !== "pending") throw new AppError("INVALID_STATE", 409, "Đề nghị đã được xử lý");
  if (decision === "reject" && !note?.trim()) throw new AppError("VALIDATION", 422, "Từ chối cần lý do");
  let newExportVersion: number | null = null;
  if (decision === "approve") {
    let at = adj.new_at;
    if (adj.action === "void_event") {
      const t = await tx.query<{ device_time: Date }>(
        "SELECT device_time FROM attendance_event WHERE id = $1",
        [adj.target_event_id],
      );
      at = t.rows[0]!.device_time;
    }
    // Kỳ xác định lúc DUYỆT theo ngày nghiệp vụ; kỳ đã khoá → chỉ HR, phát hành phiên bản mới.
    const date = await businessDateOf(tx, actor.companyId, adj.employee_id, at!);
    const guard = await guardPeriodChange(
      tx,
      actor,
      adj.employee_id,
      date,
      `điều chỉnh ${id}: ${adj.reason}`,
    );
    if (adj.action === "add_event") {
      const asg = await findAssignment(tx, actor.companyId, adj.employee_id, adj.new_at!);
      await tx.query(
        `INSERT INTO attendance_event (company_id, employee_id, idempotency_key, request_hash, kind, device_time,
           server_received_at, source, shift_assignment_id, status)
         VALUES ($1, $2, $3, 'adjustment', $4, $5, now(), 'manual_request', $6, 'accepted')`,
        [actor.companyId, adj.employee_id, `adj:${id}`, adj.new_kind, adj.new_at, asg?.id ?? null],
      );
    } else {
      const u = await tx.query(
        "UPDATE attendance_event SET voided_by_adjustment_id = $2 WHERE id = $1 AND voided_by_adjustment_id IS NULL",
        [adj.target_event_id, id],
      );
      if (u.rowCount === 0) throw new AppError("INVALID_STATE", 409, "Sự kiện đã bị huỷ bởi điều chỉnh khác");
    }
    if (guard.locked) await tx.query("UPDATE attendance_adjustment SET post_lock = true WHERE id = $1", [id]);
    newExportVersion = await guard.finish();
  }
  await tx.query(
    "UPDATE attendance_adjustment SET status = $2, decided_by_user_id = $3, decided_at = now(), decision_note = $4 WHERE id = $1",
    [id, decision === "approve" ? "approved" : "rejected", actor.userId, note ?? null],
  );
  await auditDecision(tx, actor, `adjustment.${decision}`, "attendance_adjustment", id, {
    reason: note ?? null,
  });
  return { newExportVersion };
}

/** Sau khoá: phiên bản số liệu mới = bản hiện tại, thay dòng của nhân viên bị điều chỉnh; xuất phiên bản mới. */
async function reissueAfterAdjustment(
  tx: Queryable,
  actor: ActorContext,
  periodId: string,
  employeeId: string,
  reason: string,
) {
  const p = await loadPeriod(tx, actor.companyId, periodId, true);
  const next = p.currentVersion + 1;
  await tx.query(
    `INSERT INTO period_line (period_id, version, employee_id, business_date, shift_assignment_id, status, present_minutes,
       ot_approved_minutes, leave_minutes, note)
     SELECT period_id, $2, employee_id, business_date, shift_assignment_id, status, present_minutes, ot_approved_minutes,
       leave_minutes, note FROM period_line WHERE period_id = $1 AND version = $3 AND employee_id <> $4`,
    [p.id, next, p.currentVersion, employeeId],
  );
  await insertLines(
    tx,
    p.id,
    next,
    await computeLines(tx, actor.companyId, p.startDate, p.endDate, employeeId),
  );
  await tx.query("UPDATE attendance_period SET current_version = $2 WHERE id = $1", [p.id, next]);
  await writeExport(tx, actor, p, next, reason);
  return next;
}
