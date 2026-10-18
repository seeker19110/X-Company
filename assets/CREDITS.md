# Nguồn và giấy phép của ảnh/minh hoạ

Mọi ảnh và minh hoạ trong sản phẩm có dòng ở đây (UX-VISUAL-007). Script `npm run -s check:repo-docs` so khớp: mỗi tệp trong
`public/icons/` và `public/images/` phải được phủ bởi một dòng bảng dưới (đường dẫn đúng hoặc dạng `thư-mục/*`).
Ảnh do AI tạo phải gắn nhãn ở cột "Ghi chú".

| Đường dẫn | Nguồn | Giấy phép | Ghi chú |
|---|---|---|---|
| `public/icons/*` | Sinh bằng mã bởi `scripts/make-icons.mjs` từ hình học thuần (không dùng ảnh/phông của bên thứ ba) | Cùng giấy phép dự án (độc quyền, xem LICENSE) | Không phải ảnh AI. Chạy lại script để tái tạo; đổi script thì rà lại dòng này. |

`public/images/` chưa có tệp nào. Khi thêm ảnh: thêm một dòng với nguồn (URL hoặc người tạo), giấy phép (SPDX/CC), ngày lấy và
phạm vi dùng; ảnh có người thật cần bằng chứng đồng ý của người trong ảnh.
