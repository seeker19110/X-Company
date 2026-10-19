---
title: Công cụ vận hành tải về (ghim phiên bản + sha256)
updated: 2026-10-19
status: faithful-fixture — công cụ chạy cục bộ để thử; không phải triển khai production
---

# Công cụ vận hành (`.tools/`)

Nhị phân tải về bằng `node scripts/tools/install-tool.mjs install <tên…>` (hoặc `npm run -s tools:install -- <tên…>`): bảng phiên bản + sha256 GHIM trong script, sha256 kiểm TRƯỚC khi giải nén/chạy (sai → xoá bản tải, exit 1), không `curl | sh`, không phụ thuộc npm. Cài vào `.tools/<tên>/<phiên bản>/` và liên kết `.tools/bin/<bin>` (`.tools/` đã `.gitignore`). `node scripts/tools/install-tool.mjs check-pins` tải tệp checksum CHÍNH THỨC của bản phát hành và so với bảng ghim.

| Công cụ | Phiên bản | Giấy phép | Dùng cho | sha256 (linux-x64) | Nguồn checksum chính thức |
|---|---|---|---|---|---|
| OpenBao | 2.7.1 (phát hành 2026-10-01) | MPL-2.0 (OSI) | KMS Transit tự host (`scripts/kms-dev.sh`) — D-039 | `0e2f1ce10d124e03112b50dd2fbec6b78003783253bc3a91587938f39d1e2243` (`openbao_2.7.1_linux_amd64.tar.gz`) | https://github.com/openbao/openbao/releases/download/v2.7.1/checksums.txt (đã kiểm chữ ký GPG `checksums.txt.gpgsig`, khoá https://openbao.org/assets/openbao-gpg-pub-20240618.asc — "Good signature", vân tay `66D1 5FDD 8728 7219 C8E1 5478 D200 CD70 2853 E6D0`) |
| restic | 0.19.1 (phát hành 2026-07-05) | BSD-2-Clause (OSI) | sao lưu off-site (`scripts/backup-offsite.sh`) — D-040 | `f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c` (`restic_0.19.1_linux_amd64.bz2`) | https://github.com/restic/restic/releases/download/v0.19.1/SHA256SUMS |

Nghiên cứu phiên bản (ngày 2026-10-19, nguồn sống): OpenBao CHANGELOG https://raw.githubusercontent.com/openbao/openbao/main/CHANGELOG.md (dòng đầu: 2.7.1, 2026-10-01; 2.6.4 cùng ngày là nhánh bảo trì cũ hơn) · restic CHANGELOG https://raw.githubusercontent.com/restic/restic/master/CHANGELOG.md (0.19.1, 2026-07-05). GitHub API bị chặn trong môi trường này nên không dùng `releases/latest`; phiên bản lấy từ CHANGELOG và tải thử bản phát hành (chưa xác minh bằng trang releases). Chưa kiểm chữ ký của restic (`SHA256SUMS.asc`) vì chưa có khoá công khai đã xác thực; chỉ khớp sha256 với tệp cùng bản phát hành.

Lưu ý bản 2.7.1: backend lưu trữ `file` đã bị gỡ (dùng `raft`/`pebbledb`); audit device phải khai báo trong cấu hình (không bật qua API) — `scripts/kms-dev.sh` đã theo hai điều này.

Hai công cụ là công cụ vận hành/thử nghiệm, KHÔNG nằm trong sản phẩm phát hành (không vào `THIRD_PARTY_NOTICES.md`, vốn sinh từ `package-lock.json`); giấy phép MPL-2.0 (OpenBao) và BSD-2-Clause (restic) ghi ở đây. Nâng phiên bản = sửa bảng `TOOLS` trong `scripts/tools/install-tool.mjs` (url + sha256 từ tệp checksum chính thức) rồi chạy `check-pins`.
