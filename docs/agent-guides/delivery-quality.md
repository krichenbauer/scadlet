# Delivery and quality

Read this before changing dependencies, build/tooling, deployment, runtime
resources, error handling, or test setup.

## Static, private distribution

SCADlet is fully client-side and deploys as ordinary static files. It has no
application backend and must remain hostable on GitHub Pages, ordinary web
servers, or static/object hosting. GitHub Pages deploys `main` via
`.github/workflows/deploy-pages.yml`; preserve Vite's `/` `BASE_PATH` default
for development and non-GitHub hosting.

Runtime resources must ship with the application. Do not add CDN JavaScript,
external fonts/icons, analytics, trackers, or third-party runtime APIs.
Normal use needs no network after the application loads.
The license is GPL-3.0-or-later. New dependencies must be GPL
compatible, retain required notices, and have clear licensing.

## Development and tests

Use the repository Nix flake/devShell for system tools and pnpm for JavaScript
dependencies. Put system tools in `flake.nix` and application dependencies in
`package.json`; do not require global project packages.

`openscad-wasm-prebuilt` loads only in the render Worker. Keep it in Vite
`optimizeDeps.include` unless the import arrangement changes: otherwise Vite
may discover it on first Render, reload the dev page, and lose unsaved work.
Browser persistence tests use Playwright (`pnpm test:e2e`) and the devShell
Chromium exposed by `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; generated browser
reports stay ignored. Playwright serves the production build through Vite
Preview, ensuring browser tests cover deployable bundled resources.

Every ordinary E2E test starts from its own Playwright browser context and
must establish the app, project, IndexedDB, storage, selection, and render
state it needs. Tests may run in any order or worker and never depend on a
previous test or a reused worker. Seeded projects and artifacts use test-owned
state; multiple pages may share a context only within one test that explicitly
verifies tab coordination. Repeated setup belongs in fixtures/helpers, not in
an earlier test.

Keep independent tests fully parallel. If assertions form one uninterrupted
stateful user journey, keep them in one `test(...)` and use `test.step(...)`
when subdivision improves reporting. `test.describe.serial(...)` is reserved
for a narrowly documented case that cannot be represented as one independent
test; serial tests still may not exchange browser or persistence state. Do not
use retries, reduced worker counts, or broad serialization to mask a race.
Before calling a failure flaky, reproduce it with `--repeat-each` under
parallel load and compare against the unchanged code, then fix its cause.

Wait for visible application state, persisted dirty-state completion, worker
idle state, or stable rendered bounds. Pointer-drag wiring waits for each new
connection to exist before the next gesture: nodes re-render after wiring, and
a stale socket position turns the next drag into a canvas pan. A fixed delay is acceptable only when
the passage of a specified interval is itself the behavior under test, such as
proving that no preview occurs inside/outside the documented debounce window.
Worker-repeat diagnostics must use test-owned output paths. Retain failure
traces, screenshots, videos, browser errors, generated source, render errors,
and persistence status where available.

Changes need focused coverage of their semantic and user-visible boundaries:
catalog/types, generated source, scope safety, connection preservation,
persistence/restore, and interaction as applicable. Geometry and recursion
regressions must exercise bundled OpenSCAD-WASM and the preview/export route;
JavaScript evaluation is not a substitute. Cover keyboard, pointer, focus,
accessible names/status, and touch behaviour for changed interactions, including
cross-shadow-root popup dismissal. The configured browser suite is Chromium;
do not describe it as certified coverage of other browsers.

For a behaviour-preserving refactoring, first add characterization tests that
pass against the unchanged code, especially for paths no test covers yet.
Existing tests stay unchanged unless a change genuinely makes sense (for
example a test that only restates removed internals); otherwise a failing
existing test signals an unintended behaviour change. A behaviour fix gets a
test that fails on the old code.

## Required checks and completion report

Inside `nix develop`, install with `pnpm install`; use `pnpm dev` to develop and
`pnpm preview` to inspect a production build. On macOS, where the devShell does
not supply Chromium, use `pnpm exec playwright install chromium` if needed.

Run all of these for completion, including documentation-only changes:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm test:e2e
git diff --check
```

There is no separate Markdown lint or link-check script. For documentation
changes, follow local links and heading references, review for stale or
duplicated contracts, and run the documentation-fixture tests included in
`pnpm test`. Those tests validate referenced fixture files and the catalog
list extracted from the specification and its current envelope example; they
do not certify prose or links.

Report changed files, resulting behaviour or documentation ownership, relevant
compatibility decisions, and the exact result of each required check. Identify
unresolved defects and environmental blockers separately. A failed, interrupted,
skipped, or uncertified check is not a pass; investigate failures and retain
evidence. Do not alter tests to endorse inaccurate documentation or hide flakes.

## Implementation quality

Prefer strict TypeScript, small modules, explicit types at architectural
boundaries, browser-native APIs, and comments explaining non-obvious reasons.
Avoid `any`, hidden global mutable state, needless dependencies, framework-like
abstractions, and speculative extensibility.

Errors must be understandable to learners. Invalid graph state must not crash
the app; surface OpenSCAD/WASM failures; retain the previous valid preview when
practical; prevent or clearly report malformed connections. Do not silently
swallow errors. Detailed source-to-node diagnostics remain later work.

Valid empty Geometry follows [the worker contract](architecture.md#program-and-render-flow),
including its narrow diagnostic classification and informational preview UI.
