"""Test lõi cho scripts/xs.py (frontmatter, validate, compose, vòng lặp autopilot, ghi nguyên tử).

Bổ sung cho test_xs.py: phủ các nhánh lỗi/biên. Chạy: python3 -m unittest discover -s tests -v
"""

from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
import unittest.mock
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import xs  # noqa: E402

SECTION_DIRS = ("01-baseline", "02-profiles", "03-industries", "08-backend")


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(text).lstrip("\n"), encoding="utf-8")


def md(meta: dict[str, str], body: str = "# Tiêu đề\n") -> str:
    """Dựng một file markdown có frontmatter phẳng; mặc định hợp lệ cho khoá bắt buộc."""
    base = {"title": "Tiêu đề", "kind": "module", "updated": "2026-10-13"}
    base.update(meta)
    head = "\n".join(f"{k}: {v}" for k, v in base.items() if v is not None)
    return f"---\n{head}\n---\n\n{body}"


MODULE_BODY = textwrap.dedent(
    """\
    # Mô-đun

    ## Checklist

    - [ ] `{prefix}-001` **MUST** Làm việc A. → Kiểm: test A.

    ## Nguồn

    - x
    """
)


def make_fw(tmp: Path, files: dict[str, str] | None = None) -> Path:
    """Khung giả: mỗi thư mục có README hợp lệ, cộng các file truyền vào (đường dẫn tương đối framework/)."""
    fw = tmp / "framework"
    write(fw / "README.md", md({"kind": "index"}))
    for d in SECTION_DIRS:
        write(fw / d / "README.md", md({"kind": "index"}))
    for rel, text in (files or {}).items():
        write(fw / rel, text)
    return fw


class TmpMixin:
    def tmpdir(self) -> Path:
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        return Path(td.name)


# --------------------------------------------------------------------------- frontmatter


class FrontmatterEdgeTest(unittest.TestCase):
    def test_blank_and_comment_lines_are_skipped(self):
        meta, body, n = xs.parse_frontmatter("---\n\n# ghi chú\ntitle: A\n   \n---\n# Thân\n")
        self.assertEqual(meta, {"title": "A"})
        self.assertEqual(body, "# Thân")
        self.assertEqual(n, 6)

    def test_line_without_colon(self):
        with self.assertRaisesRegex(xs.FrontmatterError, "dòng frontmatter 2 không có dạng"):
            xs.parse_frontmatter("---\nkhong co hai cham\n---\n")

    def test_invalid_key(self):
        with self.assertRaisesRegex(xs.FrontmatterError, "khoá frontmatter không hợp lệ"):
            xs.parse_frontmatter("---\nBad-Key: 1\n---\n")

    def test_duplicate_key(self):
        with self.assertRaisesRegex(xs.FrontmatterError, "khoá frontmatter lặp: title"):
            xs.parse_frontmatter("---\ntitle: a\ntitle: b\n---\n")

    def test_unclosed_and_missing_frontmatter(self):
        with self.assertRaisesRegex(xs.FrontmatterError, "không có dòng '---' đóng"):
            xs.parse_frontmatter("---\ntitle: a\n")
        with self.assertRaisesRegex(xs.FrontmatterError, "thiếu frontmatter"):
            xs.parse_frontmatter("")
        with self.assertRaisesRegex(xs.FrontmatterError, "thiếu frontmatter"):
            xs.parse_frontmatter("# không có\n")

    def test_values_quotes_lists_unicode(self):
        meta, _, _ = xs.parse_frontmatter(
            '---\na: "có dấu: ví dụ"\nb: \'x\'\nc: [p, "q r", ]\nd: []\ne: "\nf: \'\n---\n'
        )
        self.assertEqual(meta["a"], "có dấu: ví dụ")
        self.assertEqual(meta["b"], "x")
        self.assertEqual(meta["c"], ["p", "q r"])
        self.assertEqual(meta["d"], [])
        # Chuỗi chỉ một ký tự nháy không bị cắt.
        self.assertEqual(meta["e"], '"')
        self.assertEqual(meta["f"], "'")

    def test_as_list(self):
        self.assertEqual(xs._as_list(None), [])
        self.assertEqual(xs._as_list("all"), ["all"])
        self.assertEqual(xs._as_list(["a", 3]), ["a", "3"])
        self.assertEqual(xs._as_list(""), [""])


