# PROGRESS.md — X-Company

> Giai đoạn hiện tại: G5 Build (autopilot) · Cập nhật: 2026-10-18 07:10 UTC · Nhánh: claude/focused-cannon-3iu4lk

## Đang làm
- `T-015` Dự án/hạng mục/task, máy trạng thái, lịch sử, khoá lạc quan — trạng thái: chuẩn bị code — chỗ dừng: lát 5 bắt đầu
- PR lát 2 (đuôi) + 3 + 4 (T-007…T-014) — trạng thái: chờ CI / chờ chủ dự án merge (ngoại lệ cứng: auth)

## Tiếp theo
1. `T-015` Dự án/task (Gate: `npm run -s test:file -- tests/db/tasks.test.ts`)
2. `T-016` Tiến độ 3 con số, ví dụ 35% (Gate: `npm run -s test:file -- tests/unit/progress.test.ts tests/db/assign-warning.test.ts`)
3. `T-017` Tệp private + bình luận; `T-018` giờ dự án; lát 6 PWA; lát 7 dashboard + E2E
4. Cổng sắp tới: G7 — còn thiếu: E2E đầy đủ, tick blueprint kèm `— Kiểm:`, GO-NO-GO

## Quyết định
- 2026-10-18 D-001…D-011 tự duyệt — `docs/autopilot/DECISIONS.md` (repo mới cùng stack XBOSS; Argon2id; một ứng dụng; tự host; PLAN; giá trị ca/OT là cấu hình có hiệu lực; I3 thu hẹp)
- 2026-10-18 ESLint có kiểu `no-floating-promises` sau lỗi quên `await` hàm kiểm quyền (đã sửa trước commit)
- Nợ kỹ thuật chấp nhận: đính kèm tệp ở form liên hệ — làm cùng T-017; advisory `braces` (dev) — chờ bản sửa (D-008)

## Bàn giao phiên
- Commit cuối trên nhánh chính: `ea5fa9a77bc28a5fa40d756c46f61451f7884336` (PR #4 + nâng khung 3.0.1) · CI: xanh trên PR #4
- Lệnh kiểm nhanh: `.xtemplates/scripts/dev-task.sh gate` → exit 0 lúc 07:05
- Đang chặn: không
- Việc dở chưa commit: không
- Câu hỏi cần người: merge các PR chạm auth/mật mã (ngoại lệ cứng) — chủ dự án seeker19110
