// Cài git hook của dự án vào .git/hooks khi `npm ci`/`npm install` (script `prepare`) — FE-BUILD-004, XC-DX-006.
// Không đổi core.hooksPath; chỉ ghi đè hook mang dấu `xc-managed-hook` (không đè hook của người dùng/công cụ khác).
import { chmodSync, copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const GIT_HOOKS = path.join(".git", "hooks");
if (process.env.CI !== undefined || !existsSync(GIT_HOOKS)) process.exit(0); // CI/tarball/worktree: không cài
for (const name of ["pre-commit", "commit-msg"]) {
  const dst = path.join(GIT_HOOKS, name);
  if (existsSync(dst) && !readFileSync(dst, "utf8").includes("xc-managed-hook")) {
    console.log(`install-git-hooks: giữ ${dst} (không do dự án quản lý)`);
    continue;
  }
  copyFileSync(path.join("scripts", "git-hooks", name), dst);
  chmodSync(dst, 0o755);
}
console.log("install-git-hooks: đã cài pre-commit, commit-msg");
