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
};

const log = (m) => process.stderr.write(`install-tool: ${m}\n`);
const fail = (m, code = 1) => {
  log(m);
  process.exit(code);
};

export const platformKey = () =>
  `${process.platform}-${process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch}`;

export const sha256File = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");

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
    const got = sha256File(archive);
    if (got !== plat.sha256) {
      rmSync(archive, { force: true });
      fail(`${name}: sha256 KHÔNG khớp bản ghim (${plat.archive}) — dừng, không giải nén/chạy`);
    }
    log(`${name}: sha256 khớp bản ghim`);
    const destDir = path.join(TOOLS_DIR, name, t.version);
    mkdirSync(destDir, { recursive: true });
    const staged = path.join(tmp, t.bin);
    if (plat.kind === "tar.gz") {
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
    chmodSync(staged, 0o755);
    const probe = spawnSync(staged, t.versionProbe.args, { encoding: "utf8" });
    if (probe.status !== 0 || !t.versionProbe.expect.test(probe.stdout))
      fail(`${name}: nhị phân không báo đúng phiên bản ghim ${t.version}`);
    const finalPath = path.join(destDir, t.bin);
    renameSync(staged, finalPath);
    writeFileSync(
      path.join(destDir, ".installed.json"),
      JSON.stringify({ name, version: t.version, archive: plat.archive, sha256: plat.sha256 }, null, 2) +
        "\n",
    );
    const binDir = path.join(TOOLS_DIR, "bin");
    mkdirSync(binDir, { recursive: true });
    const link = path.join(binDir, t.bin);
    rmSync(link, { force: true });
    symlinkSync(path.relative(binDir, finalPath), link);
    log(`${name} ${t.version} đã cài: ${finalPath}`);
    return finalPath;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function checkPins(names) {
  let bad = 0;
  for (const name of names) {
    const t = TOOLS[name];
    if (!t) fail(`công cụ lạ: ${name}`, 2);
    const tmp = mkdtempSync(path.join(TOOLS_DIR, ".pins-"));
    try {
      const f = path.join(tmp, t.checksums);
      curl(`${t.base}/${t.checksums}`, f);
      const lines = readFileSync(f, "utf8").split("\n");
      for (const [plat, p] of Object.entries(t.platforms)) {
        const line = lines.find(
          (l) => l.trim().endsWith(` ${p.archive}`) || l.trim().endsWith(`*${p.archive}`),
        );
        const upstream = line?.trim().split(/\s+/)[0];
        const ok = upstream === p.sha256;
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
