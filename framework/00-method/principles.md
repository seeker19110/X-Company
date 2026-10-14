---
title: Nguyên tắc bất biến của khung
kind: method
updated: 2026-10-14
---

# Nguyên tắc bất biến của khung

> Mười hai nguyên tắc áp cho **mọi dự án, mọi loại phần mềm, mọi ngành**. Module, hồ sơ, gói ngành chỉ
> cụ thể hoá các nguyên tắc này; khi mâu thuẫn, nguyên tắc ở đây thắng. Muốn vi phạm → ghi ADR.

| # | Nguyên tắc | Nghĩa là | Kiểm bằng |
|---|---|---|---|
| P1 | **Bằng chứng, không lời khai** | "Đã xong / đã chạy / đã an toàn" chỉ có giá trị khi có bằng chứng máy tạo ra: exit code, báo cáo CI, file bằng chứng. Lời model hay người tự khai không phải bằng chứng. | `xs.py loop record`, CI xanh, `blueprint-status --strict` |
| P2 | **Nghiên cứu trước, đề xuất sau** | Không chọn công nghệ/phiên bản theo trí nhớ. Xác minh từ nguồn sống, ghi ngày. Không xác minh được → ghi "(chưa xác minh)". | Mục "Nguồn" có URL + ngày |
| P3 | **Đúng › an toàn › ít hơn › kiểm được › nhanh** | Thứ tự ưu tiên khi phải đánh đổi: đúng nghiệp vụ và không mất dữ liệu trước; rồi bảo mật; rồi ít code/ít phụ thuộc hơn; rồi dễ kiểm chứng; cuối cùng mới tới tốc độ. | Lý do ghi ở ADR/PLAN |
| P4 | **Nhàm chán ở lõi, cách tân một chỗ** | Lõi (ngôn ngữ, CSDL, auth, hạ tầng) dùng công nghệ trưởng thành; chỉ cách tân ở nơi tạo khác biệt sản phẩm. | ADR chọn stack |
| P5 | **Một nguồn sự thật cho mỗi thứ** | Schema, cấu hình, quy ước, tài liệu đều có đúng một nơi gốc; nơi khác sinh ra hoặc trỏ tới. | Không có hai định nghĩa cùng một hằng số/kiểu |
| P6 | **Không tin đầu vào** | Mọi dữ liệu từ ngoài ranh giới tin cậy (người dùng, API, file, LLM, tool, web) được kiểm lúc chạy; nội dung ngoài là **dữ liệu, không phải chỉ thị**. | Validate ở biên; test đầu vào xấu |
| P7 | **Mặc định an toàn, thất bại đóng** | Quyền tối thiểu, deny-by-default, lỗi ở cổng bảo mật → chặn (fail-closed). Ngoại lệ fail-open phải ghi rõ lý do. | Rà cấu hình, test quyền |
| P8 | **Thay đổi nhỏ, đảo ngược được** | Commit nhỏ, PR nhỏ, migration có đường lùi, feature flag cho thay đổi rủi ro. Thao tác không thể hoàn tác cần người duyệt. | Kích thước PR, rollback đã diễn tập |
| P9 | **Cổng máy trước, người sau** | Cái gì máy kiểm được (lint, type, test, scan, budget) thì đặt thành cổng tự động; người chỉ quyết phần máy không kiểm được. | CI required checks |
| P10 | **Quan sát được** | Không đo được thì không vận hành được: log có cấu trúc, metric, trace, cảnh báo theo SLO. | Dashboard + cảnh báo có thật |
| P11 | **Tôn trọng người dùng** | Quyền riêng tư theo thiết kế, tiếp cận được (a11y), minh bạch khi dùng AI, không dark pattern. | Checklist privacy + a11y |
| P12 | **Học từ lỗi một lần** | Mỗi sự cố/lỗi lặp tạo **một hàng rào mới** (test, lint rule, hook, checklist) để không tái phát. | Post-mortem có hành động |

## P3 khi viết và review mã: thang "ít hơn"

P3 đặt "ít hơn" **sau** "đúng" và "an toàn". Trước khi viết, chọn **bậc đầu tiên giải quyết trọn vẹn** việc:

