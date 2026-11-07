// Source map riêng tư theo release (T-122, PRF-WEB-008): bước sau build chuyển *.map khỏi .next/static, bỏ sourceMappingURL,
// sao map server, quyền 0700/0600; kiểm lại phát hiện map còn công khai; giải stack bằng map riêng tư (không đọc ngoài release).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import {
  RELEASE_RE as TS_RELEASE_RE,
  safeRelease as tsSafeRelease,
} from "../../lib/errors/normalize.pure.ts";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as SM from "../../scripts/lib/sourcemaps.mjs";

const {
  frameLocation,
  mapPathFor,
  publicMapProblems,
  RELEASE_RE,
  releaseDir,
  resolveStack,
  safeRelease,
  stashSourceMaps,
} = SM as {
  frameLocation: (frame: string) => { file: string; line: number; column: number } | null;
  mapPathFor: (base: string, file: string) => string | null;
  publicMapProblems: (o: { nextDir: string; publicDir: string }) => string[];
  RELEASE_RE: RegExp;
  releaseDir: (dir: string, release: string) => string;
  resolveStack: (o: { stack: string; release: string; dir: string }) => string[];
  safeRelease: (raw: unknown) => string;
  stashSourceMaps: (o: { nextDir: string; dir: string; release: string }) => {
    dir: string;
    moved: number;
    stripped: number;
    copied: number;
  };
};

