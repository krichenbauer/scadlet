# SCADlet — Agent Instructions

## Project purpose

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

---

## Current architecture

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

### Node editor rendering

Rete is the source of truth for graph structure and dataflow, but its

official Lit render plugin (`rete-lit-plugin`) is **not** used and should

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

### Data flow

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

---

## Rete responsibilities

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

### Project-level definitions and graph scopes

Milestone 8 introduces named user-defined **Modules** and **Functions**. Treat these as project-level definitions, not as ordinary main-graph nodes with decorative boxes around them.

Conceptually, a project evolves from one graph into:

```text
Project
├── Main graph
└── Definitions
    ├── Module: wheel
    │   └── definition graph / scope
    ├── Module: axle
    │   └── definition graph / scope
    └── Function: doubleSize
        └── definition graph / scope
```

Rete remains the source of truth **within each graph** for nodes, ports, connections, and dataflow. A small SCADlet-owned project-level definition registry may own stable definition identity, kind, name/signature metadata, and graph membership; this is not a second AST or parallel graph implementation.

The initial Milestone 8 UI may render the Main graph and definition graphs **on the same visible infinite canvas**. Same-canvas presentation must not collapse their semantics into one flat graph: a definition frame represents a real scope boundary and its internal nodes belong to that definition graph.

Do not permit arbitrary wires to cross a definition boundary. External values enter through the definition's explicit Input/Parameters interface; its result leaves through its explicit Output interface. Future lexical/global variables may provide another explicit scope mechanism, but ordinary cross-frame wiring must not become a substitute for scope.

Use stable, language-independent IDs for definitions and their parameters. User-facing names are editable source-language names and must not become graph identity. Calls should refer to the stable definition identity so renaming a Module/Function does not silently break every call.

---

## Node design principles

Geometry is the primary data type and should dominate the visual language.

Initial node families include:

- primitives: cube, sphere, cylinder

- transformations: translate, rotate, scale

- Boolean operations: union, difference, intersection

- later/broader language surface: extrusion, hull, minkowski, mirror, resize, iteration

- user-defined Modules and Functions are planned under Milestone 8 as reusable named definitions

- values/math exist to support geometry, not to dominate the graph

The current geometry vocabulary is implemented and includes Cube, Cylinder, Sphere, Translate, Rotate, Scale, Difference, Union, and Intersection. These nodes establish the current working baseline for primitives, transforms, and Boolean composition. Their existing parameter surfaces and fixed Boolean inputs are not the final interaction model: Milestone 6 deliberately refines them toward OpenSCAD-semantic signatures before broader value/dataflow work.

### Parameters and semantic signatures

SCADlet should expose OpenSCAD semantics without forcing beginners to construct a value graph for every literal. A parameter is a semantic unit of the OpenSCAD call; its visual editor may offer several convenient ways to provide that value.

Prefer the **smallest valid OpenSCAD signature** for a newly created node. Do not permanently show arguments that OpenSCAD can validly omit. For example, the intended Cube progression is conceptually:

```text
Cube
→ cube();

Cube + Size = 20
→ cube(20);

Cube + Size = [20, 10, 10]
→ cube([20, 10, 10]);

Cube + Size = [20, 10, 10] + Center = true
→ cube([20, 10, 10], center = true);
```

Use an explicit, compact add-parameter affordance (for example `+` with a small context menu) to add supported optional arguments. Removing an optional argument should return the node to the corresponding simpler valid signature without losing unrelated graph state. Required arguments, where OpenSCAD truly has no usable default, remain visible.

Do not confuse a convenient editor decomposition with OpenSCAD parameter identity. For example, Cube has one semantic `size` parameter even when SCADlet presents its vector form as editable X/Y/Z components. The UI may therefore support several representations of the same parameter, such as:

- scalar Number literal
- scalar Number connection
- Vector3 literal edited as X/Y/Z
- Vector3 connection
- Vector3 assembled from a mixture of component literals and Number connections

Inline literals remain the usability fallback. When a compatible value connection supplies a parameter/component, disable the corresponding inline editor visually and semantically but preserve its previous literal value so disconnecting restores it. A whole-Vector3 input takes precedence over X/Y/Z component inputs; component literals/connections should remain preserved and visibly inactive so removing the Vector3 connection restores the previous component state rather than destroying user work.

Avoid an `int`/`float` distinction for ordinary OpenSCAD numeric values. Treat them as a single **Number** type. Geometry, Number, Vector3, and later genuinely distinct types such as Boolean or String may use distinct socket colors/visuals. Do not model OpenSCAD's weak/list typing so literally that the educational UI becomes ambiguous: a semantic Vector3 socket is acceptable even though OpenSCAD represents the value as a three-element list.

### Optional parameters and progressive disclosure

Use progressive disclosure, but tie it to the semantic signature rather than merely hiding a large fixed form.

Do not show every possible OpenSCAD parameter on every node by default. Start with the smallest useful/valid form and let users add supported parameters as needed. For mutually exclusive OpenSCAD forms, expose semantic modes rather than independent conflicting fields. Existing examples include radius, diameter, and different bottom/top radii for a cylinder. Optional advanced parameters such as `$fn`, `$fa`, and `$fs` should remain absent until explicitly added/enabled.

Connected parameter ports are never allowed to disappear merely because the node collapses. A collapsed node must remain expanded far enough to show every currently used connection and the semantic parameter/component it supplies. During connection dragging, hovering a compatible compact node should reveal the additional compatible target ports needed to make a new connection. Existing connector anchors must remain stable while this disclosure occurs.

### Geometry children and variadic inputs

OpenSCAD child blocks are not inherently binary. Do not permanently model variadic operations as binary trees merely because the MVP used two inputs. `union()` and `intersection()` should evolve from the current fixed `A`/`B` inputs to an ordered variadic child list.

