// Cài công cụ vận hành dạng nhị phân vào `.tools/` (gitignore) — phiên bản GHIM + sha256 GHIM, kiểm sha256 TRƯỚC khi giải nén/chạy.
// Không `curl | sh`, không phụ thuộc npm: tải bằng `curl --proto =https`, giải nén bằng `tar`/`bzip2` của hệ điều hành.
// Dùng:  node scripts/tools/install-tool.mjs install <tên…>      cài (idempotent; sai sha256 → xoá bản tải, exit 1)
//        node scripts/tools/install-tool.mjs path <tên>          in đường dẫn nhị phân đã cài (exit 1 nếu chưa cài)
//        node scripts/tools/install-tool.mjs check-pins [tên…]   tải tệp checksum CHÍNH THỨC của bản phát hành, so với bảng ghim
//        node scripts/tools/install-tool.mjs list                bảng phiên bản/giấy phép
// Bố cục: `.tools/<tên>/<phiên bản>/<bin>` + liên kết `.tools/bin/<bin>`. Nguồn + ngày xác minh: docs/ops/tools.md.
// Thêm công cụ = thêm một mục vào TOOLS (đủ url + sha256 của tệp tải + cách giải nén); sha256 lấy từ tệp checksum chính thức.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const TOOLS_DIR = process.env.XC_TOOLS_DIR ?? path.join(ROOT, ".tools");

