---
title: Quy ước viết module của khung
kind: method
updated: 2026-10-13
---

# Quy ước viết module của khung

> Hợp đồng định dạng cho **mọi file trong `framework/`**. Máy (`scripts/xs.py validate`) kiểm các quy ước
> có dấu 🔒; vi phạm làm CI đỏ. Người/AI viết module mới đọc file này trước.

## 1. Ngôn ngữ và tên

- Nội dung **tiếng Việt có dấu**; thuật ngữ kỹ thuật giữ tiếng Anh khi đó là tên chuẩn (vd *idempotency key*, *Core Web Vitals*).
- Tên file và thư mục: **tiếng Anh, chữ thường, gạch nối** (`kebab-case.md`). Thư mục mảng đánh số `NN-ten-mang/`.
- Mỗi thư mục có `README.md` làm chỉ mục: bảng *file → nội dung → đọc khi nào*.

## 2. Frontmatter 🔒

Mọi file `.md` trong `framework/` bắt đầu bằng khối YAML **dạng phẳng** (chỉ `khoá: giá trị` hoặc `khoá: [a, b]`):

```yaml
---
title: Xác thực & quản lý phiên
kind: module
prefix: SEC-AUTH
applies_to: [all]
updated: 2026-10-13
---
```

| Khoá | Bắt buộc | Giá trị |
|---|---|---|
| `title` | luôn | Tên hiển thị |
| `kind` | luôn | `method` · `index` · `module` · `baseline` · `profile` · `industry` · `standard` · `template` |
| `updated` | luôn | Ngày cập nhật nội dung `YYYY-MM-DD` |
| `prefix` | khi file có mục checklist | Tiền tố ID, **duy nhất toàn khung**, dạng `AAA` hoặc `AAA-BBB` (chữ in hoa/số) |
| `applies_to` | `module`, `baseline` | `[all]` hoặc danh sách slug hồ sơ (`[web-app, mobile-app]`) |
| `modules` | `profile`, `industry` | Danh sách module được ghép vào blueprint, đường dẫn tương đối từ `framework/`, bỏ `.md`; cho phép `*` cuối (vd `08-backend/*`) |
| `slug` | `profile`, `industry` | Tên ngắn dùng trong lệnh `compose` (vd `web-app`, `fintech`) |

## 3. Mục checklist 🔒

Mỗi yêu cầu kiểm được là **một dòng**:

```markdown
- [ ] `SEC-AUTH-001` **MUST** Băm mật khẩu bằng Argon2id (hoặc scrypt/bcrypt khi nền tảng không có) với tham số theo OWASP. → Kiểm: test đơn vị đọc hash có tiền tố `$argon2id$`. · Nguồn: ASVS 5.0 V6
```

- **ID** = `prefix` của file + `-` + 3 chữ số, **duy nhất toàn khung, không bao giờ tái sử dụng** (mục bị bỏ → giữ ID, đổi mức thành `MAY` và ghi "Ngừng dùng").
- **Mức** (theo RFC 2119): `MUST` — thiếu là chưa đạt; `SHOULD` — bỏ phải ghi lý do; `MAY` — tùy chọn.
- **Ngưỡng quy mô** (tùy chọn): `MUST@M` hoặc `MUST@L` — bắt buộc từ quy mô đó trở lên; nhỏ hơn thì máy hạ thành `SHOULD`.
  - `S` = thử nghiệm/MVP nội bộ, ít người dùng · `M` = production có người dùng thật · `L` = quy mô lớn, nhiều đội, hoặc ngành bị quản lý.
- **`→ Kiểm:`** (bắt buộc với `MUST`, nên có với `SHOULD`): cách chứng minh bằng máy hoặc bằng chứng cụ thể (lệnh, test, file, cấu hình). Không viết "đảm bảo X" mà không nói kiểm thế nào.
- **`· Nguồn:`** (khi yêu cầu đến từ chuẩn/luật): mã chuẩn + mục (`ASVS 5.0 V6`, `WCAG 2.2 SC 2.5.8`, `NĐ 13/2023 Đ.9`).
- Một ý một dòng. Không lồng danh sách con dưới mục checklist.

Trạng thái trong **blueprint của dự án** (file sinh ra, không phải trong khung): `[ ]` chưa · `[x]` đạt · `[~]` miễn trừ, bắt buộc kèm `— Miễn: <lý do>`.

## 4. Cấu trúc một module (`kind: module` / `baseline`) 🔒

```markdown
# <Tiêu đề>

> Tóm tắt 1–3 câu: module giải quyết gì, áp dụng khi nào.

## Nguyên tắc
## Quyết định            ← bảng "khi nào dùng gì" / cây quyết định (nếu có lựa chọn)
## Checklist             ← 🔒 bắt buộc có (trừ khi file không có mục)
## Bẫy thường gặp        ← anti-pattern, lỗi hay gặp, ca biên
## Cổng tự động          ← công cụ/lệnh kiểm bằng máy, đặt ở CI hay hook
## Nguồn                 ← 🔒 bắt buộc: URL chính thống + ngày xác minh
```

Thứ tự giữ như trên; được thêm mục riêng giữa "Quyết định" và "Checklist".

## 5. Hồ sơ loại phần mềm (`kind: profile`) và gói ngành (`kind: industry`)

Ngoài frontmatter `slug` + `modules`, nội dung gồm: **Khi nào dùng**, **Kiến trúc tham chiếu**, **Stack mặc định
khuyến nghị** (kèm phiên bản + ngày xác minh — luôn ghi "xác minh lại trước khi dùng"), **Checklist đặc thù**
(mục có ID theo `prefix` riêng), **Cổng chất lượng tương đương**, **Bẫy**, **Nguồn**.

Gói ngành thêm: **Khung pháp lý** (Việt Nam + quốc tế, số hiệu văn bản + ngày hiệu lực), **Mô hình dữ liệu/nghiệp vụ
đặc trưng**, **Ca biên nghiệp vụ**.

## 6. Nguồn và độ tin cậy

- Ưu tiên nguồn **chính thống** (trang chuẩn, văn bản luật, tài liệu chính thức, repo chính chủ) hơn blog tổng hợp.
- Phiên bản/số liệu luôn kèm **ngày xác minh**. Không xác minh được → ghi **(chưa xác minh)**, không đoán.
- Văn bản pháp luật: số hiệu đầy đủ + ngày hiệu lực; nhắc "kiểm tra văn bản sửa đổi trước khi áp dụng".
- Không chép nguyên văn dài; tóm tắt + mã mục + link.

## 7. Liên kết

- Liên kết nội bộ dùng **đường dẫn tương đối** tới file `.md` có thật 🔒.
- Không trùng lặp nội dung giữa các module: một chủ đề có **một nhà**; nơi khác chỉ trỏ tới.

## 8. Khi nào sửa khung

- Thêm/sửa mục: giữ ID cũ ổn định; cập nhật `updated`; ghi `CHANGELOG.md`.
- Đổi quyết định lớn về cấu trúc khung: ghi ADR ở `docs/adr/`.
- Chạy `python3 scripts/xs.py validate` và `python3 -m unittest discover -s tests` trước khi commit.