Prefer a simple dynamic-slot interaction: connected child slots remain visible and another empty child slot is available for extending the operation. Dynamic slots must have stable, language-independent identities suitable for Rete connections and `.scadlet` persistence; removing/reordering slots must not silently retarget existing connections. Difference remains semantically asymmetric (`base` / `subtract`) and need not be forced into the same variadic abstraction.

Do not generalize this into an abstract signature/DSL framework beyond what the current OpenSCAD node vocabulary demonstrates. Prefer a few explicit reusable mechanisms for optional parameters, alternative value editors, typed parameter inputs, and ordered variadic children.

### User-defined Modules and Functions

Milestone 8 introduces reusable named OpenSCAD definitions. Modules and Functions should share one coherent definition/signature infrastructure while preserving their different OpenSCAD semantics.

#### Definition frame / same-canvas model

The initial UX keeps definitions on the **same visible editor canvas** as Main. Each definition is shown as a visually distinct framed subgraph: conceptually the expanded form of the corresponding reusable call node. The frame is a scope visualization, not merely a comment/group rectangle.

A definition frame should automatically encompass all nodes belonging to that definition, with reasonable padding and a clear header such as `module wheel(...)` or `function doubleSize(...)`. Exact auto-sizing, frame movement, collapsing, colors, and other polish are secondary UX goals; semantic graph membership must not depend on geometric point-in-frame hit testing.

Keep the internal representation independent enough that a future `Open definition in dedicated canvas` view could be added without changing the project semantics or `.scadlet` definition model.

#### Mandatory interface nodes

Every newly created definition graph starts with two special interface nodes that are present from the beginning and cannot be deleted or duplicated:

```text
Inputs / Parameters                         Output
(outputs on the right)                     (input on the left)
```

The **Input/Parameters** node owns the definition's explicit parameter signature. Each parameter appears there as a typed **output** connector because it supplies a value to the implementation graph. Parameters may be added, renamed, reordered, removed, typed, and given supported OpenSCAD default values through this interface.

Parameter identity must be separate from display/name/order. Use stable parameter IDs so renaming or reordering a parameter does not silently retarget persisted call connections. Signature edits that truly remove or change an incompatible parameter must update/validate every call explicitly; never reconnect calls by display index or name coincidence.

Initially use the current value types where meaningful:

- Number
- Boolean
- Vector3

String/List and other future value types should be added only when the language surface actually needs them. Do not split Number into int/float.

The interface-node positions may be moved like normal nodes unless a later UX pass decides otherwise, but they remain protected from deletion. Newly created definitions should place Inputs on the left and Output on the right with enough space to start building between them.

#### Module definitions

A Module definition represents an OpenSCAD `module name(parameters) { ... }`. Its Output node has exactly one **Geometry input** on the left. In SCADlet this is a deliberate graph sink / body root, not an OpenSCAD return value.

Conceptually:

```text
Inputs                                    Module Output
┌─────────────────┐                      ┌───────────────┐
│ radius Number ● ├──▶ ... ────────────▶○ Geometry      │
│ width  Number ● ├──▶ ...               └───────────────┘
└─────────────────┘
```

Generated OpenSCAD is still ordinary Module body syntax; do not invent `return geometry`. The single Geometry root is a SCADlet teaching abstraction that makes the definition's result explicit. If several independent geometry branches should form the body, combine them explicitly with the existing variadic Union rather than giving Module Output hidden multi-root/implicit-union semantics.

Ordinary Module parameters are value parameters. Do not model geometry passed into a Module as a normal OpenSCAD argument merely because SCADlet has Geometry wires. OpenSCAD `children()` is distinct child-block semantics. Leave room for a later explicit `children()`/Geometry-child interface, but do not require it in the first Milestone 8 implementation unless requested.

#### Function definitions

A Function definition represents an OpenSCAD `function name(parameters) = expression;`. Functions have the same Input/Parameters concept but exactly one **value result** rather than Geometry.

The Function Output node therefore has exactly one typed value input. Its result type is part of the Function signature and must be one of the supported value socket types (initially Number, Boolean, or Vector3). Whether the UI selects that type explicitly or derives it from the connected result is an implementation detail unless a task settles it; persisted semantics must nevertheless be unambiguous.

A Function definition graph may use value/math nodes and calls to compatible user-defined Functions. Geometry-producing nodes and Module/action calls do not belong in a Function expression graph. Keep the rule simple: a Function produces one OpenSCAD value expression; OpenSCAD evaluates it. Do not introduce JavaScript evaluation.

OpenSCAD Functions do not use an imperative `return` statement; generate the normal expression form.

#### Call nodes

A Module/Function call in Main or another permitted definition graph is a normal compact SCADlet node generated from the current definition signature. Built-in nodes and user-defined call nodes should look and behave as similarly as practical.

- Module call inputs mirror the Module parameters and its output is Geometry.
- Function call inputs mirror the Function parameters and its output is the Function's value type.
- Parameter default values should map naturally to the existing inline-literal fallback model where supported.
- A call references the stable definition ID while displaying/emitting the current source-language name.
- Signature edits must propagate safely to all call instances; do not leave hidden live connections to removed/incompatible parameter ports.

Do not intentionally add recursive definition calls in the first implementation. If direct or indirect recursion would create an evaluation/code-generation cycle, reject it clearly until recursion receives an explicit design pass.

#### Scope and future variables

Do not bake in the assumption that Module/Function parameters will forever be the only names visible inside a definition. OpenSCAD also has outer-scope variables and `$` special variables. Future variable support may expose visible outer-scope names through explicit reference nodes or another deliberate scope UI.

