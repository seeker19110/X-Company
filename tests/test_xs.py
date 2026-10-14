"""Test cho scripts/xs.py — chạy: python3 -m unittest discover -s tests -v"""

from __future__ import annotations

import argparse
import io
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
import unittest.mock
from contextlib import redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import xs  # noqa: E402


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(text).lstrip("\n"), encoding="utf-8")


def make_framework(tmp: Path) -> Path:
    fw = tmp / "framework"
    write(
        fw / "README.md",
        """
        ---
        title: Khung
        kind: index
        updated: 2026-10-13
        ---

        # Khung
        """,
    )
    for d in ("01-baseline", "02-profiles", "03-industries", "08-backend"):
        write(
            fw / d / "README.md",
            f"""
            ---
            title: {d}
            kind: index
            updated: 2026-10-13
            ---

            # {d}
            """,
        )
    write(
        fw / "01-baseline" / "security.md",
        """
        ---
        title: Bảo mật nền
        kind: baseline
        prefix: BASE-SEC
        applies_to: [all]
        updated: 2026-10-13
        ---

        # Bảo mật nền

        ## Checklist

        - [ ] `BASE-SEC-001` **MUST** Không commit bí mật. → Kiểm: gitleaks trong CI.
        - [ ] `BASE-SEC-002` **MUST@L** Kiểm toán độc lập. → Kiểm: báo cáo kiểm toán.
        - [ ] `BASE-SEC-003` **MAY** Bug bounty.

        ## Nguồn

        - x
        """,
    )
    write(
        fw / "08-backend" / "api.md",
        """
        ---
        title: API
        kind: module
        prefix: BE-API
        applies_to: [web-app]
        updated: 2026-10-13
        ---

        # API

        ## Checklist

        - [ ] `BE-API-001` **MUST** Lỗi theo RFC 9457. → Kiểm: test contract.

        ```markdown
        - [ ] `BE-API-999` **MUST** ví dụ trong code fence không được tính
        ```

        ## Nguồn

        - y
        """,
    )
    write(
        fw / "08-backend" / "cli-only.md",
        """
        ---
        title: CLI only
        kind: module
        prefix: BE-CLI
        applies_to: [cli-tool]
        updated: 2026-10-13
        ---

        # CLI only

        ## Checklist

        - [ ] `BE-CLI-001` **SHOULD** Chỉ cho CLI.

        ## Nguồn

        - z
        """,
    )
    write(
        fw / "02-profiles" / "web-app.md",
        """
        ---
        title: Web app
        kind: profile
        slug: web-app
        prefix: PRF-WEB
        modules: [08-backend/*]
        updated: 2026-10-13
        ---

        # Web app

        ## Checklist

        - [ ] `PRF-WEB-001` **SHOULD** PWA khi cần offline.

        ## Nguồn

        - w
        """,
    )
    write(
        fw / "02-profiles" / "cli-tool.md",
        """
        ---
        title: CLI tool
        kind: profile
        slug: cli-tool
        modules: [08-backend/cli-only]
        updated: 2026-10-13
        ---

        # CLI tool

        ## Nguồn

        - c
        """,
    )
    write(
        fw / "03-industries" / "fintech.md",
        """
        ---
        title: Fintech
        kind: industry
        slug: fintech
        prefix: IND-FIN
        modules: []
        updated: 2026-10-13
        ---

        # Fintech

        ## Checklist

        - [ ] `IND-FIN-001` **MUST** Tiền dùng số nguyên đơn vị nhỏ nhất. → Kiểm: test kiểu.

        ## Nguồn

        - f
        """,
    )
    return fw


class FrontmatterTest(unittest.TestCase):
    def test_parse_list_and_scalar(self):
        meta, body, n = xs.parse_frontmatter("---\ntitle: A\nmodules: [a/b, c/*]\n---\n# A\n")
        self.assertEqual(meta["title"], "A")
        self.assertEqual(meta["modules"], ["a/b", "c/*"])
        self.assertEqual(n, 4)
        self.assertTrue(body.startswith("# A"))

    def test_missing_frontmatter(self):
        with self.assertRaises(xs.FrontmatterError):
            xs.parse_frontmatter("# no fm\n")

    def test_unclosed_frontmatter(self):
        with self.assertRaises(xs.FrontmatterError):
            xs.parse_frontmatter("---\ntitle: A\n")


class ValidateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.fw = make_framework(self.tmp)

    def test_valid_fixture(self):
        self.assertEqual(xs.validate(self.fw), [])

    def test_fenced_items_ignored(self):
        docs, _ = xs.load_docs(self.fw)
        ids = {it.id for d in docs for it in d.items}
        self.assertNotIn("BE-API-999", ids)

    def test_duplicate_id(self):
        p = self.fw / "08-backend" / "api.md"
        p.write_text(
            p.read_text(encoding="utf-8").replace("## Nguồn", "- [ ] `BE-API-001` **SHOULD** trùng.\n\n## Nguồn", 1),
            encoding="utf-8",
        )
        errs = xs.validate(self.fw)
        self.assertTrue(any("ID trùng BE-API-001" in e for e in errs), errs)

    def test_must_without_check(self):
        p = self.fw / "08-backend" / "api.md"
        p.write_text(p.read_text(encoding="utf-8").replace(" → Kiểm: test contract.", ""), encoding="utf-8")
        errs = xs.validate(self.fw)
        self.assertTrue(any("thiếu '→ Kiểm:'" in e for e in errs), errs)

    def test_module_must_at_m_capped(self):
        p = self.fw / "08-backend" / "api.md"
        extra = "".join(f"- [ ] `BE-API-0{n}` **MUST** x. → Kiểm: y.\n" for n in range(10, 10 + xs.MAX_MUST_AT_M))
        p.write_text(p.read_text(encoding="utf-8").replace("## Nguồn", extra + "\n## Nguồn", 1), encoding="utf-8")
        errs = xs.validate(self.fw)
        self.assertTrue(any("MUST hiệu lực ở quy mô M" in e for e in errs), errs)
        p.write_text(p.read_text(encoding="utf-8").replace("**MUST** x.", "**MUST@L** x."), encoding="utf-8")
        self.assertEqual(xs.validate(self.fw), [])  # MUST@L không tính vào trần M

    def test_prefix_mismatch(self):
        p = self.fw / "08-backend" / "api.md"
        p.write_text(p.read_text(encoding="utf-8").replace("`BE-API-001`", "`BE-XYZ-001`"), encoding="utf-8")
        errs = xs.validate(self.fw)
        self.assertTrue(any("không khớp prefix" in e for e in errs), errs)

    def test_malformed_item_reported(self):
        p = self.fw / "08-backend" / "api.md"
        p.write_text(
            p.read_text(encoding="utf-8").replace("## Nguồn", "- [ ] `BE-API-002` MUST thiếu in đậm.\n\n## Nguồn", 1),
            encoding="utf-8",
        )
        errs = xs.validate(self.fw)
        self.assertTrue(any("sai định dạng" in e for e in errs), errs)

    def test_broken_link(self):
        p = self.fw / "08-backend" / "api.md"
        p.write_text(p.read_text(encoding="utf-8") + "\n[x](khong-co.md)\n", encoding="utf-8")
        errs = xs.validate(self.fw)
        self.assertTrue(any("liên kết hỏng" in e for e in errs), errs)

    def test_missing_module_in_profile(self):
        p = self.fw / "02-profiles" / "cli-tool.md"
        p.write_text(
            p.read_text(encoding="utf-8").replace("08-backend/cli-only", "08-backend/khong-co"), encoding="utf-8"
        )
        errs = xs.validate(self.fw)
        self.assertTrue(any("không tồn tại" in e for e in errs), errs)

    def test_missing_readme_in_dir(self):
        (self.fw / "09-database").mkdir()
        (self.fw / "09-database" / "x.md").write_text(
            "---\ntitle: X\nkind: method\nupdated: 2026-10-13\n---\n# X\n", encoding="utf-8"
        )
        errs = xs.validate(self.fw)
        self.assertTrue(any("thiếu README.md" in e for e in errs), errs)

    def test_unknown_applies_to(self):
        p = self.fw / "08-backend" / "api.md"
        p.write_text(p.read_text(encoding="utf-8").replace("[web-app]", "[khong-co-ho-so]"), encoding="utf-8")
        errs = xs.validate(self.fw)
        self.assertTrue(any("applies_to" in e for e in errs), errs)


class ComposeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.fw = make_framework(self.tmp)

    def test_compose_web_fintech_scale_m(self):
        out = xs.compose(self.fw, "web-app", ["fintech"], "M", include_may=False, today="2026-10-13")
        self.assertIn("`BASE-SEC-001` **MUST**", out)
        self.assertIn("`BASE-SEC-002` **SHOULD**", out)  # MUST@L hạ xuống ở quy mô M
        self.assertNotIn("BASE-SEC-003", out)  # MAY bị bỏ khi không --include-may
        self.assertIn("`BE-API-001` **MUST**", out)
        self.assertNotIn("BE-CLI-001", out)  # applies_to chỉ cli-tool
        self.assertIn("`PRF-WEB-001`", out)
        self.assertIn("`IND-FIN-001` **MUST**", out)
        self.assertIn("generated: 2026-10-13", out)

    def test_compose_scale_s_keeps_floor_demotes_modules(self):
        out = xs.compose(self.fw, "web-app", ["fintech"], "S", include_may=False, today="2026-10-13")
        self.assertIn("`BASE-SEC-001` **MUST**", out)  # baseline: sàn, giữ MUST
        self.assertIn("`IND-FIN-001` **MUST**", out)  # gói ngành: giữ MUST
        self.assertIn("`BE-API-001` **SHOULD**", out)  # module chuyên sâu: S hạ SHOULD
        self.assertIn("`BASE-SEC-002` **SHOULD**", out)  # MUST@L vẫn hạ

    def test_compose_scale_l_keeps_must(self):
        out = xs.compose(self.fw, "web-app", [], "L", include_may=True, today="2026-10-13")
        self.assertIn("`BASE-SEC-002` **MUST**", out)
        self.assertIn("`BASE-SEC-003` **MAY**", out)

    def test_compose_add_extra_module_bypasses_applies_to(self):
        out = xs.compose(
            self.fw, "web-app", [], "M", include_may=False, today="2026-10-13", extra=["08-backend/cli-only"]
        )
        self.assertIn("`BE-CLI-001`", out)  # applies_to chỉ cli-tool nhưng --add là có chủ đích
        self.assertIn("extra: [08-backend/cli-only]", out)
        with self.assertRaises(SystemExit):
            xs.compose(self.fw, "web-app", [], "M", include_may=False, extra=["08-backend/khong-co"])

    def test_compose_filters_standards_by_applies_to(self):
        write(self.fw / "04-standards" / "README.md", "---\ntitle: S\nkind: index\nupdated: 2026-10-14\n---\n\n# S\n")
        write(
            self.fw / "04-standards" / "a11y.md",
            """
            ---
            title: A11y
            kind: standard
            prefix: STD-A11Y
            applies_to: [web-app]
            updated: 2026-10-14
            ---

            # A11y

            ## Checklist

            - [ ] `STD-A11Y-001` **MUST** WCAG 2.2 AA. → Kiểm: axe.

            ## Nguồn

            - w
            """,
        )
        p = self.fw / "02-profiles" / "cli-tool.md"
        p.write_text(
            p.read_text(encoding="utf-8").replace("[08-backend/cli-only]", "[08-backend/cli-only, 04-standards/*]"),
            encoding="utf-8",
        )
        self.assertEqual(xs.validate(self.fw), [])
        self.assertNotIn("STD-A11Y-001", xs.compose(self.fw, "cli-tool", [], "M", include_may=False))
        self.assertIn(
            "STD-A11Y-001", xs.compose(self.fw, "web-app", [], "M", include_may=False, extra=["04-standards/*"])
        )

    def test_compose_rebases_relative_links(self):
        p = self.fw / "08-backend" / "api.md"
        p.write_text(
            p.read_text(encoding="utf-8").replace(
                "→ Kiểm: test contract.",
                "Xem [`X`](../01-baseline/security.md#a), [web](https://x.y). → Kiểm: test contract.",
            ),
            encoding="utf-8",
        )
        os.environ["XS_FRAMEWORK_LINK"] = ".xstored/framework"
        try:
            out = xs.compose(self.fw, "web-app", [], "M", include_may=False)
        finally:
            os.environ.pop("XS_FRAMEWORK_LINK", None)
        self.assertIn("(.xstored/framework/01-baseline/security.md#a)", out)
        self.assertIn("(https://x.y)", out)

    def test_compose_unknown_profile(self):
        with self.assertRaises(SystemExit):
            xs.compose(self.fw, "khong-co", [], "M", include_may=False)

    def test_blueprint_roundtrip_status(self):
        out = xs.compose(self.fw, "web-app", ["fintech"], "M", include_may=False, today="2026-10-13")
        bp = self.tmp / "BLUEPRINT.md"
        bp.write_text(out, encoding="utf-8")
        s = xs.blueprint_status(bp)
        self.assertEqual(s["levels"]["MUST"]["open"], 3)
        text = out.replace("- [ ] `BASE-SEC-001`", "- [x] `BASE-SEC-001`")
        text = text.replace("- [ ] `BE-API-001`", "- [~] `BE-API-001`")  # miễn trừ thiếu lý do
        bp.write_text(text, encoding="utf-8")
        s = xs.blueprint_status(bp)
        self.assertEqual(s["levels"]["MUST"]["done"], 1)
        self.assertEqual(s["open_must"], ["IND-FIN-001"])
        self.assertEqual(len(s["bad_waivers"]), 1)


