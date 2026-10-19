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

### D-023 · 2026-10-18T12:58:51+00:00 · Phân trang API danh sách (XC-PERF-006): kiểu và xử lý limit vượt trần?

- Phương án: (1) Offset có trần (limit mặc định 50, tối đa 200, offset tối đa 10.000); vượt trần → 400 VALIDATION · (2) Keyset cursor theo từng danh sách; vượt trần kẹp về 200
- Chọn: Offset có trần (limit mặc định 50, tối đa 200, offset tối đa 10.000); vượt trần → 400 VALIDATION
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 3: dữ liệu cỡ M mỗi công ty, một cơ chế chung cho 6 API, test được; 400 báo rõ client xin quá thay vì che lỗi (tiêu chí 1). Chưa client nào dùng cursor.
- Đường lùi: Đổi lib/nen/pagination.ts sang kẹp hoặc thêm keyset cho danh sách lớn

### D-024 · 2026-10-18T12:58:51+00:00 · Tệp chuỗi i18n: một vi.json hay chia theo nơi dùng (JSON không tree-shake, vượt ngân sách JS 235,5/230 KB)?

- Phương án: (1) Chia vi.json (lõi) + vi.app.json + vi.site.json + vi.server.json, mỗi phần một bộ dịch client; sai tệp → tsc báo · (2) Một vi.json và nâng trần ngân sách JS
- Chọn: Chia vi.json (lõi) + vi.app.json + vi.site.json + vi.server.json, mỗi phần một bộ dịch client; sai tệp → tsc báo
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1+3: giữ cổng hiệu năng không nới (225,8 KB); khoá vẫn có kiểu, check:i18n giữ đồng bộ với vi.context.json.
- Đường lùi: Gộp lại một tệp khi có loader cắt theo khoá

### D-025 · 2026-10-18T12:58:51+00:00 · Chuỗi thông điệp lỗi/nghiệp vụ ở lib/** (~400) chưa vào tệp tài nguyên (XC-I18N-001)?

- Phương án: (1) Task riêng T-041 chuyển dần + mở rộng check:i18n sang lib/ khi xong · (2) Mở rộng check:i18n sang lib/ ngay kèm baseline
- Chọn: Task riêng T-041 chuyển dần + mở rộng check:i18n sang lib/ khi xong
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 3: app/ đã đủ và có hàng rào; lib/ là việc cơ học lớn, tách task giữ PR nhỏ; mục blueprint giữ [ ] tới khi xong (không khai đạt).
- Đường lùi: Gộp vào T-031

### D-026 · 2026-10-18T13:59:20+00:00 · Phạm vi luật chuỗi cứng ở lib/** (T-041) và cách đặt tên khoá?

- Phương án: (1) Chỉ AppError/chuỗi tới người dùng vào t(); new Error khác, log.*, # HELP, giá trị dữ liệu ổn định (MASK, ANON_NAME), RAISE của trigger miễn bằng i18n-ignore có lý do; khoá sinh tự động tiếng Việt không dấu · (2) Bắt cả new Error và log; đổi mọi khoá sang tiếng Anh
- Chọn: Chỉ AppError/chuỗi tới người dùng vào t(); new Error khác, log.*, # HELP, giá trị dữ liệu ổn định (MASK, ANON_NAME), RAISE của trigger miễn bằng i18n-ignore có lý do; khoá sinh tự động tiếng Việt không dấu
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 3: chuỗi tới lập trình viên/vận hành không cần người dịch; MASK nằm trong dữ liệu băm nên không được đổi; migration append-only nên không sửa RAISE. Hàng rào vẫn đỏ với literal mới ở đường hiển thị.
- Đường lùi: Bỏ các i18n-ignore và chuyển dần

### D-027 · 2026-10-18T14:28:27+00:00 · ARC-ADR-001 và XC-OSS-005 (review ≥1) cho dự án một maintainer + bot?

