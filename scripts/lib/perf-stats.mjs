// Thống kê + đánh giá ngân sách cho đo tải cục bộ (T-049). Hàm thuần — tests/unit/perf-load.test.ts.

/** Phân vị theo phương pháp nearest-rank trên mảng đã/chưa sắp xếp (ms). Rỗng → null (không bịa 0). */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * s.length));
  return s[Math.min(s.length, rank) - 1];
}

/**
 * @param {{latencies:number[], statuses:number[], networkErrors:number, durationMs:number, expected:number[]}} r
 * Lỗi = lỗi mạng/timeout hoặc status ngoài tập mong đợi của kịch bản (5xx luôn là lỗi).
 */
export function summarize(r) {
  const total = r.statuses.length + r.networkErrors;
  const unexpected = r.statuses.filter((s) => !r.expected.includes(s) || s >= 500).length;
  const errors = unexpected + r.networkErrors;
  const lat = r.latencies;
  const round = (x) => (x === null ? null : Math.round(x * 10) / 10);
  const byStatus = {};
  for (const s of r.statuses) byStatus[s] = (byStatus[s] ?? 0) + 1;
  return {
    samples: total,
    ok: total - errors,
    errors,
    errorRate: total === 0 ? null : errors / total,
    rps: r.durationMs > 0 ? Math.round(((total - r.networkErrors) / (r.durationMs / 1000)) * 10) / 10 : null,
    p50: round(percentile(lat, 50)),
    p95: round(percentile(lat, 95)),
    p99: round(percentile(lat, 99)),
    max: round(lat.length === 0 ? null : Math.max(...lat)),
    avg: round(lat.length === 0 ? null : lat.reduce((a, b) => a + b, 0) / lat.length),
    byStatus,
  };
}

/** So với ngân sách {p95Ms, p99Ms?, maxErrorRate, minRps?}; thiếu mẫu hoặc số liệu null → vi phạm (không xanh giả). */
export function evaluateBudget(sum, budget, minSamples = 50) {
  const v = [];
  if (sum.samples < minSamples) v.push(`chỉ ${sum.samples} mẫu (< ${minSamples}) — không đủ để kết luận`);
  if (sum.p95 === null || sum.p95 > budget.p95Ms) v.push(`p95 ${sum.p95 ?? "n/a"} ms > ${budget.p95Ms} ms`);
  if (budget.p99Ms !== undefined && (sum.p99 === null || sum.p99 > budget.p99Ms))
    v.push(`p99 ${sum.p99 ?? "n/a"} ms > ${budget.p99Ms} ms`);
  if (sum.errorRate === null || sum.errorRate > budget.maxErrorRate)
    v.push(
      `tỉ lệ lỗi ${sum.errorRate === null ? "n/a" : `${(sum.errorRate * 100).toFixed(2)}%`} > ${(budget.maxErrorRate * 100).toFixed(2)}%`,
    );
  if (budget.minRps !== undefined && (sum.rps === null || sum.rps < budget.minRps))
    v.push(`RPS ${sum.rps ?? "n/a"} < ${budget.minRps}`);
  return v;
}

/** Số kết nối DB lớn nhất trong các lần lấy mẫu (null nếu không có mẫu). */
export const maxOf = (xs) => (xs.length === 0 ? null : Math.max(...xs));

const fmt = (x, d = "") => (x === null || x === undefined ? "n/a" : `${x}${d}`);

