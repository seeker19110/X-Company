import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { renderSafeHtml, safeUrl } from "../../lib/web/safe-html.ts";

const root = path.resolve(import.meta.dirname, "../..");

describe("safeUrl (FE-SEC-002): allowlist scheme sau khi chuẩn hoá", () => {
  test("cho http(s), mailto, tel và đường dẫn tương đối", () => {
    for (const u of [
      "https://vi.wikipedia.org/wiki/A?q=1#x",
      "http://example.test",
      "HTTPS://EXAMPLE.TEST",
      "mailto:lienhe@example.test",
      "tel:+84900000000",
      "/lien-he",
      "dich-vu/thiet-ke",
      "./a",
      "../a",
      "#muc-2",
      "?trang=2",
    ]) {
      assert.equal(safeUrl(u), u, u);
    }
    assert.equal(safeUrl("  /lien-he  "), "/lien-he", "cắt khoảng trắng hai đầu");
  });

  test("từ chối javascript:/data:/vbscript:/file: và mọi cách lách", () => {
    const bad = [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "java\x00script:alert(1)",
      "\x01javascript:alert(1)",
      "jav&#x61;script:alert(1)",
      "jav&#97;script:alert(1)",
      "javascript&colon;alert(1)",
      "javascript&#58;alert(1)",
      "javascript&#x3a;alert(1)",
      "&#106;avascript:alert(1)",
      "&amp;#106;avascript:alert(1)",
      "java&Tab;script:alert(1)",
      "java&NewLine;script:alert(1)",
      "java​script:alert(1)",
      "﻿javascript:alert(1)",
      "javascript%3Aalert(1)",
      "data:text/html,<script>alert(1)</script>",
      "DATA:image/svg+xml;base64,PHN2Zz4=",
      "data:image/png;base64,AAAA",
      "vbscript:msgbox(1)",
      "VBScript:msgbox(1)",
      "file:///etc/passwd",
      "blob:https://x.test/uuid",
      "ftp://x.test",
      "//evil.example/x",
      "/\\evil.example",
      "\\\\evil.example",
      "",
      "   ",
      "%E0%A4%A",
      "x".repeat(3000),
    ];
    for (const u of bad) assert.equal(safeUrl(u), null, JSON.stringify(u));
    for (const v of [null, undefined, 0, 1, {}, [], true]) assert.equal(safeUrl(v), null, String(v));
  });
});

describe("renderSafeHtml (FE-SEC-001, SEC-WEB-004): fixture XSS không sinh phần tử thực thi", () => {
  test("HTML thô bị escape: <img onerror>, <svg/onload>, <script>, <iframe>", () => {
    const html = renderSafeHtml(
      [
        '<img src=x onerror="alert(1)">',
        "<svg/onload=alert(1)>",
        "<script>alert(1)</script>",
        '<iframe src="javascript:alert(1)"></iframe>',
        '<a href="javascript:alert(1)">x</a>',
      ].join("\n\n"),
    );
    assert.ok(!/<(img|svg|script|iframe|a)\b/i.test(html), html);
    assert.match(html, /&lt;script&gt;/);
  });

  test("liên kết/ảnh markdown chỉ qua allowlist: javascript:, data:, vbscript:, entity đều bị bỏ href/src", () => {
    const html = renderSafeHtml(
      [
        "[a](javascript:alert(1))",
        "[b](JaVaScRiPt:alert(1))",
        "[c](data:text/html;base64,PHNjcmlwdD4=)",
        "[d](vbscript:msgbox(1))",
        "[e](jav&#x61;script:alert(1))",
        "![f](data:image/png;base64,AAAA)",
        "![g](javascript:alert(1))",
        "[ok](https://vi.wikipedia.org) [rel](/lien-he) [mail](mailto:a@b.test)",
      ].join("\n\n"),
    );
    assert.ok(!/(href|src)="(javascript|data|vbscript)/i.test(html), html);
    assert.ok(!/<img /i.test(html), "ảnh data:/javascript: không được sinh thẻ img");
    assert.match(html, /href="https:\/\/vi\.wikipedia\.org" rel="noopener noreferrer"/);
    assert.match(html, /href="\/lien-he">rel</);
    assert.match(html, /href="mailto:a@b\.test">mail</);
  });

  test("ca biên: rỗng → chuỗi rỗng; Unicode giữ nguyên", () => {
    assert.equal(renderSafeHtml(""), "");
    assert.match(renderSafeHtml("Xin chào **Việt Nam** 🌏"), /<strong>Việt Nam<\/strong> 🌏/);
  });
});

// SEC-WEB-004: mọi điểm tắt escape của React nằm trong allowlist có review; thêm điểm mới = sửa danh sách này kèm lý do.
const SINK_ALLOWLIST = new Set(["app/(public)/page.tsx", "app/(public)/[...slug]/page.tsx"]);
const SINK_RE =
  /dangerouslySetInnerHTML|\binnerHTML\s*=|\bouterHTML\s*=|insertAdjacentHTML|document\.write\b/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

describe("DOM sink (FE-SEC-001, SEC-WEB-004)", () => {
  test("dangerouslySetInnerHTML/innerHTML chỉ ở đúng 2 tệp trang công khai, mỗi chỗ có eslint-disable kèm lý do", () => {
    const hits: string[] = [];
    for (const dir of ["app", "lib", "public"]) {
      for (const f of walk(path.join(root, dir))) {
        const rel = path.relative(root, f).split(path.sep).join("/");
        if (rel === "public/sw.js") continue;
        const src = readFileSync(f, "utf8");
        if (SINK_RE.test(src)) hits.push(rel);
        if (SINK_ALLOWLIST.has(rel)) {
          assert.match(
            src,
            /eslint-disable-next-line react\/no-danger -- \S.{10,}/,
            `${rel}: thiếu eslint-disable kèm lý do`,
          );
          assert.match(src, /safe-html/, `${rel}: lý do phải trỏ module safe-html`);
        }
      }
    }
    assert.deepEqual(hits.sort(), [...SINK_ALLOWLIST].sort());
  });

  test("hai trang nhận html từ lib/site (markdown qua lib/web/safe-html), không tự dựng HTML", () => {
    const site = readFileSync(path.join(root, "lib/site/index.ts"), "utf8");
    assert.match(site, /renderMarkdown\(/);
    const md = readFileSync(path.join(root, "lib/cms/markdown.ts"), "utf8");
    assert.match(md, /renderSafeHtml/);
    assert.ok(!/from "markdown-it"/.test(md), "markdown-it chỉ được dùng trong lib/web/safe-html.ts");
  });
});
