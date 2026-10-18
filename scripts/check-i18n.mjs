// check:i18n (XC-I18N-001): mọi chuỗi người dùng thấy nằm ở messages/vi.json, gọi qua t("khoá").
//  1. app/**/*.tsx: chữ cái trong văn bản JSX, hoặc chuỗi literal ở aria-label/placeholder/title/alt… → đỏ;
//  2. app/**/*.{ts,tsx} và lib/**/*.ts: chuỗi literal có dấu tiếng Việt (nhãn, thông báo, tóm tắt) → đỏ. Miễn: comment, đối số
//     reportClientError (nhật ký DevTools), lời gọi nhật ký log.*/logger.* và `new <X>Error(...)` trừ AppError (thông điệp cho lập trình viên/vận hành —
//     AppError mới là loại lỗi tới người dùng, nên đối số của nó KHÔNG được miễn);
//  3. khoá dùng trong mã (t("a.b")) không có trong vi.json, hoặc khoá động t(`a.${x}`) (không kiểm tĩnh được) → đỏ;
//  4. khoá vi.json thiếu mô tả ở vi.context.json, hoặc ngược lại → đỏ.
// Bỏ qua tường minh một dòng không phải chuỗi người dùng: comment `i18n-ignore: <lý do>` cùng dòng hoặc dòng ngay trên;
// cả tệp là đầu ra cho vận hành: `i18n-ignore-file: <lý do>` trong 15 dòng đầu (chỉ tắt luật literal, khoá t() vẫn kiểm).
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
const IGNORE = /i18n-ignore:[ \t]*\S/;
/** `i18n-ignore-file: <lý do>` trong 15 dòng đầu: cả tệp là đầu ra cho vận hành (không tới người dùng) — tắt luật literal tiếng Việt. */
const IGNORE_FILE = /i18n-ignore-file:[ \t]*\S/;
const T_NAMES = new Set(["t"]);
const LOG_CALLS = new Set(["reportClientError"]);
const LOG_OBJECTS = new Set(["log", "logger"]);
/** Mô-đun i18n mà `import { t as <bí danh> }` được coi là hàm dịch (tệp có biến cục bộ tên `t` phải đặt bí danh). */
const I18N_MODULE = /(^|\/)i18n\/(index|client|client-app|client-site)(\.ts)?$/;

/** Lời gọi cho lập trình viên/vận hành: reportClientError(...), log.<mức>(...), logger.<mức>(...), logger[mức](...), new <X>Error(...). */
function isDevFacingCall(n) {
  if (ts.isNewExpression(n))
    return (
      ts.isIdentifier(n.expression) && /Error$/.test(n.expression.text) && n.expression.text !== "AppError"
    );
  if (!ts.isCallExpression(n)) return false;
  const e = n.expression;
  if (ts.isIdentifier(e)) return LOG_CALLS.has(e.text);
  return (
    (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e)) &&
    ts.isIdentifier(e.expression) &&
    LOG_OBJECTS.has(e.expression.text)
  );
}

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
  const tNames = new Set(T_NAMES);
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!I18N_MODULE.test(st.moduleSpecifier.text)) continue;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named))
      for (const el of named.elements)
        if ((el.propertyName ?? el.name).text === "t") tNames.add(el.name.text);
  }
  if (IGNORE_FILE.test(lines.slice(0, 15).join("\n"))) literalRules = false;
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
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && tNames.has(node.expression.text)) {
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
      let up = node.parent; // đi lên qua phép nối chuỗi/mẫu/điều kiện tới lời gọi chứa nó
      while (
        up &&
        (ts.isTemplateSpan(up) ||
          ts.isTemplateExpression(up) ||
          ts.isBinaryExpression(up) ||
          ts.isParenthesizedExpression(up) ||
          ts.isConditionalExpression(up))
      )
        up = up.parent;
      const inLogCall = !!up && isDevFacingCall(up);
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
    const r = scanSource(rel(f), readFileSync(f, "utf8"), { jsxRules: false });
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
