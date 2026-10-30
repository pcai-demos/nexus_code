#!/usr/bin/env python3
"""T38 — add `headings` to the golden manifest's EXISTING docx / md anchors (T34's D8 b) without regenerating the
manifest (a regeneration would move every other field for no reason). Reuses derive_golden_manifest.py's readers,
so the next full regeneration produces the same field. Idempotent.

    python3 scripts/patch_manifest_headings.py
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from derive_golden_manifest import docx_sections, md_sections, with_headings  # noqa: E402

REPO_ROOT = os.path.dirname(HERE)
MANIFEST = os.path.join(REPO_ROOT, "tests", "manifests", "golden.json")

manifest = json.load(open(MANIFEST, encoding="utf-8"))
patched = []
for entry in manifest.get("corpus", []):
    if entry.get("skipped") or entry.get("paginated") is not False:
        continue
    path = os.path.join(REPO_ROOT, "public", entry["sourceId"]) if not os.path.isabs(entry["sourceId"]) else entry["sourceId"]
    if not os.path.exists(path):
        path = os.path.join(REPO_ROOT, entry["sourceId"])
    if entry["fileType"] == "docx":
        import docx
        items = docx_sections(docx.Document(path))
    elif entry["fileType"] in ("md", "txt"):
        items = md_sections(open(path, encoding="utf-8").read())
    else:
        continue
    with_headings(entry.get("anchors", []), items)
    patched.append((entry["fileName"], [(a["token"], a["headings"]) for a in entry.get("anchors", [])]))
json.dump(manifest, open(MANIFEST, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
open(MANIFEST, "a", encoding="utf-8").write("\n")
for name, anchors in patched:
    print(name)
    for token, headings in anchors:
        print("  ", token, "->", json.dumps(headings, ensure_ascii=False))