class LoopTest(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp())
        write(
            self.base / "docs" / "autopilot" / "PLAN.md",
            """
            # PLAN
            - [ ] `T-001` Viết hàm cộng — Gate: `python3 -c "import sys; sys.exit(0)"`
            - [ ] `T-002` Viết test
            """,
        )
        self.env = dict(os.environ, CLAUDE_PROJECT_DIR=str(self.base))
        self._old = os.environ.get("CLAUDE_PROJECT_DIR")
        os.environ["CLAUDE_PROJECT_DIR"] = str(self.base)

    def tearDown(self):
        if self._old is None:
            os.environ.pop("CLAUDE_PROJECT_DIR", None)
        else:
            os.environ["CLAUDE_PROJECT_DIR"] = self._old

    def run_cli(self, *args) -> int:
        with redirect_stdout(io.StringIO()):
            return xs.main(list(args))

    def test_inactive_allows_stop(self):
        out, code = xs.hook_stop("{}", self.base)
        self.assertEqual((out, code), ("", 0))

    def test_continue_then_verify_then_done(self):
        self.assertEqual(self.run_cli("loop", "init", "--max-iterations", "10"), 0)
        v = xs.loop_verdict(self.base)
        self.assertEqual((v["verdict"], v["task"]), ("continue", "T-001"))
        out, _ = xs.hook_stop("{}", self.base)
        self.assertEqual(json.loads(out)["decision"], "block")
        self.assertEqual(xs.read_state(self.base)["iterations"], 1)

        plan = self.base / "docs" / "autopilot" / "PLAN.md"
        plan.write_text(plan.read_text(encoding="utf-8").replace("- [ ] `T-001`", "- [x] `T-001`"), encoding="utf-8")
        v = xs.loop_verdict(self.base)
        self.assertEqual((v["verdict"], v["task"]), ("verify", "T-001"))  # tick mà chưa có bằng chứng

        # Bằng chứng chạy lệnh KHÁC với Gate khai báo -> vẫn verify
        with redirect_stdout(io.StringIO()):
            xs.loop_record("T-001", ["true"], self.base)
        self.assertEqual(xs.loop_verdict(self.base)["verdict"], "verify")

        with redirect_stdout(io.StringIO()):
            code = xs.loop_record("T-001", ['python3 -c "import sys; sys.exit(0)"'], self.base)
        self.assertEqual(code, 0)
        v = xs.loop_verdict(self.base)
        self.assertEqual((v["verdict"], v["task"]), ("continue", "T-002"))

        plan.write_text(plan.read_text(encoding="utf-8").replace("- [ ] `T-002`", "- [x] `T-002`"), encoding="utf-8")
        with redirect_stdout(io.StringIO()):
            xs.loop_record("T-002", ["true"], self.base)
        self.assertEqual(xs.loop_verdict(self.base)["verdict"], "done")
        out, code = xs.hook_stop("{}", self.base)
        self.assertEqual((out, code), ("", 0))
        self.assertFalse(xs.read_state(self.base)["active"])

    def test_same_failure_three_times_blocks(self):
        self.run_cli("loop", "init")
        with redirect_stdout(io.StringIO()):
            for _ in range(3):
                xs.loop_record("T-001", ["sh -c 'echo boom at line 12; exit 3'"], self.base)
        v = xs.loop_verdict(self.base)
        self.assertEqual(v["verdict"], "blocked")
        out, _ = xs.hook_stop("{}", self.base)
        self.assertEqual(out, "")  # blocked -> cho dừng

    def test_different_failures_do_not_block(self):
        self.run_cli("loop", "init")
        with redirect_stdout(io.StringIO()):
            xs.loop_record("T-001", ["sh -c 'echo A; exit 1'"], self.base)
            xs.loop_record("T-001", ["sh -c 'echo B; exit 1'"], self.base)
            xs.loop_record("T-001", ["sh -c 'echo C; exit 1'"], self.base)
        self.assertEqual(xs.loop_verdict(self.base)["verdict"], "continue")

    def test_iteration_cap(self):
        self.run_cli("loop", "init", "--max-iterations", "2")
        for _ in range(2):
            out, _ = xs.hook_stop("{}", self.base)
            self.assertIn("block", out)
        self.assertEqual(xs.loop_verdict(self.base)["verdict"], "budget")
        out, _ = xs.hook_stop("{}", self.base)
        self.assertEqual(out, "")

    def test_manual_block(self):
        self.run_cli("loop", "init")
        self.run_cli("loop", "block", "--reason", "cần duyệt thanh toán thật")
        v = xs.loop_verdict(self.base)
        self.assertEqual(v["verdict"], "blocked")
        self.assertIn("thanh toán", v["reason"])

    def test_resume_clears_block_and_failure_streak(self):
        self.run_cli("loop", "init")
        with redirect_stdout(io.StringIO()):
            for _ in range(3):
                xs.loop_record("T-001", ["sh -c 'echo boom; exit 3'"], self.base)
        self.assertEqual(xs.loop_verdict(self.base)["verdict"], "blocked")
        out, _ = xs.hook_stop("{}", self.base)  # blocked -> cho dừng, active=false
        self.assertFalse(xs.read_state(self.base)["active"])
        self.assertEqual(self.run_cli("loop", "resume", "--reason", "đã sửa tay"), 0)
        st = xs.read_state(self.base)
        self.assertTrue(st["active"])
        self.assertEqual(st["same_failure_count"], 0)
        self.assertEqual(xs.loop_verdict(self.base)["verdict"], "continue")

    def test_cli_hook_stop_fail_open_on_garbage(self):
        r = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "xs.py"), "loop", "hook-stop"],
            input="not json",
            capture_output=True,
            text=True,
            env=self.env,
        )
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "")


