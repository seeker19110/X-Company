#!/usr/bin/env python3
"""guard.py — phân tích lệnh/đường dẫn cho hook PreToolUse của khung X-Templates (chỉ thư viện chuẩn).

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
from typing import Callable, Dict, List, Optional, Tuple

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


ENV_ASSIGN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*=.*")


def _skip_env_args(a: List[str]) -> None:
    """Sau `env`: bỏ tuỳ chọn và gán biến tại chỗ (`-u`/`-C`/`-S` kèm một giá trị)."""
    while a and (a[0].startswith("-") or "=" in a[0]):
        opt = a.pop(0)
        if opt in ("-u", "-C", "-S") and a:
            a.pop(0)


def _strip_prefixes(argv: List[str]) -> List[str]:
    """Bỏ gán biến đầu lệnh và wrapper (`command`, `env -i`, `nohup`…) cho tới khi gặp lệnh thật."""
    a = list(argv)
    while a:
        head = a[0]
        if ENV_ASSIGN_RE.fullmatch(head):
            a.pop(0)
        elif posixpath.basename(head) == "env":
            a.pop(0)
            _skip_env_args(a)
        elif posixpath.basename(head) in WRAPPERS:
            a.pop(0)
            while a and a[0].startswith("-"):
                a.pop(0)
        else:
            break
    return a


def _strip_git_global_opts(a: List[str]) -> List[str]:
    """`git -C p -c k=v --no-pager sub …` → `git sub …` (tuỳ chọn có giá trị ăn thêm một token)."""
    rest = a[1:]
    i = 0
    while i < len(rest) and rest[i].startswith("-"):
        i += 2 if rest[i] in GIT_OPTS_WITH_VALUE else 1
    return ["git", *rest[i:]]


def normalize(argv: List[str]) -> List[str]:
    """Bỏ gán biến đầu lệnh, wrapper (`command`, `env -i`, `nohup`…), đường dẫn của argv[0], tuỳ chọn toàn cục git."""
    a = _strip_prefixes(argv)
    if not a:
        return a
    a[0] = posixpath.basename(a[0])
    return _strip_git_global_opts(a) if a[0] == "git" else a


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


GitRule = Callable[[List[str]], Tuple[str, str]]
DISCARD_WHOLE_TREE_WHY = "{} . vứt toàn bộ thay đổi chưa commit"


def _push_ref_rule(ref: str, deleting: bool) -> Tuple[str, str]:
    """Một refspec của push: đích là nhánh chính → deny nếu xoá, ask nếu đẩy thẳng."""
    dst = ref.split(":", 1)[1] if ":" in ref else ref
    dst = dst.removeprefix("refs/heads/")
    if dst not in MAIN_BRANCHES:
        return "", ""
    if deleting or ref.startswith(":"):
        return "deny", "xoá nhánh chính trên remote"
    return "ask", "push thẳng nhánh chính — khung yêu cầu đi qua PR"


def _git_push(args: List[str]) -> Tuple[str, str]:
    """push: deny --force/--mirror/+refspec và xoá nhánh chính; ask khi đẩy thẳng nhánh chính."""
    flags = _short_flags(args)
    force = any(x.startswith("--force") or x == "--mirror" for x in args) or "f" in flags
    refs = _positionals(args, ("-o", "--push-option", "--repo", "--receive-pack", "--exec"))
    if force or any(r.startswith("+") for r in refs):
        return "deny", "push --force/--mirror/+refspec ghi đè lịch sử"
    deleting = "--delete" in args or "d" in flags
    for r in refs[1:]:
        verdict = _push_ref_rule(r, deleting)
        if verdict[0]:
            return verdict
    return "", ""


def _git_reset(args: List[str]) -> Tuple[str, str]:
    """reset: deny --hard."""
    if "--hard" in args:
        return "deny", "reset --hard làm mất thay đổi"
    return "", ""


def _git_clean(args: List[str]) -> Tuple[str, str]:
    """clean: deny -f/--force."""
    if "f" in _short_flags(args) or "--force" in args:
        return "deny", "clean -f xoá file chưa track"
    return "", ""


def _discards_whole_tree(args: List[str]) -> bool:
    """checkout/restore có đích là cả cây làm việc (`.`, `./`, `:/`, `*`) — đích nằm sau `--` hoặc là đối số vị trí."""
    if "--" in args:
        targets = args[args.index("--") + 1 :]
    else:
        targets = _positionals(args, ("-s", "--source", "-b", "-B"))
    return any(t in (".", "./", ":/", "*") for t in targets)


def _git_checkout(args: List[str]) -> Tuple[str, str]:
    """checkout: deny -f/--force và checkout cả cây."""
    if "f" in _short_flags(args) or "--force" in args:
        return "deny", "checkout -f vứt thay đổi"
    if _discards_whole_tree(args):
        return "deny", DISCARD_WHOLE_TREE_WHY.format("checkout")
    return "", ""


def _git_restore(args: List[str]) -> Tuple[str, str]:
    """restore: deny restore cả cây, trừ khi chỉ bỏ khỏi index (`--staged` không kèm worktree)."""
    index_only = "--staged" in args and "--worktree" not in args and "W" not in _short_flags(args)
    if _discards_whole_tree(args) and not index_only:
        return "deny", DISCARD_WHOLE_TREE_WHY.format("restore")
    return "", ""


def _git_stash(args: List[str]) -> Tuple[str, str]:
    """stash: ask khi drop/clear."""
    if args[:1] in (["drop"], ["clear"]):
        return "ask", f"stash {args[0]} xoá thay đổi đã cất"
    return "", ""


def _git_branch(args: List[str]) -> Tuple[str, str]:
    """branch: deny xoá cưỡng bức nhánh chính."""
    flags = _short_flags(args)
    deleting_force = "D" in flags or (("d" in flags or "--delete" in args) and ("f" in flags or "--force" in args))
    if deleting_force and any(x in MAIN_BRANCHES for x in _positionals(args)):
        return "deny", "xoá nhánh chính"
    return "", ""


GIT_RULES: Dict[str, GitRule] = {
    "push": _git_push,
    "reset": _git_reset,
    "clean": _git_clean,
    "checkout": _git_checkout,
    "restore": _git_restore,
    "stash": _git_stash,
    "branch": _git_branch,
}


def git_rules(n: List[str]) -> Tuple[str, str]:
    """Luật theo lệnh con của git (bảng GIT_RULES); lệnh con không có luật → cho qua."""
    if len(n) < 2:
        return "", ""
    rule = GIT_RULES.get(n[1])
    return rule(n[2:]) if rule else ("", "")


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


# Cách mở phiên Claude Code KHÔNG chạy hook của dự án (LOOP-HARNESS-018): agent tự đặt được → người phải xác nhận.
# Nguồn: Claude Code docs *CLI reference* (`--bare`, `--safe-mode`, `--settings`, `--setting-sources`, `--restricted`) và
# *Hooks* (`disableAllHooks`), đọc 2026-10-15.
HOOK_BYPASS_MARKERS = ("disableAllHooks", "CLAUDE_CODE_SIMPLE", "CLAUDE_CODE_SAFE_MODE")
HOOK_BYPASS_FLAGS = {"--bare", "--safe-mode", "--settings", "--setting-sources", "--restricted"}
PKG_RUNNERS = {"npx", "pnpx", "bunx"}
CLAUDE_PKG = "@anthropic-ai/claude-code"


def _claude_args(n: List[str]) -> Optional[List[str]]:
    """Tham số của lệnh `claude` (gọi thẳng hoặc qua npx/pnpx/bunx gói claude-code); None nếu không phải claude."""
    if n[0] == "claude":
        return n[1:]
    if n[0] in PKG_RUNNERS:
        for i, t in enumerate(n[1:], 1):
            if t == CLAUDE_PKG or t.startswith(CLAUDE_PKG + "@"):
                return n[i + 1 :]
    return None


def hook_bypass(argv: List[str], n: List[str]) -> str:
    """Lý do hỏi nếu lệnh tắt/bỏ qua hook của dự án; chuỗi rỗng nếu không."""
    for t in argv:
        hit = next((m for m in HOOK_BYPASS_MARKERS if m in t), "")
        if hit:
            return f"lệnh chạm `{hit}` (tắt hook của khung)"
    args = _claude_args(n) or []
    flag = next((a.split("=", 1)[0] for a in args if a.split("=", 1)[0] in HOOK_BYPASS_FLAGS), "")
    return f"phiên Claude với `{flag}` có thể bỏ qua hook của dự án" if flag else ""


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


COMMIT_OPTS_WITH_VALUE = ("-m", "--message", "-F", "--file", "-c", "-C", "--author", "--date", "-t", "--template")


def _commit_flag_args(args: List[str]) -> List[str]:
    """Đối số của `git commit` sau khi bỏ giá trị của -m/-F/… (nội dung message là dữ liệu, không phải cờ)."""
    out: List[str] = []
    skip = False
    for x in args:
        if skip:
            skip = False
        elif x in COMMIT_OPTS_WITH_VALUE:
            skip = True
        else:
            out.append(x)
    return out


def _write_asks(n: List[str], argv: List[str], root: str) -> List[str]:
    """Câu hỏi xác nhận cho file bí mật/cổng/migration mà lệnh có thể ghi (bỏ qua /dev/*)."""
    asks: List[str] = []
    for target in write_targets(n, argv):
        kind = classify_path(rel_path(target, root)) if target and not target.startswith("/dev/") else ""
        if kind == "secret":
            asks.append(f"ghi file bí mật qua Bash: {target}")
        elif kind in ("gate", "migration"):
            asks.append(f"sửa cấu hình cổng/CI/harness/migration qua Bash ({target}) — nói rõ lý do")
    return asks


def _scan_commit(args: List[str], res: Dict[str, object], asks: List[str]) -> Optional[str]:
    """`git commit`: --allow-empty → trả lý do deny; còn lại đánh dấu commit, --no-verify thì thêm câu hỏi."""
    if "--allow-empty" in args:
        return "Commit rỗng bị khung chặn (không dùng empty commit để kích CI). Push thay đổi thật hoặc re-run job."
    flag_args = _commit_flag_args(args)
    res["commit"] = True
    if "--no-verify" in flag_args or "n" in _short_flags(flag_args):
        res["no_verify"] = True
        asks.append("commit --no-verify bỏ qua cổng chất lượng — cần người xác nhận lý do")
    return None


def _scan_command(argv: List[str], root: str, res: Dict[str, object], asks: List[str]) -> Optional[str]:
    """Quét một lệnh đơn: thêm câu hỏi vào `asks`, ghi cờ commit vào `res`; trả lý do deny nếu phải chặn."""
    n = normalize(argv)
    if not n:
        return None
    decision, why = command_rules(n, root)
    if decision == "deny":
        return f"Lệnh bị khung chặn ({why}): {' '.join(argv)[:300]}. Muốn làm thật thì người dùng tự chạy."
    if decision == "ask":
        asks.append(f"{why}: {' '.join(argv)[:200]}")
    bypass = hook_bypass(argv, n)
    if bypass:
        asks.append(f"{bypass}: {' '.join(argv)[:200]}")
    asks.extend(_write_asks(n, argv, root))
    if n[:2] == ["git", "commit"]:
        return _scan_commit(n[2:], res, asks)
    return None


def bash_decision(cmd: str, root: str) -> Dict[str, object]:
    """Quyết định cho một lệnh Bash: deny/ask/"" kèm cờ `commit` và `no_verify` cho hook cổng commit."""
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
        deny_reason = _scan_command(argv, root, res, asks)
        if deny_reason:
            res.update(decision="deny", reason=deny_reason)
            return res
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
