// check:i18n (XC-I18N-001): mọi chuỗi người dùng thấy nằm ở messages/vi.json, gọi qua t("khoá").
//  1. app/**/*.tsx: chữ cái trong văn bản JSX, hoặc chuỗi literal ở aria-label/placeholder/title/alt… → đỏ;
//  2. app/**/*.{ts,tsx}: chuỗi literal có dấu tiếng Việt (nhãn, thông báo) → đỏ (trừ đối số reportClientError — nhật ký DevTools);
//  3. khoá dùng trong mã (t("a.b")) không có trong vi.json, hoặc khoá động t(`a.${x}`) (không kiểm tĩnh được) → đỏ;
//  4. khoá vi.json thiếu mô tả ở vi.context.json, hoặc ngược lại → đỏ.
// Bỏ qua tường minh một dòng không phải chuỗi người dùng: comment `i18n-ignore: <lý do>` cùng dòng hoặc dòng ngay trên.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const LETTER = /\p{L}/u;
/** Chữ cái đặc trưng tiếng Việt (đã NFC): có dấu thanh hoặc ă â ê ô ơ ư đ. */
const VI =
  /[ăâđêôơưĂÂĐÊÔƠƯàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵÀÁẢÃẠẰẮẲẴẶẦẤẨẪẬÈÉẺẼẸỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌỒỐỔỖỘỜỚỞỠỢÙÚỦŨỤỪỨỬỮỰỲÝỶỸỴ]/u;
const TEXT_ATTRS = new Set([
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-roledescription",
  "aria-valuetext",
  "placeholder",
  "title",
  "alt",
]);
/** Tệp thông điệp nguồn (xem lib/i18n/client.ts): gộp sâu thành một cây khi kiểm. */
export const MESSAGE_FILES = ["vi.json", "vi.app.json", "vi.site.json", "vi.server.json"];
const IGNORE = /i18n-ignore:\s*\S/;
const T_NAMES = new Set(["t"]);
const LOG_CALLS = new Set(["reportClientError"]);

/** Mọi khoá lá `a.b.c` của cây thông điệp. */
export function flattenKeys(tree, prefix = "") {
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === "string" ? [prefix + k] : flattenKeys(v, `${prefix}${k}.`),
  );
}

/** vi.json (chuỗi client) + vi.server.json (chuỗi chỉ-server) gộp sâu; trùng khoá lá = lỗi. */
export function loadMessages(read) {
  const merge = (a, b, prefix = "") => {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) {
      const key = prefix + k;
      if (!(k in out)) out[k] = v;
      else if (typeof out[k] === "object" && typeof v === "object") out[k] = merge(out[k], v, `${key}.`);
      else throw new Error(`messages: khoá "${key}" có ở cả vi.json và vi.server.json`);
    }
    return out;
  };
  return MESSAGE_FILES.map(read).reduce((a, b) => merge(a, b));
}

/** Lá không phải chuỗi hoặc rỗng. */
export function badLeaves(tree, prefix = "") {
  return Object.entries(tree).flatMap(([k, v]) => {
    if (typeof v === "string") return v.trim() === "" ? [`${prefix}${k}`] : [];
    if (v !== null && typeof v === "object" && !Array.isArray(v)) return badLeaves(v, `${prefix}${k}.`);
    return [`${prefix}${k}`];
  });
}

/**
 * Quét một tệp. `jsxRules` bật luật JSX (tệp .tsx trong app/); luật dấu tiếng Việt chạy cho mọi tệp truyền vào.
 * Trả `{ violations: string[], keys: {key, line}[] }`.
 */
