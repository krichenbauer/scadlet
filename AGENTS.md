**# SCADlet — Agent Instructions**

**## Project purpose**

SCADlet is an open-source, browser-based visual programming environment for OpenSCAD.

Its primary goal is educational: make functional programming concepts approachable for pupils and early university students by representing programs as node graphs that generate and transform 3D geometry.

The node graph is the primary programming interface. OpenSCAD is the target language and geometry engine.

Priorities, in order:

1. Clear, learnable visual representation of functional programming concepts.

2. Geometry-first interaction and immediate visual results.

3. A fully client-side browser application.

4. Clean OpenSCAD export.

5. Simple, maintainable architecture.

6. Desktop/laptop browser UX first; touch/iPad support is desirable but secondary.

7. Full OpenSCAD language compatibility is not required if it conflicts with clarity.

Do not turn SCADlet into a generic CAD system or a generic visual programming framework unless explicitly requested.

**---**

**## Current architecture**

Use this stack unless a task explicitly changes an architectural decision:

- TypeScript

- Vite

- Lit for application-level UI and Web Components (the app shell, toolbar,

  and other chrome around the node editor)

- Rete.js for the node graph's structure, sockets/connections, and dataflow

  evaluation; rendering of nodes/connections inside the editor canvas is a

  custom DOM renderer (see "Node editor rendering" below), not

  `rete-lit-plugin`

- OpenSCAD WASM for OpenSCAD execution and mesh generation, currently integrated locally through `openscad-wasm-prebuilt`

- Three.js for the interactive 3D viewer

- pnpm for JavaScript package management

- Nix flake/devShell for the development environment

Do not introduce React, Vue, Angular, Svelte, or another application framework without an explicit architectural decision.

**### Node editor rendering**

Rete is the source of truth for graph structure and dataflow, but its

official Lit render plugin (`rete-lit-plugin`) is ****not**** used and should

not be reintroduced without a documented reason: its published build is

compiled against a legacy Babel decorator runtime that is incompatible

with Lit 3's decorator implementation.

Instead, `src/editor/render.ts` is a small, intentional, hand-written DOM

renderer:

- It subscribes to Rete's own area render/connection/socket signals

  (`area.addPipe`) to create and update plain DOM elements for nodes,

  controls, ports, and connections.

- It uses `rete-render-utils` (`getDOMSocketPosition` for live socket

  position tracking, `classicConnectionPath` for the connection curve) —

  the same low-level utilities the official React/Vue/Svelte Rete render

  plugins build on internally.

- Connections are drawn as SVG `<path>` elements sized to their own

  start/end bounding box, and stay in sync as nodes move or a new

  connection is dragged.

This is the current, intended rendering architecture, not a temporary

workaround. New node types should follow the existing patterns in

`render.ts`/`controls.ts` (e.g. dynamic control add/remove plus

`area.update('node', id)` for progressive disclosure) rather than

introducing a second rendering approach or resurrecting

`rete-lit-plugin`.

Lit still owns the surrounding application UI (`<scadlet-app>`,

`<node-editor>`, toolbar, panels); it does not render individual nodes or

connections.

**### Data flow**

The intended data flow is:

```text

Rete node graph

      ↓

Rete dataflow evaluation

      ↓

OpenSCAD source string

      ├────────────→ .scad download

      ↓

Render button

      ↓

Web Worker

      ↓

OpenSCAD WASM

      ↓

STL ArrayBuffer

      ├────────────→ .stl download

      ↓

Three.js viewer

```

Keep this direction simple. Do not make the Three.js viewer part of the semantic graph and do not use the viewer as a source of model state.

**---**

**## Rete responsibilities**

Rete is currently intended to be the source of truth for the program graph.

Use Rete for:

- nodes

- ports

- connections

- graph structure

- node-editor interaction

- graph evaluation/dataflow

Do not create a second parallel graph/AST model unless there is a demonstrated need and the architectural change is discussed first.

