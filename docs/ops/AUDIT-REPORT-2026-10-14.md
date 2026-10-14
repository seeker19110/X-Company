# AUDIT-REPORT — Khung X-stored · 2026-10-14

> Commit quét: `0511c1e8afe2e18a6c8d85161c9ce6cfaa089dcf` (`main`) · Phạm vi: toàn bộ 13 nhóm (lần đầu) · Quy trình: [`framework/00-method/audit.md`](../../framework/00-method/audit.md)
> Người quét: phiên chính + 2 subagent read-only (bảo mật harness; thống nhất tài liệu) · Xác minh đối kháng: subagent `reviewer` thứ ba
> `python3 scripts/xs.py audit check docs/ops/AUDIT-STATUS.md` → exit 0 (schema đúng); `--strict` → exit 1 (còn 🔴/🟠 mở — đúng kỳ vọng trước khi sửa)

## 1. Tóm tắt

| Mức | Mở | Đã sửa | Chấp nhận | Bác bỏ |
|---|---|---|---|---|
| 🔴 | 1 | 0 | 0 | 0 |
| 🟠 | 28 | 0 | 0 | 0 |
| 🟢 | 21 | 1 | 0 | 0 |

Kết luận: **chặn phát hành bản sau 2.0.0** cho tới khi sửa AUD-HAR-001 — ở dự án đích, cổng `dev-task.sh gate` báo xanh giả,
nên autopilot có thể khai "xong" sai. Các 🟠 tập trung ở hàng rào hook (lọt lệnh nguy hiểm dễ gõ nhầm), `install.py`
(hook không chạy ở dự án đã có settings) và tài liệu khung lệch nhau/lệch mã.

## 2. Phạm vi và tín hiệu (`xs.py audit plan`)

238 file · mã: python 6, shell 7 · test 3 · UI 0 · CSDL 0 · CI 5 workflow · harness đủ · **REPO KHUNG**.
Áp dụng: ARCH, SEC, CODE, TEST, CI, DOC, CFG, XFEAT, HAR · rút gọn: PERF (CLI — đo thời gian cổng), DEP (không manifest —
chỉ action + công cụ cài trong CI) · N/A: A11Y (không UI), DATA (không CSDL).
Công cụ thiếu cục bộ: gitleaks, semgrep, osv-scanner, actionlint, zizmor, lychee, jscpd → SAST/secret dựa vào CI (CodeQL,
gitleaks xanh trên `main`); lychee chạy qua workflow `Links` (dispatch tay).
Bằng chứng/miễn trừ blueprint trỏ file đã đổi sau khi ghi: **45 mục** (AUD-HAR-006) — ít nhất `BASE-DEP-002` đã sai.

## 3. Lệnh đã chạy

| Nhóm | Lệnh | Exit | Kết quả chính |
|---|---|---|---|
| 3·4·9·13 | `scripts/dev-task.sh gate` | 0 | validate, link nội bộ, progress-check, ci-check, ruff, mypy, shellcheck, 103 test |
| 3 | `ruff check --select C901 --config 'lint.mccabe.max-complexity=10' scripts` | 1 | 6 hàm > 10 (AUD-CODE-001) |
| 3 | `mypy --strict --python-version 3.11 scripts/*.py` | 1 | 20 lỗi (AUD-CODE-002) |
| 3 | `vulture scripts --min-confidence 80` | 0 | 1 tham số không dùng có chủ đích (`hook_stop(stdin_text)`) — không ghi phát hiện |
| 4 | `coverage run --branch --source=scripts -m unittest discover -s tests` | 0 | 73% in-process; test qua subprocess không được đếm (AUD-TEST-001) |
| 4 | quét AST: test không có assert | 0 | 0 test |
| 5 | đo `dev-task.sh lint/typecheck/test` | 0 | 1,3 s · 1,8 s · 10,4 s |
| 8 | `xs.py ci-check` | 0 | 5 workflow đạt |
| 9 | workflow `Links` run 38552199319 (lychee) | 2 | 3 025 link, 30 lỗi: 5 [404] thật, còn lại 202/SSL/kết nối (AUD-DOC-002, AUD-CI-004) |
| 13 | `xs.py audit plan` | 0 | 45 mục blueprint cần xác minh lại (AUD-HAR-006) |
| 2·11·13 | hook với payload JSON giả (`CLAUDE_PROJECT_DIR=<tmp>`) | — | bảng §4; bộ tái hiện ở scratch của phiên |

