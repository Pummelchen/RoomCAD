// Contracts for the files that decide how RoomCAD is actually served.
//
// Caddy serves RoomCAD end to end — TLS, the app and the API — on its own host
// and port, with nothing in front of it.
//
// Two things here are easy to get wrong in ways nothing else notices. A leading
// "-" on a header directive tells Caddy to DELETE that header rather than set
// it, which is how the app came to ship with no clickjacking or MIME-sniffing
// protection at all. And the CSP allows the inline import map by hash, which
// stops matching the moment anyone edits index.html — so the hash is recomputed
// from the file here and compared.
//
// Run:  node tests/deploy-config.test.mjs

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
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

// Caddy serves RoomCAD end to end now. Nothing is in front of it, so its own
// view of the request is the truth — copying X-Forwarded-* from a header that
// is no longer sent would tell the API the request came in over plain HTTP and
// drop the Secure flag from the session cookie.
check("production does not copy X-Forwarded-* from a proxy that is gone",
  !/header_up\s+X-Forwarded-/.test(prod));
check("production terminates TLS itself", /^\s*tls\s+\S+fullchain\.pem\s+\S+privkey\.pem/m.test(prod));
check("production serves RoomCAD on its own host and port",
  /roomcad\.[\d.]+\.nip\.io:\d+\s*\{/.test(prod));

// nginx does not serve RoomCAD. The one block that remains only forwards the
// old address — without it that hostname matches no server block, falls through
// to nginx's catch-all default, and serves a different application entirely to
// anyone with an old bookmark.
check("the old proxying site is gone for good",
  !existsSync(join(root, "roomcad", "server", "nginx-roomcad.conf")));
check("deploy no longer installs a proxying site",
  !/scp[^\n]*nginx-roomcad\.conf/.test(deploy));
check("deploy removes the old proxying site", /rm -f \/etc\/nginx\/sites-enabled\/roomcad\.conf/.test(deploy));
{
  const redirectPath = join(root, "roomcad", "server", "nginx-roomcad-redirect.conf");
  check("a redirect-only block ships", existsSync(redirectPath));
  const redirect = existsSync(redirectPath) ? readFileSync(redirectPath, "utf8") : "";
  // Directives only: the comments in that file talk about proxy_pass precisely
  // to explain why there isn't one.
  const directives = redirect.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
  check("it serves nothing itself — no proxy, no root",
    !/proxy_pass/.test(directives) && !/^\s*root\s/m.test(directives), "it should only redirect");
  check("it redirects to the Caddy port",
    /return 30[18] https:\/\/\$host:\d+\$request_uri/.test(redirect));
  check("it preserves the method, so a deep link or API call is not turned into a GET",
    /return 308/.test(redirect));
  check("it covers plain HTTP as well as HTTPS",
    /listen 80;/.test(redirect) && /listen 443 ssl;/.test(redirect));
  check("it answers for the RoomCAD hostname only",
    (redirect.match(/server_name\s+roomcad\.[\d.]+\.nip\.io;/g) || []).length === 2);
  check("deploy installs it", /nginx-roomcad-redirect\.conf/.test(deploy));
  check("deploy checks the old URL actually redirects",
    /expected a redirect to :8443/.test(deploy));
}

// HSTS, on the host Caddy now owns end to end.
check("production sends HSTS", /Strict-Transport-Security\s+"max-age=\d+/.test(prod));
check("HSTS is not preloaded and does not claim subdomains",
  !/Strict-Transport-Security[^"]*"[^"]*(preload|includeSubDomains)/.test(prod));

// Caddy needs a readable copy of the certificate; certbot's own store is 0700.
check("a certbot deploy hook ships with the server",
  existsSync(join(root, "roomcad", "server", "certbot-deploy-hook.sh")));
check("deploy installs the certificate hook", /renewal-hooks\/deploy\/roomcad-caddy\.sh/.test(deploy));
check("the hook runs once at deploy so the copy exists before Caddy loads it",
  /roomcad-caddy\.sh\"?\s*$|roomcad-caddy\.sh$/m.test(deploy));

// Content-Security-Policy. The import map in index.html is inline, so it is
// allowed by hash — which silently stops matching the moment anyone edits it.
check("production sends a Content-Security-Policy", /Content-Security-Policy\s+"/.test(prod));
check("the policy does not fall back to unsafe-inline for scripts",
  !/script-src[^"]*'unsafe-inline'/.test(prod));
check("the policy does not allow eval", !/'unsafe-eval'/.test(prod.replace(/'wasm-unsafe-eval'/g, "")));
check("the policy allows WebAssembly for the physics engine",
  /'wasm-unsafe-eval'/.test(prod));
check("the policy blocks framing and plugins",
  /frame-ancestors 'self'/.test(prod) && /object-src 'none'/.test(prod));
{
  const html = readFileSync(join(root, "roomcad", "web", "index.html"), "utf8");
  const inline = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html);
  check("index.html still has an inline import map", !!inline);
  if (inline) {
    const want = "sha256-" + createHash("sha256").update(inline[1]).digest("base64");
    check("the CSP hash matches the import map actually in index.html",
      prod.includes(want), `expected ${want}`);
    check("the local dev config uses the same hash", dev.includes(want));
  }
}

// HTTP/3. It is Caddy's default, but a default is a quiet thing to lose on an
// upgrade, and QUIC needs a UDP firewall rule that opening the TCP port does
// not give you — so the deploy has to check reachability rather than assume it.
check("HTTP/3 is enabled explicitly, not left to the default",
  /servers\s*\{[\s\S]*?protocols[^\n]*\bh3\b/.test(prod));
check("HTTP/1.1 and HTTP/2 are kept alongside it",
  /protocols[^\n]*\bh1\b/.test(prod) && /protocols[^\n]*\bh2\b/.test(prod));
check("deploy checks HTTP/3 actually connects", /--http3-only/.test(deploy));
check("deploy reads the Alt-Svc advertisement", /alt-svc/i.test(deploy));
// A failed HTTP/3 test from the deploying machine does not mean HTTP/3 is
// broken for visitors: a VPN or mesh network carries the traffic over a
// different path with a different MTU, and QUIC minds that far more than TCP.
check("an unreachable HTTP/3 does not jump to blaming the firewall",
  /not proof it is broken for visitors/.test(deploy));
check("it names the likelier cause and how to check it",
  /Tailscale|WireGuard/.test(deploy) && /ip route get/.test(deploy));
check("it still mentions the UDP rule as the other possibility",
  /does NOT open the UDP one/.test(deploy));
check("a missing HTTP/3 does not fail the deploy — HTTP/2 still serves everyone",
  !/--http3-only[\s\S]{0,300}exit 1/.test(deploy));

// Server-sent events must not be buffered, or live collaboration stalls.
check("the API proxy flushes immediately", /flush_interval\s+-1/.test(prod));

// A config that fails to parse must never reach the live host.
check("deploy validates the Caddyfile on the target before installing it",
  /caddy\s+validate/.test(deploy));

// Caddy 2.6.2 can panic while swapping a config in — a Go runtime bug, not a
// bad config — and die. systemctl reported that as a non-fatal message, so a
// deploy once printed "Deployed." while the site was down.
check("deploy checks Caddy survived the reload",
  /is-active --quiet caddy/.test(deploy));
check("deploy falls back to a restart if the reload killed it",
  /reload caddy[\s\S]{0,400}systemctl restart caddy/.test(deploy));
check("deploy fails loudly when Caddy is not running",
  /FAILED: Caddy is not running/.test(deploy) && /exit 1/.test(deploy));
check("deploy will not claim success until the site actually answers",
  /curl[^\n]*%\{http_code\}[\s\S]{0,600}FAILED:/.test(deploy));
check("the check uses the real public URL over TLS",
  /SITE="https:\/\/roomcad\.[\d.]+\.nip\.io:\d+"/.test(deploy));

console.log(`${passed} passed, ${failed} failed — deployment config contracts`);
if (failed) process.exit(1);
