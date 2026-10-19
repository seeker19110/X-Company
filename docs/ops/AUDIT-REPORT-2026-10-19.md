# AUDIT-REPORT — X-Company · 2026-10-19

> Commit gốc ghi sổ: `d65fdb773d75cdaa887b264e618d7c9d26cc4205` (origin/main) · Cây thực quét: `cc6f359` = main + PR #33/#35/#36 chưa merge (nhánh `verify/lat-10`) · Phạm vi: toàn bộ 13 nhóm · Người quét: Claude (phiên chính + 6 subagent Opus/Sonnet) · Xác minh đối kháng: Sonnet (13/13 tái hiện; hạ HAR-001 🔴→🟠, HAR-002 🟠→🟢)
> `xt.py audit check docs/ops/AUDIT-STATUS.md` → exit 0

## 1. Tóm tắt
| Mức | Mở | Đã sửa | Chấp nhận | Bác bỏ |
|---|---|---|---|---|
| 🔴 | 0 | 0 | 0 | 0 |
| 🟠 | 16 | 0 | 0 | 0 |
| 🟢 | 39 | 0 | 0 | 0 |

Kết luận: không có 🔴, không có BOLA/IDOR trên route đang mở; 16 🟠 chặn phát hành production (DoS bộ nhớ body chunked, khoá tài khoản khi thiếu TRUST_PROXY, PII còn sót sau xoá/ẩn danh, logic duyệt phép/sửa công, 3 cổng CI hở, focus bị che ở 320 px). Hệ thống vẫn chỉ chạy dữ liệu mẫu (D-043) nên chưa có thiệt hại thật.

Lưu ý trung thực về mức tin cậy: CODE-006/007/008 mới được đọc mã xác nhận (phiên chính), **chưa tái hiện bằng test DB**; A11Y-001 chỉ có một người quét đo, **chưa xác minh đối kháng độc lập**; SEC-002, CI-002, CFG-001 một phần là `chưa biết`/việc của người. Các mục còn lại 🟠 đã có tái hiện độc lập.

## 2. Phạm vi và tín hiệu
`xt.py audit plan --json`: HEAD `cc6f359`, 587 tệp (js/ts 310, shell 20, python 1), UI 37 tệp, DB 26 migration, 10 workflow. Nhóm áp dụng: cả 13. `rút gọn`: TEST, PERF, CFG (xem sổ). Công cụ đã cài vào scratch và chạy: semgrep, zizmor, actionlint, shellcheck, osv-scanner, lychee, knip, depcruise, jscpd, gitleaks. Còn thiếu/không chạy: stryker (chưa có cấu hình mutation) → `chưa biết:`; đọc `.env.example` bị guard chặn → `chưa biết:`.

Mở lại 32 mục bằng chứng/miễn trừ blueprint trỏ tệp đã đổi: nội dung đúng, chỉ lệch số dòng (HAR-003). `xt.py doctor --json` ok, 0 phát hiện.

