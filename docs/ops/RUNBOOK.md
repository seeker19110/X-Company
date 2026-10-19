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
`SITE_COMPANY_ID` · `FILE_STORAGE_DIR` · `DB_POOL_MAX` · `NEXT_TELEMETRY_DISABLED=1` · `METRICS_TOKEN` (tuỳ chọn, bí mật, ≥ 16 byte; đặt thì `GET /api/metrics` với `Authorization: Bearer …` trả metric Prometheus, không đặt thì 404 — chỉ mở cho Prometheus nội bộ).

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

### DLQ / redrive
Worker (`npm run worker`, một tiến trình dưới pm2/systemd; nhiều bản cùng chạy được — `SKIP LOCKED`) thử tối đa `WORKER_MAX_ATTEMPTS` (mặc định 5) lần với backoff mũ có jitter (10 s → trần 15 phút).
Việc vào DLQ = `outbox_event.status = 'dead'` (giữ nguyên `payload`, `last_error`, `attempts`, `dead_at`) khi: hết lần thử · payload sai schema · không có handler cho topic · lỗi vĩnh viễn. Kênh tắt **không** vào DLQ (giữ `pending`).
Cảnh báo: số hàng `dead` > 0 quá 15 phút (gauge `outbox_dead_total` ở `/api/metrics`; rule mẫu `XCOutboxDeadLetter` ở `ops/prometheus/alerts.yml`, chưa nối Prometheus thật — tạm nhìn tay bằng truy vấn dưới).
```bash
psql "$DATABASE_URL" -c "select id, topic, attempts, dead_at, left(last_error, 120) from outbox_event where status = 'dead' order by dead_at"
# Sửa nguyên nhân (mã/cấu hình/payload) TRƯỚC, rồi redrive: đưa về pending, attempts = 0. Xử lý lại vẫn được khử trùng bằng processed_message.
psql "$DATABASE_URL" -c "update outbox_event set status='pending', attempts=0, dead_at=NULL, next_attempt_at=now() where status='dead' and id in (<id>,<id>)"
```
Dead lâu hơn `RETENTION_OUTBOX_DONE_DAYS` vẫn **không** bị retention xoá (chỉ `done` bị xoá) — dọn tay sau khi điều tra: `delete from outbox_event where status='dead' and id = <id>`.

### Lưu giữ dữ liệu
Thời hạn là cấu hình (`.env`; mặc định thận trọng theo D-016 — số chính thức do HR/pháp chế chốt ở F02): `RETENTION_INQUIRY_DAYS` 730 · `RETENTION_APPLICATION_DAYS` 365 · `RETENTION_SESSION_DAYS` 30 (tính từ hết hạn tuyệt đối) · `RETENTION_LOGIN_ATTEMPT_DAYS` 90 · `RETENTION_OUTBOX_DONE_DAYS` 30 · `RETENTION_IDEMPOTENCY_HOURS` 24 · `RETENTION_RUM_DAYS` 30 (mẫu `rum_sample`; job cũng xoá `public_rate_event` quá 1 ngày — bảng đếm tần suất biểu mẫu/RUM, không còn tăng mãi).
Liên hệ/ứng viên quá hạn được **ẩn danh** (tên, email, SĐT, nội dung, thư xin việc, `ip_hash`; giữ mã, trạng thái, thời điểm để thống kê; đặt `anonymized_at`) và ghi audit `retention.anonymize` (chỉ số đếm). Session hết hạn, `login_attempt`, outbox `done` cũ, `idempotency_record` cũ, `rum_sample` quá hạn và `public_rate_event` quá 1 ngày bị **xoá** (audit `retention.purge`, chỉ số đếm).
Chạy theo lịch hằng ngày (đề xuất 03:00 UTC): `0 3 * * * cd /srv/x-company && npm run -s retention:run` (cron/systemd timer; chủ dự án điền). Tắt khẩn cấp: `RETENTION_ENABLED=false` (đường lùi D-016) — lệnh thoát 0 và không đụng dữ liệu; ẩn danh không hoàn tác được (khôi phục từ sao lưu).
Chưa phủ: dữ liệu định vị/ảnh chấm công, tệp đính kèm hồ sơ ứng viên, log/sao lưu (chờ DPIA và pháp chế — kế hoạch §12).

