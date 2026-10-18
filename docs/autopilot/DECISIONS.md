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
