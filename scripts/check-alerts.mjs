// check:alerts — kiểm CẤU TRÚC ops/prometheus/alerts.yml (không có Prometheus thật; không thay promtool).
// Mỗi rule: alert, expr, for, labels.severity ∈ {page,ticket}, labels.owner, annotations.runbook_url (https) + summary;
// expr chỉ dùng metric/nhãn mà lib/http/metrics.ts xuất; có ≥ 1 rule burn-rate đa cửa sổ (≥ 2 cửa sổ trong một expr) và 1 rule DLQ.
// Thêm (T-046): kiểm luật CỤC BỘ docs/ops/alerts.json (OPS-SLO-005/006) — mỗi luật có mức page|ticket, owner, tín hiệu hợp lệ,
// ngưỡng, runbook là `tệp.md#neo` trỏ tới MỤC CÓ THẬT, và có dòng trong docs/ops/alert-drills.md (đã thử kích hoạt).
import { existsSync, readFileSync } from "node:fs";

const METRICS = new Set([
  "http_server_request_duration_seconds_count",
  "http_server_request_duration_seconds_bucket",
  "http_server_request_duration_seconds_sum",
  "outbox_dead_total",
  "rum_web_vitals_p75",
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
const LABELS = new Set(["http_request_method", "http_route", "http_response_status_code", "le", "metric"]);

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

const LOCAL_SIGNALS = new Set([
  "http_5xx_ratio",
  "attendance_slow_ratio",
  "outbox_dead",
  "outbox_stale",
  "dsar_overdue",
  "readyz_down",
  "scrape_failed",
  "backup_age_seconds",
  "offsite_age_seconds",
  "offsite_drill_age_seconds",
  "period_close_overdue",
  "audit_chain_broken",
  "xid_age_max",
  "dead_tuples_ratio_max",
]);

/** Neo kiểu GitHub của một tiêu đề markdown. */
export function slug(h) {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** `readText(path)` trả nội dung hoặc null nếu tệp không có. Trả danh sách lỗi (rỗng = đạt). */
export function checkLocalRules(jsonText, readText) {
  const errs = [];
  let doc;
  try {
    doc = JSON.parse(jsonText);
  } catch {
    return ["alerts.json: JSON không hợp lệ"];
  }
  const rules = Array.isArray(doc?.rules) ? doc.rules : [];
  if (doc?.version !== 1 || rules.length === 0) errs.push("alerts.json: cần version 1 và ≥ 1 luật");
  const drills = readText("docs/ops/alert-drills.md") ?? "";
  const seen = new Set();
  for (const r of rules) {
    const id = String(r.id);
    if (seen.has(id)) errs.push(`${id}: trùng id`);
    seen.add(id);
    if (!["page", "ticket"].includes(r.severity)) errs.push(`${id}: severity phải page|ticket`);
    if (!r.owner) errs.push(`${id}: thiếu owner`);
    if (!r.summary) errs.push(`${id}: thiếu summary`);
    if (!LOCAL_SIGNALS.has(r.signal)) errs.push(`${id}: signal lạ ${r.signal}`);
    if (typeof r.threshold !== "number" || !Number.isFinite(r.threshold))
      errs.push(`${id}: thiếu threshold số`);
    if (!Number.isInteger(r.forSeconds) || r.forSeconds < 0)
      errs.push(`${id}: forSeconds phải là số nguyên ≥ 0`);
    const m = /^([\w./-]+\.md)#(\S+)$/u.exec(String(r.runbook ?? ""));
    if (!m) errs.push(`${id}: runbook phải dạng tệp.md#neo`);
    else {
      const text = readText(m[1]);
      if (text === null) errs.push(`${id}: runbook ${m[1]} không tồn tại`);
      else {
        let fenced = false;
        const anchors = new Set();
        for (const line of text.split("\n")) {
          if (/^\s*```/.test(line)) fenced = !fenced;
          const h = !fenced ? /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line) : null;
          if (h) anchors.add(slug(h[1]));
        }
        if (!anchors.has(m[2])) errs.push(`${id}: runbook ${m[1]} không có mục #${m[2]}`);
      }
    }
    if (!drills.includes(id)) errs.push(`${id}: chưa có dòng thử kích hoạt trong docs/ops/alert-drills.md`);
  }
  return errs;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const f = "ops/prometheus/alerts.yml";
  if (!existsSync(f)) {
    console.error(`check:alerts — thiếu ${f}`);
    process.exit(1);
  }
  const errs = check(readFileSync(f, "utf8"));
  const local = "docs/ops/alerts.json";
  if (!existsSync(local)) errs.push(`thiếu ${local}`);
  else
    errs.push(
      ...checkLocalRules(readFileSync(local, "utf8"), (p) =>
        existsSync(p) ? readFileSync(p, "utf8") : null,
      ),
    );
  if (errs.length > 0) {
    console.error(`check:alerts — ${errs.length} lỗi:\n  ${errs.join("\n  ")}`);
    process.exit(1);
  }
  console.log(
    "check:alerts: OK (chỉ kiểm cấu trúc — chạy trên Prometheus thật: npm run -s ops:stack:drill; luật cục bộ đã có runbook + dòng thử kích hoạt)",
  );
}
