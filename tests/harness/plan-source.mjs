// See package-source.mjs — this is the plan.js case of it, kept as a named
// helper because the tests that use it say what they mean by importing it.

import { packageSource } from "./package-source.mjs";

export function planSource() {
  return packageSource("plan.js");
}
