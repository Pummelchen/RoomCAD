// See package-source.mjs — this is the walk3d.js case of it.
//
// walk3d.js is the class shell and its methods live under walk3d/, with the
// constants in walk3d/constants.js. A contract that greps the one file is asking
// about a file that holds the constructor.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { packageSource } from "./package-source.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..", "roomcad", "web");

export function walk3dSource() {
  return packageSource("walk3d.js");
}

/// Just the sun model: the Singapore solar constants from walk3d/constants.js
/// plus walk3d/sun.js. three-environment lifts this and runs it for real, and it
/// cannot lift the whole constants file — that file builds THREE vectors at
/// module level, which a `data:` import with the imports stripped cannot do.
export function walk3dSolarSource() {
  const constants = readFileSync(join(web, "walk3d", "constants.js"), "utf8");
  const from = constants.indexOf("// Singapore solar position");
  const solar = from === -1 ? "" : constants.slice(from);
  return solar + "\n" + readFileSync(join(web, "walk3d", "sun.js"), "utf8");
}

