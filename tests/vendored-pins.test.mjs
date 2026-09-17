// The vendored dependencies, held to what THIRD_PARTY_NOTICES.md says they are.
//
// A vendored dependency is one whose contents nobody checks. Everything under
// roomcad/web/lib/ is loaded straight into the page — the physics solver, the
// renderer, the TSL nodes — and until this file existed, nothing anywhere would
// have noticed if one of those files changed. Not a person editing it, not a
// bad merge, not a supply-chain swap.
//
// The notices file already recorded what each one IS; this makes it checkable.
// It recomputes every hash in the table there and fails on a mismatch, and it
// asks Rapier for its version rather than trusting the number written down:
//
//     Rapier's `version` export is a minified identifier, so the notices used to
//     say the upstream release "cannot be determined from the repository". The
//     identifier is opaque — what it RETURNS is not. `version()` answers
//     "0.20.0", and now something asserts it.
//
// So an upgrade is a deliberate act with a visible cost: change a file, this
// fails, and the new hash and version go into the notices in the same commit.
// That is the point. A version nobody can check is a version nobody will.
//
// Run:  node tests/vendored-pins.test.mjs

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import * as RAPIER from "../roomcad/web/lib/rapier.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const lib = join(root, "roomcad", "web", "lib");
const noticesPath = join(root, "THIRD_PARTY_NOTICES.md");
const notices = readFileSync(noticesPath, "utf8");

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

/// Every file under lib/, as paths relative to lib/, sorted.
function vendoredFiles(dir = lib) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...vendoredFiles(path));
    else out.push(relative(lib, path));
  }
  return out.sort();
}

const sha256 = path => createHash("sha256").update(readFileSync(path)).digest("hex");

// ── The notices' hash table, parsed ──────────────────────────────────────
//
// Rows look like:  | `rapier.mjs` | `09a000…` |

const table = new Map();
for (const line of notices.split("\n")) {
  const m = /^\|\s*`([^`]+)`\s*\|\s*`([0-9a-f]{64})`\s*\|\s*$/.exec(line.trim());
  if (m) table.set(m[1], m[2]);
}

check("the notices file carries a hash table at all", table.size > 0,
  `parsed ${table.size} rows`);
check("and it covers every file under lib/, so none is unpinned",
  table.size === vendoredFiles().length,
  `table has ${table.size}, lib/ holds ${vendoredFiles().length}: `
  + vendoredFiles().filter(f => !table.has(f)).join(", "));

// ── Every recorded hash is the hash on disk ──────────────────────────────

for (const file of vendoredFiles()) {
  const recorded = table.get(file);
  if (recorded === undefined) {
    check(`${file} is pinned`, false, "no hash row in THIRD_PARTY_NOTICES.md");
    continue;
  }
  const actual = sha256(join(lib, file));
  check(`${file} matches its pinned hash`, actual === recorded,
    `notices say ${recorded.slice(0, 16)}…, the file is ${actual.slice(0, 16)}…`);
}

// ── The versions, asked for rather than trusted ──────────────────────────

{
  // The notices must NAME the version, and the build must agree with it.
  const named = /Rapier is \*\*(\d+\.\d+\.\d+)\*\*/.exec(notices);
  check("the notices name a Rapier version", named !== null,
    "no 'Rapier is **x.y.z**' line found");
  if (named) {
    await RAPIER.init();
    const actual = RAPIER.version();
    check(`the build really is Rapier ${named[1]}, as recorded`, actual === named[1],
      `the notices say ${named[1]}, version() says ${actual}`);
  }

  // The Three.js revision is readable from the file the page loads, and the
  // notices name it too. Pinned for the same reason as the hash: it is the only
  // thing that says WHICH three.js this is.
  const core = readFileSync(join(lib, "three.core.js"), "utf8");
  const revision = /REVISION\s*=\s*['"]([^'"]+)['"]/.exec(core);
  check("three.core.js states its own revision", revision !== null);
  if (revision) {
    check(`the notices name the same revision (${revision[1]})`,
      notices.includes(`REVISION = '${revision[1]}'`) || notices.includes(revision[1]),
      `three.core.js says ${revision[1]}`);
  }
}

// ── The notices still say what they are for ──────────────────────────────

check("the notices name the release rule that requires them",
  notices.includes("RELEASE.md") && /§1\.6/.test(notices),
  "RELEASE.md §1.6 is the rule that makes this file mandatory");

// Every vendored licence is one this project can actually redistribute.
{
  const allowed = ["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC"];
  const rows = notices.split("\n").filter(l => l.startsWith("| ") && !l.startsWith("| ---") && !l.startsWith("| Component") && !l.startsWith("| File"));
  const licences = rows.map(l => l.split("|")[3]?.trim()).filter(Boolean);
  const odd = licences.filter(l => !allowed.some(a => l.startsWith(a)));
  check("every licence row is a redistributable one", licences.length > 0 && odd.length === 0,
    odd.join(", "));
}

console.log(`${passed} passed, ${failed} failed — the vendored dependencies are what we say they are`);
process.exit(failed ? 1 : 0);
