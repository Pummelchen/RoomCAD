// The compensating check for the `no-unsanitized/property` rule (T0049).
//
// The rule is `error`, and its config trusts exactly two escaper shapes:
//   * `safeHtml`…`` — a tagged template that escapes every raw `${…}` itself
//     and passes a value `safeMarkup` built through unchanged;
//   * `esc(value)` — the single-value escaper.
// Everything else assigned to `innerHTML` is an error. This file is the part
// eslint cannot do on its own: it reads the real sources, finds every
// `innerHTML` sink itself, and asserts each one is one of those safe shapes (or
// a literal, which has no interpolation to escape). A new hand-built template
// fails here.
//
// It then drives the REAL escaper out of app/ui.js — not a re-implementation —
// and proves the three facts the config is trusted on: `esc()` escapes the five
// HTML-significant characters, `safeHtml` escapes a raw interpolation, and a
// value `safeMarkup` built passes through unescaped (so composing builders does
// not double-escape).
//
// It is a source contract plus a unit check, not a rendered-page test — there
// is no browser in this suite by design — and the classifier is proved to fail
// on a deliberate violation, so the check is not vacuous.
//
// Run:  node tests/audit-xss.test.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { registerHooks } from "node:module";
import { resolve } from "./harness/three-resolver.mjs";
import { installDOM } from "./harness/dom-stub.mjs";
import { loadWebModule } from "./harness/load-web-module.mjs";

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

// ── Reading the real sources ──────────────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "lib") continue; // vendored, SHA-pinned, not ours
      out.push(...walk(full));
    } else if (name.endsWith(".js")) {
      out.push(full);
    }
  }
  return out;
}

const sources = new Map(); // repo-relative path -> source text
for (const file of walk(web)) {
  sources.set(relative(root, file), readFileSync(file, "utf8"));
}
function source(rel) {
  const src = sources.get(rel);
  if (src === undefined) throw new Error("no such source: " + rel);
  return src;
}

// ── Finding innerHTML sinks and classifying what is assigned ──────────────

/// The expression assigned by the `=` starting at `start`, up to the `;` that
/// ends the statement at bracket depth zero. A template literal is opaque, so a
/// `;` inside one cannot end the scan early.
function readExpression(src, start) {
  let depth = 0;
  let i = start;
  let inTemplate = false;
  let quote = null;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (inTemplate) {
      if (ch === "\\") i++;
      else if (ch === "`") inTemplate = false;
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === "`") { inTemplate = true; continue; }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === ";" && depth === 0) break;
  }
  return src.slice(start, i);
}

function lineOf(src, pos) {
  return src.slice(0, pos).split("\n").length;
}

function innerHTMLSites(src, rel) {
  const sites = [];
  const re = /\.innerHTML\s*=\s*(?!=)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    sites.push({
      rel,
      pos: m.index,
      line: lineOf(src, m.index),
      rhs: readExpression(src, m.index + m[0].length).trim(),
    });
  }
  return sites;
}

