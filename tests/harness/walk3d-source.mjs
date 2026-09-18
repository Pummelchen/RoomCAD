// See package-source.mjs — this is the walk3d.js case of it.
//
// walk3d.js is the class shell and its methods live under walk3d/, with the
// constants in walk3d/constants.js. A contract that greps the one file is asking
// about a file that holds the constructor.

import { packageSource } from "./package-source.mjs";

export function walk3dSource() {
  return packageSource("walk3d.js");
}