For now, definitions should be self-contained through explicit parameters/calls. Do not add arbitrary cross-frame wires or implicit hidden captures merely to anticipate variables. Ordinary lexical variables and OpenSCAD `$` special variables have different semantics and should not be conflated when that later feature is designed.

### Code node

A geometry-oriented OpenSCAD code node is planned for a later milestone as an escape hatch for constructs that are awkward to represent visually.

Do not use code nodes as a shortcut for ordinary geometry features that should have clear visual nodes.

---

## OpenSCAD generation

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

With user-defined definitions, generate one coherent OpenSCAD program containing the named Module/Function declarations plus the Main graph body. Definition frames are editor structure only; exported source should use normal readable OpenSCAD syntax, e.g.:

```scad
module wheel(radius = 20) {
    cylinder(r = radius);
}

function doubleSize(x) = (x * 2);

wheel(doubleSize(10));
```

For a Module, the Geometry connected to the special Module Output node defines the generated Module body root. For a Function, the value connected to Function Output defines the generated expression. Call nodes emit ordinary OpenSCAD Module calls or Function expressions; no SCADlet-specific wrapper syntax belongs in exported `.scad`.

Definition dependency ordering must be deterministic and readable. Do not duplicate a definition's generated source for every call. Detect unsupported definition cycles rather than recursing indefinitely in SCADlet's graph evaluation.

Do not introduce a second geometry implementation such as JSCAD or replicad for preview generation. Avoid any architecture where preview semantics can differ from exported OpenSCAD semantics.

Importing existing `.scad` source is not currently a requirement.

---

## OpenSCAD WASM and rendering

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

---

## Three.js viewer

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

---

## UI architecture

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

### Compact node presentation

Nodes use a compact/collapsible presentation model so parameters and controls do not permanently consume canvas space. This is presentation state only and must remain separate from Rete graph semantics and node parameter state.

Current behavior:

- nodes are collapsed by default where controls can be hidden

- on devices with real hover (`(hover: hover) and (pointer: fine)`), hovering expands after a short delay and leaving collapses after a short delay

- hover interaction brings the node to the foreground immediately using the existing Rete area DOM ordering mechanism; do not implement a parallel z-index stack

- nodes can be pinned open explicitly; pinning implies expanded state

- on touch/no-hover devices, existing Rete node selection is reused to control temporary expansion rather than introducing separate touch-only presentation state

- presentation state is keyed by node ID only and cleaned up when nodes are removed

- expanding/collapsing must not move nodes, disturb the canvas viewport, change graph semantics, or move existing connector anchors. Structural ports live in a stable main/header row; expandable controls grow separately below it

Node layout is normalized as inputs on the far left, a stable title/port row in the middle, and outputs on the far right, with expandable controls in a separate row below. Current nodes use a stable minimum width so opening controls does not shift sockets horizontally. Geometry socket type is communicated visually by its existing blue socket treatment rather than by repeating a visible `Geometry` label on every port. Semantic socket typing and accessible names must remain intact. Number, Vector3, and later genuinely distinct value types should use consistent, distinguishable socket/connection visuals without splitting Number into int/float.

As parameter sockets are introduced, compactness becomes **connection-aware**: every connected input must remain visible in the collapsed state, with the corresponding inline editor disabled while the connection is authoritative. Hover during a compatible connection drag may expand the node further to reveal currently unused target ports. Expansion for this purpose must preserve the established stable-anchor invariant so the socket a user is aiming for does not jump.

Editable controls inside nodes own their normal browser interactions. Canvas gestures such as double-click zoom or wheel handling must not override editing/selecting values in inputs, textareas, selects, buttons, or other editable controls.

### Inspect / temporary preview root

SCADlet supports one-shot inspection of intermediate geometry and values without modifying the program graph.

Current behavior:

- double-clicking a geometry-producing node immediately performs a one-shot Inspect evaluation of that node and its upstream geometry subtree; double-clicking the same or another node performs a fresh explicit Inspect evaluation

- double-clicking a value-producing node immediately evaluates it through OpenSCAD's headless echo path and shows the resulting value

- at most one node is inspected at a time and it has a visual state distinct from ordinary selection

- normal Render always evaluates the complete project, even when a node is inspected

- inspect state is editor/presentation state only. It must not mutate Rete connections, node parameters, graph identity, or normal project semantics

- deleting the inspected node must clear the inspect state rather than leaving a stale node reference/id

- node controls, sockets, connection paths, and editable fields must retain their own double-click behavior; blank-canvas double-click behavior remains separate

- a value Inspect result is cleared immediately by a later semantic graph change and is not automatically recomputed; presentation-only changes such as selection, hover, pinning, panning, or zooming retain it

- the last successful Geometry preview remains visible until another successful Geometry Inspect or normal Render replaces it

The development source display may show the source actually rendered for the inspected subtree. Normal `.scad` export must continue to represent the complete model rather than silently exporting only the inspected subtree. STL download may represent the currently rendered mesh.

Keep inspect-root evaluation within the existing Rete/dataflow/code-generation path. Do not implement it by copying/reconnecting the graph or by introducing a second evaluator.

### Node catalog and creation

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

Milestone 8 keeps user-defined definitions in this **same left sidebar** rather than introducing a separate project browser. Add dynamic project sections conceptually like:

```text
MY MODULES
  wheel
  axle
  + New module

MY FUNCTIONS
  doubleSize
  clampSize
  + New function
```

The existing built-in catalog remains the authority for built-in node types. User-defined Module/Function entries are project-derived dynamic call-node factories and must not require inventing a permanent built-in catalog type for every definition instance. Route creation through the same editor-level add-node path so drag/drop and click placement retain current viewport behavior.

A normal click/drag on a user-defined entry creates a **call node**. Provide a distinct edit affordance/context action that locates/selects/focuses the corresponding definition frame on the same canvas rather than overloading ordinary call creation. New definition creation should be Scratch-like and discoverable (`+ New module`, `+ New function`); a small creation flow may collect the definition name and initial parameters, which remain editable afterward on the definition's Input/Parameters node.

