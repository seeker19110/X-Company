// CMP-AUDIT-007: sổ nhà cung cấp/bên xử lý (docs/compliance/vendors.yaml) khớp mã — mỗi SDK dịch vụ ngoài trong
// `dependencies` và mỗi tệp adapters/*.ts thuộc một dòng, trường bắt buộc đủ, ngày rà ≤ 12 tháng, và
// docs/privacy/processors.md sinh từ sổ (không sửa tay). `--write` sinh lại processors.md.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "docs/compliance/vendors.yaml";
const OUT = "docs/privacy/processors.md";
export const REQUIRED = [
  "id",
  "name",
  "service",
  "data",
  "location",
  "dpa",
  "certs",
  "risk",
  "status",
  "reviewed",
];
const RISKS = new Set(["thap", "trung_binh", "cao"]);
const STATUSES = new Set(["dang_dung", "du_kien"]);
const MAX_AGE_DAYS = 365;
// Gói gọi dịch vụ ngoài (SDK đám mây, thanh toán, thư/SMS, phân tích, theo dõi lỗi, AI) — thêm vào `dependencies`
// mà không có dòng trong sổ thì CI đỏ.
export const SDK_PATTERNS = [
  /^@aws-sdk\//,
  /^aws-sdk$/,
  /^@google-cloud\//,
  /^googleapis$/,
  /^firebase(-admin)?$/,
  /^@azure\//,
  /^@sentry\//,
  /^@opentelemetry\/exporter-/,
  /^stripe$/,
  /^@stripe\//,
  /^twilio$/,
  /^nodemailer$/,
  /^@sendgrid\//,
  /^resend$/,
  /^mailgun/,
  /^posthog/,
  /^@vercel\/(analytics|speed-insights)$/,
  /^openai$/,
  /^@anthropic-ai\//,
  /^@supabase\//,
  /^web-push$/,
  /^pg$/,
];

const unq = (s) => (s.startsWith('"') ? JSON.parse(s) : s);
const list = (s) =>
  s === "[]"
    ? []
    : s
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

/** Đọc tập con YAML của sổ: `vendors:` rồi các khối `  - khoá: giá trị`, danh sách viết dạng `[a, b]`. */
export function parseVendors(text) {
  const vendors = [];
  let cur = null;
  for (const raw of text.split("\n")) {
    const l = raw.replace(/\s+$/, "");
    if (!l || l.trimStart().startsWith("#")) continue;
    let m;
    if ((m = l.match(/^\s+- ([a-z_]+):\s*(.*)$/))) {
      cur = {};
      vendors.push(cur);
    } else m = l.match(/^\s+([a-z_]+):\s*(.*)$/);
    if (m && cur) cur[m[1]] = m[1] === "packages" || m[1] === "adapters" ? list(m[2]) : unq(m[2]);
  }
  return vendors;
}