Rete does not know OpenSCAD semantics automatically. SCADlet node implementations are responsible for producing appropriate OpenSCAD fragments during graph evaluation.

Conceptually:

```text

Cube node

→ cube(...);

Cylinder node

→ cylinder(...);

Difference node

→ difference() {

    <input geometry>

    <subtracted geometry>

  }

```

Prefer structured node implementations and reusable code-generation helpers over ad-hoc string concatenation scattered throughout UI components.

**---**

**## Node design principles**

Geometry is the primary data type and should dominate the visual language.

Initial node families include:

- primitives: cube, sphere, cylinder

- transformations: translate, rotate, scale

- Boolean operations: union, difference, intersection

- later: extrusion, hull, minkowski, mirror, resize, modules, iteration

- values/math exist to support geometry, not to dominate the graph

Cube, Cylinder, and Difference already exist and prove the pattern (a

geometry-producing primitive, a parameterized primitive with progressive

disclosure, and a composition node that combines connected inputs). The

remaining primitives/transforms/Boolean nodes above are not yet implemented.

**### Parameters**

Simple values should normally be editable directly inside geometry nodes.

Example:

```text

Cylinder

  radius: 5

  height: 20

```

Parameters may later also expose ports so their values can come from other nodes.

Avoid forcing users to create value nodes for every numeric literal.

**### Optional OpenSCAD parameters**

Use progressive disclosure.

Do not show every possible OpenSCAD parameter on every node by default. Show the common form first and let users enable additional options.

For mutually exclusive OpenSCAD forms, expose semantic modes rather than independent conflicting fields.

For example, a cylinder may offer:

- radius

- diameter

- different bottom/top radii

Only fields/ports relevant to the selected mode should be shown.

Optional advanced parameters such as `$fn`, `$fa`, and `$fs` should be hidden until enabled.

**### Code node**

A geometry-oriented OpenSCAD code node is planned for a later milestone as an escape hatch for constructs that are awkward to represent visually.

Do not use code nodes as a shortcut for ordinary geometry features that should have clear visual nodes.

**---**

**## OpenSCAD generation**

SCADlet should generate valid, reasonably readable OpenSCAD.

OpenSCAD source does not need to be user-editable in the UI. A plain

dev-only text panel currently shows the generated source for verification

during development; this is not a code editor and is not a UI requirement

in itself.

Required initial behavior:

- evaluate the Rete graph

- produce an OpenSCAD source string

- allow that source to be downloaded as `.scad`

- pass the same source to OpenSCAD WASM for rendering

The preview and exported OpenSCAD must derive from the same generated source.

Do not introduce a second geometry implementation such as JSCAD or replicad for preview generation. Avoid any architecture where preview semantics can differ from exported OpenSCAD semantics.

Importing existing `.scad` source is not currently a requirement.

**---**

**## OpenSCAD WASM and rendering**

Run OpenSCAD WASM in a Web Worker.

Current rendering behavior:

- `Render` is the single normal evaluation/render action: it evaluates the graph, generates the current OpenSCAD source, updates the development source display, sends the source to the worker, generates STL, and updates the viewer.

- There is no separate user-facing `Evaluate OpenSCAD` action. Do not reintroduce one unless the interaction model is deliberately changed.

- The worker persists across successful renders, but each render creates a fresh OpenSCAD/WASM instance. Reusing a single `createOpenSCAD()` instance across multiple `callMain()` invocations is not supported reliably by the current build and must not be assumed safe.

- `Stop` terminates the active worker. A later Render recreates a clean worker.

- The current OpenSCAD WASM build uses the Manifold backend (`--backend=Manifold`) and binary STL output (`--export-format=binstl`). This is an intentional performance baseline: Boolean operations involving moderately/highly tessellated geometry were dramatically slower with the previous CGAL/Nef path, while binary STL also reduces serialization and transfer overhead.

- Do not silently lower explicit geometry detail such as `$fn` to improve speed. Normal Render and exported OpenSCAD must preserve user-requested semantics.