## 3. Lệnh đã chạy
| Nhóm | Lệnh | Exit | Kết quả chính |
|---|---|---|---|
| ARCH/CODE | `eslint . --max-warnings=0`; `npm run -s typecheck`; `npm run -s check:arch` | 0 | 0 cảnh báo; tsc strict; 26 miền, 35 route, 23 cặp authz |
| ARCH | `depcruise` (cấu hình tạm, 268 module) | 0 | không vòng, không vi phạm lớp |
| CODE | `jscpd lib app adapters scripts --min-lines 10` | 0 | 3 clone, 0,21% |
| CODE | `knip --no-progress` | 1 | 12 tệp/130 export không dùng (nhiều nhiễu do thiếu knip.json), `server-only` chưa khai |
| CODE | `shellcheck -S warning` (20 script) | 1 | SC2155 ×2, SC2054 |
| TEST | `npm run -s coverage` | 0 | dòng 97,8% · nhánh 91,7% · hàm 96,96% |
| SEC | `gitleaks git` (lịch sử) | 0 | không rò rỉ |
| SEC | `gitleaks dir .` | 1 | 15 kết quả, tất cả trong `.next/` (gitignored) |
| SEC | `semgrep` | — | 17 kết quả, đã phân loại: khoá dev/giá trị harness cố định, không khai thác được |
| DEP | `npm audit --omit=dev --audit-level=moderate` | 0 | 0 lỗ hổng |
| DEP | `npm audit` (cả dev) | 1 | 5 high cùng gốc `braces` (dev, ngoại lệ D-008 hạn 2027-01-18) |
| DEP | `osv-scanner scan source --lockfile package-lock.json` | 0 | 495 gói |
| DEP | `npm outdated` | 1 | typescript 6.0.3 → 7.0.2 |
| CI | `actionlint` | 1 | chỉ cảnh báo shellcheck (SC2005/SC2012/SC2034) |
| CI | `zizmor --offline .github/workflows` | 14 | 14 artipacked (🟢); 1 high `issue_comment` ở pr-steward đã có biện pháp giảm thiểu |
| CI | `xt.py ci-check` | 0 | 10 workflow đạt |
| DOC | `check:docs`, `check:repo-docs`, `check:routes/openapi/domains/authz/adr` | 0 | OK |
| DOC | `lychee --offline --include-fragments './**/*.md'` | 2 | 930 link, 2 lỗi |
| DOC | chạy lại 147 lệnh `— Kiểm:` rẻ của mục `[x]` | 0 | 147/147 xanh |
| HAR | `xt.py doctor --json`; `blueprint-status --json` | 0 | ok; MUST mở 91 (chờ người/hạ tầng), 0 miễn trừ hỏng |
| A11Y | axe WCAG 2.2 AA (320/1280 px × 13 trang công khai + màn nội bộ 4 vai) | 0 | 104 lượt, 0 vi phạm, 0 cuộn ngang |
| A11Y | `node scripts/check-tokens.mjs` | 0 | OK |
| DATA | `node scripts/check-migrations.mjs` | 0 | 26 tệp OK |
| DATA | `scripts/with-test-db.sh … repro.test.ts` (R1, R2) | 1 | cả hai đỏ → lỗi có thật |
| XFEAT | script scratch ReadableStream 64 MiB không Content-Length | — | `readJson` kéo đủ 64 MiB rồi mới 413 |
| HAR | blueprint scratch xoá lý do miễn trừ | 0 | `bad_waivers` có mục nhưng exit 0 (HAR-001) |

## 4. Phát hiện chi tiết (🟠)

### AUD-SEC-001 🟠 Production vẫn khởi động khi thiếu `TRUST_PROXY`: `clientIp()` trả "direct" cho mọi client nên khoá đăng nhập (email, IP) thành khoá theo email — kẻ lạ khoá được tài khoản bất kỳ nhân viên.
- **Bằng chứng:** đo được: `lib/nen/env.ts:176` optional; `lib/http/index.ts:153-166`; verifier chạy `loadEnv` production (không ném về TRUST_PROXY) + 5 lần login sai với 5 X-Forwarded-For khác nhau → lần 6 đúng mật khẩu từ IP sạch trả 429
- **Tái hiện:** 1. `NODE_ENV=production`, không đặt `TRUST_PROXY`. 2. 5 lần POST `/api/app/auth/login` với `{email: victim, password: sai}` (cả khi đổi X-Forwarded-For). 3. Lần 6 với mật khẩu đúng → 429.
- **Xác minh đối kháng:** xác minh: Sonnet (V8) tái hiện
- **Đề xuất sửa:** Bắt buộc `TRUST_PROXY`/`TRUST_PROXY_HOPS` ở production (`requiredInProduction`) hoặc thêm bucket chỉ theo email ngưỡng cao. · **Gate:** ``npm run -s test:file -- tests/unit/env.test.ts` (ca production thiếu TRUST_PROXY phải ném lỗi; đỏ trước)`

