"""Test scripts/install.py và scripts/check-links.py."""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import install  # noqa: E402


class InstallTest(unittest.TestCase):
    def setUp(self):
        self.target = Path(tempfile.mkdtemp())

    def run_install(self, *extra) -> int:
        return install.main([str(self.target), "--label", "test", *extra])

    def test_fresh_install_layout(self):
        self.assertEqual(self.run_install(), 0)
        self.assertTrue((self.target / ".xstored" / "framework" / "00-method" / "conventions.md").exists())
        self.assertTrue((self.target / ".xstored" / "scripts" / "xs.py").exists())
        self.assertEqual((self.target / ".xstored" / "VERSION").read_text(encoding="utf-8").strip(), "test")
        self.assertTrue((self.target / ".claude" / "settings.json").exists())
        self.assertTrue((self.target / ".claude" / "hooks" / "stop-guard.sh").exists())
        self.assertTrue((self.target / ".claude" / "skills" / "autopilot" / "SKILL.md").exists())
        self.assertIn(".autopilot/", (self.target / ".gitignore").read_text(encoding="utf-8"))
        for name in ("AGENTS.md", "CLAUDE.md", "PROGRESS.md", "xs.yaml"):
            self.assertTrue((self.target / name).exists(), name)
            self.assertFalse((self.target / name).read_text(encoding="utf-8").startswith("---"), f"{name} còn frontmatter")

    def test_installed_xs_validates_and_composes(self):
        self.run_install()
        xs = self.target / ".xstored" / "scripts" / "xs.py"
        r = subprocess.run([sys.executable, str(xs), "validate"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)
        r = subprocess.run([sys.executable, str(xs), "compose", "--profile", "web-app", "--scale", "M",
                            "--out", str(self.target / "BLUEPRINT.md")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("kind: blueprint", (self.target / "BLUEPRINT.md").read_text(encoding="utf-8"))

    def test_does_not_overwrite_user_files(self):
        self.run_install()
        agents = self.target / "AGENTS.md"
        agents.write_text("của tôi\n", encoding="utf-8")
        settings = self.target / ".claude" / "settings.json"
        settings.write_text("{}\n", encoding="utf-8")
        self.run_install()
        self.assertEqual(agents.read_text(encoding="utf-8"), "của tôi\n")
        self.assertEqual(settings.read_text(encoding="utf-8"), "{}\n")
        self.assertTrue((self.target / ".claude" / "settings.json.xstored-new").exists())
        self.run_install("--force-harness")
        self.assertNotEqual(settings.read_text(encoding="utf-8"), "{}\n")

    def test_refuses_self_and_missing(self):
        self.assertEqual(install.main([str(ROOT), "--label", "x"]), 2)
        self.assertEqual(install.main([str(self.target / "khong-co"), "--label", "x"]), 2)


class CheckLinksTest(unittest.TestCase):
    def test_repo_links_ok(self):
        r = subprocess.run([sys.executable, str(ROOT / "scripts" / "check-links.py")], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout)

    def test_detects_broken(self):
        tmp = Path(tempfile.mkdtemp())
        (tmp / "a.md").write_text("[x](b.md) [ok](#h) [url](https://x) `[no](c.md)`\n```\n[in-fence](d.md)\n```\n", encoding="utf-8")
        r = subprocess.run([sys.executable, str(ROOT / "scripts" / "check-links.py"), str(tmp)], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("b.md", r.stdout)
        self.assertNotIn("d.md", r.stdout)


if __name__ == "__main__":
    unittest.main()
