// Danh mục dữ liệu PHẢI GIỮ theo luật khi chủ thể yêu cầu xoá (CMP-RIGHTS-007): chỉ giữ phần bắt buộc, ghi căn cứ.
// Đây là CẤU HÌNH để pháp chế/HR chỉnh — số năm giữ và điều luật cụ thể chưa được xác minh (đề xuất, chờ pháp chế).
import type { SubjectType } from "./consent.ts";
import { t } from "../i18n/index.ts";

export interface RetainedCategory {
  /** Tên nhóm dữ liệu giữ lại. */
  category: string;
  /** Bảng liên quan (để audit/giải thích; không dùng để xoá). */
  tables: readonly string[];
  /** Căn cứ giữ — hiển thị cho chủ thể khi từ chối một phần. */
  reason: string;
}

/** Tên hai danh mục không-PII luôn được giữ (xoá theo yêu cầu không chạm tới); dùng chung để so khớp. */
export const CATEGORY_CONSENT_EVIDENCE = t("msg.privacy.retained.consentEvidence.category");
export const CATEGORY_AUDIT_LOG = t("msg.privacy.retained.auditLog.category");

/** Nhân viên: hồ sơ lao động và bảng công là chứng từ phải lưu (điều luật/số năm: pháp chế xác minh). */
const EMPLOYEE_RETAINED: readonly RetainedCategory[] = [
  {
    category: t("msg.privacy.retained.laborRecords.category"),
    tables: ["employee", "employment_history"],
    reason: t("msg.privacy.retained.laborRecords.reason"),
  },
  {
    category: t("msg.privacy.retained.timesheet.category"),
    tables: ["attendance_event", "period_line", "period_export", "leave_request", "leave_ledger"],
    reason: t("msg.privacy.retained.timesheet.reason"),
  },
];

/** Liên hệ/ứng viên công khai: không có nghĩa vụ giữ ngoài bằng chứng đồng ý và nhật ký kiểm toán (không PII). */
const NON_PERSONAL_EVIDENCE: readonly RetainedCategory[] = [
  {
    category: CATEGORY_CONSENT_EVIDENCE,
    tables: ["consent_record"],
    reason: t("msg.privacy.retained.consentEvidence.reason"),
  },
  {
    category: CATEGORY_AUDIT_LOG,
    tables: ["audit_event"],
    reason: t("msg.privacy.retained.auditLog.reason"),
  },
];

/** Dữ liệu giữ lại theo loại chủ thể khi thực hiện "xoá". */
export const RETAINED_BY_SUBJECT: Record<SubjectType, readonly RetainedCategory[]> = {
  inquiry: NON_PERSONAL_EVIDENCE,
  job_application: NON_PERSONAL_EVIDENCE,
  employee: [...EMPLOYEE_RETAINED, ...NON_PERSONAL_EVIDENCE],
};
