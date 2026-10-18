// Outbox (ARCHITECTURE: tính nhất quán): sự kiện cần xử lý nền ghi trong CÙNG giao dịch nghiệp vụ; worker (lib/worker) gửi sau.
import type { Queryable } from "../db/index.ts";

/**
 * Ghi một sự kiện. `jobKey` (tuỳ chọn, duy nhất theo nghiệp vụ, vd `task-assigned:{taskId}:{version}`) khử trùng khi
 * enqueue: cùng khoá lần hai → không tạo hàng mới (BE-JOB-001). Trả true nếu đã tạo hàng mới.
 */
export async function enqueue(
  tx: Queryable,
  companyId: string | null,
  topic: string,
  payload: unknown,
  jobKey?: string,
): Promise<boolean> {
  const r = await tx.query(
    "INSERT INTO outbox_event (company_id, topic, payload, job_key) VALUES ($1, $2, $3, $4) ON CONFLICT (job_key) DO NOTHING",
    [companyId, topic, JSON.stringify(payload), jobKey ?? null],
  );
  return (r.rowCount ?? 0) > 0;
}
