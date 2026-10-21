// check:supply-wiring — các workflow/job/tệp chuỗi cung ứng đã nối thật (T-037). Mỗi lỗi nêu mục blueprint. Không cần mạng.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => (existsSync(resolve(ROOT, f)) ? readFileSync(resolve(ROOT, f), "utf8") : "");

/** Danh sách [tệp, chuỗi phải có, mục]. */
export const RULES = [
  [".github/workflows/codeql.yml", "github/codeql-action/init@", "SEC-WEB-001: CodeQL init"],
  [".github/workflows/codeql.yml", "github/codeql-action/analyze@", "SEC-WEB-001: CodeQL analyze"],
  [".github/workflows/codeql.yml", "queries: security-extended", "BASE-SEC-007: suite security-extended"],
  [".github/workflows/codeql.yml", "javascript-typescript", "BASE-SEC-007: ngôn ngữ"],
  [".github/workflows/codeql.yml", "schedule:", "BASE-SEC-007: lịch tuần"],
  [".github/workflows/codeql.yml", "pull_request:", "BASE-SEC-007: chạy trên PR"],
  [
    ".github/workflows/osv-scanner.yml",
    "google/osv-scanner-action/osv-scanner-action@",
    "SEC-SUPPLY-006: osv-scanner",
  ],
  // Trên PR: OSV-Scanner chạy trong job `gate` của ci.yml, chặn merge qua `quality` (D-128, ADR-0039).
  [".github/workflows/ci.yml", "google/osv-scanner-action/osv-scanner-action@", "SEC-SUPPLY-006: PR (gate)"],
  [".github/workflows/ci.yml", "--config=osv-scanner.toml", "SEC-SUPPLY-006: PR theo osv-scanner.toml"],
  [".github/workflows/ci.yml", "--lockfile=package-lock.json", "SEC-SUPPLY-006: PR quét lockfile prod + dev"],
  [".github/workflows/osv-scanner.yml", "schedule:", "SEC-SUPPLY-006: lịch tuần"],
  [".github/workflows/osv-scanner.yml", "check-osv-exceptions.mjs", "BASE-DEP-004: kiểm hạn ngoại lệ"],
  [".github/workflows/maintenance.yml", "schedule:", "OPS-MAINT-003: lịch tuần"],
  [".github/workflows/maintenance.yml", "scripts/eol-check.mjs --strict", "OPS-MAINT-003: eol-check"],
  [".github/workflows/maintenance.yml", "lycheeverse/lychee-action@", "BASE-DOC-006: lychee"],
  [".github/workflows/maintenance.yml", "--log-opts=--all", "SEC-SECRET-001: gitleaks toàn lịch sử"],
  [".github/workflows/maintenance.yml", "sha256sum -c", "SEC-SECRET-001: kiểm checksum binary"],
  [".github/workflows/maintenance.yml", "fetch-depth: 0", "SEC-SECRET-001: fetch-depth 0"],
  [".github/workflows/release.yml", "googleapis/release-please-action@", "WF-REL-001: release-please"],
  [".github/workflows/ci.yml", "check:supply-chain", "CMP-LIC-002: cổng chuỗi cung ứng trong CI"],
  [
    ".github/workflows/ci.yml",
    "git diff --exit-code THIRD_PARTY_NOTICES.md",
    "CMP-LIC-001: notices diff = 0",
  ],
  [".github/workflows/ci.yml", "check-sbom.mjs", "CMP-LIC-003: SBOM"],
  [".github/workflows/ci.yml", "name: sbom", "CMP-LIC-003: SBOM artifact"],
  ["release-please-config.json", '"release-type": "node"', "WF-REL-001: release-type node"],
  ["docs/ops/VULN-SLA.md", "osv-scanner", "OPS-MAINT-004: VULN-SLA nêu osv"],
  ["docs/ops/VULN-SLA.md", "SBOM", "OPS-MAINT-004: VULN-SLA nêu SBOM"],
];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Manifest release-please: có phiên bản SemVer cho gói "." và khớp package.json. Không ghim số cụ thể —
 *  Release PR nâng số này nên ghim cứng làm mọi Release PR đỏ. */
export function checkReleaseManifest(readFn = read) {
  let manifest, pkg;
  try {
    manifest = JSON.parse(readFn(".release-please-manifest.json"));
    pkg = JSON.parse(readFn("package.json"));
  } catch {
    return ["WF-REL-001: .release-please-manifest.json hoặc package.json không phải JSON hợp lệ"];
  }
  const v = manifest?.["."];
  if (typeof v !== "string" || !SEMVER.test(v))
    return [`WF-REL-001: manifest (.release-please-manifest.json thiếu phiên bản SemVer cho ".")`];
  if (pkg?.version !== v) return [`WF-REL-001: package.json version "${pkg?.version}" khác manifest "${v}"`];
  return [];
}

export function checkWiring(readFn = read) {
  const errs = RULES.filter(([f, s]) => !readFn(f).includes(s)).map(
    ([f, s, why]) => `${why} (${f} thiếu "${s}")`,
  );
  const rp = readFn(".github/workflows/release.yml");
  if (!/contents:\s*write/.test(rp)) errs.push("WF-REL-001: release.yml thiếu contents: write ở job");
  if (/^permissions:\s*\n\s+contents:\s*write/m.test(rp))
    errs.push("WF-REL-001: quyền write phải ở job, không ở workflow");
  errs.push(...checkReleaseManifest(readFn));
  const cq = readFn(".github/workflows/codeql.yml");
  // Khối permissions cấp workflow = phần trước `jobs:` kể từ dòng `permissions:` (không dùng regex lồng lượng từ — ReDoS).
  const cqHead = cq.split("jobs:")[0] ?? "";
  const cqPerm = cqHead.search(/^permissions:/m);
  if (cqPerm !== -1 && /^[ \t]+security-events:[ \t]*write/m.test(cqHead.slice(cqPerm)))
    errs.push("SEC-WEB-001: security-events: write chỉ được ở job codeql");
  return errs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const errs = checkWiring();
  if (errs.length > 0) {
    console.error(`check:supply-wiring — ${errs.length} lỗi:\n  ${errs.join("\n  ")}`);
    process.exit(1);
  }
  console.log("check:supply-wiring: OK");
}
