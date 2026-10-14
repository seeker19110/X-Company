#!/usr/bin/env python3
"""install.py — cài khung X-stored vào một dự án đích (mọi hệ điều hành, chỉ cần Python >= 3.11).

Kết quả trong dự án đích:
  .xstored/framework/        bản sao thư viện yêu cầu (chỉ đọc; cập nhật bằng cách chạy lại install)
  .xstored/research/         bản nghiên cứu nền mà module trích dẫn
  .xstored/scripts/xs.py     công cụ compose / blueprint-status / loop
  .xstored/scripts/dev-task.sh
  .xstored/VERSION           SHA/nhãn phiên bản khung đã cài
  .claude/settings.json, hooks/, skills/, agents/   harness (COPY-IF-ABSENT: không đè file đã có; bản mới ghi .xstored-new)
  .github/rulesets/main.json, pull_request_template.md, dependabot.yml   chỉ khi --with-github (copy-if-absent)
  AGENTS.md, CLAUDE.md, PROGRESS.md, xs.yaml       từ framework/templates (copy-if-absent, bỏ frontmatter YAML; mẫu bọc ```markdown thì lấy phần trong)

Dùng:
  python3 scripts/install.py <thư-mục-dự-án> [--force-harness] [--no-harness] [--with-github] [--label v1.0.0]
  (chạy từ bản clone của X-stored; hoặc: python3 -c "$(curl ...)" KHÔNG được khuyến khích — tải về, kiểm checksum rồi chạy)
Thoát 0 = ổn; 2 = lỗi tham số.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from collections.abc import Callable
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent
HARNESS_FILES = ["settings.json"]
HARNESS_DIRS = ["hooks", "skills", "agents"]
ROOT_TEMPLATES = {
    "AGENTS.md": "AGENTS.md",
    "CLAUDE.md": "CLAUDE.md",
    "PROGRESS.md": "PROGRESS.md",
    "xs.yaml": "xs.yaml",
}
# --with-github: hàng rào GitHub mẫu của khung (copy-if-absent). Workflow KHÔNG copy vì job quality phụ thuộc stack.
GITHUB_FILES = [".github/rulesets/main.json", ".github/pull_request_template.md", ".github/dependabot.yml"]


def log(msg: str) -> None:
    print(f"[install] {msg}", file=sys.stderr)


def strip_frontmatter(text: str) -> str:
    lines = text.splitlines()
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                return "\n".join(lines[i + 1 :]).lstrip("\n") + "\n"
    return text


def template_body(text: str) -> str:
    """Bỏ frontmatter; mẫu bọc nội dung trong khối ```markdown (PROGRESS.md) thì chỉ lấy phần trong khối."""
    text = strip_frontmatter(text)
    lines = text.splitlines()
    start = next((i for i, ln in enumerate(lines) if ln.strip() == "```markdown"), None)
    if start is None:
        return text
    end = next((i for i in range(start + 1, len(lines)) if lines[i].strip() == "```"), len(lines))
    return "\n".join(lines[start + 1 : end]).strip("\n") + "\n"


