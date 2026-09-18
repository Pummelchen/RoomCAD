// The compensating check for the waived `no-unsanitized/property` rule (T0049).
//
// That rule accepts an escape method only when it wraps the ENTIRE assigned
// expression; this codebase escapes each interpolation individually
// (`innerHTML = `...${esc(name)}...``), which is safe but invisible to the rule.
// The rule is therefore `warn` in AUDIT/eslint.config.mjs, and this file is the
// check that takes its place: it reads the real sources and re-proves, at every
// `innerHTML` sink, that each interpolation is either `esc()`-wrapped or a
// number/boolean. A new unescaped interpolation fails here.
//
// It is a source contract, not a rendered-page test — there is no browser in
// this suite by design — and it is written to FAIL on a deliberate violation
// (see the scratch-source section at the end), so the waiver is a disposition
// with a compensating check rather than a suppression.
//
// Run:  node tests/audit-xss.test.mjs

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

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

// ── Finding innerHTML sinks and their interpolations ──────────────────────

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

/// Every `${...}` in `text`, with balanced braces and quoting respected.
function interpolationsIn(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "$" || text[i + 1] !== "{") continue;
    let depth = 1;
    let j = i + 2;
    let quote = null;
    for (; j < text.length && depth > 0; j++) {
      const ch = text[j];
      if (quote) {
        if (ch === "\\") j++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    out.push({ text: text.slice(i + 2, j - 1), pos: i });
    i = j - 1;
  }
  return out;
}

function lineOf(src, pos) {
  return src.slice(0, pos).split("\n").length;
}

function innerHTMLSites(src, rel) {
  const sites = [];
  const re = /\.innerHTML\s*=\s*(?!=)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const rhs = readExpression(src, m.index + m[0].length).trim();
    sites.push({ rel, pos: m.index, line: lineOf(src, m.index), rhs });
  }
  return sites;
}

/// The interpolations that reach a sink. A template literal (or concatenation)
/// carries them directly; a bare identifier is traced through its declaration
/// and every `+=`/`=` before the sink (status.js builds `html` that way).
function siteInterpolations(site, src) {
  const rhs = site.rhs.trim();
  if (rhs.includes("${")) return interpolationsIn(rhs);
  if (/^[A-Za-z_$][\w$]*$/.test(rhs)) {
    const out = [];
    const re = new RegExp(`(?:^|\\n)\\s*(?:const|let|var)?\\s*${rhs}\\s*\\+?=\\s*`, "g");
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m.index > site.pos) break;
      out.push(...interpolationsIn(readExpression(src, m.index + m[0].length)));
    }
    return out;
  }
  return null; // a function call or a static literal — handled elsewhere
}

// ── The interpolation analyser ────────────────────────────────────────────
//
// An interpolation is safe when it is (a) `esc()`-wrapped, (b) a number or
// boolean producer, or (c) a conditional whose condition and both branches are
// safe. Resolution is deliberately local and conservative: an identifier is
// replaced by its nearest preceding declaration, a member by every assignment
// to it in the same file, and a call by the single `return` of its definition.
// Anything that cannot be resolved this way is UNSAFE, so the test fails closed.

const SAFE_TOKEN = /\.toFixed\s*\(|\bMath\.|\.length\b|\bDate\b|\bversion\b/;
const COMPARISON = /(^|[^=!<>])(===|!==|==|!=|<=|>=|<|>)(?!=)/;

function stripParens(expr) {
  let s = expr.trim();
  while (s.startsWith("(") && matchingClose(s, 0) === s.length - 1) s = s.slice(1, -1).trim();
  return s;
}

function matchingClose(s, open) {
  const pairs = { "(": ")", "[": "]", "{": "}" };
  const close = pairs[s[open]];
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === s[open]) depth++;
    else if (s[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function splitTernary(expr) {
  let depth = 0;
  let q = -1;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0 && ch === "?") { q = i; break; }
  }
  if (q === -1) return null;
  depth = 0;
  let nested = 0;
  for (let i = q + 1; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (depth === 0 && ch === "?") nested++;
    else if (depth === 0 && ch === ":") {
      if (nested === 0) return { cond: expr.slice(0, q), a: expr.slice(q + 1, i), b: expr.slice(i + 1) };
      nested--;
    }
  }
  return null;
}

function declarationBefore(src, name, pos) {
  const re = new RegExp(`(?:^|\\n)\\s*(?:const|let|var)\\s+${name}\\s*=\\s*`, "g");
  let best = null;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m.index >= pos) break;
    best = { expr: readExpression(src, m.index + m[0].length), pos: m.index + m[0].length };
  }
  return best;
}

