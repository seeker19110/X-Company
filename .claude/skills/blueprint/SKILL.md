---
name: blueprint
description: Ghép hoặc cập nhật BLUEPRINT.md cho dự án từ khung X-stored (hồ sơ + gói ngành + quy mô), audit hiện trạng theo blueprint và báo tiến độ MUST/SHOULD. Dùng ở G1, khi khung cập nhật, hoặc khi người dùng hỏi "dự án còn thiếu gì".
argument-hint: "[compose|status|audit] [--profile p --industry i --scale M]"
---

# /blueprint — checklist có ID cho dự án

`<XS>` = `python3 .xstored/scripts/xs.py` (dự án đích) hoặc `python3 scripts/xs.py` (repo khung).

## compose (G1)
1. `<XS> list profiles` / `<XS> list industries` → chọn **một** hồ sơ chính, 0..n ngành, quy mô theo bảng `00-method/composition.md`.
2. `<XS> compose --profile <p> [--industry <i>]... --scale <S|M|L> [--add <module-glob>]... --out BLUEPRINT.md`
   - `--add` khi dự án có nhu cầu ngoài hồ sơ (vd web app có tính năng AI → `--add "13-ai-engineering/*"`).
   - `--include-may` nếu muốn thấy cả mục MAY.
3. Commit `BLUEPRINT.md`. Không sửa chữ của mục; muốn đổi yêu cầu → PR vào khung rồi ghép lại.

## status
`<XS> blueprint-status BLUEPRINT.md [--strict]` — đếm đạt/miễn/chưa theo mức; `--strict` exit 1 khi còn MUST mở hoặc miễn trừ thiếu lý do. Dùng làm cổng phát hành (G7).

## audit (dự án có sẵn, hoặc định kỳ)
1. Với từng mục `[ ]`: **grep cổng đang chạy** (CI, hook, config, test) — không tin README. Có bằng chứng → `[x]` kèm ghi chú bằng chứng (file:dòng, job CI); không áp dụng → `[~] — Miễn: <lý do>`; còn lại giữ `[ ]`.
2. Xuất báo cáo: bảng mục MUST mở → đề xuất task (mỗi task có Gate máy kiểm) → đưa vào PLAN.md.
3. Phân loại bằng chứng: *đo được* / *suy luận* / *chưa biết* — không trình bày suy luận như đo được.

## Ghép lại khi khung cập nhật
`<XS> compose ... --out /tmp/BLUEPRINT.new.md` → so theo **ID** (ổn định) → chuyển trạng thái tick sang file mới → thay thế.
