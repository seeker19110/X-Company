// SEC-WEB-001 / BASE-SEC-007: mọi chỗ nội suy `${…}` trong chuỗi SQL ở lib/ phải là hằng nội bộ đã ghi allowlist.
// Quy tắc: chuỗi template có từ khoá SQL + `${` cần comment `// sql-interp-allow: <lý do>` ngay trên (≤ 3 dòng trước nút)
// hoặc cùng dòng, và tệp phải có trong docs/security/sql-interpolation-allowlist.md. Mọi giá trị người dùng vào `$n`.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const SQL = /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|FROM|WHERE|ORDER\s+BY|JOIN|LIMIT|RETURNING|AND)\b/;
export const MARK = "sql-interp-allow:";

export type Finding = { file: string; line: number; allowed: boolean };

export function findInterpolations(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const lines = source.split("\n");
  const out: Finding[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isTemplateExpression(n)) {
      const text = [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(" ");
      // Bỏ qua template không phải SQL (log, khoá băm…): cần từ khoá SQL VIẾT HOA như quy ước của repo.
      if (SQL.test(text)) {
        const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line; // 0-based
        const from = Math.max(0, line - 3);
        const near = lines.slice(from, line + 1).join("\n");
        out.push({ file, line: line + 1, allowed: near.includes(MARK) });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(name)) acc.push(p);
  }
  return acc;
}

export function check(libDir: string, allowlistDoc: string, rel: (f: string) => string): string[] {
  const errs: string[] = [];
  for (const f of walk(libDir)) {
    for (const x of findInterpolations(f, readFileSync(f, "utf8"))) {
      const r = rel(f);
      if (!x.allowed) errs.push(`${r}:${x.line}: nội suy trong chuỗi SQL thiếu comment "// ${MARK} <lý do>"`);
      else if (!allowlistDoc.includes(`\`${r}\``))
        errs.push(`${r}:${x.line}: tệp chưa có trong sql-interpolation-allowlist.md`);
    }
  }
  return errs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const docPath = path.join(root, "docs/security/sql-interpolation-allowlist.md");
  const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";
  const errs = existsSync(docPath) ? [] : ["thiếu docs/security/sql-interpolation-allowlist.md"];
  errs.push(...check(path.join(root, "lib"), doc, (f) => path.relative(root, f).split(path.sep).join("/")));
  if (errs.length > 0) {
    console.error(`check:sql-interpolation — ${errs.length} lỗi:\n  ${errs.join("\n  ")}`);
    process.exit(1);
  }
  console.log("check:sql-interpolation: OK");
}
