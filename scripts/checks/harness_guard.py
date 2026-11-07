#!/usr/bin/env python3
"""Lệnh Kiểm của BLUEPRINT về hàng rào agent (LOOP-ORCH-003, LOOP-STOP-001, LOOP-STOP-002). Đọc .claude/settings.json và
.claude/agents/*.md, chạy hook guard với đầu vào giả qua stdin. Không sửa cấu hình; hook guard tự ghi mỗi quyết định vào
.autopilot/guard-log.jsonl (session rỗng) — như lệnh cũ.

Tách khỏi `python3 -c "…"` trong BLUEPRINT vì guard của khung (3.31) coi script trình thông dịch chạm .claude/ là ghi hàng rào
và chặn chạy thẳng; nội dung kiểm giữ nguyên các lệnh cũ.

Dùng: python3 -B scripts/checks/harness_guard.py <LOOP-ORCH-003|LOOP-STOP-001|LOOP-STOP-002>
"""

import glob
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
HOOK = os.path.join(ROOT, ".claude", "hooks", "pre-bash-guard.sh")


def settings():
    with open(os.path.join(ROOT, ".claude", "settings.json"), encoding="utf-8") as f:
        return json.load(f)


def guard(command, policy=None):
    env = dict(os.environ, CLAUDE_PROJECT_DIR=ROOT, PYTHONDONTWRITEBYTECODE="1")
    env.pop("XT_GUARD_POLICY", None)
    if policy:
        env["XT_GUARD_POLICY"] = policy
    payload = json.dumps({"tool_name": "Bash", "tool_input": {"command": command}, "cwd": ROOT})
    return subprocess.run(["bash", HOOK], input=payload, capture_output=True, text=True, env=env).stdout


def orch_003():
    """Mọi tool khai trong frontmatter subagent đều nằm trong permissions.allow (subagent không bị hỏi quyền giữa chừng)."""
    allow = set(settings()["permissions"]["allow"])
    bad = []
    for f in sorted(glob.glob(os.path.join(ROOT, ".claude", "agents", "*.md"))):
        with open(f, encoding="utf-8") as fh:
            m = re.search(r"^tools: *(.*)$", fh.read(), re.M)
        if not m:  # không khai `tools:` = kế thừa MỌI tool (rộng nhất) — đỏ như lệnh cũ
            bad.append((os.path.basename(f), "không khai tools: (kế thừa mọi tool)"))
            continue
        for t in m.group(1).split(","):
            if t.strip() not in allow:
                bad.append((os.path.basename(f), t.strip()))
    return bad


def stop_001():
    """Guard trả deny cho các dạng xoá/đẩy nguy hiểm, kể cả bọc trong eval/backtick/nhóm lệnh/find -exec."""
    b = chr(96)
    cases = [
        "ls; rm -rf /",
        "git push --force",
        "eval 'rm -rf ~'",
        "echo " + b + "rm -rf ~" + b,
        "{ rm -rf ~; }",
        "find / -exec rm -rf {} +",
        "rm -rf ~/x",
    ]
    return [c for c in cases if '"deny"' not in guard(c)]


def stop_002():
    """ask rỗng; không đảo ngược → deny; đối ngoại → ask khi XT_GUARD_POLICY=strict."""
    if settings()["permissions"]["ask"] != []:
        return ["permissions.ask không rỗng"]
    cases = [
        ("gh repo delete o/r --yes", None, "deny"),
        ("git push origin main", None, "deny"),
        ("gh pr merge 5 --squash", "strict", "ask"),
        ("gh api -X PUT repos/o/r/pulls/5/merge", "strict", "ask"),
        ("gh api repos/o/r/issues -f title=x", "strict", "ask"),
        ("npm publish", "strict", "ask"),
    ]
    return [c for c, p, d in cases if '"%s"' % d not in guard(c, p)]


CHECKS = {"LOOP-ORCH-003": orch_003, "LOOP-STOP-001": stop_001, "LOOP-STOP-002": stop_002}

if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in CHECKS:
        sys.exit("dùng: harness_guard.py <%s>" % "|".join(CHECKS))
    bad = CHECKS[sys.argv[1]]()
    if bad:
        print("%s ĐỎ: %r" % (sys.argv[1], bad), file=sys.stderr)
        sys.exit(1)
    print("%s: đạt" % sys.argv[1])