## 4. Phát hiện chi tiết (🔴 và 🟠 chính)

### AUD-HAR-001 🔴 `dev-task.sh` ở dự án đích báo xanh giả
- **Bằng chứng:** đo được — cài khung vào dự án tạm, `xs.yaml` có `test: false`;
  `env -u CLAUDE_PROJECT_DIR bash .xstored/scripts/dev-task.sh gate` → "skip" cả 4 task, "GATE XANH (hoặc no-op)", exit 0;
  có `CLAUDE_PROJECT_DIR` thì exit 1. `xs.py loop record --task T-001 -- .xstored/scripts/dev-task.sh gate` ghi bằng chứng exit 0.
- **Nguyên nhân:** `scripts/dev-task.sh:21` `ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"` → `.xstored/`.
  Bash tool của agent không có `CLAUDE_PROJECT_DIR`; skill `/gate` dùng đúng đường này.
- **Xác minh đối kháng:** reviewer thứ ba tái hiện được.
- **Đề xuất sửa:** script tự nhận ra mình nằm trong `.xstored/scripts` → ROOT = `../..`; thiếu `xs.yaml` thì **đỏ** (exit 2), không "no-op xanh".
  **Gate:** test mới chạy `dev-task.sh gate` trong dự án tạm không có biến môi trường → exit ≠ 0 khi test đỏ.

### Hàng rào hook (AUD-SEC-001…008)
Đều tái hiện bằng payload giả; đối chứng `rm -rf /` → deny, `git reset --hard` → deny, `git push origin main` → ask vẫn đúng.
Lọt: tuỳ chọn toàn cục `git -C <dir>`/`X=1 git`/`command git` (001); `git checkout .`/`git restore .` (002);
`rm -Rf /`, `rm -r -f /` (003); `sh -c "$(curl …)"`, `bash <(curl …)` (004); cổng commit bị bỏ qua khi message chứa ` -n ` (005);
cấu hình cổng trong thư mục con/đường dẫn chưa chuẩn hoá (006); sửa file cổng qua Bash (007); refspec `feat:main`/`--delete main` (008).
Lớp `permissions` trong `.claude/settings.json` che một phần — **chỉ ở repo khung**; dự án đích đã có settings thì lớp này
không được cài (AUD-HAR-003), hook là lớp duy nhất.
**Đề xuất:** một hàm Python tách lệnh bằng `shlex` (tôn trọng nháy, bỏ thân heredoc, chuẩn hoá `env`/gán biến/tuỳ chọn toàn cục git)
trong `_lib.sh`, dùng cho mọi luật; giữ fail-open khi lỗi. Một chỗ sửa xử lý 001·002·003·005·008 và báo nhầm AUD-SEC-010.

### Khác
- **AUD-HAR-002** `loop record` ghép argv bằng khoảng trắng + xoá mọi `--` → lệnh có nháy hỏng; Gate `npm test -- --run` theo mẫu `xs.yaml` không khớp (trừ khi truyền cả lệnh thành một đối số).
- **AUD-HAR-003** `install.py` vào dự án đã có `.claude/settings.json` → hook copy nhưng không đăng ký, log vẫn báo thành công.
- **AUD-CFG-001** `output_tail` giữ nguyên `Authorization: Bearer …`, `AKIA…`, `postgres://u:pass@…` và in ra stdout khi lệnh đỏ.
- **AUD-CI-002/003** ruleset mẫu `strict: false` trái BASE-GATE-007; `--with-github` cài ruleset đòi job mà dự án đích không có.
- **AUD-DEP-001** miễn trừ BASE-DEP-001/002 sai từ khi CI cài `ruff`/`mypy` (không hash, bắc cầu không ghim).
- **AUD-DOC-001…012** tài liệu khung lệch số đo, lệch mã, trùng chủ đề — chi tiết từng dòng trong `AUDIT-STATUS.md`.

## 5. Kế hoạch sửa theo đợt (đã duyệt 2026-10-14, xong — xem §7)

