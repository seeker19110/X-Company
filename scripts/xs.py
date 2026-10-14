#!/usr/bin/env python3
"""xs.py — công cụ dòng lệnh của khung X-stored (chỉ dùng thư viện chuẩn Python >= 3.11).

Lệnh:
  validate                      Kiểm quy ước toàn khung (frontmatter, ID, liên kết, hồ sơ/gói ngành).
  list [profiles|industries|modules]
  compose --profile P [--industry I ...] [--scale S|M|L] [--include-may] [--add MODULE ...] [--out FILE]
                                Ghép baseline + hồ sơ + gói ngành thành BLUEPRINT.md cho dự án.
  blueprint-status FILE [--strict]
                                Đếm mục đạt/chưa/miễn; --strict: còn MUST chưa đạt -> exit 1.
  loop init --plan FILE [--blueprint FILE] [--max-iterations N] [--hours H]
  loop status [--json]          Verdict máy tính từ PLAN + bằng chứng (không do model tự khai).
  loop record --task T-001 -- <lệnh...>
                                Chạy lệnh kiểm của task, ghi bằng chứng (exit code, thời gian, đuôi output).
  loop block --reason TEXT      Đánh dấu BLOCKED (cần người).
  loop resume [--reason TEXT]   Người đã xử lý → bỏ BLOCKED, đặt lại đếm lỗi lặp, giữ số vòng/bằng chứng.
  loop stop [--reason TEXT]     Tắt vòng lặp.
  loop hook-stop                Dùng cho Stop hook của Claude Code: đọc JSON stdin, quyết định cho dừng hay chạy tiếp.
  progress-check [FILE]         PROGRESS.md: ≤ 8 KB, đúng 4 mục, SHA ở Bàn giao phiên là tổ tiên HEAD và có trên nhánh chính.
  ci-check [DIR]                Fitness function cho workflow CI (permissions, ghim SHA, timeout, continue-on-error).
  stats                         Thống kê số module/mục.

Thoát: 0 = ổn, 1 = vi phạm/chưa đạt, 2 = lỗi dùng lệnh.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import fnmatch
import hashlib
import itertools
import json
import os
import posixpath
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_FRAMEWORK = (SCRIPT_DIR.parent / "framework").resolve()

KINDS = {"method", "index", "module", "baseline", "profile", "industry", "standard", "template", "research", "progress"}
LEVELS = ("MUST", "SHOULD", "MAY")
SCALES = ("S", "M", "L")
# Trần MUST hiệu lực ở quy mô M cho mỗi module/chuẩn; phần vượt là MUST@L — ADR-0004.
MAX_MUST_AT_M = 4
REQUIRED_KEYS = ("title", "kind", "updated")

ITEM_RE = re.compile(
    r"^- \[(?P<state>[ xX~])\] `(?P<id>[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3})` "
    r"\*\*(?P<level>MUST|SHOULD|MAY)(?:@(?P<scale>[SML]))?\*\*\s+(?P<text>\S.*)$"
)
# Dòng "giống mục checklist" nhưng sai định dạng -> báo lỗi thay vì bỏ qua im lặng.
ITEM_LIKE_RE = re.compile(r"^- \[[ xX~]\] `[A-Z][A-Z0-9-]*`")
PREFIX_RE = re.compile(r"^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
LINK_SUB_RE = re.compile(r"(\[[^\]]*\])\(([^)\s]+)\)")
LINK_RE = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
HEADING_RE = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
TASK_ID_RE = re.compile(r"^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{3,}$")
NOTE_RE = re.compile(r"\s—\s(?:Bằng chứng|Miễn|Thiếu):.*$")
SECRET_RE = re.compile(r"(?i)\b(\w*(?:token|secret|passw(?:or)?d|api[_-]?key)\w*)(\s*[=:]\s*)\S+")
TASK_RE = re.compile(r"^- \[(?P<state>[ xX~])\] `(?P<id>T-\d{3,})`(?P<rest>.*)$")
GATE_RE = re.compile(r"Gate:\s*`([^`]+)`")


# --------------------------------------------------------------------------- frontmatter


class FrontmatterError(ValueError):
    pass


def parse_frontmatter(text: str) -> Tuple[Dict[str, object], str, int]:
    """Trả (meta, body, số dòng của khối frontmatter). Chỉ hỗ trợ YAML phẳng của khung."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise FrontmatterError("thiếu frontmatter (dòng đầu phải là '---')")
    meta: Dict[str, object] = {}
    for i in range(1, len(lines)):
        line = lines[i]
        if line.strip() == "---":
            body = "\n".join(lines[i + 1 :])
            return meta, body, i + 1
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            raise FrontmatterError(f"dòng frontmatter {i + 1} không có dạng 'khoá: giá trị'")
        key, _, raw = line.partition(":")
        key = key.strip()
        raw = raw.strip()
        if not re.match(r"^[a-z_]+$", key):
            raise FrontmatterError(f"khoá frontmatter không hợp lệ: {key!r}")
        if key in meta:
            raise FrontmatterError(f"khoá frontmatter lặp: {key}")
        meta[key] = _parse_value(raw)
    raise FrontmatterError("frontmatter không có dòng '---' đóng")


def _parse_value(raw: str) -> object:
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1].strip()
        if not inner:
            return []
        return [_unquote(p.strip()) for p in inner.split(",") if p.strip()]
    return _unquote(raw)


def _unquote(s: str) -> str:
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1]
    return s


# --------------------------------------------------------------------------- model


@dataclass
class Item:
    id: str
    level: str
    scale: Optional[str]
    text: str
    state: str
    line: int


@dataclass
class Doc:
    path: Path
    rel: str  # đường dẫn tương đối từ framework/, không có .md
    meta: Dict[str, object]
    body: str
    body_offset: int
    items: List[Item] = field(default_factory=list)
    headings: List[str] = field(default_factory=list)

    @property
    def kind(self) -> str:
        return str(self.meta.get("kind", ""))

    @property
    def title(self) -> str:
        return str(self.meta.get("title", self.rel))


