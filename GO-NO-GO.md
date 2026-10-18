# GO/NO-GO — X-Company · phát hành `v0 (PR #11, lát 8)` · 2026-10-18

> Commit: nhánh `claude/focused-cannon-3iu4lk` (PR #11 vào `main`, nền `db83524`) · Blueprint: MUST đạt 292 · miễn 73 · chưa 108 (106 đã `loop defer` chờ người/hạ tầng, 2 thuộc báo cáo này) · CI: PR #11 xanh trên head đã kiểm (13 check, gồm CodeQL).
> Người kiểm: agent autopilot (report-only) · Phạm vi: website + webapp nội bộ + PWA; chưa có hạ tầng production.

## 1. Đếm (BLOCKER)
| Mức | PASS | FAIL | N/A |
|---|---|---|---|
| BLOCKER | 8 | 6 | 0 |

## 2. Danh mục kiểm
| # | Mục | Kết quả | Nhãn | Bằng chứng |
|---|---|---|---|---|
| 1 | Build tái lập, type/lint sạch | PASS | real-path | `dev-task.sh gate` exit 0; CI job `quality` xanh |
| 2 | Test xanh (unit/DB/HTTP/E2E) | PASS | real-path | 592 test; E2E 31/31 ba lần liên tiếp (desktop + mobile); coverage dòng 97,7% / nhánh 91,9% |
| 3 | Blueprint 0 MUST mở | FAIL | real-path | 108 MUST chưa đạt (xem mục 3) |
| 4 | Không secret trong repo/lịch sử | PASS | real-path | `gitleaks git --log-opts="HEAD --remotes"` 0 phát hiện; CI `gitleaks` xanh (riêng `git log --all` cục bộ có khoá giả trong nhánh backup — BASE-SEC-002 mở) |
| 5 | Phụ thuộc: 0 lỗ hổng cao chưa xử lý; license allowlist | PASS | real-path | CI `osv-scanner`, `dep-audit`, `supply-chain` xanh; ngoại lệ có hạn ở `license-policy.yaml` (D-018) |
| 6 | Kiểm quyền server; test vượt quyền | PASS | real-path | ma trận 401/403/BOLA/BFLA tự liệt kê mọi route (`tests/http/authz-matrix.test.ts`) |
| 7 | Threat model: mối đe doạ Cao có biện pháp + bằng chứng | PASS | real-path | `check:docs` OK (22 mối đe doạ, 10 Cao có bằng chứng) |
| 8 | Migration có đường lùi; rollback diễn tập | FAIL | asserted-not-measured | migration chỉ thêm, `check:migrations` xanh; chưa diễn tập rollback (RUNBOOK `last_drilled = chưa diễn tập`) |
| 9 | Backup bật và khôi phục thử | FAIL | — | chưa có hạ tầng production/backup (OPS-DR-*, DB-BACKUP-* đã defer) |
| 10 | Giám sát + cảnh báo đã thử kích hoạt | FAIL | — | metric RED + SLO đã có trong repo; chưa chạy trên Prometheus/Alertmanager thật (OPS-SLO-001, OPS-OBS-* defer) |
| 11 | Dữ liệu cá nhân: DPIA, đồng ý, chính sách | FAIL | faithful-fixture | DPIA ở dạng nháp; quyền chủ thể + consent chỉ thêm đã có test; thời hạn lưu/danh mục giữ lại chờ HR/pháp chế (D-016, D-020); bật GPS/ảnh thật bị chặn tới khi DPIA + HR xác nhận |
| 12 | Hiệu năng đạt ngưỡng, đo thật | FAIL | asserted-not-measured | xem 2b: ngân sách JS (225,8/230 KB) và Lighthouse CI trên CI đạt; chưa đo CWV p75/INP thực địa, chưa k6 |
| 13 | Tiếp cận: 0 vi phạm axe WCAG 2.2 AA | PASS | real-path | E2E quét mọi trang công khai + 9 màn nội bộ ở 320 px, 0 vi phạm (mọi mức) |
| 14 | Release notes + CHANGELOG | PASS (SHOULD) | real-path | `CHANGELOG.md`, release-please |
| 18 | Đề xuất "Khi chạy thật" đã được chủ dự án quyết | FAIL | — | `docs/autopilot/DECISIONS.md` D-016, D-018, D-020, D-027 có mục "Khi chạy thật"/rủi ro chờ chủ dự án |

### Hiệu năng (QA-PERF-006 — 5 trường)
| Trường | Giá trị |
|---|---|
| Commit | nhánh `claude/focused-cannon-3iu4lk`, `check:perf-budget` chạy tại HEAD lúc ghi (a3215b0 trở đi) |
| Môi trường | build production `next build` (Turbopack), Node 22 sandbox / Node 24 CI, Postgres 17; không phải production |
| Thiết bị/mạng | Lighthouse CI preset mặc định (mobile giả lập) trong job `lighthouse`; Playwright Pixel 7 + Desktop Chrome |
| Tải | chưa chạy k6 (0 VU); chỉ ngân sách tĩnh: JS tĩnh 225,8 KB gzip ≤ 230, 9 trang trong trần, ≤ 14 request/trang |
| Ngày | 2026-10-18 |

## 2b. Bằng chứng chưa chứng minh
| Phạm vi | Vì sao chưa | Kiểm thật khi nào / ai |
|---|---|---|
| CWV p75/INP, tải k6 | chỉ đo tĩnh + Lighthouse giả lập | sau khi có staging/production — chủ dự án + vận hành |
| Backup/khôi phục, DR, giám sát | chưa có hạ tầng | khi chọn hạ tầng — chủ dự án |
| Ruleset nhánh (required checks) | `gh api rulesets` = `[]`, mới là file mẫu | chủ repo import `.github/rulesets/main.json` |
| GPS/QR/ảnh trên dữ liệu thật | chưa có DPIA + xác nhận HR/pháp chế | trước khi bật thu thập thật |
| DAST (ZAP), mã hoá at-rest, Private Vulnerability Reporting | cần docker daemon/hạ tầng/cài đặt repo | chủ dự án / vận hành |
| 6 lệnh `— Kiểm:` lỗi thời hoặc tự khớp | cần người cho phép chỉnh lệnh kiểm | BASE-SEC-002, ARC-STYLE-003, UX-CONTENT-005, BASE-CFG-006, WF-CI-004, SEC-SUPPLY-009 |

## 3. Bảng FAIL
| # | Mức | Mục | Cách sửa đề xuất |
|---|---|---|---|
| 3 | BLOCKER | 108 MUST chưa đạt | người xử lý nhóm đã `loop defer` (ruleset, hạ tầng, pháp chế, lệnh kiểm), rồi `loop resume` |
| 8 | BLOCKER | rollback chưa diễn tập | diễn tập theo `docs/ops/RUNBOOK.md`, ghi `last_drilled` |
| 9 | BLOCKER | backup chưa có | chọn hạ tầng + khôi phục thử |
| 10 | BLOCKER | cảnh báo chưa thử | dựng Prometheus/Alertmanager, chạy PromQL ở `docs/ops/SLO.md` |
| 11 | BLOCKER | DPIA/thời hạn lưu | HR + pháp chế chốt (D-016, D-020) |
| 12 | BLOCKER | hiệu năng thực địa | RUM/CrUX + k6 trên staging |
| 18 | BLOCKER | quyết định "Khi chạy thật" | chủ dự án quyết từng mục |

## 4. Kết luận
**NO-GO cho production.** Phần mã và cổng chất lượng trong repo đã đạt (mục 1, 2, 4–7, 13); các BLOCKER còn lại chỉ người hoặc hạ tầng thật mới đóng được. Đủ điều kiện để merge PR #11 vào `main` (ngoại lệ cứng auth/audit/dữ liệu người dùng → chủ dự án merge) và dùng nội bộ/staging.
Rủi ro còn lại được chấp nhận: yêu cầu review ≥ 1 đặt ở 0 vì chỉ một maintainer (D-027) — người chấp nhận: phiên chính tự duyệt, chủ dự án xác nhận khi phát hành — 2026-10-18.

## 5. Ký (con người, không phải agent)
| Vai trò | Tên | Quyết định | Ngày |
|---|---|---|---|
| Chủ sản phẩm | | | |
| Kỹ thuật / vận hành | | | |
| Bảo mật / pháp lý | | | |
