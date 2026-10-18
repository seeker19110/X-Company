---
title: RUNBOOK — X-Company
updated: 2026-10-18
owner: seeker19110
last_drilled: chưa diễn tập
status: nháp — chưa có môi trường production thật; lệnh PM2/psql là mẫu chưa chạy trên hạ tầng thật
---

# RUNBOOK — X-Company · cập nhật 2026-10-18 · chủ: seeker19110

> Luật: mọi bước là lệnh chép-chạy được; **không ghi giá trị bí mật** (chỉ ghi nơi lấy). Chỗ cần người điền: `<chủ dự án điền>`.
> `last_drilled: chưa diễn tập` — chưa có bước nào ở đây đã chạy trên production; diễn tập đầu tiên do người **không phải tác giả** thực hiện (OPS-DR-008), ghi tên và ngày vào bảng cuối tài liệu. Quá 6 tháng kể từ `last_drilled` thì `npm run -s check:docs` cảnh báo/đỏ.
> Việc xảy ra sự cố: [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md). Khôi phục: [runbooks/restore-db.md](runbooks/restore-db.md), [runbooks/restore-files.md](runbooks/restore-files.md). Rò rỉ dữ liệu cá nhân: [runbooks/data-breach.md](runbooks/data-breach.md).

## 0. Thông tin nhanh
| Mục | Giá trị |
|---|---|
| Môi trường | dev: máy cá nhân (`npm run dev`) · staging: `<chủ dự án điền>` · production: `<chủ dự án điền>` (tự host, PM2 — ADR-0001) |
| Repo / nhánh phát hành | <https://github.com/seeker19110/X-Company> · `main` (squash merge, ruleset ở `.github/rulesets/main.json`) |
| Hạ tầng | máy chủ/nhà cung cấp: `<chủ dự án điền>` · IaC: chưa có |
| Dashboard / log / trace | chưa có — dự kiến T-026/T-038 (log JSON, metric); tạm: `pm2 logs` |
| Kho bí mật | `<chủ dự án điền: tên kho/đường dẫn>` — KHÔNG ghi giá trị ở đây; biến môi trường mẫu ở `.env.example` |
| Trang trạng thái / kênh người dùng | `<chủ dự án điền>` |
| Người trực | `<chủ dự án điền: tên, kênh liên lạc>` — mặc định chủ dự án (@seeker19110) |

Biến môi trường mà mã đọc (tên thật trong mã; giá trị không ghi ở đây): `DATABASE_URL` (ứng dụng, role không phải owner) · `MIGRATE_DATABASE_URL` (chỉ migration, role owner) ·
`SESSION_SECRET` (≥ 32 byte) · `QR_SIGNING_KEYS` (`kid1:khoá1,kid2:khoá2`; kid đầu dùng để ký) · `APP_ORIGIN` · `TRUST_PROXY`, `TRUST_PROXY_HOPS` ·
`SITE_COMPANY_ID` · `FILE_STORAGE_DIR` · `DB_POOL_MAX` · `NEXT_TELEMETRY_DISABLED=1`.

## 1. Lệnh vận hành (mẫu — chưa chạy trên production)

### Kiểm tra sức khoẻ
Chưa có `/healthz` (dự kiến T-027). Tạm thời:
```bash
curl -fsS -o /dev/null -w '%{http_code}\n' "$APP_ORIGIN/robots.txt"   # 200 = web sống
pm2 status x-company
psql "$DATABASE_URL" -c 'select 1'                                    # DB nhận kết nối bằng role ứng dụng
```

### Deploy (một bản phát hành = một SHA/tag đã qua CI trên `main`)
```bash
set -euo pipefail
cd /srv/x-company                      # <chủ dự án điền: thư mục cài>
git fetch --tags origin && git checkout <SHA-hoặc-tag>
npm ci
npm run build
MIGRATE_DATABASE_URL="<lấy từ kho bí mật>" npm run db:migrate   # migration append-only; xem mục Rollback về dữ liệu
pm2 reload x-company || pm2 start npm --name x-company -- run start   # lần đầu: tạo tiến trình
```
Trước deploy: CI `quality` xanh trên SHA; `docs/ops/RPO-RTO.md` có bản sao lưu mới nhất; migration mới đã đọc kỹ (không phá vỡ, có đường lùi).

### Rollback (mã) — mục tiêu ≤ 5 phút, **chưa diễn tập**
```bash
git checkout <SHA-bản-trước>
npm ci && npm run build
pm2 reload x-company
```
Rollback **mã** không lùi **dữ liệu**: migration đã áp là append-only (runner so checksum, không sửa tệp đã áp). Vì vậy migration viết theo kiểu mở rộng
trước/thu hẹp sau (thêm cột nullable, chưa xoá cột cũ) để bản mã cũ vẫn chạy được; muốn lùi dữ liệu thật sự thì viết migration mới hoặc khôi phục từ sao lưu
([restore-db.md](runbooks/restore-db.md)) — thao tác này theo mục "Trước khi chạy lệnh lên dữ liệu" của [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md).

