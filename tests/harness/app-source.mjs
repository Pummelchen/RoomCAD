// app.js's source, as one string, plus everything it is split into.
//
// app.js is being split under roomcad/web/app/, and ten test files read its
// source to make contracts about it — what the footer renders, which values go
// through `esc()` before they reach innerHTML, how the mode switch cleans up.
// Read `app.js` alone once it is a composition and those contracts are reading a
// file that holds almost nothing: they would fail loudly, which is better than
// passing quietly, but either way they would be asking about the wrong file.
//
// Same idea as plan-source.mjs and store-source.mjs. Tolerant of the folder not
// existing, so this could land before the split did and the suite was unchanged
// by it — a preparation that changed nothing is one that cannot have broken
// anything.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..", "roomcad", "web");

export function appSource() {
  const parts = [readFileSync(join(web, "app.js"), "utf8")];
  const dir = join(web, "app");
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter(f => f.endsWith(".js")).sort()) {
      parts.push(readFileSync(join(dir, name), "utf8"));
    }
  }
  return parts.join("\n");
}
