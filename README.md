# X-stored — khung tham chiếu phát triển phần mềm

> Thư viện **yêu cầu có ID** cho mọi loại phần mềm và ngành nghề, kèm công cụ ghép thành checklist dự án, kiểm "xong" bằng máy,
> và harness để AI agent **tự làm đến khi hoàn thành** mà vẫn dừng đúng chỗ cần người.
> Nội dung tiếng Việt; phiên bản, chuẩn và luật xác minh từ nguồn sống ngày 2026-10-13.

## Có gì trong khung

| Mảng | Nội dung | Số file |
|---|---|---|
| [`00-method`](framework/00-method/README.md) | Nguyên tắc P1–P12, vòng đời G0–G8, quy ước module, cách ghép blueprint, luật bằng chứng | 5 |
| [`01-baseline`](framework/01-baseline/README.md) | Thứ **mọi** phần mềm đều cần: repo, cổng chất lượng, bảo mật tối thiểu, lỗi/log, cấu hình, tài liệu, đúng dữ liệu, phụ thuộc | 8 |
| [`02-profiles`](framework/02-profiles/README.md) | 14 hồ sơ loại phần mềm: web, mobile, desktop, site tĩnh, API, CLI, thư viện, data/ML, **AI agent**, **hệ agentic**, game, blockchain, IoT, monorepo | 14 |
| [`03-industries`](framework/03-industries/README.md) | 8 gói ngành có khung pháp lý Việt Nam + quốc tế: fintech, y tế, giáo dục, TMĐT, chính phủ, SaaS đa tenant, truyền thông, logistics | 8 |
| [`04-standards`](framework/04-standards/README.md) | Tiêu chuẩn: bảo mật, tiếp cận, API/web, dữ liệu, quy trình, AI — phiên bản hiện hành và cách chứng minh | 6 |
| [`05`](framework/05-architecture/README.md)–[`09`](framework/09-database/README.md) | Kiến trúc · Thiết kế & UI/UX · Frontend · Backend · Cơ sở dữ liệu | 34 |
| [`10-workflow`](framework/10-workflow/README.md) | Git, review, CI/CD, phát hành, môi trường, spec-driven, tài liệu, đội & WIP | 8 |
| [`11-autonomous-loop`](framework/11-autonomous-loop/README.md) | Vòng lặp tự động: 4 con số, bằng chứng, điểm dừng, điều phối subagent, tự sửa CI, ngân sách context | 6 |
| [`12-security`](framework/12-security/README.md) | Threat model, AppSec, bí mật, chuỗi cung ứng, hạ tầng, bảo mật AI, log & audit | 7 |
| [`13-ai-engineering`](framework/13-ai-engineering/README.md) | LLM app, RAG, agent & tool, hệ agentic, eval, guardrail, MCP/A2A, quan sát & chi phí, dữ liệu | 9 |
| [`14`](framework/14-testing-quality/README.md)–[`18`](framework/18-cross-cutting/README.md) | Kiểm thử · Vận hành · Tuân thủ & quyền riêng tư · Sản phẩm & dự án · Xuyên suốt (i18n, hiệu năng, DX, tài liệu cho AI, đơn vị/tiền/thời gian, bền vững, OSS) | 37 |
| [`templates`](framework/templates/README.md) | PROJECT, PLAN, PROGRESS, SPEC, ADR, THREAT-MODEL, RUNBOOK, POST-MORTEM, DPIA, GO-NO-GO, RELEASE-NOTES, API-CONTRACT, AGENTS, CLAUDE, xs.yaml | 15 |

Mỗi yêu cầu là một dòng có **ID ổn định**, mức **MUST/SHOULD/MAY**, cách **Kiểm** bằng máy và **Nguồn**:

```markdown
- [ ] `BE-AUTH-003` **MUST** Băm mật khẩu bằng Argon2id với tham số OWASP. → Kiểm: test đọc hash có tiền tố `$argon2id$`. · Nguồn: ASVS 5.0 V6
```

