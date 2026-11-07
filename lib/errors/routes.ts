// Route kho lỗi (T-122, PRF-WEB-008):
//  - POST /api/public/errors (công khai): beacon lỗi của trình duyệt — cùng nguồn, ≤ 16 KiB, giới hạn tần suất theo IP băm (nhóm
//    'errors'), schema chặt; trả 204. Chỉ lưu nhãn trang đã chuẩn hoá, thông điệp/stack đã che — không IP/UA (như RUM, T-056).
//  - GET /api/app/errors (nội bộ): danh sách nhóm lỗi, quyền `errors.read` (sysadmin) kiểm ở server; từ chối → audit denied + 403.
import { getPool } from "../db/index.ts";
import {
  assertSameOrigin,
  authorize,
  clientIp,
  json,
  publicRoute,
  readJson,
  withActor,
} from "../http/index.ts";
import { t } from "../i18n/index.ts";
import { checkRate } from "../inquiry/index.ts";
import { AppError } from "../nen/app-error.ts";
import { fetchLimit, parsePage, toPage } from "../nen/pagination.ts";
import { kb } from "../nen/units.ts";
import { pageLabel } from "../rum/page.pure.ts";
import {
  ClientErrorInput,
  ERROR_RATE_LIMIT,
  ERROR_SOURCES,
  type ErrorSource,
  listErrorGroups,
  RELEASE_RE,
  recordError,
} from "./index.ts";

export const ERROR_BODY_MAX_BYTES = kb(16);

export const postClientError = publicRoute(async ({ req }) => {
  assertSameOrigin(req);
  try {
    await checkRate(getPool(), "errors", clientIp(req), new Date(), ERROR_RATE_LIMIT);
  } catch (err) {
    // Giữ mã 429 + retryAfter của checkRate, thay thông điệp (checkRate dùng chuỗi của biểu mẫu liên hệ).
    if (err instanceof AppError && err.code === "RATE_LIMITED")
      throw new AppError("RATE_LIMITED", 429, t("err.errors.guiQuaNhieu"), err.details);
    throw err;
  }
  const input = ClientErrorInput.parse(await readJson(req, ERROR_BODY_MAX_BYTES));
  const page = pageLabel(input.page);
  if (page === null) throw new AppError("VALIDATION", 400, t("err.errors.trangKhongHopLe"));
  await recordError(getPool(), {
    source: "client",
    release: input.release,
    type: input.type,
    message: input.message,
    stack: input.stack ?? null,
    page,
    context: input.context ?? null,
  });
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
});

export const getErrorGroups = withActor(async (ctx) => {
  await authorize(ctx, "errors.read", { companyId: ctx.actor.companyId }, { type: "error_group" });
  const params = new URL(ctx.req.url).searchParams;
  const page = parsePage(params);
  const source = params.get("source");
  const release = params.get("release");
  if (source !== null && !(ERROR_SOURCES as readonly string[]).includes(source))
    throw new AppError("VALIDATION", 400, t("err.errors.nguonKhongHopLe"));
  if (release !== null && !RELEASE_RE.test(release))
    throw new AppError("VALIDATION", 400, t("err.errors.releaseKhongHopLe"));
  const rows = await listErrorGroups(
    getPool(),
    { source: (source as ErrorSource | null) ?? undefined, release: release ?? undefined },
    page,
    fetchLimit(page),
  );
  return json(toPage(rows, page));
});
