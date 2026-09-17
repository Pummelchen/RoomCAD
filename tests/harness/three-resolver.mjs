// A module-resolution hook: bare specifiers inside roomcad/web/ resolve through
// the SAME import map the browser uses.
//
// Every other loader in this folder gets a module in by rewriting its specifiers
// into a temporary copy, which works while the module's imports are all local
// files. It cannot get walk3d.js in, and therefore not app.js either: walk3d
// imports three/addons/…, and those vendored addons are themselves real modules
// that import the bare "three". Rewriting walk3d's own import line does not
// change what the addon it lands in says, so the chain dies one file deeper —
// which is exactly where it died the first time this was tried, after the
// rewrite had been extended to cover three/addons/.
//
// Node's resolver can be told, once, how to resolve a specifier from any module,
// which is the right layer for this: the whole graph is resolved the way the
// browser resolves it, and every module is loaded from its REAL path — no
// copies, so nothing is a second instance.
//
// A test opts in by registering the hook before it imports:
//
//     import { register } from "node:module";
//     register("./three-resolver.mjs", import.meta.url);
//     const app = await import("../roomcad/web/app.js");
//
// Registering affects the imports made AFTER it, so the test's own static
// imports are unaffected and no other test file is touched. Nothing in
// tests/run.sh needs to change.

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, normalize } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..", "roomcad", "web");

const html = readFileSync(join(web, "index.html"), "utf8");
const match = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
if (!match) throw new Error("index.html has no import map — there is nothing to resolve bare specifiers with");
const importMap = JSON.parse(match[1]).imports || {};
// Longest prefix first, as the import-map spec requires, so "three/addons/"
// beats "three" and an addon does not resolve to the WebGPU build.
const KEYS = Object.keys(importMap).sort((a, b) => b.length - a.length);

function mapSpecifier(specifier) {
  for (const key of KEYS) {
    if (specifier === key || specifier.startsWith(key)) {
      const target = importMap[key] + specifier.slice(key.length);
      return target.startsWith("./") || target.startsWith("../")
        ? normalize(join(web, target))
        : target;
    }
  }
  return null;
}

/// Resolves a bare specifier for any module that lives under roomcad/web.
///
/// Scoped to that folder on purpose. A hook is process-wide, and rewriting bare
/// specifiers everywhere would reach into node_modules, the test files and
/// anything else — this is only here to be the browser's import map for the
/// app's own modules.
///
/// Deliberately NOT `async`. The synchronous hook API (`registerHooks`) takes the
/// returned value as the resolution, so an async function hands it a Promise and
/// it reports "expected a URL string but got undefined". Nothing here needs to
/// await: the map is read from disk once, at load.
/// Modules a test wants replaced with a stub, by absolute file URL.
///
/// The app's real modules are loaded from their real paths now, which is what
/// makes a test exercise the code that ships — but some of them cannot run
/// outside a browser. `audio.js` reaches for a WebAudio context on the first
/// door that opens, so a test driving the real store would fail on a ReferenceError
/// about `window` rather than on anything to do with the store.
///
/// The alternative used to be reading the module's source, replacing its import
/// lines, and importing the result as a `data:` URL. That worked while the app
/// was a handful of files with no imports of their own; it stopped working the
/// moment `store.js` became a facade over `store/`, because the imports being
/// replaced were no longer in the file. This replaces the SPECIFIER instead, so
/// it does not care which file says it or how it is spelled.
const stubs = new Map();

/// Replaces one of the app's modules with `source` for the rest of the process.
/// `relativeToWeb` is a path under roomcad/web, e.g. "audio.js".
export function stubModule(relativeToWeb, source) {
  stubs.set(pathToFileURL(join(web, relativeToWeb)).href, source);
}

export function unstubAll() {
  stubs.clear();
}

export function resolve(specifier, context, nextResolve) {
  const parent = context.parentURL;
  if (parent && parent.startsWith("file:")) {
    // A stubbed module first, however the importer spelled the specifier:
    // resolve it against the parent and compare the result.
    let target = null;
    try {
      target = new URL(specifier, parent).href;
    } catch {
      target = null;
    }
    if (target && stubs.has(target)) {
      return {
        url: "data:text/javascript;base64," + Buffer.from(stubs.get(target)).toString("base64"),
        shortCircuit: true,
      };
    }
    const parentPath = fileURLToPath(parent);
    const bare = !specifier.startsWith(".") && !specifier.startsWith("/")
      && !specifier.startsWith("node:") && !specifier.includes(":");
    if (bare && parentPath.startsWith(web)) {
      const target = mapSpecifier(specifier);
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}
