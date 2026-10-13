---
title: Ghép blueprint cho một dự án
kind: method
updated: 2026-10-13
---

# Ghép blueprint cho một dự án

> Khung là **thư viện yêu cầu có ID**. Mỗi dự án không đọc hết thư viện mà **ghép** đúng phần cần thành một file
> `BLUEPRINT.md` — danh sách kiểm có thể tick bằng bằng chứng. Máy ghép, máy đếm, máy chặn khi còn `MUST` mở.

## Công thức

```text
BLUEPRINT = Baseline (mọi phần mềm)
          + Module theo hồ sơ loại phần mềm   (profile.modules)
          + Mục đặc thù của hồ sơ
          + Module theo gói ngành             (industry.modules, có thể nhiều ngành)
          + Mục đặc thù của gói ngành
          → lọc theo applies_to → điều chỉnh mức theo quy mô S/M/L
```

- **Baseline** (`01-baseline/`, `kind: baseline`) luôn được ghép.
- **Hồ sơ** (`02-profiles/`) chọn **đúng một** — loại chính của sản phẩm. Hệ nhiều thành phần (vd web + mobile + API)
  → chọn hồ sơ chính, rồi ghép thêm blueprint riêng cho từng thành phần, hoặc dùng hồ sơ `monorepo`.
- **Gói ngành** (`03-industries/`) chọn **0..n**. Ví dụ ví điện tử cho bệnh viện = `fintech` + `healthcare`.
- Module có `applies_to` không chứa hồ sơ đã chọn (và không phải `all`) sẽ bị loại.
- Mục `MUST@M` / `MUST@L` hạ thành `SHOULD` khi quy mô nhỏ hơn ngưỡng.
- Ở quy mô **S**, MUST của module chuyên sâu (`kind: module`/`standard`) cũng hạ thành `SHOULD`; chỉ MUST của baseline, hồ sơ và gói ngành giữ nguyên — đó là **sàn** của mọi dự án (ADR-0003). Khi dự án lên M, ghép lại blueprint: các mục đó tự trở về MUST.

## Lệnh

```bash
# Liệt kê lựa chọn
python3 scripts/xs.py list profiles
python3 scripts/xs.py list industries

# Ghép blueprint: web app cho thương mại điện tử, quy mô production
python3 scripts/xs.py compose --profile web-app --industry ecommerce --scale M --out BLUEPRINT.md

# Theo dõi tiến độ; --strict trả exit 1 nếu còn MUST chưa đạt (dùng làm cổng phát hành)
python3 scripts/xs.py blueprint-status BLUEPRINT.md --strict
```

## Dùng blueprint thế nào

1. **Commit `BLUEPRINT.md` vào repo dự án** (G1). Đây là phạm vi chất lượng đã thống nhất.
2. **Tick bằng bằng chứng**: chỉ đổi `[ ]` → `[x]` khi có bằng chứng máy (CI job, test, báo cáo scan, file cấu hình).
   Ghi bằng chứng ở PR tương ứng.
3. **Miễn trừ có lý do**: mục không áp dụng → `[~]` kèm `— Miễn: <lý do>` (vd "không có thanh toán"). Máy chặn miễn
   trừ thiếu lý do.
4. **Không sửa chữ của mục** trong blueprint dự án; muốn đổi yêu cầu → sửa khung (PR vào X-stored) rồi ghép lại.
5. **Ghép lại khi khung cập nhật**: chạy lại `compose` ra file tạm, so sánh, chuyển trạng thái tick sang (ID ổn định
   nên so theo ID).

## Chọn quy mô

| Câu hỏi | Có → |
|---|---|
| Có người dùng thật ngoài đội phát triển? | ≥ M |
| Có tiền thật, dữ liệu sức khoẻ, dữ liệu trẻ em, dữ liệu định danh nhạy cảm? | L (hoặc M + gói ngành đúng) |
| Nhiều đội cùng phát triển, SLA ký với khách hàng, kiểm toán bên ngoài? | L |
| Chỉ thử nghiệm ý tưởng, không lưu dữ liệu thật? | S |

Quy mô quyết định khối lượng: blueprint `web-app` khoảng 80 MUST ở S, khoảng 1.100 MUST ở M (đo 2026-10-13). Chọn đúng quy mô quan trọng hơn chọn đủ module.

## Nguồn

- Quy ước định dạng: [`conventions.md`](conventions.md).
- Ý tưởng "checklist máy đọc được, GO/NO-GO theo bằng chứng": `seeker19110/stored` mục 09 (deployment-checklist,
  production-readiness-checklist), đọc 2026-10-13.
