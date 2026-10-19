# GO/NO-GO — X-Company · phát hành `v0 (lát 8 + lát 9, chạy local)` · 2026-10-19

> Commit: nhánh `claude/focused-cannon-3iu4lk` sau `684d487` (nền `main` sau #17) · Blueprint: MUST đạt 307 · miễn 73 · chưa 93 (cả 93 đã `loop defer` chờ người/hạ tầng thật) · CI: xanh trên các PR đã merge (#11, #17); PR của lát 9 chưa mở.
> Người kiểm: agent autopilot (report-only) · Phạm vi: website + webapp nội bộ + PWA; hạ tầng đã dựng **cục bộ** (nhãn `faithful-fixture`, máy dev), chưa có production.

## 1. Đếm (BLOCKER)
| Mức | PASS | FAIL | N/A |
|---|---|---|---|
| BLOCKER | 10 | 4 | 0 |

## 2. Danh mục kiểm
| # | Mục | Kết quả | Nhãn | Bằng chứng |
|---|---|---|---|---|
| 1 | Build tái lập, type/lint sạch | PASS | real-path | `dev-task.sh gate` exit 0; CI `quality` xanh |
| 2 | Test xanh (unit/DB/HTTP/E2E) | PASS | real-path | E2E 31/31 desktop + mobile; coverage dòng 97,9% / nhánh 92,4% (ngưỡng giữ nguyên) |
| 3 | Blueprint 0 MUST mở | FAIL | real-path | 93 MUST chưa đạt, đều đã hoãn có lý do (hạ tầng/KMS/RUM/ruleset/HR) |
| 4 | Không secret trong repo/lịch sử | PASS | real-path | `gitleaks git --log-opts="HEAD --remotes"` 0 phát hiện; CI `gitleaks` xanh |
| 5 | Phụ thuộc: 0 lỗ hổng cao chưa xử lý; license allowlist | PASS | real-path | CI `osv-scanner`, `dep-audit`, `supply-chain` xanh; ngoại lệ có hạn (D-018) |
| 6 | Kiểm quyền server; test vượt quyền | PASS | real-path | ma trận 401/403/BOLA/BFLA mọi route; DAST nhóm I (chéo người dùng/công ty) PASS |
| 7 | Threat model: mối đe doạ Cao có biện pháp + bằng chứng | PASS | real-path | `check:docs` OK; thêm T23 (mã hoá lúc lưu) |
| 8 | Migration có đường lùi; **rollback deploy đã diễn tập** | FAIL | faithful-fixture | migration chỉ thêm, `check:migrations` xanh, khôi phục DB đã diễn tập; chưa diễn tập rollback deploy (RUNBOOK `last_drilled = chưa diễn tập`) |
| 9 | Backup bật và đã khôi phục thử | PASS | faithful-fixture | `scripts/backup.sh` + `restore-drill.sh`: khôi phục 1,1 triệu dòng (CSDL 461 MB) trong 11,2 s, khớp số dòng và chuỗi audit; `docs/ops/restore-drills.md`. Chỉ trên máy dev: chưa off-site, chưa KMS |
| 10 | Giám sát + cảnh báo đã thử kích hoạt, tới đúng kênh | PASS | faithful-fixture | `npm run -s alerts:drill`: 12/12 luật firing → đúng 3 kênh (JSONL/log/webhook thử) → resolved; chưa kênh trực có người |
| 11 | Dữ liệu cá nhân: DPIA, đồng ý, chính sách | FAIL | faithful-fixture | DPIA đã lập theo Mẫu 10 nhưng CHƯA nộp cơ quan chuyên trách (60 ngày kể từ ngày xử lý thật — việc của chủ dự án); chưa có xác nhận pháp chế; GPS có cổng server (cờ + đồng ý riêng), mặc định tắt; chưa có UI cấp/rút đồng ý GPS |
| 12 | Hiệu năng đạt ngưỡng, đo | PASS | faithful-fixture | `perf:load` 7/7 kịch bản trong ngân sách SLO (p95 23–130 ms), Lighthouse cục bộ 97–99 điểm, LCP 1,6–2,3 s; JS tĩnh 225,9/230 KB. Không phải số thực địa (xem 2b) |
| 13 | Tiếp cận: 0 vi phạm axe WCAG 2.2 AA | PASS | real-path | E2E quét mọi trang công khai + 9 màn nội bộ ở 320 px, 0 vi phạm |
| 14 | Release notes + CHANGELOG | PASS (SHOULD) | real-path | `CHANGELOG.md`, release-please |
| 15 | DAST | PASS (SHOULD) | faithful-fixture | `npm run -s dast` 9/9 nhóm, 155 kiểm tra (XSS có Chromium thật); 4 lỗi thật đã sửa; không phải ZAP |
| 16 | Mã hoá dữ liệu lúc lưu | PASS (SHOULD) | faithful-fixture | AES-256-GCM cột nhạy cảm + tệp tải lên, xoay khoá, `pg_dump` không chứa bản rõ; khoá chủ ở env, chưa KMS/HSM |
| 18 | Đề xuất "Khi chạy thật" đã được chủ dự án quyết | FAIL | — | `docs/autopilot/DECISIONS.md` D-016, D-018, D-020, D-027, D-029…D-038 có mục "Khi chạy thật" chờ chủ dự án |

### Hiệu năng (QA-PERF-006 — 5 trường)
| Trường | Giá trị |
|---|---|
| Commit | nhánh `claude/focused-cannon-3iu4lk`; báo cáo `docs/perf/load-report-2026-10-19.md` ghi commit (kèm +dirty khi cây chưa commit) |
| Môi trường | build production `next start`, Postgres tạm cục bộ, máy dev (không phải production); Node 22 sandbox / Node 24 CI |
| Thiết bị/mạng | localhost loopback; Lighthouse mobile giả lập; Playwright Pixel 7 + Desktop Chrome |
| Tải | 7 kịch bản, kết nối giữ sống, thời lượng + warm-up trong báo cáo; chưa k6, không đa máy |
| Ngày | 2026-10-19 |

## 2b. Bằng chứng chưa chứng minh
| Phạm vi | Vì sao chưa | Kiểm thật khi nào / ai |
|---|---|---|
| CWV p75/INP thực địa, tải đa máy, soak/spike | chỉ đo cục bộ giả lập | staging/production + RUM/CrUX — chủ dự án + vận hành |
| Sao lưu off-site 3-2-1, KMS/HSM, lịch sao lưu tự động, diễn tập trên hạ tầng thật | mới chạy trên máy dev | khi chọn hạ tầng — chủ dự án |
| Prometheus/Alertmanager thật, kênh trực có người, Sentry/OTel | luật cảnh báo chạy bằng bộ đánh giá nội bộ | khi có hạ tầng giám sát |
| ZAP/Burp, TLS thật, WAF/CDN | DAST là bộ probe tự viết trên localhost | staging có TLS — vận hành |
| Ruleset nhánh (required checks, gồm `dast`) | `gh api rulesets` = `[]` | chủ repo import `.github/rulesets/main.json` |
| Giá trị pháp lý (hạn DSAR theo loại, thời hạn lưu, trần OT) | tra từ bản sao thương mại (mức B), chưa đối chiếu bản chính thức/Công báo; chủ dự án uỷ quyền tự quyết | luật sư đối chiếu Luật 91/2025, NĐ 356/2025, BLLĐ 2019, NĐ 145/2020 |
| GPS/QR/ảnh trên dữ liệu thật | cần DPIA nộp + xác nhận HR/pháp chế + UI đồng ý | trước khi bật `GEO_CAPTURE_ENABLED` |
| Quy tắc ca/OT thực tế của công ty | mặc định theo luật; HR chưa cung cấp ví dụ (RK-001) | HR |

## 3. Bảng FAIL
| # | Mức | Mục | Cách sửa đề xuất |
|---|---|---|---|
| 3 | BLOCKER | 93 MUST chưa đạt | người xử lý nhóm đã `loop defer`, rồi `loop resume` |
| 8 | BLOCKER | rollback deploy chưa diễn tập | diễn tập theo `docs/ops/RUNBOOK.md`, ghi `last_drilled` |
| 11 | BLOCKER | DPIA chưa nộp, chưa xác nhận pháp chế | chủ dự án nộp trong 60 ngày từ ngày xử lý thật; luật sư rà |
| 18 | BLOCKER | quyết định "Khi chạy thật" | chủ dự án quyết từng mục |

## 4. Kết luận
**NO-GO cho production.** Mọi thứ làm được trên máy dev đã làm và có bằng chứng (nhãn faithful-fixture): sao lưu/khôi phục, cảnh báo, DAST, đo tải, mã hoá lúc lưu, cổng GPS. Còn lại là việc người/hạ tầng thật (mục 2b và 3). Đủ điều kiện dùng nội bộ/staging.
Rủi ro còn lại được chấp nhận: review ≥ 1 đặt ở 0 vì chỉ một maintainer (D-027); giá trị pháp lý mức B (D-029…D-035) — người chấp nhận: chủ dự án uỷ quyền tự quyết cho phiên chính, chưa có xác nhận pháp chế — 2026-10-19.

## 5. Ký (con người, không phải agent)
| Vai trò | Tên | Quyết định | Ngày |
|---|---|---|---|
| Chủ sản phẩm | | | |
| Kỹ thuật / vận hành | | | |
| Bảo mật / pháp lý | | | |