def load_docs(root: Path) -> Tuple[List[Doc], List[str]]:
    docs: List[Doc] = []
    errors: List[str] = []
    for path in sorted(root.rglob("*.md")):
        rel = path.relative_to(root).as_posix()[:-3]
        text = path.read_text(encoding="utf-8")
        try:
            meta, body, offset = parse_frontmatter(text)
        except FrontmatterError as exc:
            errors.append(f"{rel}.md: {exc}")
            continue
        doc = Doc(path=path, rel=rel, meta=meta, body=body, body_offset=offset)
        in_fence = False
        for n, line in enumerate(body.splitlines(), start=offset + 1):
            if line.lstrip().startswith("```"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            m = ITEM_RE.match(line)
            if m:
                doc.items.append(Item(m["id"], m["level"], m["scale"], m["text"].strip(), m["state"], n))
            elif ITEM_LIKE_RE.match(line):
                errors.append(f"{rel}.md:{n}: mục checklist sai định dạng (xem conventions.md §3): {line[:90]}")
            h = HEADING_RE.match(line)
            if h:
                doc.headings.append(h.group(2))
        docs.append(doc)
    return docs, errors


def _as_list(v: object) -> List[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x) for x in v]
    return [str(v)]


def resolve_modules(patterns: Iterable[str], by_rel: Dict[str, Doc]) -> Tuple[List[Doc], List[str]]:
    """Mở rộng danh sách module (cho phép '*') thành Doc theo thứ tự xuất hiện, bỏ trùng."""
    out: List[Doc] = []
    missing: List[str] = []
    seen = set()
    for pat in patterns:
        if "*" in pat:
            hits = sorted(r for r in by_rel if fnmatch.fnmatch(r, pat) and not r.endswith("README"))
            if not hits:
                missing.append(pat)
        else:
            hits = [pat] if pat in by_rel else []
            if not hits:
                missing.append(pat)
        for r in hits:
            if r not in seen and by_rel[r].kind in ("module", "baseline", "standard"):
                seen.add(r)
                out.append(by_rel[r])
    return out, missing


# --------------------------------------------------------------------------- validate


def validate(root: Path) -> List[str]:
    docs, errors = load_docs(root)
    by_rel = {d.rel: d for d in docs}
    ids: Dict[str, str] = {}
    prefixes: Dict[str, str] = {}
    slugs: Dict[Tuple[str, str], str] = {}
    profile_slugs = {str(d.meta.get("slug")) for d in docs if d.kind == "profile"}

    for d in docs:
        where = f"{d.rel}.md"
        for key in REQUIRED_KEYS:
            if not d.meta.get(key):
                errors.append(f"{where}: thiếu khoá frontmatter '{key}'")
        if d.kind and d.kind not in KINDS:
            errors.append(f"{where}: kind không hợp lệ '{d.kind}'")
        upd = str(d.meta.get("updated", ""))
        if upd and not DATE_RE.match(upd):
            errors.append(f"{where}: 'updated' phải dạng YYYY-MM-DD")
        if not any(True for _ in d.headings) or not d.body.lstrip().startswith("#"):
            errors.append(f"{where}: nội dung phải bắt đầu bằng tiêu đề '# ...' ngay sau frontmatter")

        prefix = d.meta.get("prefix")
        if d.items:
            if not prefix:
                errors.append(f"{where}: có mục checklist nhưng thiếu 'prefix'")
            elif not PREFIX_RE.match(str(prefix)):
                errors.append(f"{where}: prefix '{prefix}' không hợp lệ")
        if prefix:
            p = str(prefix)
            if p in prefixes and prefixes[p] != where:
                errors.append(f"{where}: prefix '{p}' đã dùng ở {prefixes[p]}")
            prefixes[p] = where
            # Không cho prefix này là tiền tố "ID" của prefix khác (vd SEC và SEC-AUTH đều hợp lệ,
            # nhưng ID SEC-AUTH-001 phải thuộc file SEC-AUTH, không phải file SEC).
        for it in d.items:
            if it.id in ids:
                errors.append(f"{where}:{it.line}: ID trùng {it.id} (đã có ở {ids[it.id]})")
            ids[it.id] = f"{where}:{it.line}"
            if prefix and not re.fullmatch(re.escape(str(prefix)) + r"-\d{3}", it.id):
                errors.append(f"{where}:{it.line}: ID {it.id} không khớp prefix '{prefix}'")
            if it.state != " ":
                errors.append(f"{where}:{it.line}: mục trong khung phải ở trạng thái '[ ]'")
            if it.level == "MUST" and "→ Kiểm:" not in it.text:
                errors.append(f"{where}:{it.line}: mục MUST {it.id} thiếu '→ Kiểm:'")
            if it.scale and it.level != "MUST":
                errors.append(f"{where}:{it.line}: ngưỡng quy mô '@{it.scale}' chỉ dùng với MUST")

        n_m = sum(effective_level(it, "M", d.kind) == "MUST" for it in d.items)
        if d.kind in ("module", "standard") and n_m > MAX_MUST_AT_M:
            errors.append(f"{where}: {n_m} MUST hiệu lực ở quy mô M, trần {MAX_MUST_AT_M} — hạ phần vượt thành MUST@L")

        if d.kind in ("module", "baseline", "profile", "industry"):
            if d.items and not any("Checklist" in h for h in d.headings):
                errors.append(f"{where}: thiếu mục '## Checklist'")
            if not any(h.strip().startswith("Nguồn") for h in d.headings):
                errors.append(f"{where}: thiếu mục '## Nguồn'")
        if d.kind in ("module", "baseline", "standard"):
            at = _as_list(d.meta.get("applies_to"))
            if not at:
                errors.append(f"{where}: thiếu 'applies_to'")
            else:
                unknown = [a for a in at if a != "all" and a not in profile_slugs]
                if unknown and profile_slugs:
                    errors.append(f"{where}: applies_to có slug hồ sơ không tồn tại: {', '.join(unknown)}")
        if d.kind in ("profile", "industry"):
            slug = d.meta.get("slug")
            if not slug:
                errors.append(f"{where}: thiếu 'slug'")
            else:
                slug_key = (d.kind, str(slug))
                if slug_key in slugs:
                    errors.append(f"{where}: slug '{slug}' trùng với {slugs[slug_key]}")
                slugs[slug_key] = where
            mods = _as_list(d.meta.get("modules"))
            _, missing = resolve_modules(mods, by_rel)
            for m in missing:
                errors.append(f"{where}: module '{m}' trong 'modules' không tồn tại")

        # Liên kết nội bộ tương đối phải trỏ tới file có thật.
        in_fence = False
        for n, line in enumerate(d.body.splitlines(), start=d.body_offset + 1):
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
                resolved = (d.path.parent / path_part).resolve()
                if not resolved.exists():
                    errors.append(f"{where}:{n}: liên kết hỏng -> {target}")

    # Mỗi thư mục con của framework/ phải có README.md (chỉ mục).
    for sub in sorted(p for p in root.rglob("*") if p.is_dir()):
        if not (sub / "README.md").exists():
            errors.append(f"{sub.relative_to(root).as_posix()}/: thiếu README.md (chỉ mục thư mục)")
    return errors