### AUD-SEC-002 🟠 Spec bắt buộc TOTP cho sysadmin/hr/executive trước pilot nhưng chưa có mã, PLAN không có task, THREAT-MODEL T1 vẫn liệt TOTP là biện pháp giảm thiểu.
- **Bằng chứng:** đo được: `grep -rli "totp\|mfa" lib app migrations` chỉ ra regex che khoá và comment cột planned; `docs/specs/SPEC-identity-org.md:38`; `docs/THREAT-MODEL.md:100`
- **Tái hiện:** 1. `grep -rli "totp\|mfa" lib app migrations` → chỉ regex che khoá và comment cột planned. 2. PLAN không có task TOTP.
- **Xác minh đối kháng:** xác minh: Sonnet (V9) tái hiện; nợ có ghi nhận ở T1 'mở' nhưng chưa có task theo dõi
- **Đề xuất sửa:** Thêm task TOTP vào PLAN trước pilot; sửa T1 mô tả đúng thực tế; test vai hr không TOTP bị chặn. · **Gate:** tay: thêm task TOTP vào PLAN + test http đăng nhập vai hr không có TOTP bị chặn; sửa T1 cho khớp thực tế

### AUD-CODE-006 🟠 Server không ràng buộc `minutes` của đơn nghỉ với `start_at..end_at`; hộp duyệt chỉ hiện loại phép + số phút (không hiện ngày) → đơn 01/11–30/11 với minutes=60 bị duyệt và trừ sổ phép 60 phút; loại không cần số dư khai phút tuỳ ý vào `leave_minutes` của kỳ công.
- **Bằng chứng:** suy luận: `lib/attendance/leave.ts:71` (chỉ kiểm end>start); `request-schema.pure.ts:15-25`; `approvals.ts:45`; `leave.ts:166` trừ `-req.minutes`; phiên chính đọc lại mã xác nhận
- **Tái hiện:** 1. Nhân viên gửi đơn nghỉ 01/11–30/11 với `minutes: 60`. 2. Hộp duyệt hiện 'Phép năm 60 phút'. 3. Duyệt → sổ phép chỉ trừ 60 phút (`leave.ts:166`).
- **Xác minh đối kháng:** chưa tái hiện bằng test DB; đã đọc mã độc lập (phiên chính)
- **Đề xuất sửa:** Ràng buộc `minutes` ≤ khoảng thời gian/ca chuẩn (422), thêm ngày vào summary. · **Gate:** ``npm run -s test:file -- tests/db/leave-ot.test.ts` (requestLeave 30 ngày minutes=60 phải 422; summary phải có ngày)`

### AUD-CODE-007 🟠 `add_event` nhận `new_at` bất kỳ (tương lai/xa quá khứ) và loại bất kỳ; hộp duyệt chỉ hiện lý do (không hiện loại/giờ) → trưởng nhóm duyệt mù, giờ có mặt bị thổi phồng.
- **Bằng chứng:** suy luận: `request-schema.pure.ts:54`; `lib/attendance/period.ts:585-589` (không giới hạn khoảng `newAt`); `approvals.ts:50`
- **Tái hiện:** 1. `requestAdjustment` add_event `new_at = now+30 ngày`, kind `out`, lý do 'quên chấm ra'. 2. Hộp duyệt chỉ hiện lý do. 3. Duyệt → sự kiện tương lai đi vào giờ có mặt.
- **Xác minh đối kháng:** chưa tái hiện bằng test DB; phiên chính đã đọc schema và period.ts
- **Đề xuất sửa:** Giới hạn `newAt` trong cửa sổ hợp lý (không tương lai); summary gồm kind + at. · **Gate:** ``npm run -s test:file -- tests/db/period.test.ts` (add_event new_at=now+30 ngày phải 422; summary có kind+at)`

### AUD-CODE-008 🟠 Hộp duyệt lấy 500 đơn chờ đầu tiên của cả công ty rồi mới lọc quyền → công ty >500 đơn chờ thì trưởng nhóm có đơn sau vị trí 500 thấy hộp trống (đói đơn).
- **Bằng chứng:** suy luận: `lib/attendance/approvals.ts:35` (`LIMIT 500` trong SQL), lọc `can()` ở `:66-69`, phân trang cắt sau lọc `:92`; phiên chính đọc lại mã xác nhận
- **Tái hiện:** 1. Tạo 501 đơn chờ ở phòng D2 rồi 1 đơn ở D1. 2. `pendingApprovals(leadD1)` → trả rỗng (SQL cắt 500 đầu theo thời gian trước khi lọc quyền).
- **Xác minh đối kháng:** chưa tái hiện bằng test DB; đã đọc mã độc lập (phiên chính)
- **Đề xuất sửa:** Lọc theo phạm vi trong SQL (hoặc phân trang theo cursor trên kết quả đã lọc). · **Gate:** ``npm run -s test:file -- tests/db/leave-ot.test.ts` (501 đơn D2 rồi 1 đơn D1 → `pendingApprovals(leadD1)` phải trả 1)`

