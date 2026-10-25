// npm run check:github — thiết lập GitHub THẬT khớp cấu hình dạng code (BASE-REPO-008, BASE-GATE-007/019, WF-GIT-002,
// WF-REVIEW-001/005, BASE-SEC-009). Đọc qua REST API (cần mạng; GITHUB_TOKEN/GH_TOKEN nếu có), không ghi gì lên GitHub.
// Lệch = exit 1: ruleset trên GitHub phải đúng như `.github/rulesets/main.json` (người sửa file thì người import lại).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** JSON chuẩn hoá (khoá xếp thứ tự) — GitHub trả khoá theo thứ tự riêng. */
const canon = (v) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

/** Rule theo loại → tham số (null khi rule không có tham số); danh sách required check xếp theo `context`. */
function byType(rules) {
  return Object.fromEntries(
    (rules ?? []).map((r) => {
      const p = r.parameters ?? null;
      if (p && Array.isArray(p.required_status_checks)) {
        const checks = [...p.required_status_checks].sort((a, b) => (a.context < b.context ? -1 : 1));
        return [r.type, { ...p, required_status_checks: checks }];
      }
      return [r.type, p];
    }),
  );
}

/** So ruleset trên GitHub với file: trả danh sách lệch (rỗng = khớp). Hàm thuần. */
export function diffRuleset(live, file) {
  const out = [];
  if (!live) return [`chưa có ruleset "${file.name}" trên GitHub — import .github/rulesets/main.json`];
  if (live.enforcement !== file.enforcement)
    out.push(`enforcement: GitHub ${live.enforcement} ≠ file ${file.enforcement}`);
  if (canon(live.bypass_actors ?? null) !== canon(file.bypass_actors))
    out.push(
      `bypass_actors: GitHub ${JSON.stringify(live.bypass_actors ?? null)} ≠ file ${JSON.stringify(file.bypass_actors)}`,
    );
  if (canon(live.conditions) !== canon(file.conditions)) out.push("conditions lệch");
  const L = byType(live.rules);
  const F = byType(file.rules);
  for (const t of new Set([...Object.keys(L), ...Object.keys(F)])) {
    if (!(t in L)) out.push(`rule ${t}: file có, GitHub thiếu`);
    else if (!(t in F)) out.push(`rule ${t}: GitHub có, file không khai`);
    else if (canon(L[t]) !== canon(F[t])) out.push(`rule ${t}: tham số lệch`);
  }
  return out;
}

/** BASE-GATE-007 cách (b): không đòi "up to date" thì CI phải chạy cả trên push vào nhánh chính. */
export function strictOrPushMain(file, ciYaml) {
  const rsc = byType(file.rules).required_status_checks;
  if (!rsc) return ["thiếu required_status_checks"];
  if (rsc.strict_required_status_checks_policy) return [];
  const on = /^on:\s*\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(ciYaml)?.[1] ?? "";
  return /^[ \t]+push:\s*\n[ \t]+branches:\s*\[\s*main\s*\]/m.test(on)
    ? []
    : ["strict=false mà ci.yml không chạy trên push: branches: [main]"];
}

/**
 * GET một đường dẫn REST của repo. Token (nếu có) đi qua stdin của curl (`-K -`), không nằm trong argv: lỗi của
 * execFileSync in nguyên dòng lệnh, và argv lộ qua `ps`. Lỗi ném lại chỉ gồm đường dẫn + stderr của curl.
 */
export function api(
  repo,
  path,
  token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
  run = execFileSync,
) {
  const config = token ? `header = "Authorization: Bearer ${token}"\n` : "";
  let body;
  try {
    body = run(
      "curl",
      [
        "-sSf",
        "-K",
        "-",
        "-H",
        "Accept: application/vnd.github+json",
        `https://api.github.com/repos/${repo}${path}`,
      ],
      { encoding: "utf8", input: config, stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch (e) {
    const stderr = String(e?.stderr ?? "").trim();
    throw new Error(`GitHub API ${path} lỗi (exit ${e?.status ?? "?"})${stderr ? `: ${stderr}` : ""}`);
  }
  return JSON.parse(body);
}

function main() {
  const url = execFileSync("git", ["remote", "get-url", "origin"], { cwd: ROOT, encoding: "utf8" }).trim();
  const m = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?$/.exec(url);
  if (!m) throw new Error(`không nhận ra repo GitHub từ remote origin`);
  const repo = m[1];
  const file = JSON.parse(readFileSync(join(ROOT, ".github/rulesets/main.json"), "utf8"));
  const found = api(repo, "/rulesets").find((r) => r.name === file.name);
  const errors = [
    ...diffRuleset(found ? api(repo, `/rulesets/${found.id}`) : null, file),
    ...strictOrPushMain(file, readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8")),
  ];
  if (api(repo, "/private-vulnerability-reporting").enabled !== true)
    errors.push("Private vulnerability reporting chưa bật");
  if (errors.length > 0) {
    console.error(`check:github — ${errors.length} lệch:\n${errors.map((e) => `  ${e}`).join("\n")}`);
    process.exit(1);
  }
  console.log(`check:github: OK (ruleset "${file.name}" khớp file, PVR bật)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
