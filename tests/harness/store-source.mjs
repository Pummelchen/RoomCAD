// See package-source.mjs — this is the store.js case of it, kept as a named
// helper because the tests that use it say what they mean by importing it.

import { packageSource } from "./package-source.mjs";

export function storeSource() {
  return packageSource("store.js");
}