### Chẩn đoán
```bash
pm2 logs x-company --lines 200 --nostream     # log gần nhất (PM2 mặc định không che PII — chưa có logger che trường, T-026)
pm2 describe x-company                         # số lần khởi động lại, bộ nhớ
npm run audit:verify                           # cần DATABASE_URL; exit 1 và in id hàng đầu tiên sai nếu chuỗi audit bị sửa (S-ID-08)
psql "$DATABASE_URL" -c "select count(*) filter (where processed_at is null) as chua_xu_ly, max(attempts) from outbox_event"
psql "$DATABASE_URL" -c "select count(*) from session where absolute_expires_at > now()"   # phiên còn hiệu lực
```

### Khôi phục sao lưu
Xem [runbooks/restore-db.md](runbooks/restore-db.md) và [runbooks/restore-files.md](runbooks/restore-files.md). Diễn tập gần nhất: chưa diễn tập; thời gian đo được: chưa có.

### Vô hiệu hoá nhanh một tài khoản / thu hồi quyền (hiệu lực ngay ở request kế tiếp — R8)
```bash
psql "$MIGRATE_DATABASE_URL" <<'SQL'
begin;
update app_user set disabled_at = now(), auth_version = auth_version + 1 where email = '<email-đã-điều-tra>' and disabled_at is null;
update role_grant set revoked_at = now() where user_id = (select id from app_user where email = '<email-đã-điều-tra>') and revoked_at is null;
-- kiểm số dòng bị đổi rồi mới commit
commit;
SQL
```
Thao tác tay không đi qua `audit.append`: ghi lại ai/lúc nào/lý do ở timeline sự cố (xem INCIDENT-RESPONSE) và bổ sung bản ghi audit qua đường ứng dụng khi có thể.

## 2. Xoay bí mật

### `SESSION_SECRET` (khoá ký CSRF; phiên lưu băm trong bảng `session`)
`SESSION_SECRET` ký token CSRF (`HMAC(SESSION_SECRET, "csrf:"+token phiên)`); đổi giá trị làm **mọi token CSRF cũ mất hiệu lực** — người dùng đang mở trang sẽ bị từ chối ghi cho tới khi tải lại.
```bash
openssl rand -base64 48            # sinh giá trị mới (≥ 32 byte); lưu vào kho bí mật, KHÔNG dán vào chat/commit
# đặt SESSION_SECRET mới trong môi trường của PM2, rồi:
pm2 restart x-company --update-env
# nếu nghi lộ token phiên (không chỉ khoá ký): ép đăng xuất toàn bộ
psql "$MIGRATE_DATABASE_URL" -c 'delete from session'
```

### `QR_SIGNING_KEYS` — nhiều kid, xoay không gián đoạn
Định dạng `kid1:khoá1,kid2:khoá2`; **kid đầu tiên dùng để ký**, các kid còn lại chỉ để kiểm (xem `lib/attendance/qr.ts`). QR có TTL 60 s (+ lệch cho phép 10 s) nên cửa sổ chuyển ngắn.
1. Sinh khoá mới: `openssl rand -base64 32` (kid mới, vd `k2026b`).
2. Đặt `QR_SIGNING_KEYS="k2026b:<khoá-mới>,k2026a:<khoá-cũ>"` (mới đứng đầu) → `pm2 restart x-company --update-env`. QR đã in/hiển thị bằng khoá cũ còn kiểm được.
3. Sau ≥ 5 phút (QR cũ hết TTL; bản chờ ngoại tuyến quá hạn QR thì vào `needs_review`) bỏ kid cũ: `QR_SIGNING_KEYS="k2026b:<khoá-mới>"` → restart.
4. **Nếu khoá bị lộ**: bỏ kid lộ ngay (bước 3 không chờ), chấp nhận QR đang hiển thị mất hiệu lực; rà `attendance_event` có `qr_nonce` trong khoảng lộ (mục "Lộ bí mật").

### Mật khẩu DB
Hai role đăng nhập tách vai trò: role ứng dụng (thành viên `xc_app_rw`, dùng trong `DATABASE_URL`) và role migration owner (`MIGRATE_DATABASE_URL`). Tên role đăng nhập: `<chủ dự án điền>`.
```bash
openssl rand -base64 32
psql "$MIGRATE_DATABASE_URL" -c "alter role <role-ứng-dụng> with password '<mật-khẩu-mới>'"   # chạy bằng role đủ quyền, không dán lịch sử shell
# cập nhật DATABASE_URL trong kho bí mật + môi trường PM2, rồi:
pm2 restart x-company --update-env
psql "$DATABASE_URL" -c 'select 1'     # xác nhận kết nối bằng mật khẩu mới
```
Role migration: làm tương tự, cập nhật `MIGRATE_DATABASE_URL` trong kho bí mật (không để trên máy chạy ứng dụng).

