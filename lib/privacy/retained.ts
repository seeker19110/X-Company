// Danh mục dữ liệu PHẢI GIỮ theo luật khi chủ thể yêu cầu xoá (CMP-RIGHTS-007): chỉ giữ phần bắt buộc, ghi căn cứ.
// Đây là CẤU HÌNH để pháp chế/HR chỉnh — số năm giữ và điều luật cụ thể chưa được xác minh (đề xuất, chờ pháp chế).
import type { SubjectType } from "./consent.ts";

export interface RetainedCategory {
  /** Tên nhóm dữ liệu giữ lại. */
  category: string;
  /** Bảng liên quan (để audit/giải thích; không dùng để xoá). */
  tables: readonly string[];
  /** Căn cứ giữ — hiển thị cho chủ thể khi từ chối một phần. */
  reason: string;
}

/** Nhân viên: hồ sơ lao động và bảng công là chứng từ phải lưu (điều luật/số năm: pháp chế xác minh). */
const EMPLOYEE_RETAINED: readonly RetainedCategory[] = [
  {
    category: "hồ sơ lao động",
    tables: ["employee", "employment_history"],
    reason:
      "Nghĩa vụ lưu hồ sơ lao động theo pháp luật lao động; giữ tối thiểu tới hết thời hạn luật định (pháp chế xác minh số năm)",
  },
  {
    category: "bảng công và nghỉ phép",
    tables: ["attendance_event", "period_line", "period_export", "leave_request", "leave_ledger"],
    reason:
      "Chứng từ chấm công/tiền lương phải lưu theo pháp luật lao động và kế toán (pháp chế xác minh số năm)",
  },
];

/** Liên hệ/ứng viên công khai: không có nghĩa vụ giữ ngoài bằng chứng đồng ý và nhật ký kiểm toán (không PII). */
const NON_PERSONAL_EVIDENCE: readonly RetainedCategory[] = [
  {
    category: "bằng chứng đồng ý và rút đồng ý",
    tables: ["consent_record"],
    reason: "Chứng minh việc đã/ngừng được đồng ý (không chứa thông tin định danh); không thể sửa/xoá",
  },
  {
    category: "nhật ký kiểm toán",
    tables: ["audit_event"],
    reason: "Nhật ký chỉ thêm, đã che theo tên khoá; không chứa nội dung liên hệ",
  },
];

/** Dữ liệu giữ lại theo loại chủ thể khi thực hiện "xoá". */
export const RETAINED_BY_SUBJECT: Record<SubjectType, readonly RetainedCategory[]> = {
  inquiry: NON_PERSONAL_EVIDENCE,
  job_application: NON_PERSONAL_EVIDENCE,
  employee: [...EMPLOYEE_RETAINED, ...NON_PERSONAL_EVIDENCE],
};
