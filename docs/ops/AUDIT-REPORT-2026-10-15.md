# AUDIT-REPORT — Khung X-Templates · 2026-10-15

> Commit quét: `5627657ecd3d81c7c5e35e7b05c75c40366374d9` (`main`, sau #30–#35) · Chế độ: **delta** từ `6490f7b` (9 nhóm có file đổi) · Quy trình: [`framework/00-method/audit.md`](../../framework/00-method/audit.md)
> Người quét: phiên chính + 3 subagent `reviewer` read-only (SEC/DEP/CI · ARCH/CODE/TEST/XFEAT · DOC/HAR + 56 bằng chứng blueprint) · Xác minh đối kháng: subagent `reviewer` thứ tư (tái hiện từ đầu 5 phát hiện 🟠)
> `python3 scripts/xs.py audit check docs/ops/AUDIT-STATUS.md` → exit 0; `--strict` → exit 1 (4 🟠 mở — đúng kỳ vọng trước khi sửa)

## 1. Tóm tắt

| Mức | Mở (mới) | Bác bỏ/hạ mức |
|---|---|---|
| 🔴 | 0 | 0 |
| 🟠 | 4 | 1 hạ xuống 🟢 (AUD-HAR-016) |
| 🟢 | 11 | 0 |

Kết luận: **không chặn phát hành**, nhưng hai 🟠 của hàng rào hook (AUD-SEC-011, AUD-HAR-013) cho phép commit **không qua cổng**
mà không ai bị hỏi (`timeout 60 git commit …` được settings tự duyệt) — nên sửa ở đợt đầu. Hai 🟠 còn lại là bằng chứng
blueprint sai (`BASE-ERR-009`, `BASE-REPO-007`), sửa bằng tài liệu hoặc mã nhỏ.

## 2. Phạm vi và tín hiệu (`xs.py audit plan`)

252 file · mã: python 10, shell 7 · test 6 · UI 0 · CSDL 0 · CI 7 workflow · **REPO KHUNG**.
Quét lại theo sổ: ARCH, SEC, CODE, TEST, DEP, CI, DOC, XFEAT, HAR (file đổi từ `6490f7b`). Giữ nguyên: PERF (rút gọn), CFG
(không file cấu hình đổi), A11Y/DATA (N/A).
Bằng chứng/miễn trừ blueprint trỏ file đã đổi: **56 mục** — xác minh lại từng mục: 34 đúng, 2 sai (AUD-HAR-014/015),
20 lệch dòng/số đếm (AUD-HAR-018).

## 3. Lệnh đã chạy

| Nhóm | Lệnh | Exit | Kết quả chính |
|---|---|---|---|
| tất cả | `scripts/dev-task.sh gate` | 0 | 4 lệnh xanh; coverage dòng + nhánh 100% (1952 dòng, 832 nhánh); 45,6 s |
| SEC | `gitleaks git . --redact` (8.28.0, checksum khớp) | 0 | 124 commit, không lộ bí mật |
| SEC | `bandit -q -r scripts .claude/hooks` (1.8.6) | 1 | B602 `shell=True` ở `loop record` (thiết kế, SECURITY.md); còn lại Low |
| CODE | `vulture scripts .claude/hooks/guard.py --min-confidence 60` (2.14) | 3 | 3 báo nhầm (thuộc tính shlex) + `stdin_text` (chữ ký hook, đã biết) |
| DEP | `pip-audit --require-hashes --strict --disable-pip -r requirements-dev.txt -r requirements-audit.txt` (2.9.0) | 0 | không lỗ hổng |
| CI | `python3 scripts/xs.py ci-check` | 0 | 7 workflow: permissions, ghim SHA, timeout |
| DOC | `xs.py validate` · `check-links.py` · `progress-check` | 0 | 180 file, 2624 mục; link nội bộ đủ |
| HAR | `xs.py blueprint-status BLUEPRINT.md --strict` | 0 | 0 MUST mở |
| HAR | `xs.py audit plan --json` | 0 | 56 bằng chứng blueprint cần xác minh lại |

Công cụ không chạy: semgrep, osv-scanner, actionlint, zizmor, lychee, jscpd, lint-imports (SAST dựa CodeQL trên CI, xanh).

## 4. Phát hiện chi tiết (🟠)

### AUD-SEC-011 🟠 Guard bỏ sót wrapper → mọi luật lọt, kể cả cổng commit

Tái hiện (`python3 -I -c 'import sys; sys.path.insert(0,".claude/hooks"); import guard; print(guard.bash_decision(CMD,"/tmp"))'`):
`timeout 60 git reset --hard`, `nice -n 5 git reset --hard`, `stdbuf -o L git reset --hard`, `xargs -n 1 git reset --hard`,
`setsid claude --bare`, `timeout 600 claude --bare` → decision `""`; `git reset --hard` trơn → deny.
`timeout 60 git commit -m x` → `commit=False` → hook không chạy cổng; `.claude/settings.json` allow `Bash(git commit *)` và
Claude Code bỏ `timeout` trước khi so luật → **tự duyệt, không ai bị hỏi**.
Nguyên nhân: `.claude/hooks/guard.py:26` (`WRAPPERS` thiếu `timeout`, `setsid`); `:240-243` chỉ bỏ token bắt đầu bằng `-`, không
bỏ giá trị của cờ. Lớp deny gốc của Claude Code (docs *Permissions*, đọc 2026-10-15) vẫn đỡ `timeout`/`nice`/`stdbuf` +
`git reset --hard`/`rm -rf /`, không đỡ `xargs -n`, `setsid`, `claude --bare`.

### AUD-HAR-013 🟠 `ask` làm mất cổng commit

Dự án tạm có `xs.yaml` `test: false`: `git commit -am "fix: x" && git push origin main` → hook in `ask`, exit 0, không dòng
`[dev-task]` nào; đối chứng `git commit -m "fix: x"` → `GATE ĐỎ`, exit 2. `pre-bash-guard.sh:15-16` gọi `pretool_decision`
(`_lib.sh:38` `exit 0`) trước bước cổng. Người duyệt thấy lý do "push thẳng nhánh chính", không biết cổng bị bỏ.

### AUD-HAR-014 🟠 `BASE-ERR-009` tick sai

MUST đòi `exception.stacktrace` và chuỗi nguyên nhân. Ném `ValueError("boc") from KeyError("goc")` qua `_loop_hook_stop` →
stderr chỉ `ValueError: boc`, mất "goc", không traceback (`scripts/xs.py:1813`); `main()` chỉ traceback khi `XS_DEBUG`
(`:2036-2038`). `scripts/xs.py` không dùng `traceback`/`__cause__` ở đâu.

### AUD-HAR-015 🟠 `BASE-REPO-007` bằng chứng sai sự thật

Bằng chứng ghi "chưa có bản phát hành nên chưa có dòng ngày/tag, chưa có CI kiểm"; thực tế `CHANGELOG.md:102`
`## [2.0.0] - 2026-10-14`, tag `v2.0.0` annotated (`git cat-file -t` = `tag`), `release-tag.yml:41` kiểm mục CHANGELOG.
Mâu thuẫn ngay với `BASE-REPO-006` kế bên.

### Hạ mức: AUD-HAR-016 (🟠 → 🟢)

Blueprint biến mất → `loop status` = `done`: tái hiện được, nhưng là chủ ý (comment `xs.py:751-754`, test
`test_xs_core.py:604`, CHANGELOG *Fixed*) và `loop stop` vốn thoát vòng lặp được. Còn đáng sửa: `loop init` nhận
`--blueprint` không tồn tại; bảng verdict ở `loop-design.md` không nêu ngoại lệ.

## 5. Kế hoạch sửa theo đợt (đã duyệt 2026-10-15, xong — xem §7)

| Đợt | PR | Phát hiện | Gate đỏ trước khi sửa |
|---|---|---|---|
| 1 | `fix(harness): guard bóc wrapper có giá trị; ask không bỏ cổng commit` | AUD-SEC-011, AUD-HAR-013, AUD-SEC-012/013/014 | test `guard_wrappers`, `commit_gate_with_ask`, ca npx/rc/báo nhầm |
| 2 | `fix: xs.py in traceback + cause; sửa bằng chứng blueprint` | AUD-HAR-014, AUD-HAR-015, AUD-HAR-018 | test ném lỗi bọc lỗi phải thấy cause |
| 3 | `chore: dọn nợ 🟢` | AUD-HAR-016, AUD-DOC-020/021, AUD-CODE-003, AUD-TEST-002 | `ruff --extend-select RUF100`; `loop init --blueprint TYPO.md` → lỗi |
| — | người quyết | AUD-HAR-017 (trailer tên model trái AGENTS.md §3), AUD-XFEAT-001 (xác minh trước) | — |

## 6. Ghi chú

- AUD-HAR-017: phiên audit này đã ngừng thêm trailer từ 2026-10-15; lịch sử cũ không rewrite (luật P8).
- Đã biết, không tính phát hiện: guard không bóc `sh -c`/`eval`/alias/biến chứa cờ (giới hạn phân tích tĩnh, CHANGELOG).

## 7. Kết quả sau sửa

| Đợt | PR | Đóng | Ghi chú |
|---|---|---|---|
| 1 | #36 | AUD-SEC-011, AUD-HAR-013, AUD-SEC-012/013/014, AUD-HAR-017 (quyết định) | review phát hiện thêm 2 hồi quy (env -u/-C, `xargs --replace`) + 1 tự phát hiện (stdout cổng làm hỏng JSON ask) — sửa trong cùng PR, so sánh 65 lệnh cũ/mới |
| 2 | #37 | AUD-HAR-014, AUD-HAR-015, AUD-HAR-018 | `BASE-REPO-007` mở lại tạm thời |
| 3 | #38 | AUD-HAR-016, AUD-DOC-020/021, AUD-CODE-003, AUD-XFEAT-001, AUD-TEST-002 | `xs.py changelog-check` vào cổng lint → `BASE-REPO-007` đạt |

`python3 scripts/xs.py audit check docs/ops/AUDIT-STATUS.md --strict` → exit 0 (Definition of Complete);
`blueprint-status BLUEPRINT.md --strict` → exit 0; `audit plan` → 0 bằng chứng blueprint cũ.

## 8. Quét lại delta `b32e2a6` (sau #39)

> Chế độ **delta**: `audit plan` chỉ liệt kê DOC, HAR (2 file đổi từ `05ec95d`: `PROGRESS.md`, sổ audit) + 1 bằng chứng
> blueprint trỏ file đã đổi (`LOOP-HARNESS-004` ← `PROGRESS.md`). Người quét: phiên chính (delta 2 file tài liệu, không
> giao subagent). Không có 🔴/🟠 nên không cần xác minh đối kháng.

| Nhóm | Lệnh | Exit | Kết quả chính |
|---|---|---|---|
| tất cả | `scripts/dev-task.sh gate` (container mới: `pip install --require-hashes -r requirements-dev.txt`, shellcheck 0.9.0) | 0 | 308 test; coverage dòng + nhánh 100% (2098 dòng, 906 nhánh) |
| SEC | `gitleaks git . --redact --log-opts=--all` (8.28.0, checksum khớp; clone đã `--unshallow`) | 0 | 128 commit, không lộ bí mật |
| DOC | `xs.py progress-check` · `changelog-check` · `validate` · `check-links.py` (trong gate) | 0 | PROGRESS 4111 B, 4 mục; tag `v2.0.0` → `55de4d1` khớp PROGRESS |
| HAR | `xs.py blueprint-status BLUEPRINT.md --strict` | 0 | 0 MUST mở |
| HAR | `xs.py audit check docs/ops/AUDIT-STATUS.md --strict` | 0 | 0 🔴/🟠 mở; 2 🟢 mở |

Phát hiện mới (🟢, đều đo được):

- **AUD-HAR-019** — bằng chứng `LOOP-HARNESS-004` trích `PROGRESS.md`; file này đổi ở mọi commit bàn giao nên `audit plan`
  cờ "bằng chứng cũ" sau **mọi** phiên (#39 chỉ đổi PROGRESS + sổ mà vẫn cờ). Nội dung bằng chứng xác minh lại vẫn đúng.
  Sửa: trích máy kiểm (`xs.yaml` lint gọi `progress-check`, test `ProgressCheckTest`) thay vì file trạng thái.
- **AUD-DOC-022** — #39 nâng cột SHA của SEC/CODE/TEST/CI/XFEAT lên `05ec95d` nhưng giữ ghi chú lần quét `5627657`
  (TEST "295 test" ↔ đo 308; phát hiện đã sửa còn viết như hiện trạng). Bằng chứng quét lại thật chỉ gom ở dòng ARCH.

Ghi chú: PROGRESS ghi "commit cuối `05ec95d` (#38)" trong khi `main` là `b32e2a6` (#39) — giới hạn tự tham chiếu của
commit bàn giao (squash), `progress-check` xanh; không tính phát hiện.

### Kế hoạch sửa (duyệt 2026-10-15 qua `/autopilot`, xong — PLAN T-501…T-503)

| Đợt | PR | Phát hiện | Gate |
|---|---|---|---|
| 1 | 1 PR `docs:` | AUD-HAR-019, AUD-DOC-022 | `audit plan --json` → `stale_evidence` rỗng; `audit check --strict` exit 0 |

Kết quả đợt 1: AUD-HAR-019 sửa ở `LOOP-HARNESS-004` và mục cùng gốc `LOOP-HARNESS-001` (trích `docs/autopilot/PLAN.md`,
lộ ra khi commit T-501 — PLAN viết lại mỗi lần autopilot); `BASE-REPO-006/007` vẫn trích `CHANGELOG.md` vì khẳng định
phụ thuộc thật nội dung file đó. AUD-DOC-022: đo lại trên mã `05ec95d` (mã không đổi tới HEAD) — bandit 1.8.6 exit 1
(chỉ B602 đã biết + 7 Low), vulture 2.14 exit 3 (4 báo nhầm đã biết), pip-audit 2.10.1 exit 0, ci-check exit 0, gitleaks
exit 0 — ghi chú 5 dòng nhóm viết lại. `audit plan` → 0 bằng chứng blueprint cũ; `audit check --strict` exit 0, 0 phát hiện mở.
