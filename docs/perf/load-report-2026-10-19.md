---
title: Báo cáo đo tải cục bộ — X-Company (2026-10-19)
updated: 2026-10-19
status: ĐẠT ngân sách dev — faithful-fixture, máy dev (sinh bằng `npm run -s perf:load`; không sửa tay)
---

# Đo hiệu năng dưới tải cục bộ (T-049, QA-PERF-006)

> **Nhãn bằng chứng: faithful-fixture.** Bộ tải tự viết (node:http, keep-alive) chạy cùng máy với ứng dụng (`next start` bản build production) và Postgres tạm,
> dữ liệu seed. **Không phải** số đo production/thực địa; bộ phát tải và máy chủ tranh CPU của cùng một máy nên số RPS là cận dưới.

## 5 trường QA-PERF-006

| Trường | Giá trị |
|---|---|
| Commit | `ee5badc0d08dfd98f9c088772ef4bea2384392bb+dirty` |
| Môi trường | máy dev (Linux 6.18.44-fc-v139 x64); Node v22.22.0; Next 16.4.2 `next start` bản build production; psql (PostgreSQL) 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1); app chạy bằng role không superuser; DB_POOL_MAX=10 (mặc định) |
| Thiết bị/mạng | 4 x Intel(R) Xeon(R) Processor @ 2.10GHz, 16 GiB RAM; bộ phát tải cùng máy; mạng loopback 127.0.0.1 (không mô phỏng băng thông/độ trễ) |
| Tải | 16 kết nối keep-alive (ghi: 8), 12 s đo + 3 s khởi động mỗi kịch bản (OT: 120 request cố định); dữ liệu seed e2e + 1500 liên hệ |
| Ngày | 2026-10-19 |

## Kết quả theo kịch bản

| Kịch bản | Kết nối | Thời lượng | Mẫu | RPS | p50 ms | p95 ms | p99 ms | Lỗi | Kết nối DB tối đa | Ngân sách (p95 / lỗi) | Kết quả |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Trang công khai (/, /dich-vu, /lien-he, /dich-vu/tu-van-thiet-ke) | 16 | 12s (+3s khởi động) | 2242 | 186.4 | 83.4 | 110.2 | 126.2 | 0 (0.00%) | 10 | ≤ 400 ms / ≤ 1.0% | **ĐẠT** |
| GET /api/readyz | 16 | 12s (+3s khởi động) | 11313 | 941.7 | 16 | 25.8 | 32.4 | 0 (0.00%) | 10 | ≤ 150 ms / ≤ 1.0% | **ĐẠT** |
| Nhân viên đọc (today, tasks, approvals) | 16 | 12s (+3s khởi động) | 2675 | 222 | 69.7 | 134.1 | 159.7 | 0 (0.00%) | 10 | ≤ 500 ms / ≤ 1.0% | **ĐẠT** |
| Ghi chấm công (POST /api/app/attendance/events) | 8 | 12s (+3s khởi động) | 2303 | 191.6 | 37.8 | 70.2 | 107 | 0 (0.00%) | 10 | ≤ 1000 ms / ≤ 1.0% | **ĐẠT** |
| Tạo đơn OT có Idempotency-Key (POST /api/app/ot-requests) | 8 | 120 request (+3s khởi động) | 120 | 246 | 30.2 | 48.9 | 76.3 | 0 (0.00%) | 8 | ≤ 1000 ms / ≤ 1.0% | **ĐẠT** |
| Phát lại Idempotency-Key (POST /api/app/ot-requests) | 8 | 12s (+3s khởi động) | 4350 | 361.9 | 20.3 | 34 | 43.3 | 0 (0.00%) | 8 | ≤ 500 ms / ≤ 1.0% | **ĐẠT** |
| Danh sách phân trang (tasks, inquiries ≥ 1 500 hàng) | 16 | 12s (+3s khởi động) | 3545 | 294.3 | 52.4 | 75.9 | 92.7 | 0 (0.00%) | 10 | ≤ 500 ms / ≤ 1.0% | **ĐẠT** |

### Trang công khai (/, /dich-vu, /lien-he, /dich-vu/tu-van-thiet-ke)

- Mô tả: GET xoay vòng 4 trang SSR công khai, không cookie.
- Mã trạng thái: 200×2242; mong đợi: 200
- Ngân sách: trang SSR công khai: p95 ≤ 400 ms ở 16 kết nối trên 4 nhân dùng chung với bộ phát tải (mục tiêu LCP ≤ 2,5 s cần TTFB ≪ 1 s).

### GET /api/readyz

- Mô tả: Probe sẵn sàng (SELECT 1 trong hạn 2 s).
- Mã trạng thái: 200×11313; mong đợi: 200
- Ngân sách: readyz chỉ `SELECT 1`: p95 ≤ 150 ms; sai lệch lớn nghĩa là hàng đợi pool/CPU quá tải.

### Nhân viên đọc (today, tasks, approvals)

- Mô tả: Đăng nhập sẵn; GET /app/today, /api/app/tasks, /app/tasks (nv) và /api/app/approvals (tl) xoay vòng.
- Mã trạng thái: 200×2675; mong đợi: 200
- Ngân sách: đọc khu nội bộ (SSR hôm nay + API việc/duyệt): p95 ≤ 500 ms ở 16 kết nối.

### Ghi chấm công (POST /api/app/attendance/events)

