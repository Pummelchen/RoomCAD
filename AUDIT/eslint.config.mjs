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
  // The findings this rule used to report (9 assignments to the store/appState
  // singletons after an await) were removed by the T0018/T0019/T0020/T0039
  // restructuring, which moved the post-await state into one place. The rule is
  // back on and reports nothing; see AUDIT ledger T0048.
  "require-atomic-updates": "error",
  "no-await-in-loop": "error",

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
  // Two escapers are declared, both real functions in app/ui.js:
  //   * `esc(value)`  — used when a single value is interpolated by hand;
  //   * `safeHtml`    — a tagged template that escapes every raw interpolation
  //                     itself. It is the preferred form, because it cannot be
  //                     forgotten at a site the way a hand-written `esc()` can.
  // A value that `safeHtml` itself produced (a SafeHtml marker) passes through
  // untouched, which is how one builder's output composes into another's.
  // Nothing else is trusted: an untagged `innerHTML = `...${x}...`` is still an
  // error, and so is `innerHTML = someVariable`.
  "no-unsanitized/property": [
    "error",
    { escape: { methods: ["esc"], taggedTemplates: ["safeHtml"] } },
  ],
  // `import()` is one of this rule's default checks, because in a browser
  // importing a URL built from untrusted input is a code-loading sink. It is
  // correct for production (the web block below keeps the defaults) and
  // meaningless in the Node test harness, where `import()` of a repository path
  // is the module system. The tests block therefore disables the defaults and
  // re-enables every real DOM sink explicitly — so `insertAdjacentHTML`,
  // `createContextualFragment`, `document.write` and `setHTMLUnsafe` are still
  // checked in tests; only the import pseudo-sink is dropped there.
  "no-unsanitized/method": "error",
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
      // The one rule whose DOM-sink list is narrowed for the Node harness. See
      // the note on `no-unsanitized/method` above: `import()` is a browser
      // code-loading sink and a Node module loader, so the tests block disables
      // the defaults and re-enables every DOM sink by hand. Nothing here is a
      // severity waiver — the rule stays at `error` and still catches all four
      // DOM sinks in tests.
      "no-unsanitized/method": [
        "error",
        { defaultDisable: true },
        {
          insertAdjacentHTML: { properties: [1] },
          createContextualFragment: { properties: [0] },
          write: { objectMatches: ["document"], properties: [0] },
          writeln: { objectMatches: ["document"], properties: [0] },
          setHTMLUnsafe: { properties: [0] },
        },
      ],
      // `no-await-in-loop` is a performance rule: a serial await per iteration is
      // how an N+1 creeps into production. It stays at `error` for `roomcad/web`
      // (which is clean) and is off here, because every use in the suite is a
      // poll-until-condition loop — `while (Date.now() < until) { …; await sleep(5) }`
      // — where the await IS the loop and serialising is the point. There is no
      // form of that loop the rule accepts, and parallelising it would change what
      // the test means.
      "no-await-in-loop": "off",
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