- Development timing logs may measure evaluation, worker/WASM, geometry, output, and viewer phases. They are diagnostic only and must not become semantic application state or telemetry.

Do not add automatic live rendering, debounce logic, render queues, multiple render workers, or complex cancellation unless requested later.

Keep expensive OpenSCAD execution off the main UI thread.

Do not introduce a second geometry implementation for a faster preview. Three.js remains a viewer, not an alternate evaluator/modeling engine.

**---**

**## Three.js viewer**

Three.js is used as a mesh viewer, not as the modeling engine.

The viewer accepts the STL generated by OpenSCAD WASM directly from memory as an `ArrayBuffer` through `STLLoader`.

Current viewer behavior includes:

- orbit/rotate

- zoom

- pan

- mouse controls

- basic touch controls

- grid

- axes

- fit model to view

- sensible camera defaults

- camera preserved across re-renders

- an OpenSCAD-consistent **Z-up** coordinate convention

OpenSCAD's coordinate system is authoritative. The viewer must keep Z as the vertical/up axis and the grid in the XY plane. Do not rotate generated OpenSCAD/STL geometry merely to compensate for Three.js defaults; coordinate-system adaptation belongs in the viewer layer.

When a new mesh is rendered, replace the mesh while preserving the existing scene, controls, and user's camera/view where practical.

Do not introduce Babylon.js, `<model-viewer>`, React Three Fiber, or a specialized STL viewer wrapper without a concrete reason.

**---**

**## UI architecture**

Use Lit and normal Web Components for application-level UI.

Current/likely component boundaries include concepts such as:

```text

<scadlet-app>

<node-palette>

<node-editor>

<geometry-viewer>

<app-toolbar>

<property-panel>

```

These names are illustrative except where components already exist.

Keep semantic graph logic out of Lit rendering code where practical.

Prefer browser-native controls and behavior over custom reimplementations.

The main workspace uses resizable panes. Resizing must not recreate the Rete editor or Three.js scene; container-size changes should be handled by the existing components while preserving graph state, viewport state, and camera state.

Node selection/deletion is part of the editor interaction baseline:

- Rete remains the source of truth for selection and graph removal; do not introduce a parallel selected-node model.

- plain node click selects that node; Ctrl/Cmd-click adds/removes individual nodes from the current selection

- Shift-drag on empty canvas creates a marquee selection rectangle; plain drag on empty canvas continues to pan

- dragging one node from an existing multi-selection moves the full selected set together through Rete's selection/translation machinery, preserving relative positions and updating connections continuously

- `Delete` / `Backspace` removes all selected nodes and their attached Rete connections when the editor canvas has focus

- keyboard deletion and canvas gestures must not interfere with editing inputs, textareas, selects, buttons, or other editable controls

Selection/marquee behavior is editor state only. It must not change OpenSCAD semantics, node identity, or graph connections except when the user explicitly deletes nodes.

Desktop/laptop interaction is the primary target. Do not deliberately make touch impossible, but do not increase complexity substantially just to optimize tablet UX at this stage.

**### Compact node presentation**

Nodes use a compact/collapsible presentation model so parameters and controls do not permanently consume canvas space. This is presentation state only and must remain separate from Rete graph semantics and node parameter state.

Current behavior:

- nodes are collapsed by default where controls can be hidden

- on devices with real hover (`(hover: hover) and (pointer: fine)`), hovering expands after a short delay and leaving collapses after a short delay

- hover interaction brings the node to the foreground immediately using the existing Rete area DOM ordering mechanism; do not implement a parallel z-index stack

- nodes can be pinned open explicitly; pinning implies expanded state

- on touch/no-hover devices, existing Rete node selection is reused to control temporary expansion rather than introducing separate touch-only presentation state

- presentation state is keyed by node ID only and cleaned up when nodes are removed

- expanding/collapsing must not move nodes, disturb the canvas viewport, change graph semantics, or move existing connector anchors. Structural ports live in a stable main/header row; expandable controls grow separately below it

