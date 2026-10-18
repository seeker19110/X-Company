// Kiểm khi khởi động (BASE-CFG-002, FE-BUILD-005): parse toàn bộ env; thiếu/sai → in TÊN biến ra stderr rồi thoát ≠ 0.
// Gọi từ instrumentation.ts (runtime nodejs). Cũng cài bắt lỗi toàn cục của tiến trình (BASE-ERR-002).
import { EnvError, env, formatEnvIssues, loadEnv, maskedEnv } from "./env.ts";
import { log, type Logger } from "./log.ts";

/** Mã thoát khi cấu hình sai (EX_CONFIG của sysexits). */
export const EXIT_CONFIG = 78;

/**
 * Trả cấu hình đã che bí mật nếu hợp lệ; ngược lại ghi stderr (chỉ tên biến + lý do chung) + log FATAL rồi gọi `exit`.
 * `exit` tiêm được để test.
 */
export function assertEnvOrExit(
  source?: Record<string, string | undefined>,
  exit: (code: number) => never = (code) => process.exit(code),
  logger: Logger = log,
): Record<string, unknown> {
  try {
    const cfg = maskedEnv(loadEnv(source));
    logger.info("cấu hình hiệu lực (đã che bí mật)", { config: cfg });
    return cfg;
  } catch (err) {
    if (err instanceof EnvError) {
      process.stderr.write(`[khởi động] ${formatEnvIssues(err.issues)}\n`);
      logger.fatal("cấu hình môi trường không hợp lệ", { variables: err.issues.map((i) => i.name) });
      return exit(EXIT_CONFIG);
    }
    throw err;
  }
}

let handlersInstalled = false;

/** unhandledRejection → log ERROR (tiến trình tiếp tục); uncaughtException → log FATAL rồi thoát 1. */
export function installProcessHandlers(
  logger: Logger = log,
  proc: Pick<NodeJS.Process, "on" | "exit"> = process,
): void {
  if (proc === process) {
    if (handlersInstalled) return;
    handlersInstalled = true;
  }
  proc.on("unhandledRejection", (reason) => {
    logger.error("promise bị từ chối mà không ai bắt", { err: reason });
  });
  proc.on("uncaughtException", (err) => {
    logger.fatal("lỗi chưa bắt — tiến trình dừng", { err });
    proc.exit(1);
  });
}

/** Điểm vào cho instrumentation.register: bỏ qua pha build (build không có bí mật runtime). */
export function startup(): void {
  if (env("NEXT_PHASE") === "phase-production-build") return;
  assertEnvOrExit();
  installProcessHandlers();
}