### AUD-A11Y-001 🟠 Focus bị che (WCAG 2.4.11 AA): `.app-nav` cố định đáy cao 56 px, trang không có `scroll-padding-bottom` → ở 320 px Tab tới ô gần đáy làm ô nằm dưới thanh nav (form đơn ở màn Chấm công).
- **Bằng chứng:** đo được: `probe.mjs` nv 320×800 Tab `/app/attendance` → `INPUT date` top=749 bottom=797 navTop=743 covered:true; `grep scroll-padding app` rỗng; `app/app/app.css:1-4,17-24`
- **Tái hiện:** 1. Đăng nhập vai nv, viewport 320×800. 2. Tab qua `/app/attendance` tới `INPUT date`. 3. Rect (top 749, bottom 797) nằm dưới `.app-nav` (top 743) → `covered:true`.
- **Xác minh đối kháng:** xác minh: CHƯA tái hiện độc lập (một người quét, một lần đo, một lần chạy khác không lặp lại) — cần xác minh đối kháng trước khi giữ 🟠
- **Đề xuất sửa:** Thêm `html{scroll-padding-bottom:…}` đủ cao hơn `.app-nav`; e2e kiểm focus không bị che. · **Gate:** ``PW_CHROMIUM_PATH=… npm run -s e2e -- e2e/pages.spec.ts` (bước 320 px: activeElement không nằm gọn trong `.app-nav`; đỏ trước)`

### AUD-CI-001 🟠 Ba job chạy trên PR nhưng không nằm trong required check của ruleset: `dast-probes` (BOLA/CSRF/XSS/redirect/rate limit), `codeql`, `osv-scanner` → PR làm đỏ chúng vẫn merge được.
- **Bằng chứng:** đo được: `.github/rulesets/main.json` có 13 context, không có 3 tên trên; job ở `ci.yml:305`, `codeql.yml:18`, `osv-scanner.yml:19` đều có trigger `pull_request`
- **Tái hiện:** 1. `jq '.rules' .github/rulesets/main.json` → 13 context. 2. Đối chiếu job chạy trên `pull_request`: `dast-probes`, `codeql`, `osv-scanner` không có trong danh sách.
- **Xác minh đối kháng:** xác minh: Sonnet (V10) tái hiện
- **Đề xuất sửa:** Thêm 3 context; `check:ci-policy` đỏ khi job PR không có trong required mà không có allowlist. · **Gate:** ``npm run -s check:ci-policy` (thêm kiểm: job chạy trên pull_request ⊆ required, ngoại lệ phải có allowlist kèm lý do)`

### AUD-CI-002 🟠 Ruleset chỉ là tệp trong repo; bước CI kiểm ruleset chỉ cảnh báo nên nếu chưa import thì mọi required check vô hiệu mà CI vẫn xanh.
- **Bằng chứng:** chưa biết: cần `gh api repos/:o/:r/rules/branches/main` để biết đã import chưa; `ci.yml:~176` chỉ `::warning::`; `GO-NO-GO.md:48` ghi rulesets = []
- **Tái hiện:** 1. `gh api repos/:o/:r/rules/branches/main` (cần người/API). 2. `GO-NO-GO.md:48` ghi rulesets = [].
- **Xác minh đối kháng:** xác minh: V11 đọc mã tái hiện phần cảnh báo; trạng thái import cần người (AGENTS §6)
- **Đề xuất sửa:** Người import `.github/rulesets/main.json`; CI đổi cảnh báo thành đỏ khi ruleset thiếu context. · **Gate:** tay: `gh api repos/:o/:r/rules/branches/main` phải chứa đủ context của `.github/rulesets/main.json`