export function scanSource(file, src, { jsxRules = file.endsWith(".tsx"), literalRules = true } = {}) {
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines = src.split("\n");
  const violations = [];
  const keys = [];
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line;
  const ignored = (line) => IGNORE.test(lines[line] ?? "") || IGNORE.test(lines[line - 1] ?? "");
  const report = (pos, what) => {
    const line = lineOf(pos);
    if (!ignored(line)) violations.push(`${file}:${line + 1}: ${what}`);
  };
  const hasLetter = (s) => LETTER.test(s);
  const literalText = (n) =>
    ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
      ? n.text
      : ts.isTemplateExpression(n)
        ? [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join("")
        : null;

  const visit = (node) => {
    if (jsxRules && ts.isJsxText(node) && hasLetter(node.text)) {
      report(
        node.pos + Math.max(0, node.text.search(/\S/)),
        `chữ cứng trong JSX: "${node.text.trim().slice(0, 40)}"`,
      );
    }
    if (jsxRules && ts.isJsxAttribute(node) && TEXT_ATTRS.has(node.name.getText(sf)) && node.initializer) {
      const init = node.initializer;
      const lit = ts.isJsxExpression(init)
        ? init.expression
          ? literalText(init.expression)
          : null
        : literalText(init);
      if (lit !== null && hasLetter(lit))
        report(node.getStart(sf), `thuộc tính ${node.name.getText(sf)} là chuỗi cứng: "${lit.slice(0, 40)}"`);
    }
    if (jsxRules && ts.isJsxExpression(node) && node.expression && ts.isJsxElement(node.parent)) {
      const lit = literalText(node.expression);
      if (lit !== null && hasLetter(lit))
        report(node.getStart(sf), `chuỗi cứng trong JSX: "${lit.slice(0, 40)}"`);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && T_NAMES.has(node.expression.text)) {
      const a = node.arguments[0];
      const lit = a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a)) ? a.text : null;
      if (lit !== null) keys.push({ key: lit, line: lineOf(node.getStart(sf)) + 1 });
      else report(node.getStart(sf), "khoá t() không phải chuỗi cố định — không kiểm tĩnh được");
    }
    if (
      literalRules &&
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node))
    ) {
      const text = literalText(node)?.normalize("NFC") ?? "";
      const inLogCall =
        ts.isCallExpression(node.parent) &&
        ts.isIdentifier(node.parent.expression) &&
        LOG_CALLS.has(node.parent.expression.text);
      if (VI.test(text) && !inLogCall)
        report(node.getStart(sf), `chuỗi tiếng Việt cứng: "${text.slice(0, 40)}"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { violations, keys };
}

/** So khoá dùng ↔ vi.json ↔ vi.context.json. `used` = [{file, key, line}]. */
export function checkKeys({ messages, context, used }) {
  const errors = [];
  const have = new Set(flattenKeys(messages));
  const described = new Set(flattenKeys(context));
  for (const k of badLeaves(messages)) errors.push(`messages/vi.json: "${k}" rỗng hoặc không phải chuỗi`);
  for (const k of badLeaves(context))
    errors.push(`messages/vi.context.json: "${k}" rỗng hoặc không phải chuỗi`);
  for (const u of used)
    if (!have.has(u.key)) errors.push(`${u.file}:${u.line}: khoá "${u.key}" không có trong messages/vi.json`);
  for (const k of have)
    if (!described.has(k)) errors.push(`messages/vi.context.json: thiếu mô tả cho khoá "${k}"`);
  for (const k of described)
    if (!have.has(k)) errors.push(`messages/vi.context.json: khoá "${k}" không có trong messages/vi.json`);
  return errors;
}

function walk(p, acc) {
  if (!statSync(p, { throwIfNoEntry: false })) return acc;
  if (statSync(p).isDirectory()) {
    for (const e of readdirSync(p)) if (e !== "node_modules" && e !== ".next") walk(path.join(p, e), acc);
  } else if (/\.(ts|tsx)$/.test(p) && !/\.d\.ts$/.test(p)) acc.push(p);
  return acc;
}

/** Chạy toàn bộ kiểm tra trên cây `rootDir`; trả danh sách lỗi (rỗng = đạt) và khoá chưa dùng (cảnh báo). */
export function check(rootDir = root) {
  const rel = (f) => path.relative(rootDir, f).split(path.sep).join("/");
  const errors = [];
  const used = [];
  for (const f of walk(path.join(rootDir, "app"), [])) {
    const r = scanSource(rel(f), readFileSync(f, "utf8"));
    errors.push(...r.violations);
    used.push(...r.keys.map((k) => ({ file: rel(f), ...k })));
  }
  for (const f of walk(path.join(rootDir, "lib"), [])) {
    if (rel(f) === "lib/i18n/index.ts") continue;
    const r = scanSource(rel(f), readFileSync(f, "utf8"), { jsxRules: false, literalRules: false });
    errors.push(...r.violations);
    used.push(...r.keys.map((k) => ({ file: rel(f), ...k })));
  }
  const read = (f) => {
    try {
      return JSON.parse(readFileSync(path.join(rootDir, "messages", f), "utf8"));
    } catch (e) {
      if (e?.code === "ENOENT" && f !== "vi.json" && f !== "vi.context.json") return {}; // tệp nhóm tuỳ chọn
      throw e;
    }
  };
  const messages = loadMessages(read);
  const context = read("vi.context.json");
  errors.push(...checkKeys({ messages, context, used }));
  const usedKeys = new Set(used.map((u) => u.key));
  const unused = flattenKeys(messages).filter((k) => !usedKeys.has(k));
  return { errors, unused };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { errors, unused } = check();
  if (unused.length > 0)
    console.warn(`check:i18n: ${unused.length} khoá chưa dùng (cân nhắc xoá): ${unused.join(", ")}`);
  if (errors.length > 0) {
    console.error(
      `check:i18n — ${errors.length} lỗi (chuỗi người dùng phải ở messages/vi.json):\n  ${errors.join("\n  ")}`,
    );
    process.exit(1);
  }
  console.log("check:i18n: OK");
}
