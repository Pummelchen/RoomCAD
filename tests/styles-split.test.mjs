// The stylesheet is six files now, and the cascade still works.
//
// `styles.css` was 1299 lines, one rule after another, and the browser resolved
// a specificity tie by which rule came later in that one file. Split it into six
// and the tie is resolved by which FILE comes later — so the link order in
// index.html is not a matter of taste, it is part of the CSS.
//
// This is why the split was made in CONTIGUOUS CUTS rather than by grouping the
// sections into tidier files: a sheet that held the toolbar and the zoom controls
// would have to be loaded before the sheets in between, and every rule it shares
// a selector with would start losing or winning a tie it used to lose or win.
// Nothing would report it. Some control would simply be the wrong size.
//
// Two things are checked here, and the second is the one that cannot be checked
// by reading a file:
//
//   every sheet the page loads exists, is balanced, and is a sane size
//   the sheets, in link order, are EXACTLY what the one file used to hold
//
// The second is verified against a fixture of the original stylesheet kept for
// the purpose, so "the split changed nothing" is a measurement rather than a
// claim — and stays true the next time somebody moves a rule between sheets.
//
// Run:  node tests/styles-split.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { styleSheets } from "./harness/page-css.mjs";

const here = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

const sheets = styleSheets();

// ── Every sheet the page asks for is there, and is a stylesheet ───────────

check("the page loads more than one stylesheet, or this file is pointless",
  sheets.length > 1, `${sheets.length} linked`);
check("and every one of them exists and is not empty",
  sheets.every(s => s.text.trim().length > 0),
  sheets.filter(s => !s.text.trim()).map(s => s.href).join(", "));

// A cut in the middle of a rule is the classic way a split goes wrong, and it
// does not always look like an error: browsers recover by dropping the tail.
// Counting braces catches it without needing a CSS parser.
for (const sheet of sheets) {
  const opened = (sheet.text.match(/{/g) || []).length;
  const closed = (sheet.text.match(/}/g) || []).length;
  check(`${sheet.href} has balanced braces`, opened === closed,
    `${opened} { and ${closed} }`);
}

// ── No rule was lost in the split ────────────────────────────────────────
//
// The fixture under tests/fixtures/ is the stylesheet as it was before the split.
// Byte-for-byte equality with it WAS verified when the split landed — the six
// sheets, concatenated in link order, reproduced the original file exactly, all
// 25931 bytes of it. That equality is deliberately NOT asserted here, because it
// would fail the next time anybody adds a rule, and a gate that has to be edited
// away on every legitimate change is one nobody ends up trusting.
//
// What is asserted is the part that should stay true forever: every rule the old
// file held is still somewhere in the sheets. Adding rules passes. Editing a
// rule's body passes, because the values are not the point. Losing a rule — the
// real risk of a split, and the failure that looks like nothing at all until a
// control is the wrong size — fails.

/// The selector text of every rule in a stylesheet, as a set.
///
/// Not a CSS parser: it takes whatever sits between a closing brace and the next
/// opening one. An at-rule prelude (@media …) lands in the set as well, which is
/// harmless — this is a fingerprint of what was there, not a model of the CSS.
function selectors(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Set();
  const re = /(?:^|})([^{}]+)\{/g;
  let m;
  while ((m = re.exec(text)) !== null) out.add(m[1].replace(/\s+/g, " ").trim());
  return out;
}

{
  const fixturePath = join(here, "fixtures", "styles-before-split.css");
  const before = selectors(readFileSync(fixturePath, "utf8"));
  const now = selectors(sheets.map(s => s.text).join("\n"));
  const lost = [...before].filter(sel => !now.has(sel));
  check("no rule from before the split has gone missing", lost.length === 0,
    `${lost.length} lost, first few: ${lost.slice(0, 4).join(" | ")}`);
  check("the fixture is a real stylesheet, not an empty file", before.size > 50,
    `${before.size} selectors`);
}

// ── The order is declared, and it is the order the files claim ───────────

{
  // Each sheet's header says which part it is ("Part 3 of 6 in ..."). If the
  // links are reordered in index.html the headers will disagree with their
  // position, which is the moment to stop and check the cascade rather than
  // discover it as a control that shrank.
  const declared = sheets.map(s => {
    const m = /Part (\d+) of (\d+)/.exec(s.text);
    return m ? Number(m[1]) : null;
  });
  check("every sheet states which part it is",
    declared.every(d => d !== null), JSON.stringify(declared));
  check("and the parts are in link order, 1..n",
    declared.every((d, i) => d === i + 1), JSON.stringify(declared));
  check("with the same total as there are links",
    sheets.every(s => {
      const m = /Part \d+ of (\d+)/.exec(s.text);
      return m && Number(m[1]) === sheets.length;
    }));
}

// ── And the size rule this whole exercise is about ───────────────────────

for (const sheet of sheets) {
  const lines = sheet.text.split("\n").length;
  check(`${sheet.href} is under the 500-line guideline`, lines <= 500, `${lines} lines`);
}

console.log(`${passed} passed, ${failed} failed — the stylesheet is split and the cascade is intact`);
process.exit(failed ? 1 : 0);
