// WF-ENV-010: script seed chỉ sinh dữ liệu tổng hợp — không import gói mạng, không gọi mạng, không đọc tệp/biến ngoài
// danh sách, URL chỉ trỏ tên miền dành riêng. Repo thật phải đạt; mỗi đường "kéo dữ liệu ngoài" có một ca đỏ.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as mod from "../../scripts/lib/seed-policy.mjs";

const { checkSeedText, checkSeedPolicy } = mod as {
  checkSeedText: (text: string, file: string) => string[];
  checkSeedPolicy: (dir?: string) => { files: string[]; errors: string[] };
};

const HEAD = "// Dữ liệu E2E (KHÔNG dùng cho production)\n";
const OK = `${HEAD}import { readFileSync } from "node:fs";
import pg from "pg";
import {
  createCompany,
} from "../lib/org/index.ts";
const seed = JSON.parse(readFileSync("e2e/.seed.json", "utf8"));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const site = "https://example.test/a";
const mail = "nv@cong-ty.test";
`;
const dirs: string[] = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("seed-policy (WF-ENV-010)", () => {
  test("seed tổng hợp hợp lệ → không lỗi", () => {
    assert.deepEqual(checkSeedText(OK, "s.ts"), []);
  });

  test("thiếu dòng đầu 'KHÔNG dùng cho production' → lỗi", () => {
    assert.match(checkSeedText(OK.replace(HEAD, "// seed\n"), "s.ts").join(), /thiếu dòng đầu/);
  });

  const bad: Array<[string, string, RegExp]> = [
    ["import gói mạng", `import https from "node:https";`, /import "node:https"/],
    ["import gói npm khác", `import { S3 } from "@aws-sdk/client-s3";`, /import "@aws-sdk\/client-s3"/],
    ["import động", `const m = await import("node:child_process");`, /import "node:child_process"/],
    ["require", `const fs = require("fs");`, /require\(\)/],
    ["fetch", `const r = await fetch(src);`, /gọi mạng fetch\(\)/],
    [
      "đọc tệp khác",
      `readFileSync("/srv/prod/export.csv", "utf8");`,
      /readFileSync\("\/srv\/prod\/export\.csv"\)/,
    ],
    ["đọc tệp theo biến", "readFileSync(file);", /readFileSync\(file\)/],
    ["đọc tệp qua template có biến", "readFileSync(`e2e/${x}`);", /readFileSync/],
    ["biến môi trường khác", "const u = process.env.PROD_DATABASE_URL;", /process\.env\.PROD_DATABASE_URL/],
    ["truy cập env động", 'const u = process.env["X"];', /process\.env\[…\]/],
    ["URL thật", `const u = "https://api.x-company.vn/users";`, /URL tới api\.x-company\.vn/],
    [
      "chuỗi kết nối CSDL khác",
      // userinfo ghép chuỗi để quét email fixture của check:docs không nhận nhầm "p@host" là email thật.
      `new pg.Pool({ connectionString: "postgres://u:p${"@"}db.prod.internal/xc" });`,
      /URL tới db\.prod\.internal/,
    ],
  ];
  for (const [name, line, re] of bad)
    test(`đỏ: ${name} — lỗi nêu tệp:dòng`, () => {
      const errs = checkSeedText(`${OK}${line}\n`, "scripts/seed-x.ts");
      assert.equal(errs.length, 1, errs.join("\n"));
      assert.match(errs[0]!, re);
      assert.match(errs[0]!, /scripts\/seed-x\.ts:1[0-9]/);
    });

  test("ca biên: tên miền chỉ trông giống ví dụ (example.test.vn, notexample.com) vẫn đỏ; localhost/127.0.0.1 đạt", () => {
    assert.equal(
      checkSeedText(`${OK}"https://example.test.vn/x"\n"https://notexample.com/"\n`, "s.ts").length,
      2,
    );
    assert.deepEqual(checkSeedText(`${OK}"http://localhost:3000/"\n"http://127.0.0.1:5432"\n`, "s.ts"), []);
  });

  test("thư mục không có script seed → lỗi (kiểm không được im lặng đạt)", () => {
    const d = mkdtempSync(path.join(tmpdir(), "xc-seed-"));
    dirs.push(d);
    writeFileSync(path.join(d, "khac.ts"), OK);
    assert.match(checkSeedPolicy(d).errors.join(), /không tìm thấy/);
    writeFileSync(path.join(d, "seed-a.ts"), `${OK}fetch(u)\n`);
    assert.deepEqual(checkSeedPolicy(d).files, ["seed-a.ts"]);
    assert.equal(checkSeedPolicy(d).errors.length, 1);
  });

  test("repo thật: mọi scripts/seed-*.ts đạt", () => {
    const r = checkSeedPolicy("scripts");
    assert.ok(r.files.length >= 3, r.files.join());
    assert.deepEqual(r.errors, []);
  });
});
