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
    else if (/\.(test|spec)\.tsx?$/.test(name)) out.push(p);
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

/** `test.use({ serviceWorkers: "block" })` là một câu lệnh trực tiếp của khối này? */
function blocksServiceWorkers(stmts: ts.NodeArray<ts.Statement>): boolean {
  return stmts.some((s) => {
    if (!ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression)) return false;
    const callee = s.expression.expression;
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "use") return false;
    if (!ts.isIdentifier(callee.expression) || callee.expression.text !== "test") return false;
    return s.expression.arguments.some(
      (a) =>
        ts.isObjectLiteralExpression(a) &&
        a.properties.some(
          (p) =>
            ts.isPropertyAssignment(p) &&
            ts.isIdentifier(p.name) &&
            p.name.text === "serviceWorkers" &&
            ts.isStringLiteral(p.initializer) &&
            p.initializer.text === "block",
        ),
    );
  });
}

const ROUTE_METHODS = new Set(["route", "routeFromHAR"]);

/** `page`/`context` của Playwright, hoặc `<x>.context()`. */
function isPageOrContext(e: ts.Expression): boolean {
  if (ts.isIdentifier(e)) return e.text === "page" || e.text === "context";
  return (
    ts.isCallExpression(e) &&
    ts.isPropertyAccessExpression(e.expression) &&
    e.expression.name.text === "context" &&
    e.arguments.length === 0
  );
}

/** Có khối tổ tiên (describe hoặc cấp tệp) chặn service worker? */
function underServiceWorkerBlock(n: ts.Node): boolean {
  for (let p: ts.Node | undefined = n.parent; p !== undefined; p = p.parent) {
    if ((ts.isBlock(p) || ts.isSourceFile(p)) && blocksServiceWorkers(p.statements)) return true;
  }
  return false;
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
    // Service worker (public/sw.js: skipWaiting + clients.claim) giành trang không đồng bộ; khi đã giành, fetch đi qua SW
    // và page.route không thấy request → mock lúc ăn lúc trượt (AT09 đỏ trên PR #58).
    // AUD-TEST-002: context.route, page.context().route và routeFromHAR bị SW nuốt y như page.route.
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ROUTE_METHODS.has(n.expression.name.text) &&
      isPageOrContext(n.expression.expression) &&
      !underServiceWorkerBlock(n)
    ) {
      const what = `${n.expression.expression.getText(sf)}.${n.expression.name.text}`;
      errors.push(`${pos(n)}: ${what} cần test.use({ serviceWorkers: "block" }) ở describe chứa nó`);
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
