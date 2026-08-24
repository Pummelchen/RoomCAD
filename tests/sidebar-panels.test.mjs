// Hiding and showing the two side panels.
//
// Both panels were always on screen, which on a laptop leaves the drawing a
// strip down the middle. They now collapse from buttons at the right-hand end
// of the menu bar, and the choice is remembered.
//
// The real functions are lifted out of app.js and run here against a small
// stand-in for the document, so these check what the buttons DO rather than
// that a line of source still exists.
//
// Run:  node tests/sidebar-panels.test.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(root, "roomcad", "web", "app.js"), "utf8");
const html = readFileSync(join(root, "roomcad", "web", "index.html"), "utf8");
const css = readFileSync(join(root, "roomcad", "web", "styles.css"), "utf8");

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

  const build = (stored = null) => {
    const store = new Map();
    if (stored !== null) store.set("roomcad.sidebar-layout.v1", stored);
    const body = {
      classes: new Set(),
      classList: {
        toggle(name, on) { on ? body.classes.add(name) : body.classes.delete(name); },
      },
    };
    const button = () => ({
      attrs: {}, title: "",
      setAttribute(k, v) { this.attrs[k] = v; },
    });
    const left = button(), right = button();
    const events = [];
    const widthCalls = [];
    const api = new Function(
      "localStorage", "document", "window", "Event",
      "toggleSidebarButton", "toggleInspectorButton", "applySidebarWidths",
      "SIDEBAR_LAYOUT_KEY", "sidebarWidths",
      "let panelsShown;\n" + app.slice(start, end)
      + "\npanelsShown = loadPanelsShown();"
      + "\nreturn { loadPanelsShown, applyPanelsShown, togglePanel, saveSidebarWidths,"
      + "         shown: () => panelsShown };"
    )(
      { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) },
      { body },
      { dispatchEvent: e => events.push(e.type) },
      function Event(type) { this.type = type; },
      left, right,
      opts => widthCalls.push(opts || {}),
      "roomcad.sidebar-layout.v1",
      { left: 200, right: 260 },
    );
    return { api, body, left, right, events, widthCalls, stored: () => store.get("roomcad.sidebar-layout.v1") };
  };

  // Nothing stored: both panels are there. Anything else would hide a panel
  // from someone who never asked for it.
  {
    const { api, body } = build();
    api.applyPanelsShown();
    check("with nothing remembered both panels show",
      api.shown().left === true && api.shown().right === true);
    check("and nothing is collapsed", body.classes.size === 0, [...body.classes].join(","));
  }

  // Hiding one.
  {
    const { api, body, left, right, events, widthCalls, stored } = build();
    api.applyPanelsShown();
    events.length = 0; widthCalls.length = 0;
    api.togglePanel("left");
    check("hiding the left panel collapses it", body.classes.has("sidebar-collapsed"));
    check("and leaves the right one alone", !body.classes.has("inspector-collapsed"));
    check("the button reads as off", left.attrs["aria-pressed"] === "false");
    check("and offers to bring it back", /^Show the left panel/.test(left.title), left.title);
    check("the other button is untouched", right.attrs["aria-pressed"] === "true");
    // The widths are clamped against the space available, and that space just
    // changed. Skip this and the panel still open keeps a width that was only
    // valid while it had a neighbour.
    check("the remaining panel's width is worked out again", widthCalls.length === 1);
    // The plan is drawn to the canvas's pixel size, so it has to re-measure or
    // it keeps drawing at the old width in the new space.
    check("the drawing area is told to re-measure", events.includes("resize"));

    const saved = JSON.parse(stored());
    check("the choice is remembered",
      saved.shown && saved.shown.left === false && saved.shown.right === true,
      stored());
    check("without losing the remembered widths",
      saved.left === 200 && saved.right === 260, stored());
  }

  // And bringing it back.
  {
    const { api, body, left } = build();
    api.applyPanelsShown();
    api.togglePanel("left");
    api.togglePanel("left");
    check("showing it again brings it back", !body.classes.has("sidebar-collapsed"));
    check("and the button reads as on", left.attrs["aria-pressed"] === "true");
    check("offering to hide it", /^Hide the left panel/.test(left.title), left.title);
  }

  // Each side is its own.
  {
    const { api, body, right } = build();
    api.applyPanelsShown();
    api.togglePanel("right");
    check("hiding the right panel collapses only that one",
      body.classes.has("inspector-collapsed") && !body.classes.has("sidebar-collapsed"));
    check("its button reads as off", right.attrs["aria-pressed"] === "false");
    api.togglePanel("left");
    check("both can be hidden at once",
      body.classes.has("inspector-collapsed") && body.classes.has("sidebar-collapsed"));
  }

  // Coming back to it later.
  {
    const { api, body } = build(JSON.stringify({ left: 180, right: 240, shown: { left: false, right: true } }));
    api.applyPanelsShown();
    check("a panel hidden last time is still hidden", body.classes.has("sidebar-collapsed"));
    check("and one that was showing still shows", !body.classes.has("inspector-collapsed"));
  }
  {
    // A layout saved before this existed has no `shown` at all, and must not
    // come back with panels missing.
    const { api, body } = build(JSON.stringify({ left: 180, right: 240 }));
    api.applyPanelsShown();
    check("a layout saved before panels could be hidden shows both",
      body.classes.size === 0, [...body.classes].join(","));
  }
  {
    const { api, body } = build("{ not json at all");
    api.applyPanelsShown();
    check("unreadable storage shows both rather than nothing",
      body.classes.size === 0, [...body.classes].join(","));
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
