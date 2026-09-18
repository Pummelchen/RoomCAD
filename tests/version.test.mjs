// Keeps the visible app version connected to its single release source.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { appSource } from "./harness/app-source.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const versionSrc = readFileSync(join(root, "roomcad", "web", "version.js"), "utf8");
const appSrc = appSource();
const html = readFileSync(join(root, "roomcad", "web", "index.html"), "utf8");

let failed = 0;
let passed = 0;
function check(name, condition) {
  if (!condition) {
    failed++;
    console.error("FAIL: " + name);
    return;
  }
  passed++;
}

const match = versionSrc.match(/export const APP_VERSION = "(\d+)\.(\d+)";/);
check("version source uses a numeric major.minor release", !!match);
// The split moved this import into roomcad/web/app/, so the specifier is
// "../version.js" — the contract is that SOME app module imports it, not that a
// particular file does.
check("app imports the shared version", appSrc.includes("import { APP_VERSION } from \"../version.js\";"));
check("footer renders the shared version", appSrc.includes('appVersion.textContent = "v" + APP_VERSION;'));
// The badge is built by the escaping tag (`safeHtml`) rather than by string
// concatenation, so the contract is "this module renders APP_VERSION through
// safeHtml", not the exact wording of one line. A regex, not `includes`: the
// latency and offline branches wrap the same version in spans, and a legitimate
// edit to that wording must not fail a check that is about identity.
check("server-status footer also uses the shared version",
  /appVersion\.innerHTML\s*=\s*safeHtml`[^`]*\$\{APP_VERSION\}/.test(appSrc));
check("app has no hard-coded release tag", !/\bv\d+\.\d+\b/.test(appSrc));
check("HTML does not hard-code an old visible version", !/id="app-version"[^>]*>v\d/.test(html));

console.log(`${passed} passed, ${failed} failed — v${match ? match[1] + "." + match[2] : "?"}`);
if (failed) process.exit(1);
