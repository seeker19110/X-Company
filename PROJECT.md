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
ID yêu cầu `R-NNN` ổn định, không tái sử dụng khi bỏ (PM-REQ-007); mỗi dòng trỏ tính năng `F-NNN` ở mục 3.

| ID | Luồng | Tính năng |
|---|---|---|
| R-001 | AT01: khách gửi liên hệ → đúng một hồ sơ có mã, người phụ trách, hạn; bản CMS chưa duyệt không công khai | F-003 |
| R-002 | AT03/AT04: nhân viên quét QR vào ca đêm, gửi lặp → một sự kiện; tổng hợp ca qua ngày đúng | F-004 |
| R-003 | AT06: sửa công có trước/sau, lý do, người duyệt; kỳ khoá không bị sửa âm thầm | F-005, F-006 |
| R-004 | AT09/AT10: giao việc → báo hoàn thành kèm bằng chứng → nghiệm thu/trả lại; tiến độ nghiệm thu đúng ví dụ 35% | F-007, F-008, F-010 |
| R-005 | AT12: đăng xuất/đổi tài khoản không lộ dữ liệu; thu hồi quyền có hiệu lực ở API | F-001, F-002, F-011 |

## 5. Yêu cầu phi chức năng (§13)
| ID | Nhóm | Ngưỡng | Cách đo | Tính năng |
|---|---|---|---|---|
| R-006 | Hiệu năng website mobile | LCP ≤ 2,5 s · INP ≤ 200 ms · CLS ≤ 0,1 (p75) | Lighthouse CI cấu hình lặp | F-003 |
| R-007 | Ghi chấm công | p95 xử lý máy chủ < 1 s; 200 yêu cầu/10 s không mất/trùng | bài tải | F-004, F-011 |
| R-008 | Tiếp cận | WCAG 2.2 AA luồng chính | axe + kiểm tay | F-003, F-011, F-012 |
| R-009 | Sẵn sàng | SLO 99,9%/tháng sau pilot (SLI ở `docs/ops/SLO.md`) | uptime | F-001, F-003, F-004 |
| R-010 | Khôi phục | DB RPO ≤ 15 phút, RTO ≤ 4 giờ; tệp RPO ≤ 1 giờ (số ĐỀ XUẤT — chủ sản phẩm chốt ở `docs/ops/RPO-RTO.md`) | diễn tập restore | F-002, F-010 |
| R-011 | Thiết bị | iPhone Safari + PWA, Android Chrome + PWA, Chrome/Edge desktop | AT13 | F-011 |

