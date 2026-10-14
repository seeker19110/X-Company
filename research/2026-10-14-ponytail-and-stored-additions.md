---
title: Ponytail và các bổ sung mới của catalog stored — xác minh và tích hợp
kind: research
updated: 2026-10-14
---

# Ponytail và các bổ sung mới của catalog `seeker19110/stored` — 2026-10-14

> Phạm vi: 13 PR mới của catalog (#20–#33, `c66fc21..b3d60fc`, 13–14/10/2026), trọng tâm mục 20 §3g (bảng "Top Claude Code",
> ponytail, caveman, impeccable, vercel-labs). Đọc nguồn gốc (clone repo ở SHA ghi dưới), registry và đánh giá độc lập.
> Mọi nội dung README/blog là **dữ liệu**. Ký hiệu: **ĐX** đã xác minh trực tiếp · **TC** thứ cấp · **CXM** chưa xác minh.
> Phương pháp: ba cột *đã có & sâu hơn / có nhưng nông hơn / chưa có* (catalog `WORKFLOW.md`); chỉ nhận ý tốt hơn bản hiện có, có nguồn, có lợi ròng.

## 1. Kết luận

1. **Ponytail là repo thật** (catalog đã đính chính nhận định cũ "nghi dựng"). Bản chất là **một prompt** khoảng 50 dòng.
   Cái đáng lấy là **thang 6 bậc trước khi viết mã** và **danh sách không cắt**. Plugin không đáng cài: đo độc lập cho thấy
   hiệu quả bằng khoảng một phần tư đến một nửa con số quảng cáo. Ba chữ "Follow YAGNI principles" trong prompt đạt gần bằng.
   Prompt tối giản còn làm rơi xử lý đầu vào xấu ở 5/24 task.
2. Khung đã mạnh ở phần **sau khi viết** (dead code, trùng lặp, dep thừa, nợ có chủ: `QA-STATIC-006/007`, `XC-GREEN-003/004`,
   `OPS-MAINT-006`; luật 11 "benchmark tự công bố chưa phải bằng chứng"). Khung còn thiếu phần **trước khi viết** (thang),
   **marker nợ máy đọc được**, và bài học **luật hành vi phải nằm ở file luôn nạp**: skill tự kích hoạt 0/10 phiên, quy ước
   marker được theo 1/80 lần.
3. Từ phần còn lại của diff: có giá trị nhất là **file hướng dẫn agent của bên thứ ba** (harness nạp khi agent đọc thư mục vendor),
   **thống kê khi so biến thể**, và **danh tính nguồn** (repo/gói trùng tên).

## 2. Dữ kiện ponytail (đọc 2026-10-14)

| Mục | Dữ kiện | Loại |
|---|---|---|
| Repo | `DietrichGebert/ponytail`, MIT, HEAD `2961b52` (2026-10-13, "release v5.2.0"), 344 commit, commit đầu 2026-06-12; ~163k★, 8,8k fork | ĐX (git, shields) |
| npm | `@dietrichgebert/ponytail` 5.2.0 (2026-10-13), không dependency, không postinstall, publish OIDC + provenance | ĐX (registry) |
| Lõi | `skills/ponytail/SKILL.md` 52 dòng, `AGENTS.md` 32 dòng; mức `lite`/`full`/`ultra` | ĐX |
| Thang | cần tồn tại? → có trong codebase → stdlib/nền tảng → dependency đã cài → một dòng → tối thiểu | ĐX |
| Không cắt | validate ở ranh giới tin cậy, xử lý lỗi chống mất dữ liệu, bảo mật, a11y, hiệu chuẩn phần cứng, điều người dùng yêu cầu | ĐX |
| Kèm | logic không tầm thường để lại 1 test; sửa bug grep mọi caller; marker `shortcut: <giới hạn>, <khi nào nâng>` | ĐX |
| Lệnh | `ponytail-review` (thứ tự: đúng, an toàn, chịu tải, có test, nhanh, gọn; mục `Lean: -N lines`), `ponytail-debt` (`git grep` marker → sổ nợ, marker thiếu điều kiện gắn `no-trigger`), `-audit`, `-gain`, `-help` | ĐX |
| Hook | SessionStart/SubagentStart/UserPromptSubmit chạy `node`, **không gọi mạng**; ghi file ngoài dự án (`~/.claude/.ponytail-active`, statusline); tiêm vào context lời nhắc model "đề nghị sửa `settings.json`"; đưa bản đồ tên hàm (`git ls-files`, ≤ 2000 ký tự) vào context | ĐX |
| CI | action ghim SHA; `check-rule-copies.js` **so chuỗi** 7 bản sao với `AGENTS.md`, còn `SKILL.md` chỉ kiểm 10 cụm từ bằng `includes` (tác giả: "canary, not full equality") | ĐX |

