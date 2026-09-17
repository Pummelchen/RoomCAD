// app.js — UI wiring: toolbar, inspector, keyboard, files, and My Rooms.
//
// Split into roomcad/web/app/ and composed here. THE ORDER OF THESE IMPORTS IS
// THE ORDER THE CODE USED TO RUN IN: app.js is a script, so its sections are
// wired by top-level side effects — element handles read once, listeners
// registered, the store subscribed — and ESM evaluates an import graph
// depth-first, so importing them in this order runs them in this order. `main`
// is last because it ends with init().
//
// A module may import from one that comes later, which reads like a cycle. It is
// safe here for a specific reason: every reference between these modules sits
// inside a FUNCTION BODY, so it resolves when it is called rather than when the
// module is evaluated. The one construct that would break that — a listener
// registered at the top level with a handler declared further down, because
// addEventListener needs the function itself at registration time — was moved to
// the section that declares it before any of this was cut.

import "./app/state.js";
import "./app/ui.js";
import "./app/sidebar.js";
import "./app/view.js";
import "./app/inspector.js";
import "./app/toolbar.js";
import "./app/api.js";
import "./app/watch.js";
import "./app/files.js";
import "./app/keys.js";
import "./app/live.js";
import "./app/status.js";
import "./app/main.js";