### Chuẩn bảo mật nhắm tới
**ASVS 5.0.0 L2** (OWASP Application Security Verification Standard) — dữ liệu cá nhân nhạy cảm (định vị) và hồ sơ nhân sự, không có tiền thật nên không lên L3.
Mối đe doạ và bảng OWASP Top 10:2025: [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

### Đặc tính chất lượng theo ISO/IEC 25010:2023
| Đặc tính | Yêu cầu đo được | Ngưỡng | Trỏ tới |
|---|---|---|---|
| Hiệu quả thực hiện (performance efficiency) | p95 ghi chấm công phía máy chủ; LCP mobile | < 1 s; ≤ 2,5 s | mục 5: ghi chấm công, hiệu năng website |
| Độ tin cậy (reliability) | SLO sẵn sàng; RPO DB; RTO | ≥ 99,9%/tháng; ≤ 15 phút; ≤ 4 giờ | mục 5: sẵn sàng, khôi phục |
| Bảo mật (security) | chuẩn xác minh; giới hạn đăng nhập sai | ASVS 5.0.0 L2; 5 lần/15 phút | mục trên, SPEC-identity-org |
| Khả năng tương tác (interaction capability, gồm tiếp cận) | tiêu chuẩn tiếp cận; INP | WCAG 2.2 AA; ≤ 200 ms | mục 5: tiếp cận, hiệu năng website |
| Tương thích (compatibility) | trình duyệt/thiết bị hỗ trợ | 3 nhóm thiết bị ở mục 5 | mục 5: thiết bị |
| Khả năng bảo trì (maintainability) | coverage dòng/nhánh/hàm của `lib/**` (c8, đỏ khi dưới ngưỡng) | ≥ 85% / 80% / 85% | `scripts/coverage.sh` |
| Phù hợp chức năng (functional suitability) | tiêu chí chấp nhận có test mang mã S-ID | 100% | `npm run -s check:docs` |
| Linh hoạt (flexibility) | dịch vụ ngoài qua adapter, đổi bằng biến môi trường | không đổi mã nghiệp vụ | D-005 |
| An toàn (safety, ISO 25010:2023) | — | không áp dụng: phần mềm không điều khiển thiết bị/gây hại vật lý | — |

## 6. Dữ liệu & pháp lý (§12)
- Dữ liệu cá nhân: có — cơ bản (hồ sơ nhân viên, ứng viên, khách liên hệ) và **nhạy cảm** (định vị).
- Tiền thật: không (bảng công xuất cho hệ lương khác).
- Luật: Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 (hiệu lực 01/01/2026); NĐ 356/2025/NĐ-CP (thay NĐ 13/2023); Bộ luật Lao động Điều 107 (làm thêm giờ) — nguồn ở §20 kế hoạch, kiểm 2026-10-18; cần HR + pháp chế xác nhận trước vận hành.
- DPIA: bắt buộc trước khi bật thu GPS/ảnh — [docs/DPIA.md](docs/DPIA.md) (bản nháp, **chờ pháp chế duyệt**; việc của chủ dự án + pháp chế). Khung pháp lý đầy đủ ở mục 10.
- Phân loại dữ liệu cá nhân (BASE-SEC-013): sổ đầy đủ ở [docs/privacy/data-map.yaml](docs/privacy/data-map.yaml) và [docs/compliance/data-inventory.csv](docs/compliance/data-inventory.csv) — cơ bản (họ tên, email, SĐT, ngày vào/nghỉ, hồ sơ công tác, liên hệ khách, ứng viên) · nhạy cảm (định vị chấm công) · bí mật (băm mật khẩu, khoá ký). Cột chứa dữ liệu cá nhân phải khai trong sổ; script `npm run -s check:docs` đối chiếu với `migrations/*.sql`.

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

## 10. Khung pháp lý
Lập ở G2 (PM-RISK-007). **Pháp chế/HR xác minh bản chính thức trước khi vận hành**; kiểm tra văn bản sửa đổi, thay thế trước khi áp dụng. Nguồn dưới đây do khung X-Templates xác minh ngày 2026-10-13 (nguồn thứ cấp cho số điều); chưa có người pháp lý của dự án đối chiếu.

| Văn bản | Ngày hiệu lực | Áp dụng cho dự án | Nguồn |
|---|---|---|---|
| Luật Bảo vệ dữ liệu cá nhân số 91/2025/QH15 (thông qua 26/06/2025) | 01/01/2026 — cần pháp chế xác minh | hồ sơ nhân viên, ứng viên, khách liên hệ; dữ liệu nhạy cảm (định vị): đồng ý, ĐGTĐ, thông báo vi phạm 72 giờ | <https://vanban.chinhphu.vn/?pageid=27160&docid=214590> |
| Nghị định 356/2025/NĐ-CP (31/12/2025; thay NĐ 13/2023/NĐ-CP) | 01/01/2026 — cần pháp chế xác minh; số điều lệch giữa các bản chép | hồ sơ đánh giá tác động (Mẫu 09/10), thông báo vi phạm (Mẫu 08), cập nhật hồ sơ 6 tháng/10 ngày | <https://vanban.chinhphu.vn/?pageid=27160&docid=216387> |
| Bộ luật Lao động số 45/2019/QH14 (Điều 107 làm thêm giờ; nghỉ phép) | cần pháp chế xác minh | giới hạn và đồng ý OT, nghỉ phép, thời giờ làm việc ở SPEC-attendance | <cần xác minh URL> |
| Luật An ninh mạng số 116/2025/QH15 | 01/07/2026 — cần pháp chế xác minh | nghĩa vụ bảo vệ hệ thống thông tin (xác định cấp độ — chưa đánh giá) | <https://thuvienphapluat.vn/van-ban/Cong-nghe-thong-tin/Luat-An-ninh-mang-2025-so-116-2025-QH15-666020.aspx> |

Việc còn mở (người làm): pháp chế chốt thời hạn lưu từng loại dữ liệu (D-016 là mặc định thận trọng); xác nhận căn cứ pháp lý thu GPS; hoàn tất [docs/DPIA.md](docs/DPIA.md); quy trình thông báo vi phạm ở [docs/ops/runbooks/data-breach.md](docs/ops/runbooks/data-breach.md).

## 11. Dữ liệu test
- **Cấm** dump/export dữ liệu production (hay bản sao có dữ liệu thật) trong repo, CI, staging hoặc máy dev; không dán dữ liệu thật vào issue/PR/log (QA-DATA-001).
- Fixture/seed chỉ dùng dữ liệu giả: email ở domain dành riêng (`example.test`, `example.com`, `example.org`) hoặc `+tag`; số điện thoại chỉ là số mẫu ghi trong chính sách.
- Chính sách và script quét: [docs/compliance/test-data-policy.md](docs/compliance/test-data-policy.md); kiểm bằng `npm run -s check:docs`.
