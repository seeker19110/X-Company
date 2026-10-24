// Route thông báo trong ứng dụng (T-080): GET /api/app/notifications (trang của tôi + số chưa đọc),
// POST /api/app/notifications/read ({ ids } | { all: true }). Chỉ dữ liệu của chính actor — không cần quyền vai trò.
import { z } from "zod";
import { getPool } from "../db/index.ts";
import { json, readJson, withActor } from "../http/index.ts";
import { parsePage } from "../nen/pagination.ts";
import { listMine, markRead, MARK_READ_MAX_IDS, unreadCount } from "./index.ts";

export const getNotifications = withActor(async (ctx) => {
  const page = parsePage(new URL(ctx.req.url).searchParams);
  const pool = getPool();
  const { companyId, userId } = ctx.actor;
  const [p, unread] = await Promise.all([
    listMine(pool, companyId, userId, page),
    unreadCount(pool, companyId, userId),
  ]);
  return json({ ...p, unread });
});

/** Thân POST /api/app/notifications/read — xuất ra cho hợp đồng OpenAPI. */
export const ReadBody = z.union([
  z.strictObject({ ids: z.array(z.uuid()).min(1).max(MARK_READ_MAX_IDS) }),
  z.strictObject({ all: z.literal(true) }),
]);

// Lũy đẳng tự nhiên (đã đọc thì giữ mốc cũ) → không bắt buộc Idempotency-Key.
export const postNotificationsRead = withActor(async (ctx) => {
  const b = ReadBody.parse(await readJson(ctx.req));
  const pool = getPool();
  const { companyId, userId } = ctx.actor;
  const updated = await markRead(pool, companyId, userId, "all" in b ? "all" : b.ids);
  return json({ updated, unread: await unreadCount(pool, companyId, userId) });
});
