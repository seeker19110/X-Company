// CMP-AUDIT-007: sổ nhà cung cấp/bên xử lý (docs/compliance/vendors.yaml) khớp mã — mọi gói `dependencies` được phân
// loại (thuộc một bên xử lý hoặc `khong_goi_ngoai`), SDK trong `devDependencies` và mọi tệp adapters/** có dòng, trường
// bắt buộc đủ, ngày rà ≤ 12 tháng, docs/privacy/processors.md sinh từ sổ (không sửa tay). `--write` sinh lại processors.md.
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
  "country",
  "dpa",
  "certs",
  "risk",
  "status",
  "reviewed",
];
const RISKS = new Set(["thap", "trung_binh", "cao"]);
const STATUSES = new Set(["dang_dung", "du_kien"]);
const MAX_AGE_DAYS = 365;
// Mẫu SDK dịch vụ ngoài cho `devDependencies` (gói `dependencies` đã bắt buộc phân loại toàn bộ) — thêm vào
// devDependencies mà không có dòng trong sổ thì CI đỏ.
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

const list = (s) =>
  s
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((x) => x.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
const LIST_KEYS = new Set(["packages", "adapters"]);

/**
 * Đọc tập con YAML của sổ, CHẶT (review #99): khoá đỉnh `vendors:` (khối `  - khoá: giá trị`, danh sách dạng `[a, b]`)
 * và `khong_goi_ngoai: [gói, …]`. Dòng lạ, khoá trùng, `~`/`null`, chú thích sau giá trị, chuỗi nháy hỏng → `errors`
 * kèm số dòng (không đoán).
 */
export function readRegistry(text) {
  const vendors = [];
  const errors = [];
  let noExternal = null;
  let top = null;
  let cur = null;
  for (const [i, raw] of text.split("\n").entries()) {
    const n = i + 1;
    const l = raw.replace(/\s+$/, "");
    if (!l || l.trimStart().startsWith("#")) continue;
    let m;
    if ((m = l.match(/^([a-z_]+):\s*(.*)$/))) {
      top = m[1];
      cur = null;
      if (top === "khong_goi_ngoai") {
        if (!/^\[.*\]$/.test(m[2])) errors.push(`${SOURCE}:${n}: khong_goi_ngoai phải là danh sách [a, b]`);
        else noExternal = list(m[2]);
      }
      continue;
    }
    if (top !== "vendors") {
      errors.push(`${SOURCE}:${n}: dòng thụt lề ngoài khối vendors:`);
      continue;
    }
    if ((m = l.match(/^ {2}- ([a-z_]+):\s*(.*)$/))) {
      cur = {};
      vendors.push(cur);
    } else if (!(m = l.match(/^ {4}([a-z_]+):\s*(.*)$/)) || !cur) {
      errors.push(`${SOURCE}:${n}: dòng không đúng dạng "  - khoá: giá trị" / "    khoá: giá trị"`);
      continue;
    }
    const [, k, v] = m;
    if (k in cur) errors.push(`${SOURCE}:${n}: khoá \`${k}\` trùng trong một dòng nhà cung cấp`);
    if (/^(~|null|Null|NULL)?$/.test(v)) errors.push(`${SOURCE}:${n}: \`${k}\` rỗng/null`);
    if (LIST_KEYS.has(k)) {
      if (!/^\[.*\]$/.test(v)) errors.push(`${SOURCE}:${n}: \`${k}\` phải là danh sách [a, b]`);
      cur[k] = list(v);
    } else if (v.startsWith('"')) {
      try {
        cur[k] = JSON.parse(v);
      } catch {
        errors.push(
          `${SOURCE}:${n}: chuỗi nháy kép hỏng ở \`${k}\` (không chú thích sau chuỗi, chỉ escape kiểu JSON)`,
        );
      }
    } else if (/\s#/.test(v))
      errors.push(`${SOURCE}:${n}: chú thích sau giá trị \`${k}\` — đặt chú thích ở dòng riêng`);
    else cur[k] = v;
  }
  return { vendors, noExternal, errors };
}

/** Danh sách nhà cung cấp (tương thích người gọi cũ, vd check-docs). */
export function parseVendors(text) {
  return readRegistry(text).vendors;
}

const DAY = 86_400_000;
const utcDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Lỗi của sổ so với mã. `deps`/`devDeps` = tên gói `dependencies`/`devDependencies`, `adapters` = tệp client mạng phải
 * khai, `noExternal` = gói đã phân loại "không gọi dịch vụ ngoài" (null = không khai), `today` = Date.
 * Mọi gói `dependencies` phải được PHÂN LOẠI (thuộc `packages` của một bên xử lý hoặc `khong_goi_ngoai`) — chưa phân
 * loại = đỏ (review #99: danh sách chặn theo mẫu bỏ lọt SDK lạ). `devDependencies` khớp mẫu SDK mà không có dòng = đỏ.
 */
export function checkVendors(
  vendors,
  { deps, devDeps = [], adapters, today, noExternal = null, exists = existsSync },
) {
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
      if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v.reviewed)
        errors.push(`${who}: reviewed phải là ngày có thật dạng YYYY-MM-DD`);
      else {
        const age = (utcDay(today) - d.getTime()) / DAY; // theo ngày UTC, không theo giờ chạy
        if (age > MAX_AGE_DAYS)
          errors.push(`${who}: rà lần cuối ${v.reviewed} quá ${MAX_AGE_DAYS} ngày — rà lại`);
        if (age < 0) errors.push(`${who}: reviewed ${v.reviewed} ở tương lai`);
      }
    }
    for (const p of v.packages ?? [])
      if (!deps.includes(p) && !devDeps.includes(p))
        errors.push(`${who}: gói \`${p}\` không có trong dependencies/devDependencies`);
    for (const a of v.adapters ?? [])
      if (!exists(path.join(ROOT, a))) errors.push(`${who}: adapter \`${a}\` không tồn tại`);
  }
  const listedPkgs = new Set(vendors.flatMap((v) => v.packages ?? []));
  const plain = new Set(noExternal ?? []);
  if (noExternal === null)
    errors.push(`${SOURCE}: thiếu khong_goi_ngoai: [...] (phân loại gói không gọi ra ngoài)`);
  for (const p of plain) {
    if (listedPkgs.has(p)) errors.push(`gói \`${p}\` vừa ở khong_goi_ngoai vừa thuộc một bên xử lý`);
    if (!deps.includes(p)) errors.push(`khong_goi_ngoai: \`${p}\` không có trong dependencies (xoá khỏi sổ)`);
  }
  for (const d of deps)
    if (!listedPkgs.has(d) && !plain.has(d))
      errors.push(
        `gói \`${d}\` chưa phân loại trong ${SOURCE} — gọi dịch vụ ngoài thì thêm bên xử lý (dữ liệu, vị trí, DPA, ngày rà), không thì thêm vào khong_goi_ngoai`,
      );
  for (const d of devDeps)
    if (SDK_PATTERNS.some((re) => re.test(d)) && !listedPkgs.has(d))
      errors.push(`gói dịch vụ ngoài \`${d}\` (devDependencies) chưa có dòng trong ${SOURCE}`);
  const listedAdapters = new Set(vendors.flatMap((v) => v.adapters ?? []));
  for (const a of adapters)
    if (!listedAdapters.has(a)) errors.push(`adapter \`${a}\` chưa thuộc bên xử lý nào trong ${SOURCE}`);
  return errors;
}

