# Bảng route và chế độ render

> FE-RENDER-001 · chiến lược và lý do: [ADR-0003](adr/0003-chien-luoc-render.md). Script `scripts/check-routes.ts`
> (trong `npm run check:arch`) so bảng này với cây `app/` (`page.tsx`, `route.ts`): thiếu/thừa/sai URL/sai chế độ = đỏ.
> Thêm route = thêm một hàng trong cùng PR.

Chế độ: **tĩnh** (dựng lúc build, không đọc DB) · **cache dùng chung** (đọc DB, cho phép CDN cache ngắn, không dữ liệu theo người dùng) · **động** (mỗi request, theo người dùng, `Cache-Control: no-store`) · **CSR** (vỏ tĩnh, dữ liệu tải ở trình duyệt).

| Route | Tệp                       | Chế độ | Lý do                                                         |
| ----- | ------------------------- | ------ | ------------------------------------------------------------- |
| `/`   | `app/(public)/page.tsx`   | tĩnh   | Trang giữ chỗ chưa đọc DB; chuyển "cache dùng chung" khi có CMS |
