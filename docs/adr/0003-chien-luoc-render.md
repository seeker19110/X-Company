# ADR-0003: Chiến lược render theo nhóm route

- Trạng thái: Chấp nhận · Ngày: 2026-10-18 · Quyết định: D-004 (`docs/autopilot/DECISIONS.md`) · Bổ sung ADR-0001, ADR-0002

## Bối cảnh

Một ứng dụng Next.js (App Router) phục vụ hai nhóm route có yêu cầu trái nhau (PRF-WEB-001):
- **Website công khai** (`app/(public)`, `app/api/public`): nội dung CMS do biên tập viên sửa, lưu trong PostgreSQL; ai cũng thấy
  như nhau; cần nhanh và chịu tải đột biến, nhưng nội dung phải cập nhật trong vài phút sau khi xuất bản.
- **Khu nội bộ/PWA** (`app/app`, `app/api/app`): dữ liệu theo người dùng, theo quyền và theo công ty (chấm công, công việc,
  nghiệm thu). Lộ chéo giữa hai người dùng là sự cố bảo mật.

Dữ liệu CMS nằm trong DB runtime; dựng tĩnh lúc build sẽ bắt build phải có DB và buộc dựng lại mỗi lần xuất bản.

## Phương án đã cân nhắc

1. **Tĩnh/ISR toàn bộ** — rẻ và nhanh, nhưng route theo người dùng có nguy cơ rơi vào cache dùng chung; build phụ thuộc DB.
2. **Động toàn bộ, không cache** — an toàn tuyệt đối về chia sẻ cache, nhưng website công khai tốn DB cho mỗi lượt xem và chậm
   khi tải đột biến.
3. **Chia theo nhóm route** — công khai: render phía server đọc DB mỗi request, cho phép CDN/proxy cache ngắn bằng header
   `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`; nội bộ: luôn động, `force-dynamic` và `Cache-Control: no-store`.

## Quyết định

Chọn phương án 3.
- **Công khai** = `force-dynamic` đọc CMS từ DB mỗi request (build không cần DB), tuyệt đối không đọc cookie/phiên và không
  có dữ liệu theo người dùng — nhờ đó an toàn để một CDN/proxy phía trước cache ngắn
  (`Cache-Control: public, s-maxage=60, stale-while-revalidate=300`; chưa đặt ở ứng dụng, bật khi có CDN). Trang không đọc
  DB thì để tĩnh.
- **Nội bộ** = chế độ "động": `export const dynamic = "force-dynamic"` ở layout `app/app`, mọi route `app/api/app/*` trả
  `Cache-Control: no-store`; không dùng `unstable_cache`/`use cache` cho dữ liệu có `actor`.
- Mỗi route có một hàng trong `docs/ROUTES.md` kèm chế độ và lý do; `scripts/check-routes.ts` giữ bảng khớp cây `app/`.

## Hệ quả

- Rò rỉ chéo người dùng bị chặn từ thiết kế: nhóm duy nhất được cache không bao giờ thấy phiên.
- Website đọc DB mỗi request khi cache hụt: cần chỉ mục và pool kích cỡ phù hợp; mất DB làm trang công khai lỗi sau khi cache
  hết hạn (stale-while-revalidate giảm tác động).
- Phải kiểm bằng test: E2E đăng nhập hai người dùng khác nhau không thấy dữ liệu của nhau; header `no-store`/`private` ở
  route có xác thực (thuộc lát triển khai tương ứng, theo dõi ở BLUEPRINT `PRF-WEB-001`).

## Điều kiện đọc lại

- p95 TTFB trang công khai > 800 ms ở tải thực hoặc DB công khai chịu > 50% tải đọc.
- Cần xuất bản tức thời (SLA < 10 giây) — chuyển sang `revalidateTag` khi xuất bản.
- Có route nội bộ nào cần cache theo người dùng (khi đó phải thiết kế khoá cache gồm `actor`/công ty và có ADR riêng).
