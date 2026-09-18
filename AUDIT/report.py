#!/usr/bin/env python3
"""Generate AUDIT/report.md (the §9 milestone / final report) from ledger.json.

The ledger is the single source of truth. This renders a report from it; the
report is never edited by hand.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "report.md")


def main():
    with open(os.path.join(HERE, "ledger.json"), encoding="utf-8") as f:
        data = json.load(f)
    tasks = data["tasks"]
    done = [t for t in tasks if t["status"] == "DONE"]
    blocked = [t for t in tasks if t["status"] == "BLOCKED"]
    open_ = [t for t in tasks if t["status"] not in ("DONE", "BLOCKED")]

    lines = []
    lines.append("# RoomCAD pre-production audit — report")
    lines.append("")
    lines.append("Generated from `AUDIT/ledger.json` by `AUDIT/report.py`. "
                 "The ledger is the source of truth; this file is not edited by hand.")
    lines.append("")
    lines.append("Branch `audit/2026-09-18`, base commit `%s`." % data["meta"]["base_commit"])
    lines.append("")
    lines.append("## Headline")
    lines.append("")
    lines.append("- **%d tasks, %d DONE, %d BLOCKED, %d open.**"
                 % (len(tasks), len(done), len(blocked), len(open_)))
    lines.append("- Findings by severity: S0 %d, S1 %d, S2 %d, S3 %d."
                 % tuple(sum(1 for t in tasks if t["severity"] == s)
                         for s in ("S0", "S1", "S2", "S3")))
    lines.append("")
    lines.append("| severity | total | done | open | blocked |")
    lines.append("| -------- | ----- | ---- | ---- | ------- |")
    for sev in ("S0", "S1", "S2", "S3"):
        group = [t for t in tasks if t["severity"] == sev]
        d = sum(1 for t in group if t["status"] == "DONE")
        b = sum(1 for t in group if t["status"] == "BLOCKED")
        lines.append("| %s | %d | %d | %d | %d |" % (sev, len(group), d, b, len(group) - d - b))
    lines.append("")
    lines.append("## The six S0 findings")
    lines.append("")
    lines.append("| id | area | title | commit |")
    lines.append("| -- | ---- | ----- | ------ |")
    for t in tasks:
        if t["severity"] == "S0":
            lines.append("| %s | `%s` | %s | `%s` |"
                         % (t["id"], os.path.dirname(t["file"]) or t["file"], t["title"],
                            t["commit"] or "-"))
    lines.append("")
    lines.append("## Every task")
    lines.append("")
    lines.append("| id | sev | tier | file:line | title | status | commit |")
    lines.append("| -- | --- | ---- | --------- | ----- | ------ | ------ |")
    for t in sorted(tasks, key=lambda x: (x["severity"], x["id"])):
        lines.append("| %s | %s | %s | `%s` | %s | %s | `%s` |"
                     % (t["id"], t["severity"], t["tier"], t["file"], t["title"],
                        t["status"], t["commit"] or "-"))
    lines.append("")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).rstrip() + "\n")
    print("wrote %s (%d tasks)" % (OUT, len(tasks)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
