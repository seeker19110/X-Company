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
import shutil
import stat
import subprocess
import sys
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


def copy_if_absent(src: Path, dst: Path, force: bool = False, transform=None) -> str:
    """Trả 'copied' | 'kept' | 'updated-new'. Không bao giờ đè file người dùng đã sửa (trừ force)."""
    data = src.read_bytes()
    if transform:
        data = transform(data.decode("utf-8")).encode("utf-8")
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and not force:
        if dst.read_bytes() == data:
            return "kept"
        new = dst.with_name(dst.name + ".xstored-new")
        new.write_bytes(data)
        return "updated-new"
    dst.write_bytes(data)
    if src.suffix == ".sh":
        dst.chmod(dst.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP)
    return "copied"


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
    for f in ("xs.py", "dev-task.sh"):
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
    stats = {"copied": 0, "kept": 0, "updated-new": 0}
    if not no_harness:
        for f in HARNESS_FILES:
            stats[copy_if_absent(SRC / ".claude" / f, target / ".claude" / f, force_harness)] += 1
        for d in HARNESS_DIRS:
            for src in sorted((SRC / ".claude" / d).rglob("*")):
                if src.is_file():
                    rel = src.relative_to(SRC / ".claude")
                    stats[copy_if_absent(src, target / ".claude" / rel, force_harness)] += 1
        log(
            f"✓ .claude/: copy {stats['copied']} · giữ nguyên {stats['kept']} · có bản mới (.xstored-new) {stats['updated-new']}"
        )

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


def main(argv=None) -> int:
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
