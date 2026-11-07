// Xoá dữ liệu của chủ thể NHÂN VIÊN theo yêu cầu xoá (T-121, CMP-RIGHTS-007, D-075): chỉ giữ phần bắt buộc, kèm căn cứ.
// Theo docs/privacy/data-map.yaml + DPIA §4 (D-030): liên hệ (email công việc, SĐT) xoá; họ tên + mã + ngày vào/nghỉ (hồ sơ
// lao động) và công/phép/bảng công giữ; toạ độ GPS (đồng ý riêng, không thuộc bảng công) xoá; tài khoản đăng nhập bị vô hiệu
// vĩnh viễn + bỏ định danh (lib/identity/account.ts). Mọi ghi trong giao dịch của người gọi; KHÔNG gọi kho tệp (nhân viên
// không có subject_file — tệp đính kèm công việc là tài liệu nghiệp vụ, không xoá ở đây). Người gọi ghi audit số đếm.
import { eraseAccount, type AccountErased } from "../identity/account.ts";
import type { Queryable } from "../db/index.ts";
import { t } from "../i18n/index.ts";
import { withdrawConsent } from "./consent.ts";
import { CATEGORY_AUDIT_LOG, CATEGORY_CONSENT_EVIDENCE, type RetainedCategory } from "./retained.ts";

export interface EmployeeErased {
  erased: true;
  outcome: "erased_except_retained";
  /** Phần đã xoá theo loại (chỉ số đếm, không PII). `account` null = nhân viên không có tài khoản đăng nhập. */
  deleted: {
    account: AccountErased | null;
    employee_contact: number;
    geo_points: number;
    consent_withdrawn: string[];
  };
  /** Phần giữ theo luật, kèm căn cứ. */
  retained: { category: string; reason: string }[];
  restriction: "retained_by_law";
}

export async function eraseEmployee(
  tx: Queryable,
  actor: { userId: string; companyId: string; requestId?: string | null },
  r: { id: string; subject_id: string },
  now: Date,
  retained: readonly Pick<RetainedCategory, "category" | "reason">[],
): Promise<EmployeeErased> {
  const c = actor.companyId;
  const e = r.subject_id;
  // 1) Tài khoản đăng nhập gắn nhân viên (nếu có): thu hồi phiên/quyền, xoá thông tin xác thực và định danh.
  const u = await tx.query<{ id: string }>(
    "SELECT id FROM app_user WHERE company_id = $1 AND employee_id = $2",
    [c, e],
  );
  const account = u.rows[0] ? await eraseAccount(tx, actor, c, u.rows[0].id) : null;
  // 2) Liên hệ của nhân viên (không thuộc hồ sơ phải giữ — DPIA §4: xoá SĐT/email ngay sau chấm dứt). SĐT xoá cả bản mã + chỉ mục.
  const contact = await tx.query(
    `UPDATE employee SET work_email = NULL, phone = NULL, phone_enc = NULL, phone_bidx = NULL
      WHERE company_id = $1 AND id = $2 AND num_nonnulls(work_email, phone, phone_enc, phone_bidx) > 0`,
    [c, e],
  );
  // 3) Toạ độ GPS chấm công (đồng ý riêng; sự kiện chấm công giữ) — chỉ qua hàm hẹp của migration 0034.
  const geo = await tx.query<{ n: number }>("SELECT attendance_event_erase_geo_subject($1, $2) AS n", [c, e]);
  // 4) Rút mọi đồng ý còn hiệu lực (bằng chứng đồng ý chỉ thêm, giữ).
  const withdrawn = await withdrawConsent(tx, c, "employee", e, now);
  // 5) Phần phải giữ: đánh dấu hạn chế xử lý kèm căn cứ từng danh mục.
  const kept = retained.filter(
    (x) => x.category !== CATEGORY_CONSENT_EVIDENCE && x.category !== CATEGORY_AUDIT_LOG,
  );
  await tx.query(
    `INSERT INTO processing_restriction (company_id, subject_type, subject_id, kind, reason, request_id)
     VALUES ($1, 'employee', $2, 'retained_by_law', $3, $4)
     ON CONFLICT (subject_type, subject_id, kind) WHERE released_at IS NULL DO NOTHING`,
    [
      c,
      e,
      t("msg.privacy.retainedByLaw", {
        categories: kept.map((x) => `${x.category} (${x.reason})`).join("; "),
      }),
      r.id,
    ],
  );
  return {
    erased: true,
    outcome: "erased_except_retained",
    deleted: {
      account,
      employee_contact: contact.rowCount ?? 0,
      geo_points: geo.rows[0]?.n ?? 0,
      consent_withdrawn: withdrawn,
    },
    retained: retained.map((x) => ({ category: x.category, reason: x.reason })),
    restriction: "retained_by_law",
  };
}