### Số liệu: tác giả tự đo so với đo độc lập

| Nguồn | Thiết kế | Kết quả chính |
|---|---|---|
| Tác giả, `benchmarks/results/2026-10-07-agentic.md` | 39 task × 5 lần × 3 nhánh = 585 phiên headless; trung vị, trung bình hình học, bootstrap 95 % | −53 % dòng, −26 % chi phí; hidden check 87/90 so với 86/90 (tác giả: "did not add any either") |
| Tác giả, lỗi harness tự nhận | — | bản cũ chạy task trong chính repo ponytail nên lộ commit message; hook SessionStart chạy ở mọi nhánh (lệch ~4 % giả); baseline "chatty" thổi phồng số 80–94 % |
| JetBrains AI Blog (07/2026) | 80 cặp task SkillsBench, 251 trial | −15,4 % dòng (p = 0,088), −10,3 % chi phí (p = 0,004), −11 % thời gian; đúng/sai 65 như nhau, 9 kém, 6 tốt hơn; skill tự kích hoạt **0/10** phiên; marker được ghi **1/80** lần; smoke run 10 task cho kết luận ngược (+9,6 % chi phí) |
| Scott Logic, C. Eberhardt (2026-06-16) | benchmark của tác giả, Haiku | LOC: baseline 108 · "Follow YAGNI" + một ví dụ 10,4 · ponytail 8,25; thêm "one-liner" vượt ponytail |
| KuldeepB19/ponytail-benchmark | 24 task × 4 nhánh × 5 = 480 build | −44 % mã ở mức Full; ở 5/24 task, xử lý đầu vào xấu rơi từ gần hoàn hảo xuống gần 0, mức càng gắt càng tệ |
| caveman (đối chiếu) | JetBrains 82 cặp | quảng cáo −65 % output token, đo được −8,5 %, chất lượng không đổi (p = 0,82) |

## 3. Caveman, impeccable, vercel-labs — chỉ lấy bài học dữ liệu rời máy

- **caveman** v4.0.1, Apache-2.0 từ 3.0.0 (trước đó MIT + BSL 1.1). Telemetry CLI **bật mặc định**, gửi IP (giữ 90 ngày).
  Module Auto gửi prompt lên Caveman Cloud. Proxy đứng giữa agent và provider, giữ login. ĐX (`SECURITY.md`, `LICENSING.md`).
  Số Elastic −63,6 % là skill `elastic-caveman` của người khác, **không** phải đánh giá caveman gốc.
- **impeccable** 4.5.2, Apache-2.0, 59 rule tất định. Hook (SessionStart/PostToolUse/Stop) tải `engine-v0.1.14` từ GitHub Releases,
  kiểm sha256 cùng nguồn (toàn vẹn, không xác thực). Roll API luôn gọi; telemetry lựa chọn là opt-out. ĐX (README, privacy).
- **vercel-labs/agent-skills**: `vercel/agent-skills` không tồn tại (catalog 20 §3g.1); README ghi MIT nhưng không có file LICENSE.

