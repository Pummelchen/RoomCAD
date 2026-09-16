// A DOM small enough to run the real 2D editor outside a browser.
//
// editor2d.js was only ever tested by reading its source: a test asserted the
// file still contained a line, which proves nothing about what happens when you
// actually drag something. This provides just enough of a document, a window
// and a canvas for `new Editor2D(canvas)` to construct and run, so tests can
// press the mouse down, move it and let go, and then look at the plan.
//
// Nothing here pretends to be a browser. Layout is a fixed rectangle, and the
// 2D context records the calls made to it instead of rasterising. That is
// enough for the editor, which reads only the canvas size and the pointer
// position, and writes only through the store.
//
// `installDOM({ page: true })` additionally parses the real roomcad/web/index.html
// into the document. That is off by default, because most tests want a blank
// page with lazily-created elements; it is on for the tests that click the app's
// own buttons, which only exist in that markup.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, "..", "..", "roomcad", "web");

/// A canvas 2D context that draws nothing and remembers everything.
function makeContext() {
  const calls = [];
  const ctx = {
    calls,
    canvas: null,
    // Written by the editor; kept so a test can see what state a draw ran in.
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", lineCap: "butt",
    textAlign: "start", textBaseline: "alphabetic",
    measureText: text => ({ width: String(text).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
  };
  for (const name of [
    "save", "restore", "beginPath", "closePath", "moveTo", "lineTo", "arc", "arcTo",
    "rect", "fill", "stroke", "fillRect", "strokeRect", "clearRect", "fillText",
    "strokeText", "translate", "rotate", "scale", "setTransform", "resetTransform",
    "setLineDash", "clip", "ellipse", "quadraticCurveTo", "bezierCurveTo", "drawImage",
    "createLinearGradient", "createRadialGradient", "roundRect",
  ]) {
    ctx[name] = (...args) => {
      calls.push({ name, args });
      if (name.startsWith("create")) return { addColorStop() {} };
      return undefined;
    };
  }
  return ctx;
}

/// A `style` object that is both things the app needs it to be: arbitrary
/// properties, the way it sets them (`el.style.display = "none"`), AND the
/// methods it calls on the document element
/// (`style.setProperty("--sidebar-width", …)`). The bare `{}` this used to be
/// has no `setProperty`, and that — not anything about WebGPU — is what stopped
/// app.js being imported at all.
function makeStyle() {
  const props = new Map();
  const api = {
    setProperty(name, value) { props.set(name, String(value)); },
    getPropertyValue(name) { return props.has(name) ? props.get(name) : ""; },
    removeProperty(name) { const had = props.get(name) ?? ""; props.delete(name); return had; },
  };
  return new Proxy(api, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === "cssText") return [...props].map(([k, v]) => `${k}: ${v}`).join("; ");
      return props.has(key) ? props.get(key) : undefined;
    },
    set(target, key, value) {
      if (key in target) { target[key] = value; return true; }
      props.set(key, value);
      return true;
    },
  });
}

// ── A small HTML parser, and the selector matching that goes with it ───────
//
// Enough for this repository's own markup: tags, quoted attributes, comments
// and the void elements. index.html is hand-written and well formed, and the
// app's innerHTML comes from template literals in the same style, so this does
// not have to survive the open web. What it does have to do is put the REAL page
// in the stub, because the toolbar buttons are static markup in index.html and
// app.js binds their clicks by querying for them while it loads: a stub without
// the page leaves every one of those bindings unmade, so a click on a tool
// button did nothing and no test could tell.
//
// Selector support is deliberately the subset the app uses — a tag, #id,
// .class, [attr] and [attr="value"], and descendant chains of those, which is
// all index.html and app.js contain between them.

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);

