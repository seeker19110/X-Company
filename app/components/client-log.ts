// Báo lỗi không chặn luồng ở phía trình duyệt (logger JSON của server dùng Node API nên không chạy ở client).
// Đây là NƠI DUY NHẤT ở app/ được gọi console — lỗi không bị nuốt (BASE-ERR-001) mà vẫn lộ ở DevTools.
// Đồng thời gửi về kho lỗi tự host (T-122, PRF-WEB-008): POST /api/public/errors, gắn release của trang (ErrorReporter đặt). Chỉ gửi
// loại lỗi, thông điệp, khung stack, pathname và ngữ cảnh — server che bí mật/PII, chuẩn hoá trang; không cookie/định danh.
import { API_FETCH_TIMEOUT_MS } from "@/lib/nen/timeouts";

const ENDPOINT = "/api/public/errors";
/** Trần mỗi tài liệu (lần tải trang): vòng lặp lỗi không bắn vô hạn beacon; lỗi trùng (cùng loại/thông điệp/ngữ cảnh) gửi một lần. */
const MAX_REPORTS = 10;
/** Khớp trần phía server (lib/errors): cắt trước khi gửi để beacon không bị từ chối cả gói. */
const MAX_MESSAGE = 1_000;
const MAX_STACK = 8_000;
const MAX_TYPE = 100;
const MAX_CONTEXT = 200;
const MAX_PAGE = 200;

let release: string | null = null;
let sent = 0;
const seen = new Set<string>();

/** Mã phiên bản build của trang (server render). Chưa đặt → chỉ ghi DevTools, không gửi. */
export function setErrorRelease(r: string): void {
  release = r;
}

function describe(err: unknown): { type: string; message: string; stack?: string } {
  if (err instanceof Error)
    return { type: err.name !== "" ? err.name : "Error", message: err.message, stack: err.stack };
  return { type: typeof err, message: typeof err === "string" ? err : "" };
}

function devtools(line: string): void {
  // eslint-disable-next-line no-console -- kênh báo lỗi duy nhất ở client (không có logger Node ở trình duyệt)
  console.warn(line);
}

/** Gửi một lỗi về kho lỗi (best-effort, không ném, không gọi lại chính nó khi gửi hỏng). */
export function sendClientError(context: string | null, err: unknown): void {
  try {
    if (release === null || sent >= MAX_REPORTS || typeof navigator === "undefined") return;
    const d = describe(err);
    const key = `${d.type}|${d.message}|${context ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    sent += 1;
    const page = location.pathname.slice(0, MAX_PAGE);
    const type = d.type.slice(0, MAX_TYPE);
    const body = JSON.stringify({
      release,
      page: page !== "" ? page : "/",
      type: type !== "" ? type : "Error",
      message: d.message.slice(0, MAX_MESSAGE),
      ...(d.stack !== undefined && d.stack !== "" ? { stack: d.stack.slice(0, MAX_STACK) } : {}),
      ...(context !== null && context !== "" ? { context: context.slice(0, MAX_CONTEXT) } : {}),
    });
    const blob = new Blob([body], { type: "application/json" });
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ENDPOINT, blob)) return;
    void fetch(ENDPOINT, {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      keepalive: true,
      credentials: "same-origin",
      signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS),
    }).catch((e: unknown) => devtools(`[client] error beacon: ${String(e)}`)); // chỉ DevTools — không gửi lại (tránh vòng lặp)
  } catch {
    /* gửi lỗi là best-effort */
  }
}

/** Chỉ ghi ngữ cảnh + tên/mô tả lỗi ra DevTools; gửi bản đầy đủ (đã cắt) về kho lỗi tự host. */
export function reportClientError(context: string, err: unknown): void {
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  devtools(`[client] ${context}: ${detail}`);
  sendClientError(context, err);
}
