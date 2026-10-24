// Handler theo topic outbox có trong mã (lib/inquiry, lib/work/tasks) + schema zod cho payload (BE-JOB-007):
// payload chỉ chứa ID/tham số tối thiểu; sai schema → dead ngay. Handler mặc định: (1) thông báo TRONG ỨNG DỤNG (D-058,
// luôn bật, ghi trong giao dịch worker — lib/notify) cho người bị ảnh hưởng, (2) kênh phụ `Channel` (mặc định ghi log).
import { z } from "zod";
import type { Tx } from "../db/index.ts";
import { addNotifications, usersOfEmployees, usersWhoCan, type RefType } from "../notify/index.ts";
import { isProcessingBlocked } from "../privacy/consent.ts";
import { ChannelDisabledError, logChannel, type Channel } from "./channels.ts";

export interface JobEvent {
  id: number;
  companyId: string | null;
  topic: string;
  attempts: number;
}

export interface Handler<S extends z.ZodType = z.ZodType> {
  /** Tên consumer — khoá khử trùng trong processed_message. */
  consumer: string;
  /** Topic khớp: chuỗi (đúng bằng) hoặc RegExp. */
  match: string | RegExp;
  schema: S;
  /** Chạy trong giao dịch của worker: tác động DB cùng commit với đánh dấu đã xử lý. Ném lỗi → thử lại. */
  handle(tx: Tx, payload: z.output<S>, event: JobEvent): Promise<void>;
}

export class Registry {
  private readonly handlers: Handler[] = [];

  register<S extends z.ZodType>(h: Handler<S>): this {
    this.handlers.push(h as unknown as Handler);
    return this;
  }

  find(topic: string): Handler | undefined {
    return this.handlers.find((h) => (typeof h.match === "string" ? h.match === topic : h.match.test(topic)));
  }
}

export const InquiryAssigned = z.object({
  inquiryId: z.uuid(),
  code: z.string().min(1).max(64).optional(),
  assigneeUserId: z.uuid(),
});
export const ApplicationReceived = z.object({ applicationId: z.uuid(), code: z.string().min(1).max(64) });
export const TaskNotice = z.object({
  taskId: z.uuid(),
  employeeIds: z.array(z.uuid()).min(1).max(200),
  byUserId: z.uuid(),
});

/** Chủ thể của payload (liên hệ/ứng viên) đã rút đồng ý hoặc bị hạn chế xử lý? Payload khác → không chặn. */
async function subjectBlocked(tx: Tx, payload: unknown): Promise<boolean> {
  const p = payload as { inquiryId?: unknown; applicationId?: unknown };
  if (typeof p.inquiryId === "string")
    return isProcessingBlocked(tx, "inquiry", p.inquiryId, "inquiry_contact");
  if (typeof p.applicationId === "string")
    return isProcessingBlocked(tx, "job_application", p.applicationId, "job_application");
  return false;
}

interface InApp {
  refType: RefType;
  refId: string;
  code: string | null;
  /** Người nhận (user id) đã lọc: cùng công ty, tài khoản chưa vô hiệu. */
  recipients: (tx: Tx, companyId: string) => Promise<string[]>;
}

/** Thông báo trong ứng dụng theo topic: người bị ảnh hưởng + đối tượng (chỉ id/mã, không PII). */
function inApp(topic: string, payload: unknown): InApp | null {
  if (topic === "inquiry.assigned") {
    const p = payload as z.output<typeof InquiryAssigned>;
    return {
      refType: "inquiry",
      refId: p.inquiryId,
      code: p.code ?? null,
      // AUD-SEC-009: người được phân công phải CÒN quyền inquiry.manage lúc worker xử lý (grant có thể đã bị thu hồi/hết hạn
      // sau khi phân công) — cùng quyết định với usersWhoCan, rồi lọc theo người được phân công (vô hiệu/khác công ty cũng rơi ở đây).
      recipients: async (tx, companyId) =>
        (await usersWhoCan(tx, "inquiry.manage", { companyId })).filter((id) => id === p.assigneeUserId),
    };
  }
  if (topic === "application.received") {
    const p = payload as z.output<typeof ApplicationReceived>;
    return {
      refType: "job_application",
      refId: p.applicationId,
      code: p.code,
      // Ai đang có quyền đọc hồ sơ ứng viên của công ty (cùng quyết định với GET /api/app/applications).
      recipients: (tx, companyId) => usersWhoCan(tx, "application.read", { companyId }),
    };
  }
  if (topic.startsWith("task.")) {
    const p = payload as z.output<typeof TaskNotice>;
    return {
      refType: "task",
      refId: p.taskId,
      code: null,
      // Không tự báo mình: lib/work/tasks.ts đã loại nhân viên của người thao tác; loại thêm theo user id cho chắc.
      recipients: async (tx, companyId) =>
        (await usersOfEmployees(tx, companyId, p.employeeIds)).filter((u) => u !== p.byUserId),
    };
  }
  return null;
}

/**
 * Registry mặc định: mọi topic hiện có ghi thông báo trong ứng dụng (cùng giao dịch worker) rồi giao qua `channel`
 * (kênh phụ, mặc định ghi log). Kênh phụ tắt → cả giao dịch hoãn (giữ pending), thông báo trong ứng dụng ghi khi thử lại.
 */
export function defaultRegistry(channel: Channel = logChannel): Registry {
  const deliverTo = (consumer: string, match: string | RegExp) =>
    ({
      consumer,
      match,
      handle: async (tx: Tx, payload: unknown, e: JobEvent) => {
        // Chủ thể đã rút đồng ý / bị hạn chế xử lý → bỏ qua sự kiện (CMP-RIGHTS-004): không gửi, đóng việc.
        if (await subjectBlocked(tx, payload)) return;
        if (!channel.enabled()) throw new ChannelDisabledError(channel.name);
        const n = inApp(e.topic, payload);
        // Sự kiện không gắn công ty → không xác định được người nhận trong ứng dụng; vẫn giao kênh phụ như trước.
        if (n && e.companyId) {
          const users = await n.recipients(tx, e.companyId);
          await addNotifications(
            tx,
            {
              companyId: e.companyId,
              topic: e.topic,
              refType: n.refType,
              refId: n.refId,
              code: n.code,
              sourceEventId: e.id,
            },
            users,
          );
        }
        await channel.deliver({ eventId: e.id, topic: e.topic, companyId: e.companyId, payload });
      },
    }) satisfies Omit<Handler, "schema">;
  return new Registry()
    .register({ ...deliverTo("notify.inquiry", "inquiry.assigned"), schema: InquiryAssigned })
    .register({ ...deliverTo("notify.application", "application.received"), schema: ApplicationReceived })
    .register({ ...deliverTo("notify.task", /^task\.[a-z_]+$/), schema: TaskNotice });
}
