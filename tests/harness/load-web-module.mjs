// Loads a module from roomcad/web/ in node.
//
// Most of the app imports cleanly outside a browser and is loaded directly from
// its real path. Only the modules that reach for the bare specifier "three" —
// resolved in the browser through the import map in index.html, which node
// knows nothing about — need rewriting, and those are loaded from a temporary
// copy with the specifier pointed at the vendored build. The vendored
// three.webgpu.js itself imports fine in node, so the real geometry code runs
// here rather than only in a browser.
//
// Loading from the real path matters for more than tidiness. A rewritten copy
// is a DIFFERENT module instance, so a test that loaded store.js through a
// rewrite got a store the editor had never heard of: setting the tool on it
// changed nothing, and the editor quietly kept using the real one. Anything
// that does not need rewriting is therefore imported as itself, and shares one
// instance with everything else under test.

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..", "roomcad", "web");

/// Imports `name` (e.g. "city.js") from the web folder.
export async function loadWebModule(name, extraRewrites = []) {
  const path = join(web, name);
  const src = readFileSync(path, "utf8");
  const needsRewrite = /from "three"/.test(src) || extraRewrites.length > 0;
  if (!needsRewrite) return import(pathToFileURL(path).href);

  let rewritten = src
    .replace(/from "three"/g, `from "${join(web, "lib", "three.webgpu.js")}"`)
    .replace(/from "\.\/([\w.-]+)"/g, (_, f) => `from "${join(web, f)}"`);
  for (const [from, to] of extraRewrites) rewritten = rewritten.split(from).join(to);

  // Written beside this file so its relative imports still resolve, and removed
  // again afterwards.
  const tmp = join(here, `.under-test-${name.replace(/\W/g, "_")}.mjs`);
  writeFileSync(tmp, rewritten);
  try {
    return await import(pathToFileURL(tmp).href + "?t=" + Date.now());
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}
