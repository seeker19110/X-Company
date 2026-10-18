// Nhãn tiếng Việt cho trạng thái — màu luôn đi kèm chữ (SPEC-pwa: "màu sắc luôn đi cùng nhãn").
export const KIND_LABEL: Record<string, string> = {
  in: "Vào ca",
  out: "Ra ca",
  break_start: "Bắt đầu nghỉ",
  break_end: "Hết nghỉ",
};
export const EVENT_STATUS: Record<string, { label: string; cls: string }> = {
  accepted: { label: "Đã xác nhận", cls: "ok" },
  needs_review: { label: "Chờ xác minh", cls: "warn" },
  rejected: { label: "Bị từ chối", cls: "err" },
};
export const TASK_STATUS: Record<string, string> = {
  todo: "Chưa làm",
  in_progress: "Đang làm",
  blocked: "Bị chặn",
  awaiting_acceptance: "Chờ nghiệm thu",
  done: "Hoàn tất",
  cancelled: "Đã huỷ",
};
export const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
export const fmtDateTime = (iso: string) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
