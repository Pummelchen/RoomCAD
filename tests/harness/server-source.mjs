// The API package's source as one string, for the tests that grep it.
//
// roomcad/server/server.py is a facade now: the implementation lives in
// roomcad/server/roomcad_api/ and server.py only re-exports it. A contract
// that reads server.py alone would be asking about a file that holds almost
// no code — it would pass while the line it means to pin moved, and fail the
// day it did. serverSource() returns server.py followed by every module under
// roomcad_api/, sorted, joined with newlines, so the contract means "this
// appears somewhere in the server package" rather than "in this one file".

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = join(here, "..", "..", "roomcad", "server");

export function serverSource() {
  const parts = [readFileSync(join(serverDir, "server.py"), "utf8")];
  const dir = join(serverDir, "roomcad_api");
  for (const name of readdirSync(dir).filter(f => f.endsWith(".py")).sort()) {
    parts.push(readFileSync(join(dir, name), "utf8"));
  }
  return parts.join("\n");
}
