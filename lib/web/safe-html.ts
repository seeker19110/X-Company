// MỘT module duy nhất sinh HTML cho DOM sink (FE-SEC-001/002, SEC-WEB-004, THREAT-MODEL T8): markdown-it `html:false`
// (thẻ HTML thô bị escape) + mọi liên kết/ảnh đi qua `safeUrl()` (allowlist scheme). Trang chỉ được đưa vào
// DOM sink của React chuỗi lấy từ `renderSafeHtml()` (test tests/unit/safe-html.test.ts khoá danh sách tệp dùng sink).
import MarkdownIt from "markdown-it";

const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "tel"]);

const NAMED_ENTITIES: Record<string, string> = {
  colon: ":",
  tab: "\t",
  newline: "\n",
  sol: "/",
  bsol: "\\",
  lpar: "(",
  rpar: ")",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u{a0}",
};

/** Giải mã entity HTML số/tên thông dụng — trình duyệt giải mã chúng trước khi xét scheme, nên ta xét bản đã giải mã. */
function decodeEntities(s: string): string {
  return s.replace(
    /&(?:#x([0-9a-f]{1,6})|#(\d{1,7})|([a-z]{2,8}));?/gi,
    (m, hex?: string, dec?: string, name?: string) => {
      const code = hex !== undefined ? parseInt(hex, 16) : dec !== undefined ? parseInt(dec, 10) : NaN;
      if (!Number.isNaN(code)) return code > 0x10ffff ? "" : String.fromCodePoint(code);
      return NAMED_ENTITIES[(name ?? "").toLowerCase()] ?? m;
    },
  );
}

// Trình duyệt bỏ các ký tự này khi tách scheme: điều khiển C0/C1, khoảng trắng, soft hyphen, ký tự rộng bằng 0, BOM.
const STRIPPED = /[\x00-\x20\x7f-\x9f\u{ad}\u{200b}-\u{200f}\u{2028}\u{2029}\u{2060}\u{feff}]/gu;

/**
 * URL từ dữ liệu ngoài → chuỗi an toàn để gắn vào `href`/`src`, hoặc `null`.
 * Cho: http(s), mailto, tel, đường dẫn tương đối (`/x`, `x/y`, `#neo`, `?q`). Từ chối mọi scheme khác (javascript, data,
 * vbscript, file…), URL tương đối theo giao thức (`//host`, `/\host`), chuỗi rỗng, và các cách lách bằng chữ hoa,
 * khoảng trắng/ký tự điều khiển chen giữa, entity HTML, mã hoá %.
 */
export function safeUrl(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (raw === "" || raw.length > 2048) return null;
  // Giải entity (có thể lồng), bỏ ký tự bị trình duyệt bỏ, hạ chữ thường — rồi xét cả dạng giải mã %.
  let seen = raw;
  for (let i = 0; i < 3; i++) {
    const next = decodeEntities(seen);
    if (next === seen) break;
    seen = next;
  }
  const flat = seen.replace(STRIPPED, "").toLowerCase();
  let decoded: string;
  try {
    decoded = decodeURIComponent(flat);
  } catch {
    return null; // % sai định dạng → không tin
  }
  for (const form of new Set([flat, decoded.replace(STRIPPED, "")])) {
    const m = /^([a-z][a-z0-9+.-]*):/.exec(form);
    if (m) {
      if (!ALLOWED_SCHEMES.has(m[1]!)) return null;
    } else if (form.startsWith("//") || form.startsWith("/\\") || form.startsWith("\\")) {
      return null;
    }
  }
  return raw;
}

const md = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });
// Thay validateLink mặc định (blocklist) bằng allowlist; ảnh cũng chỉ nhận cùng tập scheme (không còn data:image).
md.validateLink = (url) => safeUrl(url) !== null;

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx]!.attrGet("href") ?? "";
  if (/^https?:\/\//i.test(href)) tokens[idx]!.attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
};

/** Markdown → HTML an toàn để đưa vào DOM sink. */
export function renderSafeHtml(source: string): string {
  return md.render(source);
}

/** Cây token của cùng trình phân tích (cho lint nội dung); không sinh HTML. */
export function parseMarkdown(source: string) {
  return md.parse(source, {});
}