### AUD-DOC-001 🟠 F-003 (Must) 'tuyển dụng → hộp tiếp nhận' không có giao diện: API `/api/public/applications` và trang `/tuyen-dung` có nhưng không có form ứng tuyển; không có D-NNN hoãn.
- **Bằng chứng:** đo được: `grep api/public/applications app e2e lib` chỉ trúng `lib/http/metrics.ts:39` và comment; `app/(public)/[...slug]/page.tsx:83`; `PROJECT.md:33`
- **Tái hiện:** 1. `grep -rn api/public/applications app e2e lib` → chỉ metrics + comment. 2. `/tuyen-dung` không có form.
- **Xác minh đối kháng:** xác minh: Sonnet (V5) tái hiện
- **Đề xuất sửa:** Thêm form ứng tuyển + E2E, hoặc D-NNN hoãn và sửa PROJECT/GO-NO-GO. · **Gate:** tay: thêm form ứng tuyển + E2E, hoặc ghi D-NNN hoãn và sửa PROJECT/GO-NO-GO

### AUD-DOC-002 🟠 Thông báo người dùng (F-010, SPEC-work W3/AT11) chỉ ghi log (`logChannel`), không tới ai; GO-NO-GO §2b không liệt kê dù kết luận 'đủ điều kiện dùng nội bộ/staging'.
- **Bằng chứng:** đo được: `lib/worker/channels.ts:37-44`; `grep web-push|nodemailer|email_outbox|notification lib app migrations` rỗng; `GO-NO-GO.md` §2b
- **Tái hiện:** 1. `lib/worker/channels.ts:37-44` chỉ `log.info`. 2. Không có mã email/push/hộp thư.
- **Xác minh đối kháng:** xác minh: Sonnet (V6) tái hiện
- **Đề xuất sửa:** Ghi vào GO-NO-GO §2b; nếu làm kênh thật thì test worker gửi thật. · **Gate:** tay: thêm dòng vào GO-NO-GO §2b; nếu làm kênh thật thì test worker gửi thật

### AUD-DATA-001 🟠 Ghi chú tự do của người xử lý liên hệ bị chép nguyên văn vào `audit_event.reason` (bảng chỉ thêm); xoá theo yêu cầu chỉ xoá `inquiry_history.note` nên SĐT/họ tên còn mãi trong audit, trong khi thông điệp cho chủ thể khẳng định nhật ký 'không chứa nội dung liên hệ'.
- **Bằng chứng:** đo được: `repro.test.ts` — `updateInquiry(note:"gọi Nguyễn Văn B 0912345678 nhà số 5")` → DSAR delete → `inquiry_history.note` NULL nhưng `audit_event.reason` còn chuỗi đó; verifier viết lại độc lập (ra cùng kết quả)
- **Tái hiện:** 1. `updateInquiry(... note:"gọi Nguyễn Văn B 0912345678 nhà số 5")`. 2. Tạo/chạy DSAR `delete` → `completeRequest`. 3. `SELECT reason FROM audit_event WHERE reason LIKE '%0912345678%'` vẫn trả dòng.
- **Xác minh đối kháng:** xác minh: Sonnet (V12) tái hiện; `lib/inquiry/index.ts:378`, `lib/privacy/index.ts:468`, `messages/vi.server.json:424`
- **Đề xuất sửa:** Không đưa `change.note` vào `reason` audit (chỉ `hasNote`), sửa thông điệp hoặc khai data-map. · **Gate:** ``npm run -s test:file -- tests/db/data-rights.test.ts` (ca R1: reason không chứa note; đỏ trước)`

### AUD-DATA-002 🟠 Job lưu giữ ẩn danh nhân viên hết hạn 10 năm nhưng không đụng `app_user` liên kết: `display_name`/`email` còn nguyên nên ẩn danh vô hiệu.
- **Bằng chứng:** đo được: `repro.test.ts` — `terminated_on='2010-01-01'`, `runRetention` → `employee.full_name="[đã ẩn danh]"` nhưng `app_user.email` còn; verifier tái hiện độc lập
- **Tái hiện:** 1. Đặt `employee.terminated_on='2010-01-01'`. 2. `runRetention` → `employeeAnonymized:1`. 3. `app_user.display_name`/`email` còn nguyên.
- **Xác minh đối kháng:** xác minh: Sonnet (V13) tái hiện; `lib/worker/retention.ts:216`
- **Đề xuất sửa:** `anonymizeEmployees` ẩn danh luôn `app_user` liên kết, hoặc chốt retention `app_user` trong data-map. · **Gate:** ``npm run -s test:file -- tests/db/retention.test.ts` (ca R2; đỏ trước)`

