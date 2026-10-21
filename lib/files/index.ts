// Tệp private có phiên bản + bình luận theo đối tượng (SPEC-work F-010, AT02, S-WK-05).
// Quyền đọc tệp/bình luận = quyền đọc đối tượng chứa nó, kiểm LẠI mỗi lần tải (thu hồi có hiệu lực ngay — §12).
import { createHash } from "node:crypto";
import type pg from "pg";
import { appendAudit } from "../audit/index.ts";
import type { ActorContext } from "../authz/index.ts";
import { withTx, type Queryable } from "../db/index.ts";
import { AppError } from "../nen/app-error.ts";
import { log } from "../nen/log.ts";
import { fetchLimit, MAX_PAGE, toPage, type PageRequest } from "../nen/pagination.ts";
import { projectAccess } from "../work/tasks.ts";
import { checkedFileName } from "./names.ts";
import { sniff } from "./sniff.ts";
import { getStorage } from "./storage.ts";
import { mb } from "../nen/units.ts";
import { t as tr } from "../i18n/index.ts";

export const MAX_FILE_BYTES = mb(20);
export type ObjectType = "task" | "project";
export const OBJECT_TYPES: readonly ObjectType[] = ["task", "project"];

export interface ObjectAccess {
  canRead: boolean;
  canWrite: boolean;
}

/** Quyền trên đối tượng chứa tệp/bình luận. Không tồn tại hoặc không đọc được → 404 (không lộ sự tồn tại). */
export async function objectAccess(
  db: Queryable,
  actor: ActorContext,
  type: ObjectType,
  id: string,
): Promise<ObjectAccess> {
  if (type === "project") {
    const a = await projectAccess(db, actor, id).catch(() => null);
    if (!a?.canRead) throw new AppError("NOT_FOUND", 404, tr("err.files.khongTimThayDoiTuong"));
    return { canRead: true, canWrite: a.canManage || a.isMember };
  }
  const { rows } = await db.query<{
    project_id: string;
    responsible_employee_id: string;
    reviewer_employee_id: string | null;
    collab: boolean;
  }>(
    `SELECT t.project_id, t.responsible_employee_id, t.reviewer_employee_id,
            EXISTS (SELECT 1 FROM task_collaborator c WHERE c.task_id = t.id AND c.employee_id = $3) AS collab
     FROM task t WHERE t.company_id = $1 AND t.id = $2`,
    [actor.companyId, id, actor.employeeId],
  );
  const t = rows[0];
  if (!t) throw new AppError("NOT_FOUND", 404, tr("err.files.khongTimThayDoiTuong"));
  const a = await projectAccess(db, actor, t.project_id);
  if (!a.canRead) throw new AppError("NOT_FOUND", 404, tr("err.files.khongTimThayDoiTuong"));
  const me = actor.employeeId;
  const involved = !!me && (me === t.responsible_employee_id || me === t.reviewer_employee_id || t.collab);
  return { canRead: true, canWrite: a.canManage || involved };
}

export interface UploadInput {
  objectType: ObjectType;
  objectId: string;
  documentId?: string | null;
  title?: string | null;
  originalName: string;
  data: Buffer;
}

export interface UploadResult {
  documentId: string;
  version: number;
  fileId: string;
  mime: string;
  sha256: string;
}

/** Tải lên: kiểm quyền ghi, dung lượng, loại theo nội dung; tài liệu mới hoặc phiên bản mới của tài liệu có sẵn. */
export async function uploadFile(
  pool: pg.Pool,
  actor: ActorContext,
  u: UploadInput,
  requestId?: string,
): Promise<UploadResult> {
  if (!OBJECT_TYPES.includes(u.objectType))
    throw new AppError("VALIDATION", 422, tr("err.files.loaiDoiTuongKhongHopLe"));
  const access = await objectAccess(pool, actor, u.objectType, u.objectId);
  if (!access.canWrite)
    throw new AppError("FORBIDDEN", 403, tr("err.files.banKhongCoQuyenDinhKem"), {
      action: "file.upload",
      object: { type: u.objectType, id: u.objectId },
    });
  if (u.data.length === 0) throw new AppError("VALIDATION", 422, tr("err.files.tepRong"));
  if (u.data.length > MAX_FILE_BYTES)
    throw new AppError("PAYLOAD_TOO_LARGE", 413, tr("err.files.tepVuot20Mb"));
  const kind = sniff(u.data);
  if (!kind) throw new AppError("UNSUPPORTED_TYPE", 415, tr("err.files.chiNhanPdfAnhPngJpeg"));
  const sha256 = createHash("sha256").update(u.data).digest("hex");
  const name = checkedFileName(u.originalName, kind);
  // Ghi kho trước, DB sau: không bao giờ có bản ghi trỏ tệp không tồn tại. Giao dịch lỗi → xoá bù blob vừa ghi (BASE-DATA-009).
  const storageKey = await getStorage().put(u.data);
  try {
    return await recordUpload(pool, actor, u, { storageKey, sha256, name, mime: kind.mime }, requestId);
  } catch (err) {
    await discardOrphanBlob(pool, storageKey);
    throw err;
  }
}

/** Xoá blob chưa có bản ghi `file_object`. Không xác định được (lỗi DB) hoặc xoá lỗi → để lại, ghi log (mồ côi an toàn hơn trỏ hụt). */
async function discardOrphanBlob(pool: pg.Pool, storageKey: string): Promise<void> {
  try {
    // COMMIT có thể đã áp dụng dù client nhận lỗi (mất kết nối): có bản ghi thì tuyệt đối không xoá.
    const { rowCount } = await pool.query("SELECT 1 FROM file_object WHERE storage_key = $1", [storageKey]);
    if (rowCount === 0) await getStorage().remove(storageKey);
  } catch (err) {
    log.error("không xoá bù được blob mồ côi", { storage_key: storageKey, err });
  }
}