Chỉ mục đầy đủ theo vai đọc: [`framework/README.md`](framework/README.md).

## Dùng cho một dự án

```bash
# 1) Cài khung vào dự án (chỉ cần Python >= 3.11; không đè file đã có)
git clone https://github.com/seeker19110/X-stored /tmp/x-stored
python3 /tmp/x-stored/scripts/install.py /đường/dẫn/dự-án --with-github

# 2) Chọn hồ sơ, ngành, quy mô rồi ghép checklist
cd /đường/dẫn/dự-án
python3 .xstored/scripts/xs.py list profiles
python3 .xstored/scripts/xs.py compose --profile web-app --industry ecommerce --scale M --out BLUEPRINT.md

# 3) Theo dõi; --strict trả exit 1 khi còn MUST chưa đạt (dùng làm cổng phát hành)
python3 .xstored/scripts/xs.py blueprint-status BLUEPRINT.md --strict
```

Quy mô quyết định khối lượng: `web-app` có 70 MUST ở **S** (prototype), 468 ở **M** (production), 1.124 ở **L** (đo 2026-10-14).
Ghép thêm module ngoài hồ sơ bằng `--add`, ví dụ web app có tính năng AI: `--add "13-ai-engineering/*"`.

## Chạy tự động đến khi xong

Trong Claude Code, sau khi cài khung, gõ `/autopilot <mô tả yêu cầu>`:

1. Agent lập kế hoạch G0–G4: `PROJECT.md`, `BLUEPRINT.md`, nghiên cứu phiên bản, spec, thiết kế, `PLAN.md` có task và lệnh kiểm.
2. Bạn duyệt **một lần**.
3. Vòng lặp chạy: làm task, `xs.py loop record` ghi bằng chứng, commit, push. Stop hook đọc bằng chứng trên đĩa để quyết làm tiếp.
4. Dừng khi xong có bằng chứng, khi chạm ngân sách, khi cùng một lỗi lặp 3 lần, hoặc ở **điểm dừng bắt buộc**:
   thao tác không đảo ngược, tiền thật, dữ liệu người dùng thật, deploy/publish, đổi cấu hình cổng, spec mâu thuẫn.

Hook trong [`.claude/`](.claude/settings.json) chặn lệnh phá huỷ và `curl | sh`, hỏi trước khi deploy hoặc nới cấu hình cổng,
chạy cổng chất lượng trước mỗi commit. Luật cho mọi harness ở [`AGENTS.md`](AGENTS.md). Giao thức đầy đủ:
[`framework/11-autonomous-loop/README.md`](framework/11-autonomous-loop/README.md).

## Công cụ

