// Handler theo topic outbox có trong mã (lib/inquiry, lib/work/tasks) + schema zod cho payload (BE-JOB-007):
// payload chỉ chứa ID/tham số tối thiểu; sai schema → dead ngay. Handler mặc định giao qua một `Channel`.
import { z } from "zod";
import type { Tx } from "../db/index.ts";
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

/** Registry mặc định: mọi topic hiện có giao qua `channel` (mặc định ghi log). */
export function defaultRegistry(channel: Channel = logChannel): Registry {
  const deliverTo = (consumer: string, match: string | RegExp) =>
    ({
      consumer,
      match,
      handle: async (_tx: Tx, payload: unknown, e: JobEvent) => {
        if (!channel.enabled()) throw new ChannelDisabledError(channel.name);
        await channel.deliver({ eventId: e.id, topic: e.topic, companyId: e.companyId, payload });
      },
    }) satisfies Omit<Handler, "schema">;
  return new Registry()
    .register({ ...deliverTo("notify.inquiry", "inquiry.assigned"), schema: InquiryAssigned })
    .register({ ...deliverTo("notify.application", "application.received"), schema: ApplicationReceived })
    .register({ ...deliverTo("notify.task", /^task\.[a-z_]+$/), schema: TaskNotice });
}
