// See package-source.mjs — this is the city.js case of it. city.js is the class
// shell and its methods live under city/, with the constants in
// city/constants.js. A contract that greps the one file is asking about a file
// that holds the constructor and the static helpers.

import { packageSource } from "./package-source.mjs";

export function citySource() {
  return packageSource("city.js");
}
