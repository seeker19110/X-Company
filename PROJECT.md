# PROJECT.md — X-Company: website, webapp điều hành và PWA

> Cổng G0/G1: phiên chính tự duyệt (D-001…D-005, `docs/autopilot/DECISIONS.md`) ngày 2026-10-18 · Phiên bản tài liệu: 1
> Nguồn yêu cầu: `docs/input/ke-hoach-website-webapp-pwa.md` (kế hoạch v1.0, 2026-10-18) — mục §n bên dưới trỏ về đó.

## 0. Loại dự án & hồ sơ
- Hồ sơ: `web-app` (một ứng dụng Next.js gồm website công khai, khu nội bộ và PWA — §11 "kiến trúc chia module trong một ứng dụng").
- Gói ngành: không (không khớp gói nào; gói công trường là P2 — §9).
- Quy mô: **M** — có người dùng thật (20–200 nhân viên), dữ liệu cá nhân nhạy cảm (định vị, hồ sơ nhân sự — Luật 91/2025/QH15, NĐ 356/2025/NĐ-CP), không có tiền thật.
- Blueprint: `python3 .xtemplates/scripts/xt.py compose --profile web-app --scale M --out BLUEPRINT.md` (469 MUST · 1.314 SHOULD).

## 1. Vấn đề & người dùng
- Vấn đề: công ty 20–200 nhân viên, nhiều phòng ban/địa điểm, chấm công, giao việc và tổng hợp tiến độ bằng công cụ rời rạc; HR không chốt công được bằng dữ liệu truy vết, quản lý không thấy điểm vướng, khách hàng không có kênh gửi yêu cầu tới đúng người (§2).
- Người dùng: nhân viên (văn phòng, công tác, công trường), trưởng nhóm, quản lý dự án, HR, kế toán, kinh doanh/biên tập, lãnh đạo, quản trị kỹ thuật (§5); khách truy cập website.
- JTBD: Khi bắt đầu ngày làm việc, nhân viên muốn biết ca, việc ưu tiên và chấm công bằng một tay trên điện thoại, để không phải giải trình công cuối tháng.
- Hiện trạng: chưa đo — đo trong pilot (§2, §16).
- Giải pháp thay thế tham khảo: Frappe HR (ca qua ngày), Plane (Modules/Cycles) — §20.

## 2. Chỉ số thành công (§2 — mục tiêu đề xuất, baseline đo trong khảo sát)
| ID | Chỉ số | Baseline | Mục tiêu | Sự kiện đo |
|---|---|---|---|---|
| M-01 | Yêu cầu hợp lệ từ website có người phụ trách và trạng thái / tổng yêu cầu hợp lệ | chưa đo | 100% | `inquiry.created`, `inquiry.assigned` |
| M-02 | Người trong phạm vi pilot dùng luồng chính hằng tuần / người trong pilot | chưa đo | ≥ 90% | sự kiện sử dụng theo vai trò |
| M-03 | Sai lệch ảnh hưởng công/lương chưa giải thích khi khoá kỳ | chưa đo | 0 | biên bản đối soát `period.locked` |
| M-04 | Việc đang thực hiện có người chịu trách nhiệm, hạn và kết quả / việc đang thực hiện | chưa đo | 100% | truy vấn chất lượng dữ liệu |
| M-05 | Thời gian tổng hợp báo cáo + công | chưa đo | −30% sau 2 kỳ ổn định | so trước/sau |

## 3. Phạm vi MVP (P0 — §4)
| ID | Tính năng | Mức | Spec |
|---|---|---|---|
| F-001 | Danh tính, tổ chức (công ty/chi nhánh/phòng ban/địa điểm/nhân viên), phân quyền theo vai trò + phạm vi, thu hồi truy cập | Must | docs/specs/SPEC-identity-org.md |
| F-002 | Nhật ký kiểm toán (ai/gì/đối tượng/lúc/lý do/kết quả), ghi nối tiếp, chuỗi băm | Must | docs/specs/SPEC-identity-org.md |
| F-003 | Website công ty + CMS (nháp/duyệt/xuất bản/phiên bản) + liên hệ & tuyển dụng → hộp tiếp nhận | Must | docs/specs/SPEC-website-cms.md |
| F-004 | Chấm công: ca, sự kiện vào/ra chống trùng, QR động ký máy chủ, ca qua đêm, ngoại lệ | Must | docs/specs/SPEC-attendance.md |
| F-005 | Nghỉ phép (sổ biến động), OT (đề nghị/duyệt/hạn mức), sửa công có duyệt, không tự duyệt | Must | docs/specs/SPEC-attendance.md |
| F-006 | Kỳ công: đối chiếu, khoá, xuất có phiên bản + tổng kiểm tra; log muộn không sửa kỳ khoá | Must | docs/specs/SPEC-attendance.md |
| F-007 | Dự án, hạng mục, công việc, mốc, phụ thuộc cơ bản, kế hoạch tuần | Must | docs/specs/SPEC-work.md |
| F-008 | Nghiệm thu (bằng chứng, trả lại, mở lại), baseline trọng số, 3 con số tiến độ | Must | docs/specs/SPEC-work.md |
| F-009 | Giờ dự án và đối chiếu với công | Must | docs/specs/SPEC-work.md |
| F-010 | Tệp private có phiên bản, kiểm quyền, bình luận theo đối tượng, thông báo | Must | docs/specs/SPEC-work.md |
| F-011 | PWA: cài đặt, màn hình Hôm nay, hàng chờ ngoại tuyến có khoá chống trùng, đăng xuất xoá dữ liệu | Must | docs/specs/SPEC-pwa.md |
| F-012 | Dashboard ngoại lệ: công cần xử lý, việc trễ, tiến độ nghiệm thu | Must | docs/specs/SPEC-work.md |

