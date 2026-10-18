# Nhật ký quyết định tự duyệt

> Ghi bởi `xt.py loop decide`. Phiên chính tự duyệt điểm quyết định theo tiêu chí chất lượng cuối (`LOOP-STOP-018`, ADR-0008 của khung). Người xem lại bất cứ lúc nào; đổi ý → quyết định mới ghi "thay D-NNN", không sửa mục cũ.

### D-001 · 2026-10-18T06:15:53+00:00 · Nền mã nguồn: fork XBOSS hay repo mới?

- Phương án: (1) Fork nguyên XBOSS rồi gỡ phần thi công · (2) Repo mới cùng stack XBOSS, chép có chọn lọc phần hạ tầng mức Cao (auth, DB, audit, CI) kèm ghi nguồn · (3) Repo mới stack khác
- Chọn: Repo mới cùng stack XBOSS, chép có chọn lọc phần hạ tầng mức Cao (auth, DB, audit, CI) kèm ghi nguồn
- Lý do (tiêu chí chất lượng cuối): F01: ~70% XBOSS là nghiệp vụ thi công, vai trò cố định, không có phòng ban/chấm công/CMS; fork mang 173k LOC thừa và nợ offline. Cùng stack giữ được phần hạ tầng đã kiểm chứng. XBOSS cùng chủ repo seeker19110 và kế hoạch §1 chỉ định tái sử dụng — chép kèm ghi nguồn trong commit.
- Đường lùi: Phần chép nằm trong lib/ có ghi nguồn; có thể thay bằng nhập XBOSS làm submodule nếu chủ dự án muốn đồng bộ hai repo

### D-002 · 2026-10-18T06:15:53+00:00 · Stack và phiên bản

- Phương án: (1) Next.js 16.4 + React 19.3 + TypeScript 6.0.3 + pg 8.23 SQL thuần + node:test/tsx + c8 + Playwright 1.64 + ESLint 10 + Prettier 3.9; Node >=22.12 (prod Node 24 LTS); PostgreSQL 17 (tương thích 16) · (2) Như trên nhưng TypeScript 7.0 · (3) ORM (Prisma/Drizzle)
- Chọn: Next.js 16.4 + React 19.3 + TypeScript 6.0.3 + pg 8.23 SQL thuần + node:test/tsx + c8 + Playwright 1.64 + ESLint 10 + Prettier 3.9; Node >=22.12 (prod Node 24 LTS); PostgreSQL 17 (tương thích 16)
- Lý do (tiêu chí chất lượng cuối): Khớp XBOSS để chép hạ tầng; TS 7 vượt peer typescript-eslint (<6.1.0, registry 2026-10-18); SQL thuần theo ADR XBOSS 0001, ít phụ thuộc; Node 24 là LTS tới 2028-04-30, môi trường dev có Node 22 (Maintenance tới 2027-04-30) nên engines >=22.12.
- Đường lùi: Nâng TS 7 khi typescript-eslint hỗ trợ; đổi ORM chỉ đụng lib/db

### D-003 · 2026-10-18T06:15:53+00:00 · Băm mật khẩu

- Phương án: (1) scrypt như XBOSS · (2) Argon2id qua @node-rs/argon2 (m=19456,t=2,p=1, chuỗi PHC)
- Chọn: Argon2id qua @node-rs/argon2 (m=19456,t=2,p=1, chuỗi PHC)
- Lý do (tiêu chí chất lượng cuối): BE-AUTH-001 MUST Argon2id; scrypt chỉ khi nền tảng không có Argon2id; @node-rs/argon2 2.2.2 MIT, có binary dựng sẵn
- Đường lùi: Chuỗi PHC cho phép nâng cấp dần sang thuật toán khác khi đăng nhập

### D-004 · 2026-10-18T06:15:53+00:00 · Một ứng dụng hay tách website công khai?

- Phương án: (1) Một ứng dụng Next.js, route công khai và /app nội bộ tách bằng proxy + kiểm quyền server · (2) Hai ứng dụng riêng
- Chọn: Một ứng dụng Next.js, route công khai và /app nội bộ tách bằng proxy + kiểm quyền server
- Lý do (tiêu chí chất lượng cuối): §11: ưu tiên một ứng dụng chia module, chỉ tách khi tải/bảo mật chứng minh cần; giảm vận hành; website chỉ đọc nội dung đã xuất bản
- Đường lùi: Route công khai nằm trong app/(public) và chỉ gọi lib/cms đọc bản đã xuất bản — tách thành app riêng không đổi nghiệp vụ