function memberAssignments(src, member) {
  const escaped = member.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*=\\s*`, "g");
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    out.push({ expr: readExpression(src, m.index + m[0].length), pos: m.index + m[0].length });
  }
  return out;
}

function functionReturn(src, name) {
  const re = new RegExp(`(?:^|\\n)\\s*(?:get\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`, "g");
  let m;
  while ((m = re.exec(src)) !== null) {
    const open = src.indexOf("{", m.index);
    const close = matchingClose(src, open);
    if (close === -1) continue;
    const body = src.slice(open + 1, close);
    const ret = /return\s+([^;]+);/.exec(body);
    if (ret) return { expr: ret[1], pos: open + 1 + ret.index + ret[0].indexOf(ret[1]) };
  }
  return null;
}

function isComparison(expr) {
  return COMPARISON.test(expr);
}

function isSafe(expr, src, pos, seen = new Set()) {
  const e = stripParens(expr);
  if (e === "") return true;
  const key = `${pos}|${e}`;
  if (seen.has(key)) return false; // a cycle cannot be proven
  seen.add(key);

  if (/^esc\s*\(/.test(e)) return matchingClose(e, e.indexOf("(")) === e.length - 1;
  if (/^(true|false|null|undefined)$/.test(e)) return true;
  if (e !== "" && !Number.isNaN(Number(e))) return true;
  if (/^(['"`])[\s\S]*\1$/.test(e)) return true;
  if (SAFE_TOKEN.test(e)) return true;

  const ternary = splitTernary(e);
  if (ternary) {
    const condSafe = isComparison(ternary.cond) || /^(true|false)$/.test(ternary.cond.trim());
    return condSafe && isSafe(ternary.a, src, pos, seen) && isSafe(ternary.b, src, pos, seen);
  }
  if (isComparison(e)) return true;

  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const decl = declarationBefore(src, e, pos);
    return decl ? isSafe(decl.expr, src, decl.pos, seen) : false;
  }
  const memberParts = e.split(".");
  if (memberParts.length > 1 && memberParts.every(p => /^[A-Za-z_$][\w$]*$/.test(p))) {
    const assigns = memberAssignments(src, e);
    return assigns.length > 0 && assigns.every(a => isSafe(a.expr, src, a.pos, seen));
  }
  const call = /^(?:this\.)?([A-Za-z_$][\w$]*)\s*\([^()]*\)$/.exec(e);
  if (call) {
    const ret = functionReturn(src, call[1]);
    return ret ? isSafe(ret.expr, src, ret.pos, seen) : false;
  }
  return false;
}

// ── Every sink in the app ─────────────────────────────────────────────────

const analysed = [];
for (const [rel, src] of sources) {
  for (const site of innerHTMLSites(src, rel)) {
    const interps = siteInterpolations(site, src);
    if (!interps) continue; // a call (view.js) or a static literal — no template here
    for (const it of interps) {
      const safe = isSafe(it.text, src, site.pos);
      analysed.push({ rel, line: site.line, text: it.text.trim(), safe });
      check(
        `${rel}:${site.line} interpolation ${JSON.stringify(it.text.trim())} is esc()-wrapped or numeric/boolean`,
        safe,
        `${rel}:${site.line}`
      );
    }
  }
}
check(
  "the scan reaches the known escaped-innerHTML sites",
  analysed.length >= 11,
  `${analysed.length} interpolations analysed`
);