const STATUS_VI = { dang_dung: "đang dùng", du_kien: "dự kiến" };
const RISK_VI = { thap: "thấp", trung_binh: "trung bình", cao: "cao" };
// Ô bảng Markdown: thoát `\` TRƯỚC rồi `|` (không thì `\|` sẵn có thành `\\|` mở lại cột), xuống dòng → khoảng trắng.
const cell = (s) =>
  String(s)
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/[\r\n]+/g, " ");

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
  const reg = readRegistry(readFileSync(path.join(ROOT, SOURCE), "utf8"));
  const vendors = reg.vendors;
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const adapters = readdirSync(path.join(ROOT, "adapters"), { recursive: true })
    .map((f) => String(f).split(path.sep).join("/"))
    .filter(
      (f) =>
        /\.(ts|tsx|mts|cts|mjs|cjs|js)$/.test(f) && !/\.(test|spec)\.[^/]+$/.test(f) && !f.endsWith(".d.ts"),
    )
    .map((f) => `adapters/${f}`);
  const errors = [
    ...reg.errors,
    ...checkVendors(vendors, {
      deps: Object.keys(pkg.dependencies ?? {}),
      devDeps: Object.keys(pkg.devDependencies ?? {}),
      adapters,
      noExternal: reg.noExternal,
      today: new Date(),
    }),
  ];
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