### AUD-CFG-001 🟠 `.env.example` lệch mã (thiếu `RUM_ENABLED`, `RETENTION_RUM_DAYS`) và không cổng nào bắt vì settings/guard chặn agent đọc-ghi `.env.*`; `check:env` không so khoá `env.ts` với `.env.example`.
- **Bằng chứng:** suy luận: `.claude/settings.json` deny `Read(./.env.*)`; `.claude/hooks/guard.py:59-60`; `PROGRESS.md:7`; `docs/ops/RUNBOOK.md:215`; `scripts/check-env.ts:1-4`
- **Tái hiện:** 1. So `lib/nen/env.ts` với `.env.example`: thiếu `RUM_ENABLED`, `RETENTION_RUM_DAYS` (PROGRESS/RUNBOOK tự ghi nhận). 2. `check:env` không so khoá.
- **Xác minh đối kháng:** xác minh: Sonnet (V4) chỉ một phần — không đọc được `.env.example`; việc đã giao người trong PROGRESS
- **Đề xuất sửa:** Thêm `check:env-example` (khoá env.ts ⊆ `.env.example`); người thêm 2 dòng (guard chặn agent). · **Gate:** ``npm run -s check:env` (thêm kiểm khoá `lib/nen/env.ts` ⊆ `.env.example`; đỏ tới khi người thêm 2 dòng)`

### AUD-XFEAT-001 🟠 Giới hạn kích thước body chỉ chặn khi có Content-Length: request chunked được đọc hết vào RAM rồi mới 413 (`readJson`, `postFile`, `requestHash`); 3 route công khai không đăng nhập dùng; Caddy không có `request_body max_size` → DoS bộ nhớ.
- **Bằng chứng:** đo được: test scratch `ReadableStream` 64 MiB không Content-Length, `readJson(req,16KiB)` → 413 sau khi kéo đủ 64 MiB (độc lập, cả finder lẫn verifier)
- **Tái hiện:** 1. Tạo `Request` với body `ReadableStream` 64×1 MiB, không Content-Length. 2. `readJson(req, 16 KiB)` → ném 413 nhưng stream đã bị kéo hết 64 MiB.
- **Xác minh đối kháng:** xác minh: Sonnet (V2) tái hiện; trần thực tế do proxy phía trước chưa kiểm
- **Đề xuất sửa:** Đọc theo luồng có trần byte (cả `readJson`, `postFile`, `requestHash`); thêm `request_body max_size` ở Caddy. · **Gate:** ``npm run -s test:file -- tests/unit/http-body.test.ts` (đọc theo luồng có trần; số byte đã đọc ≤ giới hạn + 1 chunk)`

### AUD-XFEAT-002 🟠 `/api/app/sync` nuốt lỗi lạ: đổi thành `{code:"INTERNAL"}` trong mảng kết quả, HTTP 200, không `log.error`, RED không đếm 5xx → lỗi chấm công ngoại tuyến không ai thấy.
- **Bằng chứng:** suy luận: `lib/offline/sync-route.ts:67-75` (tệp không import log) so với `lib/http/index.ts:115-117`; verifier xác nhận nhánh else + grep log = 0
- **Tái hiện:** 1. Mock `handleEvent` ném `Error` thường. 2. POST `/api/app/sync` → HTTP 200, phần tử kết quả `{code:"INTERNAL"}`, không log (tệp không import log).
- **Xác minh đối kháng:** xác minh: V3 một phần (chưa chạy test mock)
- **Đề xuất sửa:** Gọi `log.error` trong nhánh else và đếm vào metric RED. · **Gate:** ``npm run -s test:file -- tests/http/sync.test.ts` (mock handleEvent ném Error → phải có log.error)`