def copy_tree_replace(src: Path, dst: Path) -> None:
    """Copy vào thư mục tạm rồi mới thay: lỗi giữa chừng không để dst mất/dở."""
    tmp = dst.with_name(dst.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.copytree(src, tmp, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    if dst.exists():
        shutil.rmtree(dst)
    tmp.rename(dst)


MANIFEST = ".xstored/harness.sha256.json"


def write_atomic(path: Path, text: str) -> None:
    """Ghi qua tệp tạm cùng thư mục rồi đổi tên — lỗi giữa chừng không để settings/manifest dở (BASE-DATA-009)."""
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def load_manifest(target: Path) -> dict[str, str]:
    try:
        data = json.loads((target / MANIFEST).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def copy_if_absent(
    src: Path,
    dst: Path,
    force: bool = False,
    transform: Callable[[str], str] | None = None,
    installed_hash: str | None = None,
) -> str:
    """Trả 'copied' | 'kept' | 'updated' | 'updated-new' | 'skipped-symlink'.

    Không bao giờ đè file người dùng đã sửa (trừ force). File còn đúng hash bản khung đã cài lần trước
    (`installed_hash`, người dùng chưa sửa) thì cập nhật tại chỗ — bản sửa hook tới được dự án đã cài (AUD-HAR-004).
    Đích là symlink → bỏ qua, không đi theo (AUD-HAR-010).
    """
    data = src.read_bytes()
    if transform:
        data = transform(data.decode("utf-8")).encode("utf-8")
    dst.parent.mkdir(parents=True, exist_ok=True)
    new = dst.with_name(dst.name + ".xstored-new")
    if dst.is_symlink() or new.is_symlink():
        log(f"  ⚠ bỏ qua symlink {dst} (không ghi qua liên kết)")
        return "skipped-symlink"
    status = "copied"
    if dst.exists() and not force:
        current = dst.read_bytes()
        if current == data:
            return "kept"
        if installed_hash is None or sha256(current) != installed_hash:
            new.write_bytes(data)
            return "updated-new"
        status = "updated"
    dst.write_bytes(data)
    if src.suffix == ".sh":
        dst.chmod(dst.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP)
    return status


def merge_hooks(src: Path, dst: Path) -> str:
    """settings.json của dự án đã có: thêm khoá `hooks` của khung còn thiếu (giữ nguyên permissions và hook riêng).

    Trước đây file có sẵn chỉ sinh `.xstored-new` nên hook đã copy mà không chạy (AUD-HAR-003).
    """
    if dst.is_symlink():
        log(f"  ⚠ bỏ qua symlink {dst}")
        return "skipped-symlink"
    try:
        ours = json.loads(src.read_text(encoding="utf-8"))
        theirs = json.loads(dst.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        log(f"  ⚠ {dst}: không đọc được JSON ({exc}) — HOOK CHƯA ĐĂNG KÝ, gộp tay từ .claude/settings.json.xstored-new")
        return "invalid-json"
    hooks = theirs.setdefault("hooks", {})
    added = 0
    for event, entries in ours.get("hooks", {}).items():
        have = {h.get("command") for e in hooks.get(event, []) for h in e.get("hooks", [])}
        for entry in entries:
            cmds = [h.get("command") for h in entry.get("hooks", [])]
            if not any(c in have for c in cmds):
                hooks.setdefault(event, []).append(entry)
                added += 1
    if not added:
        return "kept"
    write_atomic(dst, json.dumps(theirs, ensure_ascii=False, indent=2) + "\n")
    return "merged-hooks"


def framework_label(explicit: str | None) -> str:
    """Nhãn ghi vào .xstored/VERSION: --label, hoặc '<VERSION> (<git sha>)' của bản khung đang cài."""
    if explicit:
        return explicit
    version = (SRC / "VERSION").read_text(encoding="utf-8").strip() if (SRC / "VERSION").exists() else "unknown"
    try:
        r = subprocess.run(
            ["git", "-C", str(SRC), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, timeout=10
        )
        if r.returncode == 0 and r.stdout.strip():
            return f"{version} ({r.stdout.strip()})"
    except (OSError, subprocess.TimeoutExpired):
        pass
    return version


def install(target: Path, force_harness: bool, no_harness: bool, label: str | None, with_github: bool = False) -> int:
    target = target.resolve()
    if not target.is_dir():
        log(f"✗ không phải thư mục: {target}")
        return 2
    if target == SRC:
        log("✗ không cài khung vào chính repo khung")
        return 2
    xs_dir = target / ".xstored"
    xs_dir.mkdir(exist_ok=True)

    # 1) framework + scripts: thay thế toàn bộ (bản chỉ đọc, ID ổn định nên blueprint cũ vẫn so được).
    copy_tree_replace(SRC / "framework", xs_dir / "framework")
    # research/ đi kèm vì module trong framework/ trỏ tới nguồn nghiên cứu bằng đường dẫn tương đối.
    if (SRC / "research").is_dir():
        copy_tree_replace(SRC / "research", xs_dir / "research")
    (xs_dir / "scripts").mkdir(exist_ok=True)
    for f in ("xs.py", "dev-task.sh", "check-links.py"):
        shutil.copy2(SRC / "scripts" / f, xs_dir / "scripts" / f)
    (xs_dir / "scripts" / "dev-task.sh").chmod(0o755)
    (xs_dir / "VERSION").write_text(framework_label(label) + "\n", encoding="utf-8")
    (xs_dir / "README.md").write_text(
        "# .xstored/\n\nBản sao khung X-stored (chỉ đọc). Cập nhật: chạy lại `install.py` từ bản khung mới.\n"
        "Ghép blueprint: `python3 .xstored/scripts/xs.py compose --profile <p> --scale <S|M|L> --out BLUEPRINT.md`.\n",
        encoding="utf-8",
    )
    log(f"✓ .xstored/framework + scripts (phiên bản {framework_label(label)})")

    # 2) harness .claude/ — copy-if-absent
    stats: dict[str, int] = {}
    if not no_harness:
        manifest = load_manifest(target)
        new_manifest = {}
        settings = target / ".claude" / "settings.json"
        if settings.exists() and not force_harness:
            r = merge_hooks(SRC / ".claude" / "settings.json", settings)
            stats[r] = stats.get(r, 0) + 1
            if r == "merged-hooks":
                log("  .claude/settings.json: đã thêm khoá hooks của khung (giữ nguyên quyền và hook riêng)")
        else:
            r = copy_if_absent(SRC / ".claude" / "settings.json", settings, force_harness)
            stats[r] = stats.get(r, 0) + 1
        sources = [SRC / ".claude" / f for f in HARNESS_FILES if f != "settings.json"]
        for d in HARNESS_DIRS:
            sources += [
                p for p in sorted((SRC / ".claude" / d).rglob("*")) if p.is_file() and "__pycache__" not in p.parts
            ]
        for src in sources:
            rel = src.relative_to(SRC).as_posix()
            r = copy_if_absent(src, target / rel, force_harness, installed_hash=manifest.get(rel))
            stats[r] = stats.get(r, 0) + 1
            if r in ("copied", "updated", "kept"):
                new_manifest[rel] = sha256(src.read_bytes())
            elif rel in manifest:
                new_manifest[rel] = manifest[rel]
        write_atomic(target / MANIFEST, json.dumps(new_manifest, indent=2, sort_keys=True) + "\n")
        log("✓ .claude/: " + " · ".join(f"{k} {v}" for k, v in sorted(stats.items())))
        if stats.get("updated-new"):
            log("  ⚠ có file .xstored-new: bạn đã sửa bản cũ — so sánh và gộp tay bản mới của khung")

    # 3) file gốc từ templates — copy-if-absent, bỏ frontmatter
    for name, tmpl in ROOT_TEMPLATES.items():
        tsrc = SRC / "framework" / "templates" / tmpl
        if not tsrc.exists():
            continue
        r = copy_if_absent(tsrc, target / name, False, transform=template_body)
        log(f"  {name}: {r}")

    # 3b) --with-github: ruleset mẫu + PR template + Dependabot (copy-if-absent)
    if with_github:
        for gh in GITHUB_FILES:
            r = copy_if_absent(SRC / gh, target / gh, False)
            log(f"  {gh}: {r}")
        try:
            rules = json.loads((SRC / ".github/rulesets/main.json").read_text(encoding="utf-8"))["rules"]
            checks = [
                c["context"]
                for r in rules
                if r["type"] == "required_status_checks"
                for c in r["parameters"]["required_status_checks"]
            ]
        except (OSError, ValueError, KeyError):
            checks = []
        if (
            checks
        ):  # AUD-CI-003: workflow không được copy (phụ thuộc stack) → import ruleset trước khi có job sẽ khoá merge
            log(
                f"  ⚠ ruleset mẫu đòi required check: {', '.join(checks)} — tạo workflow có job ĐÚNG tên trước khi import, "
                "hoặc sửa danh sách check trong .github/rulesets/main.json; nếu không, mọi PR sẽ treo chờ check"
            )

    # 4) .gitignore: thêm .autopilot/ nếu thiếu
    gi = target / ".gitignore"
    line = ".autopilot/"
    if gi.exists():
        if line not in gi.read_text(encoding="utf-8").splitlines():
            with gi.open("a", encoding="utf-8") as fh:
                fh.write(f"\n# X-stored: trạng thái autopilot cục bộ\n{line}\n")
            log("  .gitignore: thêm .autopilot/")
    else:
        gi.write_text(f"# X-stored: trạng thái autopilot cục bộ\n{line}\n", encoding="utf-8")
        log("  .gitignore: tạo mới")

    log(
        "Xong. Bước tiếp: đọc AGENTS.md, điền xs.yaml, rồi `python3 .xstored/scripts/xs.py list profiles` → compose BLUEPRINT.md."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Cài khung X-stored vào dự án đích")
    p.add_argument("target", help="thư mục gốc dự án đích")
    p.add_argument("--force-harness", action="store_true", help="đè .claude/ của dự án bằng bản khung")
    p.add_argument("--no-harness", action="store_true", help="không copy .claude/")
    p.add_argument("--label", help="nhãn phiên bản ghi vào .xstored/VERSION (mặc định: git SHA)")
    p.add_argument(
        "--with-github", action="store_true", help="copy ruleset mẫu, PR template, Dependabot vào .github/ (không đè)"
    )
    a = p.parse_args(argv)
    return install(Path(a.target), a.force_harness, a.no_harness, a.label, a.with_github)


if __name__ == "__main__":
    sys.exit(main())
