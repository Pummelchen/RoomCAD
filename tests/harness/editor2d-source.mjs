// See package-source.mjs — this is the editor2d.js case of it. editor2d.js is the
// class shell and its methods live under editor2d/, so a contract that greps the
// one file is asking about a file that holds the constructor.

import { packageSource } from "./package-source.mjs";

export function editor2dSource() {
  return packageSource("editor2d.js");
}
