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


class RealFrameworkTest(unittest.TestCase):
    """Khung thật trong repo phải luôn hợp lệ."""

    def test_repo_framework_valid(self):
        errs = xs.validate(xs.DEFAULT_FRAMEWORK)
        self.assertEqual(errs, [], "\n".join(errs[:30]))


if __name__ == "__main__":
    unittest.main()
