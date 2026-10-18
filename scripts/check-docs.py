"""Checks that local links in the repository's Markdown documents resolve (files and line anchors)."""
from pathlib import Path
import re
from urllib.parse import unquote

root = Path(__file__).resolve().parent.parent
documents = [root / name for name in ("README.md", "AGENTS.md", "CHANGELOG.md", "extension/README.md", "landing/README.md")]
documents += sorted((root / "docs").glob("*.md"))
documents = [d for d in documents if d.exists()]

issues, links = [], 0
for document in documents:
    body = document.read_text(encoding="utf-8-sig")
    # Skip fenced code blocks; their bracket syntax is not a link.
    body = re.sub(r"```.*?```", "", body, flags=re.DOTALL)
    targets = re.findall(r"!?\[[^\]]*\]\(([^)\s]+)[^)]*\)", body)
    targets += re.findall(r'<(?:img|a|video|source)[^>]+(?:src|href)="([^"]+)"', body)
    for target in targets:
        target = target.strip().strip("<>")
        if re.match(r"^[a-zA-Z][a-zA-Z+.-]*:|^#", target):
            continue
        target = unquote(target.split("#", 1)[0])
        match = re.fullmatch(r"(.+):(\d+)", target)
        path = (document.parent / (match[1] if match else target)).resolve()
        links += 1
        if not path.exists():
            issues.append(f"{document.relative_to(root)}: missing {target}")
        elif match and not 1 <= int(match[2]) <= len(path.read_text(encoding="utf-8-sig").splitlines()):
            issues.append(f"{document.relative_to(root)}: invalid line in {target}")

print(f"{len(documents)} Markdown documents; {links} local links.")
if issues:
    print("\n".join(issues))
    raise SystemExit(1)
print("PASS: all local links resolve.")