const tmp = mkdtempSync(path.join(tmpdir(), "xc-sourcemaps-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// Map tối thiểu: dòng 1 cột 0 → src/a.ts:1:0 tên "boom"; dòng 2 cột 0 → src/a.ts:2:0 tên "render".
const MAP = {
  version: 3,
  sources: ["turbopack:///[project]/src/a.ts"],
  names: ["boom", "render"],
  mappings: "AAAAA;AACAC",
};

function fixture(name: string) {
  const root = path.join(tmp, name);
  const next = path.join(root, ".next");
  const write = (rel: string, body: string) => {
    const p = path.join(root, rel);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, body);
  };
  write(".next/BUILD_ID", "build-123\n");
  write(".next/static/chunks/a.js", "a();\n//# sourceMappingURL=a.js.map\n");
  write(".next/static/chunks/a.js.map", JSON.stringify(MAP));
  write(".next/static/css/s.css", "a{}\n/*# sourceMappingURL=s.css.map */");
  write(".next/static/css/s.css.map", JSON.stringify(MAP));
  write(".next/static/chunks/plain.js", "b();\n");
  write(".next/server/chunks/x.js", "c();\n//# sourceMappingURL=x.js.map\n");
  write(
    ".next/server/chunks/x.js.map",
    JSON.stringify({ version: 3, sections: [{ offset: { line: 0, column: 0 }, map: MAP }] }),
  );
  mkdirSync(path.join(root, "public"), { recursive: true });
  return { root, next, pub: path.join(root, "public"), dir: path.join(root, ".data/sourcemaps") };
}

describe("sourcemaps-stash", () => {
  test("phát hiện map công khai trước khi lưu; sau khi lưu: không còn map/tham chiếu, map nằm ở thư mục riêng tư 0700/0600", () => {
    const f = fixture("ok");
    const before: string[] = publicMapProblems({ nextDir: f.next, publicDir: f.pub });
    assert.ok(before.some((x) => x.includes("a.js.map")));
    assert.ok(before.some((x) => x.includes("a.js còn sourceMappingURL")));
    assert.ok(before.some((x) => x.includes("s.css còn sourceMappingURL")));
    const r = stashSourceMaps({ nextDir: f.next, dir: f.dir, release: "v1.2.3" });
    assert.deepEqual([r.moved, r.stripped, r.copied], [2, 2, 1]);
    assert.deepEqual(publicMapProblems({ nextDir: f.next, publicDir: f.pub }), []);
    assert.equal(readFileSync(path.join(f.next, "static/chunks/a.js"), "utf8"), "a();\n");
    assert.equal(
      readFileSync(path.join(f.next, "static/chunks/plain.js"), "utf8"),
      "b();\n",
      "tệp không có map giữ nguyên",
    );
    const base = path.join(f.dir, "v1.2.3");
    for (const rel of [
      "static/chunks/a.js.map",
      "static/css/s.css.map",
      "server/chunks/x.js.map",
      "manifest.json",
    ]) {
      const p = path.join(base, rel);
      assert.ok(existsSync(p), rel);
      assert.equal(statSync(p).mode & 0o777, 0o600, `${rel} phải 0600`);
    }
    assert.equal(statSync(base).mode & 0o777, 0o700);
    assert.equal(statSync(f.dir).mode & 0o777, 0o700);
    assert.ok(
      existsSync(path.join(f.next, "server/chunks/x.js.map")),
      "map server giữ tại chỗ (không phục vụ)",
    );
    const m = JSON.parse(readFileSync(path.join(base, "manifest.json"), "utf8"));
    assert.deepEqual([m.release, m.build_id, m.static_maps, m.server_maps], ["v1.2.3", "build-123", 2, 1]);
  });

  test("public/ có *.map → báo; release sai hoặc thư mục riêng tư nằm trong .next → từ chối", () => {
    const f = fixture("bad");
    writeFileSync(path.join(f.pub, "sw.js.map"), "{}");
    const problems: string[] = publicMapProblems({ nextDir: f.next, publicDir: f.pub });
    assert.ok(problems.some((x) => x.includes("public/ có sw.js.map")));
    assert.throws(
      () => stashSourceMaps({ nextDir: f.next, dir: f.dir, release: "../x" }),
      /release không hợp lệ/,
    );
    assert.throws(
      () => stashSourceMaps({ nextDir: f.next, dir: path.join(f.next, "maps"), release: "v1" }),
      /không được nằm trong \.next/,
    );
    assert.throws(() => releaseDir(f.dir, ""), /release không hợp lệ/);
    // review #100: APP_VERSION=".." từng làm thư mục release = cha của dir (xoá cả .data/); "." xoá map mọi release.
    for (const r of [".", "..", "..."]) assert.throws(() => releaseDir(f.dir, r), /release không hợp lệ/, r);
  });

  test("chạy lại cùng release: thư mục release được làm mới (không trộn map cũ)", () => {
    const f = fixture("again");
    stashSourceMaps({ nextDir: f.next, dir: f.dir, release: "dev" });
    writeFileSync(path.join(f.dir, "dev/static/stale.js.map"), "{}");
    stashSourceMaps({ nextDir: f.next, dir: f.dir, release: "dev" });
    assert.ok(!existsSync(path.join(f.dir, "dev/static/stale.js.map")));
  });
});

describe("sourcemap-resolve", () => {
  const f = fixture("resolve");
  stashSourceMaps({ nextDir: f.next, dir: f.dir, release: "r1" });

  test("giải khung client và server (index map có sections) về nguồn gốc; khung lạ/thiếu map/thoát thư mục giữ nguyên kèm lý do", () => {
    const out = resolveStack({
      dir: f.dir,
      release: "r1",
      stack: [
        "render (/_next/static/chunks/a.js:1:1)",
        "render@/_next/static/chunks/a.js:2:5",
        "h (/.next/server/chunks/x.js:1:1)",
        "new Promise (<anonymous>)",
        "x (/_next/static/chunks/khong-co.js:1:1)",
        "y (/_next/static/../../../../etc/passwd.js:1:1)",
      ].join("\n"),
    });
    assert.deepEqual(out, [
      "boom (src/a.ts:1:1)",
      "render (src/a.ts:2:1)",
      "boom (src/a.ts:1:1)",
      "new Promise (<anonymous>)    [không phải khung của bản build]",
      "x (/_next/static/chunks/khong-co.js:1:1)    [không có map]",
      "y (/_next/static/../../../../etc/passwd.js:1:1)    [không có map]",
    ]);
    assert.throws(() => resolveStack({ dir: f.dir, release: "khong-co", stack: "" }), /không có source map/);
  });

  test("frameLocation / mapPathFor: chỉ tệp của bản build, không ra ngoài thư mục release", () => {
    assert.deepEqual(frameLocation("f (/_next/static/chunks/[root]__a._.js:3:14)"), {
      file: "/_next/static/chunks/[root]__a._.js",
      line: 3,
      column: 14,
    });
    assert.equal(frameLocation("f (/lib/x.ts:1:2)"), null);
    const base = releaseDir(f.dir, "r1");
    assert.equal(mapPathFor(base, "/_next/static/chunks/a.js"), path.join(base, "static/chunks/a.js.map"));
    assert.equal(mapPathFor(base, "/_next/static/../../../x.js"), null);
    assert.equal(mapPathFor(base, "/etc/x.js"), null);
  });

  test("RELEASE_RE và safeRelease của script khớp bản TypeScript (lib/errors/normalize.pure.ts)", () => {
    assert.equal(RELEASE_RE.source, TS_RELEASE_RE.source);
    for (const raw of [
      undefined,
      null,
      "",
      "v1.2.3",
      "2026.11.06+abc",
      "a b/c",
      "x".repeat(80),
      "Phiên bản",
      ".",
      "..",
    ])
      assert.equal(safeRelease(raw), tsSafeRelease(raw as string | null | undefined), String(raw));
  });
});
