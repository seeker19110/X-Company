#!/usr/bin/env python3
"""guard.py — phân tích lệnh/đường dẫn cho hook PreToolUse của khung X-stored (chỉ thư viện chuẩn).

Dùng (payload JSON của Claude Code trên stdin, kết quả JSON trên stdout):
  guard.py bash   → {"decision": "deny"|"ask"|"", "reason": "...", "commit": true|false, "no_verify": true|false}
  guard.py edit   → {"decision": "deny"|"ask"|"", "reason": "..."}

Vì sao Python thay regex trong bash (audit 2026-10-14, AUD-SEC-001…010):
- tách lệnh theo token shell (`shlex`): `|`/`;` trong nháy không phải ranh giới, thân heredoc là dữ liệu;
- chuẩn hoá trước khi so luật: bỏ gán biến đầu lệnh, `command`/`env`/`nohup`/`time`, tuỳ chọn toàn cục của git (`-C`, `-c`, …);
- đọc payload qua stdin, không qua argv (lệnh rất dài không còn làm hook lỗi rồi cho qua).
Hàng rào này chống TAI NẠN (agent gõ nhầm), không phải sandbox: lệnh cố ý né (eval chuỗi ghép, base64…) không nằm trong phạm vi.
Lỗi bất ngờ → in quyết định rỗng (fail-open về luồng); luật deny là fail-closed về hành động đã nhận ra.
"""

from __future__ import annotations

import json
import os
import posixpath
import re
import shlex
import sys
from typing import Dict, List, Optional, Tuple

WRAPPERS = {"command", "builtin", "exec", "nohup", "time", "nice", "stdbuf", "xargs"}
SHELLS = {"sh", "bash", "zsh", "dash", "ksh", "fish"}
INTERPRETERS = SHELLS | {"python", "python3", "node", "perl", "ruby", "php", "deno", "bun", "pwsh"}
FETCHERS = {"curl", "wget"}
MAIN_BRANCHES = {"main", "master"}
GIT_OPTS_WITH_VALUE = {"-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"}
DANGEROUS_RM_TARGETS = {"/", "~", "$HOME", "${HOME}", ".", "..", "*", "/*", "~/*", ".*"}

# Đường dẫn được bảo vệ (dùng chung cho Edit/Write và cho lệnh Bash ghi file).
SECRET_PATTERNS = (
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "secrets/*",
    "*id_rsa*",
    "*id_ed25519*",
    ".envrc",
    ".npmrc",
    ".pypirc",
    ".netrc",
)
GATE_PATTERNS = (
    ".github/workflows/*",
    ".github/rulesets/*",
    ".github/dependabot.yml",
    ".gitlab-ci.yml",
    ".claude/settings.json",
    ".claude/settings.local.json",
    ".claude/hooks/*",
    ".xstored/*",
    "eslint.config.*",
    ".eslintrc*",
    "biome.json*",
    ".oxlintrc*",
    "tsconfig*.json",
    "jsconfig*.json",
    "vitest.config.*",
    "jest.config.*",
    "playwright.config.*",
    "lighthouserc*",
    ".lighthouserc*",
    "pyproject.toml",
    "setup.cfg",
    "mypy.ini",
    "pyrightconfig.json",
    "ruff.toml",
    ".coveragerc",
    "codecov.yml",
    ".codecov.yml",
    ".pre-commit-config.yaml",
    ".husky/*",
    "lefthook.yml",
    ".lintstagedrc*",
    "commitlint.config.*",
    "xs.yaml",
    "dev-task.sh",
    "Makefile",
    "justfile",
    ".gitleaks.toml",
    ".gitleaksignore",
    ".semgrep*",
    "sonar-project.properties",
    "requirements-dev.txt",
)
MIGRATION_RE = re.compile(r"(^|/)(migrations?|migrate)/|(^|/)db/schema\.|(^|/)prisma/schema\.prisma$")


# --------------------------------------------------------------------------- đường dẫn


