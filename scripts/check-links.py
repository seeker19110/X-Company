#!/usr/bin/env python3
"""check-links.py — kiểm liên kết Markdown nội bộ (tương đối) trên TOÀN repo, không chỉ framework/.

- Mọi `[text](đường/dẫn.md#anchor)` tương đối phải trỏ tới file/thư mục có thật.
- Bỏ qua URL (http:, mailto:…), anchor thuần (#…), nội dung trong code fence.
- Bỏ qua thư mục: .git, node_modules, .venv, .autopilot, __pycache__.
Thoát 1 nếu có link hỏng. Chỉ dùng thư viện chuẩn.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {".git", "node_modules", ".venv", ".autopilot", "__pycache__", ".xstored"}
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")


def iter_md(root: Path):
    for p in sorted(root.rglob("*.md")):
        if any(part in SKIP_DIRS for part in p.relative_to(root).parts):
            continue
        yield p


def check(root: Path) -> list[str]:
    errors: list[str] = []
    for p in iter_md(root):
        in_fence = False
        for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), start=1):
            if line.lstrip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            for target in LINK_RE.findall(line):
                if re.match(r"^[a-z][a-z0-9+.-]*:", target) or target.startswith("#"):
                    continue
                path_part = target.split("#", 1)[0]
                if not path_part:
                    continue
                # Đường dẫn tuyệt đối từ gốc repo (/docs/x.md) cũng chấp nhận.
                resolved = (root / path_part.lstrip("/")) if path_part.startswith("/") else (p.parent / path_part)
                if not resolved.exists():
                    errors.append(f"{p.relative_to(root)}:{n}: liên kết hỏng -> {target}")
    return errors


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT
    errors = check(root)
    for e in errors:
        print(f"✗ {e}")
    if errors:
        print(f"\n{len(errors)} liên kết hỏng.")
        return 1
    print("✓ Mọi liên kết Markdown nội bộ đều trỏ tới file có thật.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
