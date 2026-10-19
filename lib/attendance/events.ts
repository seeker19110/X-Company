// Ghi sự kiện chấm công (SPEC-attendance I1–I4, C6, QR, AT04/AT05). Sự kiện gốc chỉ thêm; mọi nghi vấn lưu
// `needs_review` kèm lý do để điều tra thay vì bỏ — trừ QR sai chữ ký/hết hạn khi trực tuyến (422, không lưu).
import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";
import { appendAudit, canonicalJson } from "../audit/index.ts";
import { sealGeo } from "../crypto/columns.ts";
import { withTx, type Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { env } from "../nen/env.ts";
import { hasActiveConsent, PURPOSE_GEO_ATTENDANCE } from "../privacy/consent.ts";
import { addDays, localDateOf, shiftBounds } from "./compute.ts";
import { policyAt, type AttendancePolicy } from "./policy.ts";
import { qrExpired, verifyQrSignature } from "./qr.ts";
import { minutesToMs, msToSeconds, secondsToMs } from "../nen/units.ts";
import { t as msg } from "../i18n/index.ts";

export type Kind = "in" | "out" | "break_start" | "break_end";
export type Source = "qr" | "gps" | "kiosk" | "manual_request";

export interface EventInput {
  idempotencyKey: string;
  kind: Kind;
  deviceTime: Date;
  source: Source;
  queued?: boolean;
  device?: string | null;
  worksiteId?: string | null;
  qr?: string | null;
  geo?: { lat: number; lng: number; accuracyM: number; capturedAt: Date } | null;
}

export interface EventResult {
  eventId: string;
  status: "accepted" | "needs_review";
  reviewReason: string | null;
  serverReceivedAt: Date;
  shiftAssignmentId: string | null;
  /** Toạ độ GPS đã được lưu (mã hoá) cho sự kiện này; false = client không gửi hoặc cổng GPS ở server đã bỏ toạ độ. */
  geoStored: boolean;
  replayed: boolean;
}

/** Lý do cổng GPS bỏ toạ độ (ghi vào audit, KHÔNG kèm toạ độ). */
export type GeoDropReason = "flag_off" | "no_consent";

/**
 * Cổng GPS ở server (T-051, D-032): chỉ nhận toạ độ khi cờ GEO_CAPTURE_ENABLED BẬT **và** nhân viên có đồng ý riêng
 * `geo_attendance` còn hiệu lực (rút đồng ý/bị hạn chế xử lý → dừng ngay). Ngược lại bỏ toạ độ, không lỗi (client cũ vẫn chấm công được).
 */
export async function geoGate(db: Queryable, employeeId: string): Promise<GeoDropReason | null> {
  if (!env("GEO_CAPTURE_ENABLED")) return "flag_off";
  return (await hasActiveConsent(db, "employee", employeeId, PURPOSE_GEO_ATTENDANCE)) ? null : "no_consent";
}

export interface EventActor {
  userId: string;
  companyId: string;
  employeeId: string;
  requestId?: string | null;
}

export function requestHash(i: EventInput): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        kind: i.kind,
        deviceTime: i.deviceTime.toISOString(),
        source: i.source,
        queued: !!i.queued,
        device: i.device ?? null,
        worksiteId: i.worksiteId ?? null,
        qr: i.qr ?? null,
        geo: i.geo ? { ...i.geo, capturedAt: i.geo.capturedAt.toISOString() } : null,
      }),
    )
    .digest("hex");
}

interface Assignment {
  id: string;
  worksite_id: string | null;
  business_date: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  early_grace_minutes: number;
  late_grace_minutes: number;
  tz: string;
}

/** Ca được giao có cửa sổ [start − early, end + late] chứa thời điểm `t` (xét ngày trước cho ca qua đêm). */
export async function findAssignment(
  db: Queryable,
  companyId: string,
  employeeId: string,
  t: Date,
  tz = "Asia/Ho_Chi_Minh",
): Promise<Assignment | null> {
  const d = localDateOf(t, tz);
  const { rows } = await db.query<Assignment>(
    `SELECT a.id, a.worksite_id, a.business_date, to_char(s.start_time, 'HH24:MI') AS start_time,
            to_char(s.end_time, 'HH24:MI') AS end_time, s.break_minutes, s.early_grace_minutes, s.late_grace_minutes, s.tz
     FROM shift_assignment a JOIN shift_template s ON s.id = a.shift_template_id
     WHERE a.company_id = $1 AND a.employee_id = $2 AND a.business_date BETWEEN $3::date AND $4::date
     ORDER BY a.business_date, s.start_time`,
    [companyId, employeeId, addDays(d, -1), addDays(d, 1)],
  );
  for (const a of rows) {
    const b = shiftBounds({
      businessDate: a.business_date,
      start: a.start_time,
      end: a.end_time,
      breakMinutes: 0,
      tz: a.tz,
    });
    const lo = b.start.getTime() - minutesToMs(a.early_grace_minutes);
    const hi = b.end.getTime() + minutesToMs(a.late_grace_minutes);
    if (t.getTime() >= lo && t.getTime() <= hi) return a;
  }
  return null;
}