def rel_path(path: str, root: str) -> str:
    """Đường dẫn tương đối chuẩn hoá (realpath cả hai phía, bỏ ./ // ..); ngoài gốc → giữ đường dẫn chuẩn hoá."""
    p = path if os.path.isabs(path) else os.path.join(root, path)
    rp, rr = os.path.realpath(p), os.path.realpath(root)
    try:
        rel = os.path.relpath(rp, rr)
    except ValueError:
        return rp
    return rp if rel.startswith("..") else rel.replace(os.sep, "/")


def _match_any(rel: str, patterns: Tuple[str, ...]) -> bool:
    """Khớp mẫu ở gốc hoặc ở BẤT KỲ thư mục con (monorepo: frontend/tsconfig.json, packages/api/pyproject.toml)."""
    import fnmatch

    parts = rel.split("/")
    for i in range(len(parts)):
        tail = "/".join(parts[i:])
        if any(fnmatch.fnmatchcase(tail, pat) for pat in patterns):
            return True
    return False


def classify_path(rel: str) -> str:
    """'secret' | 'gate' | 'migration' | ''."""
    if _match_any(rel, SECRET_PATTERNS) and not rel.endswith((".example", ".sample", ".template")):
        return "secret"
    if _match_any(rel, GATE_PATTERNS):
        return "gate"
    if MIGRATION_RE.search(rel):
        return "migration"
    return ""


def edit_decision(path: str, root: str) -> Tuple[str, str]:
    rel = rel_path(path, root)
    kind = classify_path(rel)
    if kind == "secret":
        return "deny", f"Không ghi file bí mật qua agent: {rel} (dùng secret manager/biến môi trường)."
    if kind == "gate":
        return (
            "ask",
            f"Sửa cấu hình cổng/CI/harness ({rel}). Khung coi đây là điểm dừng: nói rõ lý do trước khi nới hàng rào.",
        )
    if kind == "migration" and os.path.exists(os.path.join(root, rel)):
        return "ask", (
            f"Sửa migration/schema ĐÃ TỒN TẠI ({rel}). Migration đã áp không được sửa — tạo migration mới. "
            "Nếu chưa áp ở đâu, xác nhận rồi tiếp."
        )
    return "", ""


# --------------------------------------------------------------------------- tách lệnh


HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")


def strip_heredocs(cmd: str) -> str:
    """Bỏ thân heredoc (dữ liệu, không phải lệnh) — giữ dòng mở heredoc."""
    lines = cmd.split("\n")
    out: List[str] = []
    pending: List[str] = []
    for line in lines:
        if pending:
            if line.strip() == pending[0]:
                pending.pop(0)
            continue
        out.append(line)
        pending = [m.group(2) for m in HEREDOC_RE.finditer(line)]
    return "\n".join(out)


def tokenize(cmd: str) -> List[str]:
    cmd = strip_heredocs(cmd.replace("\\\n", ""))
    lex = shlex.shlex(cmd, posix=True, punctuation_chars="();<>|&\n")
    lex.whitespace = " \t\r"
    lex.whitespace_split = True
    lex.commenters = "#"
    try:
        return list(lex)
    except ValueError:  # nháy không đóng: tách thô để vẫn kiểm được (bảo thủ)
        return re.split(r"\s+|(?=[;&|\n])|(?<=[;&|\n])", cmd)


PUNCT = set("();<>|&\n")


def _is_punct(t: str) -> bool:
    return bool(t) and set(t) <= PUNCT


def _is_redirect(t: str) -> bool:
    return _is_punct(t) and ("<" in t or ">" in t) and "(" not in t and "|" not in t


def split_commands(tokens: List[str]) -> List[List[str]]:
    """Danh sách lệnh đơn (argv). `<(`/`>(`/`;`/`|`/`&&`/`(`… mở lệnh mới; chuyển hướng `>`/`<` giữ lại làm token."""
    cmds: List[List[str]] = [[]]
    for t in tokens:
        if _is_punct(t) and not _is_redirect(t):
            cmds.append([])
        else:
            cmds[-1].append(t)
    return [c for c in cmds if c]