- Phương án: (1) ARC-ADR-001: chấp nhận ADR-0001 + ADR-0002 làm bằng chứng; XC-OSS-005: giữ required_approving_review_count=0, ghi rủi ro, bù bằng required checks + review bởi model khác (pr reviewed) + chủ dự án merge PR ngoại lệ cứng · (2) Viết ADR-0004 phương án thay thế; đặt review=1 kèm bypass admin
- Chọn: ARC-ADR-001: chấp nhận ADR-0001 + ADR-0002 làm bằng chứng; XC-OSS-005: giữ required_approving_review_count=0, ghi rủi ro, bù bằng required checks + review bởi model khác (pr reviewed) + chủ dự án merge PR ngoại lệ cứng
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1+3: review=1 không bypass khoá merge (chủ duy nhất, bot không duyệt được); bypass admin chưa kiểm chứng với auto-merge — rủi ro kẹt. Giữ ADR-0001 bất biến.
- Đường lùi: Đặt review=1 + bypass admin ở ruleset khi có ≥2 maintainer
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): Khi có thêm maintainer: đặt required_approving_review_count=1

### D-028 · 2026-10-18T14:52:34+00:00 · Hợp đồng API máy đọc được (T-043): định dạng và nơi chạy kiểm phá vỡ?

- Phương án: (1) docs/api/openapi.json sinh từ zod bằng script, check:openapi trong check:arch; check-api-breaking là bước trong job pr-policy (required sẵn) · (2) openapi.yaml (tự viết serializer/thêm phụ thuộc) và job riêng phải thêm vào ruleset
- Chọn: docs/api/openapi.json sinh từ zod bằng script, check:openapi trong check:arch; check-api-breaking là bước trong job pr-policy (required sẵn)
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 3: JSON là OpenAPI 3.1 hợp lệ, không thêm phụ thuộc, giữ format:check; gắn vào job required sẵn có nên không cần người import ruleset thêm.
- Đường lùi: Chuyển sang YAML/job riêng khi có spectral/oasdiff trong CI

### D-029 · 2026-10-19T01:34:18+00:00 · Hạn xử lý yêu cầu của chủ thể dữ liệu (thay DSAR_DAYS=30 một số cho mọi loại)?

- Phương án: (1) Hạn theo từng loại yêu cầu theo NĐ 356/2025 Điều 5 (nguồn mức B, chưa đối chiếu Công báo): phản hồi nhận trong 2 ngày làm việc; xem/chỉnh sửa/cung cấp 10 ngày; rút đồng ý/hạn chế/phản đối 15 ngày; xoá 20 ngày; gia hạn tối đa một lần kèm lý do; mỗi số là cấu hình · (2) Giữ một hạn chung 30 ngày
- Chọn: Hạn theo từng loại yêu cầu theo NĐ 356/2025 Điều 5 (nguồn mức B, chưa đối chiếu Công báo): phản hồi nhận trong 2 ngày làm việc; xem/chỉnh sửa/cung cấp 10 ngày; rút đồng ý/hạn chế/phản đối 15 ngày; xoá 20 ngày; gia hạn tối đa một lần kèm lý do; mỗi số là cấu hình
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: 30 ngày vượt hạn luật cho mọi loại — cách hiểu chặt hơn là theo hạn ngắn nhất từng loại; cấu hình nên đổi được khi văn bản đối chiếu khác.
- Đường lùi: Đổi bảng hạn trong cấu hình về một số chung
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): Luật sư đối chiếu Điều 5 NĐ 356/2025 với Công báo (nguồn hiện mức B) và số ngày gia hạn khoản 2-4 (chưa xác minh)

### D-030 · 2026-10-19T01:34:18+00:00 · Thời hạn lưu dữ liệu cá nhân khi luật chỉ nói 'phù hợp mục đích' (STD-PRIV-005)?

- Phương án: (1) Cấu hình thận trọng: liên hệ khách 24 tháng; ứng viên KHÔNG trúng tuyển ẩn danh sau 30 ngày kể từ khi chốt trừ khi có đồng ý riêng 'kho nhân tài' (khi đó 12 tháng); dữ liệu nhân sự xoá/ẩn danh khi chấm dứt hợp đồng trừ phần luật bắt buộc giữ; chấm công/lương giữ 10 năm như tài liệu kế toán; hồ sơ vi phạm dữ liệu giữ 5 năm; sao lưu giữ theo BACKUP_KEEP · (2) Giữ mọi dữ liệu tới khi có yêu cầu xoá
- Chọn: Cấu hình thận trọng: liên hệ khách 24 tháng; ứng viên KHÔNG trúng tuyển ẩn danh sau 30 ngày kể từ khi chốt trừ khi có đồng ý riêng 'kho nhân tài' (khi đó 12 tháng); dữ liệu nhân sự xoá/ẩn danh khi chấm dứt hợp đồng trừ phần luật bắt buộc giữ; chấm công/lương giữ 10 năm như tài liệu kế toán; hồ sơ vi phạm dữ liệu giữ 5 năm; sao lưu giữ theo BACKUP_KEEP
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: Luật 91/2025 Điều 25.1c bắt xoá thông tin ứng viên khi không tuyển trừ thỏa thuận khác; Điều 14 xoá khi hết mục đích; giữ vô hạn trái luật. Số năm kế toán nguồn mức B.
- Đường lùi: Đổi các hằng retention trong cấu hình
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): Luật sư xác nhận 5/10 năm cho bảng lương và chấm công (Luật Kế toán 2015 sửa đổi 56/2024, mức B) và thời hạn hồ sơ nhân sự

