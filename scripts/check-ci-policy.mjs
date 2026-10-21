// check:ci-policy — Gate T-036: các hàng rào CI/repo đã nối thật (không chỉ có tệp). Mỗi dòng lỗi nêu mục blueprint.
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
// Khung 3.13 (ADR-0039, D-127): ruleset chỉ `quality` (gom mọi job của ci.yml) và `gitleaks`.
const REQUIRED = ["gitleaks", "quality"];
need(
  JSON.stringify([...contexts].sort()) === JSON.stringify(REQUIRED),
  `WF-CI-001: ruleset phải đòi đúng ${REQUIRED.join(" + ")} (ADR-0039), đang là ${JSON.stringify(contexts)}`,
);
need(
  !ruleset.rules.some(
    (r) => r.type === "required_status_checks" && r.parameters.strict_required_status_checks_policy,
  ),
  "BASE-GATE-007 (b): ruleset không đòi up-to-date — PR merge song song, CI chạy lại trên push main",
);
const qualityNeeds = /^ {2}quality:\n[\s\S]*?^ {4}needs:\s*\[([^\]]*)\]/m.exec(ci)?.[1] ?? "";
const jobsBlock = ci.split(/^jobs:\n/m)[1] ?? "";
const ciJobs = [...jobsBlock.matchAll(/^ {2}([a-z0-9_-]+):\n/gm)]
  .map((m) => m[1])
  .filter((j) => j !== "quality");
need(ciJobs.length >= 2, "WF-CI-001: không đọc được danh sách job của ci.yml");
for (const j of ciJobs)
  need(
    qualityNeeds
      .split(",")
      .map((s) => s.trim())
      .includes(j),
    `WF-CI-001: job ${j} của ci.yml không nằm trong quality.needs`,
  );
need(/^ {4}if: \$\{\{ always\(\) \}\}$/m.test(ci), "WF-CI-001: quality chạy if: always()");
// D-128: song song tối đa trong số job tối thiểu — job của ci.yml chạy ngay, không `needs` (trừ job tổng hợp `quality`).
for (const m of jobsBlock.matchAll(/^ {2}([a-z0-9_-]+):\n((?: {4}.*\n|\n| {2}#.*\n)*)/gm))
  if (m[1] !== "quality")
    need(
      !/^ {4}needs:/m.test(m[2]),
      `D-128: job ${m[1]} của ci.yml có needs — chỉ quality được chờ job khác`,
    );
// AUD-CI-001: job chạy trên PR mà không chặn merge thì PR làm đỏ nó vẫn merge được. Job của ci.yml đã gom vào `quality`
// (kiểm ở trên); job của workflow KHÁC có trigger pull_request/pull_request_target phải là required check của ruleset —
// trừ danh sách ĐÓNG dưới đây: CHẠY trên PR nhưng KHÔNG chặn merge (ADR-0039, D-128 — ruleset chỉ quality + gitleaks).
// OSV-Scanner không ở đây: trên PR nó là bước của `gate` (chặn qua `quality`); osv-scanner.yml chỉ còn push main + lịch.
// Thêm workflow PR mới: gộp job vào ci.yml (`quality.needs`) — không thêm vào danh sách này nếu không có ADR/D-NNN.
const PR_ADVISORY = new Map([
  ["pr-policy", "pr-policy.yml chạy lại khi sửa mô tả PR (`edited`) — không gộp được vào ci.yml (ADR-0039)"],
  ["codeql", "CodeQL cần security-events: write, kết quả ở Code scanning (ADR-0039)"],
  ["merge-gate", "stub tạm luôn xanh (D-122, ADR-0036) — giữ context cho ruleset sống cũ"],
]);
for (const f of readdirSync(".github/workflows").filter((x) => /\.ya?ml$/.test(x) && x !== "ci.yml")) {
  const txt = read(`.github/workflows/${f}`);
  // `on:` dạng khối (`on:\n  pull_request:`) hoặc một dòng (`on: pull_request`, `on: [push, pull_request]`).
  const on = /^on:([^\n]*)\n((?:[ \t]+.*\n|\n)*)/m.exec(txt) ?? [];
  if (!/\bpull_request(_target)?\b/.test(`${on[1] ?? ""}\n${on[2] ?? ""}`)) continue;
  const jobs = /^jobs:\n([\s\S]*)/m.exec(txt)?.[1] ?? "";
  for (const m of jobs.matchAll(/^ {2}([A-Za-z0-9_-]+):\n((?: {4}.*\n|\n)*)/gm)) {
    const name = /^ {4}name:\s*["']?(.+?)["']?\s*$/m.exec(m[2])?.[1] ?? m[1];
    need(
      contexts.includes(name) || PR_ADVISORY.has(name),
      `AUD-CI-001: job "${name}" (${f}) chạy trên PR nhưng không là required check của ruleset`,
    );
  }
}
// AUD-CI-003 (zizmor artipacked): checkout để token trong .git/config cho mọi bước sau; không job nào push bằng git.
for (const f of readdirSync(".github/workflows").filter((x) => /\.ya?ml$/.test(x))) {
  const lines = read(`.github/workflows/${f}`).split("\n");
  lines.forEach((l, i) => {
    if (!/uses: actions\/checkout@/.test(l)) return;
    const step = [];
    for (let j = i + 1; j < lines.length && !/^\s*- /.test(lines[j]) && !/^ {0,4}\S/.test(lines[j]); j++)
      step.push(lines[j]);
    need(
      step.some((s) => /^\s+persist-credentials: false\b/.test(s)),
      `AUD-CI-003: ${f}:${i + 1} checkout thiếu persist-credentials: false`,
    );
  });
}
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