function matchSimple(el, part) {
  const m = /^([a-zA-Z][\w-]*)?((?:[.#][\w-]+|\[[^\]]+\])*)$/.exec(part);
  if (!m) return false;
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  for (const piece of (m[2] || "").match(/[.#][\w-]+|\[[^\]]+\]/g) || []) {
    if (piece[0] === ".") {
      if (!el.classList.contains(piece.slice(1))) return false;
    } else if (piece[0] === "#") {
      if (el.id !== piece.slice(1)) return false;
    } else {
      const inner = piece.slice(1, -1);
      const eq = inner.indexOf("=");
      if (eq < 0) {
        if (!(inner in el.attributes)) return false;
      } else {
        const name = inner.slice(0, eq);
        const want = inner.slice(eq + 1).replace(/^["']|["']$/g, "");
        if (el.attributes[name] !== want) return false;
      }
    }
  }
  return true;
}

function matchesSelector(el, selector) {
  const parts = String(selector).trim().split(/\s+/).filter(Boolean);
  if (!parts.length || !matchSimple(el, parts[parts.length - 1])) return false;
  // Walk up, satisfying the earlier parts in order — a descendant combinator.
  let i = parts.length - 2;
  let node = el.parentNode;
  while (i >= 0 && node) {
    if (matchSimple(node, parts[i])) i--;
    node = node.parentNode;
  }
  return i < 0;
}

function parseHTML(html, doc) {
  const roots = [];
  const stack = [];
  const TOKEN_RE = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>|([^<]+)/g;
  let m;
  while ((m = TOKEN_RE.exec(html))) {
    if (m[0].startsWith("<!--")) continue;
    if (m[1]) {                                    // </tag>
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tagName === m[1].toUpperCase()) { stack.length = i; break; }
      }
      continue;
    }
    if (m[2]) {                                    // <tag …>
      const el = makeElement(m[2], doc);
      const ATTR_RE = /([\w:.-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
      let a;
      while ((a = ATTR_RE.exec(m[3] || ""))) {
        el.setAttribute(a[1], a[2] ?? a[3] ?? a[4] ?? "");
      }
      const parent = stack[stack.length - 1];
      if (parent) parent.appendChild(el); else roots.push(el);
      if (m[4] !== "/" && !VOID_TAGS.has(m[2].toLowerCase())) stack.push(el);
      continue;
    }
    if (m[5] && stack.length) {                    // text
      stack[stack.length - 1].textContent += m[5];
    }
  }
  return roots;
}

function makeElement(tag, doc) {
  const listeners = new Map();
  const el = {
    tagName: String(tag).toUpperCase(),
    id: "",
    value: "",
    type: "",
    textContent: "",
    innerHTML: "",
    disabled: false,
    hidden: false,
    style: makeStyle(),
    dataset: {},
    children: [],
    parentNode: null,
    listeners,
    // Zero by default. Only what a test sizes explicitly has a size, so a
    // stub element cannot accidentally look like a toolbar covering the screen
    // and squeeze the editor's usable area down to nothing.
    width: 0, height: 0,
    clientWidth: 0, clientHeight: 0,
    offsetWidth: 0, offsetHeight: 0,
    classList: {
      _set: new Set(),
      add(...c) { c.forEach(x => this._set.add(x)); },
      remove(...c) { c.forEach(x => this._set.delete(x)); },
      toggle(c, on) { const has = on === undefined ? !this._set.has(c) : !on; has ? this._set.delete(c) : this._set.add(c); },
      contains(c) { return this._set.has(c); },
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    /// Deliver an event to this element's handlers. Returns how many ran, so a
    /// test can tell "the editor ignored this" from "nothing was listening".
    /// Deliver an event to this element's handlers, then to its ancestors' —
    /// real DOM events bubble, and the app relies on it: the inspector attaches
    /// ONE click listener to its container and finds the button with
    /// `e.target.closest("button[data-action]")`, so without bubbling the
    /// listener fires and `e.target` is never a button. Returns how many ran.
    dispatch(type, event = {}) {
      const ev = makeEvent(type, event, el);
      let node = el;
      let ran = 0;
      while (node) {
        ev.currentTarget = node;
        for (const fn of (node.listeners.get(type) || []).slice()) { fn(ev); ran++; }
        if (ev._stopped) break;
        node = node.parentNode;
      }
      return ran;
    },
    getBoundingClientRect() {
      return {
        left: 0, top: 0, right: el.clientWidth, bottom: el.clientHeight,
        width: el.clientWidth, height: el.clientHeight, x: 0, y: 0,
      };
    },
    getContext: () => el._ctx || (el._ctx = makeContext()),
    setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
    focus() { doc.activeElement = el; },
    blur() { if (doc.activeElement === el) doc.activeElement = doc.body; },
    select() {},
    click() { el.dispatch("click", {}); },
    appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
    append(...cs) { cs.forEach(c => el.appendChild(c)); },
    removeChild(child) {
      const i = el.children.indexOf(child);
      if (i >= 0) el.children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    replaceChildren(...cs) { el.children = []; cs.forEach(c => el.appendChild(c)); },
    matches: sel => matchesSelector(el, sel),
    closest(sel) {
      let node = el;
      while (node) { if (matchesSelector(node, sel)) return node; node = node.parentNode; }
      return null;
    },
    contains(other) {
      let node = other;
      while (node) { if (node === el) return true; node = node.parentNode; }
      return false;
    },
    querySelectorAll(sel) {
      const out = [];
      const walk = node => {
        for (const child of node.children) {
          if (matchesSelector(child, sel)) out.push(child);
          walk(child);
        }
      };
      walk(el);
      return out;
    },
    querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
    setAttribute(name, value) {
      const v = String(value);
      el.attributes[name] = v;
      if (name === "id") el.id = v;
      else if (name === "class") el.className = v;
      else if (name === "value") el.value = v;
      else if (name === "type") el.type = v;
      else if (name === "hidden") el.hidden = true;
      else if (name === "disabled") el.disabled = true;
      else if (name.startsWith("data-")) {
        // data-foo-bar is dataset.fooBar, which is how the app reads the tool
        // and mode a button stands for.
        el.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
      }
      return v;
    },
    getAttribute(name) { return name in el.attributes ? el.attributes[name] : null; },
    hasAttribute: name => name in el.attributes,
    removeAttribute(name) { delete el.attributes[name]; },
    attributes: {},
    scrollIntoView() {},
  };
  // `class` and `innerHTML` are accessors rather than plain fields, so that
  // writing one keeps the other two views of the same thing in step: className
  // and classList are the same set, and innerHTML builds real children (which is
  // what makes the app's rendered buttons queryable and clickable at all).
  Object.defineProperty(el, "className", {
    get: () => [...el.classList._set].join(" "),
    set: value => { el.classList._set = new Set(String(value).split(/\s+/).filter(Boolean)); },
    enumerable: true,
  });
  let html = "";
  Object.defineProperty(el, "innerHTML", {
    get: () => html,
    set: value => {
      html = String(value);
      el.children = [];
      for (const child of parseHTML(html, doc)) el.appendChild(child);
    },
    enumerable: true,
  });
  if (doc._all) doc._all.push(el);
  return el;
}

function makeEvent(type, fields, target) {
  return {
    type,
    target,
    currentTarget: target,
    clientX: 0, clientY: 0,
    pointerId: 1, pointerType: "mouse",
    button: 0, buttons: 1,
    deltaY: 0, deltaX: 0, deltaMode: 0,
    shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
    key: "", code: "",
    isPrimary: true,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stopped = true; },
    stopImmediatePropagation() { this._stopped = true; },
    ...fields,
  };
}

/// Installs the globals editor2d.js reaches for, and hands back the handles a
/// test needs to drive it. Call `restore()` when done.
export function installDOM({ width = 1200, height = 800, dpr = 1, page = false } = {}) {
  const saved = {};
  const byId = new Map();
  const frames = [];
  // Every element this install ever creates, in creation order. The document
  // queries search THIS rather than the tree: the app's buttons are built by
  // assigning innerHTML and never attached to the document, so a tree-only
  // search would find none of them.
  const all = [];

  // Document-level listeners are RECORDED, not dropped. app.js wires its whole
  // keyboard interface on document, and a document whose addEventListener is a
  // no-op accepts those handlers and then never fires one — so every keyboard
  // behaviour looked wired and could not be tested, and a test could not tell
  // "the app ignored it" from "nothing was listening".
  const docListeners = new Map();
  const doc = {
    activeElement: null,
    hidden: false,
    _all: all,
    getElementById: id => {
      if (!byId.has(id)) byId.set(id, Object.assign(makeElement("div", doc), { id }));
      return byId.get(id);
    },
    createElement: tag => makeElement(tag, doc),
    createElementNS: (_ns, tag) => makeElement(tag, doc),
    querySelector: sel => all.find(el => matchesSelector(el, sel)) || null,
    querySelectorAll: sel => all.filter(el => matchesSelector(el, sel)),
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = docListeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    /// Deliver an event to document-level handlers, the way `dispatch` on an
    /// element works. Returns how many ran.
    dispatch(type, event = {}) {
      const list = (docListeners.get(type) || []).slice();
      const ev = makeEvent(type, event, doc);
      for (const fn of list) fn(ev);
      return list.length;
    },
    dispatchEvent(event) {
      const type = event && event.type;
      if (!type) return true;
      for (const fn of (docListeners.get(type) || []).slice()) fn(event);
      return true;
    },
  };
  doc.body = makeElement("body", doc);
  doc.documentElement = makeElement("html", doc);
  doc.activeElement = doc.body;

  let canvas = makeElement("canvas", doc);
  canvas.id = "plan-canvas";
  canvas.clientWidth = width;
  canvas.clientHeight = height;
  byId.set("plan-canvas", canvas);

  // The real page, when a test asks for it. Parsed AFTER the canvas so that the
  // page's own <canvas id="plan-canvas"> takes over its sizing — the element the
  // app will actually look up has to be the one with a size on it.
  if (page) {
    const html = readFileSync(join(webDir, "index.html"), "utf8");
    const roots = parseHTML(html, doc);
    const root = roots.find(el => el.tagName === "HTML") || roots[0];
    if (root) doc.documentElement = root;
    const body = root ? root.querySelector("body") : null;
    if (body) doc.body = body;
    for (const el of all) if (el.id) byId.set(el.id, el);

    const pageCanvas = byId.get("plan-canvas");
    if (pageCanvas && pageCanvas !== canvas) {
      pageCanvas.clientWidth = width;
      pageCanvas.clientHeight = height;
      pageCanvas.width = Math.round(width * dpr);
      pageCanvas.height = Math.round(height * dpr);
      canvas = pageCanvas;
    }
  }

  // In-memory localStorage, fresh per install so no test can read another's.
  // app.js persists the sidebar layout through it, and node only provides a
  // localStorage of its own when started with --localstorage-file — without
  // this, importing app.js throws before a single test can run. Declared before
  // `win`, which exposes it as a property.
  const localStore = new Map();
  const localStorage = {
    getItem: k => (localStore.has(String(k)) ? localStore.get(String(k)) : null),
    setItem: (k, v) => { localStore.set(String(k), String(v)); },
    removeItem: k => { localStore.delete(String(k)); },
    clear: () => localStore.clear(),
    key: i => [...localStore.keys()][i] ?? null,
    get length() { return localStore.size; },
  };

  const winListeners = new Map();
  const win = {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: dpr,
    document: doc,
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = winListeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatch(type, event = {}) {
      const list = (winListeners.get(type) || []).slice();
      const ev = makeEvent(type, event, win);
      for (const fn of list) fn(ev);
      return list.length;
    },
    /// The DOM's own name for it. `dispatch` above is this file's helper, which
    /// synthesises the event from a plain object; app.js calls the real API with
    /// an Event it built itself, and that has to reach the same listeners.
    dispatchEvent(event) {
      const type = event && event.type;
      if (!type) return true;
      for (const fn of (winListeners.get(type) || []).slice()) fn(event);
      return true;
    },
    localStorage,
    getSelection: () => ({ rangeCount: 0, removeAllRanges() {}, addRange() {}, toString: () => "" }),
    scrollTo() {}, scrollBy() {},
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    cancelAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    alert() {}, confirm: () => true, prompt: () => null,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  };

  class ResizeObserverStub {
    constructor(fn) { this.fn = fn; }
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  // The live-collaboration channel. app.js opens one per watched room and reads
  // events off it, and without the global it threw inside watchRoom — caught and
  // logged, so the app carried on with the live feature quietly dead. Recording
  // the connections makes that path inspectable instead of invisible.
  class EventSourceStub {
    constructor(url) {
      this.url = String(url);
      this.readyState = 0;
      this.closed = false;
      this.listeners = new Map();
      EventSourceStub.opened.push(this);
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    removeEventListener(type, fn) {
      const list = this.listeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }
    /// Deliver a server event, the way a real stream would. Both ways of
    /// listening count: app.js assigns `eventSource.onmessage`, and
    /// addEventListener is the other form the platform offers.
    emit(type, data) {
      const direct = this["on" + type];
      const list = (this.listeners.get(type) || []).slice();
      if (typeof direct === "function") direct({ type, data });
      for (const fn of list) fn({ type, data });
      return list.length + (typeof direct === "function" ? 1 : 0);
    }
    close() { this.closed = true; this.readyState = 2; }
  }
  EventSourceStub.opened = [];
  EventSourceStub.last = () => EventSourceStub.opened[EventSourceStub.opened.length - 1] || null;

  for (const [k, v] of Object.entries({
    document: doc, window: win, ResizeObserver: ResizeObserverStub, EventSource: EventSourceStub,
    requestAnimationFrame: win.requestAnimationFrame,
    cancelAnimationFrame: win.cancelAnimationFrame,
    devicePixelRatio: dpr, getComputedStyle: win.getComputedStyle,
    alert: win.alert, confirm: win.confirm, prompt: win.prompt,
  })) {
    saved[k] = globalThis[k];
    globalThis[k] = v;
  }
  // localStorage is set WITHOUT reading whatever is already there. Node defines
  // one as a lazy accessor that prints an ExperimentalWarning the moment it is
  // touched, and the bookkeeping above touches every global it saves — so the
  // warning appeared on every install. Treated as absent, so restore() deletes
  // it; a test that needs the real thing can put it back itself.
  saved.localStorage = undefined;
  globalThis.localStorage = localStorage;

  return {
    document: doc,
    window: win,
    canvas,
    EventSource: EventSourceStub,
    /// Runs whatever the editor scheduled for the next frame. The editor
    /// batches redraws, so a test that wants to see a draw has to let one run.
    flushFrames(limit = 20) {
      let ran = 0;
      for (let i = 0; i < limit && frames.length; i++) {
        const batch = frames.splice(0, frames.length);
        for (const fn of batch) { fn(16.7 * ++ran); }
      }
      return ran;
    },
    pendingFrames: () => frames.length,
    drawCalls: () => (canvas._ctx ? canvas._ctx.calls : []),
    clearDrawCalls() { if (canvas._ctx) canvas._ctx.calls.length = 0; },
    restore() {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete globalThis[k];
        else globalThis[k] = v;
      }
    },
  };
}
