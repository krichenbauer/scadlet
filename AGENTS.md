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
- Lit for application UI and Web Components
- Rete.js for the node editor, graph model, connections/ports, and graph evaluation
- OpenSCAD WASM for OpenSCAD execution and mesh generation
- Three.js for the interactive 3D viewer
- pnpm for JavaScript package management
- Nix flake/devShell for the development environment

Do not introduce React, Vue, Angular, Svelte, or another application framework without an explicit architectural decision.

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

---

## Node design principles

Geometry is the primary data type and should dominate the visual language.

Initial node families include:

- primitives: cube, sphere, cylinder
- transformations: translate, rotate, scale
- CSG: union, difference, intersection
- later: extrusion, hull, minkowski, mirror, resize, modules, iteration
- values/math exist to support geometry, not to dominate the graph

### Parameters

Simple values should normally be editable directly inside geometry nodes.

Example:

```text
Cylinder
  radius: 5
  height: 20
```

Parameters may later also expose ports so their values can come from other nodes.

Avoid forcing users to create value nodes for every numeric literal.

### Optional OpenSCAD parameters

Use progressive disclosure.

Do not show every possible OpenSCAD parameter on every node by default. Show the common form first and let users enable additional options.

For mutually exclusive OpenSCAD forms, expose semantic modes rather than independent conflicting fields.

For example, a cylinder may offer:

- radius
- diameter
- different bottom/top radii

Only fields/ports relevant to the selected mode should be shown.

Optional advanced parameters such as `$fn`, `$fa`, and `$fs` should be hidden until enabled.

### Code node

A geometry-oriented OpenSCAD code node is planned for a later milestone as an escape hatch for constructs that are awkward to represent visually.

Do not use code nodes as a shortcut for ordinary geometry features that should have clear visual nodes.

---

## OpenSCAD generation

SCADlet should generate valid, reasonably readable OpenSCAD.

OpenSCAD source does not currently need to be displayed or edited in the UI.

Required initial behavior:

- evaluate the Rete graph
- produce an OpenSCAD source string
- allow that source to be downloaded as `.scad`
- pass the same source to OpenSCAD WASM for rendering

The preview and exported OpenSCAD must derive from the same generated source.

Do not introduce a second geometry implementation such as JSCAD or replicad for preview generation. Avoid any architecture where preview semantics can differ from exported OpenSCAD semantics.

Importing existing `.scad` source is not currently a requirement.

---

## OpenSCAD WASM and rendering

Run OpenSCAD WASM in a Web Worker.

The initial UX is deliberately manual:

- `Render` evaluates the graph, generates OpenSCAD, sends it to the worker, generates STL, and updates the viewer.
- `Stop` terminates the active rendering worker.
- A new worker may be created for a later render.

Do not add automatic live rendering, debounce logic, render queues, or complex cancellation unless requested later.

Keep expensive OpenSCAD execution off the main UI thread.

---

## Three.js viewer

Three.js is used as a mesh viewer, not as the modeling engine.

The viewer should accept the STL generated by OpenSCAD WASM directly from memory, ideally as an `ArrayBuffer` through `STLLoader`.

Expected viewer functionality:

- orbit/rotate
- zoom
- pan
- mouse controls
- basic touch controls
- grid
- axes
- fit model to view
- sensible camera defaults

When a new mesh is rendered, prefer replacing the mesh while preserving the user's camera/view where practical.

Do not introduce Babylon.js, `<model-viewer>`, React Three Fiber, or a specialized STL viewer wrapper without a concrete reason.

---

## UI architecture

Use Lit and normal Web Components for application-level UI.

Likely component boundaries include concepts such as:

```text
<scadlet-app>
<node-editor>
<model-viewer>
<app-toolbar>
<property-panel>
```

These names are illustrative, not mandatory.

Keep semantic graph logic out of Lit rendering code where practical.

Prefer browser-native controls and behavior over custom reimplementations.

Desktop/laptop interaction is the primary target. Do not deliberately make touch impossible, but do not increase complexity substantially just to optimize tablet UX at this stage.

---

## Persistence

Project persistence is planned but not yet implemented.

Rete v2 does not provide the complete project serialization required by SCADlet automatically. When persistence is implemented, use a SCADlet-owned JSON project format containing at least:

- node IDs and types
- node parameters/state
- connections
- node positions
- canvas viewport/pan/zoom where useful

The node editor is conceptually an infinite canvas.

`.scad` and `.stl` are export formats, not the SCADlet project format.

Do not invent persistence infrastructure or a backend before the project format is deliberately designed.

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

JavaScript application dependencies belong in `package.json`, not in Nix:

- Lit
- Rete
- Three.js
- Vite plugins
- TypeScript libraries

Use pnpm for package operations unless the repository explicitly changes package manager.

Do not require developers to install project-specific Node packages globally.

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

### Milestone 1 — Minimal geometry graph

Implement the core visual programming proof of concept.

Initial nodes:

- Cube
- Sphere
- Cylinder
- Translate
- Rotate
- Scale
- Union
- Difference
- Intersection

Required:

- add/move nodes
- connect nodes
- edit basic parameters
- evaluate graph through Rete
- generate valid OpenSCAD

No OpenSCAD import, modules, iteration, code editor, or persistence is required here.

### Milestone 2 — Browser rendering

Integrate:

- Render button
- Stop button
- Web Worker
- OpenSCAD WASM
- STL output
- Three.js interactive viewer
- `.scad` download
- `.stl` download

After this milestone, SCADlet should already function as a minimal visual OpenSCAD editor.

### Milestone 3 — Parameters and simple dataflow

Add value-driven parameters and a small supporting math layer.

Likely initial value nodes:

- Number
- Add
- Subtract
- Multiply
- Divide
- Vector2
- Vector3

Geometry-node parameters should still support convenient inline literal values.

### Milestone 4 — Modules / reusable subgraphs

Support reusable, parameterized graph structures corresponding to OpenSCAD modules.

Focus on teaching:

- abstraction
- parameterization
- reuse
- composition

### Milestone 5 — Iteration

Add a visual representation of repetition / OpenSCAD `for`.

The precise UX is intentionally undecided. Do not assume the OpenSCAD syntax should be mapped literally to nodes.

### Milestone 6 — Geometry code node

Add an OpenSCAD code escape hatch that:

- accepts defined parameter inputs
- may accept geometry inputs
- produces geometry

Keep it secondary to normal visual nodes.

### Milestone 7 — Project persistence

Define and implement the SCADlet JSON project format, including graph layout and viewport state.

### Milestone 8 — Teaching features

Possible later features include:

- stepwise evaluation
- displaying intermediate geometry
- highlighting geometry associated with a node
- visualizing dependencies
- exercises/challenges
- beginner/advanced modes
- explanations of functional programming concepts

These are intentionally later milestones.

---

## MVP boundary

The first meaningful MVP is Milestones 1–3:

```text
Rete graph
+ OpenSCAD generation
+ OpenSCAD WASM rendering
+ Three.js viewer
+ basic parameter dataflow
```

When working on the MVP, resist implementing later milestone features unless they are necessary to avoid a bad architectural dead end.

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

Do not reinterpret unresolved product questions as settled requirements. Implement only what the current task requires.