### D-005 · 2026-10-18T06:15:53+00:00 · Hạ tầng chạy thử/dev cần dịch vụ ngoài (S3, email, push)?

- Phương án: (1) Tự host: tệp lưu đĩa qua adapter, email ghi outbox, push qua web-push VAPID tự sinh · (2) Đăng ký S3/SES/FCM ngay
- Chọn: Tự host: tệp lưu đĩa qua adapter, email ghi outbox, push qua web-push VAPID tự sinh
- Lý do (tiêu chí chất lượng cuối): Mặc định tự host khi cần tài khoản chỉ chủ dự án có; adapter có contract test để thay sau
- Đường lùi: Thay adapter storage/email bằng S3-compatible và SMTP thật qua biến môi trường
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): S3-compatible (MinIO tự host hoặc nhà cung cấp trong nước) cho tệp; SMTP giao dịch cho email; VAPID cho Web Push

### D-006 · 2026-10-18T06:20:22+00:00 · Duyệt PLAN P0 lõi (docs/autopilot/PLAN.md)

- Phương án: (1) Duyệt: 24 task / 7 lát, mỗi task Gate là lệnh test; website xen trước chấm công · (2) Chấm công trước website · (3) Thu hẹp chỉ lát 1-2
- Chọn: Duyệt: 24 task / 7 lát, mỗi task Gate là lệnh test; website xen trước chấm công
- Lý do (tiêu chí chất lượng cuối): Đúng thứ tự rủi ro (nền → quyền/audit → nghiệp vụ), mọi task có Gate máy kiểm trên Postgres thật, phạm vi bám P0 kế hoạch §4 và nghiệm thu §17; phần cần người (pilot, thiết bị thật, DPIA) tách rõ
- Đường lùi: Sửa PLAN.md, chạy lại loop init; task chưa làm có thể bỏ [~] kèm lý do

### D-007 · 2026-10-18T06:20:22+00:00 · Giá trị quy tắc ca/OT chưa được HR chốt (F02)

- Phương án: (1) Hard-code theo kế hoạch · (2) Cấu hình có ngày hiệu lực + mặc định ⚙ ghi trong SPEC, HR chốt trước pilot · (3) Dừng chờ HR
- Chọn: Cấu hình có ngày hiệu lực + mặc định ⚙ ghi trong SPEC, HR chốt trước pilot
- Lý do (tiêu chí chất lượng cuối): Giữ đường lùi khi thiếu dữ kiện chỉ người có; không chặn vòng; đổi giá trị không cần sửa mã; kỳ đã khoá giữ policy_version cũ
- Đường lùi: Cập nhật bản ghi ot_policy/shift config với valid_from mới

### D-008 · 2026-10-18T06:26:41+00:00 · Advisory high braces (GHSA-vfj7-8cjw-p6xm) trong chuỗi phụ thuộc dev eslint-config-next, mọi phiên bản, chưa có bản sửa

- Phương án: (1) dep-audit quét phụ thuộc production (--omit=dev), theo dõi dev qua Dependabot · (2) Bỏ eslint-config-next · (3) Hạ eslint-config-next về 14.2.35 (npm audit fix --force)
- Chọn: dep-audit quét phụ thuộc production (--omit=dev), theo dõi dev qua Dependabot
- Lý do (tiêu chí chất lượng cuối): Lỗ hổng DoS khi glob lồng sâu, chỉ chạy lúc lint với mẫu glob của chính repo, không vào bản build; bỏ plugin Next làm mất luật core-web-vitals; hạ về 14 không tương thích Next 16
- Đường lùi: Bỏ --omit=dev khi braces có bản sửa

### D-009 · 2026-10-18T06:28:36+00:00 · Mỗi lát một PR nhưng phiên chỉ được push lên một nhánh (claude/focused-cannon-3iu4lk)

- Phương án: (1) Tạo nhánh riêng cho từng lát · (2) Dùng một nhánh: lát kế tiếp nối vào PR đang mở; khi PR merge thì nhánh nối lại main và lát sau mở PR mới
- Chọn: Dùng một nhánh: lát kế tiếp nối vào PR đang mở; khi PR merge thì nhánh nối lại main và lát sau mở PR mới
- Lý do (tiêu chí chất lượng cuối): Chỉ dẫn phiên cấm push sang nhánh khác khi chưa được phép; không chặn vòng chờ người merge; mô tả PR liệt kê từng lát và Gate
- Đường lùi: Chủ dự án cho phép nhiều nhánh → tách các lát còn lại thành PR riêng

### D-010 · 2026-10-18T06:41:06+00:00 · Danh sách mật khẩu phổ biến cần chặn

