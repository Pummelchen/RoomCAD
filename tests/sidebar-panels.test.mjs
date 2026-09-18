// Hiding and showing the two side panels.
//
// Both panels were always on screen, which on a laptop leaves the drawing a
// strip down the middle. They now collapse from buttons at the right-hand end
// of the menu bar, and the choice is remembered.
//
// The real module drives this now: roomcad/web/app/sidebar.js is imported with
// the page's DOM in place, and `togglePanel` — the function the buttons are
// wired to — runs against the real document, real localStorage and real
// resizers. The remembered layout is read at module load, so each scenario that
// remembers something imports the module afresh through a query string.
//
// Run:  node tests/sidebar-panels.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { registerHooks } from "node:module";
import { resolve } from "./harness/three-resolver.mjs";
import { installDOM } from "./harness/dom-stub.mjs";
import { pageCss } from "./harness/page-css.mjs";
import { appSource } from "./harness/app-source.mjs";

// Before anything from the app is imported: a bare specifier inside
// roomcad/web/ resolves through the page's own import map.
registerHooks({ resolve });

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "roomcad", "web");
// The app's source, for the contracts that are about the source rather than
// about behaviour.
const app = appSource();
const html = readFileSync(join(web, "index.html"), "utf8");
// The page's stylesheets, concatenated in cascade order: the CSS is split
// under roomcad/web/styles/ now, and reading one of the six would answer a
// question about the page with a sixth of its stylesheet.
const css = pageCss();

// The real page: the panel buttons and the resizers are static markup, and
// sidebar.js binds them and reads `main` while it loads.
const dom = installDOM({ width: 1200, height: 800, page: true });

let passed = 0;
let failed = 0;
function check(name, condition, detail = "") {
  if (condition) { passed++; return; }
  failed++;
  console.error("FAIL: " + name + (detail ? " — " + detail : ""));
}