| Đợt | Phát hiện | PR dự kiến | Gate của đợt |
|---|---|---|---|
| 1 | AUD-HAR-001, HAR-002, CFG-001, HAR-007, HAR-008, HAR-009 | `fix(xs): cổng dự án đích không xanh giả; loop record giữ nguyên lệnh; che bí mật` | test tái hiện đỏ trước → `scripts/dev-task.sh gate` |
| 2 | AUD-SEC-001…010, HAR-011 (**đổi hook — điểm dừng bắt buộc**) | `fix(harness): tách lệnh bằng shlex cho pre-bash/pre-edit guard` | `python3 -m unittest discover -s tests -k guard` + bộ tái hiện |
| 3 | AUD-HAR-003, HAR-004, HAR-010, CI-003 | `fix(install): đăng ký hook vào settings có sẵn, manifest hash, bỏ symlink` | `python3 -m unittest discover -s tests -k install` |
| 4 | AUD-DEP-001, DEP-002, CI-002, CI-004 (**đổi cấu hình CI/ruleset — điểm dừng bắt buộc**) | `ci: requirements-dev có hash, nâng action, ruleset strict, lychee nhận 202` | `scripts/dev-task.sh gate` + CI xanh |
| 5 | AUD-DOC-001…019, CI-001, CI-005, HAR-005, HAR-006 (DOC-004 **cần người quyết**) | `docs(framework): thống nhất tài liệu với mã` (có thể tách 2 PR) | `python3 scripts/xs.py validate` + `xs.py audit plan` (0 bằng chứng cũ chưa xác minh) |

Sau mỗi đợt: cập nhật dòng phát hiện → `đã sửa` (#PR), `xs.py audit plan --status docs/ops/AUDIT-STATUS.md`, quét lại nhóm bị chạm.
Xong khi `python3 scripts/xs.py audit check docs/ops/AUDIT-STATUS.md --strict` exit 0.

## 6. Nợ 🟢 giữ lại

| ID | Chủ | Hạn | Lý do chưa sửa |
|---|---|---|---|
| AUD-CODE-001 | người bảo trì khung | 2027-03-31 | **đã trả** (#28): 11 hàm tách về ≤ 10, `ruff.toml` bật C901 |
| AUD-CODE-002 | người bảo trì khung | 2026-12-31 | **đã trả** (#26): `mypy --strict` 0 lỗi, cổng `typecheck` chạy `--strict` |
| AUD-TEST-001 | người bảo trì khung | 2026-12-31 | **đã trả** (#26): đo cả subprocess, dòng + nhánh 100%, cổng `test` chặn dưới 100% |

## 7. Kết quả sau sửa (quét lại trên `main` `6490f7b`)

| Đợt | PR | Phát hiện đóng |
|---|---|---|
| 1 | #20 | AUD-HAR-001 🔴, HAR-002, HAR-007, HAR-008, HAR-009, CFG-001 |
| 2 | #21 | AUD-SEC-001…010, HAR-005, HAR-011 |
| 3 | #22 | AUD-HAR-003, HAR-004, HAR-010, CI-003 |
| 4 | #23 | AUD-DEP-001, DEP-002, CI-002, CI-004 |
| 5 | #24 | AUD-DOC-001…019, CI-001, CI-005, HAR-006, HAR-012 (mới), DEP-003 (mới) |

- Sổ: 🔴 đã sửa 1 · 🟠 đã sửa 30 · 🟢 đã sửa 19 · 🟢 chấp nhận 3 (§6). `python3 scripts/xs.py audit check docs/ops/AUDIT-STATUS.md --strict` → exit 0.
- Quét lại 9 nhóm bị chạm (ARCH, SEC, CODE, TEST, DEP, CI, DOC, XFEAT, HAR) bằng công cụ: ruff/format/mypy/shellcheck
  `--severity=warning`, `ci-check`, `validate`, `check-links`, `progress-check`, 130 test, coverage; CI trên `main` 6490f7b
  xanh cả 5 workflow (CI, CodeQL, Secret scan, Dependency audit, Portability). Không phát hiện mới.
- Nợ 🟢 lớn lên trong lúc sửa, đã ghi số đo mới vào sổ: C901 6 → 11 hàm (`audit_check` 31, `guard.py` 3 hàm, `install` 21),
  `mypy --strict` 20 → 24 lỗi; coverage nhánh 73% → 77%. Hạn giữ nguyên; nên trả trước khi thêm tính năng lớn vào `xs.py`.
- Còn cho admin (ngoài tầm PR): import `.github/rulesets/main.json`, bật Private Vulnerability Reporting và Dependabot
  security updates, tạo tag `v2.0.0`.
