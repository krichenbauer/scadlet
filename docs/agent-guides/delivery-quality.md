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
Recursion regressions must exercise direct and mutual Function/Module source
through the bundled OpenSCAD-WASM. Do not substitute JavaScript evaluation or
assume OpenSCAD declaration-order behavior without a real runtime check.
Scope-level SCAD settings regressions must cover the normal generated-source,
WASM preview, and `.scad` export route so no alternate render-option path can
silently diverge from exported code.
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
