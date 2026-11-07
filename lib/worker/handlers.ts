// Handler theo topic outbox có trong mã (lib/inquiry, lib/work/tasks) + schema zod cho payload (BE-JOB-007):
// payload chỉ chứa ID/tham số tối thiểu; sai schema → dead ngay. Handler mặc định: (1) thông báo TRONG ỨNG DỤNG (D-058,
// luôn bật, ghi trong giao dịch worker — lib/notify) cho người bị ảnh hưởng, (2) kênh phụ `Channel` (mặc định ghi log).
// Ngoài ra `files.blob_delete` (T-125): xoá blob ở kho tệp SAU khi giao dịch xoá dữ liệu chủ thể đã commit (DB-TX-003).
import { z } from "zod";
import type { Tx } from "../db/index.ts";
import { getStorage, STORAGE_KEY_RE, type Storage } from "../files/storage.ts";
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
  /**
   * Tác động NGOÀI giao dịch (gọi mạng: kho tệp S3, API…) — DB-TX-003: worker chạy nó TRƯỚC giao dịch đánh dấu xong, không mở
   * giao dịch và không giữ kết nối pool trong lúc chờ. Ít nhất một lần (worker chết sau effect, trước commit → lượt sau chạy lại)
   * nên PHẢI lũy đẳng. Ném lỗi → thử lại/DLQ như `handle`.
   */
  effect?(payload: z.output<S>, event: JobEvent): Promise<void>;
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
/**
 * Xoá blob của kho tệp sau commit (T-125). Payload CHỈ có khoá lưu trữ (`xx/<40 hex>` ngẫu nhiên lúc ghi — không tên tệp, không id
 * chủ thể, không PII); sai dạng → DLQ ngay (sai schema).
 */
export const BLOB_DELETE_TOPIC = "files.blob_delete";
export const BlobDelete = z.object({ storageKey: z.string().regex(STORAGE_KEY_RE) });

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
        usersWhoCan(tx, "inquiry.manage", { companyId }, new Date(), [p.assigneeUserId]),
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
 * `files.blob_delete` xoá blob qua `storage()` (mặc định kho của tiến trình — scripts/worker.ts đăng ký S3 khi FILE_STORAGE=s3).
 */
export function defaultRegistry(
  channel: Channel = logChannel,
  storage: () => Storage = getStorage,
): Registry {
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
    .register({ ...deliverTo("notify.task", /^task\.[a-z_]+$/), schema: TaskNotice })
    .register({
      consumer: "files.blob_delete",
      match: BLOB_DELETE_TOPIC,
      schema: BlobDelete,
      // Gọi kho NGOÀI giao dịch; `remove` lũy đẳng ở mọi backend (blob đã mất = xong). Lỗi tạm → thử lại có trần → DLQ; hàng
      // outbox (payload giữ khoá) là dấu vết blob chưa xoá cho vận hành (`outbox_dead_total`).
      effect: (p) => storage().remove(p.storageKey),
      handle: () => Promise.resolve(),
    });
}