/** Bảng ghim. `archive`: tên tệp tải; `kind`: tar.gz (lấy `member`) | bz2 (một nhị phân nén). */
export const TOOLS = {
  openbao: {
    version: "2.7.1",
    license: "MPL-2.0",
    bin: "bao",
    verified: "2026-10-19",
    release: "https://github.com/openbao/openbao/releases/tag/v2.7.1",
    base: "https://github.com/openbao/openbao/releases/download/v2.7.1",
    checksums: "checksums.txt",
    platforms: {
      "linux-x64": {
        archive: "openbao_2.7.1_linux_amd64.tar.gz",
        sha256: "0e2f1ce10d124e03112b50dd2fbec6b78003783253bc3a91587938f39d1e2243",
        kind: "tar.gz",
        member: "bao",
      },
      "linux-arm64": {
        archive: "openbao_2.7.1_linux_arm64.tar.gz",
        sha256: "2b3807d90f224df05d4fe1fdede7f052d2227596c648a56bd291381f8fd01840",
        kind: "tar.gz",
        member: "bao",
      },
    },
    versionProbe: { args: ["version"], expect: /OpenBao v2\.7\.1/ },
  },
  restic: {
    version: "0.19.1",
    license: "BSD-2-Clause",
    bin: "restic",
    verified: "2026-10-19",
    release: "https://github.com/restic/restic/releases/tag/v0.19.1",
    base: "https://github.com/restic/restic/releases/download/v0.19.1",
    checksums: "SHA256SUMS",
    platforms: {
      "linux-x64": {
        archive: "restic_0.19.1_linux_amd64.bz2",
        sha256: "f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c",
        kind: "bz2",
      },
    },
    versionProbe: { args: ["version"], expect: /restic 0\.19\.1 / },
  },
  // Prometheus và Alertmanager: một tệp phát hành chứa hai nhị phân → hai mục dùng chung tệp, khác `member` (T-054).
  prometheus: {
    version: "3.14.0",
    license: "Apache-2.0",
    bin: "prometheus",
    verified: "2026-10-19",
    release: "https://github.com/prometheus/prometheus/releases/tag/v3.14.0",
    base: "https://github.com/prometheus/prometheus/releases/download/v3.14.0",
    checksums: "sha256sums.txt",
    platforms: {
      "linux-x64": {
        archive: "prometheus-3.14.0.linux-amd64.tar.gz",
        sha256: "f665c6da19eb7ba399c915d30c7d9793c9b417bf8a749b504bc470678631478d",
        kind: "tar.gz",
        member: "prometheus-3.14.0.linux-amd64/prometheus",
      },
      "linux-arm64": {
        archive: "prometheus-3.14.0.linux-arm64.tar.gz",
        sha256: "077f3781ab7245dc04c9a3c9b78ba120fc8e41aa0dc97489b0af67247e50ba83",
        kind: "tar.gz",
        member: "prometheus-3.14.0.linux-arm64/prometheus",
      },
    },
    versionProbe: { args: ["--version"], expect: /prometheus, version 3\.14\.0 / },
  },
  promtool: {
    version: "3.14.0",
    license: "Apache-2.0",
    bin: "promtool",
    verified: "2026-10-19",
    release: "https://github.com/prometheus/prometheus/releases/tag/v3.14.0",
    base: "https://github.com/prometheus/prometheus/releases/download/v3.14.0",
    checksums: "sha256sums.txt",
    platforms: {
      "linux-x64": {
        archive: "prometheus-3.14.0.linux-amd64.tar.gz",
        sha256: "f665c6da19eb7ba399c915d30c7d9793c9b417bf8a749b504bc470678631478d",
        kind: "tar.gz",
        member: "prometheus-3.14.0.linux-amd64/promtool",
      },
      "linux-arm64": {
        archive: "prometheus-3.14.0.linux-arm64.tar.gz",
        sha256: "077f3781ab7245dc04c9a3c9b78ba120fc8e41aa0dc97489b0af67247e50ba83",
        kind: "tar.gz",
        member: "prometheus-3.14.0.linux-arm64/promtool",
      },
    },
    versionProbe: { args: ["--version"], expect: /promtool, version 3\.14\.0 / },
  },
  alertmanager: {
    version: "0.34.1",
    license: "Apache-2.0",
    bin: "alertmanager",
    verified: "2026-10-19",
    release: "https://github.com/prometheus/alertmanager/releases/tag/v0.34.1",
    base: "https://github.com/prometheus/alertmanager/releases/download/v0.34.1",
    checksums: "sha256sums.txt",
    platforms: {
      "linux-x64": {
        archive: "alertmanager-0.34.1.linux-amd64.tar.gz",
        sha256: "265b9d1e55ef0d5306a436018af6d2b686c2ce051f03d968f7464ecb1372a7e8",
        kind: "tar.gz",
        member: "alertmanager-0.34.1.linux-amd64/alertmanager",
      },
      "linux-arm64": {
        archive: "alertmanager-0.34.1.linux-arm64.tar.gz",
        sha256: "d98d6cbaf52151c7e76e24355fec88b11cebcb9875d4cdd8b76ddce7a7e5535c",
        kind: "tar.gz",
        member: "alertmanager-0.34.1.linux-arm64/alertmanager",
      },
    },
    versionProbe: { args: ["--version"], expect: /alertmanager, version 0\.34\.1 / },
  },
  amtool: {
    version: "0.34.1",
    license: "Apache-2.0",
    bin: "amtool",
    verified: "2026-10-19",
    release: "https://github.com/prometheus/alertmanager/releases/tag/v0.34.1",
    base: "https://github.com/prometheus/alertmanager/releases/download/v0.34.1",
    checksums: "sha256sums.txt",
    platforms: {
      "linux-x64": {
        archive: "alertmanager-0.34.1.linux-amd64.tar.gz",
        sha256: "265b9d1e55ef0d5306a436018af6d2b686c2ce051f03d968f7464ecb1372a7e8",
        kind: "tar.gz",
        member: "alertmanager-0.34.1.linux-amd64/amtool",
      },
      "linux-arm64": {
        archive: "alertmanager-0.34.1.linux-arm64.tar.gz",
        sha256: "d98d6cbaf52151c7e76e24355fec88b11cebcb9875d4cdd8b76ddce7a7e5535c",
        kind: "tar.gz",
        member: "alertmanager-0.34.1.linux-arm64/amtool",
      },
    },
    versionProbe: { args: ["--version"], expect: /amtool, version 0\.34\.1 / },
  },
  // Caddy: reverse proxy có TLS cho staging (`tls internal`) và tên miền thật (ACME) — T-055, D-041. Chỉ công bố SHA-512.
  caddy: {
    version: "2.11.7",
    license: "Apache-2.0",
    bin: "caddy",
    verified: "2026-10-19",
    release: "https://github.com/caddyserver/caddy/releases/tag/v2.11.7",
    base: "https://github.com/caddyserver/caddy/releases/download/v2.11.7",
    checksums: "caddy_2.11.7_checksums.txt",
    platforms: {
      "linux-x64": {
        archive: "caddy_2.11.7_linux_amd64.tar.gz",
        sha512:
          "a7a433a1b133efc3c8d10eb0b99d52a24b5ef5c322dc77f5282182b1c0402139ab83f3a99f0c52409df77d20123fb0b523edad8a66d8f5e49136197bf61ef0e7",
        kind: "tar.gz",
        member: "caddy",
      },
      "linux-arm64": {
        archive: "caddy_2.11.7_linux_arm64.tar.gz",
        sha512:
          "3db36ba90c7a6e8dda40ee3dd71fa08844c76b5fb08f61b31e5e78d2ed38e71c51dc7baed875e50d1ca1279196e84302967237386ae87c91ae9f2aaceada682e",
        kind: "tar.gz",
        member: "caddy",
      },
    },
    versionProbe: { args: ["version"], expect: /^v2\.11\.7 / },
  },
  // OWASP ZAP (Java, chạy không cần docker): quét baseline qua https của staging — T-055. Cả thư mục (jar + plugin);
  // hash chính thức nằm trong ZapVersions.xml của zap-admin (tệp này chỉ liệt kê bản hiện hành → check-pins lệch khi ZAP lên bản mới).
  zap: {
    version: "2.17.0",
    license: "Apache-2.0",
    bin: "ZAP_2.17.0/zap.sh",
    link: "zap.sh",
    verified: "2026-10-19",
    release: "https://github.com/zaproxy/zaproxy/releases/tag/v2.17.0",
    base: "https://github.com/zaproxy/zaproxy/releases/download/v2.17.0",
    checksumsUrl: "https://raw.githubusercontent.com/zaproxy/zap-admin/master/ZapVersions.xml",
    platforms: Object.fromEntries(
      ["linux-x64", "linux-arm64"].map((p) => [
        p,
        {
          archive: "ZAP_2.17.0_Linux.tar.gz",
          sha256: "efe799aaa3627db683b43f00c9c210aea0b75c00cc8f0a0f0434d12bb3ddde5a",
          kind: "tar.gz-tree",
          root: "ZAP_2.17.0",
        },
      ]),
    ),
    versionProbe: {
      args: ["-cmd", "-version", "-dir", path.join(TOOLS_DIR, ".zap-home")],
      expect: /2\.17\.0/,
    },
  },
};