### AUD-HAR-001 🟠 Bước CI 'Khung — PLAN/blueprint/CI hợp lệ' chạy `blueprint-status --json > /dev/null` không `--strict` nên luôn exit 0: miễn trừ thiếu lý do hay dòng blueprint hỏng lọt qua CI (không cổng nào khác bắt).
- **Bằng chứng:** đo được: bản BLUEPRINT scratch xoá lý do BASE-DATA-005/BASE-DEP-009 → `bad_waivers` có mục, exit 0; có `--strict` → exit 1; `ci.yml:86`
- **Tái hiện:** 1. Copy BLUEPRINT.md vào scratch, xoá lý do miễn trừ BASE-DATA-005. 2. `xt.py blueprint-status BP.md --json` → `bad_waivers` có mục, exit 0. 3. Thêm `--strict` → exit 1; CI ở `ci.yml:86` không có `--strict` (không dùng được vì 91 MUST mở).
- **Xác minh đối kháng:** xác minh: Sonnet (V1) tái hiện, đề nghị hạ 🔴→🟠 (lưới đỡ là G7 `--strict --run` thủ công)
- **Đề xuất sửa:** Thay bước bằng kiểm `bad_waivers`/`bad_lines` rỗng (lệnh ở Gate). · **Gate:** ``python3 .xtemplates/scripts/xt.py blueprint-status BLUEPRINT.md --json | python3 -c "import json,sys;d=json.load(sys.stdin);sys.exit(bool(d['bad_waivers'] or d['bad_lines']))"` (đỏ với bản hỏng, xanh với HEAD)`

## 5. Kế hoạch sửa theo đợt (chờ duyệt)
Mỗi đợt ≤ 1 PR; lỗi logic có test đỏ trước. Mục chạm auth/migration/dữ liệu thật là ngoại lệ cứng (người merge).

| Đợt | Phát hiện | PR dự kiến | Gate của đợt |
|---|---|---|---|
| 1 | DATA-001, DATA-002 | `fix(privacy): không để PII lọt audit và ẩn danh app_user` | `npm run -s test:file -- tests/db/data-rights.test.ts` + `tests/db/retention.test.ts` |
| 2 | XFEAT-001, SEC-001, SEC-003 | `fix(http): đọc body theo luồng có trần; TRUST_PROXY bắt buộc ở production` | `npm run -s test:file -- tests/unit/http-body.test.ts` + `tests/unit/env.test.ts` |
| 3 | CODE-006, CODE-007, CODE-008, CODE-009 | `fix(attendance): ràng buộc đơn nghỉ/sửa công và lọc hộp duyệt theo phạm vi` | `npm run -s test:file -- tests/db/leave-ot.test.ts` + `tests/db/period.test.ts` |
| 4 | XFEAT-002, A11Y-001, A11Y-002…006 | `fix(app): log lỗi sync, focus không bị che, thông báo trong tầm nhìn` | `npm run -s test:file -- tests/http/sync.test.ts`; `npm run -s e2e` |
| 5 | CI-001, HAR-001, HAR-002, CFG-001 (phần kiểm), CI-003 | `ci: thêm required check, kiểm blueprint thật, kiểm env-example` | `npm run -s check:ci-policy`; `npm run -s check:env` |
| 6 | DOC-001…007, ARCH/CODE/PERF/TEST 🟢 | `docs: đồng bộ tài liệu và nợ kiểm tra` | `npm run -s check:docs` |

Việc chờ người (không tự làm được): CI-002 (import ruleset), CFG-001 (thêm 2 dòng `.env.example`, guard chặn agent), SEC-002 (quyết định TOTP trước pilot), DOC-001 (có làm form ứng tuyển hay hoãn), DOC-002 (kênh thông báo thật), CI-001 thêm context vào ruleset sau khi import.

## 6. Nợ 🟢 giữ lại
Toàn bộ 39 mục 🟢 trong sổ giữ trạng thái `mở`; chưa gán `chấp nhận` (cần `chủ:` + `hạn:` do người chốt). Đề xuất chủ mặc định: chủ dự án; hạn trước khi chạy dữ liệu thật (DPIA 60 ngày). Mục chưa quét (`chưa biết:`) cần làm ở lần audit delta tiếp theo: mutation testing (labor-rules, computeShift, clsSessionWindow), ca biên compute.ts (ca qua đêm, 29/2, đầu/cuối tháng), `lib/crypto/*` (kms, rotate, file), `worker/retention`, `attendance/qr`, forced-colors/NVDA, index cho dashboard/inquiry list, `check:perf-budget`.
