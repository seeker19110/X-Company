"""Test cho nửa sau scripts/xs.py: progress-check, ci-check, audit plan/check, các lệnh cmd_*, parser, main.

Gọi hàm/`main([...])` trong tiến trình (không subprocess) trừ khi cần git thật (repo tạm).
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
import unittest.mock
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import xs  # noqa: E402
from test_xs import audit_status_text, make_framework  # noqa: E402


def run_main(*args, stdin: str | None = None) -> tuple[int, str, str]:
    """Chạy xs.main trong tiến trình; trả (exit code, stdout, stderr)."""
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        if stdin is None:
            rc = xs.main([str(a) for a in args])
        else:
            with unittest.mock.patch.object(sys, "stdin", io.StringIO(stdin)):
                rc = xs.main([str(a) for a in args])
    return rc, out.getvalue(), err.getvalue()


class TmpDirCase(unittest.TestCase):
    """Thư mục tạm, chặn git đi ngược lên thư mục cha (tránh nhặt nhầm repo ngoài)."""

    def setUp(self):
        self.tmp = Path(self.enterContext(tempfile.TemporaryDirectory())).resolve()
        self.enterContext(unittest.mock.patch.dict(os.environ, {"GIT_CEILING_DIRECTORIES": str(self.tmp.parent)}))


class TmpRepoCase(TmpDirCase):
    def init_repo(self) -> Path:
        self.repo = self.tmp / "repo"
        self.repo.mkdir()
        self.git("init", "-q", "-b", "main")
        return self.repo

    def git(self, *args, env=None) -> str:
        r = subprocess.run(
            ["git", "-C", str(self.repo), "-c", "user.name=t", "-c", "user.email=t@example.invalid"]
            + ["-c", "commit.gpgsign=false", *args],
            capture_output=True,
            text=True,
            check=True,
            env={**os.environ, **(env or {})},
        )
        return r.stdout.strip()

    def commit_files(self, files: dict, at: int) -> str:
        for name, text in files.items():
            f = self.repo / name
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(text, encoding="utf-8")
            self.git("add", name)
        stamp = f"@{at} +0000"
        self.git("commit", "-q", "-m", "c", env={"GIT_AUTHOR_DATE": stamp, "GIT_COMMITTER_DATE": stamp})
        return self.git("rev-parse", "HEAD")


# --------------------------------------------------------------------------- progress-check


class ProgressCheckEdgeTest(TmpDirCase):
    def test_missing_handover_section_returns_early(self):
        f = self.tmp / "PROGRESS.md"
        f.write_text("## Đang làm\n\nx\n\n## Tiếp theo\n\ny\n", encoding="utf-8")
        errors = xs.progress_check(f)
        self.assertEqual(len(errors), 1)
        self.assertIn("đang có: Đang làm · Tiếp theo", errors[0])

    def test_no_sections_at_all_reports_placeholder(self):
        f = self.tmp / "PROGRESS.md"
        f.write_text("chỉ có chữ\n", encoding="utf-8")
        errors = xs.progress_check(f)
        self.assertIn("đang có: (không có)", errors[0])

    def test_sha_outside_git_repo_raises_oserror(self):
        f = self.tmp / "PROGRESS.md"
        f.write_text(
            "## Đang làm\n\n## Tiếp theo\n\n## Quyết định\n\n## Bàn giao phiên\n\ncommit `abcdef1`\n", encoding="utf-8"
        )
        with self.assertRaises(OSError) as cm:
            xs.progress_check(f)
        self.assertIn("không phải repo git", str(cm.exception))
        rc, out, err = run_main("progress-check", f)
        self.assertEqual((rc, out), (2, ""))
        self.assertIn("✗ không phải repo git", err)


# --------------------------------------------------------------------------- ci-check


class CiCheckEdgeTest(unittest.TestCase):
    def test_workflow_without_jobs_key(self):
        self.assertEqual(xs.ci_check_text("permissions: read-all\non:\n  push:\n"), [])

    def test_jobs_key_without_body(self):
        self.assertEqual(xs.ci_check_text("permissions: read-all\njobs:\n"), [])

    def test_job_missing_timeout_still_reported_with_deeper_lines(self):
        text = "permissions: read-all\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: y\n"
        errors = xs.ci_check_text(text)
        self.assertEqual(len(errors), 1)
        self.assertIn("job `a` thiếu `timeout-minutes`", errors[0])


# --------------------------------------------------------------------------- markdown helpers


class MarkdownTableTest(unittest.TestCase):
    def test_split_row_without_outer_pipes(self):
        self.assertEqual(xs.split_md_row("a | b"), ["a", "b"])

    def test_split_row_with_outer_pipes_and_escaped_pipe(self):
        self.assertEqual(xs.split_md_row("| a \\| b | c |"), ["a | b", "c"])

    def test_split_row_trailing_escaped_pipe_is_content(self):
        self.assertEqual(xs.split_md_row("| a \\|"), ["a |"])

    def test_md_tables_ignores_fenced_rows(self):
        text = (
            "## Nhóm\n\n```\n| x | y |\n~~~\n| z |\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~~\n## Giả\n| q |\n~~~\n"
        )
        tables = xs.md_tables(text)
        self.assertEqual(list(tables), ["Nhóm"])
        self.assertEqual(tables["Nhóm"], [{"a": "1", "b": "2"}])

    def test_md_tables_only_first_table_per_heading(self):
        text = "## T\n\n| a |\n|---|\n| 1 |\n\ntext\n\n| b |\n|---|\n| 2 |\n"
        self.assertEqual(xs.md_tables(text), {"T": [{"a": "1"}]})

    def test_md_tables_pads_short_rows(self):
        self.assertEqual(xs.md_tables("## T\n| a | b |\n|---|---|\n| 1 |\n"), {"T": [{"a": "1", "b": ""}]})


# --------------------------------------------------------------------------- audit helpers


class RepoFilesTest(TmpDirCase):
    def test_walk_fallback_outside_git_skips_vendor_dirs(self):
        for rel in ("a.py", "sub/b.md", "node_modules/x.js", ".autopilot/s.json", "dist/o.js"):
            p = self.tmp / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("x", encoding="utf-8")
        self.assertEqual(sorted(xs._repo_files(self.tmp)), ["a.py", "sub/b.md"])

    def test_empty_directory(self):
        self.assertEqual(xs._repo_files(self.tmp), [])


class AuditToolsTest(TmpDirCase):
    def test_group_without_relevant_stack_tool_is_omitted(self):
        sig = xs.audit_signals(self.tmp, ["lib.rs"])
        appl = xs.audit_applicability(sig)
        tools = xs.audit_tools(self.tmp, sig, appl)
        self.assertNotIn(1, tools)  # lint-imports/depcruise/go: không cái nào hợp rust
        self.assertIn(3, tools)  # jscpd áp dụng mọi stack
        self.assertIn("jscpd", tools[3]["có"] + tools[3]["thiếu"])
        self.assertNotIn(6, tools)  # N/A (không UI) bị bỏ qua


class ToolPresentTest(TmpDirCase):
    """Tất định, không phụ thuộc PATH của máy chạy test."""

    def test_xs_builtin_is_always_present(self):
        with unittest.mock.patch.object(xs.shutil, "which", return_value=None):
            self.assertTrue(xs._tool_present(self.tmp, "xs:ci-check"))

    def test_tool_on_path(self):
        with unittest.mock.patch.object(xs.shutil, "which", return_value="/usr/bin/gitleaks") as which:
            self.assertTrue(xs._tool_present(self.tmp, "gitleaks"))
        which.assert_called_once_with("gitleaks")

    def test_tool_in_node_modules_bin(self):
        (self.tmp / "node_modules" / ".bin").mkdir(parents=True)
        (self.tmp / "node_modules" / ".bin" / "jscpd").write_text("", encoding="utf-8")
        with unittest.mock.patch.object(xs.shutil, "which", return_value=None):
            self.assertTrue(xs._tool_present(self.tmp, "jscpd"))
            self.assertFalse(xs._tool_present(self.tmp, "lychee"))

    def test_python_tool_falls_back_to_importable_module(self):
        with (
            unittest.mock.patch.object(xs.shutil, "which", return_value=None),
            unittest.mock.patch.object(xs.importlib.util, "find_spec", return_value=object()) as spec,
        ):
            self.assertTrue(xs._tool_present(self.tmp, "pip-audit"))
            self.assertFalse(xs._tool_present(self.tmp, "osv-scanner"))  # không phải gói Python: không dò module
        spec.assert_called_once_with("pip_audit")


class ResolveRefTest(unittest.TestCase):
    FILES = ["a/x.py", "b/x.py", "c/y.py"]

    def test_exact_match(self):
        self.assertEqual(xs._resolve_ref("a/x.py", self.FILES), "a/x.py")

    def test_unique_suffix_match(self):
        self.assertEqual(xs._resolve_ref("y.py", self.FILES), "c/y.py")

    def test_ambiguous_suffix_is_none(self):
        self.assertIsNone(xs._resolve_ref("x.py", self.FILES))

    def test_unknown_is_none(self):
        self.assertIsNone(xs._resolve_ref("z.py", self.FILES))


class PathGroupsTest(unittest.TestCase):
    def test_groups_by_path_kind(self):
        cases = {
            ".github/workflows/ci.yml": [2, 8],
            ".gitlab-ci.yml": [2, 8],
            "package.json": [2, 7],
            "requirements-dev.txt": [2, 7],
            "tests/test_x.py": [4],
            "web/app.spec.ts": [4],
            "db/migrations/001.sql": [10],
            "prisma/schema.prisma": [10],
            "AGENTS.md": [9, 13],
            ".claude/hooks/guard.py": [1, 2, 3, 12, 13],
            ".env.local": [8, 11],
            "Dockerfile": [8, 11],
            "src/app.tsx": [1, 2, 3, 5, 6, 12],
            "styles/site.css": [5, 6],
            "README.md": [9],
            "src/main.py": [1, 2, 3, 12],
            "notes.txt": [],
        }
        for path, expected in cases.items():
            with self.subTest(path=path):
                self.assertEqual(xs._path_groups(path), expected)


class AuditStatusGroupsTest(TmpDirCase):
    def test_rows_with_non_numeric_number_are_ignored(self):
        f = self.tmp / "S.md"
        f.write_text(
            "## Nhóm\n\n| # | Mã | Trạng thái |\n|---|---|---|\n| x | FOO | N/A |\n| 1 | ARCH | đã quét |\n",
            encoding="utf-8",
        )
        groups = xs.audit_status_groups(f)
        self.assertEqual(list(groups), [1])
        self.assertEqual(groups[1]["Trạng thái"], "đã quét")

    def test_missing_table_gives_empty(self):
        f = self.tmp / "S.md"
        f.write_text("# trống\n", encoding="utf-8")
        self.assertEqual(xs.audit_status_groups(f), {})


class AuditRescanTest(TmpRepoCase):
    def test_up_to_date_group_and_empty_sha(self):
        self.init_repo()
        c1 = self.commit_files({"main.py": "1"}, 1_700_000_000)
        status = self.tmp / "S.md"
        groups = {1: ("đã quét", c1, "2026-10-14", ""), 3: ("đã quét", "", "2026-10-14", "")}
        status.write_text(audit_status_text(groups), encoding="utf-8")
        rescan = xs.audit_rescan(self.repo, status)
        self.assertNotIn(1, rescan)  # không file nào đổi từ SHA quét
        self.assertIn("SHA `—` không còn là tổ tiên HEAD", rescan[3])
        self.assertEqual(set(rescan), {3})  # còn lại N/A


class ShaOkTest(TmpRepoCase):
    def test_sha_validation(self):
        self.init_repo()
        c1 = self.commit_files({"a": "1"}, 1_700_000_000)
        self.assertEqual(xs._sha_ok(self.repo, "not-a-sha"), "SHA không hợp lệ")
        self.assertEqual(xs._sha_ok(self.repo, "abc"), "SHA không hợp lệ")  # quá ngắn
        self.assertIn("không có trong lịch sử", xs._sha_ok(self.repo, "deadbeef"))
        self.assertIsNone(xs._sha_ok(self.repo, c1))
        self.git("checkout", "-q", "--orphan", "other")
        self.commit_files({"b": "1"}, 1_700_000_100)
        self.assertIn("không phải tổ tiên HEAD", xs._sha_ok(self.repo, c1))


class StaleEvidenceTest(TmpRepoCase):
    def test_unreadable_blueprint_gives_empty(self):
        self.init_repo()
        self.assertEqual(xs.blueprint_stale_evidence(self.repo, self.repo / "khong-co.md", []), [])

    def test_skips_and_caches(self):
        self.init_repo()
        bp = (
            "- [ ] `A-001` **MUST** chưa tick — Bằng chứng: lib/a.py\n"
            "- [x] `A-002` **MUST** không ghi chú\n"
            "- [x] `A-003` **MUST** file lạ → Kiểm: x — Bằng chứng: khong-co.py:3 ghi chú\n"
            "- [x] `A-004` **MUST** lib đổi → Kiểm: x — Bằng chứng: lib/a.py:1\n"
            "- [~] `A-005` **MUST** lib đổi nữa → Kiểm: x — Miễn: lib/a.py không dùng\n"
            "- [x] `A-006` **MUST** file không đổi → Kiểm: x — Bằng chứng: b.py\n"
        )
        self.commit_files({"lib/a.py": "1", "b.py": "1", "BLUEPRINT.md": bp}, 1_700_000_000)
        self.commit_files({"lib/a.py": "2"}, 1_700_000_100)
        # dòng chưa commit: blame trả hash toàn số 0 → bỏ qua
        with (self.repo / "BLUEPRINT.md").open("a", encoding="utf-8") as f:
            f.write("- [x] `A-007` **MUST** mới sửa → Kiểm: x — Bằng chứng: lib/a.py\n")
        files = xs._repo_files(self.repo)
        stale = xs.blueprint_stale_evidence(self.repo, self.repo / "BLUEPRINT.md", files)
        self.assertEqual(
            stale,
            [
                {"id": "A-004", "kind": "Bằng chứng", "files": ["lib/a.py"]},
                {"id": "A-005", "kind": "Miễn", "files": ["lib/a.py"]},
            ],
        )

    def test_blueprint_not_tracked_is_skipped(self):
        self.init_repo()
        self.commit_files({"lib/a.py": "1"}, 1_700_000_000)
        bp = self.repo / "BLUEPRINT.md"  # chưa git add → blame lỗi
        bp.write_text("- [x] `A-001` **MUST** x → Kiểm: y — Bằng chứng: lib/a.py\n", encoding="utf-8")
        self.assertEqual(xs.blueprint_stale_evidence(self.repo, bp, xs._repo_files(self.repo)), [])


# --------------------------------------------------------------------------- audit check


class AuditCheckEdgeTest(TmpDirCase):
    def check(self, text: str, strict: bool = False) -> list[str]:
        f = self.tmp / "AUDIT-STATUS.md"
        f.write_text(text, encoding="utf-8")
        return xs.audit_check(f, strict=strict, today=xs._dt.date(2026, 10, 14))[0]

    def test_missing_both_tables(self):
        errors = self.check("# không có bảng\n")
        self.assertEqual(errors, ["thiếu bảng `## Nhóm`", "thiếu bảng `## Phát hiện`"])

    def test_invalid_group_state(self):
        errors = self.check(audit_status_text({1: ("bogus", "", "", "x")}))
        self.assertEqual(len(errors), 1)
        self.assertIn("nhóm 1: trạng thái `bogus` không thuộc", errors[0])

    def test_group_number_out_of_range(self):
        text = audit_status_text() + "\n"
        text = text.replace("| 13 | HAR |", "| 99 | HAR |")
        errors = self.check(text)
        self.assertIn("nhóm `99`: số nhóm phải 1–13", errors)
        self.assertIn("nhóm 13: phải có đúng 1 dòng (đang có 0)", errors)

    def test_finding_without_summary(self):
        row = "AUD-SEC-001 | 🟢 | mở |  | đo được: x |  | "
        errors = self.check(audit_status_text(findings=[row]))
        self.assertEqual(errors, ["AUD-SEC-001: thiếu Tóm tắt"])


# --------------------------------------------------------------------------- cmd_validate / list / compose / stats


class FrameworkCommandsTest(TmpDirCase):
    def setUp(self):
        super().setUp()
        self.fw = make_framework(self.tmp)

    def test_validate_ok(self):
        rc, out, _ = run_main("--framework", self.fw, "validate")
        self.assertEqual(rc, 0)
        self.assertRegex(out, r"^✓ Khung hợp lệ: \d+ file, 7 mục checklist\.\n$")

    def test_validate_reports_errors_and_exit_1(self):
        (self.fw / "08-backend" / "README.md").unlink()
        rc, out, _ = run_main("--framework", self.fw, "validate")
        self.assertEqual(rc, 1)
        self.assertIn("✗ ", out)
        self.assertRegex(out, r"\n\d+ lỗi\.\n$")

    def test_list_profiles(self):
        rc, out, _ = run_main("--framework", self.fw, "list", "profiles")
        self.assertEqual(rc, 0)
        lines = out.splitlines()
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("cli-tool"))  # sắp theo đường dẫn: cli-tool < web-app
        self.assertIn("CLI tool  (0 mục)", lines[0])
        self.assertTrue(lines[1].startswith("web-app"))
        self.assertIn("Web app  (1 mục)", lines[1])

    def test_list_industries(self):
        rc, out, _ = run_main("--framework", self.fw, "list", "industries")
        self.assertEqual(rc, 0)
        self.assertEqual(out.split(), ["fintech", "Fintech", "(1", "mục)"])

    def test_list_modules_uses_path_when_no_slug(self):
        rc, out, _ = run_main("--framework", self.fw, "list", "modules")
        self.assertEqual(rc, 0)
        labels = [ln.split()[0] for ln in out.splitlines()]
        self.assertEqual(labels, ["01-baseline/security", "08-backend/api", "08-backend/cli-only"])

    def test_compose_to_stdout(self):
        rc, out, _ = run_main("--framework", self.fw, "compose", "--profile", "web-app", "--industry", "fintech")
        self.assertEqual(rc, 0)
        self.assertIn("`BE-API-001`", out)
        self.assertIn("`IND-FIN-001`", out)
        self.assertNotIn("BE-CLI-001", out)
        self.assertNotIn("BE-API-999", out)

    def test_compose_to_file_then_recompose_keeps_state(self):
        target = self.tmp / "BLUEPRINT.md"
        rc, out, _ = run_main("--framework", self.fw, "compose", "--profile", "web-app", "--out", target)
        self.assertEqual(rc, 0)
        self.assertIn(f"✓ Đã ghi {target}", out)
        target.write_text(
            target.read_text(encoding="utf-8").replace("- [ ] `BE-API-001`", "- [x] `BE-API-001`"), "utf-8"
        )
        rc, out, err = run_main("--framework", self.fw, "compose", "--profile", "web-app", "--out", target)
        self.assertEqual(rc, 0)
        self.assertIn("Giữ trạng thái 1 mục", err)
        self.assertIn("- [x] `BE-API-001`", target.read_text(encoding="utf-8"))

    def test_stats(self):
        rc, out, _ = run_main("--framework", self.fw, "stats")
        self.assertEqual(rc, 0)
        lines = out.splitlines()
        self.assertIn("baseline=1", lines[0])
        self.assertIn("module=2", lines[0])
        self.assertEqual(lines[1], "Mục theo mức:   MUST=4, SHOULD=2, MAY=1")
        self.assertEqual(lines[2], "Tổng mục:       7")

    def test_missing_framework_dir_for_each_framework_command(self):
        for cmd in (["validate"], ["list", "profiles"], ["stats"], ["compose", "--profile", "x"]):
            with self.subTest(cmd=cmd):
                rc, out, err = run_main("--framework", self.tmp / "khong-co", *cmd)
                self.assertEqual((rc, out), (2, ""))
                self.assertIn("Không thấy thư mục khung", err)


# --------------------------------------------------------------------------- blueprint-status


class BlueprintStatusTextTest(TmpDirCase):
    def test_text_output_with_open_must_and_bad_waiver(self):
        f = self.tmp / "BLUEPRINT.md"
        f.write_text(
            "- [ ] `A-001` **MUST** mở → Kiểm: x\n"
            "- [~] `A-002` **SHOULD** miễn thiếu lý do\n"
            "- [x] `A-003` **MAY** xong\n",
            encoding="utf-8",
        )
        rc, out, _ = run_main("blueprint-status", f)
        self.assertEqual(rc, 0)
        self.assertIn("MUST    đạt    0 · miễn    0 · chưa    1", out)
        self.assertIn("SHOULD  đạt    0 · miễn    1 · chưa    0", out)
        self.assertIn("MAY     đạt    1 · miễn    0 · chưa    0", out)
        self.assertIn("✗ Miễn trừ thiếu lý do: A-002 (dòng 2)", out)
        self.assertIn("Còn 1 mục MUST chưa đạt: A-001", out)
        rc, _, _ = run_main("blueprint-status", f, "--strict")
        self.assertEqual(rc, 1)

    def test_text_output_ok_is_silent_on_problems(self):
        f = self.tmp / "BLUEPRINT.md"
        f.write_text("- [x] `A-001` **MUST** xong → Kiểm: x — Bằng chứng: y\n", encoding="utf-8")
        rc, out, _ = run_main("blueprint-status", f, "--strict")
        self.assertEqual(rc, 0)
        self.assertNotIn("✗", out)
        self.assertNotIn("Còn", out)

    def test_json_strict_fails_on_open_must(self):
        rc, out, _ = run_main("blueprint-status", "-", "--json", "--strict", stdin="- [ ] `A-001` **MUST** mở\n")
        self.assertEqual(rc, 1)
        self.assertFalse(json.loads(out)["ok"])


# --------------------------------------------------------------------------- loop


class LoopCommandsTest(TmpDirCase):
    def setUp(self):
        super().setUp()
        self.env = self.enterContext(unittest.mock.patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(self.tmp)}))
        os.environ.pop("XS_DEBUG", None)

    def write_plan(self, text: str = "- [ ] `T-001` làm gì đó — Gate: `true`\n") -> None:
        p = self.tmp / "docs" / "autopilot" / "PLAN.md"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def test_init_without_plan_is_exit_2(self):
        rc, out, err = run_main("loop", "init")
        self.assertEqual((rc, out), (2, ""))
        self.assertIn("✗ Không thấy docs/autopilot/PLAN.md", err)
        self.assertIsNone(xs.read_state(self.tmp))

    def test_init_then_status_text_and_json(self):
        self.write_plan()
        rc, out, _ = run_main("loop", "init", "--max-iterations", "7")
        self.assertEqual(rc, 0)
        self.assertIn("trần=7 vòng", out)
        rc, out, _ = run_main("loop", "status")
        self.assertEqual(rc, 0)
        self.assertTrue(out.startswith("verdict: continue — làm task T-001"))
        rc, out, _ = run_main("loop", "status", "--json")
        data = json.loads(out)
        self.assertEqual((rc, data["verdict"], data["task"], data["iterations"]), (0, "continue", "T-001", 0))

    def test_status_json_when_inactive(self):
        rc, out, _ = run_main("loop", "status", "--json")
        data = json.loads(out)
        self.assertEqual((rc, data["verdict"], data["iterations"]), (0, "inactive", 0))

    def test_record_requires_command(self):
        for argv in (["loop", "record", "--task", "T-001"], ["loop", "record", "--task", "T-001", "--"]):
            with self.subTest(argv=argv):
                rc, out, err = run_main(*argv)
                self.assertEqual((rc, out), (2, ""))
                self.assertIn("Thiếu lệnh kiểm sau '--'", err)
        self.assertFalse((self.tmp / ".autopilot" / "evidence").exists())

    def test_record_runs_command_and_writes_evidence(self):
        rc, out, _ = run_main("loop", "record", "--task", "T-001", "--", "true")
        self.assertEqual(rc, 0)
        self.assertIn("T-001: exit 0", out)
        self.assertEqual(xs.read_evidence("T-001", self.tmp)["exit_code"], 0)

    def test_block_without_state_creates_blocked_state(self):
        rc, out, _ = run_main("loop", "block", "--reason", "cần người quyết")
        st = xs.read_state(self.tmp)
        self.assertEqual((rc, out), (0, "■ BLOCKED: cần người quyết\n"))
        self.assertTrue(st["active"] and st["blocked"])
        self.assertEqual(st["blocked_reason"], "cần người quyết")

    def test_resume_without_state_is_exit_2(self):
        rc, out, err = run_main("loop", "resume")
        self.assertEqual((rc, out), (2, ""))
        self.assertIn("Chưa có vòng lặp", err)

    def test_stop_without_state_is_noop(self):
        rc, out, _ = run_main("loop", "stop")
        self.assertEqual((rc, out), (0, "■ Autopilot tắt.\n"))
        self.assertIsNone(xs.read_state(self.tmp))

    def test_stop_with_state_deactivates(self):
        self.write_plan()
        run_main("loop", "init")
        rc, out, _ = run_main("loop", "stop", "--reason", "xong việc")
        st = xs.read_state(self.tmp)
        self.assertEqual((rc, out), (0, "■ Autopilot tắt.\n"))
        self.assertFalse(st["active"])
        self.assertEqual(st["stop_reason"], "xong việc")
        self.assertIn("ended", st)
        self.assertEqual(xs.loop_verdict(self.tmp)["verdict"], "inactive")

    def test_hook_stop_blocks_with_json_when_work_remains(self):
        self.write_plan()
        run_main("loop", "init")
        rc, out, err = run_main("loop", "hook-stop", stdin="{}")
        self.assertEqual((rc, err), (0, ""))
        decision = json.loads(out)
        self.assertEqual(decision["decision"], "block")
        self.assertIn("autopilot vòng 1/50", decision["reason"])
        self.assertEqual(xs.read_state(self.tmp)["iterations"], 1)

    def test_hook_stop_allows_stop_when_inactive(self):
        rc, out, err = run_main("loop", "hook-stop", stdin="{}")
        self.assertEqual((rc, out, err), (0, "", ""))

    def test_hook_stop_without_piped_stdin_uses_tty_branch(self):
        fake = unittest.mock.Mock()
        fake.isatty.return_value = True
        fake.read.side_effect = AssertionError("không được đọc stdin khi là tty")
        with unittest.mock.patch.object(sys, "stdin", fake), redirect_stdout(io.StringIO()) as out:
            rc = xs.main(["loop", "hook-stop"])
        self.assertEqual((rc, out.getvalue()), (0, ""))
        fake.read.assert_not_called()  # fail-open nuốt mọi exception nên phải kiểm trực tiếp

    def test_hook_stop_exception_is_fail_open(self):
        with unittest.mock.patch.object(xs, "hook_stop", side_effect=RuntimeError("boom")):
            rc, out, err = run_main("loop", "hook-stop", stdin="{}")
        self.assertEqual((rc, out), (0, ""))
        self.assertIn("[xs hook-stop] lỗi, cho dừng: RuntimeError: boom", err)

    def test_hook_stop_propagates_exit_code(self):
        with unittest.mock.patch.object(xs, "hook_stop", return_value=("", 3)):
            rc, out, _ = run_main("loop", "hook-stop", stdin="")
        self.assertEqual((rc, out), (3, ""))

    def test_unknown_loop_subcommand_returns_2(self):
        import argparse

        self.assertEqual(xs.cmd_loop(argparse.Namespace(loop_cmd="khong-co")), 2)


# --------------------------------------------------------------------------- audit CLI


class AuditPlanCliTest(TmpRepoCase):
    def setUp(self):
        super().setUp()
        self.enterContext(unittest.mock.patch.dict(os.environ, {"CLAUDE_PROJECT_DIR": str(self.tmp)}))

    def point_at(self, root: Path) -> None:
        os.environ["CLAUDE_PROJECT_DIR"] = str(root)

    def test_text_report_with_stale_evidence_and_rescan(self):
        self.init_repo()
        self.point_at(self.repo)
        bp = "- [x] `A-001` **MUST** a → Kiểm: x — Bằng chứng: main.py:1 chạy được\n"
        c1 = self.commit_files({"main.py": "1", "BLUEPRINT.md": bp}, 1_700_000_000)
        groups = {1: ("đã quét", c1, "2026-10-14", "")}
        self.commit_files({"docs/ops/AUDIT-STATUS.md": audit_status_text(groups)}, 1_700_000_050)
        self.commit_files({"main.py": "2"}, 1_700_000_100)
        head = self.git("rev-parse", "HEAD")
        rc, out, err = run_main("audit", "plan")
        self.assertEqual((rc, err), (0, ""))
        self.assertIn(f"Audit plan — {self.repo} @ {head[:12]}", out)
        self.assertIn("mã: python 1", out)
        self.assertIn("harness: BLUEPRINT.md", out)
        self.assertNotIn("REPO KHUNG", out)
        self.assertRegex(out, r"\n   1 ARCH  áp dụng  python 1  \[có: [^\]]* · thiếu: [^\]]*\]\n")
        self.assertIn("Bằng chứng/miễn trừ blueprint trỏ file đã đổi sau khi ghi (1)", out)
        self.assertRegex(out, r"  A-001 +Bằng chứng +← main\.py")
        self.assertIn("Quét lại theo AUDIT-STATUS:\n", out)
        self.assertIn(f"1 file đổi từ `{c1[:7]}` (vd main.py)", out)
        self.assertTrue(out.rstrip().endswith("framework/00-method/audit.md"))

    def test_stale_list_is_truncated_at_25(self):
        self.init_repo()
        self.point_at(self.repo)
        self.commit_files({"a.py": "1"}, 1_700_000_000)
        real = xs.audit_plan

        def fake(*a, **k):
            plan = real(*a, **k)
            plan["stale_evidence"] = [{"id": f"A-{i:03d}", "kind": "Miễn", "files": ["a.py"]} for i in range(1, 28)]
            return plan

        with unittest.mock.patch.object(xs, "audit_plan", side_effect=fake):
            rc, out, _ = run_main("audit", "plan")
        self.assertEqual(rc, 0)
        self.assertIn("(27) — xác minh lại", out)
        self.assertIn("A-025", out)
        self.assertNotIn("A-026", out)
        self.assertIn("… và 2 mục nữa (--json để xem hết)", out)

    def test_non_git_framework_repo_with_clean_status(self):
        root = self.tmp / "proj"
        for rel in ("framework/00-method/conventions.md", "scripts/xs.py", "AGENTS.md", ".claude/settings.json"):
            p = root / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text("x", encoding="utf-8")
        status = root / "docs" / "ops" / "AUDIT-STATUS.md"
        status.parent.mkdir(parents=True)
        status.write_text(audit_status_text(), encoding="utf-8")  # mọi nhóm N/A → không nhóm nào cần quét lại
        self.point_at(root)
        rc, out, _ = run_main("audit", "plan")
        self.assertEqual(rc, 0)
        self.assertIn("@ không có git", out)
        self.assertIn("· REPO KHUNG", out)
        self.assertIn("harness: AGENTS.md, .claude/", out)
        self.assertIn("Quét lại theo AUDIT-STATUS: không nhóm nào đổi", out)
        self.assertNotIn("Bằng chứng/miễn trừ blueprint", out)

    def test_explicit_blueprint_and_missing_status(self):
        root = self.tmp / "proj"
        root.mkdir()
        (root / "main.py").write_text("x", encoding="utf-8")
        self.point_at(root)
        rc, out, _ = run_main("audit", "plan", "--blueprint", root / "khong-co.md", "--status", root / "khong-co-S.md")
        self.assertEqual(rc, 0)
        self.assertNotIn("Quét lại theo AUDIT-STATUS", out)
        self.assertNotIn("Bằng chứng/miễn trừ blueprint", out)
        self.assertIn("mã: python 1", out)

    def test_json_output_still_works(self):
        root = self.tmp / "proj"
        root.mkdir()
        self.point_at(root)
        rc, out, _ = run_main("audit", "plan", "--json")
        data = json.loads(out)
        self.assertEqual((rc, data["head"], data["rescan"], len(data["groups"])), (0, None, None, 13))


class AuditCheckCliTest(TmpDirCase):
    def test_summary_lines(self):
        f = self.tmp / "S.md"
        f.write_text(audit_status_text(), encoding="utf-8")
        rc, out, _ = run_main("audit", "check", f)
        self.assertEqual((rc, out), (0, f"✓ {f}: nhóm N/A 13\n"))
        f.write_text("# trống\n", encoding="utf-8")
        rc, out, _ = run_main("audit", "check", f, "--strict")
        self.assertEqual(rc, 1)
        self.assertIn(f"✗ {f}: thiếu bảng `## Nhóm`", out)
        self.assertTrue(out.rstrip().endswith(f"✗ {f}: trống (--strict)"))


# --------------------------------------------------------------------------- version / main


class VersionAndMainTest(TmpDirCase):
    def test_framework_version_unknown_without_file(self):
        scripts = self.tmp / "scripts"
        scripts.mkdir()
        with unittest.mock.patch.object(xs, "SCRIPT_DIR", scripts):
            self.assertEqual(xs.framework_version(), "unknown")
            (self.tmp / "VERSION").write_text(" 1.2.3\n", encoding="utf-8")
            self.assertEqual(xs.framework_version(), "1.2.3")

    def test_oserror_is_one_line_unless_debug(self):
        missing = self.tmp / "khong-co.md"
        with unittest.mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("XS_DEBUG", None)
            rc, out, err = run_main("progress-check", missing)
        self.assertEqual((rc, out), (2, ""))
        self.assertTrue(err.startswith("✗ "))
        self.assertEqual(len(err.splitlines()), 1)

    def test_oserror_reraised_with_xs_debug(self):
        missing = self.tmp / "khong-co.md"
        with unittest.mock.patch.dict(os.environ, {"XS_DEBUG": "1"}):
            with self.assertRaises(OSError):
                run_main("progress-check", missing)

    def test_no_subcommand_is_usage_error(self):
        with redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as cm:
            xs.main([])
        self.assertEqual(cm.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
