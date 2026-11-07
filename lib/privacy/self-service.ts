// Quyền chủ thể TỰ PHỤC VỤ của nhân viên (T-121, CMP-RIGHTS-007, D-075): yêu cầu xoá cho CHÍNH MÌNH, thực thi ngay trong
// giao dịch của người gọi (route chạy nó sau bước xác thực lại — lib/identity/account.ts withReauth). Chủ thể luôn lấy từ
// phiên (actor.employeeId) — không có tham số chủ thể nên không thể nhắm tài khoản người khác.
import type { Queryable } from "../db/index.ts";
import { t } from "../i18n/index.ts";
import { completeRequest, createRequest, type PrivacyActor, type RequestRow } from "./index.ts";

export async function deleteOwnAccount(
  tx: Queryable,
  actor: PrivacyActor,
  employeeId: string,
  now: Date = new Date(),
): Promise<RequestRow> {
  // Đã có yêu cầu xoá đang mở cho chính mình (vd HR tiếp nhận qua kênh khác) → hoàn tất yêu cầu đó, không tạo trùng.
  const open = await tx.query<{ id: string }>(
    `SELECT id FROM data_subject_request
      WHERE company_id = $1 AND subject_type = 'employee' AND subject_id = $2 AND kind = 'delete'
        AND status IN ('received', 'in_progress') FOR UPDATE`,
    [actor.companyId, employeeId],
  );
  const id =
    open.rows[0]?.id ??
    (
      await createRequest(
        tx,
        actor,
        // subject_ref = uuid nhân viên (không PII); ghi chú nêu kênh tiếp nhận.
        {
          subject_type: "employee",
          subject_ref: employeeId,
          kind: "delete",
          note: t("msg.privacy.selfServiceNote"),
        },
        now,
      )
    ).id;
  return completeRequest(tx, actor, id, now);
}