def pipelines(tokens: List[str]) -> List[List[List[str]]]:
    """Nhóm lệnh theo ống `|` (để nhận `curl … | sh`)."""
    groups: List[List[List[str]]] = [[[]]]
    for t in tokens:
        if t in ("|", "|&"):
            groups[-1].append([])
        elif _is_punct(t) and not _is_redirect(t):
            groups.append([[]])
        else:
            groups[-1][-1].append(t)
    return [[c for c in g if c] for g in groups if any(g)]


def normalize(argv: List[str]) -> List[str]:
    """Bỏ gán biến đầu lệnh, wrapper (`command`, `env -i`, `nohup`…), đường dẫn của argv[0], tuỳ chọn toàn cục git."""
    a = list(argv)
    while a:
        head = a[0]
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*", head):
            a.pop(0)
        elif posixpath.basename(head) == "env":
            a.pop(0)
            while a and (a[0].startswith("-") or "=" in a[0]):
                opt = a.pop(0)
                if opt in ("-u", "-C", "-S") and a:
                    a.pop(0)
        elif posixpath.basename(head) in WRAPPERS:
            a.pop(0)
            while a and a[0].startswith("-"):
                a.pop(0)
        else:
            break
    if not a:
        return a
    a[0] = posixpath.basename(a[0])
    if a[0] == "git":
        rest = a[1:]
        out = ["git"]
        i = 0
        while i < len(rest) and rest[i].startswith("-"):
            opt = rest[i]
            i += 2 if opt in GIT_OPTS_WITH_VALUE else 1
        out += rest[i:]
        return out
    return a


def _short_flags(args: List[str]) -> str:
    return "".join(x[1:] for x in args if re.fullmatch(r"-[A-Za-z]+", x))


def _positionals(args: List[str], with_value: Tuple[str, ...] = ()) -> List[str]:
    out, skip = [], False
    for x in args:
        if skip:
            skip = False
            continue
        if x in with_value:
            skip = True
            continue
        if x == "--" or x.startswith("-"):
            continue
        out.append(x)
    return out


def _rm_target(t: str) -> str:
    t = t.rstrip("/") or "/"
    return t[:-2] if t.endswith("/*") and len(t) > 2 else t


# --------------------------------------------------------------------------- luật


def remote_exec(cmd: str, tokens: List[str]) -> Optional[str]:
    """curl/wget đưa thẳng vào trình thông dịch: `curl … | sh`, `sh -c "$(curl …)"`, `bash <(curl …)`."""
    for group in pipelines(tokens):
        names = [normalize(c)[0] if normalize(c) else "" for c in group]
        for i, name in enumerate(names):
            if name in FETCHERS and any(
                re.fullmatch(r"(python|ruby|perl|node)[0-9.]*|" + "|".join(INTERPRETERS), m) or m == "sudo"
                for m in names[i + 1 :]
            ):
                return "curl|sh"
    for c in split_commands(tokens):
        n = normalize(c)
        if n and (n[0] in INTERPRETERS or n[0] in ("eval", "source", ".")):
            if any(re.search(r"(\$\(|`)\s*(curl|wget)\b", x) for x in n[1:]):
                return "sh -c $(curl)"
    # Process substitution: shlex tách `<(` thành `<` `(`: tìm trình thông dịch ngay trước `<` `(` `curl`.
    for i, t in enumerate(tokens[:-1]):
        if t in ("<(", "<", "(") and "<" in "".join(tokens[max(0, i - 1) : i + 1]) and tokens[i + 1] in FETCHERS:
            return "bash <(curl)"
    return None


