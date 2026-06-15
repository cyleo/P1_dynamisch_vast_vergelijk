# Engineering Practices & Failure Modes

Hard-won rules for working in this repo without re-introducing solved bugs.
Read this alongside `CLAUDE.md` — that file covers the **domain** (the energy/tax
model); this one covers the **process** (how to change the code safely).

---

## The one rule that matters most

**Green node tests do NOT mean the app works.** The validation harness stubs
`addEventListener` and never runs the `DOMContentLoaded` handler; `test17`'s
Proxy-global returns `undefined` for free variables instead of throwing. So a
boot crash — e.g. calling an undefined function in `setupEventListeners`, or an
esbuild circular-import that silently drops a render function — **passes all
tests and ships a blank app**.

> Real example: `setupEventListeners()` called `initDismissHandlers()`, which was
> never defined. A `ReferenceError` aborted the entire boot handler before
> `loadDemoData()` ran → empty app, zero charts. All 18 node tests stayed green.
> Only a browser smoke test caught it.

→ **Browser-verify any change to the boot path, event wiring, charts, or the
`src/domain` / `src/ui` import graph.** The `boot-verifier` agent automates this.

---

## The second rule: totals-only tests miss interaction bugs

Most engine tests assert a **total** (`dynamicTotalBill`, `totalImportKwh`). A bug
that only surfaces in the *interaction between two features* can leave every total
plausible and still be wrong. Assert **invariants**, not just numbers.

> Real example: solar dimming mode `"uit"` (inverter fully off) pulled **all**
> consumption to the grid at any `spot < 0`. But at moderately negative prices the
> energy-tax floor keeps grid import positive, so free solar self-consumption is
> still cheaper — and with a solar-charging EV scheduled into those hours, `"uit"`
> made the bill *higher than doing nothing*. Logically impossible, invisible to
> every totals-only test, found only by manual testing. Fix: remove
> self-consumption only when the all-in import price itself goes negative
> (`spot + markup + eb < 0`). Guarded by `test13` **C3**, which asserts the
> invariant `bill("uit") ≤ bill("off")` *with an EV enabled* — exactly the
> interaction the totals missed.

→ **When a fix touches how two features combine (dimming×EV, battery×HP/EV,
WP×solar), add an invariant assertion** ("feature X must never make the bill
worse than X off", "adding capacity must never reduce savings"), not just a new
expected total. The "characterize before refactoring" rule below covers *shape*;
this covers *direction*.

---

## Pre-commit checklist (in order)

1. `npm run build` succeeds.
2. **Bundle canary:** `node _validate/bundle_canary.js` — confirms render-critical
   functions survived bundling (see esbuild trap below). Wired into `npm test`.
3. `npm test` — all green. (The harness now **auto-builds the bundle** before
   loading it — `run_tests.js` builds once and sets `BUNDLE_FRESH=1`; a direct
   `node _validate/testX.js` rebuilds on its own. So tests can never run against a
   stale `app.js` — a foot-gun that previously made bug-injection look "green".)
4. `npm run lint` — **0 errors** (warnings are tracked incremental cleanup).
5. Browser smoke test if you touched the boot path, event wiring, charts, or any
   `src/domain` / `src/ui` import.
6. Bump `?v=N` on the `app.js`/`style.css` tags in `index.html` for any change to
   `app.js` or `index.html` (defeats browser cache).
7. `CLAUDE.md` / `README.md` in sync with the new behaviour.

---

## Three traps that cost real time

### 1. Store-mirror desync (bug B1)
The `let` bindings at the top of `src/app.js` (`liveEnergyTax`, `energyData`,
`activeSimulation`, …) are **READ-ONLY reflections** of `appStore`. They are
updated in exactly one place: the `subscribe()` callback. The engine
(`buildSimContext` in `engine.js`) reads its values **straight from the store**,
not from these mirrors.

> A bare `liveEnergyTax = parseFloat(...)` updates the mirror (so app.js reads
> look right) but leaves the store stale → the engine keeps the old value. That
> was B1: dragging the energy-tax slider changed nothing on the bill.

**Rule:** mutate state ONLY via `appStore.setState({ … })`. Never bare-assign a
mirror. This is now enforced by a custom ESLint rule (`no-restricted-syntax` on
the engine-read mirrors in `src/app.js`); the legitimate `state.X` reassignments
in `subscribe()` and `__setTestState` are exempt.

### 2. esbuild circular import drops functions
esbuild bundles `src/` into one flat IIFE in root `app.js`. A circular import in
`src/domain` or `src/ui` can perturb esbuild's symbol resolution so that
**same-named functions in *other* modules silently disappear** from the bundle.

> Real example: adding `import { getFallbackSpot } from "./engine.js"` to
> `energyMath.js` (engine already imports energyMath → cycle) dropped
> `renderChart` and `_updateSimHeader` from `charts.js` → `ReferenceError` at
> render. It compiled. All node tests passed.

**Rule:** don't add an import that creates a cycle. Cross-module free symbols
(like `getFallbackSpot`) are reachable via the hoisted bundle scope — lean on
that. The `bundle_canary.js` test fails the build if a render function vanishes.

### 3. Bulk-format hides logic diffs
Never run `prettier --write .` in a commit that also changes logic — 30+ files of
whitespace churn buries the real diff. **Format in its own dedicated commit.**

---

## Refactor / optimize discipline

- **Characterize before refactoring.** Prove byte-identical output against
  `_validate/snapshot_golden.json` (`test15`) before *and* after. The
  `_simulateCore` decomposition was proven byte-identical this way before any
  behavioural change.
- **Measure before optimizing.** `runSimulation()` is ~19 ms: **~14 ms SVG
  rendering (74%, main-thread, non-offloadable)** and only ~5 ms engine compute.
  A Web Worker was measured and **rejected** — it addresses the wrong bottleneck,
  and serializing the 8760-row dataset per tick would exceed the savings. The
  real lever, if needed, is render-side (only redraw the changed chart).
- **When extracting a function to a module, carry its JSDoc/block comment with
  it.** Leaving the comment behind orphans domain knowledge in `app.js`.

---

## Privacy invariant

`.gitignore` blanket-ignores `*.csv` and `*.json` — a deliberate guard for
personal energy-consumption exports (`energy-3.csv`, `p1_sample.json`,
`home_assistant_export.csv`). Only build essentials are exception-listed
(`!package.json`, `!package-lock.json`). **Never un-ignore a data fixture to make
a test pass** — `test15` already skips itself when the local privacy fixture is
absent.

---

## House style (owner preferences)

- **Validate domain/tax claims against real 2027 sources**, not assumptions or
  training-data memory.
- **Present 2–3 options before building** a non-trivial feature; let the owner pick.
- **Minimal emoji.** Use inline SVG icons (`src/ui/icons.js`), not emoji — it
  should not read as AI-generated.
- **Targeted edits, never whole-file rewrites.** Provide specific snippets.
- **No external chart/UI libraries.** All charts are hand-rolled SVG (zero deps).

---

## Verifier agents

Two read-only project agents encode the lessons above (`.claude/agents/`):

- **`boot-verifier`** — builds, runs the canary, loads the app in a browser, and
  asserts it boots + renders. Use after any boot-path/chart/import change.
- **`domain-verifier`** — audits every €/kWh path against the 2027 rules after a
  change to `engine.js` / `energyMath.js` / `constants.js`.

The "manager" is the primary agent following a fixed contract:
**implement → build → canary → `boot-verifier` → `domain-verifier` (if engine math
changed) → only then report done.**
