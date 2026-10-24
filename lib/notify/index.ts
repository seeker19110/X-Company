// Thông báo trong ứng dụng (T-080, D-058; SPEC-work W3/AT11, F-010). Kênh tự host: một hàng `notification` cho mỗi người nhận,
// ghi bởi worker outbox TRONG giao dịch xử lý sự kiện (lib/worker/handlers.ts) nên lũy đẳng cùng `processed_message`; thêm
// UNIQUE (source_event_id, user_id) cho chắc khi hai worker cùng chạy một sự kiện.
// Không lưu PII: chỉ chủ đề + loại/id đối tượng + mã tra cứu. Người nhận xem chi tiết qua API của đối tượng (có kiểm quyền).
// Đọc/đánh dấu đã đọc: chỉ của chính actor (user_id = actor, company_id = công ty actor). Đánh dấu đã đọc là trạng thái
// giao diện của chủ sở hữu, không phải ghi nghiệp vụ → không ghi audit (như phiên/idempotency_record); việc tạo thông báo
// cũng không audit riêng vì sự kiện nguồn (giao việc, phân công, nhận hồ sơ) đã có audit ở giao dịch nghiệp vụ.
import { can, PERMISSIONS, type Action, type Resource } from "../authz/index.ts";
import { loadActor } from "../authz/load.ts";
import type { Queryable } from "../db/index.ts";
import { fetchLimit, MAX_PAGE, toPage, type Page, type PageRequest } from "../nen/pagination.ts";

export const REF_TYPES = ["inquiry", "job_application", "task"] as const;
export type RefType = (typeof REF_TYPES)[number];

/** Số id tối đa mỗi lần đánh dấu đã đọc (thân POST /api/app/notifications/read). */
export const MARK_READ_MAX_IDS = 100;

export interface NewNotification {
  companyId: string;
  topic: string;
  refType: RefType;
  refId: string;
  code: string | null;
  sourceEventId: number;
}

/**
 * Thêm thông báo cho từng người nhận (đã lọc trùng). Trùng (source_event_id, user_id) → bỏ qua (ON CONFLICT DO NOTHING).
 * Người nhận không thuộc công ty → FK (company_id, user_id) từ chối; nơi gọi phải lọc trước (activeUsers…). Trả số hàng mới.
 */
export async function addNotifications(
  tx: Queryable,
  n: NewNotification,
  userIds: readonly string[],
): Promise<number> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return 0;
  const r = await tx.query(
    `INSERT INTO notification (company_id, user_id, topic, ref_type, ref_id, code, source_event_id)
     SELECT $1, u, $3, $4, $5, $6, $7 FROM unnest($2::uuid[]) AS u
     ON CONFLICT (source_event_id, user_id) DO NOTHING`,
    [n.companyId, ids, n.topic, n.refType, n.refId, n.code, n.sourceEventId],
  );
  return r.rowCount ?? 0;
}

/** Trong `userIds`: tài khoản thuộc công ty và chưa bị vô hiệu (id lạ/khác công ty/disabled bị bỏ). */
export async function activeUsers(
  db: Queryable,
  companyId: string,
  userIds: readonly string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const r = await db.query<{ id: string }>(
    "SELECT id FROM app_user WHERE company_id = $1 AND id = ANY($2::uuid[]) AND disabled_at IS NULL ORDER BY id",
    [companyId, [...new Set(userIds)]],
  );
  return r.rows.map((x) => x.id);
}

/** Tài khoản còn hiệu lực gắn với các hồ sơ nhân viên `employeeIds` trong công ty. */
export async function usersOfEmployees(
  db: Queryable,
  companyId: string,
  employeeIds: readonly string[],
): Promise<string[]> {
  if (employeeIds.length === 0) return [];
  const r = await db.query<{ id: string }>(
    `SELECT id FROM app_user
      WHERE company_id = $1 AND employee_id = ANY($2::uuid[]) AND disabled_at IS NULL ORDER BY id`,
    [companyId, [...new Set(employeeIds)]],
  );
  return r.rows.map((x) => x.id);
}

/**
 * Người dùng hiện có quyền `action` trên `resource` (cùng quyết định với route: `loadActor` + `can()`): ứng viên là tài khoản
 * chưa vô hiệu có grant còn hiệu lực với vai được phép; mỗi ứng viên được kiểm lại bằng `can()` theo phạm vi.
 */
export async function usersWhoCan(
  db: Queryable,
  action: Action,
  resource: Resource,
  now: Date = new Date(),
): Promise<string[]> {
  const roles: readonly string[] = PERMISSIONS[action].roles;
  if (roles.length === 0) return [];
  const r = await db.query<{ id: string }>(
    `SELECT DISTINCT u.id FROM app_user u JOIN role_grant g ON g.user_id = u.id
      WHERE u.company_id = $1 AND u.disabled_at IS NULL AND g.company_id = $1 AND g.role = ANY($2::text[])
        AND g.revoked_at IS NULL AND g.valid_from <= $3 AND (g.valid_to IS NULL OR g.valid_to > $3)
      ORDER BY u.id`,
    [resource.companyId, roles, now],
  );
  const out: string[] = [];
  for (const { id } of r.rows) {
    const actor = await loadActor(db, id, now);
    if (actor && can(actor, action, resource)) out.push(id);
  }
  return out;
}

export interface NotificationItem {
  id: string;
  topic: string;
  ref_type: RefType;
  ref_id: string;
  code: string | null;
  created_at: Date;
  read_at: Date | null;
}

/** Truy vấn lõi "thông báo của tôi" — mới nhất trước; dùng index notification_user_idx (0030). */
const MY_NOTIFICATIONS_SQL = `SELECT id, topic, ref_type, ref_id, code, created_at, read_at
   FROM notification WHERE company_id = $1 AND user_id = $2
   ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`;

/** Một trang thông báo của chính người dùng. */
export async function listMine(
  db: Queryable,
  companyId: string,
  userId: string,
  page: PageRequest = MAX_PAGE,
): Promise<Page<NotificationItem>> {
  const { rows } = await db.query<NotificationItem>(MY_NOTIFICATIONS_SQL, [
    companyId,
    userId,
    fetchLimit(page),
    page.offset,
  ]);
  return toPage(rows, page);
}

/** Số thông báo chưa đọc của chính người dùng. */
export async function unreadCount(db: Queryable, companyId: string, userId: string): Promise<number> {
  const r = await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM notification WHERE company_id = $1 AND user_id = $2 AND read_at IS NULL",
    [companyId, userId],
  );
  return r.rows[0]?.n ?? 0;
}

/**
 * Đánh dấu đã đọc: `ids` (chỉ hàng của chính người dùng — id của người khác/không tồn tại bị bỏ qua, không lộ tồn tại) hoặc
 * `"all"`. Hàng đã đọc giữ mốc cũ (lũy đẳng). Trả số hàng vừa chuyển sang đã đọc.
 */
export async function markRead(
  db: Queryable,
  companyId: string,
  userId: string,
  target: readonly string[] | "all",
  now: Date = new Date(),
): Promise<number> {
  if (target !== "all" && target.length === 0) return 0;
  const r = await db.query(
    `UPDATE notification SET read_at = $3
      WHERE company_id = $1 AND user_id = $2 AND read_at IS NULL AND ($4::uuid[] IS NULL OR id = ANY($4::uuid[]))`,
    [companyId, userId, now, target === "all" ? null : [...new Set(target)]],
  );
  return r.rowCount ?? 0;
}
