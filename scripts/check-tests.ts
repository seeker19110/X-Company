// QA-COV-004: mỗi test(...)/it(...) trong tests/ có ít nhất một assertion.
// QA-STRAT-008: không .only/.skip/.todo/.fixme trong tests/ và e2e/ (lớp thứ hai ngoài luật ESLint).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const TEST_FN = new Set(["test", "it"]);
const FORBIDDEN = new Set(["only", "skip", "todo", "fixme"]);
const RUNNERS = new Set(["test", "it", "describe", "suite"]);
// Tên gọi coi là assertion: assert/expect/verify (kèm hậu tố), hoặc rejects/throws/doesNotReject/doesNotThrow của node:assert.
const ASSERT_NAME = /^(assert|expect|verify)[A-Za-z0-9_]*$|^(rejects|throws|doesNotReject|doesNotThrow)$/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(test|spec)\.ts$/.test(name)) out.push(p);
  }
  return out;
}

function hasAssertion(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      let callee: ts.Expression = n.expression;
      // t.assert.*(...) hoặc assert.strictEqual(...) hoặc expect(...).toBe(...)
      while (ts.isPropertyAccessExpression(callee) || ts.isCallExpression(callee)) {
        if (ts.isPropertyAccessExpression(callee)) {
          if (ASSERT_NAME.test(callee.name.text)) found = true;
          callee = callee.expression;
        } else callee = callee.expression;
      }
      if (ts.isIdentifier(callee) && ASSERT_NAME.test(callee.text)) found = true;
    }
    if (!found) ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

export function checkSource(file: string, src: string): string[] {
  const errors: string[] = [];
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const pos = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const visit = (n: ts.Node) => {
    if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression)) {
      if (RUNNERS.has(n.expression.text) && FORBIDDEN.has(n.name.text)) {
        errors.push(`${pos(n)}: cấm ${n.expression.text}.${n.name.text}`);
      }
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && RUNNERS.has(n.expression.text)) {
      for (const arg of n.arguments) {
        if (!ts.isObjectLiteralExpression(arg)) continue;
        for (const p of arg.properties) {
          if (
            ts.isPropertyAssignment(p) &&
            ts.isIdentifier(p.name) &&
            ["only", "skip", "todo"].includes(p.name.text)
          ) {
            errors.push(`${pos(p)}: cấm tuỳ chọn ${p.name.text} trong ${n.expression.text}()`);
          }
        }
      }
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && TEST_FN.has(n.expression.text)) {
      const fn = n.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
      if (fn !== undefined && !hasAssertion(fn)) errors.push(`${pos(n)}: test không có assertion`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return errors;
}

export function check(rootDir: string): string[] {
  const errors: string[] = [];
  for (const dir of ["tests", "e2e"]) {
    for (const f of walk(path.join(rootDir, dir))) {
      const rel = path.relative(rootDir, f).split(path.sep).join("/");
      const src = readFileSync(f, "utf8");
      // e2e dùng expect của Playwright; kiểm assertion áp cho cả hai, .only/.skip cho cả hai.
      errors.push(...checkSource(rel, src));
    }
  }
  return errors;
}

if (process.argv[1] === import.meta.filename) {
  const errors = check(root);
  if (errors.length > 0) {
    console.error(errors.map((e) => `check-tests: ${e}`).join("\n"));
    process.exit(1);
  }
  console.log("check-tests: OK (mọi test có assertion, không .only/.skip/.todo)");
}
