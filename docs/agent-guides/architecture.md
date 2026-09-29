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
The Rete connection preset is deliberately instantiated only for an ordinary
output socket. Inputs remain completion targets, including the occupied-input
replacement path; they never initialize Rete's classic input-pick/detach flow.
Directional arrow/notch styling and accessibility metadata are renderer state,
not socket types or graph semantics. Structural `For` anchors bypass both.

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

The default-on Live control is a session-only scheduling policy over this same
Render action, not a second pipeline. Relevant semantic graph changes debounce
for 400 ms; presentation, layout, navigation, and autosave do not enter that
policy. Inspect does not change the semantic revision, but replacing the main
preview marks that revision visually stale; a non-manual Inspect exit queues
one debounced main-graph render while Live is enabled. A newer semantic change
cancels a running Live request, uses the existing worker termination and
execution-generation guards, and may only apply the result for its current
graph revision. Manual Render cancels a pending Live or Inspect-exit delay and
renders immediately and always executes OpenSCAD rather than reading cached
output; a successful manual render may refresh the automatic-preview cache.
Stop suppresses retry for that unchanged revision. Each automatic cache miss
has a fresh 15-second worker-execution budget. Reaching it terminates that job,
turns off Live, and reports accessible performance feedback; cancellation for
a newer revision clears the old timer before the replacement receives its own
full budget.
Enabling Live and replacing the active local project cancel pending work and
immediately render a stale current graph through the same controller. After a
successful startup restore of an existing local project, that same activation
path immediately renders once when Live is on; the brand-new empty-library
fallback does not render. Replacing a project invalidates/terminates old work
before restore so it cannot settle into the new preview. Live is not serialized
or scoped to a project.

Successful current-revision main-preview results are held in a session-only
LRU cache keyed by the exact generated source plus the OpenSCAD backend and
export format. The cache retains binary STL (or the explicit valid-empty
result), preserving STL as the viewer boundary, and is bounded by both entry
count and retained source/STL bytes. Errors, cancellations, stale revisions,
partial output, and Inspect-scoped results are never admitted. Inspect never
reads this cache, even when its generated source happens to equal a main graph.

Generated source must be valid and readable. Preview, `.scad`, and `.stl` use
the same source; no JSCAD/replicad/other preview semantics. Imported `.scad`
is out of scope. Definitions are emitted once in deterministic dependency
order. Function and Module recursive SCCs are valid and use the same
reachable-Call SCC analysis; OpenSCAD-WASM evaluates recursion and SCADlet
does not attempt to prove termination.

The one SCAD settings node permitted in Main or a Module is an explicit
scope-level source root even though it has no Geometry sockets. Its ordinary
Number inputs pull their in-scope upstream value/math dependencies through the
same Rete dataflow evaluation. Emit its `$fn`/`$fa`/`$fs` assignments before
the scope's Geometry statements: at the start of Main, or at the start of a
Module body after the parameter context is established. This is part of the
single generated source used by preview and both export paths, not a viewer or
worker option.

Named Number, Boolean, and Vector3 nodes are also explicit code-generation
roots in their owning scope. Their stable binding IDs link compact Variable
reference nodes back to the definition without adding a synthetic Rete wire;
the reference evaluates to the current identifier while the named Value's
ordinary output evaluates to its compatible connected expression or, when
unconnected, its preserved direct fallback. Number and Boolean have one
same-typed `value` input. Vector3 has a whole-Vector3 `value` input whose
connected expression takes precedence over its preserved X/Y/Z component
inputs and fallbacks. Emit named
Value assignments in dependency-safe order before scoped settings and Main or
Module Geometry. In a Function, encode the same ordered assignments as
one valid `let(...)` expression around the result. Missing, cross-scope, or
circular bindings and ordinary Value-input dataflow cycles are errors and must
never produce plausible but incorrect OpenSCAD.

Numeric `For` iteration remains ordinary Rete dataflow. A dedicated structural
socket fixes one header to one result: the header evaluates `start`, `step`,
and `end` in the enclosing scope and carries the range plus iterator identity
to the result, while the result wraps its ordered Geometry inputs in one
OpenSCAD `for` block. Iterator wires and references are validated by downstream
reachability and may cross only the matching result boundary. Nested results
therefore compose as normal Geometry without a second loop AST or evaluator.
A structurally complete result with no connected valid Geometry body evaluates
to an empty fragment, so the entire pair is omitted rather than emitting an
empty `for` block. This draft convention does not relax structural, scope,
iterator, connection-type, or zero-step validation.

## Graph clipboard and placement flow

Copy and Duplicate snapshot selected Rete nodes as detached plain data; only
ordinary connections whose endpoints are both in the snapshot are included.
The session-local payload records its exact active-project identity and one
semantic scope. It is not the operating-system clipboard and is never an
alternate graph, AST, evaluator, or persistence format.

Paste and Duplicate first show a transient placement ghost. Nothing is added
to Rete until a primary canvas click. Commit plans the complete subgraph with
fresh node and connection IDs, fresh named-Value binding IDs, fresh For
pair/iterator IDs, and fresh dynamic Geometry-slot IDs, then validates the
combined target scope before changing the editor. Successful commit adds the
whole subgraph atomically, selects exactly its new nodes, and emits one
semantic change. Failure rolls back without replacing the retained clipboard.
Repeated Paste creates a fresh plan each time.

A copied Variable reference follows its copied binding when that binding is in
the payload; otherwise it retains a valid existing binding in the same scope.
Selecting either For member expands the payload to the complete pair and every
reference to its iterator. The fixed structural connection is reconstructed,
not treated as ordinary clipboard data. Protected definition interface nodes,
mixed scopes, project changes, scope changes, and singleton SCAD settings are
preflight boundaries, not repair-after-creation cases.

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

## Typed value expressions

Typed value expressions include a constant PI source, Number negation, a
variadic Minimum/Maximum node, and one operation-selected Vector Math node.
Vector Math generates OpenSCAD vector arithmetic, `cross`, and `norm` directly;
its operation defines active input socket types and the output type. Min/Max
uses ordered stable operand slots and omits blank optional operands. These
remain ordinary Rete dataflow expressions and use the same generated source
for preview, Inspect, and export.

## Bundled project templates

Maintained built-in templates live at top-level
`examples/example_*.scadlet`. Vite discovers them with an eager raw glob, so
their JSON text is part of the application bundle and selecting one performs
no runtime network request. The template flow is deliberately separate from
geometry evaluation:

```text
bundled .scadlet text → canonical parser → newly named IndexedDB record → normal project restore
```

Templates are never live editor state and are never mutated. Once copied, the
new local record follows the same autosave, selection, rendering, export, and
deletion lifecycle as every other local project.
