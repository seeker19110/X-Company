---
title: Ngân sách hiệu năng — X-Company
updated: 2026-10-18
status: hiệu lực — số đo lab/build; RUM tự làm đã có (T-056, cờ `RUM_ENABLED` tắt mặc định) nhưng chưa có số thực địa
---

# Ngân sách hiệu năng (FE-PERF-002, FE-PERF-004, XC-PERF-003, XC-GREEN-001/002, PRF-WEB-005)

Nguồn ngưỡng: PROJECT.md mục 5 (R-006: LCP ≤ 2,5 s · INP ≤ 200 ms · CLS ≤ 0,1, p75 mobile). Ngân sách sống ở tệp máy đọc và **làm CI đỏ khi vượt** — tài liệu này chỉ giải thích lý do.

| Ngân sách | Tệp máy đọc | Cổng | Ngưỡng | Lý do |
|---|---|---|---|---|
| JS gzip "first load" mỗi trang | `perf-budget.json` → `routes.*.max_js_gzip_kb` | `npm run -s check:perf-budget` (job CI `lighthouse`) | trang công khai ≤ 195 KB, trang nội bộ ≤ 205 KB | baseline 172–178 KB (Next + React là phần lớn); chừa ~10% cho tính năng, vượt = phải giải thích |
| Số request mỗi trang (tài liệu + JS + CSS) | `perf-budget.json` → `max_requests` | như trên | ≤ 14 | baseline 11–12; giữ HTTP/2 nhẹ trên mạng di động |
| Tổng JS `.next/static` gzip | `perf-budget.json` → `max_static_js_gzip_kb_total` | như trên | ≤ 230 KB | baseline 193,4 KB; chặn chunk mới phình ngoài các trang đã liệt kê |
| LCP / CLS / TBT, điểm Performance (mobile, median 3 lần) | `lighthouserc.json` → `assert.assertions` | `npm run lighthouse` (job CI `lighthouse`) | LCP ≤ 2 500 ms · CLS ≤ 0,1 · TBT ≤ 300 ms · Performance ≥ 0,9 | R-006; TBT là proxy lab của INP (INP chỉ đo được trên người dùng thật) |
| Byte JS và tổng byte tải (Lighthouse) | `lighthouserc.json` | như trên | script ≤ 200 000 B · tổng ≤ 400 000 B | đo thật trên `next start` (đã nén), kiểm chéo với số gzip tĩnh |

URL đo Lighthouse: `/`, `/dich-vu`, `/lien-he` (công khai), chạy trên `next start` với DB seed như e2e (`scripts/lighthouse.sh`, lhci `@lhci/cli@0.15.1` ghim phiên bản). Trang nội bộ (`/app/*`) cần đăng nhập — chỉ có ngân sách bundle, chưa có Lighthouse.

## Cách đo bundle
`scripts/check-perf-budget.mjs` đọc output `next build` (Turbopack): với mỗi trang, JS first-load = `rootMainFiles` + polyfill (`.next/build-manifest.json`) + `entryJSFiles` (`page_client-reference-manifest.js`), nén gzip mức 9; request = 1 tài liệu + JS + CSS. Chưa có bản build thì script tự chạy `npm run -s build`. Trang mới chưa có trong `perf-budget.json` → đỏ (buộc đặt ngân sách khi thêm trang).

## Baseline (XC-GREEN-001)
`docs/perf/baseline-YYYY-MM-DD.json`: KB gzip + số request từng trang, tổng JS tĩnh, ngày và commit. Lệch > `baseline_tolerance_pct` (10%) so với baseline mới nhất thì in **cảnh báo** (không đỏ). Sinh lại bằng `node scripts/check-perf-budget.mjs --write-baseline docs/perf/baseline-<ngày>.json` (chỉ khi cố ý chấp nhận mức mới; ghi lý do ở PR). Không gồm ảnh/phông/XHR; chưa đo CPU/RAM/kWh trên 1 000 yêu cầu (backend) — việc còn lại của XC-GREEN-001 phần backend.

## Đổi ngân sách
Nâng ngưỡng = sửa `perf-budget.json`/`lighthouserc.json` trong PR kèm lý do (đo trước/sau); không nâng chỉ để cổng xanh. Test cổng (`tests/unit/perf-budget.test.ts`) chứng minh: thêm 200 KB JS → đỏ.

## Chưa làm / giới hạn
- RUM tự làm đã có (T-056, D-042: beacon `app/components/rum-beacon.tsx` → `/api/public/rum` → `rum_web_vitals_p75` + 3 luật `XCRum*`), nhưng chưa có số p75 thực địa: cần bật `RUM_ENABLED` và có người dùng production (PRF-WEB-005 cần ≥ 5 URL ở p75; nhãn trang hiện gộp theo `/`, `/app/<phân hệ>`, `/[...slug]`). CrUX chưa dùng. Beacon gắn ở layout `(public)`, layout `(secure)` và trang đăng nhập (không ở root layout: client component ở root làm tổng JS static +3,4 KB, vượt trần 230 KB). Không tách mobile/desktop (FE-PERF-001) — chưa có chiều đó trong mẫu.
- Lighthouse CI là job `lighthouse`, job con của `quality` (required check của ruleset `.github/rulesets/main.json`) — đỏ thì chặn merge; ruleset có hiệu lực khi chủ dự án import.
- Ngân sách kích thước image container (XC-GREEN-002) và thời gian/số job CI mỗi PR chưa có — dự án chưa build image container.

## Đo tải cục bộ (T-049, faithful-fixture)
`npm run -s perf:load` (`scripts/perf-load.mjs`, bộ tải node:http keep-alive) đánh bản build production + Postgres tạm ở cổng riêng (3300), sinh báo cáo `docs/perf/load-report-<ngày>.md` + `.json` (mặc định ra thư mục tạm để Gate không làm đổi cây; cập nhật bản đã commit bằng `npm run -s reports:refresh`, chạy `npm run -s lighthouse` trước nếu muốn có mục Lighthouse) với 5 trường QA-PERF-006 (commit, môi trường, thiết bị/mạng, tải, ngày) và exit ≠ 0 khi vượt ngân sách. Ngân sách ở hằng `BUDGETS` trong script (kèm lý do; ghi chấm công/OT dùng nguyên SLO p95 < 1 s); kết nối DB ≤ 12. Số đo là máy dev, **không** phải CWV p75/INP thực địa, mạng thật hay tải đa máy — xem mục "Không chứng minh" của từng báo cáo. Kết quả `npm run lighthouse` (nếu có `.lighthouseci/`) được gộp vào cùng báo cáo.
