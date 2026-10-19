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
| Prometheus + promtool | 3.14.0 (phát hành 2026-08-17) | Apache-2.0 (OSI) | scrape `/api/metrics`, rule, `promtool check/test rules` (`npm run -s ops:stack:drill`) — D-041, T-054 | `f665c6da19eb7ba399c915d30c7d9793c9b417bf8a749b504bc470678631478d` (`prometheus-3.14.0.linux-amd64.tar.gz`) | https://github.com/prometheus/prometheus/releases/download/v3.14.0/sha256sums.txt |
| Alertmanager + amtool | 0.34.1 (phát hành 2026-09-17) | Apache-2.0 (OSI) | định tuyến cảnh báo tới kênh (webhook), `amtool check-config` — D-041, T-054 | `265b9d1e55ef0d5306a436018af6d2b686c2ce051f03d968f7464ecb1372a7e8` (`alertmanager-0.34.1.linux-amd64.tar.gz`) | https://github.com/prometheus/alertmanager/releases/download/v0.34.1/sha256sums.txt |
| Caddy | 2.11.7 (tag 2026-10-03, proxy.golang.org) | Apache-2.0 (OSI) | reverse proxy TLS: staging `tls internal`, mẫu ACME cho tên miền thật (`npm run -s staging:drill`, ops/caddy/Caddyfile) — D-041, T-055 | sha512 `a7a433a1…1ef0e7` (`caddy_2.11.7_linux_amd64.tar.gz`; đủ 128 ký tự trong `install-tool.mjs`) | https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_checksums.txt (Caddy chỉ công bố SHA-512) |
| OWASP ZAP | 2.17.0 | Apache-2.0 (OSI) | quét baseline (spider + passive) qua https của staging, chạy bằng Java ≥ 17, không cần docker (`npm run -s staging:drill`) — T-055 | `efe799aaa3627db683b43f00c9c210aea0b75c00cc8f0a0f0434d12bb3ddde5a` (`ZAP_2.17.0_Linux.tar.gz`, cả thư mục) | https://raw.githubusercontent.com/zaproxy/zap-admin/master/ZapVersions.xml (`<hash>SHA-256:…`; tệp chỉ liệt kê bản hiện hành → `check-pins zap` lệch khi ZAP lên bản mới = tín hiệu nâng) |

Nghiên cứu phiên bản (ngày 2026-10-19, nguồn sống): OpenBao CHANGELOG https://raw.githubusercontent.com/openbao/openbao/main/CHANGELOG.md (dòng đầu: 2.7.1, 2026-10-01; 2.6.4 cùng ngày là nhánh bảo trì cũ hơn) · restic CHANGELOG https://raw.githubusercontent.com/restic/restic/master/CHANGELOG.md (0.19.1, 2026-07-05) · Prometheus CHANGELOG https://raw.githubusercontent.com/prometheus/prometheus/main/CHANGELOG.md (3.14.0, 2026-08-17) và Alertmanager CHANGELOG https://raw.githubusercontent.com/prometheus/alertmanager/main/CHANGELOG.md (0.34.1, 2026-09-17) — tệp VERSION nhánh main khớp; sha256 của Prometheus/Alertmanager khớp tệp `sha256sums.txt` chính thức (`check-pins` 2026-10-19), chưa kiểm chữ ký. GitHub API bị chặn trong môi trường này nên không dùng `releases/latest`; phiên bản lấy từ CHANGELOG và tải thử bản phát hành (chưa xác minh bằng trang releases). Chưa kiểm chữ ký của restic (`SHA256SUMS.asc`) vì chưa có khoá công khai đã xác thực; chỉ khớp sha256 với tệp cùng bản phát hành.

Lưu ý bản 2.7.1: backend lưu trữ `file` đã bị gỡ (dùng `raft`/`pebbledb`); audit device phải khai báo trong cấu hình (không bật qua API) — `scripts/kms-dev.sh` đã theo hai điều này.

Các công cụ là công cụ vận hành/thử nghiệm, KHÔNG nằm trong sản phẩm phát hành (không vào `THIRD_PARTY_NOTICES.md`, vốn sinh từ `package-lock.json`); giấy phép MPL-2.0 (OpenBao) và BSD-2-Clause (restic) ghi ở đây. Nâng phiên bản = sửa bảng `TOOLS` trong `scripts/tools/install-tool.mjs` (url + sha256 từ tệp checksum chính thức) rồi chạy `check-pins`.
