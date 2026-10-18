// Route: POST /api/app/files (multipart), GET /api/app/files/:id, GET|POST /api/app/comments.
import { z } from "zod";
import { getPool, withTx } from "../db/index.ts";
import { json, readJson, withActor } from "../http/index.ts";
import { AppError } from "../nen/app-error.ts";
import { parsePage } from "../nen/pagination.ts";
import {
  addComment,
  downloadFile,
  listComments,
  MAX_FILE_BYTES,
  OBJECT_TYPES,
  uploadFile,
  type ObjectType,
} from "./index.ts";
import { kb } from "../nen/units.ts";
import { t } from "../i18n/index.ts";

// BE-REL-006: route đắt (tải tệp: băm/quét/ghi đĩa; bình luận: ghi + audit) giới hạn theo user_id, đếm ở DB.
// 60 lượt/phút/người cho mỗi nhóm: cao hơn thao tác tay bình thường, thấp hơn mức một script lặp có thể làm.
const FILE_LIMIT = { bucket: "files.post", max: 60, windowSec: 60 };
const COMMENT_LIMIT = { bucket: "comments.post", max: 60, windowSec: 60 };

/** Tham chiếu đối tượng (query/thân) — xuất ra cho hợp đồng OpenAPI. */
export const ObjectRef = z.object({
  object_type: z.enum(OBJECT_TYPES as [ObjectType, ...ObjectType[]]),
  object_id: z.uuid(),
});

export const postFile = withActor(
  async (ctx) => {
    const len = Number(ctx.req.headers.get("content-length") ?? "0");
    if (len > MAX_FILE_BYTES + kb(64))
      throw new AppError("PAYLOAD_TOO_LARGE", 413, t("err.files.tepVuot20Mb"));
    let form: FormData;
    try {
      form = await ctx.req.formData();
    } catch {
      throw new AppError("BAD_FORM", 400, t("err.shared.canMultipartFormData"));
    }
    const ref = ObjectRef.parse({ object_type: form.get("object_type"), object_id: form.get("object_id") });
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("VALIDATION", 422, t("err.files.thieuTep"));
    const documentId = form.get("document_id");
    const r = await uploadFile(
      getPool(),
      ctx.actor,
      {
        objectType: ref.object_type,
        objectId: ref.object_id,
        documentId: typeof documentId === "string" && documentId !== "" ? z.uuid().parse(documentId) : null,
        title: typeof form.get("title") === "string" ? (form.get("title") as string) : null,
        originalName: file.name,
        data: Buffer.from(await file.arrayBuffer()),
      },
      ctx.requestId,
    );
    return json(
      { document_id: r.documentId, version: r.version, file_id: r.fileId, mime: r.mime, sha256: r.sha256 },
      201,
    );
  },
  { idempotent: true, rateLimit: FILE_LIMIT },
);

export const getFile = withActor(async (ctx) => {
  const id = new URL(ctx.req.url).pathname.split("/").pop() ?? "";
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND", 404, t("err.files.khongTimThayTep"));
  const f = await downloadFile(getPool(), ctx.actor, id);
  return new Response(new Uint8Array(f.data), {
    status: 200,
    headers: {
      "content-type": f.mime,
      "content-length": String(f.data.length),
      // Luôn tải về (không hiển thị trong trang), tên mã hoá RFC 5987; không cache; không đoán kiểu.
      "content-disposition": `attachment; filename="tep"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      etag: `"${f.sha256}"`,
    },
  });
});

export const getComments = withActor(async (ctx) => {
  const u = new URL(ctx.req.url);
  const ref = ObjectRef.parse({
    object_type: u.searchParams.get("object_type"),
    object_id: u.searchParams.get("object_id"),
  });
  const page = parsePage(u.searchParams);
  return json(await listComments(getPool(), ctx.actor, ref.object_type, ref.object_id, page));
});

export const postComment = withActor(
  async (ctx) => {
    const b = ObjectRef.extend({ body: z.string().max(4000) }).parse(await readJson(ctx.req, kb(16)));
    const id = await withTx((tx) => addComment(tx, ctx.actor, b.object_type, b.object_id, b.body));
    return json({ id }, 201);
  },
  { idempotent: true, rateLimit: COMMENT_LIMIT },
);