### D-031 · 2026-10-19T01:34:19+00:00 · Quy tắc ca/OT/nghỉ (RK-001) khi HR chưa cung cấp ví dụ?

- Phương án: (1) Mặc định theo Bộ luật Lao động 2019 (nguồn bản đọc được mức A): 8 giờ/ngày, 48 giờ/tuần; OT cần đồng ý, ≤ 50% giờ bình thường/ngày và tổng ≤ 12 giờ/ngày, ≤ 40 giờ/tháng, ≤ 200 giờ/năm (300 giờ chỉ khi bật cờ ngành được phép); nghỉ giữa ca 30 phút (45 phút ca đêm), nghỉ giữa hai ca ≥ 12 giờ, nghỉ tuần ≥ 24 giờ; hệ số lương OT 150%/200%/300%, đêm 22h-6h +30%, OT đêm +20%; tất cả là cấu hình có ngày hiệu lực; vượt trần bị chặn khi tạo đơn OT và cảnh báo ở chấm công · (2) Không áp trần, chỉ ghi nhận
- Chọn: Mặc định theo Bộ luật Lao động 2019 (nguồn bản đọc được mức A): 8 giờ/ngày, 48 giờ/tuần; OT cần đồng ý, ≤ 50% giờ bình thường/ngày và tổng ≤ 12 giờ/ngày, ≤ 40 giờ/tháng, ≤ 200 giờ/năm (300 giờ chỉ khi bật cờ ngành được phép); nghỉ giữa ca 30 phút (45 phút ca đêm), nghỉ giữa hai ca ≥ 12 giờ, nghỉ tuần ≥ 24 giờ; hệ số lương OT 150%/200%/300%, đêm 22h-6h +30%, OT đêm +20%; tất cả là cấu hình có ngày hiệu lực; vượt trần bị chặn khi tạo đơn OT và cảnh báo ở chấm công
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: trần luật là biên an toàn pháp lý; cấu hình có hiệu lực giữ đường lùi (kỳ khoá giữ policy_version cũ, D-007); HR vẫn đổi được cho nội quy chặt hơn.
- Đường lùi: Nới/tắt kiểm trần bằng cấu hình mới có ngày hiệu lực
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): HR chốt nội quy ca/OT thực tế; xác nhận NĐ 145/2020 (chỉ có nguồn thứ cấp) và ngành có được 300 giờ/năm không

### D-032 · 2026-10-19T01:34:19+00:00 · DPIA và dữ liệu nhạy cảm (vị trí GPS, sinh trắc) khi chủ dự án uỷ quyền 'tự quyết'?

- Phương án: (1) Lập hồ sơ DPIA đầy đủ theo nội dung Mẫu số 10 (NĐ 356/2025 Điều 19.3) trong docs/DPIA.md; GPS chỉ thu khi có đồng ý riêng, rõ mục đích và nhân viên biết biện pháp giám sát (Luật 91/2025 Điều 25.3, 31.3a); KHÔNG thu sinh trắc/ảnh khuôn mặt; nộp hồ sơ cho cơ quan chuyên trách trong 60 ngày kể từ ngày bắt đầu xử lý thật là VIỆC CỦA CHỦ DỰ ÁN — agent không nộp · (2) Bật thu GPS/ảnh trước, lập hồ sơ sau
- Chọn: Lập hồ sơ DPIA đầy đủ theo nội dung Mẫu số 10 (NĐ 356/2025 Điều 19.3) trong docs/DPIA.md; GPS chỉ thu khi có đồng ý riêng, rõ mục đích và nhân viên biết biện pháp giám sát (Luật 91/2025 Điều 25.3, 31.3a); KHÔNG thu sinh trắc/ảnh khuôn mặt; nộp hồ sơ cho cơ quan chuyên trách trong 60 ngày kể từ ngày bắt đầu xử lý thật là VIỆC CỦA CHỦ DỰ ÁN — agent không nộp
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: nộp hồ sơ cho cơ quan nhà nước và xác nhận pháp chế là hành động ngoài khả năng và thẩm quyền của agent; thu mặc định tắt giữ đường lùi.
- Đường lùi: Bật cờ thu GPS sau khi chủ dự án nộp hồ sơ và có xác nhận
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): Chủ dự án nộp DPIA trong 60 ngày từ ngày xử lý đầu tiên; luật sư đọc bản chính thức Luật 91/2025 và NĐ 356/2025 (hiện đọc qua bản sao thương mại)

