"""Test scripts/check-links.py nạp như module (đo coverage trong tiến trình) — ca CLI nằm ở test_install.py."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from types import ModuleType
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "check-links.py"


def load_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location("check_links_under_test", SCRIPT)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class CheckLinksModuleTest(unittest.TestCase):
    def setUp(self):
        self.cl = load_module()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.repo = Path(tmp.name)

    def write(self, rel: str, text: str) -> None:
        p = self.repo / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")

    def test_root_is_project_when_installed_under_xstored(self):
        # Bản cài ở <dự án>/.xstored/scripts/ → gốc là dự án; biên dịch với tên file thật để coverage đếm đúng file.
        fake = self.repo.resolve() / ".xstored" / "scripts" / "check-links.py"
        ns: dict[str, object] = {"__file__": str(fake), "__name__": "check_links_installed"}
        exec(compile(SCRIPT.read_text(encoding="utf-8"), str(SCRIPT), "exec"), ns)
        self.assertEqual(ns["ROOT"], self.repo.resolve())
        self.assertEqual(self.cl.ROOT, ROOT)  # chạy từ repo khung: gốc là repo

    def test_iter_md_skips_tooling_dirs(self):
        for rel in ("a.md", "docs/b.md", "node_modules/x.md", ".git/y.md", "sub/.xstored/z.md", ".venv/w.md"):
            self.write(rel, "x\n")
        names = [p.relative_to(self.repo).as_posix() for p in self.cl.iter_md(self.repo)]
        self.assertEqual(names, ["a.md", "docs/b.md"])

    def test_check_reports_broken_with_file_and_line(self):
        self.write("docs/ok.md", "x\n")
        self.write("a.md", "dòng 1\n[tốt](docs/ok.md#neo) [hỏng](docs/mat.md)\n")
        self.assertEqual(self.cl.check(self.repo), ["a.md:2: liên kết hỏng -> docs/mat.md"])

    def test_check_accepts_root_absolute_and_skips_urls_anchors(self):
        self.write("docs/ok.md", "x\n")
        self.write(
            "sub/a.md",
            "[abs](/docs/ok.md) [neo](#muc) [url](https://x.invalid/a) [mail](mailto:a@b.c) [dir](../docs)\n",
        )
        self.assertEqual(self.cl.check(self.repo), [])

    def test_check_absolute_link_missing_is_error(self):
        self.write("a.md", "[x](/khong/co.md)\n")
        self.assertEqual(self.cl.check(self.repo), ["a.md:1: liên kết hỏng -> /khong/co.md"])

    def test_check_fence_nesting_is_respected(self):
        # ``` mở thì ~~~ bên trong không đóng; sau khi đóng đúng loại, link ngoài fence lại được kiểm.
        self.write("a.md", "```\n~~~\n[in](a1.md)\n~~~\n```\n[out](a2.md)\n")
        self.assertEqual(self.cl.check(self.repo), ["a.md:6: liên kết hỏng -> a2.md"])

    def test_main_success_and_failure_output(self):
        self.write("ok.md", "[a](ok.md)\n")
        out = io.StringIO()
        with mock.patch("sys.argv", ["check-links.py", str(self.repo)]), contextlib.redirect_stdout(out):
            self.assertEqual(self.cl.main(), 0)
        self.assertIn("✓ Mọi liên kết Markdown nội bộ", out.getvalue())
        self.write("bad.md", "[a](nope.md)\n[b](nope2.md)\n")
        out = io.StringIO()
        with mock.patch("sys.argv", ["check-links.py", str(self.repo)]), contextlib.redirect_stdout(out):
            self.assertEqual(self.cl.main(), 1)
        self.assertIn("✗ bad.md:1: liên kết hỏng -> nope.md", out.getvalue())
        self.assertIn("2 liên kết hỏng.", out.getvalue())

    def test_main_defaults_to_repo_root(self):
        out = io.StringIO()
        with (
            mock.patch("sys.argv", ["check-links.py"]),
            mock.patch.object(self.cl, "ROOT", self.repo),
            contextlib.redirect_stdout(out),
        ):
            self.assertEqual(self.cl.main(), 0)
        self.assertIn("✓", out.getvalue())
        self.write("bad.md", "[x](missing.md)\n")  # cùng ROOT, giờ có link hỏng → phải đỏ (chứng minh đã quét ROOT)
        out = io.StringIO()
        with (
            mock.patch("sys.argv", ["check-links.py"]),
            mock.patch.object(self.cl, "ROOT", self.repo),
            contextlib.redirect_stdout(out),
        ):
            self.assertEqual(self.cl.main(), 1)
        self.assertIn("bad.md:1", out.getvalue())


if __name__ == "__main__":
    unittest.main()