- Phương án: (1) Top 1.000 (10k SecLists) như spec ban đầu · (2) Mục ≥ 12 ký tự trong danh sách 100k NCSC (SecLists, MIT)
- Chọn: Mục ≥ 12 ký tự trong danh sách 100k NCSC (SecLists, MIT)
- Lý do (tiêu chí chất lượng cuối): Top 1.000 không có mục nào ≥ 12 ký tự nên vô tác dụng khi độ dài tối thiểu là 12 (đo 2026-10-18); 1.274 mục dài thật sự chặn được mật khẩu phổ biến vượt ngưỡng độ dài
- Đường lùi: Đổi nguồn trong lib/identity/common-passwords.ts

### D-011 · 2026-10-18T06:54:20+00:00 · SPEC I3 (vào lần 2 khi có ca mở → needs_review) mâu thuẫn S-AT-02 (hai thiết bị chồng giờ hợp lệ)

- Phương án: (1) Giữ I3: mọi lần vào thứ hai khi đang mở → needs_review · (2) I3 chỉ với lần vào từ thiết bị khác trong cửa sổ trùng ⚙2 phút (bấm hai nơi gần như cùng lúc); ngoài cửa sổ → accepted, hợp khoảng chống đếm trùng
- Chọn: I3 chỉ với lần vào từ thiết bị khác trong cửa sổ trùng ⚙2 phút (bấm hai nơi gần như cùng lúc); ngoài cửa sổ → accepted, hợp khoảng chống đếm trùng
- Lý do (tiêu chí chất lượng cuối): Hợp khoảng ở computeShift đã bảo đảm không cộng trùng thời gian (C1) nên lần vào thứ hai không thể tạo công trùng; đánh dấu mọi lần sẽ đẩy ca đổi địa điểm/kiosk hợp lệ vào hàng xác minh; vẫn giữ cả hai sự kiện để điều tra
- Đường lùi: Đặt duplicate_window_sec rất lớn trong attendance_policy để quay về hành vi cũ

### D-012 · 2026-10-18T07:19:32+00:00 · Phút nghỉ phép của đơn nhiều ngày / kéo qua hai kỳ tính vào ngày nào (review PR #8 #9)

- Phương án: (1) Chia theo ngày lịch tỷ lệ thời gian chồng · (2) Tính toàn bộ vào ngày (giờ VN) bắt đầu đơn và kỳ chứa ngày đó; ghi rõ ở SPEC; HR chốt ở F02 · (3) Chia theo ca được giao từng ngày
- Chọn: Tính toàn bộ vào ngày (giờ VN) bắt đầu đơn và kỳ chứa ngày đó; ghi rõ ở SPEC; HR chốt ở F02
- Lý do (tiêu chí chất lượng cuối): Phút phép là phút làm việc người lao động xin, không phải thời gian lịch — chia tỷ lệ lịch sai với ca đêm/cuối tuần; chia theo ca cần quy tắc HR chưa có (F02). Cách 2 đơn giản, tất định, không mất phút (vào đúng một kỳ); đơn qua kỳ hiếm và HR thấy trên bảng công kỳ bắt đầu
- Đường lùi: Đổi truy vấn lvMap trong computeLines sang chia theo ca khi HR chốt quy tắc

### D-013 · 2026-10-18T07:23:52+00:00 · Đính kèm tệp ở form liên hệ công khai (SPEC-website-cms) làm ở T-017 hay hoãn

- Phương án: (1) Làm ngay: nhận tệp từ khách vô danh vào kho · (2) Hoãn sang P1 cùng cách ly + quét tệp; P0 chỉ nhận tệp từ người dùng nội bộ đã đăng nhập
- Chọn: Hoãn sang P1 cùng cách ly + quét tệp; P0 chỉ nhận tệp từ người dùng nội bộ đã đăng nhập
- Lý do (tiêu chí chất lượng cuối): Kế hoạch §12: kiểm loại/dung lượng, cách ly tệp chưa kiểm tra, không gửi hồ sơ nhạy cảm lên dịch vụ quét công khai — nhận tệp từ người lạ cần hàng cách ly + máy quét tự host (ClamAV) chưa có; khách vẫn gửi được yêu cầu, nhân viên nhận tệp qua email/kênh khác
- Đường lùi: Thêm endpoint đính kèm theo mã hồ sơ + hàng cách ly khi có máy quét
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): ClamAV tự host trong mạng nội bộ cho hàng cách ly tệp công khai

### D-014 · 2026-10-18T08:16:02+00:00 · Sau audit còn 298 MUST mở: xử lý thế nào trong phiên này?

