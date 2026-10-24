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

### D-045 · 2026-10-19T08:37:22+00:00 · Hai lệnh kiểm workflow (WF-CI-004, SEC-SUPPLY-009) đỏ vì pr-steward.yml của khung 3.6.0 dùng issue_comment/quyền write

- Phương án: (1) Loại pr-steward.yml khỏi hai lệnh kiểm (khung tự quản, tự có cổng comment OWNER/COLLABORATOR/MEMBER) · (2) Sửa pr-steward.yml cho khớp luật dự án (lệch khung, mất ở lần nâng khung kế) · (3) Gỡ pr-steward.yml
- Chọn: Loại pr-steward.yml khỏi hai lệnh kiểm (khung tự quản, tự có cổng comment OWNER/COLLABORATOR/MEMBER)
- Lý do (tiêu chí chất lượng cuối): Tệp do khung cung cấp và chủ dự án đã merge (#23); luật vẫn áp cho mọi workflow khác; không nới cho tệp dự án tự viết
- Đường lùi: Bỏ biến F khỏi hai lệnh kiểm

### D-046 · 2026-10-19T11:21:07+00:00 · Mốc và số phiên bản cho bản phát hành đầu của X-Company (Release PR #25 đề xuất 1.0.0 với changelog lẫn lịch sử khung X-Templates, repo đã có tag v2.0.0 của khung)

- Phương án: (1) Giữ nguyên: phát hành 1.0.0, changelog gồm cả commit của khung · (2) bootstrap-sha = 1c2a28e (commit mở đầu X-Company) + bump-minor-pre-major: bản đầu 0.2.0, changelog chỉ commit của dự án · (3) last-release-sha = 1c2a28e (áp mọi lần phát hành, phải gỡ sau)
- Chọn: bootstrap-sha = 1c2a28e (commit mở đầu X-Company) + bump-minor-pre-major: bản đầu 0.2.0, changelog chỉ commit của dự án
- Lý do (tiêu chí chất lượng cuối): Đúng: changelog chỉ phản ánh thay đổi của sản phẩm; GO-NO-GO đang NO-GO nên 0.x đúng ngữ nghĩa SemVer (1.0.0 = API ổn định, sẵn production); bootstrap-sha chỉ áp cho bản đầu nên không cần gỡ; tránh đụng tag v2.0.0 cũ của khung (không xoá tag)
- Đường lùi: Bỏ bootstrap-sha/bump-minor-pre-major khỏi release-please-config.json; muốn 1.0.0 thì commit có footer 'Release-As: 1.0.0'

### D-047 · 2026-10-19T13:02:17+00:00 · ZAP 10202 (Absence of Anti-CSRF Tokens, Medium) trên /app/login và /lien-he sau khi form chuyển method=post (để chặn lộ mật khẩu/email lên URL khi chưa hydrate — ZAP 10024 qua https)

- Phương án: (1) Giữ form GET (bỏ method=post): hết 10202 nhưng mật khẩu nằm trên URL khi bấm gửi trước khi JS chạy · (2) method=post + thêm ô ẩn csrf_token giả để ZAP nhận: token không được kiểm ở đâu (gửi gốc không có handler) — an ninh giả · (3) method=post + allowlist zap-gate cho 10202 GIỚI HẠN theo đường dẫn (^/app/login$, ^/lien-he$), mở rộng zap-gate để mục allowlist có paths; form khác vẫn đỏ
- Chọn: method=post + allowlist zap-gate cho 10202 GIỚI HẠN theo đường dẫn (^/app/login$, ^/lien-he$), mở rộng zap-gate để mục allowlist có paths; form khác vẫn đỏ
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: chặn lỗ thật (dữ liệu nhạy cảm lên URL); 10202 ở hai trang này là dương tính giả — gửi gốc của form về chính trang, không handler đổi trạng thái; gửi thật là fetch tới /api có kiểm Origin (+ header CSRF khi đã đăng nhập, tests/http). Allowlist theo đường dẫn giữ cổng chặt cho mọi form khác.
- Đường lùi: Xoá mục 10202 trong security/zap/allowlist.json (cổng đỏ lại) hoặc bỏ method=post
- Đính chính (review PR #33): chỉ `/api/app/auth/login` kiểm Origin; `/api/public/inquiries` không kiểm Origin — là endpoint công khai không phiên nên CSRF không áp dụng (giới hạn tần suất theo IP). Kết luận dương tính giả không đổi.

### D-048 · 2026-10-19T21:11:02+00:00 · Duyệt kế hoạch sửa audit 2026-10-19 (6 đợt, AUDIT-REPORT §5)

- Phương án: (1) Duyệt 6 đợt, 🟠 trước, test đỏ trước khi sửa · (2) Chờ người duyệt
- Chọn: Duyệt 6 đợt, 🟠 trước, test đỏ trước khi sửa
- Lý do (tiêu chí chất lượng cuối): Đúng/an toàn trước: DATA/XFEAT/CODE 🟠 có tái hiện hoặc đọc mã; mục chạm auth/migration vẫn do người merge
- Đường lùi: Đóng PR đợt chưa merge

### D-049 · 2026-10-19T23:13:58+00:00 · ZAP 20012 (Anti-CSRF Tokens Check, quét chủ động) trên /app/login và /lien-he sau khi form chuyển POST: allowlist hay thêm token?

- Phương án: (1) Thêm token CSRF vào hai form (đổi hợp đồng API đăng nhập/liên hệ) · (2) Allowlist 20012 giới hạn đúng hai đường dẫn, cùng lý do với 10202 (D-047)
- Chọn: Allowlist 20012 giới hạn đúng hai đường dẫn, cùng lý do với 10202 (D-047)
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn: hai form chỉ gửi gốc về chính trang, không handler đổi trạng thái; gửi thật qua fetch có Origin check hoặc endpoint công khai không phiên. Giữ phạm vi hẹp theo đường dẫn nên form khác vẫn đỏ.
- Đường lùi: Xoá mục 20012 trong security/zap/allowlist.json (cổng đỏ lại)

### D-050 · 2026-10-21T05:49:40+00:00 · AUD-CI-002/CFG-001: kiểm ruleset sống và khoá .env.example nên làm đỏ CI hay chỉ cảnh báo?

- Phương án: (1) Đỏ ngay khi ruleset sống thiếu context/khoá .env.example thiếu (theo nguyên văn đề xuất audit) · (2) Đỏ với độ lệch MỚI; độ lệch đã biết chờ người nằm trong danh sách có tên (PENDING_EXAMPLE_KEYS) tự co; ruleset sống giữ cảnh báo
- Chọn: Đỏ với độ lệch MỚI; độ lệch đã biết chờ người nằm trong danh sách có tên (PENDING_EXAMPLE_KEYS) tự co; ruleset sống giữ cảnh báo
- Lý do (tiêu chí chất lượng cuối): Đúng và an toàn: phương án 1 khoá mọi PR (kể cả PR sửa) tới khi người import ruleset/ghi .env.example — agent không được ghi .env.*, API rules lỗi mạng cũng thành đỏ giả. Ruleset đã import (protection-guard run 39545193098 không cảnh báo). Phương án 2 vẫn chặn mọi độ lệch mới, danh sách chờ hiện tên từng khoá và báo lỗi khi đã thêm nên không mục nát.
- Đường lùi: Xoá PENDING_EXAMPLE_KEYS (check:env đỏ tới khi .env.example đủ khoá); đổi ::warning thành ::error ở bước ruleset của protection-guard

### D-051 · 2026-10-21T18:42:35+00:00 · Duyệt PLAN lát 11 (T-058…T-064): sửa 7 mục audit 🟢 còn mở agent tự làm được

- Phương án: (1) Duyệt lát 11 gồm XFEAT-003/004/005/006/007, SEC-004, PERF-002; mỗi task một PR nhỏ theo thứ tự rủi ro thấp trước; PR chạm auth/quyền/migration để người merge (merge_hard_exceptions: human); để lại SEC-002/DOC-001/DOC-002/CFG-001 cho người quyết, SEC-005/A11Y-007/008/009/DATA-003/004/TEST-001/PERF-001/003 cho lát sau · (2) Chờ người chọn mục audit
- Chọn: Duyệt lát 11 gồm XFEAT-003/004/005/006/007, SEC-004, PERF-002; mỗi task một PR nhỏ theo thứ tự rủi ro thấp trước; PR chạm auth/quyền/migration để người merge (merge_hard_exceptions: human); để lại SEC-002/DOC-001/DOC-002/CFG-001 cho người quyết, SEC-005/A11Y-007/008/009/DATA-003/004/TEST-001/PERF-001/003 cho lát sau
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1+3: mỗi mục có đường tái hiện và Gate máy kiểm, test đỏ trước khi sửa; mục cần người quyết không bị đụng; A11Y-009 cần giảm JS trước nên chưa làm
- Đường lùi: Đóng PR chưa merge; đánh [~] task chưa làm kèm lý do

### D-052 · 2026-10-21T18:43:05+00:00 · Lát 11 nằm trong PLAN.md (57 task cũ phải chạy lại Gate vì máy mới không có bằng chứng cục bộ) hay PLAN riêng?

- Phương án: (1) PLAN riêng docs/autopilot/PLAN-lat-11.md, PLAN.md trỏ tới; vòng chỉ kiểm task mới · (2) Giữ trong PLAN.md và chạy lại 57 Gate cũ (gồm e2e, drill cần tải OpenBao/restic/Prometheus/Caddy/ZAP)
- Chọn: PLAN riêng docs/autopilot/PLAN-lat-11.md, PLAN.md trỏ tới; vòng chỉ kiểm task mới
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 3: bằng chứng lát 1–10 đã có ở CI/PR đã merge; chạy lại không thêm độ tin cho việc mới mà tốn hàng giờ; CI vẫn chạy toàn bộ cổng ở mỗi PR
- Đường lùi: Gộp task lát 11 về PLAN.md và loop init lại

### D-053 · 2026-10-21T19:41:30+00:00 · AUD-SEC-004: chặn dò mật khẩu rải — ngưỡng và loại khoá thêm ngoài cặp (email, IP) 5/15 phút?

- Phương án: (1) Thêm khoá theo IP (mọi email) 30 lần sai/15 phút và theo email (mọi IP) 50 lần sai/15 phút; đếm lần sai đã ghi, cùng cửa sổ, 429 + Retry-After; index (ip, attempted_at) cho lần sai · (2) Khoá theo email (mọi IP) ở ngưỡng thấp 10/15 phút · (3) Chỉ khoá theo IP
- Chọn: Thêm khoá theo IP (mọi email) 30 lần sai/15 phút và theo email (mọi IP) 50 lần sai/15 phút; đếm lần sai đã ghi, cùng cửa sổ, 429 + Retry-After; index (ip, attempted_at) cho lần sai
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: rải một IP qua nhiều email bị chặn sau 30 lần; một email bị dò từ nhiều IP bị chặn sau 50 lần (~4.800 lần/ngày thay vì vô hạn). Ngưỡng email cao để kẻ lạ cần ≥ 10 IP mới khoá được tài khoản người khác — tránh lặp lại lỗi khoá-tài-khoản-hộ của SEC-001; ngưỡng thấp (phương án 2) đổi dò mật khẩu lấy DoS khoá tài khoản
- Đường lùi: Bỏ hai bộ đếm mới trong lib/identity/auth.ts; index chỉ thêm, giữ hoặc DROP bằng migration contract

### D-054 · 2026-10-21T19:51:48+00:00 · PR cuối lát 11 (T-062 quyền, T-063 đăng nhập, T-064 retention + migration) 289 dòng thêm > 150: tách hay gộp?

- Phương án: (1) Gộp một PR, giữ ba commit riêng theo task để người review từng commit; PR mô tả tách mục · (2) Tách: mở PR T-062+T-063 trước, giữ T-064 ở máy tới khi người merge PR trước
- Chọn: Gộp một PR, giữ ba commit riêng theo task để người review từng commit; PR mô tả tách mục
- Lý do (tiêu chí chất lượng cuối): Cả ba là ngoại lệ cứng (authz/auth/migration) nên đều chờ người merge; phiên chỉ được đẩy một nhánh nên PR thứ hai không mở được trước khi PR đầu merge — tách thì T-064 không tới tay người review. ~120 dòng là test; mã sản phẩm mỗi task < 80 dòng
- Đường lùi: Người review có thể yêu cầu tách; revert từng commit theo task

### D-055 · 2026-10-21T22:21:26+00:00 · Duyệt PLAN lát 12–13 (T-065…T-078): hoàn tất phát triển rồi pha harden trước production, theo yêu cầu chủ dự án 'chạy dev hoàn chỉnh trước khi lên production'

- Phương án: (1) Lát 12: mọi audit 🟢 agent tự làm được (SEC-005, DATA-003/004, PERF-001/003, A11Y-007/008/009 sau khi giảm JS thật, TEST-001) + ghim gitleaks; lát 13: delivery_phase harden, audit delta, release-check, GO-NO-GO. Không làm DEP-001 (typescript-eslint 8.72.0 peer typescript <6.1.0, npm 2026-10-21), HAR-003, phần XFEAT-005 chờ lịch công ty · (2) Chỉ chuyển harden ngay, để các mục 🟢 lại
- Chọn: Lát 12: mọi audit 🟢 agent tự làm được (SEC-005, DATA-003/004, PERF-001/003, A11Y-007/008/009 sau khi giảm JS thật, TEST-001) + ghim gitleaks; lát 13: delivery_phase harden, audit delta, release-check, GO-NO-GO. Không làm DEP-001 (typescript-eslint 8.72.0 peer typescript <6.1.0, npm 2026-10-21), HAR-003, phần XFEAT-005 chờ lịch công ty
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1+3: đóng lỗi đã biết trước khi đánh giá phát hành; giữ trần JS 230 KB và cách đo (giảm JS thật trước khi thêm tính năng a11y); TS7 làm gãy lint có kiểu nên chờ hệ sinh thái
- Đường lùi: Đánh [~] task chưa làm kèm lý do; đóng PR chưa merge; xt.yaml về delivery_phase: build

### D-056 · 2026-10-21T23:24:25+00:00 · T-068 AUD-DATA-003: xoá toạ độ GPS khi trigger guard chặn mọi role — thiết kế và mặc định lưu giữ

- Phương án: (1) Hàm SECURITY DEFINER hẹp + guard (CREATE OR REPLACE, cách 0025 đã làm) nhận cờ xc.geo_erase chỉ khi current_user là owner; chỉ hàm retention theo lô; RETENTION_GEO_DAYS=90 theo server_received_at · (2) Như 1 nhưng thêm hàm xoá theo id cho DSAR ngay (chưa có caller) · (3) Tắt trigger / session_replication_role khi xoá
- Chọn: Hàm SECURITY DEFINER hẹp + guard (CREATE OR REPLACE, cách 0025 đã làm) nhận cờ xc.geo_erase chỉ khi current_user là owner; chỉ hàm retention theo lô; RETENTION_GEO_DAYS=90 theo server_received_at
- Lý do (tiêu chí chất lượng cuối): (1) an toàn: role ứng dụng tự SET cờ vẫn bị chặn, tắt trigger cần quyền cao và khoá bảng; không giữ hàm đặc quyền chưa có caller. Lệch 'chỉ thêm hàm/quyền' của PLAN: guard phải đổi vì SECURITY DEFINER không bỏ qua trigger. 90 ngày là GIẢ ĐỊNH tối thiểu hoá (đủ chốt kỳ tháng + khiếu nại), chờ pháp chế; mốc server_received_at vì client không giả mạo được
- Đường lùi: RETENTION_GEO_DAYS đổi bằng env (1..3650); RETENTION_ENABLED=false tắt cả job; gỡ: DROP FUNCTION attendance_event_erase_geo + index, khôi phục thân guard 0025 bằng migration mới

### D-057 · 2026-10-22T00:57:27+00:00 · T-077 audit delta pha harden: xử lý 4 phát hiện 🟠 mới và 14 🟢 thế nào?

- Phương án: (1) Sửa ngay trong PR #68 các 🟠 có đường tái hiện (A11Y-010 mã chết SW + e2e, DOC-008 tài liệu lệch ruleset/retention) và 🟢 rẻ có test (DATA-005); hạ SEC-006 xuống 🟢 (đánh đổi đã chấp nhận ở D-053, ghi THREAT-MODEL); 🟢 còn lại ghi sổ mở · (2) Mở lát 14 sửa mọi 🟢 trước release-check · (3) Chỉ ghi sổ, không sửa gì
- Chọn: Sửa ngay trong PR #68 các 🟠 có đường tái hiện (A11Y-010 mã chết SW + e2e, DOC-008 tài liệu lệch ruleset/retention) và 🟢 rẻ có test (DATA-005); hạ SEC-006 xuống 🟢 (đánh đổi đã chấp nhận ở D-053, ghi THREAT-MODEL); 🟢 còn lại ghi sổ mở
- Lý do (tiêu chí chất lượng cuối): (1) đúng/an toàn: 🟠 tuyên bố sửa quá mức và tài liệu dẫn chủ dự án import sai ruleset phải đóng trước GO-NO-GO; 🟢 còn lại không chặn production (RUM tắt, chưa có route quản trị quyền, chưa bật GPS) — ghi sổ có điều kiện kích hoạt; (3) giữ PR nhỏ, không phình phạm vi pha harden
- Đường lùi: Các 🟢 mở có Gate tay trong sổ; mở lát mới bằng PLAN khi chủ dự án muốn

### D-058 · 2026-10-24T01:50:42+00:00 · Duyệt PLAN lát 14–15 (T-079…T-088): đóng 🟠 SEC-002/DOC-001/DOC-002 mà phiên trước để chờ người, cùng 🟢 rẻ

- Phương án: (1) Tự duyệt: lát 14 (làn chuẩn) DOC-001 form ứng tuyển, DOC-002 thông báo trong ứng dụng tự host (bảng notification + handler outbox), DATA-006, CODE-010, A11Y-011, PERF-004, TEST-002; lát 15 (ngoại lệ cứng, người merge) TOTP RFC 6238 bằng node:crypto + SEC-007; không làm CFG-* (hook chặn), DEP-001 (typescript-eslint peer <6.1.0), SEC-008, HAR-003, CI-004 · (2) Tiếp tục để SEC-002/DOC-001/DOC-002 chờ chủ dự án quyết, chỉ làm 🟢 · (3) Chỉ ghi GO-NO-GO §2b các thiếu hụt, không làm mã
- Chọn: Tự duyệt: lát 14 (làn chuẩn) DOC-001 form ứng tuyển, DOC-002 thông báo trong ứng dụng tự host (bảng notification + handler outbox), DATA-006, CODE-010, A11Y-011, PERF-004, TEST-002; lát 15 (ngoại lệ cứng, người merge) TOTP RFC 6238 bằng node:crypto + SEC-007; không làm CFG-* (hook chặn), DEP-001 (typescript-eslint peer <6.1.0), SEC-008, HAR-003, CI-004
- Lý do (tiêu chí chất lượng cuối): AGENTS.md §5: spec/thiết kế/phạm vi/bảo mật là điểm quyết định phiên chính tự duyệt — SPEC-identity-org đã ghi TOTP bắt buộc trước pilot, F-003/F-010 là Must; (1) đúng/an toàn: TOTP giảm T1, thông báo thật tới người dùng; (2) đường lùi: PR riêng mỗi lát, migration chỉ thêm; (3) tự host không cần SMTP/Web Push/khoá ngoài; HMAC-SHA1 của node:crypto + vector RFC 4226/6238, không tự chế nguyên thuỷ mật mã (custom_crypto=false), không thêm phụ thuộc
- Đường lùi: Đóng PR chưa merge; revert từng commit theo task; DROP bảng notification/cột totp bằng migration contract; đánh [~] task chưa làm kèm lý do
- Khi chạy thật (đề xuất, chủ dự án quyết ở G7): Khi chạy thật: thêm kênh email/Web Push cho thông báo (cần SMTP/VAPID của chủ dự án) bên cạnh kênh trong ứng dụng

### D-059 · 2026-10-24T02:23:12+00:00 · T-080: thông báo trong ứng dụng và kênh phụ chung một handler — kênh phụ tắt làm hoãn cả thông báo trong ứng dụng; tách ngay hay để sau?

- Phương án: (1) Giữ một handler mỗi topic; ghi điều kiện: trước task kênh SMTP/Web Push phải tách thành nhiều consumer mỗi topic (Registry nhiều handler) · (2) Tách ngay: Registry nhiều handler mỗi topic, mỗi handler một consumer
- Chọn: Giữ một handler mỗi topic; ghi điều kiện: trước task kênh SMTP/Web Push phải tách thành nhiều consumer mỗi topic (Registry nhiều handler)
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 3 (đơn giản, theo chuẩn) + 1 không bị ảnh hưởng hôm nay: kênh phụ duy nhất là log, luôn bật, nên không có đường nào hoãn thông báo; tách ngay đổi Registry/processOne và test worker cho một lỗi chưa thể xảy ra, làm phình PR. Ghi 🟢 trong AUDIT-STATUS kèm điều kiện kích hoạt
- Đường lùi: Tách Registry thành nhiều consumer mỗi topic khi thêm kênh thật; dữ liệu notification không đổi

### D-060 · 2026-10-24T02:30:56+00:00 · T-086: phản hồi login khi cần TOTP — đổi 200 thành oneOf(LoginResult, MfaChallengeResult) (phá hợp đồng) hay trả 202?

- Phương án: (1) Giữ 200 oneOf + x-breaking-approved; client duy nhất (UI login của repo) sửa ở T-087 trong cùng PR lát 15 · (2) Trả 202 cho thử thách (không phá hợp đồng trên giấy)
- Chọn: Giữ 200 oneOf + x-breaking-approved; client duy nhất (UI login của repo) sửa ở T-087 trong cùng PR lát 15
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: client cũ coi mọi 2xx là đăng nhập thành công, nên 202 cũng làm vỡ luồng mà còn che giấu thay đổi; không có client ngoài (API nội bộ, PWA cùng repo), UI sửa cùng PR nên không có phiên bản nào chạy với hợp đồng lệch
- Đường lùi: Revert PR lát 15 khôi phục hợp đồng cũ

### D-061 · 2026-10-24T03:31:37+00:00 · PR #73 CI đỏ (drills/dast): ZAP 10202/20012 Absence of Anti-CSRF Tokens trên form ứng tuyển mới (/tuyen-dung, tin tuyển dụng)

- Phương án: (1) Mở rộng allowlist theo đường dẫn ^/tuyen-dung(/slug)?$ cho 10202 và 20012, cùng lập luận D-047/D-049 · (2) Thêm ô csrf_token giả vào form · (3) Bỏ method=post khỏi form ứng tuyển
- Chọn: Mở rộng allowlist theo đường dẫn ^/tuyen-dung(/slug)?$ cho 10202 và 20012, cùng lập luận D-047/D-049
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 1: form gửi bằng fetch tới /api/public/applications — endpoint công khai không phiên, không có gì để CSRF lợi dụng (giới hạn tần suất theo IP); method=post chỉ để dữ liệu ứng viên không lên URL khi JS chưa chạy. Token giả là an ninh giả (D-047 đã loại); bỏ POST làm lộ email/SĐT lên URL. Allowlist giới hạn đúng đường dẫn, form ở chỗ khác vẫn đỏ
- Đường lùi: Xoá đường dẫn khỏi security/zap/allowlist.json

### D-062 · 2026-10-24T03:56:24+00:00 · Lát 15 (TOTP, SEC-007 — ngoại lệ cứng) đẩy thế nào khi phiên chỉ được đẩy một nhánh và PR #73 (lát 14) đang chờ người merge?

- Phương án: (1) Đẩy lát 15 lên cùng nhánh: PR #73 thành PR lát 14–15, giữ mỗi task một commit, mô tả tách mục; reviewer-alt rà riêng phần lát 15 trước khi đẩy · (2) Giữ lát 15 ở máy tới khi #73 merge, rồi mở PR riêng
- Chọn: Đẩy lát 15 lên cùng nhánh: PR #73 thành PR lát 14–15, giữ mỗi task một commit, mô tả tách mục; reviewer-alt rà riêng phần lát 15 trước khi đẩy
- Lý do (tiêu chí chất lượng cuối): Tiêu chí 2 (giữ đường lùi) + 1: container phiên là tạm — mã chỉ ở máy sẽ mất khi phiên kết thúc mà #73 chưa merge (người merge, không biết khi nào); cả hai lát đều là ngoại lệ cứng do người merge nên gộp không đổi làn; commit theo task giúp người review từng phần (tiền lệ D-054)
- Đường lùi: Người review có thể yêu cầu tách: revert/cherry-pick các commit lát 15 sang nhánh mới

### D-063 · 2026-10-24T07:03:16+00:00 · PR #73 đã được chủ dự án merge (squash 33e7e1a) trước khi lát 15 được đẩy — giữ D-062 (gộp vào #73) hay mở PR riêng?

- Phương án: (1) PR riêng cho lát 15: dựng lại nhánh từ main, cherry-pick 9 commit lát 15, mở PR mới (ngoại lệ cứng, người merge) · (2) Giữ cách D-062
- Chọn: PR riêng cho lát 15: dựng lại nhánh từ main, cherry-pick 9 commit lát 15, mở PR mới (ngoại lệ cứng, người merge)
- Lý do (tiêu chí chất lượng cuối): Điều kiện của D-062 (không đẩy được khi #73 còn mở) không còn; PR riêng nhỏ hơn, người review chỉ đọc phần xác thực — tiêu chí 3; D-062 thay bằng quyết định này
- Đường lùi: Đóng PR lát 15, giữ commit ở nhánh
