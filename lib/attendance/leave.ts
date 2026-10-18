// Nghỉ phép (F-005, AT07): sổ biến động (số dư = tổng), đơn nghỉ trùng đơn đã duyệt bị chặn trước duyệt,
// duyệt ghi `taken` trong cùng giao dịch; người tạo không tự duyệt.
import type { ActorContext } from "../authz/index.ts";
import type { Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { localDate } from "../nen/time.ts";
import { guardPeriodChange } from "./period.ts";
import { auditDecision, employeeResource, requireNotSelf, requireOn } from "./scope.ts";
import { t } from "../i18n/index.ts";

/** Số dư phép = tổng sổ — xuất ra để test EXPLAIN (DB-PERF-001). */
export const LEAVE_BALANCE_SQL =
  "SELECT sum(minutes) AS total FROM leave_ledger WHERE employee_id = $1 AND leave_type_id = $2";

export async function leaveBalance(db: Queryable, employeeId: string, leaveTypeId: string): Promise<number> {
  const { rows } = await db.query<{ total: string | null }>(LEAVE_BALANCE_SQL, [employeeId, leaveTypeId]);
  return Number(rows[0]?.total ?? 0);
}

/** Bút toán sổ phép (cộng dồn kỳ, điều chỉnh có lý do) — quyền leave.adjust. */
export async function postLedger(
  tx: Queryable,
  actor: ActorContext,
  e: {
    employeeId: string;
    leaveTypeId: string;
    entryType: "accrual" | "adjustment";
    minutes: number;
    reason: string;
  },
): Promise<void> {
  const res = await employeeResource(tx, actor.companyId, e.employeeId);
  await requireOn(tx, actor, "leave.adjust", res, { type: "leave_ledger", id: e.employeeId });
  if (e.entryType === "adjustment" && e.reason.trim() === "")
    throw new AppError("VALIDATION", 422, t("err.attendance.dieuChinhCanLyDo"));
  try {
    await tx.query(
      `INSERT INTO leave_ledger (company_id, employee_id, leave_type_id, entry_type, minutes, reason, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [actor.companyId, e.employeeId, e.leaveTypeId, e.entryType, e.minutes, e.reason, actor.userId],
    );
  } catch (err) {
    if ((err as { code?: string }).code === "23514")
      throw new AppError("VALIDATION", 422, t("err.attendance.butToanKhongHopLe"));
    throw err;
  }
  await auditDecision(tx, actor, "leave.ledger", "employee", e.employeeId, { after: e, reason: e.reason });
}

export async function requestLeave(
  tx: Queryable,
  actor: ActorContext,
  r: {
    employeeId?: string;
    leaveTypeId: string;
    startAt: Date;
    endAt: Date;
    minutes: number;
    reason?: string | null;
  },
): Promise<string> {
  const employeeId = r.employeeId ?? actor.employeeId;
  if (!employeeId) throw new AppError("NO_EMPLOYEE", 403, t("err.shared.taiKhoanKhongGanHoSo"));
  const res = await employeeResource(tx, actor.companyId, employeeId);
  // Tự xin nghỉ (self) hoặc người có quyền duyệt tạo hộ.
  if (employeeId !== actor.employeeId)
    await requireOn(tx, actor, "attendance.approve", res, { type: "employee", id: employeeId });
  else await requireOn(tx, actor, "leave.request", res, { type: "employee", id: employeeId });
  if (r.endAt <= r.startAt) throw new AppError("VALIDATION", 422, t("err.attendance.thoiGianKetThucPhaiSau"));
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO leave_request (company_id, employee_id, leave_type_id, start_at, end_at, minutes, reason, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      actor.companyId,
      employeeId,
      r.leaveTypeId,
      r.startAt,
      r.endAt,
      r.minutes,
      r.reason ?? null,
      actor.userId,
    ],
  );
  const id = rows[0]!.id;
  await auditDecision(tx, actor, "leave.request", "leave_request", id, { after: { ...r, employeeId } });
  return id;
}

interface LeaveRow {
  id: string;
  employee_id: string;
  leave_type_id: string;
  start_at: Date;
  end_at: Date;
  minutes: number;
  status: string;
  created_by_user_id: string;
  requires_balance: boolean;
}

export async function decideLeave(
  tx: Queryable,
  actor: ActorContext,
  requestId: string,
  decision: "approve" | "reject",
  note?: string | null,
): Promise<void> {
  const { rows } = await tx.query<LeaveRow>(
    `SELECT r.*, t.requires_balance FROM leave_request r JOIN leave_type t ON t.id = r.leave_type_id
     WHERE r.company_id = $1 AND r.id = $2 FOR UPDATE OF r`,
    [actor.companyId, requestId],
  );
  const req = rows[0];
  if (!req) throw new AppError("NOT_FOUND", 404, t("err.attendance.khongTimThayDon"));
  const res = await employeeResource(tx, actor.companyId, req.employee_id);
  await requireOn(tx, actor, "attendance.approve", res, { type: "leave_request", id: requestId });
  requireNotSelf(actor, req.created_by_user_id, req.employee_id);
  if (req.status !== "pending") throw new AppError("INVALID_STATE", 409, t("err.attendance.donDaDuocXuLy"));
  let afterWrite: (() => Promise<number | null>) | null = null;
  if (decision === "reject") {
    if (!note?.trim()) throw new AppError("VALIDATION", 422, t("err.shared.tuChoiCanLyDo"));
  } else {
    // Khoá theo nhân viên rồi kiểm trùng: hai người duyệt đồng thời hai đơn chồng nhau không lọt.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('leave:' || $1, 0))", [req.employee_id]);
    const overlap = await tx.query(
      `SELECT 1 FROM leave_request WHERE employee_id = $1 AND status = 'approved' AND id <> $2
       AND tstzrange(start_at, end_at, '[)') && tstzrange($3, $4, '[)')`,
      [req.employee_id, req.id, req.start_at, req.end_at],
    );
    if ((overlap.rowCount ?? 0) > 0)
      throw new AppError("LEAVE_OVERLAP", 409, t("err.attendance.trungThoiGianVoiDonNghi"));
    // Phút phép tính vào ngày (giờ VN) bắt đầu đơn (D-012) — kỳ chứa ngày đó; đã khoá → chỉ HR, phiên bản mới.
    const guard = await guardPeriodChange(
      tx,
      actor,
      req.employee_id,
      localDate(req.start_at),
      t("msg.attendance.leavePeriodRef", { id: requestId }),
    );
    afterWrite = guard.finish;
    if (req.requires_balance) {
      const bal = await leaveBalance(tx, req.employee_id, req.leave_type_id);
      if (bal < req.minutes)
        throw new AppError("INSUFFICIENT_BALANCE", 422, t("err.attendance.soDuPhepKhongDu"), {
          balance: bal,
          requested: req.minutes,
        });
    }
    await tx.query(
      `INSERT INTO leave_ledger (company_id, employee_id, leave_type_id, entry_type, minutes, reason, leave_request_id, created_by_user_id)
       VALUES ($1, $2, $3, 'taken', $4, $7, $5, $6)`,
      [
        actor.companyId,
        req.employee_id,
        req.leave_type_id,
        -req.minutes,
        req.id,
        actor.userId,
        t("msg.attendance.leaveTakenLedger"),
      ],
    );
  }
  await tx.query(
    "UPDATE leave_request SET status = $2, decided_by_user_id = $3, decided_at = now(), decision_note = $4 WHERE id = $1",
    [requestId, decision === "approve" ? "approved" : "rejected", actor.userId, note ?? null],
  );
  await afterWrite?.();
  await auditDecision(tx, actor, `leave.${decision}`, "leave_request", requestId, { reason: note ?? null });
}

/** Huỷ đơn đã duyệt: bút toán `reversal` trả lại phép (không sửa dòng `taken`). */
export async function cancelApprovedLeave(
  tx: Queryable,
  actor: ActorContext,
  requestId: string,
  reason: string,
) {
  const { rows } = await tx.query<LeaveRow>(
    `SELECT r.*, true AS requires_balance FROM leave_request r WHERE r.company_id = $1 AND r.id = $2 FOR UPDATE`,
    [actor.companyId, requestId],
  );
  const req = rows[0];
  if (!req) throw new AppError("NOT_FOUND", 404, t("err.attendance.khongTimThayDon"));
  const res = await employeeResource(tx, actor.companyId, req.employee_id);
  await requireOn(tx, actor, "attendance.approve", res, { type: "leave_request", id: requestId });
  // Không tự huỷ đơn của mình để hoàn phép (review PR #8, nghi vấn) — người duyệt khác làm.
  requireNotSelf(actor, req.created_by_user_id, req.employee_id);
  if (req.status !== "approved")
    throw new AppError("INVALID_STATE", 409, t("err.attendance.chiHuyDonDaDuyet"));
  if (reason.trim() === "") throw new AppError("VALIDATION", 422, t("err.attendance.huyCanLyDo"));
  const guard = await guardPeriodChange(
    tx,
    actor,
    req.employee_id,
    localDate(req.start_at),
    t("msg.attendance.leaveCancelPeriodRef", { id: requestId }),
  );
  const taken = await tx.query<{ minutes: number }>(
    "SELECT minutes FROM leave_ledger WHERE leave_request_id = $1 AND entry_type = 'taken'",
    [requestId],
  );
  if (taken.rows[0]) {
    await tx.query(
      `INSERT INTO leave_ledger (company_id, employee_id, leave_type_id, entry_type, minutes, reason, leave_request_id, created_by_user_id)
       VALUES ($1, $2, $3, 'reversal', $4, $5, $6, $7)`,
      [
        actor.companyId,
        req.employee_id,
        req.leave_type_id,
        -taken.rows[0].minutes,
        reason,
        requestId,
        actor.userId,
      ],
    );
  }
  await tx.query("UPDATE leave_request SET status = 'cancelled', decision_note = $2 WHERE id = $1", [
    requestId,
    reason,
  ]);
  await guard.finish();
  await auditDecision(tx, actor, "leave.cancel", "leave_request", requestId, { reason });
}
