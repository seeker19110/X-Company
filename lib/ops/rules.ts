// i18n-ignore-file: luật/nội dung cảnh báo là đầu ra cho người vận hành (kênh trực), không tới người dùng cuối
// Luật cảnh báo cục bộ (T-046; OPS-SLO-004/005): tệp JSON `docs/ops/alerts.json`, suy từ docs/ops/SLO.md. Mỗi luật có
// tín hiệu (signal), ngưỡng, thời gian giữ (for), mức nghiêm trọng page|ticket, chủ sở hữu và runbook trỏ tới MỤC CÓ THẬT
// trong repo (`tests/unit/alerts-drill.test.ts` kiểm tệp + tiêu đề tồn tại). Không có Prometheus/Alertmanager: các luật
// này do `lib/ops/alerts.ts` đánh giá; `ops/prometheus/alerts.yml` vẫn là bộ luật mẫu cho hạ tầng thật.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { SECONDS_PER_HOUR } from "../nen/units.ts";

export const SIGNALS = [
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
] as const;
export type SignalName = (typeof SIGNALS)[number];

export const SEVERITIES = ["page", "ticket"] as const;
export type Severity = (typeof SEVERITIES)[number];

const ruleSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z][A-Za-z0-9]{2,63}$/, { error: "id chỉ gồm chữ/số, 3–64 ký tự" }),
    summary: z.string().min(10).max(300),
    severity: z.enum(SEVERITIES),
    owner: z.string().min(1).max(64),
    /** `đường/dẫn/tệp.md#neo` — tệp tồn tại và có tiêu đề cho neo (kiểm ở test). */
    runbook: z.string().regex(/^[\w./-]+\.md#[^\s#]+$/u, { error: "runbook phải dạng đường/dẫn.md#neo" }),
    signal: z.enum(SIGNALS),
    op: z.enum(["gt", "gte"]),
    threshold: z.number().finite().min(0),
    /** Điều kiện phải đúng liên tục từng ấy giây mới bắn (0 = bắn ngay). */
    forSeconds: z
      .number()
      .int()
      .min(0)
      .max(24 * SECONDS_PER_HOUR),
    /** Cửa sổ (giây) cho tín hiệu dạng tỷ lệ: mọi cửa sổ phải cùng vượt ngưỡng (burn rate đa cửa sổ). */
    windows: z.array(z.number().int().min(60).max(2_592_000)).min(1).max(3).optional(),
    /** Số sự kiện tối thiểu trong cửa sổ để tính tỷ lệ (dưới mức này coi như 0 — tránh 1/1 = 100%). */
    minEvents: z.number().int().min(1).max(10_000).optional(),
    params: z.record(z.string(), z.number().finite()).optional(),
  })
  .strict();
export type AlertRule = z.infer<typeof ruleSchema>;

const RATIO_SIGNALS = new Set<SignalName>(["http_5xx_ratio", "attendance_slow_ratio"]);

const fileSchema = z.object({ version: z.literal(1), rules: z.array(ruleSchema).min(1) }).strict();

/** Kiểm + trả luật; ném `Error` nêu mọi lỗi (id trùng, tín hiệu tỷ lệ thiếu windows…). */
export function parseRules(text: string): AlertRule[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("luật cảnh báo: JSON không hợp lệ");
  }
  const r = fileSchema.safeParse(raw);
  if (!r.success)
    throw new Error(
      `luật cảnh báo không hợp lệ — ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const rule of r.data.rules) {
    if (seen.has(rule.id)) errs.push(`${rule.id}: trùng id`);
    seen.add(rule.id);
    if (RATIO_SIGNALS.has(rule.signal) && !rule.windows) errs.push(`${rule.id}: tín hiệu tỷ lệ cần windows`);
    if (!RATIO_SIGNALS.has(rule.signal) && rule.windows)
      errs.push(`${rule.id}: windows chỉ dùng cho tín hiệu tỷ lệ`);
  }
  if (errs.length > 0) throw new Error(`luật cảnh báo không hợp lệ — ${errs.join("; ")}`);
  return r.data.rules;
}

export function loadRules(file: string): AlertRule[] {
  return parseRules(readFileSync(file, "utf8"));
}

/** Neo kiểu GitHub cho một tiêu đề markdown (chữ thường, bỏ dấu câu trừ `-`, khoảng trắng → `-`). */
export function githubSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Mọi neo của một tài liệu markdown (bỏ tiêu đề trong khối mã). */
export function markdownAnchors(md: string): Set<string> {
  const out = new Set<string>();
  let fenced = false;
  for (const line of md.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const m = !fenced ? /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line) : null;
    if (m) out.add(githubSlug(m[1]!));
  }
  return out;
}