Keep future sidebar polish separate from Milestone 8 semantics. Collapsible groups, stronger category colors, searching, and other palette organization are desirable later but should not be required to implement reusable definitions correctly. Structure palette groups so such refinement remains feasible.

### Localization readiness

SCADlet is intended to support a German UI later.

Do not use user-facing English strings as semantic IDs. Internal node/category identifiers must remain stable and language-independent.

Use translation keys for display labels, e.g.:

```ts

t('node.cylinder')

t('category.primitives')

```

The current localization layer is intentionally minimal and English-only. A future German translation should be addable by extending the translation dictionary rather than changing graph semantics, node IDs, or call sites.

Current UI-label baseline: all visible/accessibility-relevant natural-language
labels in the node palette, current node controls, compact-node affordances,
and app toolbar use `t()` keys. OpenSCAD syntax such as `$fn`, `X`, `Y`, `Z`,
`R`, and `D` may still use translation keys but remains semantically neutral.
Variadic Union/Intersection child slots retain stable internal port IDs while
the renderer presents connected children without repeated text and the final
empty extension slot as `+`; localized accessible names distinguish
`Geometry child` from `Add geometry child`. Presentation labels never become
port IDs or persisted state.

Do not add a full i18n framework or language switcher unless the project has grown enough to justify it.

---

## Persistence

Project persistence (Milestone 5) is implemented and remains fully client-side. Treat **project representation**, **file access**, and **browser-local storage** as separate concerns that share the same canonical project model.

### Canonical `.scadlet` project format

The canonical current `.scadlet` format (v2 after Milestone 6 migration) is documented in detail in
`docs/scadlet-format.md`, generated from and kept aligned with the actual
implementation (`src/persistence/`, `src/editor/node-catalog.ts`). Keep
implementation, validation, and any future migrations consistent with
that specification; update it alongside the code rather than letting it
drift.

Define a SCADlet-owned, versioned JSON format. Do not serialize Rete objects, DOM state, Three.js objects, or other library-internal structures directly. The file format is a stable SCADlet contract that adapters reconstruct into the current implementation.

Use a top-level shape conceptually like:

```json
{
  "format": "scadlet",
  "version": 1,
  "metadata": {},
  "graph": {},
  "editor": {},
  "viewer": {}
}
```

Keep these responsibilities distinct:

- `metadata`: project name and portable project metadata. A new project may temporarily be called `Untitled Project`, but before the first explicit file Save / Save As / export the user must provide a meaningful project name. Use that name as the default `.scadlet` filename after safe filename normalization.

- `graph`: semantic program state. Store stable node IDs, stable language-independent node type IDs, each node's semantic parameter state, and explicit connections.

- `editor`: reproducible editor representation. Store node positions and useful infinite-canvas viewport state such as pan/translation and zoom. This is project presentation state, not OpenSCAD semantics.

- `viewer`: reproducible 3D view state. Store only the minimal stable values needed to restore the view, such as camera position and controls target (and future user-adjustable view settings if they become project-relevant). Do not serialize raw Three.js objects.

Connections must address **specific stable ports**, not merely pairs of nodes. Conceptually:

```json
{
  "id": "connection-42",
  "source": { "node": "node-17", "port": "geometry" },
  "target": { "node": "node-23", "port": "base" }
}
```

This is required for current multi-input geometry nodes and future parameter/value sockets. Port IDs such as `geometry`, `base`, `subtract`, `a`, `b`, `x`, etc. must be stable semantic IDs independent of localized labels and renderer details. Dynamic variadic child slots introduced later must likewise have persistent slot identities rather than display-index-derived connections that silently retarget when the UI changes.

Do not store transient interaction state as normal project data. In particular, ordinary selection, marquee rectangles, hover timers, temporary compact expansion, drag state, and temporary Inspect root should not be serialized. Explicit pinning is the deliberate exception: it is user-chosen, reproducible presentation state and is persisted in v1; temporary hover/selection-driven expansion remains excluded.

The format must be explicitly versioned from the beginning. Prefer small migrations between known older versions over speculative future-proof schemas. A newer unsupported format version, unknown semantic node type, or incompatible port/state must produce an understandable load error rather than silently dropping data. Additive evolution should preserve old projects through explicit migration/normalization code.

From this milestone onward, every new persistent language/editor feature must be reviewed against `.scadlet`: update the canonical types, serializer, validator, restore path, fixtures/tests, and `docs/scadlet-format.md` whenever the persisted representation changes. Changing existing parameter shapes or stable port IDs is a format-compatibility event; either preserve backward-compatible identities/adapters or introduce a new format version with a tested migration. Never silently make existing saved projects unloadable.

`.scad` and `.stl` remain export formats, not SCADlet project formats.

### Persistence of Modules and Functions

Milestone 8 is a persistent language-model change and therefore requires an explicit `.scadlet` format evolution from the current v2 representation (normally a new version plus migration unless a demonstrably backward-compatible extension is preferable). Update `docs/scadlet-format.md`, types, serializer, validator, restore path, fixtures, local autosave compatibility, and migration tests together.

Persist definitions as project-level semantic objects with stable IDs. Conceptually each definition needs:

```text
definition id
kind: module | function
source/display name
ordered parameter definitions with stable parameter ids
parameter types/defaults
function result type where applicable
definition graph nodes/connections
editor positions for its member nodes
```

Main/definition call nodes must reference the stable definition ID, not only its name. Definition and parameter renames must therefore remain identity-preserving. Parameter order is meaningful for readable/generated call signatures but must not be used as persistent connection identity.

