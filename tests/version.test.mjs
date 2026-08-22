// Keeps the visible app version connected to its single release source.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const versionSrc = readFileSync(join(root, "roomcad", "web", "version.js"), "utf8");
const appSrc = readFileSync(join(root, "roomcad", "web", "app.js"), "utf8");
const html = readFileSync(join(root, "roomcad", "web", "index.html"), "utf8");

let failed = 0;
function check(name, condition) {
  if (!condition) {
    failed++;
    console.error("FAIL: " + name);
  }
}

const match = versionSrc.match(/export const APP_VERSION = "(\d+)\.(\d+)";/);
check("version source uses a numeric major.minor release", !!match);
check("app imports the shared version", appSrc.includes('import { APP_VERSION } from "./version.js";'));
check("footer renders the shared version", appSrc.includes('appVersion.textContent = "v" + APP_VERSION;'));
check("server-status footer also uses the shared version", appSrc.includes('let html = "v" + APP_VERSION;'));
check("app has no hard-coded release tag", !/\bv\d+\.\d+\b/.test(appSrc));
check("HTML does not hard-code an old visible version", !/id="app-version"[^>]*>v\d/.test(html));

if (failed) process.exit(1);
console.log("6 passed, 0 failed — v" + match[1] + "." + match[2]);
