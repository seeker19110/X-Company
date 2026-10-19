// Sự kiện bảo mật có cấu trúc (SEC-LOG-001/002; bảng sự kiện ở docs/security/security-events.md — test đối chiếu).
// Mỗi sự kiện = một dòng log JSON có: timestamp UTC, event, actor, target, outcome, source_ip, user_agent, request_id.
// Không đưa email/mật khẩu/token vào sự kiện — chỉ id.
import { z } from "zod";
import { currentLogContext, log, runWithLogContext, type Logger } from "./log.ts";

/** Tên sự kiện đã nối vào mã. Thêm sự kiện = thêm vào đây + bảng trong docs/security/security-events.md. */
export const SECURITY_EVENTS = [
  "auth.login",
  "auth.logout",
  "auth.rate_limited",
  "authz.denied",
  "input.validation_failed",
  "ops.alert",
] as const;
export type SecurityEventName = (typeof SECURITY_EVENTS)[number];

export const OUTCOMES = ["success", "denied", "error"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Schema của bản ghi sự kiện (JSON Schema tương đương: z.toJSONSchema). Các trường log khác được phép có thêm. */
export const securityEventSchema = z.object({
  timestamp: z.iso.datetime({ offset: false, precision: 3 }), // UTC, "Z"
  event: z.enum(SECURITY_EVENTS),
  actor: z.object({ type: z.enum(["user", "service", "anonymous"]), id: z.string().min(1).nullable() }),
  target: z.object({ type: z.string().min(1), id: z.string().min(1).nullable() }),
  outcome: z.enum(OUTCOMES),
  source_ip: z.string().min(1),
  user_agent: z.string().min(1),
  request_id: z.string().min(1),
});
export type SecurityEvent = z.infer<typeof securityEventSchema>;

export interface SecurityEventInput {
  event: SecurityEventName;
  outcome: Outcome;
  actorId?: string | null;
  target: { type: string; id?: string | null };
  /** Ghi đè ngữ cảnh request (khi hàm không chạy trong request, vd test hoặc login nhận ip tường minh). */
  sourceIp?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  detail?: Record<string, unknown>;
}

/** Ghi sự kiện bảo mật ra logger; thành công = info, từ chối = warn, lỗi = error. */
export function logSecurityEvent(input: SecurityEventInput, logger: Logger = log): void {
  const ctx = currentLogContext();
  const actorId = input.actorId === undefined ? ctx.actor_id : input.actorId;
  const attrs = {
    event: input.event,
    actor: { type: actorId ? "user" : "anonymous", id: actorId ?? null },
    target: { type: input.target.type, id: input.target.id ?? null },
    outcome: input.outcome,
    source_ip: input.sourceIp ?? ctx.source_ip ?? "unknown",
    user_agent: nonEmpty((input.userAgent ?? ctx.user_agent ?? "").slice(0, 300)) ?? "unknown",
    ...(input.detail ? { detail: input.detail } : {}),
  };
  const level = input.outcome === "success" ? "info" : input.outcome === "denied" ? "warn" : "error";
  // request_id tường minh đi vào ngữ cảnh con để logger gắn đúng.
  if (input.requestId)
    runWithLogContext({ request_id: input.requestId }, () => logger[level]("sự kiện bảo mật", attrs));
  else logger[level]("sự kiện bảo mật", attrs);
}

function nonEmpty(v: string): string | undefined {
  return v === "" ? undefined : v;
}
