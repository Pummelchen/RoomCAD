// Does the page actually boot?
//
// Every other test in this suite checks the CONFIG that serves the app — the
// CSP hash, the headers, the cache rules — or checks a module in isolation.
// Nothing checked that the page the browser is handed can actually start. The
// failure that costs the most and is caught the latest is a module the import
// map cannot resolve, or an element id that no longer exists: the config is
// perfect, every unit test is green, and the site is a blank page.
//
// This walks the app's real import graph and its real DOM lookups against
// index.html, with no browser and no dependencies — which matters, because this
// repository deliberately has no package.json and adding a headless browser
// would change that.
//
// Run:  node tests/boot.test.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import { appSource } from "./harness/app-source.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const web = join(root, "roomcad", "web");

let passed = 0;
let failed = 0;
function check(name, cond, detail = "") {
  if (cond) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

const html = readFileSync(join(web, "index.html"), "utf8");

// ── The import map ────────────────────────────────────────────────────────
const mapMatch = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
check("index.html carries an import map", !!mapMatch);
const importMap = mapMatch ? JSON.parse(mapMatch[1]).imports || {} : {};

// The bare specifiers the app actually imports. If someone adds an import for a
// package this file does not map, the browser resolves nothing and the module
// never runs — so the map is checked against the code rather than against a
// list kept here.
const bareUsed = new Set();
const graph = new Set();
const missing = [];

/// Resolves one specifier from one module, the way a browser would.
function resolve(spec, fromFile) {
  if (spec.startsWith("./") || spec.startsWith("../")) {
    return normalize(join(dirname(fromFile), spec));
  }
  if (spec.startsWith("/")) return join(web, spec.slice(1));
  // Bare: through the import map, longest prefix first, as the spec requires.
  const keys = Object.keys(importMap).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (spec === key || spec.startsWith(key)) {
      const target = importMap[key] + spec.slice(key.length);
      return normalize(join(web, target));
    }
  }
  bareUsed.add(spec);
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[^;\n]*?from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

function walk(file) {
  if (graph.has(file) || !existsSync(file)) return;
  graph.add(file);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    const target = resolve(spec, file);
    if (!target) { missing.push(`${spec} (in ${file.slice(web.length + 1)})`); continue; }
    if (!existsSync(target)) {
      missing.push(`${spec} -> ${target.slice(web.length + 1)} does not exist`);
      continue;
    }
    walk(target);
  }
}

// The two entry points, in the order index.html loads them.
const entryScripts = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)]
  .map(m => m[1]);
check("index.html loads exactly the two entry modules",
  entryScripts.length === 2, entryScripts.join(", "));
check("and they are login.js then app.js, in that order",
  entryScripts[0] === "login.js" && entryScripts[1] === "app.js", entryScripts.join(", "));
check("both entry modules exist on disk",
  entryScripts.every(s => existsSync(join(web, s))));

for (const s of entryScripts) walk(join(web, s));

// ── Every specifier in the graph resolves ─────────────────────────────────
check("every import in the app resolves, and every target exists",
  missing.length === 0, missing.slice(0, 6).join("; "));
check("no bare specifier is left unmapped (a browser would fail on it)",
  bareUsed.size === 0, [...bareUsed].join(", "));

// The map's own targets have to be real files, or the map is decoration.
for (const [key, target] of Object.entries(importMap)) {
  const file = normalize(join(web, target));
  const dir = file.endsWith("/") || target.endsWith("/");
  check(`the import map's "${key}" points at something real`,
    dir ? existsSync(file) : existsSync(file), target);
}
check("the map covers the bare specifiers the code uses",
  ["three", "three/tsl"].every(k => k in importMap), Object.keys(importMap).join(", "));

// ── The vendored library is actually present ──────────────────────────────
check("the Three.js WebGPU build is vendored",
  existsSync(join(web, "lib", "three.webgpu.js")));
check("and the TSL shim it is imported through",
  existsSync(join(web, "lib", "three.tsl.js")));
check("and the physics engine", existsSync(join(web, "lib", "rapier.mjs")));
check("and the addons walk3d imports by mapped path",
  ["environments/RoomEnvironment.js", "tsl/display/BloomNode.js", "tsl/display/SSAONode.js"]
    .every(p => existsSync(join(web, "lib", p))));

// ── Every module in the app is reachable from an entry point ──────────────
{
  const shipped = readdirSync(web)
    .filter(f => f.endsWith(".js"))
    .map(f => join(web, f));
  const orphans = shipped.filter(f => !graph.has(f));
  check("no module is shipped that nothing loads",
    orphans.length === 0,
    orphans.map(f => f.slice(web.length + 1)).join(", "));
}

// ── Every element the code looks up exists in the page ────────────────────
{
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));

  // `#foo` inside an actual SELECTOR, plus getElementById("foo").
  //
  // Only the argument of a selector call counts. Scanning every quoted string
  // for "#" otherwise picks up hex colours — "#ff3b30" reads as an element
  // called ff3b30 — which is how the first version of this check reported
  // twenty missing ids that were all paint.
  const wanted = new Map();   // id -> the file that asks for it
  const sources = ["app.js", "editor2d.js", "login.js", "store.js", "walk3d.js", "city.js"];
  const SELECTOR_RE = /(?:querySelector|querySelectorAll|closest|matches)\(\s*["'`]([^"'`]*)["'`]/g;

  for (const name of sources) {
    const src = readFileSync(join(web, name), "utf8");
    for (const m of src.matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)) {
      wanted.set(m[1], name);
    }
    for (const m of src.matchAll(SELECTOR_RE)) {
      for (const idm of m[1].matchAll(/#([A-Za-z][A-Za-z0-9_-]*)/g)) {
        if (!wanted.has(idm[1])) wanted.set(idm[1], name);
      }
    }
  }

  const absent = [...wanted].filter(([id]) => !ids.has(id));
  check("every element id the code looks up exists in index.html",
    absent.length === 0,
    absent.map(([id, file]) => `${id} (${file})`).join(", "));
  check("and the page is being read for ids at all",
    ids.size > 40, `${ids.size} ids in index.html, ${wanted.size} looked up`);
}

// ── The page cannot start before the login gate answers ───────────────────
{
  // login.js runs first and defines the hook app.js calls on a 401. If the
  // order is ever swapped the app throws on the first expired session.
  check("login.js defines the 401 hook app.js calls",
    /window\.__roomcadShowLogin\s*=/.test(readFileSync(join(web, "login.js"), "utf8")));
  check("and app.js calls exactly that name",
    /__roomcadShowLogin/.test(appSource()));
}

console.log(`${passed} passed, ${failed} failed — the page can boot`);
if (failed) process.exit(1);