## 3. Lộ bí mật (SEC-SECRET-011)
Nguyên tắc: **thu hồi trước, điều tra sau**; xoá commit không đủ (gitleaks quét cả lịch sử; coi bí mật đã lộ là đã bị dùng). Mỗi vụ lộ = sự cố bảo mật SEV1 ([INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md), nhánh bảo mật) và có post-mortem.

| Loại | Thu hồi / xoay ngay | Rà log khoảng lộ |
|---|---|---|
| `SESSION_SECRET` | mục 2 (xoay + `delete from session`) | log truy cập; `audit_event` hành động ghi trong khoảng lộ |
| `QR_SIGNING_KEYS` | mục 2 (bỏ kid lộ ngay) | `attendance_event` có `qr_nonce` trong khoảng lộ: `source='qr'` bất thường, `needs_review` |
| Mật khẩu role ứng dụng | `alter role … password` (mục 2) + restart | log kết nối PostgreSQL (`log_connections`) và `pg_stat_activity` nếu bật |
| Mật khẩu role migration | `alter role … password`; kiểm không có migration lạ: `select * from schema_migrations` | tệp migration đã áp có checksum khớp repo |
| Token GitHub (PAT, token Actions, `GITLEAKS_LICENSE`) | thu hồi ở GitHub Settings → Developer settings / Secrets → tạo lại | GitHub audit log, lịch sử workflow |
| Khoá/SMTP/VAPID/S3 (khi có — D-005) | thu hồi ở nhà cung cấp, cấp khoá mới, cập nhật kho bí mật | log của nhà cung cấp |
| Mật khẩu một người dùng | `update app_user set disabled_at = now(), auth_version = auth_version + 1 …` + `delete from session where user_id = …`, buộc đặt lại mật khẩu | `login_attempt`, `session` của user |
| Bản sao lưu/máy lộ | xoay mọi bí mật trên máy đó; coi dữ liệu trong sao lưu là đã lộ → [data-breach.md](runbooks/data-breach.md) | — |

Sau khi xoay: chạy `gitleaks` cục bộ nếu có, ghi incident (timeline có mốc "đã thu hồi" trước mốc "tìm nguyên nhân"), rà `.github/workflows` xem có bước in biến môi trường.

## 4. Cảnh báo → playbook
Chưa có hệ thống cảnh báo (dự kiến T-038). Khi có, mỗi cảnh báo trong cấu hình phải có dòng ở đây (BASE-DOC-004).

| Cảnh báo | Mức | Nghĩa là gì | Bước xử lý |
|---|---|---|---|
| (chưa có) `web_down` | SEV1/2 | web không trả 200 | `pm2 status`, `pm2 logs`, rollback mục 1 |
| (chưa có) `outbox_backlog` | SEV3 | `outbox_event` chưa xử lý tồn đọng (worker T-029) | kiểm worker, `attempts`, `last_error` |
| (chưa có) `audit_chain_broken` | SEV1 | `npm run audit:verify` exit 1 | nhánh sự cố bảo mật; bảo toàn chứng cứ trước khi sửa |

## 5. Việc định kỳ
| Việc | Nhịp | Lệnh/nơi | Chủ |
|---|---|---|---|
| Diễn tập khôi phục DB và tệp | quý (đầu tiên: trước pilot) | [restore-db.md](runbooks/restore-db.md) | `<chủ dự án điền>` |
| Vá phụ thuộc / quét lỗ hổng | tuần | Dependabot PR + `dep-audit` (xem [VULN-SLA.md](VULN-SLA.md)) | seeker19110 |
| Kiểm chuỗi audit | tuần | `npm run audit:verify` | `<chủ dự án điền>` |
| Xoay bí mật | `<chủ dự án điền>` (đề xuất 90 ngày hoặc khi có người rời dự án) | mục 2 | seeker19110 |
| Gia hạn domain/chứng chỉ/license | xem [../handover/renewals.md](../handover/renewals.md) | | |
| Gia hạn `public/.well-known/security.txt` | trước `Expires` (hiện 2027-04-18) | sửa tệp + PR | seeker19110 |
| Diễn tập tabletop rò rỉ dữ liệu | năm | [runbooks/data-breach.md](runbooks/data-breach.md) | `<chủ dự án điền>` |

## 6. Nhật ký diễn tập
| Ngày | Bài | Người thực hiện (≠ tác giả) | Kết quả / thời gian | Việc phát sinh |
|---|---|---|---|---|
| (chưa có) | | | | |
