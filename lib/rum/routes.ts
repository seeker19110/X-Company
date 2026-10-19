// Route: POST /api/public/rum (công khai, cờ RUM_ENABLED). Beacon web-vitals của trình duyệt: cùng nguồn, ≤ 2 KiB, giới hạn
// tần suất theo IP (băm), trả 204. Chỉ lưu nhãn trang đã chuẩn hoá — không IP/UA (T-056, D-042).
import { getPool } from "../db/index.ts";
import { assertSameOrigin, clientIp, publicRoute, readJson } from "../http/index.ts";
import { t } from "../i18n/index.ts";
import { checkRate } from "../inquiry/index.ts";
import { AppError } from "../nen/app-error.ts";
import { env } from "../nen/env.ts";
import { kb } from "../nen/units.ts";
import { insertRumSamples, pageLabel, RUM_RATE_LIMIT, RumInput } from "./index.ts";

export const RUM_BODY_MAX_BYTES = kb(2);

export const postRum = publicRoute(async ({ req }) => {
  // Cờ tắt → như không tồn tại (không lộ endpoint, không ghi gì, không tính tần suất).
  if (!env("RUM_ENABLED")) throw new AppError("NOT_FOUND", 404, t("err.rum.khongTimThay"));
  assertSameOrigin(req);
  await checkRate(getPool(), "rum", clientIp(req), new Date(), RUM_RATE_LIMIT);
  const input = RumInput.parse(await readJson(req, RUM_BODY_MAX_BYTES));
  const page = pageLabel(input.page);
  if (page === null) throw new AppError("VALIDATION", 400, t("err.rum.trangKhongHopLe"));
  await insertRumSamples(getPool(), page, input.nav ?? null, input.metrics);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
});
