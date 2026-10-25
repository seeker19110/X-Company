// AUD-SEC-005 (D-067): scripts/check-lib-writes.ts — hàm ghi lib/org, lib/cms chỉ được gọi từ tệp có kiểm quyền.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { check, importedNames, parseExports, valueExports } from "../../scripts/check-lib-writes.ts";

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xc-libw-"));
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}

const ORG = [
  "export interface Actor { userId: string | null }",
  "export type X = 1;",
  "export function mapPgError(e: unknown): never { throw e; }",
  "export async function departmentSubtree() {}",
  "export async function employmentAt() {}",
  "export async function createBranch() {}",
].join("\n");
const CMS = [
  "export const PAGE_TYPES = [] as const;",
  "export function pathFor() {}",
  "export async function getPublished() {}",
  "export async function listPublished() {}",
  "export async function findRedirect() {}",
  "export async function publish() {}",
].join("\n");
const BASE = { "lib/org/index.ts": ORG, "lib/cms/index.ts": CMS };

test("valueExports: hàm, async, const; bỏ type/interface", () => {
  assert.deepEqual(valueExports(ORG), ["mapPgError", "departmentSubtree", "employmentAt", "createBranch"]);
});

test("importedNames: tên, alias, type, namespace", () => {
  assert.deepEqual(importedNames("{ a, b as c, type T }"), ["a", "b"]);
  assert.deepEqual(importedNames("type { T }"), []);
  assert.deepEqual(importedNames("* as org"), ["*"]);
});

test("check-lib-writes: hàm đọc và type không cần kiểm quyền; cây thật hiện tại sạch", () => {
  const dir = fixture({
    ...BASE,
    "lib/site/index.ts": `import { getPublished, pathFor, type PageType } from "../cms/index.ts";\nexport const s = [getPublished, pathFor];`,
    "app/page.tsx": `import { pathFor } from "@/lib/cms";\nexport default pathFor;`,
  });
  assert.deepEqual(check(dir, {}), []);
  assert.deepEqual(check(path.resolve(import.meta.dirname, "../..")), []);
});

test("check-lib-writes: route gọi hàm ghi không kiểm quyền → đỏ; có authorize/can → xanh", () => {
  const bad = fixture({
    ...BASE,
    "lib/admin/routes.ts": `import { createBranch } from "../org/index.ts";\nexport const r = createBranch;`,
    "app/api/app/pages/route.ts": `import * as cms from "@/lib/cms";\nexport const POST = cms.publish;`,
    "app/api/app/x/route.ts": `const m = await import("@/lib/cms/index.ts");\nexport const GET = m.publish;`,
  });
  const errs = check(bad, {});
  assert.equal(errs.length, 3, errs.join("\n"));
  assert.match(errs.join("\n"), /lib\/admin\/routes\.ts: gọi hàm ghi org\.createBranch/);
  assert.match(errs.join("\n"), /app\/api\/app\/pages\/route\.ts: gọi hàm ghi cms\.publish/);

  const good = fixture({
    ...BASE,
    "lib/admin/routes.ts": `import { createBranch } from "../org/index.ts";\nawait authorize(ctx, "org.manage", r);\nexport const r = createBranch;`,
  });
  assert.deepEqual(check(good, {}), []);
});

test("check-lib-writes: export mới mặc định là ghi; READ khai sai và EXEMPT thừa/thiếu lý do → đỏ", () => {
  const dir = fixture({
    "lib/org/index.ts": ORG.replace(
      "export async function employmentAt() {}",
      "export async function newThing() {}",
    ),
    "lib/cms/index.ts": CMS,
    "lib/x/a.ts": `import { newThing } from "../org/index.ts";\nexport const a = newThing;`,
  });
  const errs = check(dir, { "lib/y/b.ts": "lý do", "lib/x/a.ts": " " }).join("\n");
  assert.match(errs, /READ_EXPORTS của org khai "employmentAt" không còn export/);
  assert.match(errs, /EXEMPT lib\/y\/b\.ts: không còn import hàm ghi/);
  assert.match(errs, /EXEMPT lib\/x\/a\.ts: thiếu lý do/);
});

test("parseExports: mọi dạng export có tên đều là tên; dạng không phân tích được → unknown (fail-closed)", () => {
  const src = [
    "const a = 1; function b() {}",
    "export { a, b as c, type T };",
    'export { d } from "./d.ts";',
    "export default function x() {}",
    "export enum E { A }",
    "export const enum F { A }",
    "export abstract class Q {}",
    "export declare const r: number;",
    "export type { U } from './u.ts';",
    "export const { y, z } = o;",
    'export * from "./w.ts";',
    "// export function commented() {}",
  ].join("\n");
  const r = parseExports(src);
  assert.deepEqual(r.names.sort(), ["E", "F", "Q", "a", "c", "d", "default", "r"].sort());
  assert.deepEqual(r.unknown, ["export const { y, z } = o;", 'export * from "./w.ts";']);
});

test("check-lib-writes: export dạng danh sách vẫn là hàm ghi; dạng lạ trong miền → đỏ; can( trong chú thích không tính", () => {
  const dir = fixture({
    "lib/org/index.ts": ORG + "\nasync function moveX() {}\nexport { moveX };",
    "lib/cms/index.ts": CMS + '\nexport * from "./more.ts";',
    "lib/x/a.ts": `import { moveX } from "../org/index.js";\n// có thể gọi can() sau\nexport const a = moveX;`,
  });
  const errs = check(dir, {}).join("\n");
  assert.match(errs, /lib\/x\/a\.ts: gọi hàm ghi org\.moveX/);
  assert.match(errs, /lib\/cms\/index\.ts: không phân tích được `export \* from "\.\/more\.ts";`/);
});