def git_rules(n: List[str]) -> Tuple[str, str]:
    if len(n) < 2:
        return "", ""
    sub, args = n[1], n[2:]
    flags = _short_flags(args)
    if sub == "push":
        force = any(x.startswith("--force") or x == "--mirror" for x in args) or "f" in flags
        refs = _positionals(args, ("-o", "--push-option", "--repo", "--receive-pack", "--exec"))
        if force or any(r.startswith("+") for r in refs):
            return "deny", "push --force/--mirror/+refspec ghi đè lịch sử"
        deleting = "--delete" in args or "d" in flags
        for r in refs[1:]:
            dst = r.split(":", 1)[1] if ":" in r else r
            dst = dst.removeprefix("refs/heads/")
            if dst in MAIN_BRANCHES and (deleting or r.startswith(":")):
                return "deny", "xoá nhánh chính trên remote"
            if dst in MAIN_BRANCHES:
                return "ask", "push thẳng nhánh chính — khung yêu cầu đi qua PR"
        return "", ""
    if sub == "reset" and "--hard" in args:
        return "deny", "reset --hard làm mất thay đổi"
    if sub == "clean" and ("f" in flags or "--force" in args):
        return "deny", "clean -f xoá file chưa track"
    if sub in ("checkout", "restore"):
        targets = args[args.index("--") + 1 :] if "--" in args else _positionals(args, ("-s", "--source", "-b", "-B"))
        whole = any(t in (".", "./", ":/", "*") for t in targets)
        if sub == "checkout" and ("f" in flags or "--force" in args):
            return "deny", "checkout -f vứt thay đổi"
        if whole and not (sub == "restore" and "--staged" in args and "--worktree" not in args and "W" not in flags):
            return "deny", f"{sub} . vứt toàn bộ thay đổi chưa commit"
        return "", ""
    if sub == "stash" and args[:1] in (["drop"], ["clear"]):
        return "ask", f"stash {args[0]} xoá thay đổi đã cất"
    if sub == "branch":
        deleting_force = "D" in flags or (("d" in flags or "--delete" in args) and ("f" in flags or "--force" in args))
        if deleting_force and any(x in MAIN_BRANCHES for x in _positionals(args)):
            return "deny", "xoá nhánh chính"
    return "", ""


ASK_CMDS: Dict[str, Optional[Tuple[str, ...]]] = {
    "gh": ("release", "secret"),
    "npm": ("publish",),
    "pnpm": ("publish",),
    "yarn": ("publish",),
    "twine": ("upload",),
    "cargo": ("publish",),
    "docker": ("push",),
    "kubectl": ("apply", "delete"),
    "terraform": ("apply", "destroy"),
    "tofu": ("apply", "destroy"),
    "pulumi": ("up", "destroy"),
    "fly": ("deploy",),
    "vercel": ("deploy", "--prod"),
    "aws": None,
    "gcloud": None,
    "az": None,
}
INFO_ONLY = {"--version", "-v", "version", "--help", "-h", "help"}


def command_rules(n: List[str], root: str) -> Tuple[str, str]:
    name, args = n[0], n[1:]
    if name in ("sudo", "doas"):
        return "deny", "sudo/doas"
    if name == "rm":
        flags = _short_flags(args)
        recursive = "r" in flags or "R" in flags or "--recursive" in args
        force = "f" in flags or "--force" in args
        if "--no-preserve-root" in args or (
            recursive and force and any(_rm_target(t) in DANGEROUS_RM_TARGETS for t in _positionals(args))
        ):
            return "deny", "rm -rf trên /, ~, $HOME, ., .., *"
    if name == "dd" and any(x.startswith("if=") for x in args):
        return "deny", "dd ghi thô"
    if name.startswith("mkfs"):
        return "deny", "mkfs"
    if name == "chmod" and "777" in args:
        return "deny", "chmod 777"
    if name == "git":
        return git_rules(n)
    if name in ASK_CMDS and not (set(args) and set(args) <= INFO_ONLY):
        subs = ASK_CMDS[name]
        if (
            subs is None
            or (args and args[0] in subs)
            or (name == "gh" and args[:2] in (["repo", "delete"], ["pr", "merge"]))
            or (name == "vercel" and "--prod" in args)
        ):
            return "ask", "hành động đối ngoại/triển khai thật (điểm dừng bắt buộc)"
    return "", ""


