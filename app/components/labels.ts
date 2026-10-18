// Nhãn tiếng Việt cho trạng thái — màu luôn đi kèm chữ (SPEC-pwa: "màu sắc luôn đi cùng nhãn"). Chữ nằm ở messages/vi.json.
// Ngày/giờ định dạng ở lib/i18n/format.ts (Intl, múi Asia/Ho_Chi_Minh).
import { t } from "@/lib/i18n/client-app";

export const KIND_LABEL: Record<string, string> = {
  in: t("attendance.kind.in"),
  out: t("attendance.kind.out"),
  break_start: t("attendance.kind.break_start"),
  break_end: t("attendance.kind.break_end"),
};
export const EVENT_STATUS: Record<string, { label: string; cls: string }> = {
  accepted: { label: t("attendance.eventStatus.accepted"), cls: "ok" },
  needs_review: { label: t("attendance.eventStatus.needs_review"), cls: "warn" },
  rejected: { label: t("attendance.eventStatus.rejected"), cls: "err" },
};
export const TASK_STATUS: Record<string, string> = {
  todo: t("tasks.status.todo"),
  in_progress: t("tasks.status.in_progress"),
  blocked: t("tasks.status.blocked"),
  awaiting_acceptance: t("tasks.status.awaiting_acceptance"),
  done: t("tasks.status.done"),
  cancelled: t("tasks.status.cancelled"),
};
