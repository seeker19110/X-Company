// ops:stack:drill (T-054): phần thuần của drill — sinh cấu hình, lọc thông báo webhook, bảng ghim công cụ.
// Phần chạy nhị phân thật (promtool, Prometheus, Alertmanager) nằm ở `npm run -s ops:stack:drill` (job CI ops-stack).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as drill from "../../scripts/ops-stack-drill.mjs";
// @ts-expect-error -- script .mjs thuần JS
import { TOOLS } from "../../scripts/tools/install-tool.mjs";

const {
  DRILL_ALERT,
  notificationsFor,
  renderAlertmanagerConfig,
  renderDrillRules,
  renderPrometheusConfig,
  summarizeRules,
} = drill;

describe("ops-stack-drill: cấu hình sinh ra (T-054)", () => {
  test("Prometheus: scrape /api/metrics bằng bearer từ tệp, không nhúng token; nạp mọi tệp rule", () => {
    const yml = renderPrometheusConfig({
      appPort: 3400,
      amPort: 9093,
      tokenFile: "/tmp/x/metrics_token",
      ruleFiles: ["/r/alerts.yml", "/tmp/x/drill.rules.yml"],
    }) as string;
    assert.match(yml, /metrics_path: \/api\/metrics/);
    assert.match(yml, /type: Bearer\n {6}credentials_file: "\/tmp\/x\/metrics_token"/);
    assert.match(yml, /targets: \["127\.0\.0\.1:3400"\]/);
    assert.match(yml, /targets: \["127\.0\.0\.1:9093"\]/);
    assert.match(yml, /- "\/r\/alerts\.yml"\n {2}- "\/tmp\/x\/drill\.rules\.yml"/);
    assert.doesNotMatch(yml, /credentials:/);
  });

  test("Alertmanager: gửi cả resolved tới webhook; rule diễn tập bắn ngay khi mất scrape", () => {
    const am = renderAlertmanagerConfig({ webhookUrl: "http://127.0.0.1:5/hook" }) as string;
    assert.match(am, /url: "http:\/\/127\.0\.0\.1:5\/hook"\n {8}send_resolved: true/);
    const rules = renderDrillRules() as string;
    assert.match(rules, new RegExp(`alert: ${DRILL_ALERT}`));
    assert.match(rules, /expr: up\{job="x-company"\} == 0\n {8}for: 0s/);
  });
});

describe("ops-stack-drill: đọc kết quả", () => {
  const firing = {
    version: "4",
    status: "firing",
    alerts: [{ status: "firing", labels: { alertname: DRILL_ALERT } }],
  };
  const resolved = { ...firing, status: "resolved", alerts: [{ ...firing.alerts[0], status: "resolved" }] };

  test("notificationsFor: đúng alertname + trạng thái; payload lạ/hỏng/khác phiên bản bị bỏ", () => {
    const all = [
      firing,
      resolved,
      { invalid: "{" },
      { ...firing, version: "3" },
      { ...firing, alerts: [{ status: "firing", labels: { alertname: "Khac" } }] },
      null,
    ];
    assert.deepEqual(notificationsFor(all, DRILL_ALERT, "firing"), [firing]);
    assert.deepEqual(notificationsFor(all, DRILL_ALERT, "resolved"), [resolved]);
    assert.deepEqual(notificationsFor([], DRILL_ALERT, "firing"), []);
  });

  test("summarizeRules: phẳng hoá nhóm → rule; body rỗng/hỏng → []", () => {
    const rows = summarizeRules({
      data: {
        groups: [
          { name: "g", file: "/r/alerts.yml", rules: [{ name: "A", health: "ok", state: "inactive" }] },
          { name: "h", file: "/d.yml" },
        ],
      },
    });
    assert.deepEqual(rows, [
      { group: "g", file: "/r/alerts.yml", name: "A", health: "ok", state: "inactive" },
    ]);
    assert.deepEqual(summarizeRules(undefined), []);
    assert.deepEqual(summarizeRules({ data: {} }), []);
  });
});

describe("ops-stack-drill: truy vấn SLO", () => {
  test("sloQueries: mỗi khối promql là một biểu thức; bỏ chú thích; bỏ qua khối khác", () => {
    const md =
      "a\n```promql\nsum(rate(x[5m]))   # tốt\n# chú thích\n/\nsum(rate(y[5m]))\n```\n```js\nnope\n```\n";
    assert.deepEqual(drill.sloQueries(md), ["sum(rate(x[5m])) / sum(rate(y[5m]))"]);
    assert.deepEqual(drill.sloQueries("không có khối"), []);
  });
});

describe("ops-stack-drill: độ phủ test rule (OPS-SLO-006)", () => {
  const rules = "groups:\n  - rules:\n      - alert: A\n        expr: x\n      - alert: B\n        expr: y\n";
  test("đủ ca bắn và ca không bắn → không thiếu", () => {
    const t =
      "- alertname: A\n  exp_alerts:\n    - exp_labels: {}\n- alertname: A\n  exp_alerts: []\n" +
      "- alertname: B\n  exp_alerts:\n    - x\n- alertname: B\n  exp_alerts: []\n";
    assert.deepEqual(drill.alertNames(rules), ["A", "B"]);
    assert.deepEqual(drill.ruleCoverage(rules, t), []);
  });
  test("alert mới không có test, hoặc chỉ có một phía → báo thiếu", () => {
    const t = "- alertname: A\n  exp_alerts: []\n";
    assert.deepEqual(drill.ruleCoverage(rules, t), [
      "A: thiếu ca bắn",
      "B: thiếu ca bắn",
      "B: thiếu ca không bắn",
    ]);
  });
  test("tệp test thật của repo phủ đủ mọi rule thật", async () => {
    const { readFileSync } = await import("node:fs");
    assert.deepEqual(
      drill.ruleCoverage(
        readFileSync("ops/prometheus/alerts.yml", "utf8"),
        readFileSync("ops/prometheus/alerts.test.yml", "utf8"),
      ),
      [],
    );
  });
});

describe("ops-stack-drill: ô bảng báo cáo", () => {
  test("mdCell escape \\ trước |, gộp dòng — chuỗi `a\\|b` không phá cột", () => {
    assert.equal(drill.mdCell("a|b\nc"), "a\\|b c");
    assert.equal(drill.mdCell("a\\|b"), "a\\\\\\|b");
    assert.equal(drill.mdCell(3), "3");
  });
});

describe("install-tool: bảng ghim Prometheus/Alertmanager", () => {
  const tools = TOOLS as Record<
    string,
    {
      version: string;
      bin: string;
      platforms: Record<string, { archive: string; sha256: string; member?: string }>;
    }
  >;

  test("nhị phân cùng tệp phát hành dùng chung archive + sha256; member nằm trong thư mục của archive", () => {
    for (const [a, b] of [
      ["prometheus", "promtool"],
      ["alertmanager", "amtool"],
    ] as const) {
      assert.equal(tools[a]!.version, tools[b]!.version);
      for (const [plat, p] of Object.entries(tools[a]!.platforms)) {
        const q = tools[b]!.platforms[plat]!;
        assert.equal(p.archive, q.archive);
        assert.equal(p.sha256, q.sha256);
        for (const [t, x] of [
          [a, p],
          [b, q],
        ] as const) {
          assert.match(x.sha256, /^[0-9a-f]{64}$/);
          assert.equal(x.member, `${x.archive.replace(/\.tar\.gz$/, "")}/${tools[t]!.bin}`);
        }
      }
    }
  });
});
