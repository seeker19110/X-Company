# Mã hoá dữ liệu lúc lưu (T-048)

> Nhãn bằng chứng: **faithful-fixture** — kiểm trên Postgres tạm + hệ tệp cục bộ. Mặc định (`KMS_PROVIDER=env`) khoá ở biến môi trường; từ T-052 có `KMS_PROVIDER=transit` (OpenBao Transit TỰ HOST, chạy THẬT cục bộ — mục 8). KHÔNG phải HSM phần cứng, không phải production. Chủ dự án chọn "hạ tầng production: làm local": phần mật mã ứng dụng làm đầy đủ; phần cần hạ tầng thật ghi ở mục 7.
> Mã: `lib/crypto/` (chỉ `node:crypto`, không phụ thuộc npm mới). Test: `tests/db/encryption.test.ts`, `tests/unit/env.test.ts`.

## 1. Phạm vi — cột/tệp nào được mã hoá và vì sao

Chọn theo `docs/privacy/data-map.yaml`: lớp `nhay_cam` (GPS, lý do nghỉ) và định danh liên lạc trực tiếp (SĐT). Không có cột CCCD/ngày sinh/địa chỉ nhà trong schema hiện tại (đã rà migrations 0001–0024) nên không có gì để mã hoá ở đó.

| Cột bản rõ (cũ) | Cột bản mã mới | Chỉ mục mù | Lý do |
|---|---|---|---|
| `employee.phone` | `employee.phone_enc` | `phone_bidx` | SĐT nhân viên; không dùng làm khoá/JOIN/ORDER BY; tìm khớp qua chỉ mục mù |
| `inquiry.phone` | `inquiry.phone_enc` | `phone_bidx` | SĐT khách; CHECK "email hoặc SĐT" đã mở rộng sang `phone_enc` |
| `job_application.phone` | `job_application.phone_enc` | `phone_bidx` | SĐT ứng viên |
| `leave_request.reason` | `leave_request.reason_enc` | — | lý do nghỉ, có thể lộ sức khoẻ (nhạy cảm). Audit không còn chứa lý do (chỉ `hasReason`) |
| `attendance_event.geo_lat/geo_lng/geo_accuracy_m/geo_captured_at` | `attendance_event.geo_enc` (JSON gộp) | — | định vị chính xác (nhạy cảm); chỉ lưu khi qua cổng T-051 |
| Tệp tải lên (`lib/files/storage.ts`) | tệp đĩa dạng phong bì | — | tài liệu/CV có thể chứa PII |

**Không mã hoá (có chủ ý):** `app_user.email`, `login_attempt.email` (khoá đăng nhập/tra cứu), `full_name`/`name` (hiển thị, sắp xếp), `inquiry.message`, `job_application.cover_letter` (văn bản tự do — ứng viên cho lát sau: cần tìm/hiển thị, ghi ở rủi ro còn lại), IP/UA (đã băm hoặc cần điều tra), `audit_event.before/after` (đã che theo tên khoá). Bản sao lưu: đã mã hoá bằng openssl ở T-045 (`scripts/backup.sh`) — không làm lại ở đây.

Sổ đăng ký cột: `lib/crypto/columns.ts` (`ENCRYPTED_COLUMNS`). COMMENT trong DB: `PII: <loại>; class=<PII|SENSITIVE|SECRET>; enc=<yes|no>` cho **42 cột đã triển khai** của data-map (44 khai báo, 2 còn `planned` — `app_user.totp_secret`, `push_subscription.endpoint` — chưa có cột; migration thêm chúng phải kèm COMMENT, test bắt thiếu). `enc=yes` đúng bằng tập cột bản rõ trong sổ đăng ký (test khớp hai chiều với DB thật). Cột bản mã/chỉ mục mang nhãn `ENC:`/`BIDX:`.

## 2. Thiết kế

