# Definitions, scopes, and calls

Read this before modifying Modules, Functions, definition frames, scopes,
calls, parameters, or their generated OpenSCAD.

## Core model

A project has Main plus a registry of named Module/Function definitions. Each
definition owns a separate Rete graph/scope even though Main and definitions
currently share one infinite canvas. Frames visualize a real scope boundary,
not a decorative group; membership is explicit, never inferred from a node's
position inside a frame. This model must remain compatible with a future
dedicated-definition canvas.

Rete is source of truth inside a graph. The small definition registry owns
stable definition identity, kind, name/signature metadata, and graph
membership; it is not a second AST. Names and parameter display order are
editable source-language data, never identity. Calls use stable definition IDs;
parameters and geometry-child slots also have stable IDs.

Ordinary wires may not cross a definition boundary. Definitions are
self-contained through explicit parameters/calls; do not add hidden captures
or arbitrary cross-frame connections. Future variables and OpenSCAD `$`
variables require separate, explicit designs.

SCAD settings is the narrow exception to Output-rooted scope configuration,
not to connection scoping: Main and each Module may contain at most one such
node, while Functions contain none. Its Number dependencies remain ordinary
same-scope wires. Module-local assignments appear first in that Module body
and therefore override Main settings for geometry evaluated by the Module in
the normal OpenSCAD lexical structure.

Each definition has exactly one protected Inputs/Parameters node and Output
node. They cannot be deleted or duplicated, but may be positioned normally.
New definitions place Inputs left and Output right. Signature edits propagate
to all calls safely; rename/reorder preserves wires, while incompatible
type/removal changes preflight, confirm, and remove only affected connections.

Supported value types are Number, Boolean, and Vector3. Do not split Number
into int/float or add String/List until a real language feature needs them.

## Modules

A Module is ordinary OpenSCAD `module name(parameters) { ... }`.

- Output has exactly one Geometry input: the explicit SCADlet body root, not a
  return value. Multiple body branches require an explicit Union.
- Value parameters are typed Inputs outputs and Call inputs, with definition
  defaults and independent Call literal fallbacks.
- Geometry children are a distinct ordered signature: stable `geometry:<id>`
  outputs on Module Inputs mirror Geometry inputs on Module Calls and emit
  ordered `children(index);` statements. They are not value parameters,
  defaults, or implicit unions. Positional gaps use an explicit empty
  `union() {}` placeholder.
- Module calls produce Geometry and are valid in Main and Module scopes.
- Module Calls may be directly or mutually recursive inside Module scopes. A
  Module Call remains forbidden in a Function scope. Recursive Calls use the
  same ordinary ports, fallbacks, children, and lifecycle as acyclic Calls.

## Functions

A Function is ordinary OpenSCAD `function name(parameters) = expression;`—no
imperative return.

- Its Output has exactly one typed value input/result. A Function graph permits
  values, math, conditionals, and compatible Function Calls, never Geometry
  nodes, Module calls, or actions.
- Result type is Number, Boolean, or Vector3. An unresolved Function is a valid
  saveable draft but emits no declaration and cannot create new calls. Existing
  calls become unresolved drafts and incompatible outgoing wires are handled by
  the normal preflight/confirmation lifecycle.
- Function calls produce the definition result type and may be direct or
  mutually recursive within Function scopes. OpenSCAD, not JavaScript,
  evaluates them.

Generate resolved Functions first, then Modules, then Main. Both declaration
passes collapse recursive strongly connected components through the same
dependency analysis: components remain callee-before-caller, and members of
one component retain stable project/definition order. Only Calls reachable
from an owning Output participate; disconnected recursive-looking drafts do
not affect order or SCC membership. SCADlet intentionally does not prove
termination for either definition kind; OpenSCAD-WASM remains the evaluator.

## Presentation and creation

Frames derive bounds from their scoped nodes; frame geometry is presentation,
not semantic truth. Transfer of ordinary nodes between scopes happens only on a
completed drag and is atomic: preflight all touching connections under proposed
scopes, reject invalid cross-scope results, and never silently delete wires.
Protected interfaces cannot transfer.

The existing sidebar contains dynamic My Modules/My Functions sections. A
definition entry creates a compact call node through the shared creation path;
separate focus/edit/delete actions operate on the definition. Keep management
actions identity-preserving and confirm destructive impacts. Do not expand this
infrastructure into variables, closures, macros, or a broad type system.