/** Lỗi của sổ so với mã: `deps` = tên gói `dependencies`, `adapters` = đường dẫn tệp adapters/*.ts, `today` = Date. */
export function checkVendors(vendors, { deps, adapters, today, exists = existsSync }) {
  const errors = [];
  const ids = new Set();
  for (const [i, v] of vendors.entries()) {
    const who = v.id ?? `#${i + 1}`;
    for (const k of REQUIRED) if (!v[k]) errors.push(`${who}: thiếu trường \`${k}\``);
    if (v.id && ids.has(v.id)) errors.push(`${who}: id trùng`);
    ids.add(v.id);
    if (v.risk && !RISKS.has(v.risk)) errors.push(`${who}: risk phải là thap|trung_binh|cao`);
    if (v.status && !STATUSES.has(v.status)) errors.push(`${who}: status phải là dang_dung|du_kien`);
    if (v.reviewed) {
      const d = /^\d{4}-\d{2}-\d{2}$/.test(v.reviewed) ? new Date(`${v.reviewed}T00:00:00Z`) : null;
      if (!d || Number.isNaN(d.getTime())) errors.push(`${who}: reviewed phải là YYYY-MM-DD`);
      else {
        const age = (today.getTime() - d.getTime()) / 86_400_000;
        if (age > MAX_AGE_DAYS)
          errors.push(`${who}: rà lần cuối ${v.reviewed} quá ${MAX_AGE_DAYS} ngày — rà lại`);
        if (age < -1) errors.push(`${who}: reviewed ${v.reviewed} ở tương lai`);
      }
    }
    for (const p of v.packages ?? [])
      if (!deps.includes(p)) errors.push(`${who}: gói \`${p}\` không có trong dependencies`);
    for (const a of v.adapters ?? [])
      if (!exists(path.join(ROOT, a))) errors.push(`${who}: adapter \`${a}\` không tồn tại`);
  }
  const listedPkgs = new Set(vendors.flatMap((v) => v.packages ?? []));
  for (const d of deps)
    if (SDK_PATTERNS.some((re) => re.test(d)) && !listedPkgs.has(d))
      errors.push(
        `gói dịch vụ ngoài \`${d}\` chưa có dòng trong ${SOURCE} (thêm bên xử lý: dữ liệu, vị trí, DPA, ngày rà)`,
      );
  const listedAdapters = new Set(vendors.flatMap((v) => v.adapters ?? []));
  for (const a of adapters)
    if (!listedAdapters.has(a)) errors.push(`adapter \`${a}\` chưa thuộc bên xử lý nào trong ${SOURCE}`);
  return errors;
}

const STATUS_VI = { dang_dung: "đang dùng", du_kien: "dự kiến" };
const RISK_VI = { thap: "thấp", trung_binh: "trung bình", cao: "cao" };
const cell = (s) => String(s).replace(/\|/g, "\\|");

/** processors.md sinh từ sổ — tất định (không ghi ngày chạy). */
export function renderProcessors(vendors) {
  const rows = vendors.map(
    (v) =>
      `| ${cell(v.name)} | ${cell(v.service)} | ${cell(v.data)} | ${cell(v.location)} | ${cell(v.dpa)} | ${RISK_VI[v.risk] ?? v.risk} | ${STATUS_VI[v.status] ?? v.status} | ${v.reviewed} |`,
  );
  return [
    "# Bên xử lý dữ liệu (processors)",
    "",
    `> Sinh từ \`${SOURCE}\` bởi \`node scripts/check-vendors.mjs --write\` — không sửa tay; CI (\`npm run -s check:vendors\`) đỏ khi lệch.`,
    '> Thêm/đổi bên xử lý (sub-processor) = PR sửa sổ; mục "chờ chủ dự án" là việc người (DPA, vị trí, chứng chỉ).',
    "",
    "| Bên xử lý | Dịch vụ | Dữ liệu chạm | Vị trí | DPA | Rủi ro | Trạng thái | Rà lần cuối |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function main(argv) {
  const vendors = parseVendors(readFileSync(path.join(ROOT, SOURCE), "utf8"));
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const adapters = readdirSync(path.join(ROOT, "adapters"))
    .filter((f) => /\.(ts|mjs|js)$/.test(f) && !/\.test\./.test(f))
    .map((f) => `adapters/${f}`);
  const errors = checkVendors(vendors, {
    deps: Object.keys(pkg.dependencies ?? {}),
    adapters,
    today: new Date(),
  });
  const md = renderProcessors(vendors);
  const outPath = path.join(ROOT, OUT);
  if (argv.includes("--write")) writeFileSync(outPath, md);
  else if (!existsSync(outPath) || readFileSync(outPath, "utf8") !== md)
    errors.push(`${OUT} lệch ${SOURCE} — chạy \`node scripts/check-vendors.mjs --write\` rồi commit`);
  for (const e of errors) console.error(`✗ ${e}`);
  if (errors.length > 0) process.exit(1);
  console.log(`check:vendors: OK (${vendors.length} bên xử lý, ${adapters.length} adapter)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
