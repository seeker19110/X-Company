// Dữ liệu trên thiết bị theo người dùng (SPEC-pwa, AT12) — logic thuần; phần IndexedDB nằm ở app/components/offline.
// Mỗi người dùng một database `xc-<userId>`; khởi động với phiên của người khác → xoá DB không thuộc phiên hiện tại.
import type { QueueSummary } from "./queue.ts";

export const DB_PREFIX = "xc-";
export const SCHEMA_VERSION = 2;

export function dbNameFor(userId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("userId không hợp lệ");
  return `${DB_PREFIX}${userId}`;
}

/** DB của người dùng khác (cùng tiền tố) cần xoá khi phiên hiện tại là `currentUserId` (null = chưa đăng nhập). */
export function foreignDatabases(names: string[], currentUserId: string | null): string[] {
  const mine = currentUserId ? dbNameFor(currentUserId) : null;
  return names.filter((n) => n.startsWith(DB_PREFIX) && n !== mine);
}

export type LogoutChoice = "sync_then_logout" | "discard_and_logout";

export interface LogoutPlan {
  /** Còn bản chưa gửi → phải hỏi người dùng (không âm thầm mất nháp). */
  needsConfirmation: boolean;
  pending: number;
  options: LogoutChoice[];
}

export function logoutPlan(summary: QueueSummary): LogoutPlan {
  if (summary.pending === 0) return { needsConfirmation: false, pending: 0, options: [] };
  return {
    needsConfirmation: true,
    pending: summary.pending,
    options: ["sync_then_logout", "discard_and_logout"],
  };
}

/**
 * Nâng cấp lược đồ: KHÔNG drop store chứa hàng chờ; chuyển bản ghi cũ sang dạng mới (SPEC-pwa: nâng cấp SW không xoá
 * bản chưa gửi). v1 → v2: thêm reviewReason/serverId.
 */
export function migrateItem(oldVersion: number, item: Record<string, unknown>): Record<string, unknown> {
  let out = { ...item };
  if (oldVersion < 2) out = { reviewReason: null, serverId: null, ...out };
  return out;
}
