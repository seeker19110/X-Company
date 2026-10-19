// Hạn xử lý yêu cầu chủ thể dữ liệu THEO LOẠI (D-029, CMP-INTL-007, CMP-RIGHTS-007) — mô-đun thuần (không DB).
// Nguồn: NĐ 356/2025/NĐ-CP Điều 5 (mức B: bản sao thương mại, chưa đối chiếu Công báo — luật sư xác minh khi chạy thật).
// Mọi số ngày là cấu hình ở lib/nen/env.ts (DSAR_*); ở đây chỉ gom thành bảng và tính ngày.
import { env } from "../nen/env.ts";
import { addBusinessDays } from "../nen/time.ts";
import { daysToMs } from "../nen/units.ts";

export const KINDS = [
  "access",
  "rectify",
  "export",
  "delete",
  "withdraw_consent",
  "restrict",
  "object",
] as const;
export type RequestKind = (typeof KINDS)[number];

export interface DsarConfig {
  /** Hạn phản hồi "đã nhận", tính bằng NGÀY LÀM VIỆC (bỏ T7, CN; ngày lễ chưa loại). */
  respondWorkdays: number;
  /** Hạn thực hiện theo loại, ngày LỊCH kể từ lúc nhận. */
  days: Record<RequestKind, number>;
  /** Số ngày cộng thêm khi gia hạn (một lần duy nhất; GIẢ ĐỊNH — số của khoản 2-4 chưa xác minh). */
  extendDays: number;
}

export function dsarConfig(source?: Record<string, string | undefined>): DsarConfig {
  const access = env("DSAR_DAYS_ACCESS", source);
  const restrict = env("DSAR_DAYS_RESTRICT", source);
  return {
    respondWorkdays: env("DSAR_RESPOND_WORKDAYS", source),
    days: {
      access,
      rectify: access,
      export: access,
      withdraw_consent: restrict,
      restrict,
      object: restrict,
      delete: env("DSAR_DAYS_DELETE", source),
    },
    extendDays: env("DSAR_EXTEND_DAYS", source),
  };
}

export interface Deadlines {
  respondDueAt: Date;
  dueAt: Date;
}

/** Hạn phản hồi (ngày làm việc, giữ giờ trong ngày) và hạn thực hiện (ngày lịch) của yêu cầu nhận lúc `receivedAt`. */
export function computeDeadlines(kind: RequestKind, receivedAt: Date, cfg: DsarConfig): Deadlines {
  return {
    respondDueAt: addBusinessDays(receivedAt, cfg.respondWorkdays),
    dueAt: new Date(receivedAt.getTime() + daysToMs(cfg.days[kind])),
  };
}

/** Hạn sau gia hạn: cộng `extendDays` vào hạn hiện tại (không tính từ lúc bấm gia hạn). */
export const extendedDueAt = (dueAt: Date, cfg: DsarConfig): Date =>
  new Date(dueAt.getTime() + daysToMs(cfg.extendDays));

/** Quá hạn khi đã SAU hạn (đúng lúc hạn chưa quá). */
export const isPastDue = (due: Date, now: Date): boolean => now.getTime() > due.getTime();

// Điều kiện SQL "quá hạn thực hiện (chưa đóng)" / "quá hạn phản hồi (chưa phản hồi)". Hằng nội bộ; `$NOW` thay bằng tên tham số
// của lời gọi ($n) — không nhận giá trị từ ngoài, nên không nội suy vào chuỗi SQL.
const EXEC_OVERDUE = "(status IN ('received', 'in_progress') AND due_at < $NOW)";
const RESPOND_OVERDUE = "(responded_at IS NULL AND respond_due_at IS NOT NULL AND respond_due_at < $NOW)";
const bind = (sql: string, now: string): string => sql.replaceAll("$NOW", now);

export const dsarExecOverdueSql = (now: string): string => bind(EXEC_OVERDUE, now);
export const dsarRespondOverdueSql = (now: string): string => bind(RESPOND_OVERDUE, now);
export const dsarAnyOverdueSql = (now: string): string =>
  bind(`(${EXEC_OVERDUE} OR ${RESPOND_OVERDUE})`, now);
