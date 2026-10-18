// check:osv-exceptions — BASE-DEP-004, SEC-SUPPLY-006: mỗi mục [[IgnoredVulns]] trong osv-scanner.toml có id, reason, ignoreUntil
// còn hạn (đỏ khi quá hạn) và hạn không quá MAX_DAYS kể từ hôm nay. Không cần mạng. Parser TOML tối thiểu (khối [[IgnoredVulns]]).
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const MAX_DAYS = 180;

export function parseIgnored(text) {
  const items = [];
  let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line === "[[IgnoredVulns]]") {
      cur = {};
      items.push(cur);
      continue;
    }
    const m = line.match(/^([A-Za-z]+)\s*=\s*(.*)$/);
    if (m && cur) cur[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return items;
}

export function checkExceptions(text, now = new Date()) {
  const errs = [];
  for (const [i, e] of parseIgnored(text).entries()) {
    const tag = e.id ?? `mục #${i + 1}`;
    if (!e.id) errs.push(`${tag}: thiếu id`);
    if (!e.reason || e.reason.length < 20) errs.push(`${tag}: thiếu reason (≥ 20 ký tự, nêu người duyệt)`);
    const until = e.ignoreUntil ? new Date(`${e.ignoreUntil.slice(0, 10)}T23:59:59Z`) : null;
    if (!until || Number.isNaN(until.getTime())) errs.push(`${tag}: thiếu/sai ignoreUntil (YYYY-MM-DD)`);
    else if (until < now)
      errs.push(`${tag}: ngoại lệ đã quá hạn ${e.ignoreUntil} — sửa lỗ hổng hoặc gia hạn bằng PR có lý do`);
    else if ((until.getTime() - now.getTime()) / 86_400_000 > MAX_DAYS)
      errs.push(`${tag}: hạn ${e.ignoreUntil} quá ${MAX_DAYS} ngày`);
  }
  return errs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = resolve(ROOT, "osv-scanner.toml");
  if (!existsSync(f)) {
    console.error("check:osv-exceptions: thiếu osv-scanner.toml");
    process.exit(1);
  }
  const errs = checkExceptions(readFileSync(f, "utf8"));
  if (errs.length > 0) {
    console.error(`check:osv-exceptions — ${errs.length} lỗi:\n  ${errs.join("\n  ")}`);
    process.exit(1);
  }
  console.log("check:osv-exceptions: OK");
}