Node layout is normalized as inputs on the far left, a stable title/port row in the middle, and outputs on the far right, with expandable controls in a separate row below. Current nodes use a stable minimum width so opening controls does not shift sockets horizontally. Geometry socket type is communicated visually by its existing blue socket treatment rather than by repeating a visible `Geometry` label on every port. Semantic socket typing and accessible names must remain intact. Future value/socket types may use distinct visual colors, but do not build a generalized type system prematurely.

Editable controls inside nodes own their normal browser interactions. Canvas gestures such as double-click zoom or wheel handling must not override editing/selecting values in inputs, textareas, selects, buttons, or other editable controls.

**### Inspect / temporary preview root**

SCADlet supports inspecting intermediate geometry without modifying the program graph.

Current behavior:

- double-clicking a geometry-producing node makes it the temporary preview/render root; double-clicking the currently inspected node again clears inspect mode

- at most one node is inspected at a time and it has a visual state distinct from ordinary selection

- Render while inspecting evaluates that node and its upstream dependency subtree only; downstream nodes remain present and connected but are ignored for that preview

- inspect state is editor/presentation state only. It must not mutate Rete connections, node parameters, graph identity, or normal project semantics

- deleting the inspected node must clear the inspect state rather than leaving a stale node reference/id

- node controls, sockets, connection paths, and editable fields must retain their own double-click behavior; blank-canvas double-click behavior remains separate

- inspect selection is manual: choosing an inspect root does not automatically start an OpenSCAD render

The development source display may show the source actually rendered for the inspected subtree. Normal `.scad` export must continue to represent the complete model rather than silently exporting only the inspected subtree. STL download may represent the currently rendered mesh.

Keep inspect-root evaluation within the existing Rete/dataflow/code-generation path. Do not implement it by copying/reconnecting the graph or by introducing a second evaluator.

**### Node catalog and creation**

Node creation is driven by a single, small catalog/registry rather than separate hardcoded add-node handlers.

The catalog uses stable, language-independent IDs and owns the construction path for available node types. Conceptually:

```ts

{

  type: 'cylinder',

  category: 'primitives',

  labelKey: 'node.cylinder',

  create: ...

}

```

The persistent node palette groups currently available nodes by educational categories. User-facing terminology should favor clear labels such as `Primitives`, `Transformations`, and `Boolean operations`; avoid exposing jargon such as `CSG` as the primary category label for beginners.

Current palette behavior:

- Cube, Cylinder, and Sphere are under `primitives`.

- Translate, Rotate, and Scale are under `transformations`.

- Difference, Union, and Intersection are under `boolean-operations`.

- Nodes can be dragged from the palette onto the infinite Rete canvas.

- Drop coordinates are transformed from browser/client coordinates into graph coordinates using the current area pan/zoom transform.

- Adding a node must not pan, zoom, center, or otherwise disturb the current canvas viewport.

- Clicking a palette item may use the same creation path to place a node near the visible canvas center.

- A fresh session starts with an empty canvas; do not recreate the old automatic starter Cube. Example/template projects may be added later as an explicit feature.

Keep all creation mechanisms routed through one shared editor-level creation path.

**### Localization readiness**

SCADlet is intended to support a German UI later.

Do not use user-facing English strings as semantic IDs. Internal node/category identifiers must remain stable and language-independent.

Use translation keys for display labels, e.g.:

```ts

t('node.cylinder')

t('category.primitives')

```

The current localization layer is intentionally minimal and English-only. A future German translation should be addable by extending the translation dictionary rather than changing graph semantics, node IDs, or call sites.

Do not add a full i18n framework or language switcher unless the project has grown enough to justify it.

**---**

**## Persistence**

Project persistence is the next planned milestone and should be implemented before broadening parameter/dataflow features further.

Rete v2 does not provide the complete project serialization required by SCADlet automatically. Define a SCADlet-owned, versioned JSON project format containing at least:

- node IDs and types
- node parameters/state
- connections
- node positions
- canvas viewport/pan/zoom where useful