# --------------------------------------------------------------------------- compose

# Ở quy mô S chỉ "sàn" là bắt buộc: baseline + hồ sơ + gói ngành. MUST của module chuyên sâu
# (kind module/standard) hạ thành SHOULD — xem ADR-0003 và 00-method/lifecycle.md.
FLOOR_KINDS = ("baseline", "profile", "industry")


def effective_level(item: Item, scale: str, doc_kind: str = "baseline") -> str:
    if item.level != "MUST":
        return item.level
    if item.scale and SCALES.index(scale) < SCALES.index(item.scale):
        return "SHOULD"
    if scale == "S" and doc_kind not in FLOOR_KINDS:
        return "SHOULD"
    return item.level


def find_by_slug(docs: List[Doc], kind: str, slug: str) -> Optional[Doc]:
    for d in docs:
        if d.kind == kind and str(d.meta.get("slug")) == slug:
            return d
    return None


def compose(
    root: Path,
    profile: str,
    industries: List[str],
    scale: str,
    include_may: bool,
    today: Optional[str] = None,
    extra: Optional[List[str]] = None,
) -> str:
    docs, errors = load_docs(root)
    if errors:
        raise SystemExit("Khung có lỗi, chạy 'xs.py validate' trước:\n  " + "\n  ".join(errors[:20]))
    by_rel = {d.rel: d for d in docs}
    prof = find_by_slug(docs, "profile", profile)
    if prof is None:
        raise SystemExit(f"Không có hồ sơ '{profile}'. Xem: xs.py list profiles")
    inds: List[Doc] = []
    for s in industries:
        ind = find_by_slug(docs, "industry", s)
        if ind is None:
            raise SystemExit(f"Không có gói ngành '{s}'. Xem: xs.py list industries")
        inds.append(ind)

    baseline = sorted((d for d in docs if d.kind == "baseline"), key=lambda d: d.rel)
    patterns: List[str] = []
    for src in [prof, *inds]:
        patterns.extend(_as_list(src.meta.get("modules")))
    patterns.extend(extra or [])
    mods, missing = resolve_modules(patterns, by_rel)
    bad_extra = [m for m in missing if m in (extra or [])]
    if bad_extra:
        raise SystemExit("Module --add không tồn tại: " + ", ".join(bad_extra) + " (xem: xs.py list modules)")

    extra_rels = {d.rel for d in resolve_modules(extra or [], by_rel)[0]}

    def applies(d: Doc) -> bool:
        if d.rel in extra_rels:  # --add là lựa chọn có chủ đích của người dùng → bỏ lọc applies_to
            return True
        at = _as_list(d.meta.get("applies_to"))
        return not at or "all" in at or profile in at

    ordered: List[Doc] = []
    seen = set()
    for d in [*baseline, *mods, prof, *inds]:
        if d.rel in seen:
            continue
        if d.kind in ("module", "baseline", "standard") and not applies(d):
            continue
        seen.add(d.rel)
        ordered.append(d)

    today = today or _dt.date.today().isoformat()
    counts = {lv: 0 for lv in LEVELS}
    sections: List[str] = []
    for d in ordered:
        rows = []
        for it in d.items:
            lv = effective_level(it, scale, d.kind)
            if lv == "MAY" and not include_may:
                continue
            counts[lv] += 1
            rows.append(f"- [ ] `{it.id}` **{lv}** {_rebase_links(it.text, d.rel, _rel_link(root))}")
        if not rows:
            continue
        link = f"{_rel_link(root)}/{d.rel}.md"
        sections.append(f"### {d.title}\n\nNguồn khung: [`{d.rel}.md`]({link})\n\n" + "\n".join(rows))

    ind_names = ", ".join(str(i.meta.get("slug")) for i in inds) or "(không)"
    header = [
        "---",
        "title: Blueprint dự án",
        "kind: blueprint",
        f"profile: {profile}",
        f"industries: [{', '.join(str(i.meta.get('slug')) for i in inds)}]",
        f"extra: [{', '.join(extra or [])}]",
        f"scale: {scale}",
        f"generated: {today}",
        "---",
        "",
        "# Blueprint dự án",
        "",
        f"> Sinh bởi `xs.py compose` ngày {today} — hồ sơ **{profile}**, ngành **{ind_names}**, quy mô **{scale}**.",
        "> Trạng thái: `[ ]` chưa · `[x]` đạt (kèm bằng chứng ở PR/CI) · `[~]` miễn trừ — bắt buộc ghi `— Miễn: <lý do>`.",
        "> Kiểm tiến độ: `python3 scripts/xs.py blueprint-status BLUEPRINT.md --strict` (còn MUST chưa đạt → exit 1).",
        "",
        "| Mức | Số mục |",
        "|---|---|",
        f"| MUST | {counts['MUST']} |",
        f"| SHOULD | {counts['SHOULD']} |",
    ]
    if include_may:
        header.append(f"| MAY | {counts['MAY']} |")
    header.append("")
    return "\n".join(header) + "\n" + "\n\n".join(sections) + "\n"


def carry_states(old: str, new: str) -> Tuple[str, int]:
    """Chuyển ô trạng thái + ghi chú (— Bằng chứng/Miễn/Thiếu: …) từ blueprint cũ sang bản ghép mới theo ID."""
    prev: Dict[str, Tuple[str, str]] = {}
    for line in unicodedata.normalize("NFC", old).splitlines():
        m = ITEM_RE.match(line)
        if m:
            nm = NOTE_RE.search(line)
            prev[m["id"]] = (m["state"], nm.group(0) if nm else "")
    kept, lines = 0, []
    for line in new.splitlines():
        m = ITEM_RE.match(line)
        if m and prev.get(m["id"], (" ", "")) != (" ", ""):
            state, note = prev[m["id"]]
            line = f"- [{state}]{line[5:]}{note}"
            kept += 1
        lines.append(line)
    return "\n".join(lines) + "\n", kept


