# docs/autopilot/PLAN.md — X-Company · P0 lõi (website, điều hành nội bộ, PWA)

> Duyệt: D-006 (phiên chính tự duyệt 2026-10-18) · Spec: docs/specs/SPEC-{identity-org,website-cms,attendance,work,pwa}.md (F-001…F-012) · Blueprint: BLUEPRINT.md · Đầu vào: docs/input/ke-hoach-website-webapp-pwa.md · F01: docs/g0/F01-xboss-audit.md

## Tóm tắt duyệt (cổng duy nhất)
- Blueprint `web-app` quy mô M: 469 MUST (BLUEPRINT.md) · 1.314 SHOULD (BLUEPRINT-BACKLOG.md); tick dần theo lát kèm `— Kiểm:`.
- Stack (ADR-0001, D-002): Next.js 16.4.2 · React 19.3.1 · TypeScript 6.0.3 · pg 8.23.1 SQL thuần · PostgreSQL 17 (chạy được 16) · node:test + tsx 4.23 + c8 12 · Playwright 1.64 · ESLint 10.13 · Prettier 3.9 · Argon2id @node-rs/argon2 2.2.2 · Node ≥ 22.12 (prod 24 LTS).
- Nền mã: repo mới, chép có chọn lọc hạ tầng XBOSS (D-001) — XBOSS không làm nền vì nghiệp vụ thi công (F01).
- 24 task / 7 lát; mỗi lát một PR; Gate là lệnh test cụ thể; test DB chạy trên Postgres thật (không skip).
- Rủi ro chính: RK-001 quy tắc ca/OT chưa được HR chốt (giá trị ⚙ là cấu hình có ngày hiệu lực) · RK-002 GPS/QR hiện trường · RK-003 nợ mang theo khi chép XBOSS · RK-004 khối lượng P0 lớn hơn một phiên — lát xếp theo rủi ro, phần chưa xong ghi rõ ở báo cáo.
- Ngoài phạm vi phiên này: pilot thật, dữ liệu thật, thiết bị thật (AT13, Q02), đo tải trên hạ tầng thật (AT14), restore (AT15), DPIA — cần người.
- Điểm dừng: merge PR ngoại lệ cứng (auth, mật mã, dữ liệu người dùng — `merge_hard_exceptions: human`) → người merge.

## Mục tiêu của kế hoạch này
Một ứng dụng chạy được end-to-end trên Postgres thật: website đọc CMS đã duyệt và nhận liên hệ thành hồ sơ (AT01);
đăng nhập, tổ chức và phân quyền kiểm ở server (AT02, AT12); chấm công chống trùng, ca qua đêm, nghỉ/OT/sửa công có
duyệt, khoá kỳ và xuất (AT03–AT08); công việc–nghiệm thu–tiến độ (AT09–AT11); PWA có hàng chờ ngoại tuyến (AT05).
Đo được bằng: bộ test kịch bản S-* xanh trong CI + `blueprint-status --run`.

## Ngân sách (4 con số)
- Số vòng tối đa: (bỏ trống — `--single-session` tự tính max(40, 8 × task chưa làm))
- Ngân sách: 12.000.000 token
- Timeout mỗi lệnh Gate: 1800 giây (`XT_RECORD_TIMEOUT`)
- Ngày hết hạn: 2026-10-20T06:00:00Z (`--hours 48`)

## Hạn
| Loại | Ngày | Hậu quả nếu trễ | Cách xử lý khi trễ |
|---|---|---|---|
| Hạn thật | (chưa có — kế hoạch tính từ T0 khi có đầu mối nghiệp vụ) | — | — |
| Hạn mong muốn | 2026-10-20 | nội bộ phiên | cắt lát 7 → backlog, không hạ cổng |

## Ủy quyền production (người duyệt một lần ở đây; máy kiểm bằng `xt.py grant-check`, ADR-0022)
- grant: payments | mode=sandbox | max_per_txn=0 | refund=false
- grant: data_delete | hard_delete=false | max_rows=100
- grant: data_export | pii=false | max_rows=10000
- grant: outbound_messages | live=false | max_per_hour=0
- grant: auth_crypto | custom_crypto=false
- grant: secrets | read_values=false

