// staging:drill (T-055): phần thuần — Caddyfile/kế hoạch ZAP sinh ra, kiểm SAN; install-tool: hash SHA-512 và ZapVersions.xml.
// Phần chạy thật (Caddy TLS, ZAP qua https) nằm ở `npm run -s staging:drill` (job CI staging-tls).
import assert from "node:assert/strict";
import { describe, test } from "node:test";
// @ts-expect-error -- script .mjs thuần JS, không có khai báo kiểu
import * as drill from "../../scripts/staging-drill.mjs";
// @ts-expect-error -- script .mjs thuần JS
import * as installTool from "../../scripts/tools/install-tool.mjs";

describe("staging-drill: cấu hình sinh ra (T-055)", () => {
  test("Caddyfile: CA nội bộ, không admin API, không cài CA hệ thống; http → https 308 giữ đường dẫn", () => {
    const c = drill.renderDrillCaddyfile({ httpPort: 8080, httpsPort: 8443, appPort: 3500 }) as string;
    for (const line of ["admin off", "local_certs", "skip_install_trust", "tls internal"])
      assert.ok(c.includes(`\t${line}`), line);
    assert.match(
      c,
      /^https:\/\/staging\.localhost:8443 \{\n\ttls internal\n\treverse_proxy 127\.0\.0\.1:3500\n\}/m,
    );
    assert.match(c, /redir https:\/\/staging\.localhost:8443\{uri\} 308/);
  });

  test("kế hoạch ZAP: spider + chờ passive + báo cáo JSON truyền thống, phạm vi đúng target", () => {
    const p = drill.renderZapPlan({
      target: "https://staging.localhost:8443",
      reportDir: "/tmp/z",
    }) as string;
    assert.match(p, /urls: \["https:\/\/staging\.localhost:8443"\]/);
    assert.match(p, /includePaths: \["https:\/\/staging\.localhost:8443\.\*"\]/);
    const jobs = [...p.matchAll(/- type: (\S+)/g)].map((m) => m[1]);
    assert.deepEqual(jobs, ["passiveScan-config", "spider", "passiveScan-wait", "report"]);
    assert.match(p, /template: traditional-json/);
    assert.doesNotMatch(p, /activeScan/);
  });

  test("sanIncludes: khớp đúng mục DNS, không khớp tiền tố/hậu tố hay rỗng", () => {
    assert.equal(drill.sanIncludes("DNS:staging.localhost", "staging.localhost"), true);
    assert.equal(drill.sanIncludes("IP Address:127.0.0.1, DNS:staging.localhost", "staging.localhost"), true);
    assert.equal(drill.sanIncludes("DNS:evil-staging.localhost", "staging.localhost"), false);
    assert.equal(drill.sanIncludes("DNS:staging.localhost.evil", "staging.localhost"), false);
    assert.equal(drill.sanIncludes(undefined, "staging.localhost"), false);
  });

  test("isServerAlert: chỉ nhận thông điệp có TLS alert từ máy chủ", () => {
    assert.equal(
      drill.isServerAlert(
        "C0:...:SSL routines:ssl3_read_bytes:tlsv1 alert protocol version:...SSL alert number 70",
      ),
      true,
    );
    assert.equal(drill.isServerAlert("tlsv1 unrecognized name"), false);
    assert.equal(drill.isServerAlert("SSL alert number 112"), true);
    assert.equal(drill.isServerAlert("write EPROTO"), false);
    assert.equal(drill.isServerAlert("wrong version number"), false);
  });

  test("mdCell: escape \\ trước |", () => {
    assert.equal(drill.mdCell("a\\|b\nc"), "a\\\\\\|b c");
  });
});

describe("install-tool: hash ghim (T-055)", () => {
  test("pinOf: SHA-512 khi có (Caddy chỉ công bố SHA-512), ngược lại SHA-256", () => {
    assert.deepEqual(installTool.pinOf({ sha512: "ab" }), { algo: "sha512", hex: "ab" });
    assert.deepEqual(installTool.pinOf({ sha256: "cd" }), { algo: "sha256", hex: "cd" });
    const caddy = installTool.TOOLS.caddy.platforms["linux-x64"];
    assert.match(caddy.sha512, /^[0-9a-f]{128}$/);
    assert.match(installTool.TOOLS.zap.platforms["linux-x64"].sha256, /^[0-9a-f]{64}$/);
  });

  test("upstreamHash: tệp sha*sum (cả dạng `*tệp`) và ZapVersions.xml; tên tệp có ký tự regex không khớp nhầm", () => {
    const sums = "aaa  caddy_2.11.7_linux_amd64.tar.gz\nbbb *caddy_2.11.7_linux_arm64.tar.gz\n";
    assert.equal(installTool.upstreamHash(sums, "caddy_2.11.7_linux_amd64.tar.gz"), "aaa");
    assert.equal(installTool.upstreamHash(sums, "caddy_2.11.7_linux_arm64.tar.gz"), "bbb");
    assert.equal(installTool.upstreamHash(sums, "caddy_2.11.7_linux_riscv.tar.gz"), undefined);
    const xml =
      "<linux>\n<url>u</url>\n<file>ZAP_2.17.0_Linux.tar.gz</file>\n            <hash>SHA-256:0f0e</hash>\n</linux>" +
      "<mac><file>ZAP_2x17x0_Linux.tar.gz</file><hash>SHA-256:dead</hash></mac>";
    assert.equal(installTool.upstreamHash(xml, "ZAP_2.17.0_Linux.tar.gz"), "0f0e");
    assert.equal(
      installTool.upstreamHash(
        "<file>ZAP_2x17x0_Linux.tar.gz</file><hash>SHA-256:dead</hash>",
        "ZAP_2.17.0_Linux.tar.gz",
      ),
      undefined,
    );
  });
});