### Sao lưu và khôi phục thử cục bộ
Nhãn bằng chứng: **faithful-fixture** — chạy thật trên máy phát triển với PostgreSQL thật, KHÔNG phải production; chưa có sao lưu ngoài máy, khoá KMS, diễn tập trên production (xem [RPO-RTO.md](RPO-RTO.md) mục "Chưa chứng minh").
```bash
# Sao lưu (pg_dump -Fc + sha256 + manifest JSON). Biến: DATABASE_URL (bắt buộc), BACKUP_DIR (mặc định .data/backups),
# BACKUP_KEEP (mặc định 7 bản gần nhất), BACKUP_PASSPHRASE (≥ 16 ký tự → mã hoá AES-256), BACKUP_REQUIRE_ENCRYPTION=1 (thiếu khoá thì từ chối chạy).
npm run -s backup
# Diễn tập khôi phục vào CSDL tạm rồi đối chiếu (số dòng mọi bảng, đầu chuỗi audit, phiên bản migration, `audit:verify`);
# in JSON gồm rto_seconds (đo thật) và rpo_seconds (tuổi bản sao lưu). --compare-live: nêu bảng nào DB đang chạy lệch so với bản sao lưu.
npm run -s backup:drill -- --compare-live --report /tmp/drill.json
# exit 0 khớp · 1 lệch dữ liệu/chuỗi audit/vượt DRILL_RPO_SECONDS|DRILL_RTO_SECONDS · 2 cấu hình/khoá sai · 3 bản sao lưu hỏng (checksum)
```
Lịch: chạy `npm run -s backup` hằng ngày (cron/systemd timer — chưa cấu hình trên máy chủ thật; `<chủ dự án điền>`), ví dụ `15 2 * * * cd /srv/x-company && npm run -s backup && npm run -s backup:drill`. Cảnh báo `XCLocalBackupStale` bắn khi bản sao lưu hoàn chỉnh mới nhất cũ hơn 25 giờ.
Khôi phục thật (không phải diễn tập): làm theo [runbooks/restore-db.md](runbooks/restore-db.md) mục A với tệp từ `BACKUP_DIR` (giải mã trước nếu là `.dump.enc`: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in <tệp>.dump.enc -out <tệp>.dump`; khoá nằm trong biến môi trường, KHÔNG dán lên dòng lệnh).
Mất khoá `BACKUP_PASSPHRASE` = mất mọi bản mã hoá đã tạo; hiện khoá chưa có bản sao/escrow ngoài máy (OPS-DR-004 còn mở).

### Sao lưu off-site (restic)
Nhãn bằng chứng: **faithful-fixture** — restic 0.19.1 THẬT (ghim sha256, `node scripts/tools/install-tool.mjs install restic`), kho ở thư mục khác trên CÙNG máy dev. Công cụ: [tools.md](tools.md). Quyết định: D-040.
```bash
export RESTIC_REPOSITORY=/mnt/o-khac/xc-kho        # hoặc sftp:user@host:/duong/dan · s3:https://host/bucket · rest:https://host/repo
export RESTIC_PASSWORD_FILE=/etc/xc/restic.pw      # mật khẩu kho do NGƯỜI giữ riêng (không phải máy chủ); hoặc RESTIC_PASSWORD / RESTIC_PASSWORD_COMMAND
npm run -s backup && npm run -s backup:offsite     # restic backup → restic check (+ --read-data-subset) → forget --prune → offsite-status.json
npm run -s backup:offsite:drill                    # restic check --read-data → restore → restore-drill.sh trên bản khôi phục → RTO off-site
```
- Chính sách giữ: `BACKUP_OFFSITE_KEEP_LAST|DAILY|WEEKLY|MONTHLY` (mặc định 7/7/4/6). `BACKUP_OFFSITE_CHECK_SUBSET` mặc định `10%` khi đẩy (nhanh), drill luôn đọc toàn bộ dữ liệu.
- Exit `backup-offsite.sh`: 0 xong · 1 lỗi/`restic check` đỏ · 2 cấu hình sai hoặc thiếu mật khẩu (không bao giờ hỏi tương tác). `restore-offsite-drill.sh`: 0 khớp · 1 lệch · 2 cấu hình · 3 kho hỏng/không mở được.
- URL kho KHÔNG được nhúng khoá/mật khẩu (script từ chối, exit 2); khoá S3/SFTP đi qua biến môi trường của nhà cung cấp hoặc ssh-agent. Log chỉ in URL đã che userinfo.
- Bảng 3-2-1 ở `BACKUP_DIR/offsite-status.json` (`three_two_one`): `meets_321` chỉ `true` khi đích là dịch vụ ngoài (sftp/s3/rest) VÀ ≥ 2 bản trên ≥ 2 hệ thống — đích đường dẫn cục bộ luôn `false`.
- Cảnh báo: `XCLocalOffsiteBackupStale` (25 giờ), `XCLocalOffsiteDrillStale` (31 ngày) đọc `offsite-status.json`/`offsite-drill.json` (chỉ ghi khi thành công).
- **Mất mật khẩu kho = mất mọi bản off-site** (restic không có cửa sau). Lưu mật khẩu kho ở nơi tách khỏi máy chủ (người giữ riêng, bản sao giấy/kho bí mật khác); `restic key add` thêm khoá thứ hai cho người thứ hai.
- Khôi phục thật: `restic restore latest --tag xc-db --target <thư mục>` rồi làm theo [runbooks/restore-db.md](runbooks/restore-db.md) với tệp khôi phục.
- Chưa chứng minh: đích thật khác nhà cung cấp/khu vực (3-2-1 thật), lịch tự động trên máy chủ thật (cron/timer `15 3 * * *`), quyền ghi-chỉ-thêm/immutable ở đích (OPS-DR-007: restic `--append-only` qua rest-server hoặc object lock S3), khoá kho do người giữ riêng.

### Vận hành KMS (OpenBao Transit) — khi `KMS_PROVIDER=transit`
Nhãn: **faithful-fixture** (OpenBao 2.7.1 thật cục bộ qua `scripts/kms-dev.sh`; KHÔNG HSM, KHÔNG hạ tầng thật). Cấu hình mẫu production: [kms-deploy.md](kms-deploy.md); thiết kế: [../security/encryption-at-rest.md](../security/encryption-at-rest.md).
- **Mở niêm phong (unseal)**: sau mỗi lần khởi động/khởi động lại, OpenBao ở trạng thái niêm phong → ứng dụng ghi/đọc dữ liệu mã hoá đều lỗi `KMS_UNAVAILABLE` (fail-closed, KHÔNG rơi về khoá env). Mở bằng ngưỡng khoá chia (`bao operator unseal` — nhập từng phần, mỗi người một phần; khoá KHÔNG dán lên dòng lệnh dùng chung). Dev: `scripts/kms-dev.sh unseal`.
- **Sao lưu khoá**: (1) các phần khoá unseal + root token ban đầu: chia cho ≥ 3 người giữ riêng, ngưỡng ≥ 2; (2) dữ liệu OpenBao (raft snapshot: `bao operator raft snapshot save` — chứa khoá chủ đã mã hoá bởi barrier, vô dụng nếu thiếu khoá unseal) sao lưu CÙNG cách với CSDL nhưng tách khỏi nơi giữ khoá unseal. Thiếu một trong hai = không khôi phục được.
- **Mất khoá/mất KMS**: dữ liệu mã hoá bằng khoá chủ đó KHÔNG đọc được (kể cả từ sao lưu CSDL). Quy trình: (a) dừng ghi (ứng dụng đã tự lỗi); (b) khôi phục raft snapshot + unseal; (c) nếu không còn snapshot/khoá unseal → dữ liệu cột mã hoá coi như mất (crypto-shredding ngoài ý muốn): khôi phục từ nguồn gốc khác (người dùng nhập lại), ghi sự cố theo [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md). Phong bì v1 (khoá env) cũ không bị ảnh hưởng nếu còn `DATA_ENCRYPTION_KEYS`.
- **Xoay khoá chủ**: `KMS_TRANSIT_TOKEN="$(cat ops.token)" npm run -s crypto:rotate -- --kms-rotate` (token vận hành có quyền rotate; token ứng dụng KHÔNG có). Việc: `rotate` tạo phiên bản mới → `rewrap` mọi DEK cũ (không đọc dữ liệu rõ) → `stale` phải 0 → mới được đặt `min_decryption_version` lên (thu hồi phiên bản cũ). Diễn tập + ghi thời lượng: `npm run -s kms:drill` → [../security/rotation-log.md](../security/rotation-log.md).
- **Token ứng dụng**: policy tối thiểu `xc-app` (encrypt/decrypt/rewrap + đọc siêu dữ liệu khoá). Hết hạn/sai → `KMS_AUTH`: cấp token mới, đặt `KMS_TRANSIT_TOKEN`, khởi động lại.
- **Chuyển env → KMS**: giữ `DATA_ENCRYPTION_KEYS` cũ, đặt `KMS_PROVIDER=transit`, chạy `npm run -s crypto:rotate` (mã hoá lại phong bì v1 bằng KMS, bọc lại khoá tệp) → `stale` 0 → mới bỏ khoá env. Đường lùi: đặt `KMS_PROVIDER=env` CHỈ đọc được dữ liệu v1; dữ liệu v2 cần KMS.

### Khôi phục sao lưu
Xem [runbooks/restore-db.md](runbooks/restore-db.md) và [runbooks/restore-files.md](runbooks/restore-files.md). Diễn tập tự động cục bộ gần nhất: 2026-10-19, xem [restore-drills.md](restore-drills.md) (đo RTO thật trên máy dev); diễn tập do người không phải tác giả trên hạ tầng thật: chưa có.

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

### `DATA_ENCRYPTION_KEYS` / `DATA_INDEX_KEY` — mã hoá dữ liệu lúc lưu (T-048)
Chi tiết, phạm vi và cảnh báo mất khoá: [../security/encryption-at-rest.md](../security/encryption-at-rest.md). **Mất mọi khoá = mất dữ liệu đã mã hoá** — sao lưu khoá riêng, tách khỏi sao lưu CSDL.
1. Sinh khoá: `openssl rand -base64 32`. Thêm khoá MỚI lên ĐẦU: `DATA_ENCRYPTION_KEYS="d2:<khoá-mới>,d1:<khoá-cũ>"` → restart.
2. Chạy `npm run -s crypto:rotate` (cột PII + bọc lại khoá tệp; idempotent, theo lô, chạy lại được). Xong khi mọi dòng `còn khoá cũ 0`, exit 0.
3. Chỉ sau đó mới bỏ khoá cũ khỏi cấu hình → restart. Kiểm: `npm run -s crypto:rotate` vẫn xanh (không `KEY_UNKNOWN`).
4. Nghi lộ khoá: làm bước 1–3 NGAY (không chờ), rồi coi dữ liệu mã hoá bằng khoá lộ trong các bản sao lưu cũ là đã lộ → [data-breach.md](runbooks/data-breach.md). `DATA_INDEX_KEY` đổi → `npm run -s crypto:backfill -- --reindex`.
5. Dữ liệu cũ chưa mã hoá: `npm run -s crypto:backfill` (kiểm số dòng), sau khi đọc kiểm xong mới `-- --scrub` (xoá bản rõ — mất đường lùi "bản trước đọc cột rõ").
6. Lùi bản ứng dụng: schema mới chạy được với bản trước (cột mới cho phép NULL); dòng ghi bởi bản mới có cột bản rõ NULL — không hạ bản khi đã có dữ liệu mới nếu chưa có công cụ giải mã ngược.

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
| `DATA_ENCRYPTION_KEYS` / `DATA_INDEX_KEY` | mục 2 (thêm khoá mới lên đầu + `crypto:rotate`, rồi bỏ khoá lộ) | truy cập kho bí mật; bản sao lưu CSDL tạo trong khoảng lộ coi như lộ dữ liệu mã hoá bằng khoá đó |
| Mật khẩu role ứng dụng | `alter role … password` (mục 2) + restart | log kết nối PostgreSQL (`log_connections`) và `pg_stat_activity` nếu bật |
| Mật khẩu role migration | `alter role … password`; kiểm không có migration lạ: `select * from schema_migrations` | tệp migration đã áp có checksum khớp repo |
| Token GitHub (PAT, token Actions, `GITLEAKS_LICENSE`) | thu hồi ở GitHub Settings → Developer settings / Secrets → tạo lại | GitHub audit log, lịch sử workflow |
| Khoá/SMTP/VAPID/S3 (khi có — D-005) | thu hồi ở nhà cung cấp, cấp khoá mới, cập nhật kho bí mật | log của nhà cung cấp |
| Mật khẩu một người dùng | `update app_user set disabled_at = now(), auth_version = auth_version + 1 …` + `delete from session where user_id = …`, buộc đặt lại mật khẩu | `login_attempt`, `session` của user |
| Bản sao lưu/máy lộ | xoay mọi bí mật trên máy đó; coi dữ liệu trong sao lưu là đã lộ → [data-breach.md](runbooks/data-breach.md) | — |

Sau khi xoay: chạy `gitleaks` cục bộ nếu có, ghi incident (timeline có mốc "đã thu hồi" trước mốc "tìm nguyên nhân"), rà `.github/workflows` xem có bước in biến môi trường.

## 4. Cảnh báo → playbook
Rule mẫu ở `ops/prometheus/alerts.yml` (kiểm cấu trúc bằng `npm run -s check:alerts`); **chưa có Prometheus/Alertmanager thật** nên chưa cảnh báo tự động. Mỗi cảnh báo trong cấu hình phải có dòng ở đây (BASE-DOC-004):

| Rule | Mức | Nghĩa là gì | Bước xử lý |
|---|---|---|---|
| `XCAvailabilityFastBurn` / `XCAvailabilitySlowBurn` | page / ticket | tỷ lệ 5xx đốt ngân sách khả dụng (SLO.md SLI-1) | `pm2 logs`, tìm `trace_id` lỗi 500; nếu vừa deploy thì rollback mục 1 |
| `XCAttendanceLatencyFastBurn` | ticket | ghi chấm công chậm hơn 1 s quá ngân sách (SLI-2) | kiểm DB (`pg_stat_activity`), tải worker, bản deploy gần nhất |
| `XCOutboxDeadLetter` | ticket | `outbox_dead_total > 0` quá 15 phút | mục "DLQ / redrive" |
| `XCRumLcpSlow` / `XCRumInpSlow` / `XCRumClsHigh` | ticket | p75 24 giờ của LCP > 2,5 s / INP > 0,2 s / CLS > 0,1 trên một trang, quá 30 phút (người dùng thật) | mục "RUM / chỉ số web" ngay dưới |

### RUM / chỉ số web
RUM tự làm (T-056, D-042): trình duyệt gửi LCP/INP/CLS/FCP/TTFB về `POST /api/public/rum` (cờ `RUM_ENABLED=true`, mặc định tắt → 404); lưu bảng `rum_sample` theo **nhãn trang đã chuẩn hoá** (không IP/UA/URL đầy đủ), `/api/metrics` xuất `rum_web_vitals_p75{page,metric}` (giây; CLS là điểm) và `rum_web_vitals_samples` — chỉ nhóm có ≥ 5 mẫu trong 24 giờ.
Khi rule bắn: (1) nhãn `page` cho biết trang (`/`, `/app/<phân hệ>`, `/app/*`, `/[...slug]`); (2) xem phân bố: `psql "$DATABASE_URL" -c "select metric, percentile_cont(0.75) within group (order by coalesce(value_ms, cls_milli_n)) p75, count(*) from rum_sample where page = '<trang>' and received_at > now() - interval '24 hours' group by metric"` (CLS lưu ×1000); (3) đối chiếu bản deploy gần nhất, ngân sách JS (`npm run -s check:perf-budget`), Lighthouse CI; LCP cao kèm TTFB cao → nghẽn máy chủ/DB (mục "Chẩn đoán"), LCP cao mà TTFB thấp → tài nguyên trang (ảnh/font/JS). (4) Số ít mẫu hoặc dồn từ một thiết bị yếu không phải hồi quy: đừng rollback chỉ vì một nhóm 5–10 mẫu.
Nhãn `page` là trang **tải vào** tài liệu (lần tải đầy đủ): điều hướng mềm (client) trong khu nội bộ không tạo tài liệu mới, nên INP/CLS của cả phiên làm việc gắn về trang đã tải vào (vd đăng nhập xong chuyển `/app/today` thì số đo thuộc `/app/login`). Đây là xấp xỉ có chủ ý để mỗi tài liệu chỉ gửi một beacon; đọc p75 theo nhãn như "trang vào", không phải từng màn.
Biến môi trường (khai ở `lib/nen/env.ts`; `.env.example` chưa có hai dòng này — việc của người): `RUM_ENABLED=false` (mặc định; `true` mới nhận beacon và nạp `RumBeacon` ở layout khu công khai, layout khu nội bộ và trang đăng nhập) · `RETENTION_RUM_DAYS=30`.
Giới hạn cần biết: số đo RUM là **tham khảo**, không dùng để tự động hành động — một IP bơm 60 beacon/10 phút (giá trị 0 hoặc 120000) đủ làm lệch p75 của trang ít lưu lượng, và `assertSameOrigin` không cản curl. Khi chạy thật BẮT BUỘC đặt `TRUST_PROXY`/`TRUST_PROXY_HOPS`: không đặt thì cả site dùng chung MỘT bucket giới hạn tần suất, một client làm cạn bucket sẽ chặn (429) toàn bộ beacon thật (`curl -i` thấy 429 hàng loạt, `public_rate_event` bucket 'rum' đầy).
Tắt khẩn cấp (đường lùi D-042): `RUM_ENABLED=false` rồi khởi động lại web — beacon không còn được nạp, endpoint 404, metric biến mất, rule hết bắn. Dữ liệu `rum_sample` tự xoá sau `RETENTION_RUM_DAYS` (30) ngày.

### Luật cảnh báo cục bộ (`docs/ops/alerts.json`)
Bộ đánh giá `lib/ops/alerts.ts` chạy trong tiến trình worker khi `ALERTS_ENABLED=true` (chu kỳ `ALERT_INTERVAL_MS`), gửi tới tệp `ALERT_SINK_FILE` (JSON-lines), log sự kiện `ops.alert` và webhook `ALERT_WEBHOOK_URL` (tuỳ chọn); cùng một luật không gửi lặp (nhắc lại sau `ALERT_REPEAT_MS`), có `firing` rồi `resolved`. Thử kích hoạt: `npm run -s alerts:drill` ([alert-drills.md](alert-drills.md)). Đây là **faithful-fixture**: chưa có Prometheus/Alertmanager/kênh trực thật.

| Rule | Mức | Nghĩa là gì | Bước xử lý |
|---|---|---|---|
| `XCLocalAvailabilityFastBurn` / `XCLocalAvailabilitySlowBurn` | page / ticket | tỷ lệ 5xx đốt ngân sách khả dụng | như `XCAvailabilityFastBurn` ở trên |
| `XCLocalAttendanceLatencyBurn` / `XCLocalAttendanceP95Slow` | ticket | ghi chấm công chậm hơn 1 s | như `XCAttendanceLatencyFastBurn` ở trên |
| `XCLocalOutboxDeadLetter` / `XCLocalOutboxStale` | ticket | việc outbox ở DLQ / tới hạn mà không ai lấy > 5 phút | mục "DLQ / redrive"; `XCLocalOutboxStale` thì trước hết kiểm worker còn chạy |
| `XCLocalDsarOverdue` | ticket | có yêu cầu chủ thể dữ liệu quá hạn | mục "DSAR quá hạn" bên dưới |
| `XCLocalReadyzDown` | page | readiness thất bại (DB không phản hồi / đang tắt) | `pm2 status`, `psql "$DATABASE_URL" -c 'select 1'`, `pm2 logs` |
| `XCLocalMetricsScrapeFailed` | ticket | không scrape được `/api/metrics` (web chết hoặc `METRICS_TOKEN` sai) | `curl -H "Authorization: Bearer …" $ALERT_METRICS_URL`; kiểm `pm2 status` |
| `XCLocalBackupStale` | ticket | bản sao lưu mới nhất cũ hơn 25 giờ hoặc chưa từng có | mục "Sao lưu và khôi phục thử cục bộ": chạy `npm run -s backup`, xem log lịch |
| `XCLocalOffsiteBackupStale` | ticket | lần đẩy off-site restic thành công gần nhất cũ hơn 25 giờ hoặc chưa từng | mục "Sao lưu off-site (restic)": chạy `npm run -s backup && npm run -s backup:offsite`, đọc lỗi (kho hỏng → `restic check`) |
| `XCLocalOffsiteDrillStale` | ticket | chưa diễn tập khôi phục từ kho off-site > 31 ngày | `npm run -s backup:offsite:drill` (mục "Sao lưu off-site (restic)") |
| `XCLocalPeriodCloseOverdue` | ticket | có kỳ công kết thúc > 7 ngày chưa khoá | mục "Khoá kỳ công quá hạn" bên dưới |
| `XCLocalAuditChainBroken` | page | chuỗi audit không hợp lệ | mục "Chuỗi audit hỏng" bên dưới |

#### DSAR quá hạn
Liệt kê: `psql "$DATABASE_URL" -c "select id, kind, status, received_at, due_at, respond_due_at, responded_at from data_subject_request where (status in ('received','in_progress') and due_at < now()) or (responded_at is null and respond_due_at < now()) order by due_at"` (quá hạn thực hiện HOẶC quá hạn phản hồi "đã nhận" 2 ngày làm việc — D-029). Xử lý qua API `/api/app/privacy/requests/[id]/[action]` (`respond`, `extend` một lần kèm lý do khi chưa quá hạn, `complete`, `reject`; chưa có màn hình quản trị); không tự sửa `due_at`. Quá hạn pháp lý → báo DPO/chủ dự án và ghi vào timeline sự cố.

#### Khoá kỳ công quá hạn
Liệt kê: `psql "$DATABASE_URL" -c "select code, status, end_date from attendance_period where status <> 'locked' and end_date < current_date - 7 order by end_date"`. Nhắc người phụ trách (HR) đi tiếp luồng open → employee_review → manager_confirmed → hr_closed → locked; chỉ HR được khoá.

#### Chuỗi audit hỏng
`npm run audit:verify` (exit 1 và in id hàng đầu tiên sai). Coi là sự cố bảo mật SEV1: **bảo toàn chứng cứ trước** (sao lưu ngay `npm run -s backup`, giữ nguyên DB), rồi theo [INCIDENT-RESPONSE.md](INCIDENT-RESPONSE.md) nhánh sự cố bảo mật. So với bản sao lưu cũ bằng `npm run -s backup:drill -- --file <manifest>` để biết hàng nào đổi.

Các hàng `(chưa có)` bên dưới là cảnh báo chưa có rule mẫu.

| Cảnh báo | Mức | Nghĩa là gì | Bước xử lý |
|---|---|---|---|
| (chưa có) `web_down` | SEV1/2 | web không trả 200 | `pm2 status`, `pm2 logs`, rollback mục 1 |
| `outbox_backlog` (đã có luật cục bộ `XCLocalOutboxStale`) | SEV3 | `outbox_event` `pending` tồn đọng | kiểm worker còn chạy (`npm run worker`), `attempts`, `last_error`; kênh tắt thì chờ bật kênh |
| `audit_chain_broken` (đã có luật cục bộ `XCLocalAuditChainBroken`) | SEV1 | `npm run audit:verify` exit 1 | nhánh sự cố bảo mật; bảo toàn chứng cứ trước khi sửa |

## 5. Việc định kỳ
| Việc | Nhịp | Lệnh/nơi | Chủ |
|---|---|---|---|
| Diễn tập khôi phục DB và tệp | quý (đầu tiên: trước pilot) | [restore-db.md](runbooks/restore-db.md); tự động: `npm run -s backup:drill` | `<chủ dự án điền>` |
| Sao lưu DB | hằng ngày | `npm run -s backup` (cron — chưa cấu hình trên máy chủ thật) | `<chủ dự án điền>` |
| Thử kích hoạt cảnh báo | sau mỗi lần đổi `docs/ops/alerts.json` | `npm run -s alerts:drill` ([alert-drills.md](alert-drills.md)) | seeker19110 |
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