- Phương án: (1) Thêm lát 8 cứng hoá (T-025…T-040) làm mọi mục làm được trong repo; mục cần hạ tầng/người → loop defer kèm cách làm · (2) Dừng ở P0 tính năng, defer toàn bộ
- Chọn: Thêm lát 8 cứng hoá (T-025…T-040) làm mọi mục làm được trong repo; mục cần hạ tầng/người → loop defer kèm cách làm
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1 (đúng, an toàn): phần lớn mục mở là cổng/test/tài liệu làm được ngay; defer hàng loạt sẽ giấu nợ. Hạ tầng thật, ruleset, pháp chế thì không tự làm được → defer có hướng dẫn.
- Đường lùi: Bỏ lát 8 khỏi PLAN; các mục quay về [ ]

### D-015 · 2026-10-18T08:16:02+00:00 · DB-SEC-007 RLS theo tenant có áp dụng không?

- Phương án: (1) Không áp dụng lúc này: hệ thống một công ty (một tenant); company_id là khoá phạm vi dự phòng; quyền theo người dùng cưỡng chế ở can() + test BOLA/BFLA; bật RLS khi có công ty thứ hai · (2) Bật RLS FORCE theo company_id cho mọi bảng ngay
- Chọn: Không áp dụng lúc này: hệ thống một công ty (một tenant); company_id là khoá phạm vi dự phòng; quyền theo người dùng cưỡng chế ở can() + test BOLA/BFLA; bật RLS khi có công ty thứ hai
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 3 (đơn giản, bền): RLS với một tenant không giảm rủi ro thực mà buộc refactor mọi đường đọc pool; điều kiện mở lại ghi rõ ở blueprint. Kiểm quyền theo người dùng đã có test BOLA/BFLA.
- Đường lùi: Thêm migration ENABLE+FORCE RLS + SET LOCAL app.company_id trong withTx/withActor

### D-016 · 2026-10-18T08:16:03+00:00 · Thời hạn lưu dữ liệu (STD-PRIV-005, XC-GREEN-007) khi HR/pháp chế chưa chốt?

- Phương án: (1) Làm job xoá/ẩn danh với thời hạn là CẤU HÌNH mặc định thận trọng (liên hệ 24 tháng, ứng viên 12 tháng, phiên hết hạn 30 ngày, login_attempt 90 ngày, outbox đã gửi 30 ngày), pháp chế chốt số ở F02 · (2) Chờ pháp chế rồi mới làm
- Chọn: Làm job xoá/ẩn danh với thời hạn là CẤU HÌNH mặc định thận trọng (liên hệ 24 tháng, ứng viên 12 tháng, phiên hết hạn 30 ngày, login_attempt 90 ngày, outbox đã gửi 30 ngày), pháp chế chốt số ở F02
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1+2: có cơ chế xoá đúng hạn tốt hơn giữ vô hạn; số là cấu hình đổi không cần deploy mã — giữ đường lùi.
- Đường lùi: Tắt job retention (cấu hình enabled=false)
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): Pháp chế/HR chốt thời hạn từng loại dữ liệu

### D-017 · 2026-10-18T08:16:03+00:00 · Thông báo lỗi API theo RFC 9457 mà không phá client hiện có?

- Phương án: (1) application/problem+json với type/title/status/detail/instance + giữ trường mở rộng code, message, fields, request_id · (2) Đổi hẳn sang chỉ trường chuẩn
- Chọn: application/problem+json với type/title/status/detail/instance + giữ trường mở rộng code, message, fields, request_id
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 2: RFC 9457 cho phép trường mở rộng — client PWA ngoại tuyến cũ vẫn đọc code/message.
- Đường lùi: Trả lại content-type application/json

### D-018 · 2026-10-18T12:10:17+00:00 · Ngoại lệ giấy phép cho gói ngoài danh sách allow (T-037, CMP-LIC-002)?

- Phương án: (1) Ngoại lệ có hạn 2027-10-18 cho @img/sharp-* (LGPL, liên kết động), axe-core + @axe-core/playwright (MPL-2.0, chỉ dev), caniuse-lite (CC-BY-4.0, dữ liệu build, ghi công ở THIRD_PARTY_NOTICES) · (2) Gỡ các gói này (bỏ tối ưu ảnh của next, bỏ kiểm a11y tự động)
- Chọn: Ngoại lệ có hạn 2027-10-18 cho @img/sharp-* (LGPL, liên kết động), axe-core + @axe-core/playwright (MPL-2.0, chỉ dev), caniuse-lite (CC-BY-4.0, dữ liệu build, ghi công ở THIRD_PARTY_NOTICES)
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1+3: không gói nào vào mã nguồn dự án hoặc bị sửa; LGPL liên kết động và MPL theo tệp không ràng buộc mã dự án; bỏ axe làm yếu kiểm a11y. Hạn 1 năm buộc xem lại.
- Đường lùi: Xoá mục exceptions trong license-policy.yaml → check:licenses đỏ tới khi gỡ gói
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): Pháp chế xác nhận ngoại lệ LGPL/MPL/CC-BY trước phát hành

