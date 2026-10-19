// Chạy một lần khi server Next khởi động. Chỉ đăng ký ở runtime Node (Edge không có process/http của Node).
// `process.env.NEXT_RUNTIME` viết thẳng là hằng biên dịch của Next (loại mã Node khỏi bundle edge) — ngoại lệ duy nhất
// của scripts/check-env.ts ngoài lib/nen/env.ts. Mọi import nặng nằm sau nhánh nodejs.
import type { Instrumentation } from "next";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startup } = await import("./lib/nen/startup.ts");
    startup(); // kiểm cấu hình lúc khởi động: thiếu/sai → thoát ≠ 0 (BASE-CFG-002)
    const { env } = await import("./lib/nen/env.ts");
    if (env("NEXT_PHASE") !== "phase-production-build") {
      const { registerKms } = await import("./adapters/register-kms.ts");
      registerKms(); // KMS_PROVIDER=transit: kiểm cấu hình (sai → thoát 78) + đăng ký transport KMS (T-052)
    }
    const { registerShutdown } = await import("./lib/nen/shutdown.ts");
    registerShutdown(); // SIGTERM → readiness 503, chờ request đang chạy, đóng pool, thoát 0 (ARC-RES-009)
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { log } = await import("./lib/nen/log.ts");
  log.error("lỗi chưa bắt khi xử lý request", {
    err,
    method: request.method,
    path: request.path.split("?")[0], // bỏ query: có thể chứa token
    route_path: context.routePath,
    route_type: context.routeType,
    router_kind: context.routerKind,
    render_source: context.renderSource,
  });
};
