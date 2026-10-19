---
title: Triển khai KMS (OpenBao Transit) — cấu hình production mẫu
updated: 2026-10-19
status: MẪU — chưa chạy trên production; phần cục bộ đã chạy thật (faithful-fixture), phần HSM/cloud KMS CHƯA làm và CHƯA chứng minh
---

# KMS tự host: OpenBao Transit

> Phạm vi đã chứng minh (cục bộ): `scripts/kms-dev.sh` dựng OpenBao 2.7.1 THẬT (raft + TLS tự ký + audit file + policy tối thiểu), `tests/db/kms-transit.test.ts` kiểm ghi/đọc, xoay khoá + rewrap, fail-closed khi KMS dừng, token sai, cache DEK. Mọi thứ dưới đây ngoài `kms-dev.sh` là **cấu hình mẫu chưa chạy** (không có docker/hạ tầng thật ở đây). **HSM phần cứng: không có, chưa làm, chưa chứng minh.**

## 1. Ứng dụng
```bash
KMS_PROVIDER=transit
KMS_TRANSIT_ADDR=https://kms.noi-bo.example:8200   # https bắt buộc ở production (trừ loopback)
KMS_TRANSIT_TOKEN=<token policy xc-app, từ kho bí mật, KHÔNG commit>
KMS_TRANSIT_KEY=xc-data  KMS_TRANSIT_MOUNT=transit
NODE_EXTRA_CA_CERTS=/etc/xc/kms-ca.pem             # chỉ khi CA nội bộ/tự ký; không có tuỳ chọn tắt kiểm chứng chứng chỉ
DATA_INDEX_KEY=<khoá chỉ mục mù — vẫn ở env, xem mục 6>
```
`DATA_ENCRYPTION_KEYS` không còn bắt buộc ở production (chỉ cần khi còn dữ liệu v1 cũ phải đọc/chuyển).

## 2. Máy chủ OpenBao (mẫu `config.hcl`)
```hcl
storage "raft" {            # 2.7.1 đã gỡ backend `file`; một nút raft là lưu trữ đĩa tối thiểu, ≥ 3 nút cho sẵn sàng cao
  path    = "/var/lib/openbao"
  node_id = "kms-1"
}
listener "tcp" {
  address         = "0.0.0.0:8200"
  cluster_address = "0.0.0.0:8201"
  tls_cert_file   = "/etc/openbao/tls/server.pem"
  tls_key_file    = "/etc/openbao/tls/server.key"
  tls_min_version = "tls12"
}
api_addr = "https://kms.noi-bo.example:8200"
cluster_addr = "https://kms.noi-bo.example:8201"
ui = false
audit "file" "file" {       # audit device khai báo trong cấu hình (không bật qua API từ 2.5)
  options { file_path = "/var/log/openbao/audit.log" }
}
```
Chạy bằng người dùng riêng không phải root, `mlock` bật (bỏ `disable_mlock`), đĩa dữ liệu mã hoá, cổng 8200 chỉ mở cho máy ứng dụng (tường lửa), audit log đẩy sang kho ghi-chỉ-thêm.

## 3. Khởi tạo, khoá chia, mở niêm phong
`bao operator init -key-shares=5 -key-threshold=3` — mỗi phần khoá một người giữ riêng (không lưu trên máy chủ), root token dùng một lần rồi `bao token revoke`. Thủ tục unseal/mất khoá: [RUNBOOK.md](RUNBOOK.md) mục "Vận hành KMS".

## 4. Transit + policy tối thiểu
```bash
bao secrets enable transit
bao write -f transit/keys/xc-data type=aes256-gcm96      # không exportable, không allow_plaintext_backup
bao policy write xc-app - <<'P'
path "transit/encrypt/xc-data" { capabilities = ["update"] }
path "transit/decrypt/xc-data" { capabilities = ["update"] }
path "transit/rewrap/xc-data"  { capabilities = ["update"] }
path "transit/keys/xc-data"    { capabilities = ["read"] }   # chỉ để biết latest_version khi xoay
P
bao policy write xc-ops - <<'P'                          # chỉ người vận hành/CI xoay khoá; KHÔNG đưa vào ứng dụng
path "transit/keys/xc-data/rotate" { capabilities = ["update"] }
# + các đường dẫn của xc-app để chạy crypto:rotate
P
bao token create -policy=xc-app -no-default-policy -ttl=720h   # hoặc AppRole/auth phương pháp có TTL ngắn thay token tĩnh
```
Ứng dụng KHÔNG có quyền rotate/xoá/xuất/cấu hình khoá (test: `client.rotate()` bằng token ứng dụng → `KMS_AUTH`). `min_decryption_version` chỉ được nâng sau khi `crypto:rotate` báo `stale = 0`.

## 5. Tự động mở niêm phong (auto-unseal) — CHƯA LÀM, CHƯA CHỨNG MINH
Hiện mở niêm phong bằng người (Shamir). Khi có công ty/ngân sách: `seal "pkcs11" { lib = "…" key_label = "…" }` với HSM thật (hoặc HSM đám mây), hoặc `seal "awskms"|"gcpckms"|"azurekeyvault"` với KMS đám mây — khi đó khoá chủ của barrier nằm trong HSM/KMS đám mây. Không có phần cứng/tài khoản ở đây nên KHÔNG thử; không được tuyên bố đạt "khoá trong HSM" (SEC-SECRET-013/DB-SEC-009 còn mở phần này).

## 6. Giới hạn đã biết
- Khoá chỉ mục mù `DATA_INDEX_KEY` (HMAC) vẫn ở biến môi trường; chưa chuyển sang KMS (cần tính chỉ mục đồng bộ — việc sau).
- DEK giải bọc nằm trong bộ nhớ tiến trình tới `KMS_DEK_TTL_S` (mặc định 5 phút); JS không bảo đảm xoá bộ nhớ.
- Lời gọi KMS có thể xảy ra trong giao dịch DB khi hết TTL DEK (giảm bằng làm mới sớm ở 80% TTL); trần thời gian = `KMS_TIMEOUT_MS × (KMS_RETRIES+1)` + lùi.
- Chưa có cột `*_key_id` riêng (key id nằm trong phong bì: `v2:<phiên bản khoá chủ>:…`) — quyết định chờ duyệt, xem báo cáo T-052.
- Một nút KMS = điểm lỗi đơn: KMS dừng thì ghi/đọc dữ liệu mã hoá dừng (có chủ đích, fail-closed). Cần ≥ 3 nút raft và sao lưu snapshot.
