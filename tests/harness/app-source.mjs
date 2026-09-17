// See package-source.mjs — this is the app.js case of it, kept as a named
// helper because the tests that use it say what they mean by importing it.

import { packageSource, packageLiftable } from "./package-source.mjs";

export function appSource() {
  return packageSource("app.js");
}

/// The same, with top-level `export ` removed, for the tests that lift a
/// function with `new Function`.
export function appLiftable() {
  return packageLiftable("app.js");
}
