// check:sbom — CMP-LIC-003: sinh SBOM CycloneDX của phụ thuộc production (`npm sbom --omit dev`) và kiểm trường license.
// `--out <tệp>` giữ SBOM làm artifact (CI); mặc định ghi vào thư mục tạm. Đỏ khi lệnh npm lỗi, không có thành phần hoặc
// tỉ lệ thành phần có license < MIN_RATIO (99%). Không cần mạng (đọc node_modules/lockfile).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const MIN_RATIO = 0.99;

/** Tỉ lệ thành phần có ít nhất một license (id, name hoặc expression). */
export function licenseCoverage(bom) {
  const comps = Array.isArray(bom?.components) ? bom.components : [];
  const withLic = comps.filter((c) =>
    (c.licenses ?? []).some((l) => l.expression || l.license?.id || l.license?.name),
  );
  return {
    total: comps.length,
    withLicense: withLic.length,
    ratio: comps.length === 0 ? 0 : withLic.length / comps.length,
  };
}

export function problems(bom) {
  const errs = [];
  if (bom?.bomFormat !== "CycloneDX") errs.push("SBOM không phải CycloneDX");
  const cov = licenseCoverage(bom);
  if (cov.total === 0) errs.push("SBOM không có thành phần nào");
  else if (cov.ratio < MIN_RATIO)
    errs.push(
      `license có ở ${cov.withLicense}/${cov.total} thành phần (${(cov.ratio * 100).toFixed(1)}% < ${MIN_RATIO * 100}%)`,
    );
  return errs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf("--out");
  const dir = mkdtempSync(join(tmpdir(), "xc-sbom-"));
  const out = i > 0 ? resolve(process.argv[i + 1] ?? "sbom.cdx.json") : join(dir, "sbom.cdx.json");
  const r = spawnSync("npm", ["sbom", "--sbom-format", "cyclonedx", "--omit", "dev"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  let errs;
  if (r.status !== 0) errs = [`npm sbom lỗi (exit ${r.status}): ${(r.stderr ?? "").trim().slice(0, 300)}`];
  else {
    writeFileSync(out, r.stdout);
    errs = problems(JSON.parse(readFileSync(out, "utf8")));
  }
  if (i <= 0) rmSync(dir, { recursive: true, force: true });
  if (errs.length > 0) {
    console.error(`check:sbom — ${errs.length} lỗi:\n  ${errs.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`check:sbom: OK${i > 0 ? ` (đã ghi ${out})` : ""}`);
}
