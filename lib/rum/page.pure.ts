// Chuẩn hoá đường dẫn trang → NHÃN CÓ SỐ GIÁ TRỊ BỊ CHẶN cho RUM (T-056, D-042). Mô-đun thuần: không import gì (ARC-MOD-003).
// Nhãn là thứ DUY NHẤT về "trang nào" được lưu/đưa lên metric: không id, không slug, không query → không dữ liệu cá nhân và
// số chuỗi nhãn Prometheus không phình (≤ 2 + |KNOWN_APP_SECTIONS| + 2 trang).

/** Tên thư mục con của `app/app/(secure)/` (mỗi tên = một phân hệ của webapp). tests/unit/rum-page.test.ts so khớp với hệ thống tệp. */
export const KNOWN_APP_SECTIONS: readonly string[] = [
  "approvals",
  "attendance",
  "dashboard",
  "me",
  "tasks",
  "thong-bao",
  "today",
] as const;

export const LABEL_HOME = "/";
export const LABEL_LOGIN = "/app/login";
export const LABEL_APP_OTHER = "/app/*";
export const LABEL_PUBLIC_OTHER = "/[...slug]";
/** Trần độ dài đường dẫn nhận vào (khớp RumInput.page). */
export const PAGE_MAX_LENGTH = 200;

// Không nhận: query/hash (client chỉ gửi pathname), khoảng trắng/ký tự điều khiển, gạch chéo ngược.
const BAD_CHARS = /[?#\\\s\u0000-\u001f\u007f]/u;

/**
 * Đường dẫn thật → nhãn trang. `null` = từ chối (không phải chuỗi, rỗng, quá dài, không bắt đầu bằng "/", có ký tự cấm,
 * có đoạn `.`/`..`/rỗng giữa đường dẫn). Dấu "/" cuối được bỏ.
 */
export function pageLabel(pathname: unknown): string | null {
  if (typeof pathname !== "string" || pathname.length === 0 || pathname.length > PAGE_MAX_LENGTH) return null;
  if (!pathname.startsWith("/") || BAD_CHARS.test(pathname)) return null;
  const parts = pathname.slice(1).split("/");
  if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop(); // "/a/" = "/a"
  if (parts.length > 1 || parts[0] !== "") {
    if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  }
  if (parts.length === 1 && parts[0] === "") return LABEL_HOME;
  if (parts[0] === "app") {
    const section = parts[1];
    if (section === "login") return LABEL_LOGIN;
    if (section !== undefined && KNOWN_APP_SECTIONS.includes(section)) return `/app/${section}`;
    return LABEL_APP_OTHER;
  }
  return LABEL_PUBLIC_OTHER;
}