/** Lý do cần xác minh theo thời gian thiết bị (C6) — null nếu ổn. */
export function timeReview(i: EventInput, now: Date, p: AttendancePolicy): string | null {
  const diffSec = msToSeconds(i.deviceTime.getTime() - now.getTime());
  if (diffSec > p.futureToleranceSec) return "FUTURE_TIME";
  if (i.queued) return -diffSec > p.offlineMaxAgeSec ? "OFFLINE_TOO_OLD" : null;
  return Math.abs(diffSec) > p.clockSkewMaxSec ? "CLOCK_SKEW" : null;
}

type Outcome = { conflict: string } | { result: EventResult };

/** Sự kiện đã có cùng (employee, idempotencyKey): cùng nội dung → kết quả cũ (replayed); khác nội dung → conflict. */
async function replayOrConflict(
  db: Queryable,
  actor: EventActor,
  idempotencyKey: string,
  hash: string,
): Promise<Outcome | null> {
  const prev = await db.query<{
    id: string;
    request_hash: string;
    status: "accepted" | "needs_review";
    review_reason: string | null;
    server_received_at: Date;
    shift_assignment_id: string | null;
    geo_stored: boolean;
  }>(
    `SELECT id, request_hash, status, review_reason, server_received_at, shift_assignment_id,
            (geo_enc IS NOT NULL OR geo_lat IS NOT NULL) AS geo_stored
     FROM attendance_event WHERE employee_id = $1 AND idempotency_key = $2`,
    [actor.employeeId, idempotencyKey],
  );
  const p0 = prev.rows[0];
  if (!p0) return null;
  if (p0.request_hash !== hash) return { conflict: p0.id };
  return {
    result: {
      eventId: p0.id,
      status: p0.status,
      reviewReason: p0.review_reason,
      serverReceivedAt: p0.server_received_at,
      shiftAssignmentId: p0.shift_assignment_id,
      geoStored: p0.geo_stored,
      replayed: true,
    },
  };
}

/**
 * Ghi một sự kiện của chính nhân viên (kiểm quyền `attendance.write_own` ở route). Idempotent theo
 * (employee, idempotencyKey): cùng nội dung → cùng kết quả; khác nội dung → 409 (có audit).
 */