/** Báo cáo Markdown. `meta` có ĐÚNG 5 trường QA-PERF-006: commit, env, device, load, date (+ nhãn). */
export function renderLoadReport(meta, rows, extra = {}) {
  const fails = rows.filter((r) => r.violations.length > 0).length;
  const L = [];
  L.push("---");
  L.push(`title: Báo cáo đo tải cục bộ — X-Company (${meta.date})`);
  L.push(`updated: ${meta.date}`);
  L.push(
    `status: ${fails === 0 ? "ĐẠT ngân sách dev" : "VƯỢT ngân sách"} — faithful-fixture, máy dev (sinh bằng \`npm run -s perf:load\`; không sửa tay)`,
  );
  L.push("---");
  L.push("");
  L.push("# Đo hiệu năng dưới tải cục bộ (T-049, QA-PERF-006)");
  L.push("");
  L.push(
    "> **Nhãn bằng chứng: faithful-fixture.** Bộ tải tự viết (node:http, keep-alive) chạy cùng máy với ứng dụng (`next start` bản build production) và Postgres tạm,",
  );
  L.push(
    "> dữ liệu seed. **Không phải** số đo production/thực địa; bộ phát tải và máy chủ tranh CPU của cùng một máy nên số RPS là cận dưới.",
  );
  L.push("");
  L.push("## 5 trường QA-PERF-006");
  L.push("");
  L.push("| Trường | Giá trị |");
  L.push("|---|---|");
  L.push(`| Commit | \`${meta.commit}\` |`);
  L.push(`| Môi trường | ${meta.env} |`);
  L.push(`| Thiết bị/mạng | ${meta.device} |`);
  L.push(`| Tải | ${meta.load} |`);
  L.push(`| Ngày | ${meta.date} |`);
  L.push("");
  L.push("## Kết quả theo kịch bản");
  L.push("");
  L.push(
    "| Kịch bản | Kết nối | Thời lượng | Mẫu | RPS | p50 ms | p95 ms | p99 ms | Lỗi | Kết nối DB tối đa | Ngân sách (p95 / lỗi) | Kết quả |",
  );
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    const s = r.summary;
    L.push(
      `| ${r.name} | ${r.connections} | ${r.durationLabel} (+${r.warmupLabel} khởi động) | ${s.samples} | ${fmt(s.rps)} | ${fmt(s.p50)} | ${fmt(s.p95)} | ${fmt(s.p99)} | ${s.errors} (${s.errorRate === null ? "n/a" : `${(s.errorRate * 100).toFixed(2)}%`}) | ${fmt(r.dbConnMax)} | ≤ ${r.budget.p95Ms} ms / ≤ ${(r.budget.maxErrorRate * 100).toFixed(1)}% | ${r.violations.length === 0 ? "**ĐẠT**" : "**VƯỢT**"} |`,
    );
  }
  L.push("");
  for (const r of rows) {
    L.push(`### ${r.name}`);
    L.push("");
    L.push(`- Mô tả: ${r.description}`);
    L.push(
      `- Mã trạng thái: ${
        Object.entries(r.summary.byStatus)
          .map(([k, v]) => `${k}×${v}`)
          .join(", ") || "(không có)"
      }; mong đợi: ${r.expected.join("/")}`,
    );
    L.push(`- Ngân sách: ${r.budgetWhy}`);
    if (r.violations.length > 0) L.push(`- **Vi phạm:** ${r.violations.join("; ")}`);
    if (r.note) L.push(`- Ghi chú: ${r.note}`);
    L.push("");
  }
  L.push("## Ngân sách và cách đo");
  L.push("");
  L.push(`- SLO gốc (docs/ops/SLO.md): ${meta.slo}`);
  for (const x of meta.budgetNotes) L.push(`- ${x}`);
  L.push(
    "- Độ trễ đo từ lúc gửi request tới khi nhận hết thân phản hồi (client cùng máy, loopback), không kèm mạng thật. Phân vị nearest-rank trên toàn bộ mẫu sau khởi động; không dùng trung bình làm cổng (XC-PERF-004).",
  );
  L.push(
    "- Khởi động (warm-up) không tính vào số liệu; số kết nối DB lấy mẫu mỗi 250 ms từ `pg_stat_activity` (role ứng dụng).",
  );
  L.push("");
  if (extra.lighthouse) {
    L.push("## Lighthouse cục bộ");
    L.push("");
    L.push(extra.lighthouse);
    L.push("");
  }
  L.push("## Không chứng minh");
  L.push("");
  for (const x of meta.notProven) L.push(`- ${x}`);
  L.push("");
  return L.join("\n");
}