- Mô tả: Vào ca/nghỉ/hết nghỉ/ra ca xen kẽ bởi 4 phiên (2 nhân viên), mỗi request khoá Idempotency riêng; chấp nhận 200/201 và 409 nghiệp vụ trình tự.
- Mã trạng thái: 201×2303; mong đợi: 200/201/409
- Ngân sách: SLO-2 (docs/ops/SLO.md): ghi chấm công p95 < 1 s — dùng NGUYÊN ngưỡng SLO, không nới cho máy dev.
- Ghi chú: Trình tự sự kiện xen kẽ có thể bị 409 nghiệp vụ — chấp nhận, không tính là lỗi hệ thống (xem mục mã trạng thái để biết có xuất hiện không); 5xx và lỗi mạng luôn là lỗi.

### Tạo đơn OT có Idempotency-Key (POST /api/app/ot-requests)

- Mô tả: 120 đơn, mỗi đơn một ngày nghiệp vụ riêng (trần OT theo ngày/tháng) và khoá riêng, 8 kết nối.
- Mã trạng thái: 201×120; mong đợi: 201/422
- Ngân sách: ghi nghiệp vụ có Idempotency-Key + kiểm hạn mức OT: dùng cùng ngưỡng p95 < 1 s của SLO ghi chấm công.
- Ghi chú: Chấp nhận 201 và 422 (vượt hạn mức nghiệp vụ theo tháng — luật hợp lệ); 5xx/lỗi mạng là lỗi.

### Phát lại Idempotency-Key (POST /api/app/ot-requests)

- Mô tả: Cùng khoá + cùng thân (lần đầu → 201); các lần sau phải phát lại nguyên văn.
- Mã trạng thái: 201×4350; mong đợi: 201
- Ngân sách: phát lại Idempotency-Key (đọc bản ghi đã lưu): p95 ≤ 500 ms.

### Danh sách phân trang (tasks, inquiries ≥ 1 500 hàng)

- Mô tả: GET /api/app/inquiries?limit=50|200&offset lệch lên tới 1 400 (sales) xen /api/app/tasks?limit=50 (nv).
- Mã trạng thái: 200×3545; mong đợi: 200
- Ngân sách: danh sách phân trang (limit 50–200, offset lệch) trên ≥ 1 500 hàng: p95 ≤ 500 ms.

## Ngân sách và cách đo

- SLO gốc (docs/ops/SLO.md): SLI-2 ghi chấm công p95 < 1 s (95% ≤ 1 s/30 ngày); SLI-1 khả dụng 99,9% ⇒ tỉ lệ lỗi 5xx ≤ 0,1% (cổng ở đây dùng ≤ 1% theo `http_req_failed rate<0.01` của QA-PERF-002 vì mẫu ngắn).
- Ngân sách đặt TRƯỚC khi chạy trong `scripts/perf-load.mjs` (hằng `BUDGETS`) kèm lý do; ngưỡng ghi chấm công/OT dùng nguyên SLO, các ngưỡng còn lại là mục tiêu dev cho máy 4 nhân dùng chung với bộ phát tải. Nới ngưỡng sau khi thấy đỏ phải ghi lý do vào chính hằng này và báo cáo.
- Kết nối DB: ngân sách ≤ 12 (pool ứng dụng 10 + kết nối quản trị); đo toàn phiên = 10 — đạt.
- Lỗi = lỗi mạng/timeout hoặc mã ngoài tập mong đợi của kịch bản; 5xx luôn là lỗi.
- Độ trễ đo từ lúc gửi request tới khi nhận hết thân phản hồi (client cùng máy, loopback), không kèm mạng thật. Phân vị nearest-rank trên toàn bộ mẫu sau khởi động; không dùng trung bình làm cổng (XC-PERF-004).
- Khởi động (warm-up) không tính vào số liệu; số kết nối DB lấy mẫu mỗi 250 ms từ `pg_stat_activity` (role ứng dụng).

## Lighthouse cục bộ

Nguồn: `npm run -s lighthouse` (lhci 0.15.1, mobile, median 3 lần, throttling mô phỏng mặc định của Lighthouse), lần chạy 2026-10-19T03:17:36.595Z. Lighthouse 12.6.1; INP không đo được ở lab — TBT là proxy.

| URL | Điểm Performance | LCP ms | CLS | TBT ms (proxy INP) |
|---|---|---|---|---|
| / | 99 | 1741 | 0 | 127 |
| /dich-vu | 97 | 2330 | 0 | 130 |
| /lien-he | 98 | 1600 | 0 | 150 |

Ngưỡng cổng (lighthouserc.json): Performance ≥ 0,9 · LCP ≤ 2 500 · CLS ≤ 0,1 · TBT ≤ 300. Đây là số lab trên máy dev, không phải CWV p75 thực địa.

## Không chứng minh

- Core Web Vitals p75 và INP thực địa (RUM/CrUX) — cần người dùng thật trên production (FE-PERF-001, PRF-WEB-005).
- Mạng thật: đo qua loopback cùng máy, không có độ trễ/mất gói/TLS/CDN; số p95 trên mạng di động sẽ cao hơn.
- Tải đa máy/đa instance, autoscale, và hành vi khi Postgres ở máy khác (độ trễ mạng DB).
- Độ bền dài (soak ≥ 30 phút), spike đột ngột, rò bộ nhớ/kết nối theo thời gian (QA-PERF-011/012).
- Bộ phát tải và máy chủ chia sẻ CPU của một máy 4 nhân: RPS là cận dưới, p99 chịu ảnh hưởng của bộ phát tải.
- Dữ liệu ở quy mô production (chỉ ~1 500 liên hệ + seed e2e); kế hoạch truy vấn trên dữ liệu lớn xem docs/db/explain/.