Presentation/transient state such as hover timers, ordinary selection, marquee state, and temporary inspect-root state should not become semantic project data unless a later deliberate product decision says otherwise.

The initial implementation may use browser storage for convenient save/load or autosave, but serialization must remain separate from the storage adapter so the same project representation can later support file download/upload (for example a `.scadlet` project file) without redesigning graph semantics.

The node editor is conceptually an infinite canvas.

`.scad` and `.stl` are export formats, not the SCADlet project format.

Do not add an application backend for persistence; SCADlet remains fully client-side/static-hostable.

**---**

**## Hosting and privacy**

The application must remain fully static and client-side.

There is no application backend.

The build output should be hostable as ordinary static files on:

- GitHub Pages

- nginx

- Apache

- Caddy

- object/static hosting

- a user's own server

GitHub Pages is the initial public hosting target, but do not make the application dependent on GitHub Pages.

**### No third-party runtime dependencies**

For privacy and self-hostability, all runtime resources must be served by the same site/application deployment.

Do not add:

- CDN-hosted JavaScript

- externally hosted fonts

- Google Fonts

- externally hosted icons

- analytics

- trackers

- third-party runtime APIs

Bundle or locally ship libraries, fonts, icons, WASM, and other required assets.

Network access should not be required for normal use after the application itself has loaded.

**---**

**## Open source and licensing**

SCADlet is intended to be open source.

The intended project license is GPL, preferably `GPL-3.0-or-later`, unless changed explicitly.

When adding dependencies:

- check that their licenses are compatible with GPL distribution

- keep required copyright/license notices

- avoid dependencies with unclear, proprietary, or incompatible licensing

Do not copy code from sources with incompatible licenses.

**---**

**## Development environment**

Development is intended to work on NixOS in VS Code.

Use the repository's Nix flake/devShell for system-level development tools.

System/development tools belong in `flake.nix`, for example:

- Node.js

- pnpm

- Git

- optional development CLIs

Development note: `openscad-wasm-prebuilt` is imported only from the lazily created render Web Worker. Keep it in Vite's `optimizeDeps.include` unless the import structure changes; otherwise Vite may discover/optimize it only on the first Render action in development and trigger a full-page reload that destroys unsaved editor state. Production builds are not affected by that specific dev-server behavior.

JavaScript application dependencies belong in `package.json`, not in Nix:

- Lit

- Rete

- Three.js

- Vite plugins

- TypeScript libraries

Use pnpm for package operations unless the repository explicitly changes package manager.

Do not require developers to install project-specific Node packages globally.

**---**

**## Code quality**

Prefer:

- strict TypeScript

- small modules with clear responsibilities

- explicit types at architectural boundaries

- straightforward browser APIs

- simple solutions over framework-like abstractions

- comments that explain non-obvious design reasons, not obvious syntax

- dependency injection or small interfaces where it materially improves testability, but not as ceremony

Avoid:

- `any` unless unavoidable and justified

- hidden global mutable state

- coupling Rete rendering, OpenSCAD generation, worker control, and Three.js rendering into one large module

- premature generic abstractions

- speculative extensibility

- unnecessary dependencies

- implementing features from later milestones merely because they might eventually be useful

When changing architecture, preserve the simple one-way data flow unless there is a concrete reason not to.

**---**

**## Error handling**

Errors should ultimately be understandable to learners, not just developers.

At minimum:

- invalid graph state should not crash the application

- OpenSCAD/WASM failures should be surfaced visibly

- failed renders should leave the previous valid preview usable when practical

- malformed or incompatible connections should be prevented or clearly reported

Do not silently swallow errors.

Detailed node-to-OpenSCAD diagnostic mapping is a later concern; do not over-engineer it during the MVP.

**---**

**## Milestones**

**### Milestone 1 — Core graph/code-generation foundation (substantially complete)**

The core visual-programming proof of concept: an editable Rete graph whose

nodes produce OpenSCAD fragments, composed through real connections.

Done so far:

- Rete-based node editor: add/move nodes, connect nodes, edit basic

  parameters

- Cube, Cylinder, and Difference nodes

- progressive disclosure for mutually exclusive parameter modes

  (Cylinder's radius/diameter/tapered sizing, optional `$fn`)

- a pure, DOM-free OpenSCAD code-generation layer per node, unit-tested

  with Vitest

- graph evaluation through Rete's dataflow engine, recursively resolving

  connected inputs into correctly nested OpenSCAD (e.g.

  `difference() { cube(...); cylinder(...); }`)

- visibly rendered, continuously updating geometry connections (see

  "Node editor rendering" above)

Remaining primitives/transforms/Boolean nodes (Sphere, Translate, Rotate,

Scale, Union, Intersection) are tracked under Milestone 4, not required

here.

No OpenSCAD import, modules, iteration, code editor, or persistence is

required for this milestone.

**### Milestone 2 — End-to-end browser rendering proof of concept (complete)**

Prove the complete pipeline end to end:

```text

Rete graph → Rete dataflow evaluation → OpenSCAD source → Render button →

Web Worker → OpenSCAD WASM → STL in memory → Three.js → interactive

browser preview

```

Done so far:

- OpenSCAD WASM integrated locally via `openscad-wasm-prebuilt`, with no

  CDN dependency and no runtime network fetch required

- OpenSCAD execution runs in a Web Worker, keeping the main thread

  responsive

- `Render` button: evaluates the graph, generates OpenSCAD, sends it to

  the worker, runs OpenSCAD WASM, produces an STL in memory, and updates

  the viewer

- `Stop` button: terminates the active render worker; a new worker is

  created for a later render

- `.scad` download

- `.stl` download

- Three.js interactive viewer: orbit/rotate, zoom, pan, grid, axes,

  sensible camera defaults, camera preserved across re-renders

- failed renders surface an error without crashing and without discarding

  the previously displayed valid preview

- existing graph/editor functionality preserved unchanged

SCADlet now functions as a minimal, end-to-end visual OpenSCAD editor.

Automatic live rendering, debounce logic, render queues, and complex

cancellation remain out of scope unless requested later.

**### Milestone 3 — Editor usability baseline (complete)**

Establish a practical editor UX before broadening the OpenSCAD language surface. These are UX/editor improvements, not semantic changes to the Rete graph structure or OpenSCAD generation architecture.

Done:

- selection, visible selected state, Delete/Backspace cleanup, and editable-control protection
- resizable editor/viewer/source panes without recreating editor/viewer state
- OpenSCAD-consistent Z-up viewer behavior
- persistent data-driven node palette with click and drag/drop creation
- localization-ready node/category labels with stable internal IDs
- compact/collapsible nodes with hover expansion, delayed collapse, pinning, touch/no-hover fallback, and foregrounding
- stable connector anchors across compact/expanded presentation states
- inputs on the far left and outputs on the far right with redundant `Geometry` labels suppressed
- node controls isolated from canvas double-click/wheel gestures
- multi-selection through Ctrl/Cmd-click, Shift-drag marquee selection, and group movement of selected nodes
- `Render` as the single normal evaluate/generate/render action; the old separate `Evaluate OpenSCAD` action is gone
- empty startup canvas; the early automatic starter Cube is gone

Do not reopen this milestone for general UI redesign, undo/redo, auto-layout, minimap, or touch-first optimization. Further UI refinement belongs to later work unless a regression blocks current use.

**### Milestone 4 — More geometry, transformation, and Boolean nodes (complete)**

The initial broader geometry vocabulary is implemented:

- primitives: Cube, Cylinder, Sphere
- transformations: Translate, Rotate, Scale
- Boolean operations: Difference, Union, Intersection

Current implementation follows the established architecture:

- pure, DOM-independent OpenSCAD generation
- Rete node/dataflow semantics
- shared Geometry sockets
- inline numeric controls and progressive disclosure where appropriate
- Sphere supports radius/diameter and optional `$fn`
- Translate/Rotate/Scale share their genuine vector-transform implementation pattern
- Union/Intersection currently use two explicit geometry inputs (`A`/`B`) rather than a premature variadic-port UI
- catalog registration and localization keys for all current nodes

Render performance was also profiled at this stage. The current OpenSCAD WASM path uses Manifold plus binary STL because Boolean operations with tessellated geometry such as Sphere `$fn=50` were orders of magnitude slower with the previous CGAL/Nef backend. Do not revert that backend/output choice without measured evidence and correctness verification.

The editor also supports **Inspect Node** as a temporary preview root: an intermediate node and its upstream dependency subtree can be rendered without modifying normal graph semantics.

**### Milestone 5 — Project persistence / save and load (next)**

Define and implement a versioned SCADlet project format and a first fully client-side save/load workflow.

At minimum persist:

- node IDs/types and semantic parameter state
- connections
- node positions
- useful canvas viewport state

Keep serialization independent from storage. Browser storage is a suitable first storage adapter, while the project representation should be suitable for later explicit project-file import/export and deterministic fixtures/benchmark graphs.

Do not serialize transient hover, marquee, ordinary selection, or temporary Inspect state as semantic model data by default.

**### Milestone 6 — Parameters and simple dataflow**

Add value-driven parameters and a small supporting math layer.

Likely initial value nodes:

- Number
- Add
- Subtract
- Multiply
- Divide
- Vector2
- Vector3

Geometry-node parameters should still support convenient inline literal values. Parameter/value connectors should follow the established stable-anchor and type-color conventions rather than causing node layout to jump.

**### Milestone 7 — Modules / reusable subgraphs**

Support reusable, parameterized graph structures corresponding to OpenSCAD modules.

Focus on teaching:

- abstraction
- parameterization
- reuse
- composition

**### Milestone 8 — Iteration**

Add a visual representation of repetition / OpenSCAD `for`.

The precise UX is intentionally undecided. Do not assume the OpenSCAD syntax should be mapped literally to nodes.

**### Milestone 9 — Geometry code node**

Add an OpenSCAD code escape hatch that:

- accepts defined parameter inputs
- may accept geometry inputs
- produces geometry

Keep it secondary to normal visual nodes.

**### Milestone 10 — Teaching features and UX refinement**

Possible later features include:

- stepwise evaluation
- highlighting geometry associated with a node
- visualizing dependencies
- exercises/challenges
- beginner/advanced modes
- explanations of functional programming concepts
- later UI refinement beyond the current editor baseline

The existing Inspect Node feature already provides one form of intermediate-geometry inspection; later teaching features should build on it rather than introducing conflicting graph semantics.

These are intentionally later milestones.

**---**

**## MVP boundary**

The first meaningful MVP is Milestones 1–2:

```text

editable Rete graph

+ Cube/Cylinder/Difference

+ visible geometry connections

+ OpenSCAD generation

+ OpenSCAD-WASM execution in a Web Worker

+ STL generation

+ Three.js interactive preview

+ SCAD/STL download

```

This end-to-end MVP now exists and is the stable baseline for subsequent work.

Project persistence (Milestone 5) is the next practical step now that graphs are useful enough to preserve and reuse. Parameter dataflow/value nodes follow in Milestone 6 rather than being required for the proof of concept.

When extending the MVP, preserve the working end-to-end path and resist

implementing later milestone features unless they are necessary to avoid a bad

architectural dead end.

**---**

**## Decision-making guidance for agents**

When multiple implementation options are viable:

1. Preserve the educational goal.

2. Preserve the browser-only/static-hosting constraint.

3. Preserve OpenSCAD as the single geometry semantics for rendering/export.

4. Prefer the existing chosen stack.

5. Prefer the simplest implementation that leaves the next milestone feasible.

6. Avoid adding architectural layers without an immediate demonstrated need.

7. If a change would alter a documented architectural decision, explain the tradeoff before implementing it.

Do not reinterpret unresolved product questions as settled requirements. Implement only what the current task requires.