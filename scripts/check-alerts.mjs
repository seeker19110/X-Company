// check:alerts — kiểm CẤU TRÚC ops/prometheus/alerts.yml (không có Prometheus thật; không thay promtool).
// Mỗi rule: alert, expr, for, labels.severity ∈ {page,ticket}, labels.owner, annotations.runbook_url (https) + summary;
// expr chỉ dùng metric/nhãn mà lib/http/metrics.ts xuất; có ≥ 1 rule burn-rate đa cửa sổ (≥ 2 cửa sổ trong một expr) và 1 rule DLQ.
import { existsSync, readFileSync } from "node:fs";

const METRICS = new Set([
  "http_server_request_duration_seconds_count",
  "http_server_request_duration_seconds_bucket",
  "http_server_request_duration_seconds_sum",
  "outbox_dead_total",
]);
const PROMQL_WORDS = new Set([
  "sum",
  "rate",
  "increase",
  "and",
  "or",
  "unless",
  "by",
  "without",
  "on",
  "ignoring",
]);
const LABELS = new Set(["http_request_method", "http_route", "http_response_status_code", "le"]);

/** Parser tối giản cho đúng dạng tệp này (alert → labels/annotations, giá trị một dòng hoặc khối `|`). */
export function parseRules(text) {
  const rules = [];
  let cur = null;
  let section = null;
  let block = null;
  for (const raw of text.split("\n")) {
    if (block) {
      const ind = raw.length - raw.trimStart().length;
      if (raw.trim() === "" || ind > block.indent) {
        block.lines.push(raw.trim());
        continue;
      }
      block.target[block.key] = block.lines.join("\n").trim();
      block = null;
    }
    if (/^\s*#/.test(raw) || raw.trim() === "") continue;
    let m = /^\s*- alert:\s*(\S+)\s*$/.exec(raw);
    if (m) {
      cur = { alert: m[1], labels: {}, annotations: {} };
      rules.push(cur);
      section = null;
      continue;
    }
    if (!cur) continue;
    m = /^\s*(labels|annotations):\s*$/.exec(raw);
    if (m) {
      section = m[1];
      continue;
    }
    m = /^(\s*)([A-Za-z_]+):\s*(.*)$/.exec(raw);
    if (!m) continue;
    const indent = m[1].length;
    if (indent < 10) section = null;
    const target = section ? cur[section] : cur;
    if (m[3] === "|") block = { key: m[2], indent, target, lines: [] };
    else target[m[2]] = m[3].replace(/^"(.*)"$/, "$1");
  }
  if (block) block.target[block.key] = block.lines.join("\n").trim();
  return rules;
}

export function check(text) {
  const errs = [];
  const rules = parseRules(text);
  if (rules.length === 0) errs.push("không có rule nào");
  const names = new Set();
  for (const r of rules) {
    const id = r.alert;
    if (names.has(id)) errs.push(`${id}: trùng tên`);
    names.add(id);
    if (!r.expr) errs.push(`${id}: thiếu expr`);
    if (!r.for || !/^\d+[smh]$/.test(r.for)) errs.push(`${id}: thiếu/sai for`);
    if (!["page", "ticket"].includes(r.labels.severity)) errs.push(`${id}: severity phải page|ticket`);
    if (!r.labels.owner) errs.push(`${id}: thiếu owner`);
    if (!/^https:\/\//.test(r.annotations.runbook_url ?? "")) errs.push(`${id}: runbook_url phải là https`);
    if (!r.annotations.summary) errs.push(`${id}: thiếu summary`);
    const expr = r.expr ?? "";
    let depth = 0;
    for (const c of expr) {
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (depth < 0) break;
    }
    if (depth !== 0) errs.push(`${id}: ngoặc không cân`);
    const bare = expr
      .replace(/\{[^}]*\}/g, "")
      .replace(/\[[^\]]*\]/g, "")
      .replace(/"[^"]*"/g, "");
    for (const name of bare.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [])
      if (!METRICS.has(name) && !PROMQL_WORDS.has(name)) errs.push(`${id}: metric lạ ${name}`);
    for (const sel of expr.matchAll(/\{([^}]*)\}/g))
      for (const lab of sel[1].matchAll(/(\w+)\s*(?:=~|!~|!=|=)/g))
        if (!LABELS.has(lab[1])) errs.push(`${id}: nhãn lạ ${lab[1]}`);
  }
  const windows = (e) => new Set(e.match(/\[(\d+[smhd])\]/g) ?? []);
  if (!rules.some((r) => r.alert.includes("Burn") && windows(r.expr ?? "").size >= 2))
    errs.push("thiếu rule burn-rate đa cửa sổ (≥ 2 cửa sổ trong một expr)");
  if (!rules.some((r) => /outbox_dead_total\s*>\s*0/.test(r.expr ?? ""))) errs.push("thiếu rule DLQ > 0");
  return errs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = "ops/prometheus/alerts.yml";
  if (!existsSync(f)) {
    console.error(`check:alerts — thiếu ${f}`);
    process.exit(1);
  }
  const errs = check(readFileSync(f, "utf8"));
  if (errs.length > 0) {
    console.error(`check:alerts — ${errs.length} lỗi:\n  ${errs.join("\n  ")}`);
    process.exit(1);
  }
  console.log("check:alerts: OK (chỉ kiểm cấu trúc; chưa chạy trên Prometheus thật)");
}