export async function recordEvent(
  pool: pg.Pool,
  actor: EventActor,
  input: EventInput,
  now: Date = new Date(),
): Promise<EventResult> {
  const hash = requestHash(input);
  const outcome = await withTx(async (tx) => {
    // Tuần tự hoá theo nhân viên: kiểm "ca đang mở" (I3) không bị chen.
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('att:' || $1, 0))", [actor.employeeId]);
    // Đường nhanh cho lần gửi lặp (không tính QR/ca lại); cổng chặn trùng thật sự là UNIQUE ở INSERT bên dưới.
    const dup = await replayOrConflict(tx, actor, input.idempotencyKey, hash);
    if (dup) return dup;

    const policy = await policyAt(tx, actor.companyId, now);
    const reasons: string[] = [];
    let worksiteId = input.worksiteId ?? null;
    let qrNonce: string | null = null;

    if (input.source === "qr") {
      if (!input.qr) throw new AppError("QR_REQUIRED", 422, msg("err.attendance.thieuMaQr"));
      const q = verifyQrSignature(input.qr); // sai chữ ký → 422 bất kể trực tuyến hay hàng chờ
      if (q.cid !== actor.companyId)
        throw new AppError("QR_INVALID", 422, msg("err.attendance.maQrKhongThuocCongTy"));
      const checkAt = input.queued ? input.deviceTime : now;
      if (qrExpired(q, checkAt, policy.qrClockLeewaySec)) {
        if (!input.queued) throw new AppError("QR_EXPIRED", 422, msg("err.attendance.maQrDaHetHanVui"));
        reasons.push("QR_EXPIRED");
      }
      if (worksiteId && worksiteId !== q.ws) reasons.push("QR_WORKSITE_MISMATCH");
      // Cờ `queued` do client tự khai: QR quét "ngoại tuyến" lệch giờ lớn có thể là ảnh chụp QR → cần xác minh.
      if (input.queued && msToSeconds(now.getTime() - input.deviceTime.getTime()) > policy.qrOfflineReviewSec)
        reasons.push("QR_OFFLINE");
      worksiteId = q.ws;
      qrNonce = q.n;
    }

    const tr = timeReview(input, now, policy);
    if (tr) reasons.push(tr);

    const assignment = await findAssignment(tx, actor.companyId, actor.employeeId, input.deviceTime);

    // Log đến muộn thuộc kỳ đã khoá — theo NGÀY NGHIỆP VỤ của ca (ca qua đêm), không theo ngày lịch (review PR #8 #4).
    const businessDate = assignment?.business_date ?? localDateOf(input.deviceTime, "Asia/Ho_Chi_Minh");
    const locked = await tx.query(
      `SELECT 1 FROM attendance_period WHERE company_id = $1 AND status = 'locked' AND $2::date BETWEEN start_date AND end_date`,
      [actor.companyId, businessDate],
    );
    if ((locked.rowCount ?? 0) > 0) reasons.push("LATE_FOR_LOCKED_PERIOD");
    if (assignment?.worksite_id && worksiteId && assignment.worksite_id !== worksiteId)
      reasons.push("WORKSITE_MISMATCH");

    if (input.kind === "in") {
      // I3 (D-011): vào từ thiết bị KHÁC trong cửa sổ trùng sau một lần vào còn mở → nghi trùng.
      const open = await tx.query<{ device: string | null; device_time: Date }>(
        `SELECT e.device, e.device_time FROM attendance_event e
         WHERE e.employee_id = $1 AND e.kind = 'in' AND e.status = 'accepted' AND e.voided_by_adjustment_id IS NULL
           AND e.device_time BETWEEN $2 AND $3
           AND NOT EXISTS (SELECT 1 FROM attendance_event o WHERE o.employee_id = e.employee_id AND o.kind = 'out'
             AND o.status = 'accepted' AND o.device IS NOT DISTINCT FROM e.device AND o.device_time > e.device_time
             AND o.device_time <= $4)`,
        [
          actor.employeeId,
          new Date(input.deviceTime.getTime() - secondsToMs(policy.duplicateWindowSec)),
          new Date(input.deviceTime.getTime() + secondsToMs(policy.duplicateWindowSec)),
          input.deviceTime,
        ],
      );
      if (open.rows.some((r) => (r.device ?? "") !== (input.device ?? ""))) reasons.push("DUPLICATE_OPEN");
    }

    const status = reasons.length > 0 ? "needs_review" : "accepted";
    const reviewReason = reasons.length > 0 ? reasons.join(",") : null;
    // Cổng GPS: toạ độ chỉ được lưu khi cờ bật + có đồng ý riêng còn hiệu lực; lưu thì MÃ HOÁ (id dòng sinh trước vì AAD gắn id).
    const eventId = randomUUID();
    const geoDrop = input.geo ? await geoGate(tx, actor.employeeId) : null;
    const geoEnc =
      input.geo && geoDrop === null
        ? sealGeo(eventId, {
            lat: input.geo.lat,
            lng: input.geo.lng,
            accuracy_m: input.geo.accuracyM,
            captured_at: input.geo.capturedAt.toISOString(),
          })
        : null;
    const { rows } = await tx.query<{ id: string; server_received_at: Date }>(
      `INSERT INTO attendance_event (id, company_id, employee_id, idempotency_key, request_hash, kind, device_time,
         server_received_at, source, queued, device, worksite_id, shift_assignment_id, policy_id, geo_enc, qr_nonce,
         status, review_reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (employee_id, idempotency_key) DO NOTHING
       RETURNING id, server_received_at`,
      [
        eventId,
        actor.companyId,
        actor.employeeId,
        input.idempotencyKey,
        hash,
        input.kind,
        input.deviceTime,
        now,
        input.source,
        !!input.queued,
        input.device ?? null,
        worksiteId,
        assignment?.id ?? null,
        policy.id,
        geoEnc,
        qrNonce,
        status,
        reviewReason,
      ],
    );
    const ev = rows[0];
    if (!ev) {
      // Thua cuộc đua cùng khoá (DB-TX-004): bản ghi của bên thắng đã commit → trả như lần gửi lặp.
      const raced = await replayOrConflict(tx, actor, input.idempotencyKey, hash);
      if (raced) return raced;
      throw new Error("INSERT ON CONFLICT không chèn mà cũng không thấy bản ghi trùng khoá");
    }
    await appendAudit(tx, {
      actorUserId: actor.userId,
      companyId: actor.companyId,
      action: "attendance.event",
      objectType: "attendance_event",
      objectId: ev.id,
      // Không bao giờ ghi toạ độ vào audit; chỉ ghi việc cổng GPS đã bỏ toạ độ và vì sao.
      after: {
        kind: input.kind,
        status,
        reviewReason,
        queued: !!input.queued,
        ...(input.geo ? { geoStored: geoEnc !== null, geoDropped: geoDrop } : {}),
      },
      requestId: actor.requestId ?? null,
    });
    return {
      result: {
        eventId: ev.id,
        status,
        reviewReason,
        serverReceivedAt: ev.server_received_at,
        shiftAssignmentId: assignment?.id ?? null,
        geoStored: geoEnc !== null,
        replayed: false,
      },
    } as const;
  }, pool);

  if ("conflict" in outcome) {
    // I2: ghi audit ở giao dịch riêng rồi mới báo lỗi.
    await withTx(
      (tx) =>
        appendAudit(tx, {
          actorUserId: actor.userId,
          companyId: actor.companyId,
          action: "attendance.event",
          objectType: "attendance_event",
          objectId: outcome.conflict,
          result: "denied",
          reason: "IDEMPOTENCY_CONFLICT",
          requestId: actor.requestId ?? null,
        }),
      pool,
    );
    throw new AppError("IDEMPOTENCY_CONFLICT", 409, msg("err.attendance.khoaGuiDaDungChoNoi"));
  }
  return outcome.result;
}
