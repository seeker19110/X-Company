# ADR-0001: Khung là thư viện yêu cầu có ID, máy ghép thành blueprint và máy kiểm "xong"

- **Trạng thái:** Đã chấp nhận
- **Trạng thái triển khai:** Đã triển khai (`framework/`, `scripts/xs.py`, `tests/test_xs.py`, CI job `quality`)
- **Ngày:** 2026-10-13

## Bối cảnh

Khung cũ (commit `1b80fe4`) là ~2.900 dòng văn xuôi hướng dẫn + scaffold Next.js/Supabase. Phân tích ở
`research/2026-10-13-old-framework-analysis.md` cho thấy: trùng lặp nặng (cùng nội dung ở ≥ 4 chỗ), còn
`[ĐIỀN]`, thiên về web, hồ sơ C2–C10 chỉ một bảng, không có ngành nghề, và quan trọng nhất: **"đã đạt" là lời
khai của người/AI, không máy nào kiểm được**. Yêu cầu mới: một khung cho **mọi loại phần mềm và ngành**, dự
án sau này **tham khảo và áp dụng được**, và khi đã duyệt thì **tự động làm đến khi hoàn thiện**.

Ràng buộc: chỉ Python thư viện chuẩn (chạy mọi máy, không cài gì); nội dung tiếng Việt; dùng chung được với
`projects-template` (harness quy trình) và `stored` (catalog).

## Quyết định

1. Khung là **thư viện yêu cầu có ID ổn định** (`PREFIX-NNN`), mức **MUST/SHOULD/MAY** theo RFC 2119, ngưỡng quy mô
   `@M`/`@L`, mỗi MUST có `→ Kiểm:` máy kiểm được. Hợp đồng định dạng ở `00-method/conventions.md`, máy kiểm bằng
   `xs.py validate` (frontmatter, ID duy nhất, link, hồ sơ/ngành).
2. Mỗi dự án **không đọc hết khung** mà **ghép** `BLUEPRINT.md` = baseline + hồ sơ loại phần mềm (chọn 1) + gói ngành
   (0..n) + `--add`, lọc theo `applies_to`, hạ mức theo quy mô. `xs.py blueprint-status --strict` là cổng phát hành.
3. "Xong" do máy xác nhận: `xs.py loop record` ghi bằng chứng (exit code, lệnh, SHA) cho từng task của PLAN; Stop hook
   đọc bằng chứng để quyết cho dừng hay làm tiếp; cùng một lỗi lặp 3 lần → BLOCKED.
4. Cấu trúc 18 mảng + mẫu tài liệu; mỗi chủ đề có **một nhà**, chỗ khác chỉ liên kết (máy kiểm link).

## Lý do

- ID ổn định cho phép so sánh blueprint giữa các phiên bản khung, truy vết PR → mục, và đo tiến độ bằng máy.
- Ghép theo hồ sơ/ngành giải quyết "khung cho mọi loại" mà không bắt dự án nhỏ đọc 100 module.
- Bằng chứng do code điền (không phải lời khai) là bài học lặp lại nhiều nhất trong catalog `stored` mục 23 và là điều
  kiện để "tự động đến khi xong" không thành "tự khai xong sớm".
- Thư viện chuẩn Python: cài khung chỉ là copy file; không phụ thuộc Node/npm cho dự án không dùng JS.

## Các phương án đã cân nhắc

- **Giữ văn xuôi + CLAUDE.md dài** (khung cũ): dễ viết, nhưng không kiểm được, trùng lặp, và agent tự khai "đạt". Loại.
- **Checklist dạng YAML/JSON thuần**: máy đọc tốt hơn nhưng người đọc/viết kém, PR review khó. Markdown + regex chặt là
  điểm cân bằng; validator bắt mọi dòng "giống mục" sai định dạng.
- **Dùng công cụ ngoài** (Spec Kit/OpenSpec/BMAD): áp đặt quy trình hoặc còn breaking change (catalog 13 §5); khung cần
  trung lập harness. Có thể tích hợp sau qua `10-workflow/spec-driven-development.md`.
- **Một blueprint cố định cho mọi dự án**: quá dài cho dự án S, thiếu cho ngành bị quản lý. Loại.

## Hệ quả

- Tốt: máy kiểm được quy ước và tiến độ; dự án đích chỉ cần `install.py` + `compose`; thay đổi khung lan tới dự án qua ID.
- Xấu/nợ: viết mục "kiểm được" tốn công hơn văn xuôi; `applies_to` phải bảo trì khi thêm hồ sơ; blueprint sinh ra có thể
  dài (hàng trăm mục ở quy mô L) — cần `--include-may` mặc định tắt và README theo vai.
- Theo dõi: số mục MUST không có cách kiểm thực tế (phát hiện khi audit dự án thật) → hạ SHOULD hoặc viết lại Kiểm.
