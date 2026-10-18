// QA-COV-002: ngưỡng coverage ở .c8rc.json là baseline chỉ tăng — so với bản ở nhánh gốc (GITHUB_BASE_REF → origin/main).
// Không có ref gốc (clone nông, chạy cục bộ không remote) → bỏ qua có thông báo, exit 0.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const KEYS = ["lines", "statements", "functions", "branches"];
const MIN = { lines: 85, statements: 85, functions: 85, branches: 80 }; // sàn Gate quy mô M — không bao giờ dưới

export function lowered(base, head) {
  return KEYS.filter((k) => typeof base[k] === "number" && !(head[k] >= base[k]));
}

export function belowFloor(head) {
  return KEYS.filter((k) => !(typeof head[k] === "number" && head[k] >= MIN[k]));
}

function baseConfig() {
  const refs = [
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    "origin/main",
    "main",
  ];
  for (const ref of refs.filter(Boolean)) {
    try {
      return JSON.parse(
        execFileSync("git", ["show", `${ref}:.c8rc.json`], { encoding: "utf8", stdio: "pipe" }),
      );
    } catch {
      /* ref không có hoặc tệp chưa tồn tại ở ref đó — thử ref kế */
    }
  }
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const head = JSON.parse(readFileSync(".c8rc.json", "utf8"));
  const errs = belowFloor(head).map((k) => `${k} dưới sàn ${MIN[k]}%`);
  if (head["check-coverage"] !== true) errs.push("check-coverage phải là true");
  const base = baseConfig();
  if (base === null) console.log("check-coverage-baseline: không có .c8rc.json ở nhánh gốc — chỉ kiểm sàn");
  else
    errs.push(
      ...lowered(base, head).map((k) => `${k} hạ từ ${base[k]} xuống ${head[k]} — baseline chỉ được tăng`),
    );
  if (errs.length > 0) {
    console.error(`check-coverage-baseline: ${errs.join("; ")}`);
    process.exit(1);
  }
  console.log("check-coverage-baseline: OK");
}
