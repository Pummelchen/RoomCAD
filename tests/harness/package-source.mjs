// The source of a module and everything it is split into, as one string.
//
// four modules of this app are facades now: plan.js re-exports plan/, store.js
// composes store/, app.js composes app/, and editor2d.js adds editor2d/ to the
// prototype. A test that greps one of those files for a line of code is reading
// a file that holds almost nothing, so the contract it thinks it is making is
// about the wrong file.
//
// `packageSource("store.js")` returns store.js followed by every .js under
// store/, sorted, joined with newlines — the folder is the entry's basename
// without the extension, which is the convention all four follow.
//
// Tolerant of the folder not existing, so a helper like this can land BEFORE the
// split it prepares for and change nothing at all.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..", "roomcad", "web");

export function packageSource(entry) {
  const parts = [readFileSync(join(web, entry), "utf8")];
  const dir = join(web, entry.replace(/\.js$/, ""));
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter(f => f.endsWith(".js")).sort()) {
      parts.push(readFileSync(join(dir, name), "utf8"));
    }
  }
  return parts.join("\n");
}

/// The same, with top-level `export ` removed — for tests that LIFT a function
/// out of the source and evaluate it with `new Function`, where `export` is not
/// valid. Do not use this for a `data:` import, which needs the `export`.
export function packageLiftable(entry) {
  return packageSource(entry).replace(/^export /gm, "");
}