def _rebase_links(text: str, doc_rel: str, link_root: str) -> str:
    """Liên kết tương đối trong mục (tính từ file module) -> tính từ BLUEPRINT.md qua link_root."""
    base = posixpath.dirname(doc_rel)

    def sub(m: "re.Match[str]") -> str:
        target = m.group(2)
        if re.match(r"^[a-z][a-z0-9+.-]*:", target) or target.startswith(("#", "/")):
            return m.group(0)
        return f"{m.group(1)}({link_root}/{posixpath.normpath(posixpath.join(base, target))})"

    return LINK_SUB_RE.sub(sub, text)


def _rel_link(root: Path) -> str:
    """Đường dẫn tới framework/ để đặt trong blueprint (ưu tiên vị trí cài trong dự án)."""
    return os.environ.get("XS_FRAMEWORK_LINK", ".xstored/framework")


# --------------------------------------------------------------------------- blueprint-status


def blueprint_status(path: Path) -> Dict[str, Any]:
    return blueprint_status_text(path.read_text(encoding="utf-8"))


def blueprint_status_text(raw: str) -> Dict[str, Any]:
    total = {lv: {"open": 0, "done": 0, "waived": 0} for lv in LEVELS}
    bad_waivers: List[str] = []
    open_must: List[str] = []
    text = unicodedata.normalize("NFC", raw)
    for n, line in enumerate(text.splitlines(), start=1):
        m = ITEM_RE.match(line)
        if not m:
            continue
        st = m["state"]
        lv = m["level"]
        if st == " ":
            total[lv]["open"] += 1
            if lv == "MUST":
                open_must.append(m["id"])
        elif st == "~":
            total[lv]["waived"] += 1
            if "Miễn:" not in line:
                bad_waivers.append(f"{m['id']} (dòng {n})")
        else:
            total[lv]["done"] += 1
    return {"levels": total, "open_must": open_must, "bad_waivers": bad_waivers}


# --------------------------------------------------------------------------- loop (autopilot)


def project_dir() -> Path:
    return Path(os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()).resolve()


