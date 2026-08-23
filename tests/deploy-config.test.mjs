// Contracts for the files that decide how RoomCAD is actually served.
//
// RoomCAD runs its OWN web server: its own copy of the Caddy binary under
// /var/roomcad/bin, its own config, its own storage, its own unix user and its
// own systemd unit. Nothing it reads or writes belongs to another project.
//
// It did not start that way. RoomCAD was a site block inside the system-wide
// /etc/caddy/Caddyfile, which also served an unrelated updater on :8090 — so
// this repository carried that project's configuration, and every RoomCAD
// deploy overwrote it. Two other shared paths did the same kind of damage from
// the other direction: /etc/nginx and /etc/letsencrypt are both symlinks into a
// third project's tree, and when that tree was restructured they dangled and
// the deploy began giving up halfway through. These checks are what keeps the
// projects apart.
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

// — Nothing outside /var/roomcad ————————————————————————————————
{
  const foreign = [
    ["/etc/nginx", /\/etc\/nginx/],
    ["/etc/letsencrypt", /\/etc\/letsencrypt/],
    ["/etc/caddy", /\/etc\/caddy/],
  ];
  // Comments discuss these paths precisely to explain why they are not used,
  // so only actual commands count.
  const commands = deploy.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
  for (const [path, re] of foreign) {
    check(`deploy never touches ${path}`, !re.test(commands),
      "that path belongs to another project");
  }
  check("deploy installs RoomCAD's config into RoomCAD's own directory",
    /\/var\/roomcad\/caddy\/Caddyfile/.test(deploy));
  check("deploy validates with RoomCAD's own copy of the binary",
    /\/var\/roomcad\/bin\/caddy validate/.test(deploy));
  check("deploy drives RoomCAD's own unit, not the shared one",
    /systemctl reload roomcad-caddy/.test(deploy) && !/systemctl reload caddy\b/.test(commands));
  // Directives only: the comments explain what used to share this file.
  const prodDirectives = prod.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
  check("the config carries no other project's site",
    !/xaios/.test(prodDirectives) && !/:8090/.test(prodDirectives),
    "one project per config file");
}

// — RoomCAD's own web server —————————————————————————————————
{
  const unitPath = join(root, "roomcad", "server", "roomcad-caddy.service");
  check("RoomCAD ships its own systemd unit", existsSync(unitPath));
  const unit = existsSync(unitPath) ? readFileSync(unitPath, "utf8") : "";
  check("it runs its own copy of the binary",
    /ExecStart=\/var\/roomcad\/bin\/caddy run/.test(unit));
  check("as its own unix user, not one shared with another server",
    /User=roomcadweb/.test(unit) && /Group=roomcadweb/.test(unit));
  check("with its own storage, so two instances never contend for one lock",
    /XDG_DATA_HOME=\/var\/roomcad\/caddy/.test(unit));
  check("and it comes back by itself if it dies", /Restart=on-failure/.test(unit));
  // Two Caddy processes cannot share the default admin endpoint; the second to
  // start simply fails to bind it.
  check("it has its own admin endpoint", /admin unix\/\/var\/roomcad\/caddy\/admin\.sock/.test(prod));
  check("and reload is pointed at that endpoint rather than the default port",
    /ExecReload=[^\n]*--address unix\/\/var\/roomcad\/caddy\/admin\.sock/.test(unit));
}

// — The migration that separated them ———————————————————————————
{
  const splitPath = join(root, "roomcad", "server", "split-caddy-instances.sh");
  check("the migration that split the instances is in the repository", existsSync(splitPath));
  const split = existsSync(splitPath) ? readFileSync(splitPath, "utf8") : "";
  check("it gives the other project its own instance too, rather than leaving it homeless",
    /xaios-caddy\.service/.test(split) && /\/var\/xaios_updater\/bin\/caddy/.test(split));
  check("it validates both configs before switching anything",
    /validate --config \/var\/roomcad\/caddy\/Caddyfile/.test(split)
    && /validate --config \/var\/xaios_updater\/caddy\/Caddyfile/.test(split));
  check("it puts the old server back if either new one fails to start",
    /Rolling back to the shared instance/.test(split) && /systemctl start caddy/.test(split));
  check("it hides the server's own files from the directory it serves",
    /hide \/var\/xaios_updater\/caddy/.test(split),
    "the config sits inside the web root");
  check("it disables the shared unit rather than deleting anyone's files",
    /systemctl disable caddy/.test(split) && !/rm -rf \/etc\/caddy/.test(split));
}

// — Renewing the certificate without borrowing anyone's directories ————
{
  const renewPath = join(root, "roomcad", "server", "renew-certificate.sh");
  check("a self-contained renewal script ships", existsSync(renewPath));
  const renew = existsSync(renewPath) ? readFileSync(renewPath, "utf8") : "";
  check("it keeps its certbot state under /var/roomcad",
    /STORE=\/var\/roomcad\/letsencrypt/.test(renew));
  check("it will not stop another project's web server on its own",
    /Not renewing/.test(renew) && /--take-port-80/.test(renew));
  check("and it warns that nginx cannot currently restart before offering to",
    /currently FAILS/.test(renew) && /would not come back/.test(renew));
  check("it installs the result for RoomCAD's own user only",
    /-o root -g roomcadweb \/var\/roomcad\/tls/.test(renew));
  check("the old shared-store hook is gone for good",
    !existsSync(join(root, "roomcad", "server", "certbot-deploy-hook.sh")));
  check("deploy reports how long the certificate has left",
    /openssl x509 -checkend/.test(deploy));
}

// HSTS, on the host Caddy now owns end to end.
check("production sends HSTS", /Strict-Transport-Security\s+"max-age=\d+/.test(prod));
check("HSTS is not preloaded and does not claim subdomains",
  !/Strict-Transport-Security[^"]*"[^"]*(preload|includeSubDomains)/.test(prod));

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
  /caddy validate/.test(deploy));

// Caddy 2.6.2 can panic while swapping a config in — a Go runtime bug, not a
// bad config — and die. systemctl reported that as a non-fatal message, so a
// deploy once printed "Deployed." while the site was down.
check("deploy checks its own Caddy survived the reload",
  /is-active --quiet roomcad-caddy/.test(deploy));
check("deploy falls back to a restart if the reload killed it",
  /reload roomcad-caddy[\s\S]{0,400}systemctl restart roomcad-caddy/.test(deploy));
check("deploy fails loudly when it is not running",
  /FAILED: roomcad-caddy is not running/.test(deploy) && /exit 1/.test(deploy));
check("deploy will not claim success until the site actually answers",
  /curl[^\n]*%\{http_code\}[\s\S]{0,600}FAILED:/.test(deploy));
check("the check uses the real public URL over TLS",
  /SITE="https:\/\/roomcad\.[\d.]+\.nip\.io:\d+"/.test(deploy));

console.log(`${passed} passed, ${failed} failed — deployment config contracts`);
if (failed) process.exit(1);