const log = (m) => process.stderr.write(`install-tool: ${m}\n`);
const fail = (m, code = 1) => {
  log(m);
  process.exit(code);
};

export const platformKey = () =>
  `${process.platform}-${process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch}`;

export const sha256File = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");

/** Hash ghim của một bản tải: `sha256` hoặc `sha512` (đúng thuật toán của tệp checksum chính thức — Caddy chỉ công bố SHA-512). */
export function pinOf(plat) {
  const algo = plat.sha512 !== undefined ? "sha512" : "sha256";
  return { algo, hex: plat[algo] };
}

const hashFile = (f, algo) => createHash(algo).update(readFileSync(f)).digest("hex");

/** Đường dẫn nhị phân đã cài (hoặc null). */
export function installedPath(name) {
  const t = TOOLS[name];
  if (!t) return null;
  const p = path.join(TOOLS_DIR, name, t.version, t.bin);
  return existsSync(p) ? p : null;
}

function curl(url, out) {
  const r = spawnSync(
    "curl",
    [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--proto",
      "=https",
      "--max-time",
      "600",
      "-o",
      out,
      url,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) fail(`tải thất bại (${url}): ${(r.stderr || "").trim().slice(0, 200)}`);
}

function install(name) {
  const t = TOOLS[name];
  if (!t) fail(`công cụ lạ: ${name} (có: ${Object.keys(TOOLS).join(", ")})`, 2);
  const plat = t.platforms[platformKey()];
  if (!plat) fail(`${name}: chưa ghim bản cho nền tảng ${platformKey()}`, 2);
  const done = installedPath(name);
  if (done) {
    log(`${name} ${t.version} đã cài: ${done}`);
    return done;
  }
  mkdirSync(TOOLS_DIR, { recursive: true });
  const tmp = mkdtempSync(path.join(TOOLS_DIR, ".dl-"));
  try {
    const archive = path.join(tmp, plat.archive);
    curl(`${t.base}/${plat.archive}`, archive);
    const pin = pinOf(plat);
    const got = hashFile(archive, pin.algo);
    if (got !== pin.hex) {
      rmSync(archive, { force: true });
      fail(`${name}: ${pin.algo} KHÔNG khớp bản ghim (${plat.archive}) — dừng, không giải nén/chạy`);
    }
    log(`${name}: ${pin.algo} khớp bản ghim`);
    const destDir = path.join(TOOLS_DIR, name, t.version);
    mkdirSync(destDir, { recursive: true });
    const staged = path.join(tmp, t.bin);
    let tree = null; // kind tar.gz-tree: cả thư mục `plat.root` (ZAP cần jar + plugin, không phải một nhị phân)
    if (plat.kind === "tar.gz-tree") {
      const x = path.join(tmp, "x");
      mkdirSync(x);
      const r = spawnSync("tar", ["-xzf", archive, "-C", x, plat.root], { encoding: "utf8" });
      if (r.status !== 0) fail(`${name}: giải nén thất bại: ${(r.stderr || "").slice(0, 200)}`);
      tree = path.join(x, plat.root);
      mkdirSync(path.dirname(staged), { recursive: true });
    } else if (plat.kind === "tar.gz") {
      const x = path.join(tmp, "x");
      mkdirSync(x);
      const r = spawnSync("tar", ["-xzf", archive, "-C", x, plat.member], { encoding: "utf8" });
      if (r.status !== 0) fail(`${name}: giải nén thất bại: ${(r.stderr || "").slice(0, 200)}`);
      renameSync(path.join(x, plat.member), staged);
    } else if (plat.kind === "bz2") {
      const r = spawnSync("bzip2", ["-dc", archive], { maxBuffer: 1 << 30 });
      if (r.status !== 0) fail(`${name}: giải nén bz2 thất bại`);
      writeFileSync(staged, r.stdout);
    } else fail(`${name}: kiểu lưu trữ lạ ${plat.kind}`, 2);
    const probeTarget = tree === null ? staged : path.join(tree, path.relative(plat.root, t.bin));
    chmodSync(probeTarget, 0o755);
    const probe = spawnSync(probeTarget, t.versionProbe.args, { encoding: "utf8" });
    if (probe.status !== 0 || !t.versionProbe.expect.test(probe.stdout))
      fail(`${name}: nhị phân không báo đúng phiên bản ghim ${t.version}`);
    const finalPath = path.join(destDir, t.bin);
    if (tree === null) renameSync(staged, finalPath);
    else renameSync(tree, path.join(destDir, plat.root));
    writeFileSync(
      path.join(destDir, ".installed.json"),
      JSON.stringify({ name, version: t.version, archive: plat.archive, [pin.algo]: pin.hex }, null, 2) +
        "\n",
    );
    const binDir = path.join(TOOLS_DIR, "bin");
    mkdirSync(binDir, { recursive: true });
    const link = path.join(binDir, t.link ?? t.bin);
    rmSync(link, { force: true });
    symlinkSync(path.relative(binDir, finalPath), link);
    log(`${name} ${t.version} đã cài: ${finalPath}`);
    return finalPath;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Hash chính thức của `archive` trong tệp checksum: dạng `<hex>  <tệp>` (sha256sum/sha512sum) hoặc
 *  ZapVersions.xml của ZAP (`<file>tệp</file> … <hash>SHA-256:hex</hash>`). */
export function upstreamHash(text, archive) {
  const esc = archive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const zap = new RegExp(`<file>${esc}</file>\\s*<hash>SHA-(?:256|512):([0-9a-f]+)</hash>`).exec(text);
  if (zap) return zap[1];
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.endsWith(` ${archive}`) || l.endsWith(`*${archive}`));
  return line?.split(/\s+/)[0];
}

function checkPins(names) {
  let bad = 0;
  for (const name of names) {
    const t = TOOLS[name];
    if (!t) fail(`công cụ lạ: ${name}`, 2);
    const tmp = mkdtempSync(path.join(TOOLS_DIR, ".pins-"));
    try {
      const f = path.join(tmp, "checksums");
      curl(t.checksumsUrl ?? `${t.base}/${t.checksums}`, f);
      const text = readFileSync(f, "utf8");
      for (const [plat, p] of Object.entries(t.platforms)) {
        const upstream = upstreamHash(text, p.archive);
        const ok = upstream === pinOf(p).hex;
        if (!ok) bad += 1;
        log(`${name} ${plat}: ${ok ? "khớp tệp checksum chính thức" : `LỆCH (${upstream ?? "không thấy"})`}`);
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return bad;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === "install") {
    if (args.length === 0) fail("thiếu tên công cụ", 2);
    for (const n of args) install(n);
  } else if (cmd === "path") {
    const p = installedPath(args[0] ?? "");
    if (!p) fail(`${args[0]} chưa cài (chạy: node scripts/tools/install-tool.mjs install ${args[0]})`);
    process.stdout.write(`${p}\n`);
  } else if (cmd === "check-pins") {
    mkdirSync(TOOLS_DIR, { recursive: true });
    process.exit(checkPins(args.length > 0 ? args : Object.keys(TOOLS)) === 0 ? 0 : 1);
  } else if (cmd === "list") {
    for (const [n, t] of Object.entries(TOOLS))
      process.stdout.write(`${n} ${t.version} ${t.license} ${t.release}\n`);
  } else fail("dùng: install <tên…> | path <tên> | check-pins [tên…] | list", 2);
}
