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

// The master in /var/caddy terminates TLS and routes to here; RoomCAD's own
// server does no TLS at all and is reachable only on loopback.
check("RoomCAD's own server does no TLS — the master owns certificates",
  !/^\s*tls\s+\S*fullchain\.pem/m.test(prod) && /auto_https off/.test(prod));
check("it binds loopback only, so nothing reaches it around the TLS hop",
  /^\s*bind 127\.0\.0\.1/m.test(prod));
check("its site block matches any host, since the master forwards the real one",
  /^:8081 \{/m.test(prod),
  "a block keyed on an address matches nothing and answers an empty 200");
// The scheme now has to be carried across a plain-HTTP hop. Caddy sets
// X-Forwarded-Proto from the connection IT received, which is loopback HTTP —
// so left alone the API would think the request was insecure and drop the
// Secure flag from the session cookie.
check("the original scheme is passed through to the API",
  /header_up X-Forwarded-Proto \{header\.X-Forwarded-Proto\}/.test(prod));

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
  check("deploy drives RoomCAD's own unit", /systemctl reload roomcad-caddy/.test(deploy));
  // It does reload the master, because that is how its own route takes effect
  // — but the master's WHOLE config is validated first. An invalid route here
  // would take down every project on the host, which is the exact coupling
  // this arrangement exists to prevent.
  check("deploy validates the master's config before reloading it",
    /caddy validate --config \/var\/caddy\/Caddyfile[\s\S]{0,400}systemctl reload caddy/.test(deploy));
  check("and fails loudly if the master does not come back",
    /every project on this host is down/.test(deploy));
  const copiesElsewhere = deploy.split("\n")
    .filter(l => !/^\s*#/.test(l))
    .filter(l => /\bscp\b/.test(l) && /\$HOST:\/var\//.test(l))
    .filter(l => !/\$HOST:\/var\/roomcad\//.test(l));
  check("the only thing it writes outside /var/roomcad is its own route",
    copiesElsewhere.every(l => /\/var\/caddy\/projects\/roomcad\.caddy/.test(l)),
    copiesElsewhere.join(" ; "));
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

// — RoomCAD's route in the master —————————————————————————————
//
// The host runs a master Caddy in /var/caddy that owns 80 and 443, terminates
// TLS and routes each hostname to the project that serves it. Every project
// owns exactly one file in /var/caddy/projects/ and nothing else there. That
// boundary is the point: the arrangement before it had one Caddyfile holding
// every project's real configuration, so each deploy overwrote the others'.
{
  const routePath = join(root, "roomcad", "server", "roomcad.caddy");
  check("RoomCAD ships a route for the master", existsSync(routePath));
  const route = existsSync(routePath) ? readFileSync(routePath, "utf8") : "";
  check("the route names only RoomCAD's own hostname",
    /roomcad\.[\d.]+\.nip\.io/.test(route)
    && !/minecraft|xaios/.test(route.split("\n").filter(l => !/^\s*#/.test(l)).join("\n")));
  check("it forwards to RoomCAD's loopback server", /reverse_proxy [^\n]*127\.0\.0\.1:8081/.test(route));
  check("it keeps the old :8443 links working", /:8443/.test(route));
  check("it preserves the client's Host, or the backend matches nothing",
    /header_up Host \{host\}/.test(route));
  check("it does not buffer server-sent events", /flush_interval -1/.test(route));
  check("deploy installs it into the master's projects directory",
    /\/var\/caddy\/projects\/roomcad\.caddy/.test(deploy));
}

// — No certificate handling left in this project ————————————————
{
  // The master owns port 80, so it answers the ACME challenge itself. There is
  // no certbot, no store to borrow from and no hook to copy anything — which
  // is what the previous two arrangements were, and both broke when a
  // directory belonging to another project moved.
  const commands = deploy.split("\n").filter(l => !/^\s*#/.test(l)).join("\n");
  check("the deploy has no certificate handling at all",
    !/certbot|fullchain\.pem|renewal-hooks/.test(commands));
  check("the renewal script is gone with it",
    !existsSync(join(root, "roomcad", "server", "renew-certificate.sh")));
  check("and so is the hook it replaced",
    !existsSync(join(root, "roomcad", "server", "certbot-deploy-hook.sh")));
}

// — Two proxies now sit in front of the API —————————————————————
{
  // client -> master -> RoomCAD's Caddy -> the API. The real client address is
  // one entry further from the end of X-Forwarded-For than it used to be; left
  // unset, every request throttles as 127.0.0.1.
  check("deploy sets the proxy hop count to match the chain",
    /ROOMCAD_PROXY_HOPS=1/.test(deploy));
}

// — The Caddy binary each project runs ——————————————————————————
{
  const instPath = join(root, "roomcad", "server", "install-caddy.sh");
  check("there is a way to install the official Caddy release", existsSync(instPath));
  const inst = existsSync(instPath) ? readFileSync(instPath, "utf8") : "";
  check("it takes the binary from upstream, not from the distribution",
    /github\.com\/caddyserver\/caddy\/releases/.test(inst));
  check("it gives each project its own copy", /\$dir\/bin\/caddy/.test(inst));
  check("it replaces the binary via a temporary name, since a running server holds it open",
    /caddy\.new/.test(inst));
  // Both of these cost a silent failure once: an early-exiting reader closes
  // the pipe, the writer takes SIGPIPE, and pipefail turns a successful
  // download into a fatal error that printed nothing at all.
  check("it does not pipe a download into an early-exiting reader",
    !/curl[^\n|]*\|[^\n]*(grep -m1|head -)/.test(inst));
}

// HSTS, on the host Caddy now owns end to end.// HSTS, on the host Caddy now owns end to end.
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
// HTTP/3 belongs to whichever server terminates TLS, which is now the master.
// RoomCAD's own server speaks plain HTTP on loopback and cannot advertise it,
// so there is nothing to assert in this config — but the deploy still checks
// the live site, which is the only thing that actually proves it.
check("RoomCAD's own config does not try to own HTTP/3 any more",
  !/protocols[^\n]*\bh3\b/.test(prod));
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
  /SITE="https:\/\/roomcad\.[\d.]+\.nip\.io"/.test(deploy));
check("and the old :8443 links are checked too", /:8443\//.test(deploy));

console.log(`${passed} passed, ${failed} failed — deployment config contracts`);
if (failed) process.exit(1);