Definition graph membership is semantic state. The visible frame's derived bounds/padding are presentation and should preferably be recomputed from member-node positions rather than persisted as semantic truth. If later user-adjustable frame presentation becomes worth preserving, keep it under editor state.

The mandatory Input/Parameters and Output interface nodes must restore deterministically and retain stable protected identities/roles. Do not serialize them as arbitrary deletable user nodes if that makes malformed definition graphs possible. Validation must reject call references to missing definitions, missing/incompatible parameter ports, invalid Function result types, or definition cycles that the current language subset does not support.

Old v2 projects without definitions must migrate/open as a project containing only Main with an empty definition registry. Never make existing projects unloadable merely because Milestone 8 adds reusable definitions.

### Project serialization architecture

Keep serialization/deserialization pure and independent from storage APIs. Conceptually separate:

```text
Rete/editor/viewer state
        ↕
ProjectSerializer / ProjectLoader
        ↕
ScadletProject (versioned canonical representation)
        ↕
file adapter / IndexedDB adapter / future storage adapters
```

Do not let IndexedDB records, browser file handles, GitHub concepts, or UI widgets leak into the canonical project schema.

Node-type serialization should use the existing stable node catalog/type IDs and explicit semantic state. Do not depend on private Rete implementation details. The format should remain usable for deterministic examples, regression fixtures, and benchmark graphs as well as end-user projects.

### `.scadlet` file open/save

Support explicit project-file import/export using the canonical format.

Use progressive enhancement:

- baseline browser fallback: open via a normal file input and save via a generated `.scadlet` download
- where the File System Access API is available: `Open`, `Save`, and `Save As` may use real file pickers/file handles so subsequent Save can write back to the same file
- keep file-handle association outside the canonical `.scadlet` JSON; it is browser/session/storage metadata only
- do not require File System Access support for SCADlet to function

The application-level actions should remain conceptually `Open`, `Save`, and `Save As`, rather than exposing browser-specific implementation details. This leaves room for a later installable PWA/file-handler integration without redesigning serialization.

When a project has not yet been explicitly named, an automatic/local recovery copy may remain `Untitled Project`; an explicit file Save / Save As / export must request a meaningful name first so downloads do not accumulate arbitrary filenames.

### Browser-local project library

Use **IndexedDB** as the primary browser-local project store. Do not use `localStorage` as the main project database. `localStorage` may later be used for tiny global preferences, but structured project content belongs in IndexedDB.

The local project library must support multiple projects. Keep storage metadata separate from the canonical project representation. A stored project record may conceptually contain:

```text
storage id
project name
canonical ScadletProject data
revision
createdAt
updatedAt
optional browser-specific file association metadata
```

A storage/database ID is not automatically part of the portable `.scadlet` file identity. Importing/copying a project must be able to create a new local record without corrupting another project merely because portable metadata happens to match.

The purpose of browser persistence is that useful work survives reloads and closed browser windows. Exact autosave timing/debounce is an implementation detail to choose simply; do not build a synchronization framework or render-style queue merely for autosave.

Current implementation choices:

- `src/persistence/local-project-store.ts` uses native IndexedDB with database schema version 1 and stores a small record wrapper (`id`, `revision`, local timestamps) around the validated canonical SCADlet project payload. The IndexedDB schema version and `.scadlet` format version remain independent.
- Local IDs use `crypto.randomUUID()` and are unrelated to names, filenames, or graph/node IDs. External `.scadlet` Open always imports a new local record.
- This tab's active ID is kept in `sessionStorage`. Startup restores that ID when valid, otherwise opens the most recently updated local project, otherwise creates one empty project.
- Autosave uses the existing dirty notifications with a 750 ms debounce and one in-flight write at a time. Generation tracking prevents an older completion from marking newer edits clean.
- Revision comparison and update happen atomically in one IndexedDB read/write transaction. Web Locks are not used because they do not add correctness beyond this transaction plus the authoritative revision check.
- `BroadcastChannel` carries only create/save/delete identity and revision notifications. A same-project update blocks autosave and offers explicit reload or save-as-local-copy recovery; it never merges or overwrites automatically.
- `navigator.storage.persist()` is requested once per tab after local storage is successfully established. Absence or denial is non-fatal, as is BroadcastChannel absence.

### Multiple tabs/windows

Different SCADlet tabs/windows must be able to work on different local projects independently.

Use tab-scoped state (for example `sessionStorage`) for the `activeProjectId` or equivalent current-project pointer. Do **not** store one global active-project ID in IndexedDB/localStorage that causes one tab to switch another tab's open project.

IndexedDB remains shared across tabs of the same origin, so all tabs see the same project library.

Use a `BroadcastChannel` (or an equally small browser-native mechanism) to notify other SCADlet tabs about project-library changes such as save/update, rename, or deletion where that improves correctness/UI freshness. Do not use it as a second source of project truth.

Two tabs may open the same project. Silent last-writer-wins overwrites are not acceptable. Use optimistic revision checking: a tab saves against the revision it loaded, a successful save increments the revision, and a stale tab must detect the mismatch rather than silently overwrite newer work.

A short per-project Web Lock (`navigator.locks`) may be used where available to serialize the actual IndexedDB write, but the revision check remains the correctness mechanism. Do not make unsupported optional browser APIs a requirement for basic persistence.

Do not implement collaborative merge/CRDT behavior at this stage. A detected concurrent-edit conflict may be surfaced to the user and resolved explicitly later; the key requirement now is to prevent silent data loss.

### Persistence scope and future storage

The first persistence implementation remains serverless and fully client-side. Do not add an application backend.

The storage boundary should make future adapters possible without changing `.scadlet`, including GitHub/GitLab-style repository storage or other remote providers. Those are future features and must not be introduced during the initial persistence milestone.

