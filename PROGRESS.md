---
title: Tiến độ xây dựng khung X-stored
kind: progress
updated: 2026-10-13
---

# PROGRESS — Khung tham chiếu phát triển phần mềm X-stored

> File trạng thái để **phiên sau tiếp tục đúng chỗ**. Cập nhật sau mỗi mốc. Phiên mới: đọc mục
> "Bàn giao phiên" trước, rồi "Kế hoạch".

## Yêu cầu gốc (người dùng, 2026-10-13)

Nghiên cứu repo `stored` (+ internet) và tạo **một bộ khung** để mọi phần mềm sau này tham khảo và áp dụng:

1. Những gì **mọi phần mềm** đều cần
2. Phân theo **loại phần mềm** (web app, mobile, AI agent, agentic, …)
3. **Chuyên dụng theo ngành nghề**
4. **Tiêu chuẩn**
5. **Kiến trúc**
6. **Design, UI/UX**
7. **Frontend**
8. **Backend**
9. **Database**
10. **Workflow**
11. **Loop** (vòng lặp tự động)
12. **Bảo mật**
13. Thành phần khác còn thiếu (AI engineering, testing, vận hành, tuân thủ/pháp lý, sản phẩm, i18n, hiệu năng, license…)

Mục tiêu: **khi yêu cầu được duyệt thì tự động làm đến khi hoàn thiện, không cần hỏi**; chất lượng cao nhất.
Ràng buộc vận hành: **khi giới hạn sử dụng đạt ~95% → commit + push tất cả, ghi bàn giao** để chạy tiếp ở phiên khác.

## Kế hoạch (đã chốt — chạy tự động)

| # | Hạng mục | Trạng thái |
|---|---|---|
| P0 | Nghiên cứu: khung cũ (commit `1b80fe4`), `seeker19110/stored`, `seeker19110/projects-template`, internet (tiêu chuẩn chung, AI agent, ngành nghề, stack 10/2026, kiến trúc/UI/DB/workflow) → `research/` | đang chạy |
| P1 | Lõi: `framework/00-method/` (nguyên tắc, vòng đời, quy ước module, ghép blueprint, chống ảo giác) + `scripts/xs.py` (validate / compose / blueprint-status / loop) + test | đang làm |
| P2 | Nội dung 01–18: baseline, profiles, industries, standards, architecture, design-ux, frontend, backend, database, workflow, autonomous-loop, security, ai-engineering, testing, operations, compliance, product, cross-cutting | chưa |
| P3 | Harness tự động: `AGENTS.md`, `CLAUDE.md`, `.claude/skills` (autopilot, blueprint, gate, audit, research, adr), `.claude/agents`, hooks (stop-guard có trần vòng, chặn lệnh nguy hiểm, session-resume), `settings.json` | chưa |
| P4 | CI (`.github/workflows/ci.yml`: validate + test + markdownlint, action ghim SHA, `permissions:`), ruleset mẫu, PR template, Dependabot, `scripts/install.sh` | chưa |
| P5 | Kiểm toàn bộ (validate xanh, test xanh, compose mẫu), README/CHANGELOG, cập nhật PR #10 | chưa |

## Quyết định

- Xây lại trên nhánh `claude/kind-einstein-ilz51h` (PR #10 — vốn là PR xoá toàn bộ). PR #10 sẽ thành "xoá khung cũ + thêm khung mới".
- Ranh giới 3 repo: `stored` = catalog repo ngoài; `projects-template` = harness quy trình drop-in đầy đủ; **X-stored = khung tri thức tham chiếu** (checklist có ID, hồ sơ loại phần mềm, gói ngành, tiêu chuẩn) + harness tự động gọn. Dùng chung được với `projects-template`.
- Checklist có **ID ổn định** + mức **MUST/SHOULD/MAY** (+ ngưỡng quy mô `@M`/`@L`) để máy ghép thành `BLUEPRINT.md` cho từng dự án và kiểm "hoàn thiện" bằng máy.
- "Xong" do **máy xác nhận** (bằng chứng lệnh chạy thật do script ghi), không do model tự khai.

## Bàn giao phiên

- **Đang làm:** P0 (agent nghiên cứu chạy nền) + P1 (viết quy ước & `xs.py`).
- **Bước kế tiếp cụ thể:** hoàn tất `framework/00-method/conventions.md` + `scripts/xs.py` + `tests/`; rồi giao viết nội dung P2 theo quy ước.
- **Khôi phục khung cũ để tham khảo:** `git archive 1b80fe4 | tar -x -C <thư-mục>`.
