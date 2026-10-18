// Tắt êm khi nhận SIGTERM/SIGINT (ARC-RES-009, BE-REL-004): readiness → 503 ngay; sau SHUTDOWN_READY_DELAY_MS (mặc định
// 2 s, để bộ cân bằng tải kịp thấy 503 và rút thực thể) mới ngừng nhận kết nối; chờ request đang chạy tối đa
// SHUTDOWN_GRACE_MS (mặc định 20 s); đóng pool DB (≤ 5 s); thoát 0. Tổng ≤ 27 s < grace 30 s của orchestrator.
// Next tự thoát ngay khi nhận SIGTERM trừ khi đặt NEXT_MANUAL_SIG_HANDLE=true — đã đặt trong script `start` của package.json.
// Lib không import `next/*`: instrumentation.ts chỉ gọi `registerShutdown()`.
import http, { type Server, type ServerResponse } from "node:http";
import { closePool } from "../db/index.ts";

export interface ShutdownDeps {
  graceMs: number;
  /** Thời gian vẫn nhận kết nối sau khi readiness đã 503. */
  readyDelayMs: number;
  closePool: () => Promise<void>;
  exit: (code: number) => void;
  log: (msg: string) => void;
}

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const defaultGraceMs = (): number => envMs("SHUTDOWN_GRACE_MS", 20_000);
export const defaultReadyDelayMs = (): number => envMs("SHUTDOWN_READY_DELAY_MS", 2_000);

export class ShutdownController {
  private inflight = 0;
  private readonly servers = new Set<Server>();
  private shuttingDown = false;
  private done: Promise<void> | null = null;
  private onDrained: (() => void) | null = null;

  constructor(private readonly deps: ShutdownDeps) {}

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  inflightCount(): number {
    return this.inflight;
  }

  /** Theo dõi một server http: đếm request đang chạy (đăng ký trước handler của ứng dụng). */
  attach(server: Server): void {
    this.servers.add(server);
    server.on("request", (_req, res) => this.onRequest(res));
  }

  trackServer(server: Server): void {
    this.servers.add(server);
  }

  /** Đếm một request cho tới khi kết nối phản hồi đóng (xong hoặc client bỏ). */
  onRequest(res: ServerResponse): void {
    this.inflight++;
    // Khi đang tắt: báo client đóng kết nối keep-alive để lần sau tới thực thể khác.
    if (this.shuttingDown && !res.headersSent) res.setHeader("connection", "close");
    let counted = true;
    res.once("close", () => {
      if (!counted) return;
      counted = false;
      this.inflight--;
      if (this.shuttingDown) for (const s of this.servers) s.closeIdleConnections?.();
      if (this.inflight === 0) this.onDrained?.();
    });
  }

  /** Bắt đầu tắt (idempotent): trả Promise xong khi đã chờ hết request (hoặc hết grace) và đóng pool. */
  begin(): Promise<void> {
    if (this.done) return this.done;
    this.shuttingDown = true;
    this.done = (async () => {
      if (this.deps.readyDelayMs > 0) await new Promise((r) => setTimeout(r, this.deps.readyDelayMs));
      for (const s of this.servers) {
        s.close(() => {}); // ngừng nhận kết nối mới; lỗi "server chưa chạy" bỏ qua
        s.closeIdleConnections?.();
      }
      await this.waitDrain();
      // pool.end() chờ mọi kết nối được trả — request bị cắt có thể không bao giờ trả → giới hạn thời gian đóng.
      let timer: NodeJS.Timeout | undefined;
      const cap = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5_000);
        timer.unref();
      });
      await Promise.race([
        this.deps.closePool().catch((err: unknown) => {
          this.deps.log(`[shutdown] đóng pool lỗi: ${err instanceof Error ? err.message : String(err)}`);
        }),
        cap,
      ]);
      clearTimeout(timer);
    })();
    return this.done;
  }

  private waitDrain(): Promise<void> {
    return new Promise((resolve) => {
      if (this.inflight === 0) return resolve();
      const timer = setTimeout(() => {
        this.onDrained = null;
        this.deps.log(`[shutdown] hết ${this.deps.graceMs} ms, còn ${this.inflight} request đang chạy — cắt`);
        resolve();
      }, this.deps.graceMs);
      this.onDrained = () => {
        clearTimeout(timer);
        this.onDrained = null;
        resolve();
      };
    });
  }

  /** Tắt rồi thoát tiến trình: 0 khi êm, 1 khi bước tắt ném lỗi ngoài dự kiến. */
  async shutdownAndExit(signal: string): Promise<void> {
    this.deps.log(`[shutdown] nhận ${signal}: ngừng nhận request mới, chờ request đang chạy`);
    try {
      await this.begin();
      this.deps.exit(0);
    } catch (err) {
      this.deps.log(`[shutdown] lỗi: ${err instanceof Error ? err.message : String(err)}`);
      this.deps.exit(1);
    }
  }
}

const processDeps = (): ShutdownDeps => ({
  graceMs: defaultGraceMs(),
  readyDelayMs: defaultReadyDelayMs(),
  closePool,
  exit: (code) => process.exit(code),
  log: (msg) => console.error(msg),
});

let current: ShutdownController | undefined;
/** Bộ điều khiển của tiến trình (readiness đọc trạng thái từ đây). */
export function shutdownController(): ShutdownController {
  current ??= new ShutdownController(processDeps());
  return current;
}

/** Chỉ test: thay/bỏ bộ điều khiển của tiến trình. */
export function setShutdownControllerForTest(ctl: ShutdownController | undefined): void {
  current = ctl;
}

export function isShuttingDown(): boolean {
  return current?.isShuttingDown() ?? false;
}

let registered = false;
/** Gọi một lần từ instrumentation (runtime nodejs): đếm request qua mọi http.Server và bắt SIGTERM/SIGINT. */
export function registerShutdown(): void {
  if (registered) return;
  registered = true;
  const ctl = shutdownController();
  const orig = http.Server.prototype.emit;
  http.Server.prototype.emit = function (this: Server, event: string | symbol, ...args: unknown[]) {
    if (event === "request") {
      ctl.trackServer(this);
      ctl.onRequest(args[1] as ServerResponse);
    }
    return (orig as (...a: unknown[]) => boolean).call(this, event, ...args);
  } as typeof orig;
  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => void ctl.shutdownAndExit(sig));
  }
}