The node editor remains conceptually an infinite canvas, and project loading must restore positions/view state without recreating semantic meaning from presentation state.

---

## Hosting and privacy

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

The repository deploys its `main` branch through
`.github/workflows/deploy-pages.yml`. That workflow supplies Vite's
`BASE_PATH` from `actions/configure-pages`; retain the `/` default in
`vite.config.ts` so development and non-GitHub static hosting remain
root-relative.

### No third-party runtime dependencies

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

---

## Open source and licensing

SCADlet is intended to be open source.

The intended project license is GPL, preferably `GPL-3.0-or-later`, unless changed explicitly.

When adding dependencies:

- check that their licenses are compatible with GPL distribution

- keep required copyright/license notices

- avoid dependencies with unclear, proprietary, or incompatible licensing

Do not copy code from sources with incompatible licenses.

---

## Development environment

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

Browser persistence integration tests use Playwright (`pnpm test:e2e`). Chromium is provided by the Nix devShell and exposed through `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; keep browser-test output directories ignored rather than committing generated reports.

---

## Code quality

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

---

## Error handling

Errors should ultimately be understandable to learners, not just developers.

At minimum:

- invalid graph state should not crash the application

- OpenSCAD/WASM failures should be surfaced visibly

- failed renders should leave the previous valid preview usable when practical

- malformed or incompatible connections should be prevented or clearly reported

Do not silently swallow errors.

Detailed node-to-OpenSCAD diagnostic mapping is a later concern; do not over-engineer it during the MVP.

---

## Milestones

### Milestone 1 — Core graph/code-generation foundation (substantially complete)

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

The broader primitive/transform/Boolean vocabulary was deliberately deferred from this milestone and is now implemented under Milestone 4.

No OpenSCAD import, modules, iteration, code editor, or persistence is

required for this milestone.

### Milestone 2 — End-to-end browser rendering proof of concept (complete)

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

### Milestone 3 — Editor usability baseline (complete)

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

### Milestone 4 — More geometry, transformation, and Boolean nodes (complete)

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
- Union/Intersection currently use two explicit geometry inputs (`A`/`B`) as an MVP implementation; Milestone 6 deliberately replaces this binary limitation with ordered variadic children
- catalog registration and localization keys for all current nodes

Render performance was also profiled at this stage. The current OpenSCAD WASM path uses Manifold plus binary STL because Boolean operations with tessellated geometry such as Sphere `$fn=50` were orders of magnitude slower with the previous CGAL/Nef backend. Do not revert that backend/output choice without measured evidence and correctness verification.

The editor also supports **Inspect Node** as a temporary preview root: an intermediate node and its upstream dependency subtree can be rendered without modifying normal graph semantics.

### Milestone 5 — Project persistence / save and load (complete)

Persistence is implemented in three layers:

1. **Canonical `.scadlet` format**
   - version 1 defines the SCADlet-owned JSON schema
   - semantic graph state is serialized through stable node/type/port IDs
   - editor representation (node positions, canvas viewport) and viewer camera/view state are included in distinct sections
   - validation and a migration boundary are present; library internals are not serialized

2. **Project file Open / Save / Save As**
   - imports and exports use the same `.scadlet` representation
   - a meaningful project name is required before the first explicit file save/export and supplies the default filename
   - File System Access APIs are a progressive enhancement, with file-input/download fallback elsewhere
   - browser file handles remain outside the portable project JSON

3. **Browser-local project library**
   - multiple projects are stored in IndexedDB so work survives reloads and closed windows
   - each tab's current `activeProjectId` is tab-scoped in `sessionStorage`
   - revision-based optimistic concurrency prevents two tabs editing the same project from silently overwriting one another
   - `BroadcastChannel` provides lightweight cross-tab project-library notifications
   - atomic IndexedDB revision checks are authoritative; Web Locks are intentionally not used

All three layers are implemented.

Do not serialize transient hover, marquee, ordinary selection, drag state, or temporary Inspect state. Do not add collaborative merging, accounts, cloud sync, GitHub storage, or an application backend in this milestone.

The resulting serializer/project fixtures should also make deterministic examples, regression tests, and repeatable render benchmarks straightforward without constructing graphs through fragile UI automation.

### Milestone 6 — OpenSCAD-semantic node signatures and extensible inputs

Refine the current MVP node surfaces before adding a broad value/math graph. The goal is to make nodes represent OpenSCAD calls progressively: start with the smallest valid signature, add optional arguments only when needed, and expose the same semantic parameter through convenient literal/value representations.

Core requirements:

- New nodes start with the smallest useful/valid OpenSCAD signature. For example, Cube should be able to progress from `cube()` to `cube(20)` to `cube([20, 10, 10])` to `cube([20, 10, 10], center = true)` through explicit parameter addition rather than permanently showing every field.
- Add/remove optional parameters through a compact explicit affordance such as `+`; do not hide a permanently complete form and call that the final model.
- Preserve convenient inline literals. A semantic parameter may offer different editors, e.g. Cube `size` as one Number or as a Vector3 edited through X/Y/Z. X/Y/Z are components of `size`, not separate Cube parameters.
- Establish typed parameter-input behavior needed by the next milestone. A compatible connection overrides/disables its inline literal while preserving that literal for later disconnection. Whole-Vector3 input takes precedence over component Number inputs while preserving the inactive component state.
- Make compact-node disclosure connection-aware: all currently connected parameter/child ports remain visible; hovering a compatible target while dragging a connection reveals additional usable ports without moving existing anchors.
- Replace Union/Intersection's fixed `A`/`B` limitation with ordered variadic geometry children and stable dynamic child-slot identities. Difference remains asymmetric and may keep its semantic `base`/`subtract` inputs.
- Keep Geometry as the existing blue type and establish a clear typed-socket basis for Number and Vector3. Do not split OpenSCAD Number into int/float. Boolean and String remain distinct future types when needed.
- Apply the new signature/parameter model coherently to the current node vocabulary where it is relevant rather than special-casing Cube only. Do not add unsupported OpenSCAD features merely to fill menus.

Persistence is part of this milestone. Existing `.scadlet` v1 projects must not silently break when parameter representations or Boolean child ports change. Before changing persisted parameter shapes/port IDs, choose and test either a backward-compatible adapter/identity strategy or a new format version plus migration. Update `docs/scadlet-format.md`, fixtures, serializer/validator/restore code, and round-trip tests accordingly.

This milestone is about the **node/signature model and extensible inputs**, not yet about a large catalog of Number/math nodes. It should leave Milestone 7 straightforward rather than forcing value dataflow onto the current MVP parameter forms.

Implementation status: the v2 signature baseline is in place. Primitives use
additive semantic parameters, Number and Vector3 sockets are distinct from
Geometry, transforms accept whole-vector or component overrides, and
Union/Intersection persist ordered child-slot identities. `.scadlet` v1 is
migrated on input (including old Cube and Boolean ports); all newly written
files and local autosaves are v2. Milestone 7 still owns user-facing
Number/Vector3/math palette nodes.

Cube Size UX: `size` has exactly one active representation at a time:
**Scalar**, **XYZ**, or **Vector**. Adding Size chooses that representation;
only its corresponding sockets are installed/rendered. Scalar and XYZ
literals are retained across switches, while the Vector representation is a
connection-only whole-Vector3 input. The representation selector belongs in
the Size header. When its active ports have connections, alternatives are
disabled in the UI rather than silently hiding or removing graph semantics.

Milestone 6 consistency baseline: Translate, Rotate, and Scale follow the
same one-vector model as Cube Size. Each uses exactly one active **XYZ** or
connection-only **Vector** representation, retains XYZ literals across
switches, and refuses a representation change while its active parameter
ports are connected. Cylinder and Sphere expose only their active sizing-mode
ports. `center` is a Boolean parameter socket wherever supported; its Boolean
connection overrides (and disables) the checkbox literal without discarding
that literal. The closed socket vocabulary is Geometry, Number, Vector3, and
Boolean, with diagonal-only compatibility enforced before live Rete graph
mutation and during `.scadlet` validation. No production value-source nodes
belong here; those remain Milestone 7 work.

### Milestone 7 — Typed values and simple dataflow

Add value-driven parameters and a small supporting math layer on top of the Milestone 6 input model.

Initial value vocabulary should focus on what the existing geometry nodes actually need:

- Number
- Add
- Subtract
- Multiply
- Divide
- Vector3
- Vector2 only when a current/forthcoming OpenSCAD operation gives it a clear use

Use a single Number type for ordinary OpenSCAD numeric values; do not introduce int/float conversion nodes. Vector3 is a useful SCADlet semantic socket type even though OpenSCAD emits it as a three-element list. Boolean is included because existing `center` parameters require it; String remains deferred until a concrete node requires it.

Geometry-node parameters must continue to support convenient inline literals. Connecting a value should make dataflow explicit without forcing literal-only beginners to construct trivial Number nodes. Parameter/value connectors must follow the established type-color, stable-anchor, connection-aware disclosure, dirty-state, and `.scadlet` persistence rules.

Implementation status: Milestone 7 provides Number, Boolean, Vector3, Add,
Subtract, Multiply, and Divide through the catalog categories `values` and
`math`. They produce OpenSCAD expressions (`[x, y, z]` and explicitly grouped
math such as `(a + b)`), rather than JavaScript-evaluated values. Existing
Number/Vector3/Boolean parameter sockets accept them directly and preserve
their inline fallback literals when connected. Value inspection emits a
temporary OpenSCAD `echo()` request and displays its returned value without
persisting it, marking a project dirty, replacing the current mesh, or
changing ordinary `.scad` export.

Dynamic input removal is connection-safe: an input/output port may never
disappear while an attached Rete connection survives. Interactive
representation changes (including Cube, Cylinder, Sphere, and vector
transforms) that would hide connected inputs are blocked with localized
feedback; programmatic port removal must remove attached connections through
the normal Rete lifecycle first. Existing wires support one transient selected
connection at a time and Delete/Backspace removes that wire before considering
node deletion. Wire selection is not persisted or dirty state. While creating
a wire, nearby compatible opposite-direction sockets are snappy preview
targets using the same semantic compatibility rule as real creation; the
preview snaps visually but commits only on an explicit release/click.

Milestone 7 stabilization: connected parameter controls remain present for
stable layout but visually blank (or indeterminate for Boolean) while their
stored fallback literals are overridden. Number, Boolean, and Vector3 source
nodes persist a user-editable descriptive `name`; it is neither graph
identity nor an OpenSCAD variable. Value inspection invokes OpenSCAD in
headless CLI mode with a temporary CSG output target, captures its marked
`echo()` result, and displays it transiently on the inspected node. Compact
nodes retain focus while controls are edited and temporarily reveal only
compatible existing parameter rows while a connection wire hovers them.
During an active connection gesture, this disclosure is driven by explicit
transient gesture state and must work for both drag-to-connect and
click-to-connect. It reveals only currently compatible existing target ports,
clears on leave/completion/cancellation, and never affects persistence,
parameters, representations, pin state, or dirty tracking.
Connected parameter rows remain visible as needed in compact mode, but
connection state never changes canonical semantic row ordering.
Expanded, pinned, focused, and connection-disclosed nodes always render their
active controls in the semantic order defined by the node's active inputs.

Source-node cleanup: a Number, Boolean, or Vector3's persisted descriptive
name is rendered as its directly editable node title, with the localized node
type as the fallback for blank/default names. Do not render a separate Name
row or a redundant Value label for a source literal; titles remain SCADlet
documentation only and must not affect OpenSCAD expressions or port identity.

### Milestone 8 — Modules, Functions, and reusable definitions

Introduce named reusable OpenSCAD definitions while keeping the first UX visually close to a single `.scad` file: Main and definition subgraphs are shown on the same infinite canvas, but each definition remains a separate semantic graph/scope internally.

Teaching goals:

- abstraction
- parameterization
- definition vs. invocation
- reuse
- composition
- explicit data flow across a definition boundary

Core model:

- A project contains Main plus a registry of named Module/Function definitions with stable IDs.
- Each definition owns a semantically separate Rete graph/scope even though the editor initially displays all definitions on the same canvas. Do not implement Modules as ordinary visual groups inside one flat Main graph.
- Each definition is rendered as a clear frame/subprocess on the canvas. The frame should automatically encompass its member nodes; robust automatic bounds are useful UX but subordinate to correct graph membership/scope.
- The frame represents the expanded form of the reusable definition. A call node elsewhere is the compact invocation of that definition.
- Definitions may later be opened in a dedicated canvas without changing the underlying semantic model, but dedicated-canvas navigation is not required for the initial implementation.

Every definition starts with two protected, non-deletable, non-duplicable interface nodes:

1. **Inputs / Parameters** on the left
   - parameters are defined here
   - each parameter produces a typed output connector on the right
   - use stable parameter IDs independent from names/order
   - initially support Number, Boolean, and Vector3
   - support OpenSCAD defaults where practical and map them to call-node literal fallbacks

2. **Output** on the right
   - receives exactly one result connection on its left
   - for a Module this is exactly one Geometry input and represents SCADlet's explicit Module body root, not an OpenSCAD return value
   - for a Function this is exactly one supported value input and represents the Function expression/result

Module requirements:

- generate ordinary `module name(parameters) { ... }` OpenSCAD
- Module call nodes mirror parameters and produce Geometry
- multiple independent geometry roots should be made explicit through Union before Module Output rather than hidden implicit multi-root semantics
- do not pretend Geometry is an ordinary OpenSCAD Module argument
- leave explicit `children()` / geometry-child semantics for a later extension unless separately requested

Function requirements:

- generate ordinary `function name(parameters) = expression;` OpenSCAD; do not invent a `return` statement
- Function call nodes mirror parameters and produce exactly one typed value
- initial result/value vocabulary is Number, Boolean, and Vector3
- Function graphs contain value/math/compatible Function-call semantics, not Geometry-producing nodes or Module actions
- OpenSCAD remains the evaluator; do not evaluate user Functions in JavaScript

Sidebar/creation UX:

- keep everything in the existing left palette/sidebar
- add dynamic `My Modules` and `My Functions` sections
- include obvious `+ New module` / `+ New function` creation actions inspired by Scratch's custom-block workflow
- dragging/clicking a definition entry creates a call node through the normal creation path
- a separate edit action locates/focuses its definition frame on the same canvas
- defer collapsible groups, stronger sidebar colors, search, and other palette polish to a later UX pass

Scope rules:

- wires may not arbitrarily cross definition frames
- explicit parameters are the initial supported inputs to a definition
- architecture must not assume parameters are the only possible names forever: future ordinary variables and OpenSCAD `$` special variables may provide explicit scope/reference mechanisms
- do not implement implicit hidden captures or variable support as part of the first definition pass

Call/signature correctness:

- call nodes reference stable definition IDs
- signature changes must update all calls safely
- renaming/reordering must not silently retarget connections
- removing/changing a connected parameter must never leave dangling/ghost Rete connections
- reject direct/indirect recursive call cycles in the initial implementation unless recursion receives an explicit later design

Persistence is part of Milestone 8. Extend/version `.scadlet` deliberately for project-level definitions, definition graphs/scopes, stable parameter IDs, calls, and required editor positions; migrate existing v2 projects to Main + no definitions.

Do not expand this milestone into variables, `children()`, iteration, function literals/closures, generic macros, or a broad type system merely because the shared definition infrastructure makes them conceivable.

### Milestone 9 — Iteration

Add a visual representation of repetition / OpenSCAD `for`.

The precise UX is intentionally undecided. Do not assume the OpenSCAD syntax should be mapped literally to nodes.

### Milestone 10 — Geometry code node

Add an OpenSCAD code escape hatch that:

- accepts defined parameter inputs
- may accept geometry inputs
- produces geometry

Keep it secondary to normal visual nodes.

### Milestone 11 — Teaching features and UX refinement

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

---

## MVP boundary

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

Project persistence (Milestone 5) now preserves and exchanges useful graphs and supplies deterministic examples/regression fixtures. Milestone 6 establishes its semantic signature/input baseline; typed value/dataflow nodes follow in Milestone 7 rather than being bolted onto the earlier MVP parameter forms.

When extending the MVP, preserve the working end-to-end path and resist

implementing later milestone features unless they are necessary to avoid a bad

architectural dead end.

---

## Decision-making guidance for agents

When multiple implementation options are viable:

1. Preserve the educational goal.

2. Preserve the browser-only/static-hosting constraint.

3. Preserve OpenSCAD as the single geometry semantics for rendering/export.

4. Prefer the existing chosen stack.

5. Prefer the simplest implementation that leaves the next milestone feasible.

6. Avoid adding architectural layers without an immediate demonstrated need.

7. If a change would alter a documented architectural decision, explain the tradeoff before implementing it.

For Milestone 8 specifically, preserve the distinction between **same-canvas presentation** and **separate definition scope/graph semantics**. Do not simplify implementation by flattening definitions into Main merely because they share one visible canvas.

Do not reinterpret unresolved product questions as settled requirements. Implement only what the current task requires.