def state_dir(base: Optional[Path] = None) -> Path:
    return (base or project_dir()) / ".autopilot"


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def read_state(base: Optional[Path] = None) -> Optional[dict]:
    p = state_dir(base) / "state.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def write_atomic(path: Path, text: str) -> None:
    """Ghi file qua tệp tạm rồi đổi tên: lỗi giữa chừng không để lại file dở."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)


def write_state(state: dict, base: Optional[Path] = None) -> None:
    write_atomic(state_dir(base) / "state.json", json.dumps(state, ensure_ascii=False, indent=2) + "\n")


def parse_plan(path: Path) -> List[dict]:
    tasks = []
    for line in path.read_text(encoding="utf-8").splitlines():
        m = TASK_RE.match(line)
        if not m:
            continue
        g = GATE_RE.search(m["rest"])
        tasks.append(
            {
                "id": m["id"],
                "state": m["state"].lower(),
                "gate": g.group(1) if g else None,
                "title": m["rest"].strip(" —-")[:120],
            }
        )
    return tasks


def read_evidence(task_id: str, base: Optional[Path] = None) -> Optional[dict]:
    p = state_dir(base) / "evidence" / f"{task_id}.json"
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def loop_verdict(base: Optional[Path] = None) -> dict:
    """Tính verdict CHỈ từ artifact trên đĩa. Model không tự khai 'xong'."""
    base = base or project_dir()
    st = read_state(base)
    if not st or not st.get("active"):
        return {"verdict": "inactive", "reason": "vòng lặp chưa bật"}
    if st.get("blocked"):
        return {"verdict": "blocked", "reason": st.get("blocked_reason", "cần người quyết định")}
    if st.get("same_failure_count", 0) >= st.get("max_same_failure", 3):
        return {
            "verdict": "blocked",
            "reason": f"cùng một lỗi lặp {st.get('same_failure_count')} lần ({st.get('last_failure_task')}) — dừng để người xem",
        }
    if st.get("iterations", 0) >= st.get("max_iterations", 50):
        return {"verdict": "budget", "reason": f"đã chạm trần {st.get('max_iterations')} vòng"}
    deadline = st.get("deadline")
    if deadline and now_iso() > deadline:
        return {"verdict": "budget", "reason": f"quá hạn {deadline}"}
    plan = base / st.get("plan", "docs/autopilot/PLAN.md")
    if not plan.exists():
        return {"verdict": "blocked", "reason": f"không thấy PLAN: {plan}"}
    tasks = parse_plan(plan)
    if not tasks:
        return {"verdict": "blocked", "reason": "PLAN không có task dạng - [ ] `T-001` ..."}
    for t in tasks:
        if t["state"] == " ":
            return {"verdict": "continue", "task": t["id"], "reason": f"làm task {t['id']}: {t['title']}"}
        if t["state"] == "x":
            ev = read_evidence(t["id"], base)
            if ev is None or ev.get("exit_code") != 0:
                return {
                    "verdict": "verify",
                    "task": t["id"],
                    "reason": f"task {t['id']} đã tick nhưng chưa có bằng chứng xanh — chạy: xs.py loop record --task {t['id']} -- <lệnh kiểm>",
                }
            if t["gate"] and ev.get("cmd") != t["gate"]:
                return {
                    "verdict": "verify",
                    "task": t["id"],
                    "reason": f"task {t['id']} khai Gate `{t['gate']}` nhưng bằng chứng chạy lệnh khác",
                }
    bp = st.get("blueprint")
    if bp:
        bpp = base / bp
        if bpp.exists():
            s = blueprint_status(bpp)
            if s["open_must"]:
                return {
                    "verdict": "continue",
                    "task": s["open_must"][0],
                    "reason": f"còn {len(s['open_must'])} mục MUST của blueprint chưa đạt (đầu tiên: {s['open_must'][0]})",
                }
            if s["bad_waivers"]:
                return {"verdict": "continue", "reason": "mục miễn trừ thiếu lý do: " + ", ".join(s["bad_waivers"][:5])}
    return {"verdict": "done", "reason": "mọi task có bằng chứng xanh và blueprint không còn MUST mở"}


def failure_signature(task: str, code: int, output: str) -> str:
    tail = "\n".join(output.strip().splitlines()[-20:])
    norm = re.sub(r"\d+", "N", tail)  # bỏ số dòng/thời gian để cùng lỗi ra cùng chữ ký
    return hashlib.sha256(f"{task}|{code}|{norm}".encode()).hexdigest()[:16]


def loop_record(task: str, cmd: List[str], base: Optional[Path] = None) -> int:
    base = base or project_dir()
    st = read_state(base) or {}
    try:
        timeout = int(os.environ.get("XS_RECORD_TIMEOUT", "1800"))
    except ValueError:
        print("✗ XS_RECORD_TIMEOUT phải là số giây nguyên dương", file=sys.stderr)
        return 2
    started = now_iso()
    cmd_str = " ".join(cmd)
    try:
        proc = subprocess.run(cmd_str, shell=True, cwd=base, capture_output=True, text=True, timeout=timeout)
        code, out = proc.returncode, (proc.stdout or "") + (proc.stderr or "")
    except subprocess.TimeoutExpired as exc:
        code, out = 124, f"timeout: {exc}"
    ev: Dict[str, Any] = {
        "task": task,
        "cmd": cmd_str,
        "exit_code": code,
        "started": started,
        "finished": now_iso(),
        "head": _git_head(base),
        "output_tail": SECRET_RE.sub(r"\1\2***", "\n".join(out.strip().splitlines()[-40:])),
    }
    d = state_dir(base) / "evidence"
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{task}.json").write_text(json.dumps(ev, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if st:
        if code == 0:
            st["same_failure_count"] = 0
            st["last_failure_signature"] = None
        else:
            sig = failure_signature(task, code, out)
            if sig == st.get("last_failure_signature"):
                st["same_failure_count"] = st.get("same_failure_count", 0) + 1
            else:
                st["same_failure_count"] = 1
                st["last_failure_signature"] = sig
            st["last_failure_task"] = task
        write_state(st, base)
    print(f"[xs] {task}: exit {code} — bằng chứng: .autopilot/evidence/{task}.json")
    if code != 0:
        print(ev["output_tail"][-2000:])
    return code


def _git_head(base: Path) -> Optional[str]:
    try:
        r = subprocess.run(["git", "rev-parse", "HEAD"], cwd=base, capture_output=True, text=True, timeout=10)
        return r.stdout.strip() or None
    except (OSError, subprocess.TimeoutExpired):
        return None


def hook_stop(stdin_text: str, base: Optional[Path] = None) -> Tuple[str, int]:
    """Quyết định của Stop hook. Trả (stdout JSON hoặc '', exit code). Luôn fail-open khi có lỗi."""
    base = base or project_dir()  # stdin của Stop hook không cần: verdict chỉ dựa vào file trên đĩa
    v = loop_verdict(base)
    st = read_state(base)
    if v["verdict"] in ("continue", "verify") and st:
        st["iterations"] = st.get("iterations", 0) + 1
        st["last_verdict"] = v
        write_state(st, base)
        reason = (
            f"[autopilot vòng {st['iterations']}/{st.get('max_iterations', 50)}] Chưa xong: {v['reason']}. "
            "Làm tiếp theo PLAN; chạy `python3 .xstored/scripts/xs.py loop record --task <ID> -- <lệnh kiểm>` "
            "để ghi bằng chứng; commit+push sau mỗi task. Nếu cần người quyết (§dừng-bắt-buộc) thì "
            "`xs.py loop block --reason ...`."
        )
        return json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False), 0
    if st and st.get("active") and v["verdict"] in ("done", "blocked", "budget"):
        st["active"] = False
        st["ended"] = now_iso()
        st["final_verdict"] = v
        write_state(st, base)
    return "", 0


# --------------------------------------------------------------------------- progress-check

PROGRESS_MAX_BYTES = 8192
PROGRESS_SECTIONS = ("Đang làm", "Tiếp theo", "Quyết định", "Bàn giao phiên")
SHA_TOKEN_RE = re.compile(r"`([0-9a-fA-F]{7,40})`")
FENCE_RE = re.compile(r"^\s*(```|~~~)")


def _git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, check=False)


def progress_sections(text: str) -> List[Tuple[str, List[str]]]:
    """Các mục `## ` (bỏ qua heading trong code fence ``` / ~~~) cùng dòng thân của từng mục."""
    sections: List[Tuple[str, List[str]]] = []
    fence: Optional[str] = None
    for line in text.splitlines():
        m = FENCE_RE.match(line)
        if m and (fence is None or m.group(1) == fence):
            fence = None if fence else m.group(1)
        if fence is None and not m and line.startswith("## "):
            name = re.sub(r"\s+#+\s*$", "", line[3:]).strip()  # bỏ dấu # đóng kiểu ATX
            sections.append((unicodedata.normalize("NFC", name), []))
        elif sections:
            sections[-1][1].append(line)
    return sections


def progress_base_ref(repo: Path) -> Optional[str]:
    """Nhánh chính để kiểm SHA bàn giao còn sống sau squash-merge.

    `XS_PROGRESS_BASE` (rỗng = tắt) > `origin/HEAD` > `origin/main` > `origin/master`; không có thì bỏ qua.
    """
    env = os.environ.get("XS_PROGRESS_BASE")
    if env is not None:
        return env.strip() or None
    head = _git(repo, "symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD").stdout.strip()
    for ref in (head, "origin/main", "origin/master"):
        if ref and _git(repo, "rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}").returncode == 0:
            return ref
    return None


def progress_check(path: Path) -> List[str]:
    """Luật PROGRESS.md (mẫu templates/PROGRESS.md): ≤ 8 KB, đúng 4 mục, SHA bàn giao là tổ tiên HEAD
    và nằm trên nhánh chính (squash-merge xoá SHA của nhánh PR → nhánh chính đỏ sau merge).

    Trả danh sách vi phạm; ném OSError khi không đọc được file hoặc không chạy được git.
    """
    raw = path.read_bytes()
    errors: List[str] = []
    if len(raw) > PROGRESS_MAX_BYTES:
        errors.append(f"{len(raw)} byte > {PROGRESS_MAX_BYTES} — chuyển lịch sử sang CHANGELOG.md/docs/")
    sections = progress_sections(raw.decode("utf-8", errors="replace"))
    names = tuple(n for n, _ in sections)
    if names != PROGRESS_SECTIONS:
        errors.append(
            "mục `## ` phải đúng thứ tự "
            + " · ".join(PROGRESS_SECTIONS)
            + "; đang có: "
            + (" · ".join(names) or "(không có)")
        )
    handover = next((body for n, body in sections if n == PROGRESS_SECTIONS[-1]), None)
    if handover is None:
        return errors
    shas = list(dict.fromkeys(m.group(1).lower() for line in handover for m in SHA_TOKEN_RE.finditer(line)))
    if not shas:
        errors.append("mục Bàn giao phiên không ghi SHA commit (dạng `abc1234`)")
        return errors
    repo = path.resolve().parent
    if _git(repo, "rev-parse", "--git-dir").returncode != 0:
        raise OSError(f"không phải repo git: {repo}")
    shallow = _git(repo, "rev-parse", "--is-shallow-repository").stdout.strip() == "true"
    hint = " (clone nông — CI cần checkout `fetch-depth: 0`)" if shallow else ""
    base = progress_base_ref(repo)
    for sha in shas:
        if _git(repo, "rev-parse", "--verify", "--quiet", f"{sha}^{{commit}}").returncode != 0:
            errors.append(f"SHA `{sha}` không phải commit có trong lịch sử{hint}")
        elif _git(repo, "merge-base", "--is-ancestor", sha, "HEAD").returncode != 0:
            errors.append(f"SHA `{sha}` không phải tổ tiên của HEAD (squash/rebase làm mất?){hint}")
        elif base and _git(repo, "merge-base", "--is-ancestor", sha, base).returncode != 0:
            errors.append(
                f"SHA `{sha}` chưa nằm trên `{base}` — squash-merge sẽ làm nhánh chính đỏ; "
                f"ghi SHA đã có trên nhánh chính (`git fetch` nếu `{base}` cũ)"
            )
    return errors


