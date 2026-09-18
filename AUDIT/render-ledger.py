#!/usr/bin/env python3
"""Generate AUDIT/ledger.md from AUDIT/ledger.json.

The ledger is the single source of truth (§8). This script only renders it; the
markdown is never edited by hand (§9).
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEDGER = os.path.join(HERE, "ledger.json")
OUT = os.path.join(HERE, "ledger.md")

SEVERITY_ORDER = {"S0": 0, "S1": 1, "S2": 2, "S3": 3}
TERMINAL = {"DONE", "BLOCKED"}
FIELDS = [
    "id", "severity", "tier", "project", "file", "title", "category", "status",
    "host", "discovered_by", "evidence_before", "fix_summary", "evidence_after",
    "commit", "blocked_reason",
]


def main():
    with open(LEDGER, encoding="utf-8") as f:
        data = json.load(f)
    tasks = data["tasks"]
    counts = {"done": 0, "open": 0, "blocked": 0}
    for t in tasks:
        if t["status"] == "DONE":
            counts["done"] += 1
        elif t["status"] == "BLOCKED":
            counts["blocked"] += 1
        else:
            counts["open"] += 1
    by_sev = {}
    for t in tasks:
        by_sev.setdefault(t["severity"], []).append(t)

    lines = []
    lines.append("# AUDIT ledger — RoomCAD pre-production audit")
    lines.append("")
    lines.append("**Generated from `AUDIT/ledger.json`. Do not edit by hand.**")
    lines.append("")
    lines.append("Branch: `audit/2026-09-18` · Base: `dbba4df`")
    lines.append("")
    lines.append(
        "Totals: **%d tasks** — done:%d open:%d blocked:%d"
        % (len(tasks), counts["done"], counts["open"], counts["blocked"])
    )
    lines.append("")
    lines.append("Open count (the number that ends the run) = **%d**." % counts["open"])
    lines.append("")
    lines.append("| severity | total | done | open | blocked |")
    lines.append("| -------- | ----- | ---- | ---- | ------- |")
    for sev in ("S0", "S1", "S2", "S3"):
        group = by_sev.get(sev, [])
        if not group and sev not in ("S0", "S1", "S2", "S3"):
            continue
        d = sum(1 for t in group if t["status"] == "DONE")
        b = sum(1 for t in group if t["status"] == "BLOCKED")
        o = len(group) - d - b
        lines.append("| %s | %d | %d | %d | %d |" % (sev, len(group), d, o, b))
    lines.append("")
    lines.append("## Tasks")
    lines.append("")
    for sev in ("S0", "S1", "S2", "S3"):
        group = by_sev.get(sev, [])
        if not group:
            continue
        lines.append("### %s" % sev)
        lines.append("")
        for t in sorted(group, key=lambda x: x["id"]):
            lines.append("#### %s — %s" % (t["id"], t["title"]))
            lines.append("")
            lines.append("- **status**: %s" % t["status"])
            lines.append("- **tier**: %s · **project**: %s · **category**: %s"
                         % (t["tier"], t["project"], t["category"]))
            lines.append("- **where**: `%s`" % t["file"])
            lines.append("- **host**: %s · **discovered by**: %s"
                         % (t["host"], t["discovered_by"]))
            for key, label in (
                ("evidence_before", "evidence (before)"),
                ("fix_summary", "fix"),
                ("evidence_after", "evidence (after)"),
                ("commit", "commit"),
                ("blocked_reason", "blocked"),
            ):
                if t.get(key):
                    lines.append("- **%s**: %s" % (label, t[key]))
            lines.append("")
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines).rstrip() + "\n")
    print("wrote %s: %d tasks (done %d, open %d, blocked %d)"
          % (OUT, len(tasks), counts["done"], counts["open"], counts["blocked"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