class AuditRegressionTest(unittest.TestCase):
    """Lỗi tái hiện khi dogfood khung trên chính repo (2026-10-14)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.fw = make_framework(self.tmp)

    def cli(self, *args, env=None) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "xs.py"), *args],
            capture_output=True,
            text=True,
            cwd=self.tmp,
            env=dict(os.environ, **(env or {})),
        )

    def test_compose_out_keeps_existing_states_by_id(self):
        bp = self.tmp / "BP.md"
        self.assertEqual(
            self.cli("--framework", str(self.fw), "compose", "--profile", "web-app", "--out", str(bp)).returncode, 0
        )
        text = bp.read_text(encoding="utf-8").replace(
            "- [ ] `BASE-SEC-001` **MUST** Không commit bí mật. → Kiểm: gitleaks trong CI.",
            "- [x] `BASE-SEC-001` **MUST** Không commit bí mật. → Kiểm: gitleaks trong CI. — Bằng chứng: ci.yml:10",
        )
        bp.write_text(text, encoding="utf-8")
        r = self.cli("--framework", str(self.fw), "compose", "--profile", "web-app", "--out", str(bp))
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(
            "- [x] `BASE-SEC-001` **MUST** Không commit bí mật. → Kiểm: gitleaks trong CI. — Bằng chứng: ci.yml:10",
            bp.read_text(encoding="utf-8"),
        )

    def test_missing_framework_dir_is_error(self):
        r = self.cli("--framework", str(self.tmp / "khong-co"), "validate")
        self.assertEqual(r.returncode, 2)
        self.assertNotIn("Traceback", r.stderr)

    def test_missing_blueprint_file_is_clean_error(self):
        r = self.cli("blueprint-status", str(self.tmp / "khong-co.md"))
        self.assertEqual(r.returncode, 2)
        self.assertNotIn("Traceback", r.stderr)

    def test_waiver_reason_accepts_nfd(self):
        import unicodedata

        bp = self.tmp / "BP.md"
        bp.write_text(
            unicodedata.normalize("NFD", "- [~] `X-001` **MUST** a — Miễn: không áp dụng\n"), encoding="utf-8"
        )
        self.assertEqual(xs.blueprint_status(bp)["bad_waivers"], [])

    def test_record_rejects_path_like_task_id(self):
        plan = self.tmp / "docs" / "autopilot" / "PLAN.md"
        write(plan, "- [ ] `T-001` x — Gate: `true`\n")
        env = {"CLAUDE_PROJECT_DIR": str(self.tmp)}
        self.assertEqual(self.cli("loop", "init", env=env).returncode, 0)
        r = self.cli("loop", "record", "--task", "../../pwned", "--", "true", env=env)
        self.assertEqual(r.returncode, 2)
        self.assertFalse((self.tmp / "pwned.json").exists())
        self.assertEqual(self.cli("loop", "record", "--task", "BASE-SEC-001", "--", "true", env=env).returncode, 0)

    def test_hours_zero_sets_deadline(self):
        write(self.tmp / "docs" / "autopilot" / "PLAN.md", "- [ ] `T-001` x\n")
        env = {"CLAUDE_PROJECT_DIR": str(self.tmp)}
        self.cli("loop", "init", "--hours", "0", env=env)
        self.assertIsNotNone(xs.read_state(self.tmp)["deadline"])

    def test_evidence_redacts_secret_like_values(self):
        write(self.tmp / "docs" / "autopilot" / "PLAN.md", "- [ ] `T-001` x\n")
        with redirect_stdout(io.StringIO()):
            xs.loop_record("T-001", ["echo API_KEY=sk-live-123 password: hunter2"], self.tmp)
        tail = xs.read_evidence("T-001", self.tmp)["output_tail"]
        self.assertNotIn("sk-live-123", tail)
        self.assertNotIn("hunter2", tail)


class CliContractTest(unittest.TestCase):
    def run_xs(self, *args, stdin=None):
        return subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "xs.py"), *args],
            input=stdin,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_version_from_version_file(self):
        r = self.run_xs("--version")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(r.stdout.strip(), "xs.py " + (ROOT / "VERSION").read_text(encoding="utf-8").strip())

    def test_help_has_examples_and_exit_codes(self):
        out = self.run_xs("--help").stdout
        self.assertIn("ví dụ:", out)
        self.assertIn("mã thoát:", out)

    def test_blueprint_status_json_from_stdin(self):
        bp = "- [x] `A-001` **MUST** a\n- [ ] `A-002` **MUST** b\n- [~] `A-003` **SHOULD** c\n"
        r = self.run_xs("blueprint-status", "-", "--json", "--strict", stdin=bp)
        self.assertEqual(r.returncode, 1)
        d = json.loads(r.stdout)
        self.assertEqual((d["ok"], d["open_must"], d["bad_waivers"]), (False, ["A-002"], ["A-003 (dòng 3)"]))

    def test_readme_lists_every_subcommand(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        sub = next(a for a in xs.build_parser()._actions if isinstance(a, argparse._SubParsersAction))
        missing = [c for c in sub.choices if f"xs.py {c}" not in readme]
        self.assertEqual(missing, [], "README thiếu lệnh — cập nhật bảng Công cụ")


GOOD_PROGRESS = """# PROGRESS.md — Thử