# --------------------------------------------------------------------------- ci-check

# Khoá đầu dòng (`- uses:`) hoặc trong flow mapping (`- {uses: ..., continue-on-error: true}`).
KEY_AT = r"(?:^\s*(?:-\s+)?|[{,]\s*)"
USES_RE = re.compile(KEY_AT + r"uses:\s*['\"]?([^'\"\s#,}]+)")
COE_RE = re.compile(KEY_AT + r"continue-on-error:\s*([^#,}]*)")
WRITE_ALL_RE = re.compile(KEY_AT + r"permissions:\s*['\"]?write-all")
PINNED_RE = re.compile(r"@[0-9a-f]{40}$")
DOCKER_PINNED_RE = re.compile(r"@sha256:[0-9a-f]{64}$")
BLOCK_SCALAR_RE = re.compile(r":\s*[|>][-+0-9]*\s*(?:#.*)?$")
CI_ALLOW = "ci-check-allow:"


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _allowed(line: str) -> bool:
    """Ngoại lệ có chủ đích: comment `# ci-check-allow: <lý do>` trên cùng dòng (lý do bắt buộc)."""
    _, sep, reason = line.partition(CI_ALLOW)
    return bool(sep) and bool(reason.strip())


def ci_check_text(text: str) -> List[str]:
    """Fitness function cho một workflow GitHub Actions (đọc theo dòng, chỉ thư viện chuẩn).

    Luật: `permissions:` cấp workflow · không `write-all` · `uses:` ngoài ghim SHA 40 ký tự (`docker://` ghim `@sha256:`) ·
    mọi job có `timeout-minutes` (trừ job gọi reusable workflow) · không `continue-on-error`.
    Bỏ qua nội dung block scalar (`run: |`) để script shell không gây báo nhầm.
    """
    errors: List[str] = []
    lines: List[Tuple[int, str]] = []
    scalar_indent: Optional[int] = None
    for no, line in enumerate(text.splitlines(), 1):
        if scalar_indent is not None:
            if not line.strip() or _indent(line) > scalar_indent:
                continue
            scalar_indent = None
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        lines.append((no, line))
        if BLOCK_SCALAR_RE.search(line):
            scalar_indent = _indent(line)
    if not any(ln.startswith("permissions:") for _, ln in lines):
        errors.append("thiếu `permissions:` cấp workflow (mặc định `contents: read`)")
    for no, line in lines:
        code = line.split(" #", 1)[0]
        if WRITE_ALL_RE.search(code) and not _allowed(line):
            errors.append(f"dòng {no}: `write-all` — khai quyền tối thiểu theo job")
        coe = COE_RE.search(code)
        if coe and coe.group(1).strip().strip("'\"") != "false" and not _allowed(line):
            errors.append(f"dòng {no}: `continue-on-error` trên job/bước — ngoại lệ ghi `# {CI_ALLOW} <lý do + hạn>`")
        m = USES_RE.search(code)
        ref = m.group(1) if m else ""
        if ref.startswith("docker://"):
            if not DOCKER_PINNED_RE.search(ref) and not _allowed(line):
                errors.append(f"dòng {no}: `{ref}` chưa ghim digest `@sha256:`")
        elif ref and not ref.startswith("./") and not PINNED_RE.search(ref) and not _allowed(line):
            errors.append(f"dòng {no}: `{ref}` chưa ghim SHA 40 ký tự")
    # Job: khoá con trực tiếp của `jobs:`; thân job = các dòng thụt sâu hơn tới khoá job kế tiếp.
    jobs_at = next((i for i, (_, ln) in enumerate(lines) if ln.startswith("jobs:")), None)
    if jobs_at is not None:
        body = list(itertools.takewhile(lambda x: _indent(x[1]) > 0, lines[jobs_at + 1 :]))
        job_indent = _indent(body[0][1]) if body else 0
        jobs: List[Tuple[int, str, List[str]]] = []
        for no, ln in body:
            if _indent(ln) == job_indent:
                jobs.append((no, ln.strip().rstrip(":"), []))
            elif jobs:
                jobs[-1][2].append(ln)
        for no, name, job_lines in jobs:
            child = min((_indent(x) for x in job_lines), default=0)
            keys = {x.strip().split(":", 1)[0] for x in job_lines if _indent(x) == child}
            if not keys & {"uses", "timeout-minutes", "<<"}:  # `<<: *anchor` không giải được theo dòng → bỏ qua
                errors.append(f"dòng {no}: job `{name}` thiếu `timeout-minutes`")
    return errors


