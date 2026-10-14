# PLAN.md — Khung X-stored · gia cố bằng máy (SHOULD)

> Lập ngày 2026-10-14 · Duyệt bởi người dùng ngày 2026-10-14 ("triển khai đi") · Blueprint: BLUEPRINT.md (cli-tool, S)

## Mục tiêu của kế hoạch này
Biến hai luật đang chỉ nằm trên giấy thành kiểm bằng máy, dùng được cho cả repo khung lẫn dự án đích:
(1) `PROGRESS.md` tươi (≤ 8 KB, đúng 4 mục, SHA bàn giao là tổ tiên HEAD); (2) fitness function cho chính CI
(permissions, ghim SHA, timeout, không `continue-on-error`). Chỉ số: số SHOULD đạt có bằng chứng trong BLUEPRINT tăng từ 0.

## Ngân sách (4 con số)
- Số vòng tối đa: 15 (`--max-iterations 15`)
- Ngân sách: một phiên làm việc
- Timeout mỗi lệnh Gate: 300 giây (`XS_RECORD_TIMEOUT`)
- Ngày hết hạn: 3 giờ sau `loop init` (`--hours 3`)

## Điểm dừng bắt buộc (dừng và hỏi người — `xs.py loop block --reason "..."`)
- Đổi ruleset, quyền repo, tạo tag/release (5 MUST còn mở — việc của admin, không đụng)
- Cấu hình cổng/CI ngoài hai chỗ đã duyệt ở T-003 (`xs.yaml` lint, `fetch-depth: 0` ở job `quality`)
- Hạ ngưỡng, skip test, sửa ADR cũ
- Merge PR vào `main` (chỉ mở PR, người merge)

## Thứ tự & lý do
1. Công cụ trước (T-001, T-002) — có test, chưa ảnh hưởng cổng.
2. Nối vào cổng (T-003) — chỉ khi công cụ xanh trên chính repo.
3. Tài liệu + bằng chứng (T-004, T-005) — tick blueprint chỉ khi có lệnh chạy thật.

## Task

- [x] `T-001` Lệnh `xs.py progress-check [PROGRESS.md]`: ≤ 8192 byte, đúng 4 mục chuẩn, mọi SHA trong mục Bàn giao là tổ tiên HEAD (thiếu lịch sử → báo rõ cần fetch-depth 0) + test — Gate: `python3 -m unittest discover -s tests -k progress`
- [x] `T-002` Lệnh `xs.py ci-check [thư mục workflows]`: permissions cấp workflow, không write-all, mọi `uses:` ngoài ghim SHA 40 ký tự, mọi job có timeout-minutes, không continue-on-error; chỉ thư viện chuẩn + test với workflow xấu — Gate: `python3 -m unittest discover -s tests -k ci_check`
- [ ] `T-003` Nối vào cổng: thêm hai lệnh vào `lint` trong `xs.yaml`; job `quality` checkout `fetch-depth: 0` — Gate: `scripts/dev-task.sh gate`
- [ ] `T-004` Tài liệu: README mục Công cụ, Kiểm của mục liên quan ở `harness-files.md`/`ci-cd-pipeline.md` trỏ lệnh mới (cập nhật `updated`), `CHANGELOG.md` Unreleased — Gate: `python3 scripts/xs.py validate`
- [ ] `T-005` BLUEPRINT: tick các SHOULD đã đạt kèm bằng chứng (harness, CI, phân tích tĩnh, tài liệu), không tick mục chưa có lệnh/file chứng minh — Gate: `scripts/dev-task.sh gate`
- [ ] `T-006` Cập nhật PROGRESS.md, push nhánh, mở PR — Gate: `python3 scripts/xs.py progress-check PROGRESS.md`