# --------------------------------------------------------------------------- load_docs / resolve_modules


class LoadDocsTest(TmpMixin, unittest.TestCase):
    def test_bad_frontmatter_is_reported_and_doc_skipped(self):
        fw = make_fw(self.tmpdir(), {"08-backend/bad.md": "---\ntitle a\n---\n# x\n"})
        docs, errors = xs.load_docs(fw)
        self.assertNotIn("08-backend/bad", {d.rel for d in docs})
        self.assertEqual(len(errors), 1)
        self.assertTrue(errors[0].startswith("08-backend/bad.md: dòng frontmatter 2"))

    def test_item_like_line_and_fence(self):
        body = (
            "# T\n\n- [ ] `BAD` **MUST** thiếu số thứ tự\n\n```\n- [ ] `X-001` **MUST** trong fence\n```\n\n"
            "- [ ] `OK-001` **SHOULD** hợp lệ\n"
        )
        fw = make_fw(self.tmpdir(), {"08-backend/m.md": md({"prefix": "OK"}, body)})
        docs, errors = xs.load_docs(fw)
        doc = next(d for d in docs if d.rel == "08-backend/m")
        self.assertEqual([i.id for i in doc.items], ["OK-001"])
        self.assertEqual(len(errors), 1)
        self.assertIn("mục checklist sai định dạng", errors[0])

    def test_resolve_modules_glob_without_hit_and_exact_missing(self):
        fw = make_fw(
            self.tmpdir(),
            {
                "08-backend/api.md": md({"prefix": "API", "applies_to": "[all]"}, MODULE_BODY.format(prefix="API")),
                "08-backend/idx.md": md({"kind": "index"}),
            },
        )
        docs, _ = xs.load_docs(fw)
        by_rel = {d.rel: d for d in docs}
        mods, missing = xs.resolve_modules(["08-backend/*", "99-none/*", "08-backend/api", "08-backend/zzz"], by_rel)
        self.assertEqual([m.rel for m in mods], ["08-backend/api"])  # README bị loại, index không phải module, bỏ trùng
        self.assertEqual(missing, ["99-none/*", "08-backend/zzz"])


# --------------------------------------------------------------------------- validate


