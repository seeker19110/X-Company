// readme-smoke (BASE-DOC-005, XC-DX-001): trích khối ```bash ngay dưới "## Bắt đầu nhanh" của README.md và chạy từng
// lệnh (bỏ `git clone … && cd …` vì CI đã checkout). README lệch thực tế → job đỏ. `--print` chỉ in lệnh.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function quickstartCommands(readme) {
  const m = /^## Bắt đầu nhanh[^\n]*\n+```bash\n([\s\S]*?)```/m.exec(readme);
  if (m === null) throw new Error("README.md thiếu khối ```bash dưới '## Bắt đầu nhanh'");
  return m[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#") && !l.startsWith("git clone "));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmds = quickstartCommands(readFileSync("README.md", "utf8"));
  if (cmds.length === 0 || cmds.length > 3)
    throw new Error(`README: cần 1–3 lệnh sau clone, có ${cmds.length}`);
  for (const c of cmds) {
    console.log(`$ ${c}`);
    if (!process.argv.includes("--print")) execSync(c, { stdio: "inherit" });
  }
}