def write_targets(n: List[str], argv: List[str]) -> List[str]:
    """File mà lệnh có thể ghi: chuyển hướng `>`/`>>`, `sed -i`, `tee`, đích của cp/mv/install/truncate/ln."""
    out = [argv[i + 1] for i, t in enumerate(argv[:-1]) if t in (">", ">>", ">|", "&>")]
    name, args = (n[0], n[1:]) if n else ("", [])
    pos = _positionals(args, ("-e", "-f", "-s", "-t", "--target-directory", "-m", "--mode"))
    if name == "sed" and any(x == "-i" or x.startswith("-i") or x.startswith("--in-place") for x in args):
        out += pos[1:] if not any(x in ("-e", "-f") for x in args) else pos
    elif name == "tee":
        out += pos
    elif name in ("cp", "mv", "install", "ln") and len(pos) >= 2:
        out.append(pos[-1])
    elif name in ("truncate", "rm"):
        out += pos
    return out


def bash_decision(cmd: str, root: str) -> Dict[str, object]:
    tokens = tokenize(cmd)
    res: Dict[str, object] = {"decision": "", "reason": "", "commit": False, "no_verify": False}
    rx = remote_exec(cmd, tokens)
    if rx:
        res.update(
            decision="deny",
            reason=f"Cấm chạy script tải từ mạng ({rx}): tải về, kiểm checksum rồi mới chạy. Lệnh: {cmd[:300]}",
        )
        return res
    asks: List[str] = []
    for argv in split_commands(tokens):
        n = normalize(argv)
        if not n:
            continue
        decision, why = command_rules(n, root)
        if decision == "deny":
            res.update(
                decision="deny",
                reason=f"Lệnh bị khung chặn ({why}): {' '.join(argv)[:300]}. Muốn làm thật thì người dùng tự chạy.",
            )
            return res
        if decision == "ask":
            asks.append(f"{why}: {' '.join(argv)[:200]}")
        for target in write_targets(n, argv):
            kind = classify_path(rel_path(target, root)) if target and not target.startswith("/dev/") else ""
            if kind == "secret":
                asks.append(f"ghi file bí mật qua Bash: {target}")
            elif kind in ("gate", "migration"):
                asks.append(f"sửa cấu hình cổng/CI/harness/migration qua Bash ({target}) — nói rõ lý do")
        if n[0] == "git" and len(n) > 1 and n[1] == "commit":
            args = n[2:]
            if "--allow-empty" in args:
                res.update(
                    decision="deny",
                    reason="Commit rỗng bị khung chặn (không dùng empty commit để kích CI). Push thay đổi thật hoặc re-run job.",
                )
                return res
            msg_free = []
            skip = False
            for x in args:
                if skip:
                    skip = False
                    continue
                if x in ("-m", "--message", "-F", "--file", "-c", "-C", "--author", "--date", "-t", "--template"):
                    skip = True
                    continue
                msg_free.append(x)
            res["commit"] = True
            if "--no-verify" in msg_free or "n" in _short_flags(msg_free):
                res["no_verify"] = True
                asks.append("commit --no-verify bỏ qua cổng chất lượng — cần người xác nhận lý do")
    if asks:
        res.update(decision="ask", reason="Khung cần xác nhận: " + "; ".join(dict.fromkeys(asks)))
    return res


def main() -> int:
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        tool_input = payload.get("tool_input") or {}
        root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
        if mode == "bash":
            cmd = tool_input.get("command")
            out: Dict[str, object] = bash_decision(cmd, root) if isinstance(cmd, str) and cmd else {"decision": ""}
        elif mode == "edit":
            path = tool_input.get("file_path")
            d, r = edit_decision(path, root) if isinstance(path, str) and path else ("", "")
            out = {"decision": d, "reason": r}
        else:
            out = {"decision": ""}
    except Exception:  # fail-open về luồng: lỗi của hook không được kẹt phiên
        out = {"decision": ""}
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
