// Kênh gửi (email/push…) sau handler. Kênh thật (SMTP, Web Push) chưa có: mặc định là kênh ghi log "đã giao".
// Adapter giả dùng chung một hợp đồng: `deliver` phải lũy đẳng theo `eventId`; kênh tắt (`enabled() === false`) thì
// worker KHÔNG thử và KHÔNG tính lần lỗi — sự kiện giữ `pending`, gửi sau khi kênh bật (ARC-INT-003).
import { log } from "../nen/log.ts";

export interface DeliveryMessage {
  eventId: number;
  topic: string;
  companyId: string | null;
  payload: unknown;
}

export interface Channel {
  readonly name: string;
  enabled(): boolean;
  deliver(msg: DeliveryMessage): Promise<void>;
}

/** Kênh tắt tạm thời: không phải lỗi của sự kiện. */
export class ChannelDisabledError extends Error {
  constructor(readonly channel: string) {
    super(`kênh ${channel} đang tắt`);
    this.name = "ChannelDisabledError";
  }
}

/** Lỗi vĩnh viễn (validate/4xx nghiệp vụ): vào DLQ ngay, không retry (BE-JOB-003). */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentJobError";
  }
}

/** Kênh mặc định: chỉ ghi log (payload đã được logger che PII/bí mật). */
export const logChannel: Channel = {
  name: "log",
  enabled: () => true,
  deliver: (msg) => {
    log.info("đã giao", { topic: msg.topic, event_id: msg.eventId, company_id: msg.companyId });
    return Promise.resolve();
  },
};