- **Trường:** AES-256-GCM, IV ngẫu nhiên 12 byte mỗi lần, thẻ 16 byte, **AAD = `xc/v1|<bảng>.<cột bản mã>|<id dòng>`** → bản mã tráo sang dòng/cột/bảng khác giải mã lỗi (`AUTH_FAILED`).
- **Phong bì có phiên bản:** `v1:<keyId>:<iv>:<tag>:<ct>` (base64url). `keyId` cho biết khoá nào đã mã hoá → xoay khoá không cần đoán.
- **Khoá:** `DATA_ENCRYPTION_KEYS="id:khoá32byte-base64,id:…"` — khoá ĐẦU mã hoá, các khoá sau chỉ giải mã. Khoá nằm ngoài CSDL (env/kho bí mật). `DATA_INDEX_KEY` (32 byte base64) riêng cho chỉ mục mù. Cả hai là bí mật (`lib/nen/env.ts`: che `***`, test không lộ).
- **Fail-closed:** `NODE_ENV=production` thiếu một trong hai → `EnvError` nêu TÊN biến, `startup` thoát 78. Dev/test: khoá thử dẫn xuất lúc chạy từ nhãn cố định (không có literal khoá trong mã; không trùng khoá thật).
- **Chỉ mục mù:** `HMAC-SHA256(DATA_INDEX_KEY, "bảng.cột" + giá trị chuẩn hoá NFC + trim + chữ thường)` (SĐT: bỏ khoảng trắng/dấu `.-()` trước). Gắn ngữ cảnh cột nên cùng SĐT ở hai bảng cho hai chỉ mục khác nhau (không nối chéo bảng). Chỉ cho phép so khớp **bằng**, không tìm gần đúng.
- **Tệp:** phong bì khoá — mỗi tệp một khoá dữ liệu 32 byte ngẫu nhiên, bọc bằng khoá chủ hiện hành (AAD gắn khoá lưu), nội dung AES-256-GCM theo khối 64 KiB, khối cuối có cờ (phát hiện cắt cụt/đảo khối/dữ liệu thừa). Tệp cũ (không có đầu `XCFILE`) là bản rõ và vẫn đọc được; tệp mới luôn mã hoá. Hạn chế: kẻ có quyền ghi đĩa có thể thay một tệp mã hoá bằng tệp bản rõ (nhận ra được bằng `file_object.sha256`, chưa kiểm ở đường phục vụ — việc sau).

## 3. Mô hình chuyển tiếp expand → backfill → contract

1. **Expand (migration 0025, đã làm):** cột `*_enc`, `*_bidx` cho phép NULL. Mã mới **ghi mã hoá** (cột bản rõ NULL) và **đọc ưu tiên cột mã hoá**, rơi về bản rõ cho dòng cũ. `attendance_event` là bằng chứng gốc: guard được thay bằng ngoại lệ hẹp (chỉ chuyển bản rõ → bản mã hoặc mã hoá lại; không xoá bản mã).
2. **Backfill:** `npm run -s crypto:backfill` mã hoá dòng/tệp cũ — idempotent, theo lô, in số dòng (`còn bản rõ chưa mã hoá` phải 0). `-- --scrub` xoá bản rõ SAU KHI giải mã thử khớp (lệch → dừng, không xoá).
3. **Contract (CHƯA làm — việc sau):** migration riêng `-- contract:` bỏ cột bản rõ khi không còn bản nào đọc và đã `--scrub`. Tới lúc đó mã cũ vẫn chạy trên schema mới (đường lùi).

## 4. Xoay khoá từng bước

1. `openssl rand -base64 32` → khoá mới. Đặt `DATA_ENCRYPTION_KEYS="d2:<mới>,d1:<cũ>"`, restart (ứng dụng ghi bằng d2, vẫn đọc d1 — **không dừng hệ thống**).
2. `npm run -s crypto:rotate`: cột PII (đọc bằng khoá cũ → ghi bằng khoá mới, so-sánh-rồi-đặt từng dòng, theo lô) + bọc lại khoá tệp (chỉ đổi đầu tệp). Idempotent, ngắt giữa chừng chạy lại tiếp được. Exit ≠ 0 nếu còn dòng dùng khoá khác khoá hiện hành.
3. Khi báo cáo `còn khoá cũ 0` mới bỏ `d1` khỏi cấu hình. Kiểm lại bằng `crypto:rotate` (không `KEY_UNKNOWN`).
4. Đổi `DATA_INDEX_KEY`: phải `crypto:backfill -- --reindex` (tính lại mọi chỉ mục); trong lúc chạy, tìm theo chỉ mục có thể hụt.

## 5. Mất khoá = mất dữ liệu (CẢNH BÁO)

Không có cửa sau. Mất mọi khoá còn dùng được cho một `keyId` ⇒ các cột/tệp mã hoá bằng khoá đó **không khôi phục được**, kể cả từ sao lưu CSDL. Bắt buộc: lưu khoá ở kho bí mật có sao lưu riêng, **tách khỏi** sao lưu CSDL và khỏi máy chạy ứng dụng; ghi danh sách `keyId` đang còn dòng dùng. Ngược lại, huỷ khoá có chủ đích = xoá mật mã (crypto-shredding) dữ liệu đã mã hoá bằng khoá đó.

## 6. Kiểm chứng (đã chạy, faithful-fixture)

`tests/db/encryption.test.ts` (Postgres thật): ghi → cột bản rõ NULL, `SELECT` cột enc không thấy bản rõ; giải mã đúng (Unicode/rỗng/10 KB); sai AAD/tráo dòng/cột/bảng → lỗi; xoay khoá giữ đọc được, idempotent, bỏ khoá cũ vẫn đọc; backfill idempotent + kiểm số dòng + scrub chỉ khi khớp; chỉ mục mù khớp NFC/hoa-thường/định dạng SĐT; `pg_dump` không chứa SĐT/toạ độ mẫu; COMMENT khớp hai chiều data-map ↔ DB; tệp: round-trip nhiều cỡ, tệp cũ đọc được, tráo/sửa/cắt cụt bị phát hiện, thiếu khoá → lỗi rõ, xoay khoá tệp.