## Điểm dừng bắt buộc về hành động
- Xoá/đổi/xuất dữ liệu người dùng thật, migration phá vỡ trên production, drop cột/bảng
- Tiền thật, đăng ký dịch vụ trả phí/nhập khoá thật, gửi tin tới người dùng thật
- Merge PR ngoại lệ cứng (`merge-check` = `hard`: auth, mật mã, dữ liệu người dùng, bí mật) khi `merge_hard_exceptions: human`
- Bật thu GPS/ảnh trên dữ liệu thật trước khi có DPIA và xác nhận của HR/pháp chế (§12)
- Import ruleset `.github/rulesets/main.json` lên GitHub (ghi ruleset qua `gh api` bị guard chặn — người làm trong Settings)
- (Deploy/publish, sửa CI/hook kèm lý do, thêm phụ thuộc: không dừng. Spec hở: tự quyết, `loop decide`.)

## Thứ tự & lý do
1. Lát 1 — Nền: công cụ, DB thật, CI — mọi lát sau cần cổng thật.
2. Lát 2 — Danh tính, tổ chức, quyền, audit — mọi nghiệp vụ dựa vào `can()` và audit (rủi ro rò dữ liệu cao nhất).
3. Lát 4 — Chấm công trước website vì là rủi ro nghiệp vụ lớn nhất (RK-001) và G2 kế hoạch đòi luồng tới khoá kỳ; nhưng website (lát 3) nhỏ và độc lập nên làm xen trước để có giá trị sớm (mốc tuần 4–6).
4. Lát 5 — Công việc/nghiệm thu/tiến độ; lát 6 — PWA (cần API chấm công + task); lát 7 — dashboard + E2E đầy đủ.

## Task

### Lát 1 — Nền (F-000)
- [x] `T-001` Khởi tạo Next.js + TS strict + ESLint + Prettier + node:test/c8; điền xt.yaml lệnh thật (F-000) — Gate: `.xtemplates/scripts/dev-task.sh gate`
- [x] `T-002` Postgres thật cho test (`scripts/with-test-db.sh`), migration runner append-only + checksum, role ứng dụng không superuser/BYPASSRLS (F-000) — Gate: `npm run -s test:file -- tests/db/migrate.test.ts`
- [x] `T-003` CI: job quality (gate + coverage + format_check), protection-guard, gitleaks, dep-audit; ghim SHA action (F-000) — Gate: `python3 .xtemplates/scripts/xt.py ci-check .github/workflows`

### Lát 2 — Danh tính, tổ chức, quyền, audit (F-001, F-002)
- [x] `T-004` audit_event chỉ thêm + chuỗi băm + `verify-audit-chain` (S-ID-08) — Gate: `npm run -s test:file -- tests/db/audit.test.ts`
- [x] `T-005` Tổ chức: company/branch/department (cây, chặn chu trình)/worksite/employee/employment_history hiệu lực theo khoảng — Gate: `npm run -s test:file -- tests/db/org.test.ts`
- [x] `T-006` `can()` thuần + role_grant + phạm vi cây phòng ban, R1–R7 (S-ID-01..04, 06) — Gate: `npm run -s test:file -- tests/unit/authz.test.ts tests/db/authz-scope.test.ts`
- [x] `T-007` Đăng nhập Argon2id, phiên băm, CSRF, rate limit, thu hồi tức thì (S-ID-05, 07, 09) — Gate: `npm run -s test:file -- tests/http/auth.test.ts`

### Lát 3 — Website, CMS, liên hệ (F-003)
- [x] `T-008` CMS: trang/phiên bản, luồng nháp→duyệt→xuất bản, người duyệt ≠ tác giả, markdown an toàn (S-WEB-02, 03, 06) — Gate: `npm run -s test:file -- tests/db/cms.test.ts`
- [x] `T-009` Trang công khai đọc bản published + sitemap/robots/redirect (S-WEB-02) — Gate: `npm run -s test:file -- tests/http/public-site.test.ts`
- [x] `T-010` Liên hệ & tuyển dụng: một hồ sơ/submission_id, định tuyến, honeypot, rate limit, tách quyền ứng viên (S-WEB-01, 04, 05) — Gate: `npm run -s test:file -- tests/http/inquiry.test.ts`