/// The index of the bracket closing the one at `open`, or -1.
function matchingClose(s, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const close = pairs[s[open]];
  if (!close) return -1;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === s[open]) depth++;
    else if (s[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/// How the right-hand side of an `innerHTML` assignment is allowed to be built.
/// `safeHtml`…`` and `esc(…)` are the two the eslint rule trusts; a literal
/// (single/double quoted, or a template with no `${…}`) carries nothing to
/// escape. Anything else — a bare identifier, a hand-built template, a
/// concatenation — is `unsafe`.
function sinkKind(rhs) {
  const r = rhs.trim();
  if (/^safeHtml\s*`/.test(r)) return "safeHtml";
  if (/^esc\s*\(/.test(r)) {
    const open = r.indexOf("(");
    return matchingClose(r, open) === r.length - 1 ? "esc" : "unsafe";
  }
  if (/^`[\s\S]*`$/.test(r) && !r.includes("${")) return "literal template";
  if (/^'[^']*'$/.test(r) || /^"[^"]*"$/.test(r)) return "literal";
  return "unsafe";
}

// ── Every sink in the app must be safe by its shape ───────────────────────

{
  let sinkCount = 0;
  let safeHtmlCount = 0;
  let unsafe = 0;
  for (const [rel, src] of sources) {
    for (const site of innerHTMLSites(src, rel)) {
      sinkCount++;
      const kind = sinkKind(site.rhs);
      if (kind === "safeHtml") safeHtmlCount++;
      if (kind === "unsafe") unsafe++;
      check(
        `${rel}:${site.line} assigns innerHTML from safeHtml, a literal, or esc()`,
        kind !== "unsafe",
        `${kind}: ${site.rhs.slice(0, 70)}`
      );
    }
  }
  check("the scan reaches the app's innerHTML sinks", sinkCount >= 15, `${sinkCount} sinks found`);
  check("and most of them go through safeHtml", safeHtmlCount >= 10, `${safeHtmlCount} safeHtml sinks`);
  check("no innerHTML sink is hand-built or a bare variable", unsafe === 0, `${unsafe} unsafe`);
}

// ── Proof the classifier fails on a deliberate violation ──────────────────
//
// The check above is only worth the config if it would actually catch a new
// unescaped sink. Run the same classifier over scratch sources.

{
  const wrap = line => `function go(room, el) {\n  ${line}\n}`;
  const kindOf = line => {
    const sites = innerHTMLSites(wrap(line), "scratch.js");
    return sites.length === 1 ? sinkKind(sites[0].rhs) : `no site (${sites.length})`;
  };

  check(
    "an untagged interpolated template is unsafe",
    kindOf("el.innerHTML = `<div>${room.name}</div>`;") === "unsafe",
    kindOf("el.innerHTML = `<div>${room.name}</div>`;")
  );
  check(
    "a bare variable is unsafe",
    kindOf("el.innerHTML = html;") === "unsafe",
    kindOf("el.innerHTML = html;")
  );
  check(
    "a concatenation of a literal and a value is unsafe",
    kindOf("el.innerHTML = \"<b>\" + room.name + \"</b>\";") === "unsafe",
    kindOf("el.innerHTML = \"<b>\" + room.name + \"</b>\";")
  );
  check(
    "an esc() call whose result has more appended is unsafe",
    kindOf("el.innerHTML = esc(room.name) + room.name;") === "unsafe",
    kindOf("el.innerHTML = esc(room.name) + room.name;")
  );
  check(
    "safeHtml with a raw interpolation is accepted",
    kindOf("el.innerHTML = safeHtml`<b>${room.name}</b>`;") === "safeHtml",
    kindOf("el.innerHTML = safeHtml`<b>${room.name}</b>`;")
  );
  check(
    "a plain literal is accepted",
    kindOf("el.innerHTML = \"\";") === "literal",
    kindOf("el.innerHTML = \"\";")
  );
  check(
    "an interpolation-free template is accepted",
    kindOf("el.innerHTML = `<li>Server unreachable</li>`;") === "literal template",
    kindOf("el.innerHTML = `<li>Server unreachable</li>`;")
  );
  check(
    "a whole-expression esc() call is accepted",
    kindOf("el.innerHTML = esc(room.name);") === "esc",
    kindOf("el.innerHTML = esc(room.name);")
  );
}

// ── The escaper itself, driven for real ───────────────────────────────────
//
// The scan proves the sinks are shaped right; this proves the functions they
// route through actually escape. It loads the REAL app/ui.js, so a change to
// `esc`/`safeMarkup`/`safeHtml` is exercised rather than a copy of it.

const dom = installDOM();
const { esc, safeMarkup, safeHtml, inspectorContent } = await loadWebModule("app/ui.js");

const ALL = "&<>\"'";
const ESCAPED = "&amp;&lt;&gt;&quot;&#39;";

check("ui.js exports esc()", typeof esc === "function");
check("esc escapes all five HTML-significant characters", esc(ALL) === ESCAPED, esc(ALL));
check(
  "esc stringifies a number and handles null/undefined",
  esc(42) === "42" && esc(null) === "null" && esc(undefined) === "undefined"
);
check("safeHtml is callable as a tag", typeof safeHtml === "function");

check("safeHtml escapes & < > \" ' in a raw interpolation", safeHtml`${ALL}` === ESCAPED, safeHtml`${ALL}`);
check("safeHtml leaves literal text alone", safeHtml`<b>ok</b>` === "<b>ok</b>", safeHtml`<b>ok</b>`);

const marked = safeMarkup`<b>${ALL}</b>`;
check("safeMarkup escapes a raw interpolation exactly once", marked.html === "<b>" + ESCAPED + "</b>", marked.html);
check(
  "safeHtml passes a safeMarkup value through unchanged",
  safeHtml`${marked}` === marked.html,
  safeHtml`${marked}`
);
check(
  "safeMarkup passes a safeMarkup value through unchanged too",
  safeMarkup`${marked}`.html === marked.html,
  safeMarkup`${marked}`.html
);

// The scratch probe the `taggedTemplates` config is trusted on: a raw value is
// escaped, a value the tag built itself is not re-escaped, and that value's own
// raw interpolation was escaped once on the way in.
{
  const x = "<script>";
  const raw = safeHtml`<b>${x}</b>`;
  check('safeHtml`<b>${x}</b>` escapes x = "<script>"', raw === "<b>&lt;script&gt;</b>", raw);

  const trusted = safeMarkup`<script>alert(1)</script>`;
  const passed = safeHtml`<b>${trusted}</b>`;
  check(
    "and a marked case passes its markup through unescaped",
    passed === "<b><script>alert(1)</script></b>",
    passed
  );

  const nested = safeHtml`<b>${safeMarkup`<i>${x}</i>`}</b>`;
  check(
    "while a marked value's own raw interpolation is still escaped once",
    nested === "<b><i>&lt;script&gt;</i></b>",
    nested
  );
}

// ── The builders, rendered for real ───────────────────────────────────────
//
// The unit checks above prove the tag escapes; this drives the real inspector
// through the real DOM stub, the way view.js does: a room name and a label text
// carrying a closing tag and an `<img onerror>` must reach `innerHTML` as text,
// and the stub's parser must build no element out of them.
{
  registerHooks({ resolve }); // walk3d.js, reached through inspector.js → view.js, uses bare "three"
  const inspector = await loadWebModule("app/inspector.js");
  const { store } = await loadWebModule("store.js");

  const hostile = "</div><img src=x onerror=alert(1)>";
  const escaped = "&lt;/div&gt;&lt;img src=x onerror=alert(1)&gt;";

  store.room.name = hostile;
  inspectorContent.innerHTML = safeHtml`${inspector.roomSection()}`;
  check(
    "roomSection() renders a hostile room name as escaped text",
    inspectorContent.innerHTML.includes("value=\"" + escaped + "\""),
    inspectorContent.innerHTML.slice(0, 140)
  );
  check(
    "and builds no element out of it",
    !inspectorContent.innerHTML.includes("<img") && inspectorContent.querySelector("img") === null
  );

  inspectorContent.innerHTML = safeHtml`${inspector.labelSection({ text: hostile, size: 0.5, rotationDegrees: 0 })}`;
  check(
    "labelSection() renders hostile label text as escaped text",
    inspectorContent.innerHTML.includes("value=\"" + escaped + "\""),
    inspectorContent.innerHTML.slice(0, 140)
  );
  check(
    "and builds no element out of it",
    !inspectorContent.innerHTML.includes("<img") && inspectorContent.querySelector("img") === null
  );
}

// The config names two exports by hand; a rename would silently stop the rule
// trusting them, so the names are pinned at the source as well.
{
  const uiSrc = source(join("roomcad", "web", "app", "ui.js"));
  check("ui.js still exports esc()", /export\s+function\s+esc\s*\(/.test(uiSrc));
  check("ui.js still exports safeMarkup()", /export\s+function\s+safeMarkup\s*\(/.test(uiSrc));
  check("ui.js still exports safeHtml()", /export\s+function\s+safeHtml\s*\(/.test(uiSrc));
}

dom.restore();

console.log(`\n${passed} passed, ${failed} failed — the 2026-09-18 innerHTML escape contract`);
process.exit(failed ? 1 : 0);
