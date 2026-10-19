// SEC-WEB-001, SEC-WEB-004: cổng DAST (scripts/zap-gate.mjs) — ngưỡng Medium, allowlist có lý do, báo cáo rỗng/hỏng = thất bại.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as gateMod from "../../scripts/zap-gate.mjs";

interface Alert {
  pluginid: string;
  riskcode: string;
  name: string;
  count: string;
}
interface Violation {
  pluginid: string;
}
const gate = gateMod as {
  MIN_RISK: number;
  parseAllowlist: (t: string) => Map<string, RegExp[] | null>;
  violations: (r: unknown, allowed?: Set<string> | Map<string, RegExp[] | null>) => Violation[];
};
const GATE = path.resolve("scripts/zap-gate.mjs");
const alert = (pluginid: string, riskcode: string, name = `rule ${pluginid}`): Alert => ({
  pluginid,
  riskcode,
  name,
  count: "1",
});
const report = (...alerts: Alert[]) => ({ site: [{ "@name": "http://127.0.0.1:3100", alerts }] });
const ids = (v: Violation[]) => v.map((x) => x.pluginid);

describe("zap-gate violations", () => {
  test("ngưỡng Medium (2): Informational/Low qua, Medium/High vi phạm", () => {
    assert.equal(gate.MIN_RISK, 2);
    const r = report(
      alert("10109", "0"),
      alert("10049", "1"),
      alert("10038", "2"),
      alert("40012", "3", "XSS"),
    );
    assert.deepEqual(ids(gate.violations(r)), ["10038", "40012"]);
  });

  test("allowlist theo pluginid chỉ loại cảnh báo đã duyệt", () => {
    const r = report(alert("10038", "2"), alert("40012", "3"));
    assert.deepEqual(ids(gate.violations(r, new Set(["10038"]))), ["40012"]);
  });

  test("site không có cảnh báo → 0 vi phạm", () => {
    assert.deepEqual(gate.violations({ site: [{ "@name": "x" }] }), []);
  });

  test("báo cáo không quét site nào hoặc riskcode hỏng → ném lỗi", () => {
    for (const r of [null, {}, { site: [] }]) assert.throws(() => gate.violations(r), /không quét được gì/);
    assert.throws(() => gate.violations(report(alert("1", "cao"))), /riskcode/);
  });
});

describe("zap-gate parseAllowlist", () => {
  test("mục cần pluginid + reason", () => {
    const ok = gate.parseAllowlist(JSON.stringify({ allow: [{ pluginid: "10038", reason: "CSP ở proxy" }] }));
    assert.deepEqual([...ok.keys()], ["10038"]);
    assert.equal(ok.get("10038"), null);
    for (const bad of [{ allow: [{ pluginid: "10038" }] }, { allow: [{ pluginid: "1", reason: " " }] }, {}])
      assert.throws(() => gate.parseAllowlist(JSON.stringify(bad)));
  });

  test("paths phải là mảng regex neo ^…$ không rỗng", () => {
    const m = gate.parseAllowlist(
      JSON.stringify({ allow: [{ pluginid: "10202", reason: "r", paths: ["^/app/login$"] }] }),
    );
    assert.ok(m.get("10202")![0]!.test("/app/login"));
    for (const paths of [[], ["/app/login"], ["^/app/login"], "^/a$", [1], ["^/a$|.*$"]])
      assert.throws(() =>
        gate.parseAllowlist(JSON.stringify({ allow: [{ pluginid: "10202", reason: "r", paths }] })),
      );
  });

  test("pluginid trùng → lỗi (không âm thầm ghi đè)", () => {
    const dup = {
      allow: [
        { pluginid: "1", reason: "a" },
        { pluginid: "1", reason: "b", paths: ["^/x$"] },
      ],
    };
    assert.throws(() => gate.parseAllowlist(JSON.stringify(dup)), /trùng/);
  });

  test("allowlist của repo hợp lệ", () => {
    assert.ok(gate.parseAllowlist(JSON.stringify({ allow: [] })) instanceof Map);
    assert.ok(gate.parseAllowlist(readFileSync("security/zap/allowlist.json", "utf8")) instanceof Map);
  });
});

describe("zap-gate allowlist theo đường dẫn (D-047)", () => {
  const scoped = gate.parseAllowlist(
    JSON.stringify({ allow: [{ pluginid: "10202", reason: "r", paths: ["^/app/login$", "^/lien-he$"] }] }),
  );
  const at = (...uris: string[]) => ({
    ...alert("10202", "2"),
    instances: uris.map((uri) => ({ uri, method: "GET" })),
  });
  test("mọi vị trí trong phạm vi → miễn", () => {
    const r = report(at("https://s.localhost:1/app/login", "https://s.localhost:1/lien-he?x=1"));
    assert.deepEqual(ids(gate.violations(r, scoped)), []);
  });
  test("một vị trí ngoài phạm vi, không có vị trí, hoặc URI hỏng → vẫn đỏ", () => {
    assert.deepEqual(
      ids(
        gate.violations(
          report(at("https://s.localhost:1/app/login", "https://s.localhost:1/app/khac")),
          scoped,
        ),
      ),
      ["10202"],
    );
    assert.deepEqual(ids(gate.violations(report(at("https://s.localhost:1/app/login/x")), scoped)), [
      "10202",
    ]);
    assert.deepEqual(ids(gate.violations(report(at()), scoped)), ["10202"]);
    assert.deepEqual(ids(gate.violations(report(at("không phải url")), scoped)), ["10202"]);
  });
  test("pluginid khác không được miễn nhờ mục có paths", () => {
    assert.deepEqual(ids(gate.violations(report(alert("40012", "3")), scoped)), ["40012"]);
  });
});

describe("zap-gate CLI", () => {
  const run = (...reports: unknown[]) => {
    const dir = mkdtempSync(path.join(tmpdir(), "zap-gate-"));
    try {
      const files = reports.map((r, i) => {
        const f = path.join(dir, `r${i}.json`);
        writeFileSync(f, typeof r === "string" ? r : JSON.stringify(r));
        return f;
      });
      return spawnSync(process.execPath, [GATE, ...files], { encoding: "utf8" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("sạch → exit 0; có Medium → exit 1 nêu pluginid; hỏng/thiếu đối số → exit 2", () => {
    assert.equal(run(report(alert("10049", "1"))).status, 0);
    const bad = run(report(), report(alert("40012", "3", "Cross Site Scripting (Reflected)")));
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /\[40012\] Cross Site Scripting/);
    assert.equal(run("{khong-phai-json").status, 2);
    assert.equal(spawnSync(process.execPath, [GATE], { encoding: "utf8" }).status, 2);
  });
});
