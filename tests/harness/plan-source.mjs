// The plan model's source, as one string.
//
// plan.js is a facade now: it re-exports roomcad/web/plan/*.js, where the code
// actually lives. A test that greps for a line of it — an order of calls, a
// constant's shape — has to look at the whole package, or it will pass while the
// code it means to pin is somewhere it is not reading.
//
// `planSource()` returns the facade and every module under plan/, concatenated
// in a stable (sorted) order, so a source contract means "this appears somewhere
// in the model" rather than "this appears in this particular file". Pinning the
// file too would make every future move of a function a test failure.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..", "roomcad", "web");

export function planSource() {
  const parts = [readFileSync(join(web, "plan.js"), "utf8")];
  const dir = join(web, "plan");
  for (const name of readdirSync(dir).filter(f => f.endsWith(".js")).sort()) {
    parts.push(readFileSync(join(dir, name), "utf8"));
  }
  return parts.join("\n");
}
