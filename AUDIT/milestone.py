#!/usr/bin/env python3
"""Print the §13 milestone line and a short report, generated from ledger.json.

Usage:  AUDIT/milestone.py <ID> <STATUS> <title...>
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def main(argv):
    if len(argv) < 4:
        print(__doc__)
        return 2
    with open(os.path.join(HERE, "ledger.json"), encoding="utf-8") as f:
        tasks = json.load(f)["tasks"]
    done = sum(1 for t in tasks if t["status"] == "DONE")
    blocked = sum(1 for t in tasks if t["status"] == "BLOCKED")
    open_ = len(tasks) - done - blocked
    index = next((i + 1 for i, t in enumerate(tasks) if t["id"] == argv[1]), 0)
    print("[#%s %d/%d | done:%d open:%d blocked:%d new:0] %s — %s"
          % (argv[1], index, len(tasks), done, open_, blocked, argv[2],
             " ".join(argv[3:])))
    print("closure invariant: open must be strictly decreasing at every milestone "
          "(currently %d)" % open_)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