class ValidateBranchesTest(TmpMixin, unittest.TestCase):
    def errors_for(self, files: dict[str, str]) -> list[str]:
        return xs.validate(make_fw(self.tmpdir(), files))

    def assertHas(self, errors: list[str], needle: str) -> None:
        self.assertTrue(any(needle in e for e in errors), f"không thấy {needle!r} trong {errors}")

    def mod(self, **meta: str) -> str:
        meta.setdefault("prefix", "MOD")
        meta.setdefault("applies_to", "[all]")
        return md(meta, MODULE_BODY.format(prefix=meta["prefix"]))

    def test_valid_module_has_no_errors(self):
        self.assertEqual(self.errors_for({"08-backend/m.md": self.mod()}), [])

    def test_missing_required_key(self):
        errors = self.errors_for({"08-backend/m.md": self.mod(title="")})
        self.assertHas(errors, "08-backend/m.md: thiếu khoá frontmatter 'title'")

    def test_invalid_kind_and_date(self):
        errors = self.errors_for({"08-backend/m.md": self.mod(kind="la", updated="13/10/2026")})
        self.assertHas(errors, "kind không hợp lệ 'la'")
        self.assertHas(errors, "'updated' phải dạng YYYY-MM-DD")

    def test_body_must_start_with_heading(self):
        errors = self.errors_for({"08-backend/m.md": md({"prefix": "MOD", "applies_to": "all"}, "chỉ có chữ\n")})
        self.assertHas(errors, "nội dung phải bắt đầu bằng tiêu đề")

    def test_items_without_prefix_and_invalid_prefix(self):
        errors = self.errors_for(
            {
                "08-backend/a.md": md({"prefix": None, "applies_to": "all"}, MODULE_BODY.format(prefix="ABC")),
                "08-backend/b.md": self.mod(prefix="1BAD"),
            }
        )
        self.assertHas(errors, "08-backend/a.md: có mục checklist nhưng thiếu 'prefix'")
        self.assertHas(errors, "prefix '1BAD' không hợp lệ")

    def test_duplicate_prefix(self):
        errors = self.errors_for({"08-backend/a.md": self.mod(prefix="DUP"), "08-backend/b.md": self.mod(prefix="DUP")})
        self.assertHas(errors, "08-backend/b.md: prefix 'DUP' đã dùng ở 08-backend/a.md")

    def test_item_rules_state_scale_id_prefix_must_check_and_duplicates(self):
        body = (
            "# T\n\n## Checklist\n\n"
            "- [x] `MOD-001` **MUST** đã tick. → Kiểm: a.\n"
            "- [ ] `MOD-002` **SHOULD@L** có ngưỡng sai chỗ.\n"
            "- [ ] `MOD-001` **MUST** trùng ID. → Kiểm: b.\n"
            "- [ ] `OTH-003` **MUST** sai prefix. → Kiểm: c.\n"
            "- [ ] `MOD-004` **MUST** thiếu kiểm.\n\n## Nguồn\n\n- x\n"
        )
        errors = self.errors_for({"08-backend/m.md": md({"prefix": "MOD", "applies_to": "all"}, body)})
        self.assertHas(errors, "mục trong khung phải ở trạng thái '[ ]'")
        self.assertHas(errors, "ngưỡng quy mô '@L' chỉ dùng với MUST")
        self.assertHas(errors, "ID trùng MOD-001")
        self.assertHas(errors, "ID OTH-003 không khớp prefix 'MOD'")
        self.assertHas(errors, "mục MUST MOD-004 thiếu '→ Kiểm:'")

    def test_too_many_must_at_m(self):
        rows = "\n".join(f"- [ ] `MOD-{i:03d}` **MUST** m{i}. → Kiểm: t." for i in range(1, 6))
        body = f"# T\n\n## Checklist\n\n{rows}\n\n## Nguồn\n\n- x\n"
        errors = self.errors_for({"08-backend/m.md": md({"prefix": "MOD", "applies_to": "all"}, body)})
        self.assertHas(errors, "5 MUST hiệu lực ở quy mô M, trần 4")

    def test_missing_checklist_and_sources_headings(self):
        body = "# T\n\n## Danh sách\n\n- [ ] `MOD-001` **SHOULD** a.\n"
        errors = self.errors_for({"08-backend/m.md": md({"prefix": "MOD", "applies_to": "all"}, body)})
        self.assertHas(errors, "thiếu mục '## Checklist'")
        self.assertHas(errors, "thiếu mục '## Nguồn'")

    def test_missing_applies_to_and_unknown_profile_slug(self):
        profile = md(
            {"kind": "profile", "slug": "web", "modules": "[]"},
            "# P\n\n## Nguồn\n\n- x\n",
        )
        errors = self.errors_for(
            {
                "02-profiles/web.md": profile,
                "08-backend/a.md": self.mod(prefix="AAA", applies_to=None),
                "08-backend/b.md": self.mod(prefix="BBB", applies_to="[web, ghost]"),
            }
        )
        self.assertHas(errors, "08-backend/a.md: thiếu 'applies_to'")
        self.assertHas(errors, "08-backend/b.md: applies_to có slug hồ sơ không tồn tại: ghost")

    def test_profile_slug_missing_duplicate_and_unknown_modules(self):
        def prof(**meta: str) -> str:
            meta.setdefault("kind", "profile")
            return md(meta, "# P\n\n## Nguồn\n\n- x\n")

        errors = self.errors_for(
            {
                "02-profiles/a.md": prof(slug="same", modules="[08-backend/nope]"),
                "02-profiles/b.md": prof(slug="same"),
                "02-profiles/c.md": prof(),
            }
        )
        self.assertHas(errors, "02-profiles/c.md: thiếu 'slug'")
        self.assertHas(errors, "02-profiles/b.md: slug 'same' trùng với 02-profiles/a.md")
        self.assertHas(errors, "module '08-backend/nope' trong 'modules' không tồn tại")

    def test_links(self):
        body = (
            "# T\n\n[ok](../README.md) [anchor](#muc) [web](https://example.com/x) [mail](mailto:a@b.c)\n"
            "[hỏng](./khong-co.md#x) [ok-anchor](../README.md#a)\n\n```\n[trong fence](nope.md)\n```\n"
        )
        errors = self.errors_for({"08-backend/n.md": md({"kind": "research"}, body)})
        self.assertEqual(len(errors), 1)
        self.assertIn("08-backend/n.md:", errors[0])
        self.assertIn("liên kết hỏng -> ./khong-co.md#x", errors[0])

    def test_directory_without_readme(self):
        fw = make_fw(self.tmpdir())
        (fw / "09-orphan").mkdir()
        self.assertIn("09-orphan/: thiếu README.md (chỉ mục thư mục)", xs.validate(fw))

    def test_frontmatter_error_surfaces_from_validate(self):
        errors = self.errors_for({"08-backend/x.md": "# không frontmatter\n"})
        self.assertHas(errors, "08-backend/x.md: thiếu frontmatter")