async function recordUpload(
  pool: pg.Pool,
  actor: ActorContext,
  u: UploadInput,
  blob: { storageKey: string; sha256: string; name: string; mime: string },
  requestId?: string,
): Promise<UploadResult> {
  const { storageKey, sha256, name, mime } = blob;
  return withTx(async (tx) => {
    const f = await tx.query<{ id: string }>(
      `INSERT INTO file_object (company_id, storage_key, sha256, mime, size_bytes, original_name, uploaded_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [actor.companyId, storageKey, sha256, mime, u.data.length, name, actor.userId],
    );
    const fileId = f.rows[0]!.id;
    let documentId = u.documentId ?? null;
    if (documentId) {
      const d = await tx.query(
        "SELECT 1 FROM document WHERE company_id = $1 AND id = $2 AND object_type = $3 AND object_id = $4 FOR UPDATE",
        [actor.companyId, documentId, u.objectType, u.objectId],
      );
      if ((d.rowCount ?? 0) === 0)
        throw new AppError("NOT_FOUND", 404, tr("err.files.khongTimThayTaiLieuCua"));
    } else {
      const d = await tx.query<{ id: string }>(
        "INSERT INTO document (company_id, object_type, object_id, title) VALUES ($1, $2, $3, $4) RETURNING id",
        [actor.companyId, u.objectType, u.objectId, (u.title ?? name).slice(0, 200)],
      );
      documentId = d.rows[0]!.id;
    }
    const v = await tx.query<{ version: number }>(
      `INSERT INTO document_version (document_id, company_id, version, file_id, uploaded_by_user_id)
       VALUES ($1, $2, (SELECT COALESCE(max(version), 0) + 1 FROM document_version WHERE document_id = $1), $3, $4)
       RETURNING version`,
      [documentId, actor.companyId, fileId, actor.userId],
    );
    await appendAudit(tx, {
      actorUserId: actor.userId,
      companyId: actor.companyId,
      action: "file.upload",
      objectType: u.objectType,
      objectId: u.objectId,
      after: { documentId, version: v.rows[0]!.version, sha256, mime: mime, size: u.data.length },
      requestId: requestId ?? null,
    });
    return { documentId, version: v.rows[0]!.version, fileId, mime: mime, sha256 };
  }, pool);
}

export interface Download {
  mime: string;
  name: string;
  sha256: string;
  data: Buffer;
}

/** Tải về: tìm đối tượng chứa tệp, kiểm quyền đọc ngay lúc này; không gắn đối tượng → 404. */
export async function downloadFile(db: Queryable, actor: ActorContext, fileId: string): Promise<Download> {
  const { rows } = await db.query<{
    storage_key: string;
    mime: string;
    original_name: string;
    sha256: string;
    object_type: ObjectType;
    object_id: string;
  }>(
    `SELECT f.storage_key, f.mime, f.original_name, f.sha256, d.object_type, d.object_id
     FROM file_object f JOIN document_version v ON v.file_id = f.id JOIN document d ON d.id = v.document_id
     WHERE f.company_id = $1 AND f.id = $2`,
    [actor.companyId, fileId],
  );
  const f = rows[0];
  if (!f) throw new AppError("NOT_FOUND", 404, tr("err.files.khongTimThayTep"));
  await objectAccess(db, actor, f.object_type, f.object_id); // 404 nếu không còn quyền đọc
  const data = await getStorage().get(f.storage_key);
  if (createHash("sha256").update(data).digest("hex") !== f.sha256)
    throw new AppError("FILE_INTEGRITY", 500, tr("err.files.tepLuuTruKhongKhopDau"));
  return { mime: f.mime, name: f.original_name, sha256: f.sha256, data };
}

export async function addComment(
  tx: Queryable,
  actor: ActorContext,
  type: ObjectType,
  id: string,
  body: string,
): Promise<string> {
  const a = await objectAccess(tx, actor, type, id);
  // Bình luận: ai đọc được đối tượng thì bình luận được (trao đổi theo đối tượng — §4 P0).
  if (!a.canRead) throw new AppError("NOT_FOUND", 404, tr("err.files.khongTimThayDoiTuong"));
  const text = body.trim();
  if (text === "" || text.length > 4000)
    throw new AppError("VALIDATION", 422, tr("err.files.binhLuanTu1Den4"));
  const { rows } = await tx.query<{ id: string }>(
    "INSERT INTO comment (company_id, object_type, object_id, author_user_id, body) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [actor.companyId, type, id, actor.userId, text],
  );
  await appendAudit(tx, {
    actorUserId: actor.userId,
    companyId: actor.companyId,
    action: "comment.create",
    objectType: type,
    objectId: id,
  });
  return rows[0]!.id;
}

export async function listComments(
  db: Queryable,
  actor: ActorContext,
  type: ObjectType,
  id: string,
  page: PageRequest = MAX_PAGE,
) {
  await objectAccess(db, actor, type, id);
  const { rows } = await db.query<{
    id: string;
    author_user_id: string;
    display_name: string;
    body: string;
    created_at: Date;
  }>(
    `SELECT c.id, c.author_user_id, u.display_name, c.body, c.created_at FROM comment c JOIN app_user u ON u.id = c.author_user_id
     WHERE c.company_id = $1 AND c.object_type = $2 AND c.object_id = $3 ORDER BY c.created_at, c.id
     LIMIT $4 OFFSET $5`,
    [actor.companyId, type, id, fetchLimit(page), page.offset],
  );
  return toPage(rows, page);
}