// ── The section builders view.js assigns ──────────────────────────────────

{
  const view = source(join("roomcad", "web", "app", "view.js"));
  const inspector = source(join("roomcad", "web", "app", "inspector.js"));

  const imported = new Set();
  const importMatch = /import\s*\{([^}]*)\}\s*from\s*["']\.\/inspector\.js["']/.exec(view);
  if (importMatch) for (const part of importMatch[1].split(",")) imported.add(part.trim());
  const exported = new Set(
    [...inspector.matchAll(/export\s+function\s+([A-Za-z_$][\w$]*)/g)].map(m => m[1])
  );

  const calls = [];
  for (const site of innerHTMLSites(view, "roomcad/web/app/view.js")) {
    const call = /^(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/.exec(site.rhs.trim());
    if (call) calls.push({ site, name: call[1] });
  }
  check("every view.js innerHTML sink is a section builder call", calls.length >= 7, `${calls.length} calls`);
  for (const { site, name } of calls) {
    check(
      `view.js:${site.line} gets its HTML from inspector.js's ${name}()`,
      imported.has(name) && exported.has(name),
      `${name} imported=${imported.has(name)} exported=${exported.has(name)}`
    );
  }

  const inspectorInterps = interpolationsIn(inspector);
  for (const field of ["room.name", "label.text"]) {
    const sites = inspectorInterps.filter(i => i.text.includes(field));
    check(
      `inspector.js escapes ${field} wherever it is printed`,
      sites.length > 0 && sites.every(i => /^esc\s*\(/.test(i.text.trim())),
      sites.map(i => i.text.trim()).join(" | ") || "no site found"
    );
  }
}

// ── The escaping function the config trusts ───────────────────────────────

{
  const ui = source("roomcad/web/app/ui.js");
  check(
    "ui.js defines esc() and escapes every HTML-significant character",
    /export function esc\(s\)/.test(ui) &&
      /&amp;/.test(ui) && /&lt;/.test(ui) && /&gt;/.test(ui) &&
      /&quot;/.test(ui) && /&#39;/.test(ui),
    "esc() definition or one of & < > \" ' missing"
  );
}

// ── Proof that the scan fails on a deliberate violation ───────────────────
//
// The check above is only worth the waiver if it would actually catch a new
// unescaped interpolation. This runs the same scan over a scratch source.

{
  const bad = [
    "function go(room, el) {",
    "  el.innerHTML = `<div>${room.name}</div>`;",
    "}",
  ].join("\n");
  const badSites = innerHTMLSites(bad, "scratch.js");
  const badInterps = badSites.flatMap(s => siteInterpolations(s, bad) || []);
  check(
    "the scan finds the innerHTML sink in a sample",
    badSites.length === 1 && badInterps.length === 1,
    `${badSites.length} sites, ${badInterps.length} interpolations`
  );
  check(
    "and flags its unescaped user interpolation",
    badInterps.length === 1 && !isSafe(badInterps[0].text, bad, badSites[0].pos)
  );
  check(
    "and does not accept an expression that merely starts with esc()",
    !isSafe("esc(room.name) + room.name", bad, badSites[0].pos)
  );

  const good = bad.replace("${room.name}", "${esc(room.name)}");
  const goodSites = innerHTMLSites(good, "scratch.js");
  const goodInterps = goodSites.flatMap(s => siteInterpolations(s, good) || []);
  check(
    "and accepts the same sink once it is escaped",
    goodInterps.length === 1 && isSafe(goodInterps[0].text, good, goodSites[0].pos)
  );
}

console.log(`\n${passed} passed, ${failed} failed — the 2026-09-18 innerHTML escape contract`);
process.exit(failed ? 1 : 0);
