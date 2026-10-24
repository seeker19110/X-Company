# GO/NO-GO — X-Company · phát hành `v0 (lát 8–15, chạy local)` · 2026-10-24

> Commit: `927ee82` (head PR #74, lát 15 — TOTP + SEC-007/010; đã merge `b35d051`) trên `main` `33e7e1a` (#73, lát 14 đã merge) · Blueprint: MUST mở 91 (đều chờ người/hạ tầng thật, `loop defer`) · CI PR #74 trên head: gate, test, e2e, dast, drills, lighthouse, readme-smoke, gitleaks, codeql, pr-policy xanh; kết quả CodeQL báo 1 cảnh báo — báo nhầm, xử lý ở commit kế (mục 15).
> Người kiểm: agent autopilot (report-only, pha harden — ADR-0031) · Phạm vi: website + webapp nội bộ + PWA; hạ tầng dựng **cục bộ** (nhãn `faithful-fixture`, máy dev), chưa có production.

## 0. Máy: `xt.py release-check` @ `927ee82` — **NO-GO**
Lệnh: `PATH=$PWD/.tools/bin:$PATH PW_CHROMIUM_PATH=… python3 .xtemplates/scripts/xt.py release-check --blueprint BLUEPRINT.md --status docs/ops/AUDIT-STATUS.md` (sau `loop verify --all`: 8 Gate lát 14–15 + 313/316 lệnh Kiểm blueprint xanh).

| Hàng | Mức | Kết quả | Bằng chứng máy |
|---|---|---|---|
| blueprint | BLOCKER | FAIL | MUST mở 91 · lệnh Kiểm đỏ 3: LOOP-ORCH-003, LOOP-STOP-001, LOOP-STOP-002 (guard chặn chạy lệnh `loop` lồng trong phiên — FB-088; xanh khi chạy ngoài phiên) · 2 MUST tick không có lệnh kiểm |
| audit | BLOCKER | FAIL | `audit check --strict`: 1 🟠 mở — CFG-001 (`.env.example` lệch mã; hook chặn agent ghi tệp này, D-050 — chờ người). SEC-002 (TOTP), DOC-001, DOC-002 đã đóng ở lát 14–15 |
| verify | BLOCKER | FAIL | chỉ 3 lệnh LOOP-* ở trên đỏ; mọi Gate T-079…T-087 xanh lại trên `927ee82` |
| tree | BLOCKER | PASS | cây sạch |
| prod_switch | BLOCKER | N/A (người) | 20 đề xuất "Khi chạy thật" trong `docs/autopilot/DECISIONS.md` (thêm D-058: kênh email/Web Push cho thông báo) |
| phase | BLOCKER | PASS | `delivery_phase: harden` |
| review_debt | BLOCKER | FAIL → giải | 55 file của PR #74 đổi sau SHA quét `33e7e1a` — đã được `reviewer-alt` đọc (0 🔴, 2 🟠 đã sửa có test); SHA quét đã dời sang commit merge `b35d051` (T-088) |
| attack | BLOCKER | FAIL (môi trường) | `npm run -s dast` cần Docker (ZAP 2.17) — máy dev phiên này không có Docker daemon; CI `dast` (ZAP baseline + quét chủ động) và `drills` (ZAP qua https staging) **xanh** trên head PR #74; `dast:probes` cục bộ 9/9 nhóm PASS |
| perf | BLOCKER | PASS | `npm run -s perf:load` exit 0 |

## 1. Đếm (BLOCKER)
| Mức | PASS | FAIL | N/A |
|---|---|---|---|
| BLOCKER | 3 | 5 | 1 |

## 2. Danh mục kiểm
| # | Mục | Kết quả | Nhãn | Bằng chứng |
|---|---|---|---|---|
| 1 | Build tái lập, type/lint sạch | PASS | real-path | `dev-task.sh gate` exit 0; CI `quality` xanh |
| 2 | Test xanh (unit/DB/HTTP/E2E) | PASS | real-path | `dev-task.sh gate` 964/964 unit/DB/HTTP; E2E 89/89 desktop + mobile (axe 320 + 1280 px, gồm form ứng tuyển, thông báo, bước mã TOTP); FE-TEST-003 `--repeat-each=3` xanh; coverage giữ ngưỡng |
| 3 | Blueprint 0 MUST mở | FAIL | real-path | 90 MUST chưa đạt, đều đã hoãn có lý do (hạ tầng/KMS/RUM/ruleset/HR); 313/316 lệnh Kiểm xanh (mục 0) |
| 4 | Không secret trong repo/lịch sử | PASS | real-path | `gitleaks git --log-opts="HEAD --remotes"` 0 phát hiện; CI `gitleaks` xanh |
| 5 | Phụ thuộc: 0 lỗ hổng cao chưa xử lý; license allowlist | PASS | real-path | CI `osv-scanner`, `dep-audit`, `supply-chain` xanh; ngoại lệ có hạn (D-018) |
| 6 | Kiểm quyền server; test vượt quyền | PASS | real-path | ma trận 401/403/BOLA/BFLA mọi route (gồm `/api/app/notifications*`, `/api/app/auth/mfa`); DAST nhóm I PASS; TOTP bắt buộc sysadmin/hr/executive (AUD-SEC-002); không bỏ được sysadmin công ty cuối (SEC-007/010) |
| 7 | Threat model: mối đe doạ Cao có biện pháp + bằng chứng | PASS | real-path | `check:docs` OK; thêm T23 (mã hoá lúc lưu) |
| 8 | Migration có đường lùi; **rollback deploy đã diễn tập** | FAIL | faithful-fixture | migration chỉ thêm, `check:migrations` xanh, khôi phục DB đã diễn tập; chưa diễn tập rollback deploy (RUNBOOK `last_drilled = chưa diễn tập`) |
| 9 | Backup bật và đã khôi phục thử | PASS | faithful-fixture | `scripts/backup.sh` + `restore-drill.sh`: khôi phục 1,1 triệu dòng (CSDL 461 MB) trong 11,2 s, khớp số dòng và chuỗi audit; off-site bằng restic (kho mã hoá, `restic check`, khôi phục từ kho sau khi xoá bản cục bộ — `tests/db/backup-offsite.test.ts`); khoá dữ liệu qua KMS OpenBao Transit chạy thật (`tests/db/kms-transit.test.ts`). Chỉ trên máy dev: chưa có đích off-site/KMS thuê thật |
| 10 | Giám sát + cảnh báo đã thử kích hoạt, tới đúng kênh | PASS | faithful-fixture | `npm run -s alerts:drill`: 16/16 luật cục bộ (chạy lại 2026-10-24) firing → đúng 3 kênh → resolved; `npm run -s ops:stack:drill`: Prometheus 3.14 + Alertmanager 0.34 thật — `promtool test rules` mọi rule (ca bắn/không bắn), scrape `/api/metrics` có bearer, firing/resolved tới webhook (`docs/ops/ops-stack-drill.md`); chưa kênh trực có người |
| 11 | Dữ liệu cá nhân: DPIA, đồng ý, chính sách | FAIL | faithful-fixture | DPIA đã lập theo Mẫu 10 nhưng CHƯA nộp cơ quan chuyên trách (60 ngày kể từ ngày xử lý thật — việc của chủ dự án); chưa có xác nhận pháp chế; GPS có cổng server (cờ + đồng ý riêng), mặc định tắt; chưa có UI cấp/rút đồng ý GPS |
| 12 | Hiệu năng đạt ngưỡng, đo | PASS | faithful-fixture | `perf:load` 8/8 kịch bản trong ngân sách (thêm chốt kỳ 200 nhân viên × 31 ngày: 4,2–6,4 s, 25 câu SQL; `docs/perf/load-report-2026-10-21.md` trên commit sạch `0c553b4`), Lighthouse cục bộ 97–99 điểm, LCP 1,6–2,3 s; JS tĩnh ≤ 225,9/230 KB (giảm từ 229,7 — T-071). Không phải số thực địa (xem 2b) |
| 13 | Tiếp cận: 0 vi phạm axe WCAG 2.2 AA | PASS | real-path | E2E quét mọi trang công khai + màn nội bộ (thêm /app/thong-bao, bước mã/đăng ký TOTP, dải ngoại tuyến) ở 320 và 1280 px, 0 vi phạm; chưa kiểm NVDA/VoiceOver |
| 14 | Release notes + CHANGELOG | PASS (SHOULD) | real-path | `CHANGELOG.md`, release-please |
| 15 | DAST | PASS (SHOULD) | faithful-fixture | `dast:probes` 9/9 nhóm (đăng nhập người dùng có TOTP); CI `dast` (ZAP baseline + chủ động) và `drills` (ZAP qua https staging) xanh — form ứng tuyển thêm vào allowlist 10202/20012 theo đường dẫn (D-061, cùng lập luận D-047); CodeQL PR #74 báo "băm mật khẩu yếu" ở `sha256(challenge)` — báo nhầm: `challenge` là token ngẫu nhiên 256 bit (như token phiên), luồng taint bắt đầu từ tên hàm test `passwordStep` (đã đổi tên) |
| 16 | Mã hoá dữ liệu lúc lưu | PASS (SHOULD) | faithful-fixture | AES-256-GCM cột nhạy cảm + tệp tải lên, xoay khoá, `pg_dump` không chứa bản rõ; khoá chủ ở env, chưa KMS/HSM |
| 18 | Đề xuất "Khi chạy thật" đã được chủ dự án quyết | FAIL | — | `docs/autopilot/DECISIONS.md` D-016, D-018, D-020, D-027, D-029…D-044, D-047 có mục "Khi chạy thật" chờ chủ dự án |

### Hiệu năng (QA-PERF-006 — 5 trường)
| Trường | Giá trị |
|---|---|
| Commit | `0c553b4` (cây sạch — `perf:load` từ chối ghi báo cáo vào repo khi cây bẩn, AUD-PERF-003); báo cáo `docs/perf/load-report-2026-10-21.md` |
| Môi trường | build production `next start`, Postgres tạm cục bộ, máy dev (không phải production); Node 22 sandbox / Node 24 CI |
| Thiết bị/mạng | localhost loopback; Lighthouse mobile giả lập; Playwright Pixel 7 + Desktop Chrome |
| Tải | 8 kịch bản (7 HTTP + chốt kỳ), kết nối giữ sống, thời lượng + warm-up trong báo cáo; chưa k6, không đa máy |
| Ngày | 2026-10-21 |

## 2b. Bằng chứng chưa chứng minh
| Phạm vi | Vì sao chưa | Kiểm thật khi nào / ai |
|---|---|---|
| CWV p75/INP thực địa, tải đa máy, soak/spike | RUM tự host đã có (beacon + `/api/public/rum` + p75 + cảnh báo, mặc định tắt `RUM_ENABLED`), nhưng chưa có người dùng thật nên chưa có số thực địa; tải đo cục bộ giả lập | bật RUM trên staging/production sau khi có pháp nhân (D-043) + CrUX — chủ dự án + vận hành |
| Sao lưu off-site 3-2-1, KMS/HSM, lịch sao lưu tự động, diễn tập trên hạ tầng thật | mới chạy trên máy dev | khi chọn hạ tầng — chủ dự án |
| Hạ tầng giám sát production, kênh trực có người, Sentry/OTel | Prometheus/Alertmanager mới chạy cục bộ (drill), kênh là webhook thử | khi có hạ tầng giám sát — vận hành |
| Chứng chỉ ACME công khai, staging/production thật, WAF/CDN, pentest | staging TLS là Caddy `tls internal` (CA nội bộ) trên máy dev; mẫu ACME ở `ops/caddy/Caddyfile` mới kiểm cú pháp | tên miền + máy chủ thật — vận hành |
| Ruleset nhánh (required checks `quality` — job tổng hợp mọi job `ci.yml` gồm gate, test, e2e, dast, drills — và `gitleaks`; `pr-policy`, `codeql`, `merge-gate` là advisory theo ADR-0039, AUD-CI-004) | ruleset chưa import | chủ repo import `.github/rulesets/main.json` |
| Giá trị pháp lý (hạn DSAR theo loại, thời hạn lưu, trần OT) | tra từ bản sao thương mại (mức B), chưa đối chiếu bản chính thức/Công báo; chủ dự án uỷ quyền tự quyết | luật sư đối chiếu Luật 91/2025, NĐ 356/2025, BLLĐ 2019, NĐ 145/2020 |
| Pháp nhân (bên kiểm soát dữ liệu) | dự án chưa thành lập công ty; hệ thống chỉ chạy dữ liệu mẫu, không xử lý dữ liệu thật của bên thứ ba (DPIA mục 0b, D-043) | chủ dự án thành lập pháp nhân → mốc 60 ngày nộp DPIA bắt đầu từ ngày xử lý thật đầu tiên |
| GPS/QR/ảnh trên dữ liệu thật | cần DPIA nộp + xác nhận HR/pháp chế + UI đồng ý; thời hạn lưu toạ độ 90 ngày (`RETENTION_GEO_DAYS`, D-056) là giả định | trước khi bật `GEO_CAPTURE_ENABLED` |
| Quy tắc ca/OT thực tế của công ty | mặc định theo luật; HR chưa cung cấp ví dụ (RK-001) | HR |

## 3. Bảng FAIL
| # | Mức | Mục | Cách sửa đề xuất |
|---|---|---|---|
| 3 | BLOCKER | 90 MUST chưa đạt | người xử lý nhóm đã `loop defer`, rồi `loop resume` |
| 8 | BLOCKER | rollback deploy chưa diễn tập | diễn tập theo `docs/ops/RUNBOOK.md`, ghi `last_drilled` |
| 11 | BLOCKER | DPIA chưa nộp, chưa xác nhận pháp chế | chủ dự án nộp trong 60 ngày từ ngày xử lý thật; luật sư rà |
| 18 | BLOCKER | quyết định "Khi chạy thật" (20 mục) | chủ dự án quyết từng mục |
| 0/audit | BLOCKER | 1 🟠 mở: CFG-001 | chủ dự án thêm các khoá ở `PENDING_EXAMPLE_KEYS` (`scripts/check-env.ts`) vào `.env.example` rồi xoá khỏi danh sách (D-050) |
| 0/review_debt | BLOCKER | sổ audit ghi SHA trước PR #74 | sau merge #74: dời SHA nhóm sang commit merge, chạy lại `release-check` |
| 0/attack | BLOCKER | `dast` cục bộ cần Docker | chạy `release-check` trên máy có Docker, hoặc dựa CI `dast`/`drills` (xanh) |

## 4. Kết luận
**NO-GO cho production.** Mọi thứ làm được trên máy dev đã làm và có bằng chứng (nhãn faithful-fixture): sao lưu/khôi phục (cả off-site restic), KMS OpenBao, cảnh báo (cả Prometheus/Alertmanager thật), DAST (cả ZAP qua https), staging TLS, đo tải, mã hoá lúc lưu, cổng GPS. Còn lại là việc người/hạ tầng thật (mục 2b và 3). Đủ điều kiện dùng nội bộ/staging.
Rủi ro còn lại được chấp nhận: review ≥ 1 đặt ở 0 vì chỉ một maintainer (D-027); giá trị pháp lý mức B (D-029…D-035) — người chấp nhận: chủ dự án uỷ quyền tự quyết cho phiên chính, chưa có xác nhận pháp chế — 2026-10-19. Lát 12–13 (2026-10-22): audit delta pha harden 0 🔴; 🟢 mở ghi sổ có điều kiện kích hoạt (D-057).

Lát 14–15 (2026-10-24): đóng 3 🟠 phiên trước để chờ người — form ứng tuyển, thông báo trong ứng dụng tự host, TOTP hai bước (D-058…D-063); review khác họ model mỗi lát; còn 1 🟠 (CFG-001, chờ người).

## 5. Ký (con người, không phải agent)
| Vai trò | Tên | Quyết định | Ngày |
|---|---|---|---|
| Chủ sản phẩm | | | |
| Kỹ thuật / vận hành | | | |
| Bảo mật / pháp lý | | | |
