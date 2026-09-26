# Delivery, quality, and operating constraints

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
Top-level `examples/example_*.scadlet` templates are eager raw Vite imports,
not separately fetched public assets, so GitHub Pages and other production
builds include every matching example in the application bundle.

The intended license is GPL-3.0-or-later. New dependencies must be GPL
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

Wait for visible application state, persisted dirty-state completion, worker
idle state, or stable rendered bounds. A fixed delay is acceptable only when
the passage of a specified interval is itself the behavior under test, such as
proving that no preview occurs inside/outside the documented debounce window.
Worker-repeat diagnostics must use test-owned output paths. Retain failure
traces, screenshots, videos, browser errors, generated source, render errors,
and persistence status where available.

Recursion regressions must exercise direct and mutual Function/Module source
through the bundled OpenSCAD-WASM. Do not substitute JavaScript evaluation or
assume OpenSCAD declaration-order behavior without a real runtime check.
Scope-level SCAD settings regressions must cover the normal generated-source,
WASM preview, and `.scad` export route so no alternate render-option path can
silently diverge from exported code.
Numeric For regressions must cover the fixed pair lifecycle, iterator lexical
boundary, nested Main/Module source, persistence rejection, and the normal
WASM preview/export path; JavaScript must never evaluate the range itself.
Directional-connector browser regressions must cover output-origin creation,
input-origin pointer/touch/keyboard no-ops, output-origin replacement of an
occupied input, wire selection/removal, representative static and dynamic
ports, accessible source/target descriptions, retained type colours and
compact bounds, and the visual/behavioral separation of fixed `For` anchors.
Transient-popup browser coverage must cross the application, graph-editor,
and viewer shadow roots, including outside pointer/wheel interactions, popup
switching, inside controls, Escape focus restoration, and expanded-state
cleanup without altering hover tooltips or modal dialogs.

## Implementation quality

Prefer strict TypeScript, small modules, explicit types at architectural
boundaries, browser-native APIs, and comments explaining non-obvious reasons.
Avoid `any`, hidden global mutable state, needless dependencies, framework-like
abstractions, and speculative extensibility.

Errors must be understandable to learners. Invalid graph state must not crash
the app; surface OpenSCAD/WASM failures; retain the previous valid preview when
practical; prevent or clearly report malformed connections. Do not silently
swallow errors. Detailed source-to-node diagnostics remain later work.

A confirmed valid empty top-level Geometry result is the narrow exception to
render-error UI: clear the old preview and use the localized informational
preview status. This must not suppress arbitrary sparse diagnostics, compiler
errors, or worker failures.
