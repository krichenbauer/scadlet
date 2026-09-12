# Architecture contract

Read this before modifying Rete integration, canvas rendering, code generation,
render execution, or the Three.js viewer.

## Stack and ownership

- TypeScript + Vite; Lit owns application UI and Web Components around the
  editor.
- Rete owns graph structure, ports, connections, editor interaction, and
  dataflow evaluation. Nodes generate their own OpenSCAD fragments via shared
  code-generation helpers; do not scatter ad-hoc source strings through UI.
- OpenSCAD WASM executes generated source; Three.js only displays its STL.
- `src/editor/render.ts` is the intentional custom DOM renderer. Do not bring
  back `rete-lit-plugin`: its legacy decorator runtime conflicts with Lit 3.

The renderer listens to Rete area render/connection/socket signals, uses
`rete-render-utils` for live socket positions and classic connection paths,
and draws SVG paths. Follow `render.ts`/`controls.ts` patterns (including
`area.update('node', id)` for progressive disclosure) instead of introducing a
second renderer. Lit does not render individual canvas nodes or connections.

## Program and render flow

```text
Rete graph → dataflow evaluation → OpenSCAD source → Render action
                                             ├→ .scad download
                                             ↓
                                      Web Worker → OpenSCAD WASM → STL
                                                                  ├→ .stl download
                                                                  ↓
                                                             Three.js viewer
```

One normal `Render` action evaluates the graph, updates the development source
display, executes OpenSCAD, and replaces the preview. There is no separate
user-facing evaluate action. Keep expensive execution off the main thread.

The worker protocol distinguishes a nonempty STL, a confirmed valid empty
top-level Geometry result, and an error. Empty Geometry replaces the preview
by clearing its STL/mesh; it is not an error. The current bundled runtime has
no structured empty-result field, so this outcome is classified only after a
successful `callMain()`, a missing STL, and its exact known empty-top-level
diagnostic (allowing its fixed startup-localization notice). Do not generalize
this into broad diagnostic matching: all other missing-output and OpenSCAD/WASM
outcomes remain errors.

The worker may live across successful renders, but each render creates a fresh
OpenSCAD/WASM instance: reusing one `createOpenSCAD()` instance for multiple
`callMain()` calls is unreliable. `Stop` terminates the worker; Render then
creates a clean one. The Manifold backend and binary STL output are deliberate
performance choices. Never silently lower explicit detail such as `$fn`.

The default-on Live control in the viewer is currently UI-only. It must not be
treated as a second render path, scheduler, debounce mechanism, or persistent
preference until a separately agreed implementation connects it to this flow.

Generated source must be valid and readable. Preview, `.scad`, and `.stl` use
the same source; no JSCAD/replicad/other preview semantics. Imported `.scad`
is out of scope. Definitions are emitted once in deterministic dependency
order. Function and Module recursive SCCs are valid and use the same
reachable-Call SCC analysis; OpenSCAD-WASM evaluates recursion and SCADlet
does not attempt to prove termination.

## Viewer contract

Three.js consumes STL from memory via `STLLoader`. It provides orbit, zoom,
pan, grid, axes, fit-to-view, and sensible defaults. Preserve the user camera
where practical when replacing a mesh. Explicit 3D view reset is a transient
world-space mesh-bounds frame from the stable Z-up default perspective; it
must not change the serializable user camera state.

OpenSCAD is Z-up: keep the grid in XY and adapt Three.js in the viewer layer.
Never rotate source/STL geometry to accommodate Three.js defaults. The viewer
is not graph or model state.

## Architectural guardrails

Avoid coupling Rete rendering, source generation, worker control, and viewer
code in one module. Prefer small typed modules and straightforward browser APIs
over broad abstractions. Any structural change must preserve the one-way flow
unless its tradeoff is explicitly agreed.
