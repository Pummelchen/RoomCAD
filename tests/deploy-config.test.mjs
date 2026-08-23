// Contracts for the files that decide how RoomCAD is actually served.
//
// A leading "-" on a header directive tells Caddy to DELETE that header, not to
// set it. Both Caddyfiles used to carry one on X-Frame-Options and
// X-Content-Type-Options, so the deployed app answered with neither — and the
// nginx instance in front of it adds no security headers of its own, so nothing
// downstream made up the difference.
//
// Run:  node tests/deploy-config.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prod = readFileSync(join(root, "roomcad", "server", "Caddyfile"), "utf8");
const dev = readFileSync(join(root, "roomcad", "web", "Caddyfile"), "utf8");
const deploy = readFileSync(join(root, "roomcad", "server", "deploy.sh"), "utf8");

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

for (const [label, src] of [["production", prod], ["local dev", dev]]) {
  // The bug itself: a "-" prefix silently strips the header.
  const deletions = [...src.matchAll(/^\s*-(X-Frame-Options|X-Content-Type-Options|Referrer-Policy)/gm)]
    .map(m => m[1]);
  check(`${label} does not delete its own security headers`,
    deletions.length === 0, deletions.join(", "));

  check(`${label} sets X-Content-Type-Options`, /^\s*X-Content-Type-Options\s+"nosniff"/m.test(src));
  check(`${label} sets X-Frame-Options`, /^\s*X-Frame-Options\s+"(DENY|SAMEORIGIN)"/m.test(src));
  check(`${label} sets Referrer-Policy`, /^\s*Referrer-Policy\s+"/m.test(src));
}

// Module files must revalidate, or a browser keeps serving the previous build.
check("production serves the app with no-cache", /Cache-Control\s+"no-cache"/.test(prod));
check("local dev matches production on caching", /Cache-Control\s+"no-cache"/.test(dev));

// nginx terminates TLS in front, so Caddy must pass its view of the request
// through rather than replacing it with its own.
check("production forwards the original protocol",
  prod.includes("header_up X-Forwarded-Proto {http.request.header.X-Forwarded-Proto}"));
check("production forwards the original client address",
  prod.includes("header_up X-Forwarded-For {http.request.header.X-Forwarded-For}"));

// Server-sent events must not be buffered, or live collaboration stalls.
check("the API proxy flushes immediately", /flush_interval\s+-1/.test(prod));

// A config that fails to parse must never reach the live host.
check("deploy validates the Caddyfile on the target before installing it",
  /caddy\s+validate/.test(deploy));

console.log(`${passed} passed, ${failed} failed — deployment config contracts`);
if (failed) process.exit(1);
