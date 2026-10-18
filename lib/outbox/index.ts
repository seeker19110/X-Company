// Outbox (ARCHITECTURE: tính nhất quán): sự kiện cần xử lý nền ghi trong CÙNG giao dịch nghiệp vụ; worker gửi sau.
import type { Queryable } from "../db/index.ts";

export async function enqueue(
  tx: Queryable,
  companyId: string | null,
  topic: string,
  payload: unknown,
): Promise<void> {
  await tx.query("INSERT INTO outbox_event (company_id, topic, payload) VALUES ($1, $2, $3)", [
    companyId,
    topic,
    JSON.stringify(payload),
  ]);
}
