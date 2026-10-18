// CMS (F-003): trang + phiên bản. Luồng draft → in_review → approved → published; người duyệt ≠ tác giả (R5).
// Công khai chỉ thấy phiên bản `published` có publish_at ≤ now (bản mới nhất theo publish_at) của trang chưa lưu trữ.
// Kiểm quyền vai trò (cms.edit / cms.approve) ở lớp route; ở đây giữ luật luồng và R5.
import { appendAudit } from "../audit/index.ts";
import type { Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { lintMarkdown, type ContentWarning } from "./markdown.ts";

export const PAGE_TYPES = [
  "home",
  "about",
  "service",
  "project",
  "capability",
  "news",
  "job",
  "contact",
  "page",
] as const;
export type PageType = (typeof PAGE_TYPES)[number];
export type Locale = "vi" | "en";
export type RevisionStatus = "draft" | "in_review" | "approved" | "published";

export interface CmsActor {
  userId: string;
  companyId: string;
  requestId?: string | null;
}

export interface Content {
  title: string;
  summary?: string | null;
  bodyMarkdown: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  canonicalUrl?: string | null;
}

export interface Revision extends Required<Content> {
  id: string;
  pageId: string;
  version: number;
  status: RevisionStatus;
  authorUserId: string;
  reviewerUserId: string | null;
  publishAt: Date | null;
}

export interface PublishedPage extends Revision {
  type: PageType;
  slug: string;
  locale: Locale;
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function pathFor(type: PageType, slug: string): string {
  const base: Record<PageType, string> = {
    home: "/",
    about: "/gioi-thieu",
    service: "/dich-vu",
    project: "/du-an",
    capability: "/nang-luc",
    news: "/tin-tuc",
    job: "/tuyen-dung",
    contact: "/lien-he",
    page: "",
  };
  if (type === "home") return "/";
  if (slug === "") return base[type] === "" ? "/" : base[type];
  return `${base[type]}/${slug}`;
}

function audit(
  tx: Queryable,
  a: CmsActor,
  action: string,
  id: string,
  extra: { reason?: string; after?: unknown } = {},
) {
  return appendAudit(tx, {
    actorUserId: a.userId,
    companyId: a.companyId,
    action,
    objectType: "cms_revision",
    objectId: id,
    reason: extra.reason ?? null,
    after: extra.after,
    requestId: a.requestId ?? null,
  });
}

function validateContent(c: Content): void {
  if ((c.title?.trim() ?? "") === "") throw new AppError("VALIDATION", 422, "Tiêu đề không được trống");
  if (c.canonicalUrl && !/^https?:\/\//.test(c.canonicalUrl))
    throw new AppError("VALIDATION", 422, "Canonical phải là URL http(s)");
}

interface RevRow {
  id: string;
  page_id: string;
  version: number;
  title: string;
  summary: string | null;
  body_markdown: string;
  seo_title: string | null;
  seo_description: string | null;
  canonical_url: string | null;
  status: RevisionStatus;
  author_user_id: string;
  reviewer_user_id: string | null;
  publish_at: Date | null;
}

function toRevision(r: RevRow): Revision {
  return {
    id: r.id,
    pageId: r.page_id,
    version: r.version,
    title: r.title,
    summary: r.summary,
    bodyMarkdown: r.body_markdown,
    seoTitle: r.seo_title,
    seoDescription: r.seo_description,
    canonicalUrl: r.canonical_url,
    status: r.status,
    authorUserId: r.author_user_id,
    reviewerUserId: r.reviewer_user_id,
    publishAt: r.publish_at,
  };
}

async function lockRevision(tx: Queryable, a: CmsActor, revisionId: string): Promise<Revision> {
  const { rows } = await tx.query<RevRow>(
    "SELECT * FROM cms_revision WHERE company_id = $1 AND id = $2 FOR UPDATE",
    [a.companyId, revisionId],
  );
  if (!rows[0]) throw new AppError("NOT_FOUND", 404, "Không tìm thấy phiên bản");
  return toRevision(rows[0]);
}

async function insertRevision(
  tx: Queryable,
  a: CmsActor,
  pageId: string,
  c: Content,
  status: RevisionStatus,
  extra: { reviewerUserId?: string | null; restoredFrom?: number | null } = {},
): Promise<Revision> {
  const { rows } = await tx.query<RevRow>(
    `INSERT INTO cms_revision (company_id, page_id, version, title, summary, body_markdown, seo_title, seo_description,
       canonical_url, status, author_user_id, reviewer_user_id, restored_from_version)
     VALUES ($1, $2, (SELECT COALESCE(max(version), 0) + 1 FROM cms_revision WHERE page_id = $2),
       $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      a.companyId,
      pageId,
      c.title.trim(),
      c.summary ?? null,
      c.bodyMarkdown,
      c.seoTitle ?? null,
      c.seoDescription ?? null,
      c.canonicalUrl ?? null,
      status,
      a.userId,
      extra.reviewerUserId ?? null,
      extra.restoredFrom ?? null,
    ],
  );
  return toRevision(rows[0]!);
}

/** Tạo trang mới kèm bản nháp v1. */
export async function createPage(
  tx: Queryable,
  a: CmsActor,
  page: { type: PageType; slug: string; locale?: Locale },
  c: Content,
): Promise<Revision> {
  if (!PAGE_TYPES.includes(page.type)) throw new AppError("VALIDATION", 422, "Loại trang không hợp lệ");
  if (page.slug !== "" && !SLUG_RE.test(page.slug))
    throw new AppError("VALIDATION", 422, "Đường dẫn chỉ gồm chữ thường không dấu, số và gạch nối");
  validateContent(c);
  let pageId: string;
  try {
    const { rows } = await tx.query<{ id: string }>(
      "INSERT INTO cms_page (company_id, type, slug, locale) VALUES ($1, $2, $3, $4) RETURNING id",
      [a.companyId, page.type, page.slug, page.locale ?? "vi"],
    );
    pageId = rows[0]!.id;
  } catch (err) {
    if ((err as { code?: string }).code === "23505")
      throw new AppError("DUPLICATE", 409, "Đường dẫn đã tồn tại");
    throw err;
  }
  const rev = await insertRevision(tx, a, pageId, c, "draft");
  await audit(tx, a, "cms.create", rev.id, { after: { page, title: c.title } });
  return rev;
}

/** Bản nháp mới từ nội dung mới (trang đã có). */
export async function createDraft(tx: Queryable, a: CmsActor, pageId: string, c: Content): Promise<Revision> {
  validateContent(c);
  const p = await tx.query("SELECT 1 FROM cms_page WHERE company_id = $1 AND id = $2 FOR UPDATE", [
    a.companyId,
    pageId,
  ]);
  if (p.rowCount === 0) throw new AppError("NOT_FOUND", 404, "Không tìm thấy trang");
  const rev = await insertRevision(tx, a, pageId, c, "draft");
  await audit(tx, a, "cms.draft", rev.id);
  return rev;
}

export async function updateDraft(tx: Queryable, a: CmsActor, revisionId: string, c: Content): Promise<void> {
  validateContent(c);
  const rev = await lockRevision(tx, a, revisionId);
  if (rev.status !== "draft") throw new AppError("INVALID_STATE", 409, "Chỉ sửa được bản nháp");
  // Chỉ tác giả sửa nháp: nếu người khác sửa rồi duyệt, nội dung do chính họ viết sẽ qua được R5 (review PR #8 #8).
  if (rev.authorUserId !== a.userId)
    throw new AppError("NOT_AUTHOR", 403, "Chỉ tác giả được sửa bản nháp — tạo bản nháp mới");
  await tx.query(
    `UPDATE cms_revision SET title = $2, summary = $3, body_markdown = $4, seo_title = $5, seo_description = $6,
       canonical_url = $7 WHERE id = $1`,
    [
      revisionId,
      c.title.trim(),
      c.summary ?? null,
      c.bodyMarkdown,
      c.seoTitle ?? null,
      c.seoDescription ?? null,
      c.canonicalUrl ?? null,
    ],
  );
  await audit(tx, a, "cms.update_draft", revisionId);
}

async function transition(
  tx: Queryable,
  a: CmsActor,
  revisionId: string,
  from: RevisionStatus,
  to: RevisionStatus,
  set: { reviewerUserId?: string; publishAt?: Date } = {},
): Promise<Revision> {
  const rev = await lockRevision(tx, a, revisionId);
  if (rev.status !== from)
    throw new AppError("INVALID_STATE", 409, `Phiên bản đang ở trạng thái ${rev.status}, cần ${from}`);
  await tx.query(
    `UPDATE cms_revision SET status = $2, reviewer_user_id = COALESCE($3, reviewer_user_id), publish_at = COALESCE($4, publish_at)
     WHERE id = $1`,
    [revisionId, to, set.reviewerUserId ?? null, set.publishAt ?? null],
  );
  return { ...rev, status: to };
}

export async function submitForReview(tx: Queryable, a: CmsActor, revisionId: string): Promise<void> {
  await transition(tx, a, revisionId, "draft", "in_review");
  await audit(tx, a, "cms.submit", revisionId);
}

/** Duyệt (R5: người duyệt ≠ tác giả). Trả cảnh báo nội dung (vd ảnh thiếu alt) — không chặn. */
export async function approve(tx: Queryable, a: CmsActor, revisionId: string): Promise<ContentWarning[]> {
  const rev = await lockRevision(tx, a, revisionId);
  if (rev.authorUserId === a.userId)
    throw new AppError("SELF_APPROVAL", 409, "Không thể tự duyệt bài của mình");
  await transition(tx, a, revisionId, "in_review", "approved", { reviewerUserId: a.userId });
  await audit(tx, a, "cms.approve", revisionId);
  return lintMarkdown(rev.bodyMarkdown);
}

export async function returnToDraft(
  tx: Queryable,
  a: CmsActor,
  revisionId: string,
  reason: string,
): Promise<void> {
  if (reason.trim() === "") throw new AppError("VALIDATION", 422, "Cần lý do trả lại");
  await transition(tx, a, revisionId, "in_review", "draft");
  await audit(tx, a, "cms.return", revisionId, { reason });
}

/** Xuất bản bản đã duyệt, ngay hoặc hẹn giờ (`publishAt`). */
export async function publish(
  tx: Queryable,
  a: CmsActor,
  revisionId: string,
  publishAt: Date = new Date(),
): Promise<void> {
  await transition(tx, a, revisionId, "approved", "published", { publishAt });
  await tx.query(
    "UPDATE cms_page SET archived_at = NULL WHERE id = (SELECT page_id FROM cms_revision WHERE id = $1)",
    [revisionId],
  );
  await audit(tx, a, "cms.publish", revisionId, { after: { publishAt: publishAt.toISOString() } });
}

/**
 * Hoàn tác: xuất bản lại nội dung của phiên bản `version` thành phiên bản MỚI (không sửa lịch sử). Nội dung đó đã
 * được duyệt trước đây; người hoàn tác cần quyền duyệt (route) và được ghi làm người duyệt bản mới (≠ tác giả).
 */
export async function restoreVersion(
  tx: Queryable,
  a: CmsActor,
  pageId: string,
  version: number,
): Promise<Revision> {
  const { rows } = await tx.query<RevRow>(
    "SELECT * FROM cms_revision WHERE company_id = $1 AND page_id = $2 AND version = $3",
    [a.companyId, pageId, version],
  );
  const src = rows[0];
  if (!src) throw new AppError("NOT_FOUND", 404, "Không tìm thấy phiên bản");
  if (!src.reviewer_user_id)
    throw new AppError("INVALID_STATE", 409, "Chỉ hoàn tác về phiên bản đã từng được duyệt");
  const old = toRevision(src);
  // Tác giả bản mới = tác giả nội dung gốc; người hoàn tác là người duyệt → R5 vẫn giữ.
  if (old.authorUserId === a.userId)
    throw new AppError("SELF_APPROVAL", 409, "Người viết nội dung gốc không tự xuất bản lại được");
  const rev = await insertRevision(tx, { ...a, userId: old.authorUserId }, pageId, old, "approved", {
    reviewerUserId: a.userId,
    restoredFrom: version,
  });
  await publish(tx, a, rev.id);
  await audit(tx, a, "cms.restore", rev.id, { after: { fromVersion: version } });
  return { ...rev, status: "published" };
}

/** Đổi slug: slug cũ chuyển hướng 301 sang slug mới. */
export async function changeSlug(tx: Queryable, a: CmsActor, pageId: string, newSlug: string): Promise<void> {
  if (!SLUG_RE.test(newSlug)) throw new AppError("VALIDATION", 422, "Đường dẫn không hợp lệ");
  const { rows } = await tx.query<{ type: PageType; slug: string; locale: Locale }>(
    "SELECT type, slug, locale FROM cms_page WHERE company_id = $1 AND id = $2 FOR UPDATE",
    [a.companyId, pageId],
  );
  const p = rows[0];
  if (!p) throw new AppError("NOT_FOUND", 404, "Không tìm thấy trang");
  if (p.slug === newSlug) return;
  try {
    await tx.query("UPDATE cms_page SET slug = $2 WHERE id = $1", [pageId, newSlug]);
  } catch (err) {
    if ((err as { code?: string }).code === "23505")
      throw new AppError("DUPLICATE", 409, "Đường dẫn đã tồn tại");
    throw err;
  }
  const from = pathFor(p.type, p.slug);
  const to = pathFor(p.type, newSlug);
  // Thứ tự quan trọng: (1) đường dẫn mới đang sống → bỏ redirect XUẤT PHÁT từ nó (kể cả redirect ngược về `from`);
  // (2) redirect cũ trỏ tới `from` trỏ thẳng tới đích mới (không nhảy nhiều bước); (3) thêm from → to.
  await tx.query("DELETE FROM cms_redirect WHERE company_id = $1 AND locale = $2 AND from_path = $3", [
    a.companyId,
    p.locale,
    to,
  ]);
  await tx.query(
    "UPDATE cms_redirect SET to_path = $3 WHERE company_id = $1 AND locale = $2 AND to_path = $4",
    [a.companyId, p.locale, to, from],
  );
  await tx.query(
    `INSERT INTO cms_redirect (company_id, locale, from_path, to_path) VALUES ($1, $2, $3, $4)
     ON CONFLICT (company_id, locale, from_path) DO UPDATE SET to_path = EXCLUDED.to_path`,
    [a.companyId, p.locale, from, to],
  );
  await appendAudit(tx, {
    actorUserId: a.userId,
    companyId: a.companyId,
    action: "cms.change_slug",
    objectType: "cms_page",
    objectId: pageId,
    after: { from, to },
    requestId: a.requestId ?? null,
  });
}

export async function archivePage(tx: Queryable, a: CmsActor, pageId: string, reason: string): Promise<void> {
  const r = await tx.query("UPDATE cms_page SET archived_at = now() WHERE company_id = $1 AND id = $2", [
    a.companyId,
    pageId,
  ]);
  if (r.rowCount === 0) throw new AppError("NOT_FOUND", 404, "Không tìm thấy trang");
  await appendAudit(tx, {
    actorUserId: a.userId,
    companyId: a.companyId,
    action: "cms.archive",
    objectType: "cms_page",
    objectId: pageId,
    reason,
    requestId: a.requestId ?? null,
  });
}

// ---- Đọc công khai: chỉ bản đã xuất bản tới hạn ---------------------------------------------------------------

const VISIBLE_SQL = `
  SELECT DISTINCT ON (p.id) r.*, p.type, p.slug, p.locale
  FROM cms_page p JOIN cms_revision r ON r.page_id = p.id
  WHERE p.company_id = $1 AND p.locale = $2 AND p.archived_at IS NULL
    AND r.status = 'published' AND r.publish_at <= $3`;

type VisibleRow = RevRow & { type: PageType; slug: string; locale: Locale };

function toPublished(r: VisibleRow): PublishedPage {
  return { ...toRevision(r), type: r.type, slug: r.slug, locale: r.locale };
}

export async function getPublished(
  db: Queryable,
  companyId: string,
  type: PageType,
  slug: string,
  opts: { locale?: Locale; now?: Date } = {},
): Promise<PublishedPage | null> {
  const { rows } = await db.query<VisibleRow>(
    // sql-interp-allow: VISIBLE_SQL là hằng module; type/slug đi qua tham số $4/$5.
    `${VISIBLE_SQL} AND p.type = $4 AND p.slug = $5 ORDER BY p.id, r.publish_at DESC, r.version DESC`,
    [companyId, opts.locale ?? "vi", opts.now ?? new Date(), type, slug],
  );
  return rows[0] ? toPublished(rows[0]) : null;
}

export async function listPublished(
  db: Queryable,
  companyId: string,
  opts: { type?: PageType; locale?: Locale; now?: Date } = {},
): Promise<PublishedPage[]> {
  const params: unknown[] = [companyId, opts.locale ?? "vi", opts.now ?? new Date()];
  let where = "";
  if (opts.type !== undefined) {
    params.push(opts.type);
    // sql-interp-allow: chỉ chèn SỐ THỨ TỰ tham số (params.length), giá trị type đi qua tham số.
    where = ` AND p.type = $${params.length}`;
  }
  const { rows } = await db.query<VisibleRow>(
    // sql-interp-allow: VISIBLE_SQL là hằng module; `where` do nhánh trên dựng từ hằng + số thứ tự tham số.
    `SELECT * FROM (${VISIBLE_SQL}${where} ORDER BY p.id, r.publish_at DESC, r.version DESC) v ORDER BY v.publish_at DESC`,
    params,
  );
  return rows.map(toPublished);
}

export async function findRedirect(db: Queryable, companyId: string, path: string, locale: Locale = "vi") {
  const { rows } = await db.query<{ to_path: string }>(
    "SELECT to_path FROM cms_redirect WHERE company_id = $1 AND locale = $2 AND from_path = $3",
    [companyId, locale, path],
  );
  return rows[0]?.to_path ?? null;
}
