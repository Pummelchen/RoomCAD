// The page's stylesheets, as one string, in the order the page loads them.
//
// A test that greps the CSS for a rule is asking a question about what the PAGE
// looks like, and the page's stylesheet is now six files under
// roomcad/web/styles/. Reading one of them would answer the question about a
// sixth of the stylesheet — the same trap as grepping the plan.js facade, in a
// different language.
//
// The order matters, too: the sheets are contiguous cuts of what used to be one
// file, so the link order IS the cascade. `styleSheets()` returns them in that
// order and `pageCss()` joins them, so a contract written against this means
// "this is what the browser sees", not "this is in the file I happened to open".

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "..", "roomcad", "web");

/// The hrefs of the page's stylesheet links, in document order.
export function styleSheets() {
  const html = readFileSync(join(web, "index.html"), "utf8");
  const hrefs = [];
  const link = /<link\b[^>]*>/g;
  for (const tag of html.match(link) || []) {
    if (!/rel\s*=\s*["']stylesheet["']/i.test(tag)) continue;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (href) hrefs.push(href[1]);
  }
  return hrefs.map(href => ({ href, path: join(web, href), text: readFileSync(join(web, href), "utf8") }));
}

/// Every stylesheet the page loads, concatenated in cascade order.
export function pageCss() {
  return styleSheets().map(s => s.text).join("\n");
}
