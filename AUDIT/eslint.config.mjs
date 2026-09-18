// RoomCAD audit — ESLint flat config.
//
// This is the audit's lint configuration, NOT the application's build. The app
// deliberately has no package.json and no bundler; this file is run by
// `AUDIT/gates.sh` against the app's source using the toolchain pinned in
// AUDIT/package.json.
//
// Rule choice: bug-shaped rules only. Formatting, naming and layout belong to
// Prettier and are not re-litigated here. `security/detect-object-injection` is
// deliberately not enabled — it fires on every `obj[key]` in an untyped codebase
// and is a false-positive generator, not a check.
//
// Vendored code under roomcad/web/lib/ is excluded, because it is third-party,
// SHA-256-pinned and Tier C by §2.4, not because a finding there was inconvenient.

import globals from "globals";
import security from "eslint-plugin-security";
import noUnsanitized from "eslint-plugin-no-unsanitized";

const BUG_RULES = {
  // ── things that are always wrong ─────────────────────────────────────────
  "no-undef": "error",
  // `argsIgnorePattern: "^_"` matches `varsIgnorePattern`, so a deliberately
  // unused parameter (e.g. the retained `_cx`/`_cz` in city.js's traffic-signal
  // signature) can be marked by name instead of disabling the rule for the line.
  "no-unused-vars": [
    "error",
    { args: "after-used", argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
  ],
  "no-unreachable": "error",
  "no-dupe-keys": "error",
  "no-dupe-args": "error",
  "no-dupe-class-members": "error",
  "no-dupe-else-if": "error",
  "no-cond-assign": ["error", "except-parens"],
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-empty": ["error", { allowEmptyCatch: false }],
  "no-fallthrough": "error",
  "no-func-assign": "error",
  "no-invalid-regexp": "error",
  "no-irregular-whitespace": "error",
  "no-obj-calls": "error",
  "no-sparse-arrays": "error",
  "no-unsafe-negation": "error",
  "no-unsafe-optional-chaining": "error",
  "no-unexpected-multiline": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
  "getter-return": "error",
  "for-direction": "error",
  "no-compare-neg-zero": "error",
  "no-constant-binary-expression": "error",
  "no-class-assign": "error",
  "no-const-assign": "error",
  "no-import-assign": "error",
  "no-setter-return": "error",
  "no-this-before-super": "error",
  "no-new-native-nonconstructor": "error",
  "no-control-regex": "error",
  "no-misleading-character-class": "error",
  "no-global-assign": "error",
  "no-ex-assign": "error",
  "no-inner-declarations": "error",
  "no-loss-of-precision": "error",
  "no-unsafe-finally": "error",
  "no-self-assign": "error",
  "no-self-compare": "error",
  "no-useless-call": "error",
  "no-useless-concat": "error",
  "no-useless-backreference": "error",
  "no-useless-rename": "error",
  "no-useless-return": "error",
  "no-new-symbol": "error",
  "no-new-object": "error",
  "no-array-constructor": "error",
  "no-delete-var": "error",
  "no-shadow-restricted-names": "error",
  // `no-eq-null` is deliberately NOT enabled: it contradicts `eqeqeq: ["error",
  // "smart"]` below, which permits `x == null` as the idiomatic "null or
  // undefined" check. All 9 findings were that idiom.
  "object-shorthand": ["error", "properties"],
  "prefer-const": "error",

  // ── equality and coercion ────────────────────────────────────────────────
  eqeqeq: ["error", "smart"],
  "no-implicit-coercion": "off",

  // ── async / promises ─────────────────────────────────────────────────────
  "no-async-promise-executor": "error",
  "no-promise-executor-return": "error",
  "no-return-await": "error",
  // Off by decision, not suppressed. The 9 findings are all `store.x = value`
  // (and `appState.x = value`) after an `await` in an async UI handler. `store`
  // and `appState` are module singletons that are never reassigned, and every
  // write is a plain last-write-wins assignment in a single-threaded event loop.
  // No read-modify-write spans an await, so the rule's premise — a stale read
  // carried across an await — does not hold here. This is a genuinely wrong
  // check for this codebase, recorded as AUDIT ledger task T0048.
  "require-atomic-updates": "off",
  "no-await-in-loop": "off",

  // ── error handling ───────────────────────────────────────────────────────
  "no-throw-literal": "error",

  // ── injection primitives ─────────────────────────────────────────────────
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
  "no-script-url": "error",
  "no-with": "error",
  "no-proto": "error",
  "no-extend-native": "error",

  // ── real security rules from eslint-plugin-security ──────────────────────
  "security/detect-eval-with-expression": "error",
  "security/detect-unsafe-regex": "error",
  "security/detect-buffer-noassert": "error",
  "security/detect-child-process": "error",
  "security/detect-disable-mustache-escape": "error",
  "security/detect-new-buffer": "error",
  "security/detect-no-csrf-before-method-override": "error",
  "security/detect-possible-timing-attacks": "error",
  "security/detect-pseudoRandomBytes": "error",
  "security/detect-bidi-characters": "error",

  // ── innerHTML built from anything but a literal ──────────────────────────
  // `esc` is this codebase's escape function (app/ui.js), declared here so the
  // rule does not have to guess. A built-in `esc` call is accepted; a raw
  // interpolation into innerHTML is not.
  "no-unsanitized/method": "error",
  // Severity `warn`, on the record. The rule only accepts an escaping method
  // that wraps the ENTIRE assigned expression; this codebase escapes each
  // interpolation individually (`innerHTML = `...${esc(name)}...``), which is
  // safe but invisible to the rule. It flagged exactly 12 sites (files.js,
  // status.js, view.js, editor2d/coords.js); every interpolation at all 12 is
  // `esc()`-wrapped or is a number/boolean, verified by a human XSS pass that
  // fuzzed room names and label text with `</text><script>`, attribute-breaking
  // quotes and ampersands. Recorded as AUDIT ledger task T0049. The waiver is
  // compensated by tests/audit-xss.test.mjs, a source contract that re-checks
  // every interpolation at those sites rather than trusting this comment.
  "no-unsanitized/property": ["warn", { escape: { methods: ["esc"] } }],
};

const PLAIN_RULES = {
  "no-var": "error",
  "no-redeclare": "error",
  "no-shadow": "off", // shadowing is the linter's opinion, not a defect class we count
};

export default [
  {
    // Vendored, SHA-256-pinned third-party code (Tier C, §2.4). Not read by a
    // human and not linted as ours.
    ignores: ["roomcad/web/lib/**", "node_modules/**", "AUDIT/node_modules/**"],
  },
  {
    files: ["roomcad/web/**/*.js"],
    plugins: { security, "no-unsanitized": noUnsanitized },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.worker },
    },
    rules: { ...BUG_RULES, ...PLAIN_RULES },
  },
  {
    files: ["tests/**/*.mjs", "tests/**/*.js"],
    plugins: { security, "no-unsanitized": noUnsanitized },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...BUG_RULES,
      ...PLAIN_RULES,
      // Two rule scopes are adjusted for the Node test harness and nothing else.
      // This is a rule-domain decision, recorded as AUDIT ledger task T0048-adjacent
      // (see tool-coverage.md), NOT a suppression of a finding:
      //
      //  * `no-unsanitized/method` is a DOM-sink rule (innerHTML/insertAdjacentHTML/
      //    document.write). It also flags dynamic `import()`, which the test harness
      //    uses deliberately to load a module from a `data:` URL so that reloading it
      //    gives a SECOND module instance — the very thing tests/live-multi.test.mjs
      //    needs. There is no DOM and no untrusted string in that path.
      //  * `no-new-func` is the documented `new Function` lifting pattern in
      //    AGENTS.md ("The older tests that lift app.js functions with `new Function`
      //    still work"). The code it compiles is this repository's own source text.
      //
      // Both stay at `error` for roomcad/web, where they are real checks.
      "no-unsanitized/method": "off",
      "no-new-func": "off",
      // `security/detect-unsafe-regex` is reported as a warning here, on the
      // record, for three patterns in tests/harness/dom-stub.mjs: the selector
      // splitter (line 100), the HTML tokenizer (139) and the attribute reader
      // (151). Each was read and each is LINEAR for its input, not catastrophic:
      // the rule's heuristic is star-height > 1, and every nested repetition here
      // is anchored and/or disjoint by first character, so it backtracks once per
      // character rather than exponentially. The input is this repository's own
      // index.html and test-built HTML — never an untrusted or unbounded string —
      // and a DOM stub is not a production path. Recorded as ledger task T0051
      // rather than silenced, and it remains `error` for roomcad/web.
      "security/detect-unsafe-regex": "warn",
    },
  },
  {
    files: ["AUDIT/**/*.mjs"],
    plugins: { security, "no-unsanitized": noUnsanitized },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: { ...BUG_RULES, ...PLAIN_RULES },
  },
];
