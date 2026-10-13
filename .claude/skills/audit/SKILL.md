---
name: audit
description: Audit toàn diện dự án theo blueprint + 12 nhóm (kiến trúc, bảo mật, chất lượng mã, test, hiệu năng, a11y/UX, dependency, CI/CD, tài liệu, dữ liệu, cấu hình, thống nhất chéo tính năng); lưu tiến độ để quét lại hoặc tiếp tục; DỪNG CHỜ DUYỆT trước khi sửa. Dùng khi người dùng muốn rà lỗi toàn diện, kiểm tra toàn bộ, hoàn thiện dự án, hoặc gõ /audit.
argument-hint: "[full|group:<tên>|resume]"
---

# /audit — rà toàn diện, bằng chứng trước, sửa sau khi duyệt

## Bước -1 — Chống audit "khung trống"
Đọc repo thật: có code chưa? stack gì? CI chạy gì? test có không? Nếu repo chỉ có khung/tài liệu → nói rõ, audit tài liệu + cấu hình, không bịa phát hiện về code không tồn tại.

## Bước 0 — Tiến độ
File `docs/ops/AUDIT-STATUS.md`: nhóm nào đã quét, SHA lúc quét, phát hiện mở/đóng. Có file → hỏi/ quyết "quét lại từ đầu" hay "tiếp tục nhóm chưa xong"; SHA cũ phải là tổ tiên HEAD, không thì quét lại.

## Bước 1 — Theo blueprint
`/blueprint audit`: mỗi mục MUST/SHOULD mở → phát hiện có ID (vd `SEC-WEB-004`), bằng chứng *đo được/suy luận/chưa biết*.

## Bước 2 — 12 nhóm (mỗi nhóm: lệnh chạy thật → phát hiện → mức)
| # | Nhóm | Chạy/đọc gì |
|---|---|---|
| 1 | Kiến trúc & ranh giới | dependency-cruiser/import-linter/ArchUnit; C4 vs code; module vòng |
| 2 | Bảo mật | SAST (CodeQL/Semgrep), gitleaks full history, dependency audit, header, authz từng route, SSRF/IDOR, threat model còn hợp lệ |
| 3 | Chất lượng mã | lint 0 cảnh báo, type strict, complexity, dead code (knip), trùng lặp (jscpd), TODO/FIXME |
| 4 | Test | coverage theo module quan trọng, ca biên, flaky, mutation nếu có, test có assert thật |
| 5 | Hiệu năng | CWV/Lighthouse hoặc p95/k6, N+1, index, bundle, cache |
| 6 | A11y & UX | axe 0 critical, bàn phím, tương phản 2 theme, 4 trạng thái, mobile |
| 7 | Dependency | lockfile, EOL (endoflife.date), license, major lạc hậu, ghim SHA action |
| 8 | CI/CD | required check thật, permissions, secret, cache, thời gian, fail-open |
| 9 | Tài liệu | README chạy được, ADR cập nhật, runbook, link gãy, SHA PROGRESS là tổ tiên HEAD |
| 10 | Dữ liệu | migration có đường lùi, backup đã thử khôi phục, PII map, xoá theo yêu cầu, timestamptz, tiền số nguyên |
| 11 | Cấu hình/secret | env validate lúc khởi động, không secret trong code/log, cấu hình theo môi trường, fail-closed |
| 12 | Thống nhất chéo tính năng | cùng một khái niệm một cách xử lý (lỗi, phân trang, quyền, i18n, thời gian); tính năng A phá B? |

Mức: 🔴 chặn phát hành · 🟠 sửa trong đợt này · 🟢 nợ có chủ. Mỗi phát hiện: ID, bằng chứng (file:dòng/lệnh+output), đề xuất sửa, Gate kiểm.

## Bước 3 — DỪNG CHỜ DUYỆT
Xuất `docs/ops/AUDIT-REPORT-<ngày>.md` + cập nhật AUDIT-STATUS. Trình kế hoạch sửa theo đợt (mỗi đợt ≤ 1 PR, bug có test tái hiện trước khi sửa). **Không sửa trước khi người duyệt** (trừ khi đang trong autopilot đã duyệt trước và phát hiện thuộc phạm vi PLAN).

## Bước 4 — Vòng hội tụ (sau duyệt)
Sửa → qua `/gate` → quét lại nhóm liên quan → lặp đến khi không còn 🔴/🟠 đã biết → ghi Definition of Complete đạt + bằng chứng.
