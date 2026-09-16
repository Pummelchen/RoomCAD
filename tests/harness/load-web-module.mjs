// Loads a module from roomcad/web/ in node.
//
// Most of the app imports cleanly outside a browser and is loaded directly from
// its real path. The ones that reach for a BARE specifier — "three",
// "three/tsl", "three/addons/…" — are resolved in the browser through the import
// map in index.html, which node knows nothing about, so those are loaded from a
// temporary copy with every specifier pointed at the file it really names. The
// vendored three.webgpu.js itself imports fine in node, so the real geometry code
// runs here rather than only in a browser.
//
// The map is READ out of index.html rather than written down again here. A
// second copy of it would keep working after the real one changed, which is the
// one thing a loader must not do — and the import map is already checked against
// the page it serves by tests/boot.test.mjs.
//
// Loading from the real path matters for more than tidiness. A rewritten copy
// is a DIFFERENT module instance, so a test that loaded store.js through a
// rewrite got a store the editor had never heard of: setting the tool on it
// changed nothing, and the editor quietly kept using the real one. Anything that
// does not need rewriting is therefore imported as itself, and shares one
// instance with everything else under test. Relative imports are rewritten to
// absolute paths for the same reason — the copy lives elsewhere, but it has to
// resolve to the same real modules.

import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, normalize } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..", "roomcad", "web");

const html = readFileSync(join(web, "index.html"), "utf8");
const mapMatch = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
if (!mapMatch) throw new Error("index.html has no import map — the loader has nothing to resolve bare specifiers with");
const importMap = JSON.parse(mapMatch[1]).imports || {};
// Longest prefix first, as the import-map spec requires: "three/addons/" has to
// win over "three", or every addon would resolve to the WebGPU build.
const MAP_KEYS = Object.keys(importMap).sort((a, b) => b.length - a.length);

/// The absolute path (or URL) a specifier names, or null if it is not one the
/// import map knows — a node builtin, say, which must be left alone.
function resolveSpecifier(spec) {
  if (spec.startsWith("./") || spec.startsWith("../")) return normalize(join(web, spec));
  if (spec.startsWith("/")) return join(web, spec.slice(1));
  for (const key of MAP_KEYS) {
    if (spec === key || spec.startsWith(key)) {
      const target = importMap[key] + spec.slice(key.length);
      return target.startsWith("./") || target.startsWith("../")
        ? normalize(join(web, target))
        : target;
    }
  }
  return null;
}

const SPECIFIER_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\2/g;

function rewriteSpecifiers(src) {
  return src.replace(SPECIFIER_RE, (whole, head, quote, spec) => {
    const resolved = resolveSpecifier(spec);
    return resolved === null ? whole : `${head}${quote}${resolved}${quote}`;
  });
}

/// Whether this module has to go through a copy at all.
///
/// ONLY a bare specifier that the import map resolves forces the copy. A module
/// whose imports are all relative is imported from its REAL path, and that is
/// load-bearing rather than tidy: a copy is a different module instance, so a
/// test that got a copy of store.js while the editor imported the real one saw
/// every gesture do nothing — the test set the tool on its own store and the
/// editor kept using a store it had never heard of. Relative imports are still
/// rewritten to absolute paths, but only inside a module that was being copied
/// for a bare specifier anyway.
function needsCopy(src) {
  for (const m of src.matchAll(SPECIFIER_RE)) {
    const spec = m[3];
    const bare = !spec.startsWith(".") && !spec.startsWith("/")
      && !spec.startsWith("node:") && !spec.includes(":");
    if (bare && resolveSpecifier(spec) !== null) return true;
  }
  return false;
}

/// Imports `name` (e.g. "city.js") from the web folder.
export async function loadWebModule(name, extraRewrites = []) {
  const path = join(web, name);
  const src = readFileSync(path, "utf8");

  if (!needsCopy(src) && extraRewrites.length === 0) return import(pathToFileURL(path).href);

  let out = rewriteSpecifiers(src);
  for (const [from, to] of extraRewrites) out = out.split(from).join(to);

  // Written beside this file, and removed again afterwards.
  const tmp = join(here, `.under-test-${name.replace(/\W/g, "_")}.mjs`);
  writeFileSync(tmp, out);
  try {
    return await import(pathToFileURL(tmp).href + "?t=" + Date.now());
  } finally {
    try { unlinkSync(tmp); } catch { /* already gone */ }
  }
}