### D-033 · 2026-10-19T01:34:19+00:00 · Cách ghi nhận 'tự quyết' về pháp lý trong hồ sơ?

- Phương án: (1) Mọi giá trị ghi kèm nguồn luật + mức tin cậy + người quyết = chủ dự án uỷ quyền cho phiên chính; không ghi 'luật sư đã duyệt'; mục 'Khi chạy thật' liệt kê việc người phải làm · (2) Ghi như đã được pháp chế xác nhận
- Chọn: Mọi giá trị ghi kèm nguồn luật + mức tin cậy + người quyết = chủ dự án uỷ quyền cho phiên chính; không ghi 'luật sư đã duyệt'; mục 'Khi chạy thật' liệt kê việc người phải làm
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: không khai bằng chứng không có (AGENTS.md: bằng chứng, không lời khai).
- Đường lùi: Cập nhật hồ sơ khi có xác nhận pháp chế

### D-034 · 2026-10-19T02:07:34+00:00 · Định dạng luật cảnh báo, mã hoá sao lưu và vị trí mã mạng của T-045/T-046?

- Phương án: (1) alerts.json (không thêm parser); sao lưu openssl AES-256-CBC + PBKDF2 kèm sha256 sidecar kiểm toàn vẹn bản mã; webhook/scrape/probe ở scripts/alert-channels.ts vì lib/ cấm client mạng (DB-TX-003) · (2) YAML + age/gpg hoặc AES-GCM tự viết; nới test DB-TX-003
- Chọn: alerts.json (không thêm parser); sao lưu openssl AES-256-CBC + PBKDF2 kèm sha256 sidecar kiểm toàn vẹn bản mã; webhook/scrape/probe ở scripts/alert-channels.ts vì lib/ cấm client mạng (DB-TX-003)
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 3: không thêm phụ thuộc, không nới hàng rào; CBC không xác thực nhưng toàn vẹn được bảo vệ bằng sha256 kiểm trước khi giải mã.
- Đường lùi: Chuyển sang age/AES-GCM khi có công cụ chuẩn trên máy chủ
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): Dùng KMS/age và lưu sao lưu off-site; Prometheus/Alertmanager thật

### D-035 · 2026-10-19T02:50:23+00:00 · Chi tiết còn mở của T-044: gia hạn DSAR, xoá liên hệ nhân viên nghỉ việc, hồ sơ ứng viên đã trúng tuyển?

- Phương án: (1) Gia hạn một lần +15 ngày (theo khoản 5, khoản 2-4 chưa xác minh) và từ chối gia hạn khi đã quá hạn; xoá SĐT/email nhân viên ngay sau ngày chấm dứt, ẩn danh họ tên sau 10 năm; hồ sơ ứng viên trúng tuyển không đụng tới (chờ liên kết với nhân viên) · (2) +7 ngày, gia hạn hồi tố có cờ, chờ 30 ngày trước khi xoá liên hệ
- Chọn: Gia hạn một lần +15 ngày (theo khoản 5, khoản 2-4 chưa xác minh) và từ chối gia hạn khi đã quá hạn; xoá SĐT/email nhân viên ngay sau ngày chấm dứt, ẩn danh họ tên sau 10 năm; hồ sơ ứng viên trúng tuyển không đụng tới (chờ liên kết với nhân viên)
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1+3: bám đúng chữ luật đã đọc được, đơn giản; phần chưa chắc ghi rõ là giả định.
- Đường lùi: Đổi cấu hình số ngày; thêm migration liên kết ứng viên-nhân viên
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): HR chốt thời gian chờ xoá liên hệ nhân viên nghỉ việc (lương cuối); luật sư xác nhận số ngày gia hạn