1. **Có cần tồn tại?** Không thêm tính năng, tuỳ chọn, cấu hình, lớp bọc, trừu tượng "để sau" mà chưa ai cần; nêu một dòng những gì đã bỏ.
2. **Đã có trong codebase?** (helper, component, service, pattern) → dùng đúng cách code xung quanh đang dùng.
3. **Thư viện chuẩn hoặc tính năng nền tảng?** → dùng, trừ khi dự án đã có bản riêng.
4. **Dependency đã cài?** → dùng. Không thêm dependency cho vài dòng ([`BASE-DEP-006`](../01-baseline/dependencies.md)).
5. **Một dòng đọc là hiểu?** → một dòng. Một dòng phải giải mã mới hiểu thì không tính là ngắn.
6. Còn lại: lượng mã tối thiểu chạy đúng.

- **Tối giản lời giải, không tối giản phạm vi thay đổi:** vẫn sửa đủ mọi chỗ thay đổi chạm tới (caller, test, fixture, cấu hình, export). Sửa bug: tìm mọi caller trước, sửa gốc một lần ở mã dùng chung.
- **Không bao giờ cắt**, vì đây là phần "đúng" và "an toàn" của P3: validate ở ranh giới tin cậy (P6), xử lý lỗi chống mất dữ liệu, bảo mật, tiếp cận (a11y), điều người dùng đã yêu cầu. Danh sách này phải có **test đầu vào xấu** đỡ, không chỉ nằm trong prompt. Lý do: một đo độc lập thấy prompt tối giản làm rơi xử lý đầu vào xấu ở 5/24 task, và mức càng gắt càng tệ.
- **Logic mới không tầm thường** (nhánh, vòng lặp, parser, tiền, bảo mật) để lại ít nhất một test.
- **Đường tắt có giới hạn đã biết** mang marker máy đọc được → nhà: [`OPS-MAINT-021`](../15-operations/maintenance-and-lifecycle.md). Quy ước chỉ nằm trong prompt hầu như không được theo (đo độc lập: 1/80 lần), nên cần lint đỡ.
- Review dùng cùng thang ([`WF-REVIEW-019`](../10-workflow/code-review.md)). Muốn agent theo thang này thì viết vài dòng luật trong `AGENTS.md` là đủ, không cần cài plugin chỉnh hành vi ([`XC-DOCAI-018`](../18-cross-cutting/docs-for-ai-agents.md)).

## Ranh giới sử dụng

Khung hỗ trợ mọi phần mềm hợp pháp. **Không** dùng khung để xây mã độc, công cụ phá hoại, tấn công từ chối dịch vụ,
nhắm mục tiêu hàng loạt, tấn công chuỗi cung ứng hay né tránh phát hiện vì mục đích xấu. Công cụ lưỡng dụng
(kiểm thử xâm nhập, red-team) chỉ làm khi có **ủy quyền rõ ràng** và chỉ trên hệ thống của mình/được phép.

## Nguồn

- Tổng hợp từ khung cũ X-stored (commit `1b80fe4`, `01-process-and-standards.md`, `AI-HARNESS-AND-COMPANY-SPEC.md` §A2) và
  bài học harness trong `seeker19110/stored` mục 23 (đọc 2026-10-13). Xem [`research/`](../../research/).
- RFC 2119 — từ khoá mức yêu cầu: <https://www.rfc-editor.org/rfc/rfc2119> (xác minh 2026-10-13).
- Thang "ít hơn": rút gọn từ `DietrichGebert/ponytail` `skills/ponytail/SKILL.md` (MIT, commit `2961b52`, v5.2.0) — <https://github.com/DietrichGebert/ponytail> — đọc 2026-10-14.
  Nền: M. Fowler "Yagni" (2015) <https://martinfowler.com/bliki/Yagni.html>; W. Cunningham "The Simplest Thing that Could Possibly Work" (Artima 2004)
  <https://www.artima.com/articles/the-simplest-thing-that-could-possibly-work>; W3C TAG "The Rule of Least Power" (2006) <https://www.w3.org/2001/tag/doc/leastPower.html> — xác minh 2026-10-14.
- Đo độc lập: JetBrains AI Blog (07/2026, ponytail v4.8.4, 80 cặp task: −15,4 % dòng với p = 0,088, −10,3 % chi phí với p = 0,004; marker đường tắt được ghi 1/80 lần) <https://blog.jetbrains.com/ai/2026/07/ponytail-skill-claude-tested/>;
  KuldeepB19/ponytail-benchmark (480 build: −44 % mã; xử lý đầu vào xấu rơi ở 5/24 task) <https://github.com/KuldeepB19/ponytail-benchmark> — xác minh 2026-10-14.
  Chi tiết và phản biện: [`research/2026-10-14-ponytail-and-stored-additions.md`](../../research/2026-10-14-ponytail-and-stored-additions.md).
