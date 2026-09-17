// The store's source, as one string.
//
// store.js is a facade over roomcad/web/store/*.js, and it composes them into the
// one object the app imports. A test that greps for a line of the store — a rule
// about what it may keep, how a value is rounded — has to look at the whole
// package, or it will pass while the thing it means to pin sits in a file it is
// not reading.
//
// The same idea as plan-source.mjs, for the same reason, and the same shape: the
// facade first, then every module under store/, so a contract means "this appears
// somewhere in the store" rather than "in this particular file".

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..", "roomcad", "web");

export function storeSource() {
  const parts = [readFileSync(join(web, "store.js"), "utf8")];
  const dir = join(web, "store");
  for (const name of readdirSync(dir).filter(f => f.endsWith(".js")).sort()) {
    parts.push(readFileSync(join(dir, name), "utf8"));
  }
  return parts.join("\n");
}