### D-019 · 2026-10-18T12:10:17+00:00 · Mô hình lưu đồng ý (consent) cho CMP-RIGHTS/CMP-VN (T-040)?

- Phương án: (1) Bảng consent_record chỉ thêm (event-sourcing): cấp/rút là dòng mới, trạng thái = dòng mới nhất; trigger chặn UPDATE/DELETE · (2) Một cột consent boolean cập nhật tại chỗ
- Chọn: Bảng consent_record chỉ thêm (event-sourcing): cấp/rút là dòng mới, trạng thái = dòng mới nhất; trigger chặn UPDATE/DELETE
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: NĐ 13/2023 đòi chứng minh được đồng ý và thời điểm rút; cập nhật tại chỗ mất bằng chứng. Ẩn danh xoá PII nhưng giữ dòng bằng chứng.
- Đường lùi: Migration mới thêm cột tổng hợp; consent_record giữ làm lịch sử

### D-020 · 2026-10-18T12:10:17+00:00 · Ngữ nghĩa yêu cầu chủ thể dữ liệu (T-040): xuất, xoá với nhân viên, rút đồng ý khi không còn đồng ý, hạn xử lý?

- Phương án: (1) Xuất dữ liệu bằng GET (đọc, không ghi); xoá với nhân viên = hạn chế xử lý + giữ dữ liệu luật bắt buộc (lib/privacy/retained.ts); rút khi không có đồng ý hiệu lực → 422 NO_ACTIVE_CONSENT; hạn DSAR_DAYS=30 cấu hình được · (2) Xoá cứng mọi dữ liệu nhân viên; rút đồng ý luôn 200; hạn cố định trong mã
- Chọn: Xuất dữ liệu bằng GET (đọc, không ghi); xoá với nhân viên = hạn chế xử lý + giữ dữ liệu luật bắt buộc (lib/privacy/retained.ts); rút khi không có đồng ý hiệu lực → 422 NO_ACTIVE_CONSENT; hạn DSAR_DAYS=30 cấu hình được
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: dữ liệu chấm công/lương phải giữ theo luật lao động/kế toán nên xoá cứng sai luật; 422 báo rõ thay vì giả thành công; hạn là cấu hình để pháp chế chốt (giống D-016).
- Đường lùi: Đổi DSAR_DAYS; danh mục retained.ts sửa theo pháp chế
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): HR/pháp chế xác nhận danh mục dữ liệu phải giữ (điều luật, số năm) và hạn DSAR

### D-021 · 2026-10-18T12:10:17+00:00 · Thu hồi quyền/vai trò có huỷ phiên đang mở của người đó không (T-030)?

- Phương án: (1) Có: revoke role_grant huỷ mọi phiên của người dùng trong cùng giao dịch · (2) Không: quyền mới áp dụng khi phiên hết hạn
- Chọn: Có: revoke role_grant huỷ mọi phiên của người dùng trong cùng giao dịch
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: quyền kiểm ở server mỗi request nhưng phiên cũ có thể mang ngữ cảnh/CSRF cũ; huỷ phiên là cách hiểu chặt hơn với auth, chi phí là đăng nhập lại.
- Đường lùi: Bỏ lời gọi destroyUserSessions trong lib/authz/grants.ts

### D-022 · 2026-10-18T12:10:17+00:00 · Gộp T-032 (kiểm form client bằng schema chung) với ngân sách JS T-038 làm check:perf-budget đỏ (+32 KB zod). Xử lý thế nào?

- Phương án: (1) Schema dùng chung viết bằng zod/mini và client nạp động lúc gửi; server bắt $ZodError (lớp gốc chung) · (2) Nâng ngân sách JS · (3) Bỏ kiểm phía client
- Chọn: Schema dùng chung viết bằng zod/mini và client nạp động lúc gửi; server bắt $ZodError (lớp gốc chung)
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1+3: giữ một nguồn schema và kiểm theo ô (FE-FORM-001/002) mà không nới cổng; 9 trang trong ngân sách, tổng 222.5 KB ≤ 230.
- Đường lùi: Revert commit perf(forms) — schema về zod đầy đủ, import tĩnh