def ci_check(workflows: Path) -> Dict[str, List[str]]:
    files = sorted(p for p in workflows.iterdir() if p.suffix in (".yml", ".yaml") and p.is_file())
    return {p.name: ci_check_text(p.read_bytes().decode("utf-8", errors="replace")) for p in files}


# --------------------------------------------------------------------------- CLI


def cmd_validate(args) -> int:
    errors = validate(args.framework)
    if errors:
        for e in errors:
            print(f"✗ {e}")
        print(f"\n{len(errors)} lỗi.")
        return 1
    docs, _ = load_docs(args.framework)
    n_items = sum(len(d.items) for d in docs)
    print(f"✓ Khung hợp lệ: {len(docs)} file, {n_items} mục checklist.")
    return 0


def cmd_list(args) -> int:
    docs, _ = load_docs(args.framework)
    what = args.what
    kinds = {"profiles": ("profile",), "industries": ("industry",), "modules": ("module", "baseline", "standard")}[what]
    for d in sorted(docs, key=lambda d: d.rel):
        if d.kind in kinds:
            slug = d.meta.get("slug")
            label = f"{slug:<22}" if slug else f"{d.rel:<48}"
            print(f"{label} {d.title}  ({len(d.items)} mục)")
    return 0


def cmd_compose(args) -> int:
    out = compose(args.framework, args.profile, args.industry or [], args.scale, args.include_may, extra=args.add or [])
    if args.out:
        out_path = Path(args.out)
        if out_path.exists():  # ghép lại: giữ tick/miễn trừ/bằng chứng theo ID, không mất công audit
            out, kept = carry_states(out_path.read_text(encoding="utf-8"), out)
            print(f"↺ Giữ trạng thái {kept} mục theo ID từ bản cũ", file=sys.stderr)
        write_atomic(out_path, out)
        print(f"✓ Đã ghi {args.out}")
    else:
        sys.stdout.write(out)
    return 0


def cmd_blueprint_status(args) -> int:
    s = blueprint_status_text(sys.stdin.read()) if args.file == "-" else blueprint_status(Path(args.file))
    ok = not s["open_must"] and not s["bad_waivers"]
    if args.json:  # hợp đồng máy đọc: {"levels", "open_must", "bad_waivers", "ok"}
        print(json.dumps({**s, "ok": ok}, ensure_ascii=False))
        return 0 if ok or not args.strict else 1
    for lv in LEVELS:
        c = s["levels"][lv]
        print(f"{lv:<7} đạt {c['done']:>4} · miễn {c['waived']:>4} · chưa {c['open']:>4}")
    if s["bad_waivers"]:
        print("✗ Miễn trừ thiếu lý do: " + ", ".join(s["bad_waivers"]))
    if s["open_must"]:
        print(f"Còn {len(s['open_must'])} mục MUST chưa đạt: " + ", ".join(s["open_must"][:15]))
    return 0 if ok or not args.strict else 1


def cmd_loop(args) -> int:
    base = project_dir()
    if args.loop_cmd == "init":
        if not (base / args.plan).exists():
            print(f"✗ Không thấy {args.plan}", file=sys.stderr)
            return 2
        deadline = None
        if args.hours is not None:
            deadline = (
                (_dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(hours=args.hours))
                .replace(microsecond=0)
                .isoformat()
            )
        state = {
            "active": True,
            "started": now_iso(),
            "plan": args.plan,
            "blueprint": args.blueprint,
            "max_iterations": args.max_iterations,
            "max_same_failure": 3,
            "iterations": 0,
            "deadline": deadline,
            "same_failure_count": 0,
            "blocked": False,
        }
        write_state(state, base)
        print(
            f"✓ Autopilot bật: plan={args.plan} trần={args.max_iterations} vòng"
            + (f", hạn {deadline}" if deadline else "")
        )
        return 0
    if args.loop_cmd == "status":
        v = loop_verdict(base)
        st = read_state(base) or {}
        v["iterations"] = st.get("iterations", 0)
        if args.json:
            print(json.dumps(v, ensure_ascii=False))
        else:
            print(f"verdict: {v['verdict']} — {v['reason']}")
        return 0
    if args.loop_cmd == "record":
        cmd = [c for c in args.cmd if c != "--"]
        if not cmd:
            print("✗ Thiếu lệnh kiểm sau '--'", file=sys.stderr)
            return 2
        return loop_record(args.task, cmd, base)
    if args.loop_cmd == "block":
        st = read_state(base) or {"active": True}
        st.update({"blocked": True, "blocked_reason": args.reason, "blocked_at": now_iso()})
        write_state(st, base)
        print(f"■ BLOCKED: {args.reason}")
        return 0
    if args.loop_cmd == "resume":
        cur = read_state(base)
        if not cur:
            print("✗ Chưa có vòng lặp (chạy loop init trước)", file=sys.stderr)
            return 2
        cur.update(
            {
                "active": True,
                "blocked": False,
                "blocked_reason": None,
                "same_failure_count": 0,
                "last_failure_signature": None,
                "resumed_at": now_iso(),
                "resume_reason": args.reason,
            }
        )
        cur.pop("ended", None)
        cur.pop("final_verdict", None)
        write_state(cur, base)
        print(f"▶ Autopilot tiếp tục (vòng {cur.get('iterations', 0)}/{cur.get('max_iterations', 50)}): {args.reason}")
        return 0
    if args.loop_cmd == "stop":
        cur = read_state(base)
        if cur:
            cur.update({"active": False, "ended": now_iso(), "stop_reason": args.reason})
            write_state(cur, base)
        print("■ Autopilot tắt.")
        return 0
    if args.loop_cmd == "hook-stop":
        try:
            out, code = hook_stop(sys.stdin.read() if not sys.stdin.isatty() else "", base)
        except Exception as exc:  # fail-open: hook lỗi không được kẹt phiên
            print(f"[xs hook-stop] lỗi, cho dừng: {type(exc).__name__}: {exc}", file=sys.stderr)
            return 0
        if out:
            print(out)
        return code
    return 2


