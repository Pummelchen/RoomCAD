#!/usr/bin/env python3
"""Set fields on ledger tasks, then re-render ledger.md.

Usage:
  AUDIT/ledger-set.py T0007 status=DONE commit=abc1234 fix_summary="..." evidence_after="..."
  AUDIT/ledger-set.py T0007 --show
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LEDGER = os.path.join(HERE, "ledger.json")


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    tid = argv[1]
    with open(LEDGER, encoding="utf-8") as f:
        data = json.load(f)
    task = next((t for t in data["tasks"] if t["id"] == tid), None)
    if task is None:
        print("no such task: %s" % tid, file=sys.stderr)
        return 1
    if len(argv) == 3 and argv[2] == "--show":
        print(json.dumps(task, indent=1))
        return 0
    for pair in argv[2:]:
        key, _, value = pair.partition("=")
        if key not in task:
            print("unknown field: %s" % key, file=sys.stderr)
            return 1
        task[key] = value
    with open(LEDGER, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1)
    subprocess.run([sys.executable, os.path.join(HERE, "render-ledger.py")], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