// ── The controls exist, in the menu bar, at the right-hand end ────────────
{
  check("there is a button for the left panel", html.includes('id="toggle-sidebar"'));
  check("and one for the right panel", html.includes('id="toggle-inspector"'));
  // "in the menu bar on the right end of the menu bar" — both parts matter, so
  // both are checked: inside the header, and pushed to its end.
  const header = html.slice(html.indexOf("<header id=\"toolbar\">"), html.indexOf("</header>"));
  check("both live in the menu bar itself",
    header.includes('id="toggle-sidebar"') && header.includes('id="toggle-inspector"'));
  check("they are the last group in it",
    header.lastIndexOf('class="toolbar-group panel-toggles"')
      > header.lastIndexOf('<div class="toolbar-group">'));
  check("and that group is pushed to the right-hand end",
    /\.toolbar-group\.panel-toggles\s*\{[^}]*margin-left:\s*auto/.test(css));
  check("a hidden panel takes its resizer with it",
    /body\.sidebar-collapsed #sidebar,[\s\S]{0,200}display:\s*none/.test(css)
    && /body\.inspector-collapsed #inspector/.test(css));
  check("the buttons say which state they are in",
    /button\.panel-toggle\[aria-pressed="false"\]/.test(css)
    && /button\.panel-toggle\[aria-pressed="true"\]/.test(css));
}

// ── What the buttons actually do ──────────────────────────────────────────
{
  const start = app.indexOf("function saveSidebarWidths() {");
  const end = app.indexOf("function widthLimit(side) {");
  check("the panel code can be located", start > 0 && end > start);

  const LAYOUT_KEY = "roomcad.sidebar-layout.v1";
  let caseNo = 0;

  /// Imports the real sidebar module with `stored` already in localStorage.
  /// A query string gives a fresh module instance, because `panelsShown` and
  /// `sidebarWidths` are read once, when the module loads.
  const build = async (stored = null) => {
    const ls = dom.window.localStorage;
    ls.clear();
    if (stored !== null) ls.setItem(LAYOUT_KEY, stored);
    // Enough room that the real width clamp leaves the saved 200/260 alone:
    // this test is about the SHOW/HIDE choice, and flattening both panels to
    // the minimum would hide a width that was not remembered.
    dom.document.getElementById("main").clientWidth = 1200;
    const body = dom.document.body;
    body.classList.remove("sidebar-collapsed", "inspector-collapsed");
    dom.document.documentElement.style.setProperty("--sidebar-width", "");
    dom.document.documentElement.style.setProperty("--inspector-width", "");

    const events = [];
    dom.window.addEventListener("resize", () => events.push("resize"));

    const { togglePanel } = await import(
      pathToFileURL(join(web, "app", "sidebar.js")).href + "?case=" + (++caseNo));

    const left = dom.document.getElementById("toggle-sidebar");
    const right = dom.document.getElementById("toggle-inspector");
    const pressed = el => el.getAttribute("aria-pressed") === "true";
    const docStyle = dom.document.documentElement.style;
    return {
      togglePanel, body, left, right, events,
      shown: () => ({ left: pressed(left), right: pressed(right) }),
      collapsed: () => [...body.classList._set],
      stored: () => ls.getItem(LAYOUT_KEY),
      setInspectorWidth: v => docStyle.setProperty("--inspector-width", String(v)),
      inspectorWidth: () => docStyle.getPropertyValue("--inspector-width"),
    };
  };

  // Nothing stored: both panels are there. Anything else would hide a panel
  // from someone who never asked for it.
  {
    const f = await build();
    const shown = f.shown();
    check("with nothing remembered both panels show",
      shown.left === true && shown.right === true);
    check("and nothing is collapsed", f.collapsed().length === 0, f.collapsed().join(","));
  }

  // Hiding one.
  {
    const f = await build();
    f.events.length = 0;
    // Sentinels the value the real re-clamp must overwrite: the old lifted
    // version put a spy around applySidebarWidths(); this reads the real DOM.
    f.setInspectorWidth("999px");
    f.togglePanel("left");
    check("hiding the left panel collapses it", f.body.classList.contains("sidebar-collapsed"));
    check("and leaves the right one alone", !f.body.classList.contains("inspector-collapsed"));
    check("the button reads as off", f.left.getAttribute("aria-pressed") === "false");
    check("and offers to bring it back", /^Show the left panel/.test(f.left.title), f.left.title);
    check("the other button is untouched", f.right.getAttribute("aria-pressed") === "true");
    // The widths are clamped against the space available, and that space just
    // changed. Skip this and the panel still open keeps a width that was only
    // valid while it had a neighbour.
    check("the remaining panel's width is worked out again",
      f.inspectorWidth() !== "999px", f.inspectorWidth());
    // The plan is drawn to the canvas's pixel size, so it has to re-measure or
    // it keeps drawing at the old width in the new space.
    check("the drawing area is told to re-measure", f.events.includes("resize"));

    const saved = JSON.parse(f.stored());
    check("the choice is remembered",
      saved.shown && saved.shown.left === false && saved.shown.right === true,
      f.stored());
    check("without losing the remembered widths",
      saved.left === 200 && saved.right === 260, f.stored());
  }

  // And bringing it back.
  {
    const f = await build();
    f.togglePanel("left");
    f.togglePanel("left");
    check("showing it again brings it back", !f.body.classList.contains("sidebar-collapsed"));
    check("and the button reads as on", f.left.getAttribute("aria-pressed") === "true");
    check("offering to hide it", /^Hide the left panel/.test(f.left.title), f.left.title);
  }

  // Each side is its own.
  {
    const f = await build();
    f.togglePanel("right");
    check("hiding the right panel collapses only that one",
      f.body.classList.contains("inspector-collapsed")
      && !f.body.classList.contains("sidebar-collapsed"));
    check("its button reads as off", f.right.getAttribute("aria-pressed") === "false");
    f.togglePanel("left");
    check("both can be hidden at once",
      f.body.classList.contains("inspector-collapsed")
      && f.body.classList.contains("sidebar-collapsed"));
  }

  // Coming back to it later.
  {
    const f = await build(JSON.stringify({ left: 180, right: 240, shown: { left: false, right: true } }));
    check("a panel hidden last time is still hidden", f.body.classList.contains("sidebar-collapsed"));
    check("and one that was showing still shows", !f.body.classList.contains("inspector-collapsed"));
  }
  {
    // A layout saved before this existed has no `shown` at all, and must not
    // come back with panels missing.
    const f = await build(JSON.stringify({ left: 180, right: 240 }));
    check("a layout saved before panels could be hidden shows both",
      f.collapsed().length === 0, f.collapsed().join(","));
  }
  {
    const f = await build("{ not json at all");
    check("unreadable storage shows both rather than nothing",
      f.collapsed().length === 0, f.collapsed().join(","));
  }
}

// ── The keyboard route ────────────────────────────────────────────────────
{
  const shortcut = app.slice(app.indexOf("// MARK: - Keyboard"));
  check("a shortcut hides the left panel, and the shifted one the right",
    /togglePanel\(e\.shiftKey \? "right" : "left"\)/.test(shortcut));
  check("it is on the backslash key",
    shortcut.includes('key === "\\\\"'), "the modifier says which side");
  check("the buttons are wired to it",
    /toggleSidebarButton\.addEventListener\("click", \(\) => togglePanel\("left"\)\)/.test(app)
    && /toggleInspectorButton\.addEventListener\("click", \(\) => togglePanel\("right"\)\)/.test(app));
  check("and the remembered state is applied at startup",
    /applyPanelsShown\(\);/.test(app));
}

console.log(`${passed} passed, ${failed} failed — collapsible side panels`);
if (failed) process.exit(1);
