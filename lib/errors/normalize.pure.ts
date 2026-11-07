// Chuẩn hoá stack/thông điệp lỗi cho kho lỗi tự host (T-122, PRF-WEB-008). Mô-đun thuần: không import gì (ARC-MOD-003), dùng ở
// lib/errors (server), scripts/ và test. Che bí mật/PII KHÔNG nằm ở đây (redactString của lib/nen/log.ts, chạy ở index.ts).
//
// Mục tiêu: (1) bỏ phần thay đổi theo máy/người dùng khỏi dòng khung (origin, query/hash, đường dẫn tuyệt đối trên máy chủ) để
// cùng một chỗ lỗi cho cùng fingerprint; (2) GIỮ `dòng:cột` vì mã đã rút gọn nằm trên một dòng — cần để giải bằng source map.

/** Trần độ dài (khớp CHECK của error_group, migration 0034). */
export const ERROR_TYPE_MAX = 100;
export const ERROR_MESSAGE_MAX = 1000;
export const ERROR_STACK_MAX = 8000;
export const ERROR_CONTEXT_MAX = 200;
/** Số dòng khung giữ lại; một dòng khung tối đa chừng này ký tự. */
export const STACK_MAX_FRAMES = 30;
export const FRAME_MAX = 300;
/** Mã phiên bản build hợp lệ (khớp CHECK error_group.release). */
// Tên toàn dấu chấm (".", "..") bị cấm: thư mục source map theo release sẽ trỏ ra thư mục cha (review #100).
export const RELEASE_RE = /^(?!\.+$)[A-Za-z0-9._+-]{1,64}$/;

// V8 (Chrome, Edge, Node): "    at fn (url:1:2)" · Gecko/WebKit (Firefox, Safari): "fn@url:1:2".
const V8_FRAME = /^\s*at\s+\S/;
const GECKO_FRAME = /@\S*:\d+:\d+\s*$/;

/** Dòng có phải dòng khung stack không (dòng đầu "TypeError: …" của V8 chứa thông điệp → không phải khung). */
export function isFrame(line: string): boolean {
  return V8_FRAME.test(line) || GECKO_FRAME.test(line);
}

/**
 * Chuẩn hoá MỘT dòng khung: bỏ "at ", bỏ scheme + host (`https://x:3000/_next/…` → `/_next/…`, `file:///srv/…` → `/srv/…`),
 * bỏ query/hash trước `:dòng:cột`, cắt đường dẫn tuyệt đối trên máy chủ về từ `/.next/`, `/_next/` hoặc `/node_modules/`,
 * bỏ tiền tố `root` (thư mục dự án) nếu có, gộp khoảng trắng, cắt FRAME_MAX.
 */
export function normalizeFrame(line: string, root?: string): string {
  let s = line.trim().replace(/^at\s+/, "");
  s = s.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^/\s()]*(?=\/)/gi, "");
  s = s.replace(/[?#][^\s()]*?(?=:\d+:\d+)/g, "");
  if (root !== undefined && root.length > 1) s = s.split(root.replace(/\/+$/, "")).join("");
  s = s.replace(/(^|[\s(@])\/[^\s()@]*?\/(\.next|_next|node_modules)\//g, "$1/$2/");
  return s.replace(/\s+/g, " ").slice(0, FRAME_MAX);
}

/** Các dòng khung đã chuẩn hoá (bỏ dòng thông điệp và dòng rác), tối đa STACK_MAX_FRAMES. */
export function normalizeStack(stack: string | null | undefined, root?: string): string[] {
  if (typeof stack !== "string" || stack === "") return [];
  const out: string[] = [];
  for (const line of stack.split(/\r?\n/)) {
    if (out.length >= STACK_MAX_FRAMES) break;
    if (!isFrame(line)) continue;
    const f = normalizeFrame(line, root);
    if (f !== "") out.push(f);
  }
  return out;
}

/**
 * Thông điệp → dạng dùng để gom nhóm khi KHÔNG có khung stack: số → "0", chuỗi hex dài/UUID → "x" (giá trị đổi theo lần chạy
 * không được đẻ thêm nhóm), gộp khoảng trắng, cắt 200 ký tự.
 */
export function messageShape(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "x")
    .replace(/\b[0-9a-f]{8,}\b/gi, "x")
    .replace(/\d+/g, "0")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Chuỗi đầu vào của fingerprint (băm sha256 ở index.ts): nguồn + loại lỗi + khung đầu đã chuẩn hoá; không có khung thì dùng
 * dạng thông điệp. Ngữ cảnh (nơi gọi reportClientError) tách nhóm giữa các chỗ báo khác nhau. Release KHÔNG nằm trong đây —
 * khoá duy nhất là (fingerprint, release).
 */
export function fingerprintInput(p: {
  source: string;
  type: string;
  frames: readonly string[];
  message: string;
  context?: string | null;
}): string {
  const top = p.frames[0];
  return [
    p.source,
    p.type,
    top ?? "",
    top === undefined ? messageShape(p.message) : "",
    p.context ?? "",
  ].join("\n");
}

/** Mã phiên bản build → dạng hợp lệ (ký tự lạ → "-", rỗng → "dev"). */
export function safeRelease(raw: string | null | undefined): string {
  const s = (raw ?? "").replace(/[^A-Za-z0-9._+-]/g, "-").slice(0, 64);
  return s === "" || /^\.+$/.test(s) ? "dev" : s;
}
