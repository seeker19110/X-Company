<!-- Checklist hiện trên MỌI PR của repo khung. Tích thật, có bằng chứng; mục không áp dụng ghi N/A + lý do. -->

## Mô tả

<!-- Thay đổi gì, TẠI SAO. Link issue/ADR nếu có. Nếu đổi mục checklist: nêu ID bị ảnh hưởng. -->

## Loại thay đổi

- [ ] `feat` — module/hồ sơ/ngành/mẫu/công cụ mới
- [ ] `fix` — sửa nội dung sai, link gãy, lỗi công cụ
- [ ] `refactor` / `docs` / `test` / `chore` / `ci`
- [ ] ⚠️ Đổi ID/mức của mục đã có hoặc đổi hành vi `xs.py` (ghi CHANGELOG + lý do)

## Cổng (bằng chứng ở CI job `quality`)

- [ ] `python3 scripts/xs.py validate` xanh (frontmatter, ID duy nhất, MUST có `→ Kiểm:`, link)
- [ ] `python3 -m unittest discover -s tests` xanh
- [ ] Phiên bản/chuẩn/luật mới thêm có **nguồn + ngày xác minh**; không xác minh được ghi **(chưa xác minh)**
- [ ] Không trùng nội dung với module khác ("một chủ đề một nhà"); chỗ khác chỉ liên kết
- [ ] README chỉ mục của mảng đã cập nhật; `CHANGELOG.md` cập nhật nếu đổi mục/ID/công cụ
- [ ] Không bí mật, không tên model/phiên AI trong nội dung

## Ảnh hưởng

<!-- Blueprint của dự án đích đổi thế nào (mục thêm/bớt/đổi mức)? Có cần ADR? -->