## 8. KMS tự host — provider `transit` (T-052, D-039)
- **Chọn nhà cung cấp**: `KMS_PROVIDER=env` (mặc định, hành vi trên) | `transit`. Mã: `lib/crypto/kms.ts` (logic, không mạng) + `adapters/kms-transit-http.ts` (`fetch`, vì lib/ không có client mạng — DB-TX-003) + `adapters/register-kms.ts` (gọi ở `instrumentation.ts` và script). Test: `tests/db/kms-transit.test.ts` (máy chủ giả + OpenBao thật).
- **Phong bì v2**: `v2:<phiên bản khoá chủ>:<DEK đã bọc base64url>:<iv>:<tag>:<ct>`. DEK 32 byte sinh cục bộ, bọc bằng `transit/encrypt/<khoá>`; khoá chủ (KEK) KHÔNG BAO GIỜ rời KMS. Cùng AAD với v1. Phong bì tự chứa → không có trạng thái cục bộ, nhiều bản sao ứng dụng đọc chung. Tệp: đầu tệp v2 chứa chuỗi bọc (mỗi tệp một DEK riêng vì IV khối là bộ đếm).
- **DEK**: dùng chung cho nhiều bản ghi tới hết `KMS_DEK_TTL_S` hoặc `KMS_DEK_MAX_USES`; giải bọc được cache (TTL ngắn, gộp lời gọi đồng thời); trần `KMS_MAX_CALLS_PER_MIN`; làm mới sớm ở nền (80% TTL).
- **Fail-closed**: KMS dừng/niêm phong → `KMS_UNAVAILABLE`; token sai → `KMS_AUTH`; vượt trần → `KMS_RATE_LIMITED`; cấu hình sai → `KMS_CONFIG` (production + transit + http không loopback bị từ chối; startup thoát 78). KHÔNG BAO GIỜ rơi về khoá env. Có timeout (`KMS_TIMEOUT_MS`) và thử lại có trần (`KMS_RETRIES`, lùi cấp số nhân; 4xx không thử lại). Trong TTL, DEK đã cache vẫn dùng được khi KMS vừa dừng (cửa sổ có chủ đích, giới hạn bằng TTL).
- **Xoay khoá**: `npm run -s crypto:rotate -- --kms-rotate` (token vận hành): `transit/keys/<khoá>/rotate` tạo phiên bản mới, `transit/rewrap` đổi DEK cũ sang phiên bản mới — KHÔNG đọc dữ liệu rõ, bản mã dữ liệu giữ nguyên, mỗi DEK một lời gọi dù bao nhiêu dòng chung nó. Phong bì v1 cũ được mã hoá lại bằng KMS (đường chuyển env → KMS). Diễn tập + thời lượng: `npm run -s kms:drill` → [rotation-log.md](rotation-log.md).
- **Policy**: ứng dụng chỉ encrypt/decrypt/rewrap + đọc siêu dữ liệu khoá; không rotate/xoá/xuất. Audit device của OpenBao không chứa bản rõ/DEK (test).
- **Cột `key_id` (DB-SEC-009)**: key id nằm trong phong bì (v1: id khoá env; v2: phiên bản khoá chủ), `envelopeKeyId()` đọc không cần giải mã. Cột `*_key_id` riêng CHƯA thêm — đề xuất cột sinh `GENERATED ALWAYS AS (…) STORED` (không đổi mã ghi) cần sửa guard `attendance_event`; chờ phiên chính duyệt.
- **Chưa chứng minh**: HSM phần cứng/auto-unseal PKCS#11/cloud KMS ([../ops/kms-deploy.md](../ops/kms-deploy.md) mục 5); `DATA_INDEX_KEY` còn ở env; diễn tập xoay trên staging/hạ tầng thật; KMS nhiều nút/HA; token ứng dụng dùng AppRole/TTL ngắn thay token tĩnh.

## 7. Việc cần NGƯỜI / hạ tầng thật (chưa chứng minh)

- **HSM** giữ khoá chủ (SEC-SECRET-013, DB-SEC-009): đã có KMS phần mềm tự host (mục 8, `KMS_PROVIDER=transit`) nhưng khoá chủ của OpenBao vẫn bảo vệ bằng khoá chia Shamir, không phải HSM; mặc định `env` thì khoá ở biến môi trường.
- **Tách quyền khoá khỏi DB:** quản trị DB không được đọc khoá; kho bí mật tập trung có audit đọc (SEC-SECRET-005/012).
- **Mã hoá đĩa/volume** của máy chủ Postgres và kho tệp (lớp bổ sung, không thay lớp ứng dụng).
- Diễn tập xoay khoá trên staging ghi thời gian vào `docs/security/rotation-log.md` (SEC-SECRET-008); khôi phục sao lưu từ tài khoản DR (OPS-DR-004).
- Quyết định bước contract (bỏ cột bản rõ) và chạy `--scrub` trên dữ liệu thật.
- Pháp chế xác nhận phân loại cột; bật GPS chỉ sau DPIA (`docs/DPIA.md`).