# --------------------------------------------------------------------------- compose


class ComposeBranchesTest(TmpMixin, unittest.TestCase):
    def build(self, extra_files: dict[str, str] | None = None) -> Path:
        files = {
            "02-profiles/web.md": md(
                {"kind": "profile", "slug": "web", "modules": "[08-backend/*]"}, "# W\n\n## Nguồn\n\n- x\n"
            ),
            "02-profiles/mobile.md": md(
                {"kind": "profile", "slug": "mobile", "modules": "[]"}, "# M\n\n## Nguồn\n\n- x\n"
            ),
            "08-backend/web-only.md": md(
                {"prefix": "WEB", "applies_to": "[web]", "title": "Chỉ web"}, MODULE_BODY.format(prefix="WEB")
            ),
            "08-backend/mobile-only.md": md(
                {"prefix": "MOB", "applies_to": "[mobile]", "title": "Chỉ mobile"}, MODULE_BODY.format(prefix="MOB")
            ),
        }
        files.update(extra_files or {})
        return make_fw(self.tmpdir(), files)

    def test_compose_refuses_framework_with_errors(self):
        fw = self.build({"08-backend/bad.md": "không frontmatter"})
        with self.assertRaises(SystemExit) as cm:
            xs.compose(fw, "web", [], "M", False, today="2026-01-01")
        self.assertIn("Khung có lỗi, chạy 'xs.py validate' trước", str(cm.exception))
        self.assertIn("bad.md", str(cm.exception))

    def test_unknown_profile_and_industry(self):
        fw = self.build()
        with self.assertRaises(SystemExit) as cm:
            xs.compose(fw, "nope", [], "M", False)
        self.assertIn("Không có hồ sơ 'nope'", str(cm.exception))
        with self.assertRaises(SystemExit) as cm:
            xs.compose(fw, "web", ["ghost"], "M", False)
        self.assertIn("Không có gói ngành 'ghost'", str(cm.exception))

    def test_applies_to_filters_modules_unless_added_explicitly(self):
        fw = self.build()
        # Hồ sơ web dùng glob nên bắt cả hai module, nhưng module chỉ-mobile bị lọc theo applies_to.
        out = xs.compose(fw, "web", [], "M", False, today="2026-01-01")
        self.assertIn("`WEB-001`", out)
        self.assertNotIn("`MOB-001`", out)
        # --add là lựa chọn có chủ đích: bỏ lọc applies_to.
        out = xs.compose(fw, "web", [], "M", False, today="2026-01-01", extra=["08-backend/mobile-only"])
        self.assertIn("`MOB-001`", out)
        self.assertIn("extra: [08-backend/mobile-only]", out)

    def test_duplicate_sources_are_composed_once(self):
        fw = self.build(
            {
                "01-baseline/b.md": md(
                    {"kind": "baseline", "title": "Nền", "prefix": "BAS", "applies_to": "[all]"},
                    MODULE_BODY.format(prefix="BAS"),
                ),
                "03-industries/shop.md": md(
                    {
                        "kind": "industry",
                        "slug": "shop",
                        "title": "Ngành shop",
                        "prefix": "SHOP",
                        "modules": "[01-baseline/b]",
                    },
                    MODULE_BODY.format(prefix="SHOP"),
                ),
            }
        )
        # Baseline lặp qua modules của ngành; ngành lặp hai lần trên CLI → mỗi mục chỉ xuất hiện một lần.
        out = xs.compose(fw, "web", ["shop", "shop"], "M", False, today="2026-01-01")
        self.assertEqual(out.count("`BAS-001`"), 1)
        self.assertEqual(out.count("`SHOP-001`"), 1)
        self.assertEqual(out.count("### Ngành shop"), 1)

    def test_bad_extra_module(self):
        with self.assertRaises(SystemExit) as cm:
            xs.compose(self.build(), "web", [], "M", False, extra=["08-backend/khong-co"])
        self.assertIn("Module --add không tồn tại: 08-backend/khong-co", str(cm.exception))

    def test_scale_s_demotes_module_must_and_may_toggle(self):
        fw = self.build(
            {
                "01-baseline/b.md": md(
                    {"kind": "baseline", "prefix": "BAS", "applies_to": "[all]"},
                    "# B\n\n## Checklist\n\n- [ ] `BAS-001` **MUST** nền. → Kiểm: t.\n- [ ] `BAS-002` **MAY** tuỳ chọn.\n"
                    "\n## Nguồn\n\n- x\n",
                )
            }
        )
        out = xs.compose(fw, "web", [], "S", True, today="2026-01-01")
        self.assertIn("`BAS-001` **MUST**", out)
        self.assertIn("`WEB-001` **SHOULD**", out)
        self.assertIn("| MAY | 1 |", out)
        self.assertIn("generated: 2026-01-01", out)
        out_no_may = xs.compose(fw, "web", [], "S", False, today="2026-01-01")
        self.assertNotIn("BAS-002", out_no_may)
        self.assertNotIn("| MAY |", out_no_may)

    def test_effective_level_and_find_by_slug(self):
        item = xs.Item("X-001", "MUST", "L", "t", " ", 1)
        self.assertEqual(xs.effective_level(item, "M"), "SHOULD")
        self.assertEqual(xs.effective_level(item, "L"), "MUST")
        may = xs.Item("X-002", "MAY", None, "t", " ", 1)
        self.assertEqual(xs.effective_level(may, "S", "module"), "MAY")
        docs, _ = xs.load_docs(self.build())
        self.assertIsNotNone(xs.find_by_slug(docs, "profile", "web"))
        self.assertIsNone(xs.find_by_slug(docs, "industry", "web"))