### D-036 · 2026-10-19T03:55:18+00:00 · Đường dẫn mã hoá % hỏng làm Next trả 500 không có header bảo mật (DAST phát hiện): sửa thế nào mà không phình JS?

- Phương án: (1) Rewrite beforeFiles trong next.config.ts đưa về 404, test thuộc tính trên 40.000 chuỗi; thêm headers() cho nosniff/HSTS ở /api; pool DB giữ ở globalThis (hết nhân đôi kết nối) · (2) pages/400.tsx (làm JS tĩnh lên 336,9 KB > ngân sách 230) hoặc route handler 400 riêng (thêm route vào check:routes/openapi/authz)
- Chọn: Rewrite beforeFiles trong next.config.ts đưa về 404, test thuộc tính trên 40.000 chuỗi; thêm headers() cho nosniff/HSTS ở /api; pool DB giữ ở globalThis (hết nhân đôi kết nối)
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1+3: sửa lỗi thật mà không nới ngân sách JS; chỉ cấu hình nên dễ gỡ khi Next vá; có test hồi quy.
- Đường lùi: Gỡ rewrite khi bản Next vá lỗi DecodeError

### D-037 · 2026-10-19T04:51:15+00:00 · Mã hoá lúc lưu (T-048): chiến lược chuyển tiếp và phạm vi cột?

- Phương án: (1) Ghi chỉ cột mã hoá AES-256-GCM (AAD bảng.cột+id), đọc ưu tiên cột mã hoá, backfill và scrub tách riêng, bước contract (bỏ cột rõ) để lát sau; mã hoá SĐT (3 bảng), lý do nghỉ phép, toạ độ GPS; blind index cho SĐT; tệp tải lên mã hoá bằng khoá riêng mỗi tệp bọc khoá chủ; xoay khoá không dừng hệ thống · (2) Ghi cả cột rõ lẫn mã hoá cho an toàn lùi; mã hoá toàn bộ cột kể cả email đăng nhập/tên
- Chọn: Ghi chỉ cột mã hoá AES-256-GCM (AAD bảng.cột+id), đọc ưu tiên cột mã hoá, backfill và scrub tách riêng, bước contract (bỏ cột rõ) để lát sau; mã hoá SĐT (3 bảng), lý do nghỉ phép, toạ độ GPS; blind index cho SĐT; tệp tải lên mã hoá bằng khoá riêng mỗi tệp bọc khoá chủ; xoay khoá không dừng hệ thống
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1+2: bản rõ không nằm trong dump sau khi scrub; đường lùi vẫn đủ nhờ cột mới nullable và scrub tách riêng; email/tên là khoá đăng nhập/JOIN nên mã hoá phá chức năng.
- Đường lùi: Chạy lại backfill ngược hoặc bỏ cột enc; mã cũ vẫn chạy trên schema mới
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): KMS/HSM giữ khoá chủ, tách quyền khoá khỏi DB, mã hoá volume máy chủ; xoay khoá diễn tập trên staging

### D-038 · 2026-10-19T04:51:15+00:00 · Cổng GPS server (T-051) và việc sửa guard bất biến của attendance_event?

- Phương án: (1) Chỉ lưu toạ độ khi GEO_CAPTURE_ENABLED bật VÀ có đồng ý riêng geo_attendance còn hiệu lực; ngược lại bỏ toạ độ im lặng với client cũ và audit không chứa toạ độ; guard chấm công chỉ mở ngoại lệ hẹp: chuyển bản rõ sang bản mã/mã hoá lại, không cho xoá bản mã · (2) Từ chối 422 khi thiếu đồng ý; hoặc để role migration chạy xoay khoá
- Chọn: Chỉ lưu toạ độ khi GEO_CAPTURE_ENABLED bật VÀ có đồng ý riêng geo_attendance còn hiệu lực; ngược lại bỏ toạ độ im lặng với client cũ và audit không chứa toạ độ; guard chấm công chỉ mở ngoại lệ hẹp: chuyển bản rõ sang bản mã/mã hoá lại, không cho xoá bản mã
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: client cũ không vỡ, không thu dữ liệu nhạy cảm khi thiếu cơ sở; ngoại lệ guard hẹp, có test; rủi ro 'đổi geo_enc mà DB không kiểm plaintext' ghi nhận, giảm bằng audit khi xoay khoá.
- Đường lùi: Siết guard về chỉ role migration; hoặc đổi sang 422