## Đang làm
- Không.

## Tiếp theo
1. Việc kế.

## Quyết định
- 2026-10-14 Chọn X.

## Bàn giao phiên
- Commit cuối: `{sha}` · CI xanh
"""


class ProgressCheckTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        self.git("init", "-q", "-b", "main")
        self.base = self.commit("a")

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args) -> str:
        r = subprocess.run(
            ["git", "-C", str(self.repo), "-c", "user.name=t", "-c", "user.email=t@example.invalid", *args],
            capture_output=True,
            text=True,
            check=True,
        )
        return r.stdout.strip()

    def commit(self, name: str) -> str:
        (self.repo / name).write_text(name, encoding="utf-8")
        self.git("add", name)
        self.git("commit", "-q", "-m", name)
        return self.git("rev-parse", "HEAD")

    def check(self, text: str):
        f = self.repo / "PROGRESS.md"
        f.write_text(text, encoding="utf-8")
        return xs.progress_check(f)

    def test_progress_ok_with_ancestor_sha(self):
        self.commit("b")
        self.assertEqual(self.check(GOOD_PROGRESS.format(sha=self.base[:7])), [])

    def test_progress_too_big(self):
        errs = self.check(GOOD_PROGRESS.format(sha=self.base) + "x" * 9000)
        self.assertEqual(len(errs), 1)
        self.assertIn("> 8192", errs[0])

    def test_progress_wrong_sections(self):
        text = GOOD_PROGRESS.format(sha=self.base).replace("## Quyết định", "## Lịch sử")
        errs = self.check(text)
        self.assertEqual(len(errs), 1)
        self.assertIn("Lịch sử", errs[0])

    def test_progress_heading_inside_fence_ignored(self):
        text = GOOD_PROGRESS.format(sha=self.base).replace("- Không.", "```\n## Không tính\n```")
        self.assertEqual(self.check(text), [])

    def test_progress_missing_sha(self):
        errs = self.check(GOOD_PROGRESS.format(sha="SHA"))
        self.assertEqual(len(errs), 1)
        self.assertIn("không ghi SHA", errs[0])

    def test_progress_sha_not_ancestor(self):
        self.git("checkout", "-q", "-b", "nhanh")
        side = self.commit("side")
        self.git("checkout", "-q", "main")
        self.commit("c")
        errs = self.check(GOOD_PROGRESS.format(sha=side))
        self.assertEqual(len(errs), 1)
        self.assertIn("không phải tổ tiên", errs[0])

    def test_progress_unknown_sha(self):
        errs = self.check(GOOD_PROGRESS.format(sha="deadbeef"))
        self.assertEqual(len(errs), 1)
        self.assertIn("không phải commit có trong lịch sử", errs[0])

    def test_progress_branch_sha_not_on_base(self):
        # Squash-merge: SHA của nhánh PR là tổ tiên HEAD của nhánh nhưng không bao giờ vào nhánh chính.
        self.git("checkout", "-q", "-b", "feat")
        feat = self.commit("feat")
        with unittest.mock.patch.dict(os.environ, {"XS_PROGRESS_BASE": "main"}):
            errs = self.check(GOOD_PROGRESS.format(sha=feat))
            self.assertEqual(len(errs), 1)
            self.assertIn("chưa nằm trên `main`", errs[0])
            self.assertEqual(self.check(GOOD_PROGRESS.format(sha=self.base)), [])
        with unittest.mock.patch.dict(os.environ, {"XS_PROGRESS_BASE": ""}):
            self.assertEqual(self.check(GOOD_PROGRESS.format(sha=feat)), [])

    def test_progress_base_ref_from_origin(self):
        with unittest.mock.patch.dict(os.environ):
            os.environ.pop("XS_PROGRESS_BASE", None)
            self.assertIsNone(xs.progress_base_ref(self.repo))
            self.git("update-ref", "refs/remotes/origin/main", self.base)
            self.assertEqual(xs.progress_base_ref(self.repo), "origin/main")

    def test_progress_uppercase_sha_tilde_fence_closing_hashes(self):
        text = (
            GOOD_PROGRESS.format(sha=self.base[:9].upper())
            .replace("- Không.", "~~~\n## Không tính\n```\n~~~")
            .replace("## Bàn giao phiên", "## Bàn giao phiên ##")
        )
        self.assertEqual(self.check(text), [])

    def test_progress_cli_exit_codes(self):
        f = self.repo / "PROGRESS.md"
        f.write_text(GOOD_PROGRESS.format(sha="deadbeef"), encoding="utf-8")
        run = lambda *a: (
            subprocess.run(  # noqa: E731
                [sys.executable, str(ROOT / "scripts" / "xs.py"), "progress-check", *a],
                capture_output=True,
                text=True,
                check=False,
            ).returncode
        )
        self.assertEqual(run(str(f)), 1)
        f.write_text(GOOD_PROGRESS.format(sha=self.base), encoding="utf-8")
        self.assertEqual(run(str(f)), 0)
        self.assertEqual(run(str(self.repo / "khong-co.md")), 2)


SHA40 = "11d5960a326750d5838078e36cf38b85af677262"
GOOD_WORKFLOW = f"""name: CI
on: [push]
permissions:
  contents: read
