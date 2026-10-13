# Gợi ý nâng cấp — rà soát 2026-10-13

> Lấy từ đợt rà soát chéo 19 repo của chủ sở hữu (ma trận vệ sinh ở [seeker19110/stored, mục 23 §8.1](https://github.com/seeker19110/stored/blob/main/23-own-repos-lessons/README.md); gợi ý tích hợp ở §7b của cùng file). Số liệu đo bằng lệnh trên HEAD (đếm `uses:` ghim SHA 40 ký tự, khối `permissions:`, `dependabot.yml`, `.claude/settings.json`), không suy ra từ văn xuôi. Đây là **đề xuất**, chưa sửa code. Mỗi mục kèm bằng chứng để kiểm lại trước khi làm; mục nào đã xử lý thì đánh dấu hoặc xoá.

## Hiện trạng đo được

| HEAD đọc | Action ghim SHA | Workflow thiếu `permissions:` cấp đầu | Dependabot | LICENSE · SECURITY | File test |
|---|---|---|---|---|---|
| `09c3c3c` (2026-09-06) | 0/20 | `ci.yml`, `codeql.yml`, `lighthouse-ci.yml` | npm | có · có | 1 |

## Đề xuất (🔴 cao · 🟠 trung bình · 🟢 nhẹ)

| # | Mức | Đề xuất | Bằng chứng | Kiểm xong khi |
|---|---|---|---|---|
| 1 | 🟠 | Quyết định vai trò: hoặc **archive** (khung đã chuyển sang projects-template), hoặc đồng bộ lại như Xgold | HEAD `09c3c3c` ngày 6/9 có commit message trùng với Xgold; chỉ có 1 file test; còn `"model": "opusplan"`; ghim 0/20 action | Repo được archive, hoặc đạt chuẩn như Xgold |
| 2 | 🟢 | Nếu giữ lại: ghim 20 action theo SHA, thêm `permissions:` cấp đầu cho `ci.yml`, `codeql.yml`, `lighthouse-ci.yml`, thêm Dependabot `github-actions` | Đo như trên | Grep `uses:` không ghim trả về 0 |

## Giữ nguyên (điểm mạnh)

- `docs/specs/AI-HARNESS-AND-COMPANY-SPEC.md` (khoảng 2.700 dòng) là tài liệu gốc có giá trị; nếu archive thì giữ nguyên để tra cứu.

## Gợi ý tích hợp từ catalog `stored`

- Đối chiếu spec C1–C7 / G0–G8 với cổng RoE hai lớp của Decepticon (parser advisory + egress nftables / DNS) và OWASP Agentic Top 10 (stored mục 12 §1, §3g).

## Ghi chú chung

- Ghim action theo SHA bằng [pinact](https://github.com/suzuki-shunsuke/pinact) hoặc [ratchet](https://github.com/sethvargo/ratchet), giữ comment tag (`# v7.0.1`), rồi để Dependabot `github-actions` tự nâng SHA. Đây là cách projects-template, xboss và Sales-Hunter đang làm.
- Chuẩn tham chiếu là `seeker19110/projects-template`: 25/25 action ghim SHA, mọi workflow có `permissions:` cấp đầu, Dependabot cho npm, github-actions và pip.