### D-039 · 2026-10-19T05:25:31+00:00 · KMS/HSM tự host cho khoá mã hoá dữ liệu (startup chưa lập công ty, không có tài khoản cloud)?

- Phương án: (1) OpenBao (MPL-2.0, nhánh mã nguồn mở của Vault) Transit engine tự host; lib/crypto thêm lớp provider: env (dev) | transit (OpenBao/Vault API) với khoá chủ không rời KMS, xoay khoá bằng rotate Transit, nhật ký kiểm toán; HSM thật (PKCS#11 auto-unseal) ghi là bước sau khi có phần cứng/cloud HSM · (2) HashiCorp Vault (giấy phép BSL, không phải OSI) hoặc KMS của cloud
- Chọn: OpenBao (MPL-2.0, nhánh mã nguồn mở của Vault) Transit engine tự host; lib/crypto thêm lớp provider: env (dev) | transit (OpenBao/Vault API) với khoá chủ không rời KMS, xoay khoá bằng rotate Transit, nhật ký kiểm toán; HSM thật (PKCS#11 auto-unseal) ghi là bước sau khi có phần cứng/cloud HSM
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1+3 và mặc định tự host (AGENTS §5): giấy phép OSI, không cần tài khoản; giao diện Transit tương thích Vault nên đổi sang dịch vụ khác chỉ là cấu hình.
- Đường lùi: Đặt provider=env (hành vi hiện tại)
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): HSM/Cloud KMS thật hoặc OpenBao auto-unseal bằng PKCS#11 khi có công ty và ngân sách

### D-040 · 2026-10-19T05:25:32+00:00 · Sao lưu off-site 3-2-1 khi chưa có hạ tầng thuê?

- Phương án: (1) restic (BSD-2) kho mã hoá + toàn vẹn + snapshot bất biến theo chính sách; đích cấu hình được: thư mục/ổ khác, SFTP, S3-tương thích (MinIO tự host hoặc nhà cung cấp sau này); script backup-offsite + restic check + diễn tập khôi phục từ kho off-site; chính sách giữ N bản · (2) Tự viết sao chép + openssl
- Chọn: restic (BSD-2) kho mã hoá + toàn vẹn + snapshot bất biến theo chính sách; đích cấu hình được: thư mục/ổ khác, SFTP, S3-tương thích (MinIO tự host hoặc nhà cung cấp sau này); script backup-offsite + restic check + diễn tập khôi phục từ kho off-site; chính sách giữ N bản
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 3: công cụ chuẩn, nhiều backend, kiểm toàn vẹn sẵn; tự viết tăng rủi ro. Ổ/đích thật thuộc việc người khi có hạ tầng.
- Đường lùi: Giữ backup.sh cục bộ (T-045)
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): Đích off-site thật khác nhà cung cấp/khu vực (3-2-1) và khoá kho do người giữ riêng

### D-041 · 2026-10-19T05:25:32+00:00 · Prometheus/Alertmanager, staging TLS và ZAP khi chưa có máy chủ?

- Phương án: (1) Tải bản phát hành ghim phiên bản + sha256 (Prometheus, Alertmanager, promtool, Caddy, ZAP+Java) vào .tools/ (gitignore) qua script cài; chạy THẬT cục bộ: Prometheus scrape /api/metrics → rule → Alertmanager → webhook; Caddy 'tls internal' làm staging có TLS ở staging.localhost; ZAP baseline quét https; kèm tệp triển khai (compose, Caddyfile mẫu cho tên miền thật) chưa chạy được vì thiếu docker daemon/tên miền · (2) Chỉ viết cấu hình, không chạy
- Chọn: Tải bản phát hành ghim phiên bản + sha256 (Prometheus, Alertmanager, promtool, Caddy, ZAP+Java) vào .tools/ (gitignore) qua script cài; chạy THẬT cục bộ: Prometheus scrape /api/metrics → rule → Alertmanager → webhook; Caddy 'tls internal' làm staging có TLS ở staging.localhost; ZAP baseline quét https; kèm tệp triển khai (compose, Caddyfile mẫu cho tên miền thật) chưa chạy được vì thiếu docker daemon/tên miền
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: bằng chứng chạy thật mạnh hơn cấu hình suông; mọi binary OSI, kiểm sha256.
- Đường lùi: Xoá .tools/ và job CI tương ứng
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): Tên miền thật + chứng chỉ ACME; máy chủ staging; Alertmanager gửi tới kênh trực có người