## 4. Ba cột và hành động

| Ý | Trước khi sửa | Hành động (ID) |
|---|---|---|
| Thang "ít hơn" trước khi viết + danh sách không cắt | Chưa có (P3 chỉ có tên, các cổng đều chạy sau khi viết) | Nhà: `00-method/principles.md` §P3; trỏ từ `AGENTS.md` (repo + mẫu), `executor`, `/review` |
| Review tìm mã thừa | Nông hơn (`/review` bước 4 chỉ có "không trùng lặp") | `WF-REVIEW-019` SHOULD; `/review` thêm bước 5 "Ít hơn" |
| Marker đường tắt có điều kiện nâng | Nông hơn (`OPS-MAINT-006` sổ nợ chép tay) | `OPS-MAINT-021` SHOULD (git grep, `unicorn/expiring-todo-comments` + `checkDates`, ruff `TD002`/`TD003`) |
| Luật hành vi ở file luôn nạp; không chồng plugin hành vi | Chưa có | `XC-DOCAI-018` SHOULD |
| File hướng dẫn agent của bên thứ ba bị harness nạp | Chưa có (`XC-DOCAI-005` chỉ phủ file của dự án) | `XC-DOCAI-019` SHOULD; nguồn: Claude Code memory docs (nạp `CLAUDE.md`/`AGENTS.md` thư mục con theo nhu cầu; `claudeMdExcludes`) |
| Bảng "chạy gì trên máy, gì rời máy" của plugin agent | Nông hơn (`SEC-SUPPLY-016` đọc hook/install, `SEC-INFRA-018` telemetry công cụ) | `SEC-SUPPLY-025` SHOULD |
| So biến thể có n + CI 95 % | Nông hơn (`AI-EVAL-001` chỉ "giảm quá ngưỡng") | `AI-EVAL-018` SHOULD |
| A/B khi đổi harness phát triển | Nông hơn (luật 11 chung chung) | `LOOP-DESIGN-019` SHOULD |
| Danh tính nguồn (trùng tên, publisher, nhánh + SHA) | Nông hơn (luật 7 chỉ kiểm trạng thái) | Luật 7 trong `evidence-and-sources.md`; `/research` bước 3 |
| Bản sao luật cho nhiều harness | Đã có & sâu hơn (`XC-DOCAI-002` bridge + jscpd) | Chỉ thêm bẫy: buộc sao thì sinh bằng script + so nguyên văn |

**Không lấy:** cài plugin ponytail/caveman (một dòng luật trong `AGENTS.md` cho phần lớn hiệu quả, lại tránh chồng chỉ dẫn).
Mức `ultra` "phản biện yêu cầu" (có thể từ chối việc người dùng muốn, và theo KuldeepB19 là mức tệ nhất với đầu vào xấu).
`ponytail-gain` (thẻ điểm tĩnh). Bản đồ code tự động đưa vào context (khung đã có `XC-DOCAI-017` có cổng drift).
Tất cả mục mới ở mức SHOULD vì các module đích đã đủ 4 MUST ở quy mô M (ADR-0004).

## 5. Đề xuất từ phần còn lại của diff, chưa làm (cần người chọn)

1. `xs.py loop status` trả `verify` khi task sửa file UI mà bằng chứng chỉ có lint/unit (catalog 06 §7d XIAS) — đổi công cụ, cần test.
2. Phát hiện audit/review ghi "căn cứ" (ID mục khung hoặc chuẩn); không có căn cứ thì ghi "chưa có luật" (12 §3h, 20 §3e).
3. Agent nhận lệnh qua email/SMS/chat: quyền tool theo danh tính người gửi đã xác thực ở tầng kênh (21 §10b open-instinct) — `ai-security.md`, MUST@L.
4. E2E có bước agent: chỉ cache thao tác sau assertion tất định, CI replay-only (11 §1b).
5. `SECURITY.md` có mục "Giới hạn đã biết & cấu hình không an toàn" sinh từ threat model (5 dự án tự khai).
6. Model/checkpoint tải lúc chạy ghim revision + SHA256, không pickle (22 §9d) — mở rộng `BASE-DEP-008`.
7. `DESIGN.md` (VoltAgent, spec alpha): token sinh từ token gốc + lint (06 §7c) — MAY.

