// check:licenses — CMP-LIC-002, BASE-DEP-005: license mọi phụ thuộc trong package-lock.json (kể cả dev, transitive) theo
// license-policy.yaml. Đỏ khi thiếu/không rõ/deny/ngoài danh sách, hoặc thuộc review mà không có ngoại lệ còn hạn. Không cần mạng.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const unquote = (s) =>
  s
    .trim()
    .replace(/^"(.*)"$/, "$1")
    .replace(/^'(.*)'$/, "$1");

/** Parser YAML tối thiểu cho license-policy.yaml: khoá cấp 1 → danh sách scalar hoặc danh sách khối `- k: v`. */
export function parsePolicy(text) {
  const out = {};
  let key = null;
  let item = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const top = line.match(/^([A-Za-z_]+):\s*$/);
    if (top) {
      key = top[1];
      out[key] = [];
      item = null;
      continue;
    }
    const dash = line.match(/^\s+-\s+(.*)$/);
    if (dash && key) {
      const kv = dash[1].match(/^([A-Za-z_]+):\s*(.*)$/);
      if (kv) {
        item = { [kv[1]]: unquote(kv[2]) };
        out[key].push(item);
      } else out[key].push(unquote(dash[1]));
      continue;
    }
    const more = line.match(/^\s+([A-Za-z_]+):\s*(.*)$/);
    if (more && item) item[more[1]] = unquote(more[2]);
  }
  return out;
}

const RANK = { allow: 0, review: 1, deny: 2, unknown: 3 };
const worse = (a, b) => (RANK[a] >= RANK[b] ? a : b);
const better = (a, b) => (RANK[a] <= RANK[b] ? a : b);

/** Phân loại một biểu thức SPDX đơn giản (AND/OR, ngoặc đơn, WITH) thành allow|review|deny|unknown. */
export function classify(expr, policy) {
  const sets = { allow: new Set(policy.allow), review: new Set(policy.review), deny: new Set(policy.deny) };
  const one = (id) => {
    const bare = id
      .split(/\s+WITH\s+/)[0]
      .replace(/\+$/, "")
      .trim();
    for (const k of ["deny", "review", "allow"]) if (sets[k].has(bare)) return k;
    return "unknown";
  };
  const tokens = expr.replace(/\(/g, " ( ").replace(/\)/g, " ) ").split(/\s+/).filter(Boolean);
  let i = 0;
  const parseOr = () => {
    let v = parseAnd();
    while (tokens[i] === "OR") {
      i++;
      v = better(v, parseAnd());
    }
    return v;
  };
  const parseAnd = () => {
    let v = parseAtom();
    while (tokens[i] === "AND") {
      i++;
      v = worse(v, parseAtom());
    }
    return v;
  };
  const parseAtom = () => {
    if (tokens[i] === "(") {
      i++;
      const v = parseOr();
      if (tokens[i] === ")") i++;
      return v;
    }
    let id = tokens[i++] ?? "";
    while (tokens[i] === "WITH") {
      id += ` WITH ${tokens[i + 1]}`;
      i += 2;
    }
    return one(id);
  };
  return tokens.length === 0 ? "unknown" : parseOr();
}

const matches = (pattern, name) =>
  pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
const validUntil = (e, now) => Boolean(e.expires) && new Date(`${e.expires}T23:59:59Z`) >= now;

/** Trả mảng lỗi. `now` để test ca hết hạn. */
export function checkLicenses(lock, policy, now = new Date()) {
  const errs = [];
  const exceptions = policy.exceptions ?? [];
  for (const e of exceptions) {
    for (const f of ["package", "license", "reason", "approved_by", "expires"])
      if (!e[f]) errs.push(`ngoại lệ "${e.package ?? "?"}" thiếu trường ${f}`);
    if (e.expires && !validUntil(e, now)) errs.push(`ngoại lệ "${e.package}" đã hết hạn ${e.expires}`);
  }
  for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
    if (path === "" || pkg.link) continue;
    const name = path.split("node_modules/").pop();
    const id = `${name}@${pkg.version}`;
    const lic = typeof pkg.license === "string" ? pkg.license.trim() : "";
    if (!lic) {
      errs.push(`${id}: thiếu trường license trong lockfile`);
      continue;
    }
    const cls = classify(lic, policy);
    if (cls === "deny") errs.push(`${id}: license bị cấm (${lic})`);
    else if (cls === "unknown") errs.push(`${id}: license không có trong chính sách (${lic})`);
    else if (cls === "review") {
      const ex = exceptions.find((e) => matches(e.package ?? "", name));
      if (!ex) errs.push(`${id}: license cần review (${lic}) và chưa có ngoại lệ`);
      else if (!validUntil(ex, now)) errs.push(`${id}: ngoại lệ ${ex.package} đã hết hạn`);
    }
  }
  return errs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const need = (f) => {
    if (!existsSync(resolve(ROOT, f))) {
      console.error(`check:licenses: thiếu ${f}`);
      process.exit(1);
    }
    return readFileSync(resolve(ROOT, f), "utf8");
  };
  const policy = parsePolicy(need("license-policy.yaml"));
  const lock = JSON.parse(need("package-lock.json"));
  const errs = checkLicenses(lock, policy);
  if (errs.length > 0) {
    console.error(`check:licenses — ${errs.length} lỗi:\n  ${errs.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`check:licenses: OK (${Object.keys(lock.packages).length - 1} gói)`);
}