def cmd_progress_check(args) -> int:
    errors = progress_check(Path(args.file))
    for e in errors:
        print(f"✗ {args.file}: {e}")
    if not errors:
        print(f"✓ {args.file}: ≤ {PROGRESS_MAX_BYTES} byte, đủ 4 mục, SHA bàn giao là tổ tiên HEAD.")
    return 1 if errors else 0


def cmd_ci_check(args) -> int:
    d = Path(args.dir or ".github/workflows")
    if not d.is_dir():
        if args.dir:  # chỉ định rõ mà không có → sai cách dùng
            raise OSError(f"không thấy thư mục workflow: {d}")
        print(f"– Không có {d} — bỏ qua.")
        return 0
    results = ci_check(d)
    bad = 0
    for name, errors in results.items():
        for e in errors:
            print(f"✗ {d / name}: {e}")
        bad += len(errors)
    if not bad:
        print(f"✓ {len(results)} workflow: permissions, ghim SHA, timeout, không continue-on-error.")
    return 1 if bad else 0


def cmd_stats(args) -> int:
    docs, _ = load_docs(args.framework)
    by_kind: Dict[str, int] = {}
    levels = {lv: 0 for lv in LEVELS}
    for d in docs:
        by_kind[d.kind] = by_kind.get(d.kind, 0) + 1
        for it in d.items:
            levels[it.level] += 1
    print("File theo loại: " + ", ".join(f"{k}={v}" for k, v in sorted(by_kind.items())))
    print("Mục theo mức:   " + ", ".join(f"{k}={v}" for k, v in levels.items()))
    print(f"Tổng mục:       {sum(levels.values())}")
    return 0


def _task_id(value: str) -> str:
    if not TASK_ID_RE.match(value):
        raise argparse.ArgumentTypeError(f"ID không hợp lệ: {value!r} (dạng T-001 hoặc ID blueprint như BASE-SEC-001)")
    return value


def framework_version() -> str:
    """Phiên bản khung: file VERSION cạnh thư mục scripts/ (repo khung hoặc .xstored/ của dự án)."""
    try:
        return (SCRIPT_DIR.parent / "VERSION").read_text(encoding="utf-8").strip()
    except OSError:
        return "unknown"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="xs.py",
        description="Công cụ khung X-stored",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="ví dụ:\n"
        "  xs.py list profiles\n"
        "  xs.py compose --profile web-app --industry fintech --scale M --out BLUEPRINT.md\n"
        "  xs.py blueprint-status BLUEPRINT.md --strict\n"
        "  xs.py loop record --task T-001 -- python3 -m unittest\n\n"
        "mã thoát: 0 ổn · 1 vi phạm/chưa đạt · 2 sai cách dùng hoặc không đọc được file/thư mục",
    )
    p.add_argument("--version", action="version", version=f"%(prog)s {framework_version()}")
    p.add_argument(
        "--framework",
        type=Path,
        default=Path(os.environ.get("XS_FRAMEWORK", DEFAULT_FRAMEWORK)),
        help="thư mục framework/ (mặc định: cạnh scripts/)",
    )
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("validate").set_defaults(fn=cmd_validate)
    pl = sub.add_parser("list")
    pl.add_argument("what", choices=["profiles", "industries", "modules"])
    pl.set_defaults(fn=cmd_list)
    pc = sub.add_parser("compose")
    pc.add_argument("--profile", required=True)
    pc.add_argument("--industry", action="append")
    pc.add_argument("--scale", choices=SCALES, default="M")
    pc.add_argument("--include-may", action="store_true")
    pc.add_argument(
        "--add",
        action="append",
        metavar="MODULE",
        help="ghép thêm module/glob ngoài hồ sơ (vd 13-ai-engineering/*), bỏ lọc applies_to",
    )
    pc.add_argument("--out")
    pc.set_defaults(fn=cmd_compose)
    pb = sub.add_parser("blueprint-status")
    pb.add_argument("file", help="BLUEPRINT.md, hoặc - để đọc stdin")
    pb.add_argument("--strict", action="store_true", help="exit 1 khi còn MUST mở hoặc miễn trừ thiếu lý do")
    pb.add_argument("--json", action="store_true", help="in JSON (levels, open_must, bad_waivers, ok)")
    pb.set_defaults(fn=cmd_blueprint_status)
    plp = sub.add_parser("loop")
    lsub = plp.add_subparsers(dest="loop_cmd", required=True)
    li = lsub.add_parser("init")
    li.add_argument("--plan", default="docs/autopilot/PLAN.md")
    li.add_argument("--blueprint")
    li.add_argument("--max-iterations", type=int, default=50)
    li.add_argument("--hours", type=float)
    ls = lsub.add_parser("status")
    ls.add_argument("--json", action="store_true")
    lr = lsub.add_parser("record")
    lr.add_argument("--task", required=True, type=_task_id)
    lr.add_argument("cmd", nargs=argparse.REMAINDER)
    lb = lsub.add_parser("block")
    lb.add_argument("--reason", required=True)
    lrs = lsub.add_parser("resume")
    lrs.add_argument("--reason", default="người đã xử lý điểm dừng")
    lst = lsub.add_parser("stop")
    lst.add_argument("--reason", default="dừng thủ công")
    lsub.add_parser("hook-stop")
    plp.set_defaults(fn=cmd_loop)
    pp = sub.add_parser("progress-check")
    pp.add_argument("file", nargs="?", default="PROGRESS.md")
    pp.set_defaults(fn=cmd_progress_check)
    pci = sub.add_parser("ci-check")
    pci.add_argument("dir", nargs="?", help="thư mục workflow (mặc định .github/workflows, không có thì bỏ qua)")
    pci.set_defaults(fn=cmd_ci_check)
    sub.add_parser("stats").set_defaults(fn=cmd_stats)
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    args.framework = Path(args.framework).resolve()
    if args.cmd in ("validate", "list", "compose", "stats") and not args.framework.is_dir():
        print(f"✗ Không thấy thư mục khung: {args.framework}", file=sys.stderr)
        return 2
    try:
        return args.fn(args)
    except OSError as exc:  # file thiếu/không đọc được: một dòng dễ hiểu; XS_DEBUG=1 để xem traceback
        if os.environ.get("XS_DEBUG"):
            raise
        print(f"✗ {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