jobs:
  quality:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@{SHA40} # v4
      - uses: ./.github/actions/local
      - run: |
          echo "uses: evil/action@v1"
          echo "continue-on-error: true write-all"
      - name: bước có timeout riêng
        timeout-minutes: 2
        run: true
  call:
    uses: org/repo/.github/workflows/x.yml@{SHA40}
env:
  A: b
"""


class CiCheckTest(unittest.TestCase):
    def errs(self, text: str):
        return xs.ci_check_text(text)

    def test_ci_check_good_workflow(self):
        self.assertEqual(self.errs(GOOD_WORKFLOW), [])

    def test_ci_check_missing_permissions(self):
        errs = self.errs(GOOD_WORKFLOW.replace("permissions:\n  contents: read\n", ""))
        self.assertEqual(len(errs), 1)
        self.assertIn("permissions", errs[0])

    def test_ci_check_write_all(self):
        errs = self.errs(GOOD_WORKFLOW.replace("permissions:\n  contents: read", "permissions: write-all"))
        self.assertEqual(len(errs), 1)
        self.assertIn("write-all", errs[0])

    def test_ci_check_unpinned_uses(self):
        errs = self.errs(GOOD_WORKFLOW.replace(f"actions/checkout@{SHA40}", "actions/checkout@v4"))
        self.assertEqual(len(errs), 1)
        self.assertIn("actions/checkout@v4", errs[0])
        self.assertIn("dòng 10", errs[0])

    def test_ci_check_unpinned_reusable_workflow(self):
        errs = self.errs(GOOD_WORKFLOW.replace(f"x.yml@{SHA40}", "x.yml@main"))
        self.assertEqual(len(errs), 1)

    def test_ci_check_missing_job_timeout(self):
        errs = self.errs(GOOD_WORKFLOW.replace("    timeout-minutes: 10\n", ""))
        self.assertEqual(errs, ["dòng 6: job `quality` thiếu `timeout-minutes`"])

    def test_ci_check_continue_on_error(self):
        text = GOOD_WORKFLOW.replace(
            "    timeout-minutes: 10\n", "    timeout-minutes: 10\n    continue-on-error: true\n"
        )
        self.assertEqual(len(self.errs(text)), 1)
        allowed = text.replace(
            "continue-on-error: true", "continue-on-error: true # ci-check-allow: thử, hết hạn 2026-12"
        )
        self.assertEqual(self.errs(allowed), [])
        no_reason = text.replace("continue-on-error: true", "continue-on-error: true # ci-check-allow:")
        self.assertEqual(len(self.errs(no_reason)), 1)
        self.assertEqual(self.errs(text.replace("continue-on-error: true", "continue-on-error: false")), [])

    def test_ci_check_no_false_positives(self):
        text = GOOD_WORKFLOW.replace("  quality:\n", "  quality:\n    name: test write-all detection\n").replace(
            "    timeout-minutes: 10\n", '    timeout-minutes: ${{ inputs.t }}\n    continue-on-error: "false"\n'
        )
        text += "  merged:\n    <<: *base\n"
        self.assertEqual(self.errs(text), [])

    def test_ci_check_layout_variants(self):
        text = (
            GOOD_WORKFLOW.replace("\n  ", "\n    ")  # jobs/permissions thụt 4
            .replace(f"actions/checkout@{SHA40} # v4", f"'actions/checkout@{SHA40}' # v4")
            .replace("      - run: |", "      - run: >-")
            .replace("\n", "\r\n")
        )
        self.assertEqual(self.errs(text), [])

    def test_ci_check_flow_mapping_and_docker(self):
        base = GOOD_WORKFLOW.replace("      - uses: ./.github/actions/local\n", "{}")
        self.assertEqual(len(self.errs(base.format("      - {uses: actions/checkout@v4}\n"))), 1)
        self.assertEqual(len(self.errs(base.format("      - {run: true, continue-on-error: true}\n"))), 1)
        self.assertEqual(len(self.errs(base.format("      - uses: docker://alpine:3\n"))), 1)
        digest = "docker://alpine@sha256:" + "a" * 64
        self.assertEqual(self.errs(base.format(f"      - uses: {digest}\n")), [])

    def test_ci_check_cli(self):
        with tempfile.TemporaryDirectory() as d:
            wf = Path(d) / "wf"
            wf.mkdir()
            (wf / "ci.yml").write_text(GOOD_WORKFLOW, encoding="utf-8")
            run = lambda *a: (
                subprocess.run(  # noqa: E731
                    [sys.executable, str(ROOT / "scripts" / "xs.py"), "ci-check", *a],
                    capture_output=True,
                    text=True,
                    check=False,
                    cwd=d,
                ).returncode
            )
            self.assertEqual(run(str(wf)), 0)
            (wf / "bad.yaml").write_text(GOOD_WORKFLOW.replace("@" + SHA40 + " # v4", "@v4"), encoding="utf-8")
            self.assertEqual(run(str(wf)), 1)
            self.assertEqual(run(str(Path(d) / "khong-co")), 2)
            self.assertEqual(run(), 0)  # không có .github/workflows ở cwd → bỏ qua

    def test_ci_check_repo_workflows(self):
        self.assertEqual(
            xs.ci_check(ROOT / ".github" / "workflows"),
            {p.name: [] for p in (ROOT / ".github" / "workflows").iterdir() if p.suffix in (".yml", ".yaml")},
        )


def audit_status_text(groups=None, findings=()):
    groups = groups or {}
    rows = []
    for no, code, name in xs.AUDIT_GROUPS:
        state, sha, day, note = groups.get(no, ("N/A", "", "", "không áp dụng cho repo thử"))
        rows.append(f"| {no} | {code} | {name} | {state} | {sha} | {day} | {note} |")
    head = "| ID | Mức | Trạng thái | Tóm tắt | Bằng chứng | Gate | Ghi chú |\n|---|---|---|---|---|---|---|\n"
    return (
        "# AUDIT-STATUS — thử\n\n## Nhóm\n\n| # | Mã | Nhóm | Trạng thái | SHA | Ngày | Ghi chú |\n|---|---|---|---|---|---|---|\n"
        + "\n".join(rows)
        + "\n\n## Phát hiện\n\n"
        + head
        + "".join(f"| {f} |\n" for f in findings)
    )


class GitRepoMixin:
    def init_repo(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        self.git("init", "-q", "-b", "main")

    def git(self, *args, env=None) -> str:
        r = subprocess.run(
            ["git", "-C", str(self.repo), "-c", "user.name=t", "-c", "user.email=t@example.invalid", *args],
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


class AuditPlanTest(GitRepoMixin, unittest.TestCase):
    def test_audit_plan_web_signals(self):
        files = [
            "package.json",
            "package-lock.json",
            "src/app.tsx",
            "src/app.test.tsx",
            "db/migrations/001.sql",
            ".github/workflows/ci.yml",
            "Dockerfile",
            "AGENTS.md",
        ]
        sig = xs.audit_signals(Path("."), files)
        a = xs.audit_applicability(sig)
        self.assertEqual(sig["langs"], {"js/ts": 2})
        self.assertEqual((a[6][0], a[10][0], a[5][0], a[13][0]), ("áp dụng", "áp dụng", "áp dụng", "áp dụng"))
        self.assertIn("package-lock.json", a[7][1])

    def test_audit_plan_docs_only_repo(self):
        a = xs.audit_applicability(xs.audit_signals(Path("."), ["README.md", "docs/x.md"]))
        self.assertEqual([a[n][0] for n in (1, 3, 4, 6, 10, 12, 13)], ["N/A"] * 7)
        self.assertIn("KHÔNG có CI", a[8][1])

    def test_audit_plan_stale_evidence(self):
        self.init_repo()
        bp = (
            "- [x] `A-001` **MUST** a → Kiểm: x — Bằng chứng: lib/a.py:1 xử lý\n"
            "- [~] `A-002` **MUST** b → Kiểm: y — Miễn: b.py không dùng\n"
            "- [ ] `A-003` **MUST** c → Kiểm: z — Thiếu: lib/a.py\n"
        )
        self.commit_files({"lib/a.py": "1", "b.py": "1", "BLUEPRINT.md": bp}, 1_700_000_000)
        self.commit_files({"lib/a.py": "2"}, 1_700_000_100)
        files = xs._repo_files(self.repo)
        stale = xs.blueprint_stale_evidence(self.repo, self.repo / "BLUEPRINT.md", files)
        self.assertEqual(stale, [{"id": "A-001", "kind": "Bằng chứng", "files": ["lib/a.py"]}])

    def test_audit_plan_rescan_from_status(self):
        self.init_repo()
        c1 = self.commit_files({".github/workflows/ci.yml": "a", "README.md": "x"}, 1_700_000_000)
        groups = {
            8: ("đã quét", c1, "2026-10-14", ""),
            9: ("đã quét", c1, "2026-10-14", ""),
            2: ("đã quét", "deadbeef", "2026-10-14", ""),
            1: ("chưa quét", "", "", ""),
        }
        self.commit_files({"docs/ops/AUDIT-STATUS.md": audit_status_text(groups)}, 1_700_000_050)
        self.commit_files({".github/workflows/ci.yml": "b"}, 1_700_000_100)
        r = xs.audit_rescan(self.repo, self.repo / "docs/ops/AUDIT-STATUS.md")
        self.assertIn("1 file đổi", r[8])
        self.assertEqual(r[1], "chưa quét")
        self.assertIn("không còn là tổ tiên", r[2])
        self.assertIn(9, r)  # AUDIT-STATUS.md là .md đổi sau SHA quét nhóm 9
        self.assertNotIn(6, r)  # N/A

    def test_audit_plan_cli_json(self):
        self.init_repo()
        self.commit_files({"main.py": "print(1)", "tests/test_main.py": "x"}, 1_700_000_000)
        r = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "xs.py"), "audit", "plan", "--json"],
            capture_output=True,
            text=True,
            check=False,
            env={**os.environ, "CLAUDE_PROJECT_DIR": str(self.repo)},
        )
        self.assertEqual(r.returncode, 0, r.stderr)
        d = json.loads(r.stdout)
        self.assertEqual(d["signals"]["langs"], {"python": 2})
        self.assertIsNone(d["rescan"])
        self.assertEqual(len(d["groups"]), 13)


class AuditCheckTest(GitRepoMixin, unittest.TestCase):
    def check(self, text, strict=False, root=None):
        d = Path(root or self.enterContext(tempfile.TemporaryDirectory()))
        f = d / "AUDIT-STATUS.md"
        f.write_text(text, encoding="utf-8")
        return xs.audit_check(f, strict=strict, today=xs._dt.date(2026, 10, 14))[0]

    GOOD = "AUD-SEC-001 | 🟠 | mở | lệnh `a \\| b` lọt guard | đo được: chạy hook → exit 0 | `python3 -m unittest` | "

    def test_audit_check_valid(self):
        self.assertEqual(self.check(audit_status_text(findings=[self.GOOD])), [])

    def test_audit_check_template_body_matches_schema(self):
        sys.path.insert(0, str(ROOT / "scripts"))
        import install

        body = install.template_body((ROOT / "framework/templates/AUDIT-STATUS.md").read_text(encoding="utf-8"))
        self.assertTrue(any("còn chỗ trống" in e for e in self.check(body)))
        no_example = "\n".join(ln for ln in body.splitlines() if not ln.startswith("| AUD-"))
        self.assertEqual(self.check(no_example), [])
        self.assertEqual(len(self.check(no_example, strict=True)), 13)  # 13 nhóm chưa quét

    def test_audit_check_group_errors(self):
        text = audit_status_text({3: ("N/A", "", "", ""), 4: ("đã quét", "", "", "")}).replace(
            "| 5 | PERF |", "| 5 | SPEED |"
        )
        text = text.replace("| 7 | DEP |", "| 99 | DEP |")
        errs = "\n".join(self.check(text))
        for frag in (
            "nhóm 3: `N/A` phải ghi lý do",
            "nhóm 4: thiếu Ngày",
            "nhóm 4: thiếu SHA",
            "mã `SPEED`",
            "số nhóm phải 1–13",
            "nhóm 7: phải có đúng 1 dòng",
        ):
            self.assertIn(frag, errs)

    def test_audit_check_finding_errors(self):
        rows = [
            "AUD-FOO-001 | 🔴 | mở | x | đo được: a | `t` | ",
            "AUD-SEC-002 | 🔵 | xong | x | thấy | `t` | ",
            "AUD-SEC-003 | 🔴 | mở | x | chưa biết: thiếu gitleaks | `t` | ",
            "AUD-SEC-004 | 🟠 | mở | x | suy luận: a.py:3 | | ",
            "AUD-SEC-005 | 🟢 | đã sửa | x | đo được: a | | xong rồi",
            "AUD-SEC-006 | 🟢 | chấp nhận | x | đo được: a | | chủ: An, hạn: 2026-10-01",
            "AUD-SEC-007 | 🟢 | chấp nhận | x | đo được: a | | để sau",
            "AUD-SEC-008 | 🟢 | bác bỏ | x | đo được: a | | ",
            "AUD-SEC-009 | 🟢 | mở | <tóm tắt> | đo được: a | | ",
            "AUD-SEC-009 | 🟢 | mở | x | đo được: a | | ",
        ]
        errs = "\n".join(self.check(audit_status_text(findings=rows)))
        for frag in (
            "AUD-FOO-001: ID phải",
            "mức `🔵`",
            "trạng thái `xong`",
            "AUD-SEC-002: Bằng chứng phải",
            "AUD-SEC-003: 🔴 không thể",
            "AUD-SEC-004: 🟠 phải có Gate",
            "AUD-SEC-005: `đã sửa`",
            "AUD-SEC-006: chấp nhận rủi ro đã quá hạn",
            "AUD-SEC-007: `chấp nhận` phải ghi",
            "AUD-SEC-008: `bác bỏ`",
            "còn chỗ trống",
            "AUD-SEC-009: ID trùng 2 lần",
        ):
            self.assertIn(frag, errs)

    def test_audit_check_fixed_and_accepted_ok(self):
        rows = [
            "AUD-CI-001 | 🟠 | đã sửa | x | đo được: a | `t` | #19",
            "AUD-CI-002 | 🟢 | chấp nhận | x | suy luận: a | | chủ: An · hạn: 2026-12-31",
            "AUD-CI-003 | 🟠 | bác bỏ | x | suy luận: a | | không tái hiện được",
        ]
        self.assertEqual(self.check(audit_status_text(findings=rows), strict=True), [])

    def test_audit_check_strict(self):
        errs = self.check(audit_status_text({1: ("chưa quét", "", "", "")}, [self.GOOD]), strict=True)
        self.assertEqual(sorted(errs), ["AUD-SEC-001: 🟠 còn mở (--strict)", "nhóm 1: chưa quét (--strict)"])

    def test_audit_check_sha_must_be_ancestor(self):
        self.init_repo()
        c1 = self.commit_files({"a": "1"}, 1_700_000_000)
        self.git("checkout", "-q", "-b", "side")
        side = self.commit_files({"b": "1"}, 1_700_000_050)
        self.git("checkout", "-q", "main")
        groups = {1: ("đã quét", c1, "2026-10-14", ""), 2: ("đã quét", side, "2026-10-14", "")}
        errs = self.check(audit_status_text(groups), root=self.repo)
        self.assertEqual(len(errs), 1)
        self.assertIn("nhóm 2: SHA", errs[0])

    def test_audit_check_cli_exit_codes(self):
        d = Path(self.enterContext(tempfile.TemporaryDirectory()))
        f = d / "S.md"
        f.write_text(audit_status_text(findings=[self.GOOD]), encoding="utf-8")
        run = lambda *a: (
            subprocess.run(  # noqa: E731
                [sys.executable, str(ROOT / "scripts" / "xs.py"), "audit", "check", *a],
                capture_output=True,
                text=True,
                check=False,
            ).returncode
        )
        self.assertEqual(run(str(f)), 0)
        self.assertEqual(run(str(f), "--strict"), 1)
        self.assertEqual(run(str(d / "khong-co.md")), 2)


class RealFrameworkTest(unittest.TestCase):
    """Khung thật trong repo phải luôn hợp lệ."""

    def test_repo_framework_valid(self):
        errs = xs.validate(xs.DEFAULT_FRAMEWORK)
        self.assertEqual(errs, [], "\n".join(errs[:30]))


if __name__ == "__main__":
    unittest.main()