### Lát 4 — Chấm công (F-004, F-005, F-006)
- [ ] `T-011` `computeShift` thuần: ca qua đêm, nhiều cặp, chồng lấn, nghỉ, thiếu checkout, segments (S-AT-01, 02) — Gate: `npm run -s test:file -- tests/unit/compute-shift.test.ts`
- [ ] `T-012` Sự kiện công chống trùng + QR ký HMAC + lệch giờ/offline (S-AT-03..06, 09) — Gate: `npm run -s test:file -- tests/http/attendance-events.test.ts`
- [ ] `T-013` Nghỉ phép sổ biến động + OT hạn mức đồng thời + phê duyệt không tự duyệt (S-AT-08) — Gate: `npm run -s test:file -- tests/db/leave-ot.test.ts`
- [ ] `T-014` Sửa công có duyệt + kỳ công 5 trạng thái + khoá + xuất CSV có phiên bản/checksum + log muộn (S-AT-07) — Gate: `npm run -s test:file -- tests/db/period.test.ts`

### Lát 5 — Công việc, nghiệm thu, tiến độ, tệp (F-007…F-010)
- [ ] `T-015` Dự án/hạng mục/task, máy trạng thái, lịch sử, khoá lạc quan (S-WK-01, 02, 06) — Gate: `npm run -s test:file -- tests/db/tasks.test.ts`
- [ ] `T-016` Tiến độ 3 con số trên lá baseline (S-WK-03, ví dụ 35%) + cảnh báo nghỉ khi phân công (S-WK-04) — Gate: `npm run -s test:file -- tests/unit/progress.test.ts tests/db/assign-warning.test.ts`
- [ ] `T-017` Tệp private qua route kiểm quyền + bình luận (S-WK-05) — Gate: `npm run -s test:file -- tests/http/files.test.ts`
- [ ] `T-018` Giờ dự án + đối chiếu với công (AT08) — Gate: `npm run -s test:file -- tests/db/timesheet.test.ts`

### Lát 6 — Giao diện nội bộ & PWA (F-011)
- [ ] `T-019` Giao diện nội bộ: đăng nhập, Hôm nay, Công việc, Chấm công, Phê duyệt (server components gọi lib) — Gate: `npm run -s build`
- [ ] `T-020` Manifest + service worker + trang ngoại tuyến (S-PWA-04) — Gate: `npm run -s test:file -- tests/unit/manifest.test.ts`
- [ ] `T-021` Hàng chờ IndexedDB + `/api/app/sync` + trạng thái hiển thị (S-PWA-01, 03) — Gate: `npm run -s test:file -- tests/unit/offline-queue.test.ts tests/http/sync.test.ts`
- [ ] `T-022` Đăng xuất xoá dữ liệu thiết bị, DB theo user (S-PWA-02) — Gate: `npm run -s test:file -- tests/unit/device-data.test.ts`

### Lát 7 — Dashboard & E2E (F-012)
- [ ] `T-023` Dashboard ngoại lệ có owner + next_action, bảng mốc riêng — Gate: `npm run -s test:file -- tests/db/dashboard.test.ts`
- [ ] `T-024` E2E đầy đủ luồng chính AT01/AT03/AT06/AT09/AT12 + axe (QA-E2E-023) — Gate: `npm run -s e2e`

## Phụ thuộc ngoài
| Việc | Bên ngoài | Ngày cam kết | Kế hoạch B |
|---|---|---|---|
| Quy tắc ca/OT/nghỉ (F02) | HR công ty | chưa có | giá trị ⚙ là cấu hình có hiệu lực, đổi không cần sửa mã |
| DPIA + căn cứ thu GPS | HR + pháp chế | chưa có | GPS tắt mặc định; QR + ca vẫn chạy |
| Nội dung website đã duyệt | Kinh doanh | chưa có | nội dung mẫu đánh dấu "nội dung mẫu" trong seed dev, không seed production |

## Ước lượng
| Lát | P50 | P90 |
|---|---|---|
| 1 | 0,5 ngày | 1 ngày |
| 2 | 1 ngày | 2 ngày |
| 3 | 0,5 ngày | 1 ngày |
| 4 | 1,5 ngày | 3 ngày |
| 5 | 1 ngày | 2 ngày |
| 6 | 1 ngày | 2 ngày |
| 7 | 0,5 ngày | 1 ngày |
Tổng: P50 6 ngày-agent · P85 ~10 (không cộng P50 làm ngày hứa). Đây là lõi kỹ thuật; dự toán người-tuần của kế hoạch §15 vẫn là căn cứ ngân sách.
