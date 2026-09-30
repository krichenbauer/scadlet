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
`area.update('node', id)` for control changes) instead of introducing a
second renderer. Lit does not render individual canvas nodes or connections.
Connection gestures and structural anchors follow [Editor and UX](editor-ux.md)
and [Node style](node-style.md); these presentation rules do not redefine socket
types or graph semantics.

## Scope and state boundaries

Main and each Module or Function definition are explicit semantic scopes on the
shared canvas. The definition registry owns stable identity, signatures, and
membership; Rete owns the graph. Frame bounds do not determine membership.
[Definitions](definitions.md) owns scope roots, bindings, iteration, and Call
dependency ordering.

Semantic changes invalidate generated results. Positions, explicit collapse,
canvas viewport, and the user camera are persistent presentation state.
Selection, popups, placement ghosts, graph clipboard, Inspect, view recovery,
and render scheduling/cache state are transient. These categories must not be
conflated with dirty/autosave notifications: a layout edit may require saving
without requiring a new render.

Every edit of persisted node state reports a semantic change, which drives
Live preview and autosave. Catalog-created nodes are tracked automatically,
including controls they add later (for example after an operation switch);
state changed outside a control reports through the node's notify callback.

Restore is its own editor mode, separate from notification suppression.
Editor transactions suppress notifications to emit one change per action, but
cleanup (such as ending Inspect when its node is deleted) must never depend on
that suppression. Only restore may keep transient state across its provisional
removals. Restore skips the For-loop guard and the type-transition pipes
because the project was already validated; the socket-compatibility and
dataflow-cycle guard still runs.

Project activation flushes current work, validates/prepares the replacement,
restores the existing editor/viewer, and changes the active autosave target only
on success. The [persistence guide](persistence.md) owns failure recovery and
local-versus-portable identity. Bundled examples enter this same lifecycle only
as newly created local copies.

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
by clearing its STL/mesh, preserving source, and showing localized informational
status; it is not an error. The current bundled runtime has
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
is out of scope. Definitions are emitted once using the ordering described in
[Definitions](definitions.md#dependency-order-and-recursion). Generated source
never derives from display labels: OpenSCAD module and function names are
explicit in code, so translated labels cannot change the output.

## Shared rule authorities

Each graph rule has exactly one implementation, called by the live editor,
source generation, restore, and `.scadlet` validation alike. Anything the
editor accepts must therefore save, reload, and generate the same source; a
live check that is stricter or looser than validation is a bug. Extend these
modules instead of re-deriving a rule locally. A new value type or binding kind
starts in `value-types.ts` and `scope-bindings.ts`.

| Rule | Authority (`src/editor/`) |
| --- | --- |
| Node types, ports, parameter validation, persistence hooks | `node-catalog.ts` |
| Value types (Number, Boolean, Vector3) and their sockets | `value-types.ts` |
| Scope bindings: binding table, taken names, reference resolution, naming rules | `scope-bindings.ts` |
| For pairs, iterator bodies, iterator name reuse | `for-validation.ts` (`loopStructureProblem`) |
| One live scope as plain node data for these rules | `scope-snapshot.ts` |
| Connection compatibility and dataflow cycles | `connection-compatibility.ts`, `dataflow-cycle.ts` |
| Geometry recognition by socket type | `geometry-accent.ts` `hasGeometryOutput` (styling: any Geometry output); `sockets.ts` `hasMainGeometryOutput` (Main roots and Inspect) |

Rules are expressed over plain node records (`{ id, type, parameters }`), the
`.scadlet` shape, so file validation and the live editor feed the same
function; live adapters such as `liveScopeSnapshot` and `liveBindingRecords`
convert Rete state. Never recognize Geometry, bindings, or node kinds by port
names or labels.

## Viewer contract

Three.js consumes STL from memory via `STLLoader`. It provides orbit, zoom,
pan, grid, axes, fit-to-view, and sensible defaults. Preserve the user camera
where practical when replacing a mesh. View recovery follows the transient-state
contract in
[Editor and UX](editor-ux.md#view-recovery).

OpenSCAD is Z-up: keep the grid in XY and adapt Three.js in the viewer layer.
Never rotate source/STL geometry to accommodate Three.js defaults. The viewer
is not graph or model state.

## Architectural guardrails

Avoid coupling Rete rendering, source generation, worker control, and viewer
code in one module. Prefer small typed modules and straightforward browser APIs
over broad abstractions. Any structural change must preserve the one-way flow
unless its tradeoff is explicitly agreed.