# --------------------------------------------------------------------------- JSON / write_atomic


class JsonAndAtomicTest(TmpMixin, unittest.TestCase):
    def test_read_json_obj_variants(self):
        d = self.tmpdir()
        self.assertIsNone(xs._read_json_obj(d / "missing.json"))
        (d / "bad.json").write_text("{không phải json", encoding="utf-8")
        self.assertIsNone(xs._read_json_obj(d / "bad.json"))
        (d / "list.json").write_text("[1, 2]", encoding="utf-8")
        self.assertIsNone(xs._read_json_obj(d / "list.json"))
        (d / "ok.json").write_text('{"a": "ký tự có dấu"}', encoding="utf-8")
        self.assertEqual(xs._read_json_obj(d / "ok.json"), {"a": "ký tự có dấu"})

    def test_read_json_obj_unreadable_is_none(self):
        d = self.tmpdir()
        (d / "dir.json").mkdir()  # tồn tại nhưng đọc ra OSError
        self.assertIsNone(xs._read_json_obj(d / "dir.json"))

    def test_read_state_corrupt_is_fail_open(self):
        base = self.tmpdir()
        write(base / ".autopilot" / "state.json", "{hỏng")
        self.assertIsNone(xs.read_state(base))
        self.assertEqual(xs.loop_verdict(base)["verdict"], "inactive")

    def test_write_atomic_cleans_temp_on_failure(self):
        d = self.tmpdir()
        target = d / "sub" / "out.txt"
        with unittest.mock.patch("xs.os.replace", side_effect=OSError("đĩa đầy")):
            with self.assertRaisesRegex(OSError, "đĩa đầy"):
                xs.write_atomic(target, "nội dung")
        self.assertFalse(target.exists())
        self.assertEqual(list(target.parent.iterdir()), [])

    def test_write_atomic_cleans_temp_on_keyboard_interrupt(self):
        d = self.tmpdir()
        target = d / "out.txt"
        with unittest.mock.patch("xs.os.replace", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                xs.write_atomic(target, "x")
        self.assertEqual(list(d.iterdir()), [])

    def test_write_atomic_writes_utf8_and_overwrites(self):
        d = self.tmpdir()
        target = d / "a" / "b.txt"
        xs.write_atomic(target, "một")
        xs.write_atomic(target, "hai — ✓")
        self.assertEqual(target.read_text(encoding="utf-8"), "hai — ✓")
        self.assertEqual([p.name for p in target.parent.iterdir()], ["b.txt"])


# --------------------------------------------------------------------------- loop verdict


class LoopVerdictBranchesTest(TmpMixin, unittest.TestCase):
    def setUp(self):
        self.base = self.tmpdir()
        self.plan = self.base / "docs" / "autopilot" / "PLAN.md"

    def activate(self, **extra) -> None:
        st = {"active": True, "iterations": 0, "max_iterations": 50, "plan": "docs/autopilot/PLAN.md"}
        st.update(extra)
        xs.write_state(st, self.base)

    def evidence(self, task: str, code: int, cmd: str) -> None:
        write(
            self.base / ".autopilot" / "evidence" / f"{task}.json",
            json.dumps({"task": task, "exit_code": code, "cmd": cmd}),
        )

    def test_inactive_and_blocked(self):
        self.assertEqual(xs.loop_verdict(self.base)["verdict"], "inactive")
        self.activate(blocked=True, blocked_reason="cần người")
        v = xs.loop_verdict(self.base)
        self.assertEqual((v["verdict"], v["reason"]), ("blocked", "cần người"))

    def test_repeated_failure_blocks(self):
        self.activate(same_failure_count=3, last_failure_task="T-001")
        v = xs.loop_verdict(self.base)
        self.assertEqual(v["verdict"], "blocked")
        self.assertIn("cùng một lỗi lặp 3 lần (T-001)", v["reason"])

    def test_budget_iterations(self):
        self.activate(iterations=2, max_iterations=2)
        v = xs.loop_verdict(self.base)
        self.assertEqual(v["verdict"], "budget")
        self.assertIn("trần 2 vòng", v["reason"])

    def test_budget_deadline_passed_and_future(self):
        write(self.plan, "- [ ] `T-001` việc — Gate: `true`\n")
        self.activate(deadline="2000-01-01T00:00:00+00:00")
        v = xs.loop_verdict(self.base)
        self.assertEqual(v["verdict"], "budget")
        self.assertIn("quá hạn 2000-01-01", v["reason"])
        self.activate(deadline="2999-01-01T00:00:00+00:00")
        self.assertEqual(xs.loop_verdict(self.base)["verdict"], "continue")

    def test_missing_plan_and_empty_plan(self):
        self.activate()
        v = xs.loop_verdict(self.base)
        self.assertEqual(v["verdict"], "blocked")
        self.assertIn("không thấy PLAN", v["reason"])
        write(self.plan, "# PLAN\n\nkhông có task nào\n")
        v = xs.loop_verdict(self.base)
        self.assertEqual(v["verdict"], "blocked")
        self.assertIn("PLAN không có task", v["reason"])

    def test_waived_task_is_skipped_and_next_open_is_continue(self):
        write(self.plan, "- [~] `T-001` bỏ qua\n- [ ] `T-002` làm tiếp — Gate: `true`\n")
        self.activate()
        v = xs.loop_verdict(self.base)
        self.assertEqual((v["verdict"], v["task"]), ("continue", "T-002"))

    def test_only_waived_tasks_is_done(self):
        write(self.plan, "- [~] `T-001` bỏ qua\n")
        self.activate()
        self.assertEqual(xs.loop_verdict(self.base)["verdict"], "done")

    def test_ticked_task_evidence_paths(self):
        write(self.plan, "- [x] `T-001` xong — Gate: `echo ok`\n")
        self.activate()
        v = xs.loop_verdict(self.base)
        self.assertEqual((v["verdict"], v["task"]), ("verify", "T-001"))
        self.assertIn("chưa có bằng chứng xanh", v["reason"])
        self.evidence("T-001", 1, "echo ok")
        self.assertIn("chưa có bằng chứng xanh", xs.loop_verdict(self.base)["reason"])
        self.evidence("T-001", 0, "echo khac")
        self.assertIn("bằng chứng chạy lệnh khác", xs.loop_verdict(self.base)["reason"])
        self.evidence("T-001", 0, "echo   'ok'")
        self.assertEqual(xs.loop_verdict(self.base)["verdict"], "done")

    def test_blueprint_open_must_continues(self):
        write(self.plan, "- [x] `T-001` xong — Gate: `true`\n")
        self.evidence("T-001", 0, "true")
        write(
            self.base / "BP.md",
            "- [ ] `AAA-001` **MUST** a → Kiểm: t\n- [ ] `AAA-002` **MUST** b → Kiểm: t\n- [ ] `AAA-003` **SHOULD** c\n",
        )
        self.activate(blueprint="BP.md")
        v = xs.loop_verdict(self.base)
        self.assertEqual((v["verdict"], v["task"]), ("continue", "AAA-001"))
        self.assertIn("còn 2 mục MUST", v["reason"])

    def test_blueprint_bad_waiver_continues(self):
        write(self.plan, "- [x] `T-001` xong — Gate: `true`\n")
        self.evidence("T-001", 0, "true")
        write(self.base / "BP.md", "- [~] `AAA-001` **MUST** a → Kiểm: t\n- [x] `AAA-002` **MUST** b → Kiểm: t\n")
        self.activate(blueprint="BP.md")
        v = xs.loop_verdict(self.base)
        self.assertEqual(v["verdict"], "continue")
        self.assertIn("mục miễn trừ thiếu lý do: AAA-001 (dòng 1)", v["reason"])

    def test_blueprint_clean_or_missing_is_done(self):
        write(self.plan, "- [x] `T-001` xong — Gate: `true`\n")
        self.evidence("T-001", 0, "true")
        write(self.base / "BP.md", "- [x] `AAA-001` **MUST** a\n- [~] `AAA-002` **MAY** b — Miễn: không cần\n")
        self.activate(blueprint="BP.md")
        v = xs.loop_verdict(self.base)
        self.assertEqual(
            (v["verdict"], v["reason"]), ("done", "mọi task có bằng chứng xanh và blueprint không còn MUST mở")
        )
        # Không kiểm được blueprint thì vẫn done (PLAN là nguồn sự thật) nhưng KHÔNG được khai "blueprint sạch".
        self.activate(blueprint="khong-co.md")
        v = xs.loop_verdict(self.base)
        self.assertEqual(v["verdict"], "done")
        self.assertIn("không thấy blueprint khong-co.md", v["reason"])
        self.assertNotIn("không còn MUST mở", v["reason"])
        self.activate()
        v = xs.loop_verdict(self.base)
        self.assertEqual(v["verdict"], "done")
        self.assertIn("loop init không có --blueprint", v["reason"])
        self.assertNotIn("không còn MUST mở", v["reason"])


# --------------------------------------------------------------------------- loop record / helpers


class LoopRecordBranchesTest(TmpMixin, unittest.TestCase):
    def setUp(self):
        self.base = self.tmpdir()
        # git không được dò ngược lên thư mục cha (TMPDIR nằm trong một repo → _git_head nhặt nhầm SHA)
        ceiling = unittest.mock.patch.dict(os.environ, {"GIT_CEILING_DIRECTORIES": str(self.base.parent)})
        ceiling.start()
        self.addCleanup(ceiling.stop)
        write(self.base / "docs" / "autopilot" / "PLAN.md", "- [ ] `T-001` việc — Gate: `true`\n")
        xs.write_state({"active": True, "plan": "docs/autopilot/PLAN.md"}, self.base)
        patcher = unittest.mock.patch.dict(os.environ)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("XS_RECORD_TIMEOUT", None)

    def record(self, cmd, task="T-001"):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            code = xs.loop_record(task, cmd, self.base)
        return code, out.getvalue(), err.getvalue()

    def test_same_command_unbalanced_quote_falls_back_to_strip(self):
        self.assertTrue(xs.same_command("echo 'a", "  echo 'a  "))
        self.assertFalse(xs.same_command("echo 'a", "echo 'b"))
        self.assertTrue(xs.same_command("echo  a", "echo 'a'"))

    def test_invalid_timeout_env_returns_2_and_writes_nothing(self):
        os.environ["XS_RECORD_TIMEOUT"] = "abc"
        code, out, err = self.record(["true"])
        self.assertEqual(code, 2)
        self.assertEqual(out, "")
        self.assertIn("XS_RECORD_TIMEOUT phải là số giây", err)
        self.assertFalse((self.base / ".autopilot" / "evidence").exists())

    def test_timeout_records_124_and_counts_failure(self):
        exc = subprocess.TimeoutExpired(cmd="sleep 9", timeout=1)
        with (
            unittest.mock.patch("xs.subprocess.run", side_effect=exc),
            unittest.mock.patch("xs._git_head", return_value=None),
        ):
            code, out, _ = self.record(["sleep 9"])
            self.assertEqual(code, 124)
            self.assertIn("timeout", out)
            code, _, _ = self.record(["sleep 9"])
        ev = xs.read_evidence("T-001", self.base)
        self.assertEqual((ev["exit_code"], ev["cmd"], ev["head"]), (124, "sleep 9", None))
        self.assertIn("timeout", ev["output_tail"])
        st = xs.read_state(self.base)
        self.assertEqual(st["same_failure_count"], 2)  # cùng chữ ký lỗi hai lần liền
        self.assertEqual(st["last_failure_task"], "T-001")

    def test_failure_then_success_resets_counter_and_redacts(self):
        secret = "gh" + "p_" + "x" * 36
        code, out, _ = self.record([f"echo token={secret}; exit 3"])
        self.assertEqual(code, 3)
        self.assertNotIn(secret, out)
        ev_raw = (self.base / ".autopilot" / "evidence" / "T-001.json").read_text(encoding="utf-8")
        self.assertNotIn(secret, ev_raw)
        self.assertEqual(xs.read_state(self.base)["same_failure_count"], 1)
        code, _, _ = self.record(["true"])
        self.assertEqual(code, 0)
        st = xs.read_state(self.base)
        self.assertEqual(st["same_failure_count"], 0)
        self.assertIsNone(st["last_failure_signature"])

    def test_record_without_state_still_writes_evidence(self):
        bare = self.tmpdir()
        with redirect_stdout(io.StringIO()):
            self.assertEqual(xs.loop_record("T-009", ["true"], bare), 0)
        self.assertEqual(xs.read_evidence("T-009", bare)["exit_code"], 0)
        self.assertIsNone(xs.read_state(bare))

    def test_git_head_failures_return_none(self):
        for exc in (FileNotFoundError("git"), subprocess.TimeoutExpired(cmd="git", timeout=10)):
            with unittest.mock.patch("xs.subprocess.run", side_effect=exc):
                self.assertIsNone(xs._git_head(self.base))

    def test_git_head_real_repo_and_non_repo(self):
        self.assertIsNone(xs._git_head(self.base))  # thư mục tạm không phải repo → stdout rỗng
        subprocess.run(["git", "init", "-q", str(self.base)], check=True)
        subprocess.run(
            [
                "git",
                "-C",
                str(self.base),
                "-c",
                "user.name=t",
                "-c",
                "user.email=t@e.x",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "-q",
                "--allow-empty",
                "-m",
                "x",
            ],
            check=True,
        )
        head = xs._git_head(self.base)
        self.assertRegex(head or "", r"^[0-9a-f]{40}$")


if __name__ == "__main__":
    unittest.main()