### Không làm (lúc này)
- P1/P2 (§4): Gantt, CRM, chi phí, tài sản, tri thức, tiếng Anh, AI, cổng khách hàng, native — lý do: ranh giới P0.
- Kế toán pháp định, thuế, bảo hiểm, tính lương, kho, chat/video, BIM — dự án mở rộng (§4).
- Nhận diện khuôn mặt (§12). SaaS đa doanh nghiệp, billing (§11).

## 4. Luồng chính (bắt buộc E2E — §17)
1. AT01: khách gửi liên hệ → đúng một hồ sơ có mã, người phụ trách, hạn; bản CMS chưa duyệt không công khai.
2. AT03/AT04: nhân viên quét QR vào ca đêm, gửi lặp → một sự kiện; tổng hợp ca qua ngày đúng.
3. AT06: sửa công có trước/sau, lý do, người duyệt; kỳ khoá không bị sửa âm thầm.
4. AT09/AT10: giao việc → báo hoàn thành kèm bằng chứng → nghiệm thu/trả lại; tiến độ nghiệm thu đúng ví dụ 35%.
5. AT12: đăng xuất/đổi tài khoản không lộ dữ liệu; thu hồi quyền có hiệu lực ở API.

## 5. Yêu cầu phi chức năng (§13)
| Nhóm | Ngưỡng | Cách đo |
|---|---|---|
| Hiệu năng website mobile | LCP ≤ 2,5 s · INP ≤ 200 ms · CLS ≤ 0,1 (p75) | Lighthouse CI cấu hình lặp |
| Ghi chấm công | p95 xử lý máy chủ < 1 s; 200 yêu cầu/10 s không mất/trùng | bài tải |
| Tiếp cận | WCAG 2.2 AA luồng chính | axe + kiểm tay |
| Sẵn sàng | SLO 99,9%/tháng sau pilot | uptime |
| Khôi phục | DB RPO ≤ 15 phút, RTO ≤ 4 giờ; tệp RPO ≤ 1 giờ | diễn tập restore |
| Thiết bị | iPhone Safari + PWA, Android Chrome + PWA, Chrome/Edge desktop | AT13 |

## 6. Dữ liệu & pháp lý (§12)
- Dữ liệu cá nhân: có — cơ bản (hồ sơ nhân viên, ứng viên, khách liên hệ) và **nhạy cảm** (định vị).
- Tiền thật: không (bảng công xuất cho hệ lương khác).
- Luật: Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 (hiệu lực 01/01/2026); NĐ 356/2025/NĐ-CP (thay NĐ 13/2023); Bộ luật Lao động Điều 107 (làm thêm giờ) — nguồn ở §20 kế hoạch, kiểm 2026-10-18; cần HR + pháp chế xác nhận trước vận hành.
- DPIA: bắt buộc trước khi bật thu GPS/ảnh — `docs/DPIA.md` (chưa lập; việc của chủ dự án + pháp chế).

## 7. Stack (chi tiết: docs/adr/0001-stack.md)
Next.js + React + TypeScript · PostgreSQL (SQL thuần qua `pg`) · `node:test` + Playwright · ESLint + Prettier · tự host (PM2) — cùng stack XBOSS để chép có chọn lọc hạ tầng (D-001).

## 8. Giả định, rủi ro, ràng buộc
| Giả định | Cách kiểm chứng | RK |
|---|---|---|
| Quy tắc ca/OT/nghỉ của công ty khớp bộ ví dụ HR | F02: HR chốt ví dụ đầu vào/đầu ra | RK-001 |
| GPS/QR đủ tin cậy ở hiện trường | thử tại địa điểm thật (Q02) | RK-002 |
| Phần XBOSS chép sang không mang theo nợ | test + review từng phần chép | RK-003 |
- Ràng buộc: tiếng Việt mặc định, múi giờ Asia/Ho_Chi_Minh; không tiền thật; người duyệt pháp lý trước khi bật GPS.

## 9. Các bên
| Vai trò | Tên | Quyết định gì |
|---|---|---|
| Chủ sản phẩm | seeker19110 | phạm vi, ngân sách, merge PR ngoại lệ cứng |
| HR / pháp chế | (chưa chỉ định) | quy tắc ca, DPIA, thời hạn lưu |