| Lệnh | Việc |
|---|---|
| `python3 scripts/xs.py validate` · `python3 scripts/xs.py list profiles` | Kiểm quy ước toàn khung: frontmatter, ID duy nhất, MUST có cách kiểm, liên kết |
| `python3 scripts/xs.py compose ...` | Ghép blueprint theo hồ sơ, ngành, quy mô; ghép lại vào file có sẵn thì giữ trạng thái theo ID |
| `python3 scripts/xs.py blueprint-status FILE --strict [--json]` | Đếm đạt/miễn/chưa; cổng phát hành; `FILE` là `-` thì đọc stdin |
| `python3 scripts/xs.py loop init/status/record/block/resume/stop` | Vòng lặp autopilot có bằng chứng |
| `python3 scripts/install.py DỰ_ÁN [--with-github]` | Cài khung + harness vào dự án đích |
| `python3 scripts/xs.py progress-check [FILE]` | `PROGRESS.md` ≤ 8 KB, đúng 4 mục, SHA ở Bàn giao phiên là tổ tiên HEAD và có trên nhánh chính (`XS_PROGRESS_BASE`, mặc định `origin/HEAD` → `origin/main` → `origin/master`; CI cần `fetch-depth: 0`) |
| `python3 scripts/xs.py ci-check [DIR]` | Fitness function cho workflow CI: `permissions:` cấp workflow, không `write-all`, `uses:` ghim SHA 40 ký tự (`docker://` ghim `@sha256:`), job có `timeout-minutes`, không `continue-on-error` (ngoại lệ `# ci-check-allow: <lý do>`) |
| `python3 scripts/xs.py audit plan [--blueprint F] [--status F] [--json]` | Dò stack → nhóm audit áp dụng/rút gọn/N/A kèm lý do, công cụ có/thiếu, bằng chứng blueprint trỏ file đã đổi sau khi ghi, nhóm cần quét lại theo `docs/ops/AUDIT-STATUS.md` |
| `python3 scripts/xs.py audit check STATUS [--strict]` | Kiểm sổ audit (schema phát hiện, SHA quét là tổ tiên HEAD, chấp nhận rủi ro có chủ + hạn); `--strict` = Definition of Complete |
| `python3 scripts/xs.py stats` | Đếm file theo loại và mục theo mức |
| `python3 scripts/xs.py --version` · `--help` | Phiên bản khung (file `VERSION`) · ví dụ và mã thoát (0 ổn · 1 chưa đạt · 2 sai cách dùng) |
| `python3 scripts/check-links.py` | Kiểm liên kết Markdown toàn repo |
| `scripts/dev-task.sh gate` | Cổng commit: chạy lệnh trong `xs.yaml` (build · typecheck · lint · test), CI chạy đúng lệnh này |

Biến môi trường (đều tuỳ chọn): `XS_FRAMEWORK` (thư mục khung, mặc định cạnh `scripts/`) · `XS_FRAMEWORK_LINK` (gốc liên kết
trong blueprint, mặc định `.xstored/framework`) · `XS_RECORD_TIMEOUT` (giây, mặc định 1800) · `XS_PROGRESS_BASE` (nhánh chính cho `progress-check`, mặc định `origin/HEAD` → `origin/main` → `origin/master`; rỗng = tắt) · `CLAUDE_PROJECT_DIR` (gốc dự án cho
`loop`) · `XS_DEBUG=1` (in traceback khi lỗi).

Kiểm tra trước khi đóng góp (cần Python ≥ 3.11 và shellcheck; ruff/mypy/coverage khoá kèm hash ở `requirements-dev.txt`):

```bash
pip install --require-hashes -r requirements-dev.txt
scripts/dev-task.sh gate                 # build · typecheck · lint · test — phần lõi của CI job quality
python3 -m unittest discover -s tests    # chỉ test (cổng test còn đòi coverage dòng + nhánh 100%, xem xs.yaml)
```

## Quyết định thiết kế

- [ADR-0001](docs/adr/0001-framework-as-id-library-with-machine-composition.md): khung là thư viện ID, máy ghép và máy kiểm "xong".
- [ADR-0002](docs/adr/0002-harness-stop-points-and-evidence-hooks.md): hook chặn hành động nguy hiểm, Stop hook đọc bằng chứng.
- [ADR-0003](docs/adr/0003-scale-s-floor-only.md): ở quy mô S chỉ sàn (baseline, hồ sơ, ngành) là MUST.
- [ADR-0004](docs/adr/0004-scale-m-module-must-cap.md): ở quy mô M mỗi module tối đa 4 MUST, phần vượt là `MUST@L`.

Nghiên cứu nền ngày 2026-10-13 ở [`research/`](research/): phân tích khung cũ, trích xuất catalog `seeker19110/stored`,
AI agent và giao thức, cơ chế Claude Code. Khung cũ khôi phục được bằng `git archive 1b80fe4`.

## Đóng góp

Xem [`CONTRIBUTING.md`](CONTRIBUTING.md) và [`framework/00-method/conventions.md`](framework/00-method/conventions.md).
Báo lỗ hổng: [`SECURITY.md`](SECURITY.md). Giấy phép: [MIT](LICENSE).