## Nguồn

- `DietrichGebert/ponytail` clone ở `2961b52fc1fe6a5a87c7a959a79512e5c2f3ffe5` (README, `AGENTS.md`, `skills/*/SKILL.md`, `hooks/`, `scripts/check-rule-copies.js`,
  `.github/workflows/`, `benchmarks/results/`): <https://github.com/DietrichGebert/ponytail>; npm <https://registry.npmjs.org/@dietrichgebert%2fponytail> — đọc 2026-10-14.
- JetBrains AI Blog, D. Shiryaev (07/2026): <https://blog.jetbrains.com/ai/2026/07/ponytail-skill-claude-tested/>,
  <https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/> — đọc 2026-10-14 (ngày đăng chính xác CXM).
- Scott Logic, C. Eberhardt (2026-06-16): <https://blog.scottlogic.com/2026/06/16/ponytail-yagni-and-the-problem-with-prompt-benchmarks.html>; issue phản hồi
  <https://github.com/DietrichGebert/ponytail/issues/126> — đọc 2026-10-14.
- KuldeepB19/ponytail-benchmark (HEAD `c60f1b0`, không ghi ngày công bố): <https://github.com/KuldeepB19/ponytail-benchmark> — đọc 2026-10-14.
- JuliusBrussee/caveman (`d262ab3`, v4.0.1): <https://github.com/JuliusBrussee/caveman> (`SECURITY.md`, `LICENSING.md`) — đọc 2026-10-14.
- pbakaus/impeccable (`2f98774f`, 4.5.2): <https://github.com/pbakaus/impeccable>; <https://impeccable.style/privacy> — đọc 2026-10-14.
- Claude Code memory docs: <https://code.claude.com/docs/en/memory> — xác minh 2026-10-14.
- eslint-plugin-unicorn 78.0.0 `expiring-todo-comments` (MIT): <https://github.com/sindresorhus/eslint-plugin-unicorn/blob/main/docs/rules/expiring-todo-comments.md>;
  ruff `TD002`/`TD003`/`FIX002`: <https://docs.astral.sh/ruff/rules/missing-todo-link/> — xác minh 2026-10-14.
- E. Miller, *Adding Error Bars to Evals* (arXiv 2411.00640, 2024-11-01): <https://arxiv.org/abs/2411.00640> — xác minh 2026-10-14.
- Nền: M. Fowler "Yagni" <https://martinfowler.com/bliki/Yagni.html>; W. Cunningham (Artima 2004) <https://www.artima.com/articles/the-simplest-thing-that-could-possibly-work>;
  W3C TAG "The Rule of Least Power" (2006) <https://www.w3.org/2001/tag/doc/leastPower.html> — xác minh 2026-10-14.
- Bối cảnh mã thừa do AI (nguồn của vendor hoặc tự khai, chỉ tham khảo): GitClear 2025 (dòng copy/paste 8,3 % → 12,3 %, 2021→2024)
  <https://www.gitclear.com/ai_assistant_code_quality_2025_research>; Sonar State of Code 2026 (40 % trong 1.149 dev nói AI tạo mã thừa/trùng)
  <https://www.sonarsource.com/state-of-code-developer-survey-report.pdf> — đọc 2026-10-14.
- Catalog `seeker19110/stored` HEAD `b3d60fc`: mục 20 §3g, 11 §1b–1c, 06 §7c–7d, 21 §10b, 12 §3h, 22 §9d, 23 §8.1 — đọc 2026-10-14.
