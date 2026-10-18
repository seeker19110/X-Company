// check:ci-policy — Gate T-036: các hàng rào CI/repo đã nối thật (không chỉ có tệp). Mỗi dòng lỗi nêu mục blueprint.
import { existsSync, readFileSync } from "node:fs";
import { REQUIRED_SECTIONS } from "./pr-policy.mjs";

const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "");
const errs = [];
const need = (ok, msg) => {
  if (!ok) errs.push(msg);
};

const ci = read(".github/workflows/ci.yml");
const wf = [ci, read(".github/workflows/dep-audit.yml")].join("\n");
const pkg = JSON.parse(read("package.json"));
const ruleset = JSON.parse(read(".github/rulesets/main.json"));
const contexts = ruleset.rules
  .filter((r) => r.type === "required_status_checks")
  .flatMap((r) => r.parameters.required_status_checks.map((x) => x.context));

need(read(".nvmrc").trim() === "24", "BASE-DEP-003: .nvmrc = 24");
need(/^npm@\d+\.\d+\.\d+$/.test(pkg.packageManager ?? ""), "FE-BUILD-001: packageManager npm@x.y.z");
need(
  !/node-version:\s*\d/.test(wf) && wf.includes("node-version-file: .nvmrc"),
  "PRF-WEB-010: CI dùng node-version-file",
);
need(
  !/image:\s*postgres:\d+\s*$/m.test(ci) && /image:\s*postgres:17@sha256:[0-9a-f]{64}/.test(ci),
  "BASE-DEP-008: ghim digest Postgres",
);
need(/^\* text=auto$/m.test(read(".gitattributes")), "BASE-REPO-003: * text=auto");
for (const g of [".idea/", ".vscode/", ".DS_Store", "*.pem", "*.key", "*.dump", "*.tfstate"])
  need(read(".gitignore").split("\n").includes(g), `WF-GIT-010: .gitignore thiếu ${g}`);
need(
  existsSync(".c8rc.json") && read("scripts/coverage.sh").includes("--config .c8rc.json"),
  "LOOP-CI-001: ngưỡng ở .c8rc.json",
);
for (const step of [
  "check:coverage-baseline",
  "npm run -s coverage",
  "name: coverage-lcov",
  "check:migrations",
  "check:docs",
  "check:repo-docs",
  "progress-check",
  "check:arch",
  "name: playwright-report",
  "readme-smoke.mjs",
])
  need(ci.includes(step), `ci.yml thiếu bước "${step}"`);
need(
  read(".github/workflows/pr-policy.yml").includes("node scripts/pr-policy.mjs"),
  "WF-REVIEW-002: workflow pr-policy",
);
for (const c of ["quality", "e2e", "pr-policy", "readme-smoke"])
  need(contexts.includes(c), `WF-CI-001: ruleset thiếu required check ${c}`);
const tpl = read(".github/pull_request_template.md");
for (const s of REQUIRED_SECTIONS)
  need(new RegExp(`^## ${s}$`, "m").test(tpl), `PR template thiếu "## ${s}"`);
for (const f of ["Phụ thuộc mới:", "Lý do sửa cấu hình cổng/migration:", "Backup trước migrate:"])
  need(tpl.includes(f), `PR template thiếu dòng "${f}"`);
need(existsSync(".github/PULL_REQUEST_TEMPLATE/major-upgrade.md"), "OPS-MAINT-005: template major-upgrade");
need(pkg.scripts.prepare === "node scripts/install-git-hooks.mjs", "FE-BUILD-004: prepare cài git hook");
for (const h of ["pre-commit", "commit-msg"])
  need(read(`scripts/git-hooks/${h}`).includes("xc-managed-hook"), `thiếu hook ${h}`);
need(
  /gitleaks git --staged/.test(read("scripts/git-hooks/pre-commit")),
  "WF-GIT-010: pre-commit quét bí mật staged bằng gitleaks",
);

if (errs.length > 0) {
  console.error(`check:ci-policy — ${errs.length} lỗi:\n  ${errs.join("\n  ")}`);
  process.exit(1);
}
console.log("check:ci-policy: OK");