### D-042 · 2026-10-19T05:25:32+00:00 · Chỉ số web thực địa (CWV p75/INP) khi chưa có người dùng thật?

- Phương án: (1) Tự làm RUM: beacon web-vitals nhỏ (PerformanceObserver, không phụ thuộc, không PII) gửi về /api/public/rum có giới hạn tần suất; gộp p75 theo trang vào bảng/metric; luật cảnh báo p75; JS client giữ ≤ ngân sách; bằng chứng cục bộ = trình duyệt thật trong staging TLS; số thực địa chỉ có khi có người dùng thật · (2) Dùng dịch vụ RUM bên thứ ba
- Chọn: Tự làm RUM: beacon web-vitals nhỏ (PerformanceObserver, không phụ thuộc, không PII) gửi về /api/public/rum có giới hạn tần suất; gộp p75 theo trang vào bảng/metric; luật cảnh báo p75; JS client giữ ≤ ngân sách; bằng chứng cục bộ = trình duyệt thật trong staging TLS; số thực địa chỉ có khi có người dùng thật
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1+3: không gửi dữ liệu người dùng cho bên thứ ba, không phụ thuộc; chi phí JS ~1 KB trong ngân sách.
- Đường lùi: Tắt cờ RUM và bỏ beacon
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): Đo p75 trên người dùng thật sau khi có lưu lượng; có thể thêm CrUX

### D-043 · 2026-10-19T05:25:32+00:00 · Hồ sơ pháp lý khi startup chưa thành lập công ty?

- Phương án: (1) Ghi rõ: bên kiểm soát dữ liệu phải là pháp nhân; trước khi có pháp nhân KHÔNG xử lý dữ liệu cá nhân thật của bên thứ ba; mốc 60 ngày DPIA tính từ ngày xử lý thật đầu tiên; ưu đãi startup (Luật 91/2025 Đ.38) không áp dụng khi xử lý dữ liệu nhạy cảm (GPS) hoặc quy mô lớn → GPS tắt mặc định; mọi hạ tầng dựng sẵn để bật khi có công ty · (2) Bật xử lý thật ngay
- Chọn: Ghi rõ: bên kiểm soát dữ liệu phải là pháp nhân; trước khi có pháp nhân KHÔNG xử lý dữ liệu cá nhân thật của bên thứ ba; mốc 60 ngày DPIA tính từ ngày xử lý thật đầu tiên; ưu đãi startup (Luật 91/2025 Đ.38) không áp dụng khi xử lý dữ liệu nhạy cảm (GPS) hoặc quy mô lớn → GPS tắt mặc định; mọi hạ tầng dựng sẵn để bật khi có công ty
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: chưa có pháp nhân thì chưa có bên kiểm soát hợp lệ; dựng sẵn giữ đường lùi.
- Đường lùi: Cập nhật hồ sơ khi thành lập công ty
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): Thành lập pháp nhân, xác định bên kiểm soát/xử lý, rồi nộp DPIA trong 60 ngày

### D-044 · 2026-10-19T06:17:29+00:00 · Giữ khoá chủ KMS và chỗ đặt transport mạng của KMS (T-052)?

- Phương án: (1) Giữ key id trong phong bì v2 (envelopeKeyId đọc được), chưa thêm cột key_id (hoãn migration vì phải sửa guard attendance_event); transport mạng đặt ở thư mục adapters/ (lib/ không chứa client mạng, test DB-TX-003 giữ nguyên); cài OpenBao/restic ghim sha256 trong job quality · (2) Thêm cột key_id sinh sẵn ngay; đặt transport trong scripts/; tách job ops-tools
- Chọn: Giữ key id trong phong bì v2 (envelopeKeyId đọc được), chưa thêm cột key_id (hoãn migration vì phải sửa guard attendance_event); transport mạng đặt ở thư mục adapters/ (lib/ không chứa client mạng, test DB-TX-003 giữ nguyên); cài OpenBao/restic ghim sha256 trong job quality
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1+3: không đụng thêm guard bất biến của chấm công; không nới hàng rào; sha256 + chữ ký GPG (OpenBao) kiểm trước khi chạy.
- Đường lùi: Provider env; bỏ adapters/ và bước cài tool trong CI
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): HSM/PKCS#11 hoặc cloud KMS auto-unseal; cột key_id riêng khi có nhu cầu truy vấn theo khoá
