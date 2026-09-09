# The `.scadlet` project file format (v5)

This document specifies the `.scadlet` project file format as it is
**actually implemented** in this repository, not as originally sketched in
`AGENTS.md`. If you find a discrepancy between this document and the code,
the code under `src/persistence/` and `src/editor/node-catalog.ts` is the
source of truth until this document is updated to match it.

## Version 5: Function definitions

Version 5 adds user-defined Functions alongside Modules - see "Function
definitions (version 5)" below. Existing v4 (Module-only) projects migrate
to v5 unchanged, with an empty Function registry.

## Version 4 definitions and semantic signatures

v2 records each node's OpenSCAD semantic arguments rather than renderer
controls. A new Cube therefore has `{}` parameters and generates `cube()`.
When Size is active, `sizeRepresentation` is `"scalar"`, `"xyz"`, or
`"vector"`; scalar and XYZ literals are retained independently as
`sizeScalar`/`sizeVector`, while `size` contains the active literal form
(and is absent for the connection-only Vector representation). Adding Center
stores `"center": true` only when it changes the signature.
Cylinder and Sphere similarly omit unset optional arguments. Connections are
still stored separately and address the semantic parameter port (`size`,
`vector`, `x`, `y`, `z`, `h`, `r`, `center`, and so on), never a DOM
control. The current socket vocabulary is Geometry, Number, Vector3, and
Boolean; a connection is valid only when both ports have the same type.

Union and Intersection use `parameters.children`, an ordered non-empty list
of `{ "id": "..." }` stable child-slot identities. Their target input ports
are `child:<id>`; a trailing empty slot is retained so adding a connection
never renumbers earlier children. Difference remains asymmetric with `base`
and `subtract`.

The loader migrates v1 Cubes from `sizeX`/`sizeY`/`sizeZ` into v2 `size`, and
migrates v1 Union/Intersection `a`/`b` connection endpoints into deterministic
v2 child slots. v3 adds a project-level `definitions` array; v4 adds an
ordered Module Geometry-child signature. Existing v1/v2 projects migrate to
an empty definition array and v3 projects migrate their one structural child
port into the first Geometry input. It validates the migrated result before opening it. Unsupported
newer versions are rejected instead of being guessed at.

## Status and compatibility

- `.scadlet` files are plain **JSON** (UTF-8 text), pretty-printed with
  2-space indentation by SCADlet's own writer (`JSON.stringify(project,
  null, 2)` in `src/persistence/file-service.ts`). They are meant to be
  human-readable and diff-friendly, not compressed or base64-encoded.
- The top-level object always has `"format": "scadlet"` and an integer
  `"version"`. The format version is **independent of the SCADlet
  application/package version** - bumping the app's `package.json`
  version never implies a format change, and vice versa.
- The current format version is **`5`**. Versions 1–4 are accepted on input
  and explicitly migrated to v5; writers and browser autosave always emit v5.
- Unknown/future format versions are rejected outright with a clear error
  (`Unsupported SCADlet project version: N`) - there is no attempt to
  guess-parse a newer format. See "Versioning and migrations" below.
- **Compatibility status: v1 should be treated as internal-but-versioned,
  not yet a stable long-term public format.** SCADlet is pre-1.0,
  Milestone 5 (persistence) only just landed, and no external tooling or
  released version depends on `.scadlet` files yet. The format is
  explicit and validated (so existing files won't silently corrupt), but
  no long-term backward-compatibility promise is made beyond "version 1
  files keep parsing as version 1 files, or a future version will ship an
  explicit migration". Treat early v1 files as good test/example fixtures
  rather than as an archival guarantee.

## Top-level structure

A complete example (see `docs/examples/empty-project.scadlet` for the
exact, test-verified fixture this is based on):

```json
{
  "format": "scadlet",
  "version": 5,
  "metadata": {
    "name": "Gearbox Experiment",
    "createdAt": "2026-09-01T00:00:00.000Z",
    "updatedAt": "2026-09-01T00:00:00.000Z"
  },
  "graph": {
    "nodes": [],
    "connections": []
  },
  "definitions": [],
  "editor": {
    "viewport": {
      "x": 0,
      "y": 0,
      "zoom": 1
    }
  },
  "viewer": {
    "camera": {
      "position": [80, 80, 60],
      "target": [0, 0, 0]
    }
  }
}
```

| Field      | Type                | Required | Meaning                                                          |
| ---------- | ------------------- | -------- | ----------------------------------------------------------------- |
| `format`   | `"scadlet"` literal | Yes      | Discriminates this file as a SCADlet project, not arbitrary JSON.  |
| `version`  | integer             | Yes      | Format version. Versions `1`–`4` migrate; v5 is current.          |
| `metadata` | object              | Yes      | Project-level descriptive information. See below.                 |
| `graph`    | object               | Yes      | Semantic program graph: nodes + connections. See below.           |
| `definitions` | array              | Yes      | Project-owned Module and Function definition graphs. See below.    |
| `editor`   | object               | Yes      | Editor/canvas presentation state (currently just the viewport).   |
| `viewer`   | object               | Yes      | 3D viewer presentation state (currently just the camera).         |

`metadata`, `graph`, `editor`, and `viewer` are required objects, and
`definitions` is a required array;
omitting any of them fails validation (`Project "X" must be an object.`).

Implementation: `ScadletProjectV1` in
[`src/persistence/project.ts`](../src/persistence/project.ts); parsed and
validated by `parseScadletProject`/`parseScadletProjectText` in
[`src/persistence/validate.ts`](../src/persistence/validate.ts).

## `metadata`

```json
{
  "name": "Gearbox Experiment",
  "createdAt": "2026-09-01T00:00:00.000Z",
  "updatedAt": "2026-09-01T00:00:00.000Z"
}
```

| Field       | Type   | Required | Meaning                                                              |
| ----------- | ------ | -------- | ---------------------------------------------------------------------- |
| `name`      | string | Yes      | The project's display name. Must be non-empty after trimming whitespace. |
| `createdAt` | string | No       | Timestamp of the project's first save.                                |
| `updatedAt` | string | No       | Timestamp of the most recent save.                                    |

- SCADlet's own writer always emits `createdAt`/`updatedAt` as
  `Date.toISOString()` (ISO 8601, UTC, millisecond precision), but **the
  loader does not verify their format** - it only checks that, if
  present, they are strings (`typeof === 'string'`). A file with
  `"createdAt": "not a date"` currently loads without error; only a
  non-string value (e.g. a number) is rejected.
- `metadata` never affects graph/OpenSCAD semantics. It is pure
  descriptive information.
- **The project name in the file is independent of the filename on
  disk.** `src/persistence/filename.ts`'s `toScadletFilename()` derives a
  *default* Save-As filename from `metadata.name` (sanitized and given a
  `.scadlet` extension), but nothing re-checks or enforces that a file's
  `metadata.name` still matches the filename it happens to be saved as -
  a user can freely rename the file on disk, or open a `foo.scadlet` file
  whose `metadata.name` is `"Bar"`.

## `graph`

```json
{
  "nodes": [ /* ScadletNodeDTO[] */ ],
  "connections": [ /* ScadletConnectionDTO[] */ ]
}
```

Both `nodes` and `connections` are **required arrays** (an empty project
still has `"nodes": []` and `"connections": []` explicitly present, not
omitted).

`graph` intentionally mixes two different kinds of state in the same
subtree, as a pragmatic choice rather than an architectural ideal:

- **Semantic state** (defines the OpenSCAD model): each node's `type` and
  `parameters`, and all `connections`.
- **Visual/editor state** (defines how the graph looks in the editor):
  each node's `position`, and its optional `pinned` flag.

If a future refactor separates these more strictly (e.g. moving
`position`/`pinned` into `editor`), that would be a structural format
change requiring a new version - see "Versioning and migrations".

### Node record (`ScadletNodeDTO`)

```json
{
  "id": "sphere-1",
  "type": "sphere",
  "position": { "x": 270.65, "y": 313.2 },
  "parameters": { "mode": "radius", "r": 5, "d": 10 },
  "pinned": true
}
```

| Field        | Type                   | Required | Meaning |
| ------------ | ---------------------- | -------- | ------- |
| `id`         | string                 | Yes      | Persistent node identity. Must be non-empty and unique within `graph.nodes`. Connections reference nodes by this id. |
| `type`       | string                 | Yes      | Stable, language-independent node-type id. Must match a known catalog type (see below) - never a translated UI label, class name, or DOM id. |
| `position`   | `{ x: number, y: number }` | Yes  | The node's top-left origin in the editor's infinite-canvas graph coordinate space (the same space `AreaPlugin.translate(id, position)` uses) - editor layout, not OpenSCAD semantics. Both fields must be finite numbers. |
| `parameters` | object                 | Yes*     | This node type's full semantic state - see "Per-node parameter schemas". `*` May be omitted, in which case it defaults to `{}` before validation; this only actually succeeds for the three parameterless Boolean-operation node types (any node type with required fields will fail validation against an empty object). |
| `pinned`     | boolean                | No       | Explicit user "pin node open" presentation state. Omission means "not pinned" (`false`). See below. |

#### `id`

Node ids are opaque strings (SCADlet itself generates Rete's own
`crypto.randomUUID()`-style ids at creation time, but the format does not
require any particular id shape). Duplicate ids within the same file are
rejected (`Duplicate node id: "..."`).

#### `type`

The currently valid `type` values, all defined in the single node catalog
([`src/editor/node-catalog.ts`](../src/editor/node-catalog.ts)):

```text
cube
cylinder
sphere
translate
rotate
scale
difference
union
intersection
number
boolean
vector3
add
subtract
multiply
divide
module-inputs
module-output
module-call
function-inputs
function-output
function-call
```

An unrecognized `type` fails with `Unknown node type: "<value>"`. See
"Per-node parameter schemas" for each type's `parameters` shape and
"Connections" for each type's valid port ids.

#### `position`

Interpreted in the node-editor's own graph coordinate space - the same
space node positions have always lived in since before persistence
existed (`clientToGraphPosition`, `area.translate(id, position)` in
`src/editor/editor.ts`/`coordinates.ts`). It has no relationship to
OpenSCAD's 3D coordinate system.

#### `parameters`

Node-type-specific semantic state, validated and shaped entirely by that
node type's own validator (`NodeCatalogEntry.validateParams`) - never a
raw dump of Rete `ClassicPreset.Control` instances. See the per-node
sections below for exact shapes.

#### `pinned`

- Optional; **omitting the key means "not pinned"** (matches
  `NodePresentationManager`'s own default). When present, it must be a
  literal boolean.
- This is deliberately *presentation* state, not a graph/OpenSCAD
  parameter: a pinned node's controls are shown expanded in the editor,
  which has no effect on generated OpenSCAD.
- Explicit pinning is persisted because it is a deliberate user action.
  Hover-triggered temporary expansion and touch/selection-driven temporary
  expansion are **not** persisted - see "Persisted vs. transient state".
- The writer (`serializeProject` in `src/persistence/serialize.ts`)
  omits `pinned` entirely for an unpinned node rather than writing
  `"pinned": false` - both forms mean the same thing on read, but only
  the omitted form is what SCADlet itself currently produces.

## `definitions`

Version 3 introduces a separate semantic graph for each project-owned Module.
The Main `graph` remains the program body; a definition is never inferred from
the position of its visible same-canvas frame. Its stable `id` is independent
from its user-editable OpenSCAD-style `name`.

```json
{
  "id": "definition-wheel",
  "kind": "module",
  "name": "wheel",
  "interface": {
    "inputs": "wheel-inputs",
    "output": "wheel-output"
  },
  "geometryInputs": [
    { "id": "geometry-profile", "name": "Profile" }
  ],
  "parameters": [
    { "id": "parameter-radius", "name": "radius", "type": "number", "default": 10 }
  ],
  "graph": {
    "nodes": [
      { "id": "wheel-inputs", "type": "module-inputs", "position": { "x": 10, "y": 20 }, "parameters": {} },
      { "id": "wheel-cube", "type": "cube", "position": { "x": 170, "y": 20 }, "parameters": {} },
      { "id": "wheel-output", "type": "module-output", "position": { "x": 330, "y": 20 }, "parameters": {} }
    ],
    "connections": [{ "id": "wheel-body", "source": "wheel-cube", "sourceOutput": "geometry", "target": "wheel-output", "targetInput": "geometry" }]
  }
}
```

- `definitions` is always an array; v1/v2 files migrate to `[]`.
- Module names are non-empty OpenSCAD-style identifiers and unique per
  project. Names are not definition identity.
- `parameters` is an ordered signature. Each item has a stable non-empty
  `id`, a Module-unique OpenSCAD-style name, one of `number`, `boolean`, or
  `vector3`, and a matching finite literal default. Missing `parameters` in
  a historically written parameterless v3 record is normalized to `[]`;
  writers always include the array. The `module-inputs` node's own
  `parameters` remains `{}` in both forms: its dynamic ports are derived from
  the enclosing definition signature, never copied into node state.
- Parameter port IDs are `parameter:<id>`, derived from the signature during
  restore rather than serialized as renderer sockets. Future rename/reorder
operations therefore preserve existing wires through the stable ID.
Module names are mutable source labels: renaming a definition preserves its
stable definition ID, definition graph, and all `module-call.definitionId`
references. Deleting a definition removes its definition record, scoped graph,
and Calls as an ordinary v3 semantic mutation; no format-version change is
required.
`geometryInputs` is a distinct ordered signature of `{ id, name }` values.
Each stable id derives the matching Inputs output and Call input port
`geometry:<id>`. The Inputs output emits `children(index);`, where `index` is
its current signature order. Names are UI labels only, never port identity or
OpenSCAD identifiers. Calls emit connected child geometry in that order; gaps
before a later connected input use `union() {}` placeholders so child indices
never compact. There are no Geometry defaults or Call fallbacks.
Type changes retain the parameter ID but reset every Call fallback for that ID
to the new definition default after attached connections are removed. Deletion
preflights the complete dynamic signature and removes the ID, its Call fallback
entries, and only its attached connections as one editor operation; cancellation
or failure leaves the stored v3 payload unchanged. These Phase 4 edits do
not change the v3 schema.
- Each Module has exactly one `module-inputs` node and one `module-output`
  node. The latter owns the one stable Geometry input `geometry`.
- Ordinary catalog nodes may be created in this graph by dropping a static
  palette node into its frame. Their ownership is explicit in this enclosing
  graph record, never inferred continuously from their current coordinates.
  A completed ordinary-node drop may explicitly transfer a node/group between
  this graph, another Module graph, and Main when its connections remain
  scope-valid; the resulting enclosing graph is what persists.
- Nodes and connections are contained in exactly one graph scope. A
  connection cannot cross between Main and a definition graph.
- Definition-frame bounds are derived editor presentation from these member
  node positions; frame geometry is not serialized as semantic membership.

Definitions are emitted as OpenSCAD declarations in deterministic dependency
order: resolved Functions first, then Modules in effective callee-before-caller
order. The `module-output` Geometry connection is the one body root;
an unconnected Output emits an empty body. A declaration itself is never Main
geometry, so an unused definition does not render until a Main `module-call`
uses it.

### `module-call`

`module-call` is a generic Geometry-producing node, not a generated node type
named after a Module. It may occur in Main or in a Module definition graph.
Its parameter record contains the stable
definition reference plus independent literal fallbacks keyed by parameter ID:

```json
{ "definitionId": "definition-wheel", "arguments": { "parameter-radius": 25 } }
```

The referenced definition must exist in the same project's `definitions`
array and have `kind: "module"`; dangling references are rejected. The
The Module name/signature are resolved from the definition at load/runtime and
generate explicit named arguments such as `wheel(radius = 25);`; they are not
duplicated as authoritative call state. A connected typed value overrides but
does not erase the stored fallback.
Module Calls remain forbidden inside Function definition graphs. Function
Calls are permitted in Main, Module, and Function graphs, as described below.

## Function definitions (version 5)

Version 5 adds a second `kind` to `definitions`: `"function"`, sharing the
exact same stable-id parameter-signature and interface-role shape as a
Module (`interface.inputs`/`interface.output`, ordered `parameters`), but
with two differences: there is no `geometryInputs` field, and an optional
`resultType` records the Function's inferred value type once resolved.

```json
{
  "id": "definition-double-size",
  "kind": "function",
  "name": "double_size",
  "interface": { "inputs": "double-size-inputs", "output": "double-size-output" },
  "parameters": [
    { "id": "parameter-x", "name": "x", "type": "number", "default": 1 }
  ],
  "resultType": "number",
  "graph": {
    "nodes": [
      { "id": "double-size-inputs", "type": "function-inputs", "position": { "x": 10, "y": 20 }, "parameters": {} },
      { "id": "double-size-multiply", "type": "multiply", "position": { "x": 170, "y": 20 }, "parameters": { "a": 0, "b": 2 } },
      { "id": "double-size-output", "type": "function-output", "position": { "x": 330, "y": 20 }, "parameters": {} }
    ],
    "connections": [
      { "id": "x-to-a", "source": "double-size-inputs", "sourceOutput": "parameter:parameter-x", "target": "double-size-multiply", "targetInput": "a" },
      { "id": "multiply-to-output", "source": "double-size-multiply", "sourceOutput": "value", "target": "double-size-output", "targetInput": "result" }
    ]
  }
}
```

- `resultType` is one of `"number"`, `"boolean"`, or `"vector3"`, or omitted
  entirely while the Function is still an unresolved editor draft. It is
  never written as `null`.
- `resultType` and the graph's connections into `function-output`'s `result`
  input must agree: a resolved `resultType` requires exactly one such
  connection; an unresolved Function must have none. Either mismatch is
  rejected at load time.
- `function-inputs` has no Geometry outputs, only the same
  `parameter:<id>` typed value outputs Module Inputs uses for its own value
  parameters - a Function's parameter signature never includes a Geometry
  type.
- `function-output` has exactly one input, the stable port id `result`. Its
  socket type is the owning Function's `resultType` when resolved; while
  unresolved it accepts no real connection at all (see above), and is
  rendered as a neutral/grey socket rather than any of the three real types.
- A Function definition graph may only contain `function-inputs`,
  `function-output`, `function-call`, and the existing value/math vocabulary
  (`number`, `boolean`, `vector3`, `add`, `subtract`, `multiply`, `divide`).
  Any Geometry-producing/consuming node type, Module interface node, or
  `module-call` is rejected.
- Effective dependencies are derived only from Calls whose values/Geometry can
  reach their owning Function/Module Output. Disconnected/dead Calls do not
  affect declaration order or cycle validation. Resolved Functions are emitted
  in deterministic callee-before-caller order before Modules; Modules are then
  emitted in deterministic callee-before-caller order. Direct and indirect
  effective Function or Module recursion is rejected.
- An unresolved Function is not emitted and cannot be used to create a new
  Call. Existing Calls may remain as disconnected drafts with an unresolved
  output so result disconnection and callee deletion can be saved safely.

### `function-call`

`function-call` is a generic value-producing node, exactly parallel to
`module-call` but producing one typed value output (port id `value`) instead
of Geometry. It may occur in Main, a Module definition graph, or a Function
definition graph:

```json
{ "definitionId": "definition-double-size", "arguments": { "parameter-x": 10 } }
```

The referenced definition must exist and have `kind: "function"`. A resolved
callee gives the Call its `resultType`; its stable parameter IDs define typed
`parameter:<id>` inputs and its per-Call fallbacks remain independent. A Call
inside another Function participates in that caller's expression normally.
New Calls cannot be created for an unresolved Function, but a previously
existing disconnected Call is valid persisted draft state and restores with
an unresolved output. Any outgoing wire from such a Call is invalid.

Module Calls remain forbidden inside Function definitions; both Call kinds are
valid in Module definitions.

Existing v4 projects (Modules only, no Functions) migrate to v5 unchanged,
with an empty Function entries in the shared `definitions` array.

## Per-node parameter schemas

Every parameter name below is the exact, persisted property name (as
returned by that node class's own `getPersistedParams()` method and
validated by that type's `validate*Params` function) - not a UI label.
Optional semantic parameters are omitted while inactive. A representation
may retain literal editor state (for example Cube's Scalar and XYZ forms)
without retaining inactive sockets or connections.

### Value and math nodes

`number` stores `{ "value": number, "name": string }`; `boolean` stores
`{ "value": boolean, "name": string }`; and `vector3` stores finite numeric
`{ "x": number, "y": number, "z": number, "name": string }`. The four math types
(`add`, `subtract`, `multiply`, `divide`) each store
`{ "a": number, "b": number }`. These are fallback literals for their
input ports, not precomputed results. Generated graph values remain OpenSCAD
expressions: a Vector3 emits `[x, y, z]` and math emits explicit grouping
such as `(a + b)`. Connecting a value replaces the relevant fallback during
evaluation but does not erase it from this persisted record.

All source and math value outputs use the stable port id `value`; Vector3
uses Number inputs `x`, `y`, and `z`; math uses Number inputs `a` and `b`.
`name` is a SCADlet-only human-readable source label, not an OpenSCAD
variable or graph identity. It is optional when loading older v2 files and
normalizes to the source type name. Number/Boolean sources have no inputs.
Transient inspect selection and the
value result returned by OpenSCAD `echo()` are deliberately excluded from
the project file.

### `cube`

Source: [`src/openscad/cube.ts`](../src/openscad/cube.ts)
(`CubeParams`/`validateCubeParams`).

```json
{
  "sizeRepresentation": "xyz",
  "size": { "x": 20, "y": 10, "z": 10 },
  "sizeScalar": 20,
  "sizeVector": { "x": 20, "y": 10, "z": 10 },
  "center": true
}
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `sizeRepresentation` | `"scalar"` / `"xyz"` / `"vector"` | when Size is active | The sole active editor/input representation of semantic `size`. |
| `size` | number or `{x,y,z}` | Scalar/XYZ only | The active inline OpenSCAD literal. Omitted for connection-only Vector. |
| `sizeScalar` | number | when Size is active | Retained Scalar literal for later representation switching. |
| `sizeVector` | `{x,y,z}` | when Size is active | Retained XYZ literals for later representation switching. |
| `center` | boolean | no | OpenSCAD's optional `center` flag. |

Only the active representation's input ports may appear in `connections`:
`size` for Scalar, `sizeX`/`sizeY`/`sizeZ` for XYZ, or `sizeVector` for
Vector. Older v2 Cube records without `sizeRepresentation` are normalized
from their `size` literal (`number` → Scalar, vector → XYZ).

### `cylinder`

Source: [`src/openscad/cylinder.ts`](../src/openscad/cylinder.ts)
(`CylinderParams`/`validateCylinderParams`).

```json
{ "h": 10, "mode": "radius", "r": 5, "center": true, "fn": 50 }
```

| Field    | Type              | Required | Constraint                                  | Meaning |
| -------- | ----------------- | -------- | -------------------------------------------- | ------- |
| `h`      | number             | No       | finite                                        | Cylinder height. |
| `mode`   | string             | No       | one of `"radius"`, `"diameter"`, `"tapered"`  | Which of OpenSCAD's mutually exclusive sizing forms is active. |
| `r`      | number             | No       | finite                                        | Radius, only valid/active in `"radius"` mode. |
| `d`      | number             | No       | finite                                        | Diameter, only valid/active in `"diameter"` mode. |
| `r1`     | number             | No       | finite                                        | Bottom radius, only valid/active in `"tapered"` mode. |
| `r2`     | number             | No       | finite                                        | Top radius, only valid/active in `"tapered"` mode. |
| `center` | boolean            | No       | -                                              | OpenSCAD's `center` flag; its port is Boolean. |
| `fn`     | number (optional)  | No       | finite when present                           | `$fn` facet count. Omission means "not set" (OpenSCAD's own default applies). |

Only the active sizing form's Number ports exist: `r`, `d`, or `r1`/`r2`.
Inactive sizing ports cannot be referenced by a persisted connection.

### `sphere`

Source: [`src/openscad/sphere.ts`](../src/openscad/sphere.ts)
(`SphereParams`/`validateSphereParams`).

```json
{ "mode": "radius", "r": 25, "fn": 50 }
```

| Field  | Type              | Required | Constraint                        | Meaning |
| ------ | ----------------- | -------- | ---------------------------------- | ------- |
| `mode` | string             | No       | one of `"radius"`, `"diameter"`    | Which sizing form is active. |
| `r`    | number             | No       | finite                              | Radius, only active in `"radius"` mode. |
| `d`    | number             | No       | finite                              | Diameter, only active in `"diameter"` mode. |
| `fn`   | number (optional)  | No       | finite when present                | `$fn` facet count; omission means "not set". |

Sphere has no `center` field - OpenSCAD's `sphere()` is always centered
at the origin.

### `translate`, `rotate`, `scale`

All three share one shape. Source:
[`src/openscad/transform.ts`](../src/openscad/transform.ts)
(`Vector3Params`/`validateVector3Params`).

```json
{ "x": 10, "y": -5, "z": 2.5, "representation": "xyz" }
```

| Field | Type   | Required | Constraint | Meaning |
| ----- | ------ | -------- | ---------- | ------- |
| `x`   | number | Yes      | finite     | X component. |
| `y`   | number | Yes      | finite     | Y component. |
| `z`   | number | Yes      | finite     | Z component. |
| `representation` | `"xyz"` / `"vector"` | No | defaults to `"xyz"` for older v2 files | The one active editor/input representation of the semantic vector. |

Meaning of the vector depends on `type`: a translation offset, an Euler
rotation in degrees (simple `rotate([x, y, z])` vector form only - not
OpenSCAD's alternate `rotate(a=, v=)` axis-angle form), or a per-axis
scale factor. `rotate`'s defaults are `{x:0,y:0,z:0}`, `scale`'s are
`{x:1,y:1,z:1}`, `translate`'s are `{x:0,y:0,z:0}` - but a persisted file
must always include all three regardless of whether they equal those
defaults. In `"xyz"` representation, only Number ports `x`, `y`, and `z`
are active; in `"vector"` representation, only the Vector3 port `vector`
is active. The retained XYZ literals are preserved while Vector is selected.

### `difference`, `union`, `intersection`

These three Boolean-operation node types currently have **no persisted
parameters at all** - all of their state is their input connections
(see "Connections" below). `parameters` should be `{}`; if present, it
must be a plain object (any contents are currently ignored rather than
rejected - see "Forward compatibility" under Validation).

```json
{}
```

## Connections

```json
{
  "id": "c1",
  "source": "cube-1",
  "sourceOutput": "geometry",
  "target": "union-1",
  "targetInput": "a"
}
```

| Field          | Type   | Required | Meaning |
| -------------- | ------ | -------- | ------- |
| `id`           | string | Yes      | The connection's own id. Must be non-empty and unique within `graph.connections`. |
| `source`       | string | Yes      | The id of the node this connection reads from. Must match an existing node's `id`. |
| `sourceOutput` | string | Yes      | The stable output port id on the source node (see below). |
| `target`       | string | Yes      | The id of the node this connection feeds into. Must match an existing node's `id`. |
| `targetInput`  | string | Yes      | The stable input port id on the target node (see below). |

- Connection ids **are persisted** (Rete's own generated id, carried
  through verbatim). They carry no semantic meaning of their own - graph
  topology is fully defined by `source`/`sourceOutput`/`target`/
  `targetInput` - but persisting the original id keeps restoration fully
  deterministic (repeated save → open → save cycles produce byte-
  identical output) without inventing a separate id-regeneration policy.
- `source`/`target` are validated against the *other nodes already
  present in the same file's `graph.nodes`* - a connection referencing a
  missing node fails with `Connection "..." references missing source/
  target node "..."`. Nodes do not need to appear in the array before the
  connections that reference them.
- `sourceOutput`/`targetInput` are **stable semantic port ids**, never
  translated UI labels (e.g. Difference's inputs are `base`/`subtract`
  even though the UI shows "Base"/"Subtract"). They are validated against
  each node type's fixed, catalog-declared port list - not against a
  constructed node instance. Dynamic parameter ports are checked against the
  node's validated semantic parameters, so inactive alternatives cannot carry
  hidden persisted connections. The loader also rejects cross-type edges with
  a user-facing incompatible-socket-types error; no implicit conversions are
  defined.

Currently valid ports per node type
(`NodeCatalogEntry.inputs`/`.outputs` in `node-catalog.ts`):

```text
cube:          dynamic inputs: size | sizeX,sizeY,sizeZ | sizeVector; optional center (Boolean); outputs: geometry
cylinder:      dynamic inputs: h, active r|d|r1,r2, optional center (Boolean), fn; outputs: geometry
sphere:        dynamic inputs: active r|d, optional fn; outputs: geometry
translate:     inputs: geometry + active x,y,z | vector; outputs: geometry
rotate:        inputs: geometry + active x,y,z | vector; outputs: geometry
scale:         inputs: geometry + active x,y,z | vector; outputs: geometry
difference:    inputs: base, subtract      outputs: geometry
union:         dynamic inputs: child:<id>   outputs: geometry
intersection:  dynamic inputs: child:<id>   outputs: geometry
number:        inputs: none                 outputs: value (Number)
boolean:       inputs: none                 outputs: value (Boolean)
vector3:       inputs: x, y, z (Number)     outputs: value (Vector3)
add:           inputs: a, b (Number)        outputs: value (Number)
subtract:      inputs: a, b (Number)        outputs: value (Number)
multiply:      inputs: a, b (Number)        outputs: value (Number)
divide:        inputs: a, b (Number)        outputs: value (Number)
module-inputs: dynamic outputs: parameter:<id> (Number|Boolean|Vector3)
module-call:   dynamic inputs: parameter:<id> (referenced signature); outputs: geometry (Geometry); parameters: definitionId, arguments
```

Port-level addressing (rather than plain node-to-node edges) exists
specifically so nodes with more than one input of the same type
(Difference/Union/Intersection today) round-trip unambiguously, and so
future node types can expose multiple Geometry and/or value/parameter
inputs without any change to the connection representation itself.

## Editor viewport

```json
"editor": {
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

| Field  | Type   | Required | Meaning |
| ------ | ------ | -------- | ------- |
| `x`    | number | Yes      | Finite. Canvas pan offset X - the same value as Rete `AreaPlugin`'s `area.area.transform.x`. |
| `y`    | number | Yes      | Finite. Canvas pan offset Y - `transform.y`. |
| `zoom` | number | Yes      | Finite. Canvas zoom level - `transform.k`. |

`editor.viewport` is restored via `area.area.translate(x, y)` followed by
`area.area.zoom(zoom, 0, 0)` (an *absolute* zoom-level set, not a
relative delta - see `scadlet-app.ts`). It is pure editor presentation
state and never affects generated OpenSCAD. Current node/marquee
selection, in-progress drag state, and node foreground/z-order are never
part of this or any other section - see the transient-state table below.

## Viewer camera

```json
"viewer": {
  "camera": {
    "position": [80, 80, 60],
    "target": [0, 0, 0]
  }
}
```

| Field      | Type                            | Required | Meaning |
| ---------- | ------------------------------- | -------- | ------- |
| `position` | 3-element number array `[x,y,z]`| Yes      | The Three.js camera's world position. |
| `target`   | 3-element number array `[x,y,z]`| Yes      | The `OrbitControls` look-at target. |

Both arrays must have exactly 3 finite numbers each (`Invalid viewer.camera.position: expected an array of 3 numbers.` otherwise).

- Coordinates follow the viewer's OpenSCAD-consistent **Z-up**
  convention (`src/components/geometry-viewer.ts` sets `camera.up.set(0,
  0, 1)`), not Three.js's default Y-up.
- This is view state, never model semantics; the raw `THREE.
  PerspectiveCamera`/`OrbitControls` objects are never serialized -
  `GeometryViewer.getCameraState()`/`.setCameraState()` convert to/from
  this small plain DTO.
- **Camera field of view, projection type, zoom/dolly factor, near/far
  clipping planes, and any other camera property are currently NOT
  persisted.** Only `position` and `target` are captured. A reopened
  project always uses the viewer's fixed default `PerspectiveCamera`
  configuration (50° FOV) with the restored position/target applied.

## Persisted vs. intentionally transient state

| State                              | Persisted? | Reason |
| ----------------------------------- | ---------- | ------ |
| Node ids/types                      | Yes        | Graph identity. |
| Node parameters                     | Yes        | Model/OpenSCAD semantics. |
| Connections                         | Yes        | Model/OpenSCAD semantics. |
| Node positions                      | Yes        | Editor layout. |
| Canvas viewport (pan/zoom)          | Yes        | Editor layout. |
| Viewer camera position/target       | Yes        | User's 3D view. |
| Explicit pin state                  | Yes        | Deliberate user presentation state. |
| Hover-triggered temporary expansion  | No         | Transient interaction state. |
| Touch/selection-driven expansion     | No         | Transient interaction state. |
| Node/marquee selection               | No         | Transient interaction state. |
| Marquee drag rectangle               | No         | Transient interaction state. |
| Inspect Node preview root             | No         | Temporary preview state, not part of the model. |
| Node foreground/z-order (bring-to-front) | No     | Transient interaction state. |
| Camera field of view/zoom/clipping   | No         | Not currently captured at all (see above). |

Opening a `.scadlet` file always starts with no active Inspect Node root
and no selection, regardless of what was true when the file was saved.

## Validation rules

`parseScadletProject`/`parseScadletProjectText`
([`src/persistence/validate.ts`](../src/persistence/validate.ts)) enforce,
in roughly this order:

1. The input is valid JSON (`parseScadletProjectText` only).
2. The top-level value is a plain (non-array) object.
3. `format` is present and equals `"scadlet"`.
4. `version` is present and numeric; only `1` is currently accepted -
   any other number fails with `Unsupported SCADlet project version: N`.
5. `metadata` is an object with a non-empty (after trim) `name`;
   `createdAt`/`updatedAt`, if present, are strings (content not
   otherwise validated).
6. `graph` is an object with `nodes`/`connections` arrays.
7. Every node has a unique, non-empty `id`; a `type` matching a known
   catalog entry; a `position` with two finite numbers; and `parameters`
   that pass that type's own validator (errors are prefixed with the
   node id and type, e.g. `Invalid parameters for node "n1" (sphere):
   Invalid Sphere parameter "r": expected a finite number`); `pinned`, if
   present, is a boolean.
8. Every connection has a unique, non-empty `id`; `source`/`target`
   referencing existing node ids; `sourceOutput`/`targetInput` that are
   valid ports (per that node's type) for that side.
9. `editor.viewport` and `viewer.camera` are validated as described
   above.

**Strictness is not uniform across the format**, and this is
intentional:

- Node **types**, **positions**, **required parameter fields**,
  **connection endpoints/ports**, **viewport**, and **camera** fields are
  all strictly validated - a wrong type/shape fails loading immediately
  with a specific message.
- **Unknown extra fields anywhere in the JSON** (an extra top-level key,
  an extra key inside `metadata`/a node/a connection/`editor`/`viewer`,
  or extra keys inside a parameterless Boolean node's `parameters`) do
  **not** cause a validation error. However, because every validator
  builds a *fresh* result object field-by-field rather than shallow-
  copying its input, **unrecognized extra fields are silently dropped**
  during parsing rather than round-tripped - opening a hand-edited file
  with a speculative extra field and then re-saving it from SCADlet will
  not preserve that field. This is consistent with AGENTS.md's stated
  forward-compatibility policy ("unknown additional fields may generally
  be ignored") but is worth knowing if you're hand-authoring files with
  fields intended for a not-yet-released newer SCADlet version.
- There is **no formal JSON Schema** for this format; validation is
  plain, explicit TypeScript code (`src/persistence/validate.ts` plus
  each node type's `validate*Params` function). This document, not a
  machine-readable schema file, is the specification.

## Load behavior / atomicity

Parsing and validation (`parseScadletProject`/`parseScadletProjectText`)
always run to completion - success or a thrown `ScadletProjectError` -
**before** anything about the currently open project is touched.
`restoreProject` (`src/persistence/restore.ts`), which actually clears
and rebuilds the live graph, is only ever called after validation has
already fully succeeded.

Practical guarantee: **a malformed or unsupported `.scadlet` file does
not destroy the currently open valid project merely because opening it
was attempted.** Verified in this project's Playwright browser checks:
attempting to open an unsupported-version file, and separately a
non-JSON file, both leave the existing in-editor graph completely
unchanged and surface the specific error message instead.

Limitation: this guarantee covers the validation phase, not a full
transactional rollback of `restoreProject` itself. If node/connection
*construction* were to throw after validation already succeeded (not
currently reproducible - construction only uses already-validated data),
the graph could be left partially rebuilt. This is accepted as
sufficient given the scope of the current implementation rather than
building dedicated transactional infrastructure for a failure mode that
validation should already prevent.

## Versioning and migrations

```text
format = "scadlet"
version = 1
```

`parseScadletProject` routes on `version` through a single
`migrateScadletProject(version, raw)` function
(`src/persistence/validate.ts`). v1 first migrates to v2, then v3, then v4,
then v5; v2 migrates through v3/v4 to v5; v3's legacy `children` connections
are remapped to the deterministic first Geometry signature entry before
validation. v4 → v5 is a pure version-number bump: every existing v4 record
is already a valid `kind: "module"` definition, and the (already-empty
unless populated) `definitions` array simply gains the ability to also
contain `kind: "function"` entries going forward.
canonical form. No other call site needs to know about historical shapes:

```text
v1 → migrate to v2 → migrate to v3 → migrate to v4 → migrate to v5 → validate against the current shape
```

Rules of thumb for whether a change needs a version bump:

**Probably no version bump needed** (internal refactor, same persisted
meaning):

- Rete's internal graph/dataflow implementation changes.
- The DOM renderer (`render.ts`) is rewritten.
- CSS/layout implementation changes.
- Internal node-catalog code organization changes, as long as the
  persisted `type`/`parameters`/port ids for existing node types are
  unchanged.

**Likely needs a version bump + migration**:

- A persisted field's meaning changes (e.g. `position` starts meaning
  node *center* instead of top-left).
- A node type's parameter representation changes incompatibly (e.g.
  Cylinder's `r1`/`r2` are renamed or restructured).
- Port ids change for an existing node type.
- Connections acquire fundamentally different semantics (e.g. multiple
  simultaneous connections into a currently-single-connection input).

Do not encode hypothetical future migrations into version-1 files, and do
not silently accept an unknown future version - both are explicitly
rejected by the current implementation.

## Restore and local-library failure isolation

Parsing/normalization completes before SCADlet replaces the live editor. It
also prepares every node and dynamic Module port before clearing the current
graph; an unexpected error while applying the prepared graph rolls back to the
previous valid project. A failed load never becomes the active autosave target,
so opening a project cannot overwrite its IndexedDB record merely by failing.

IndexedDB access failures and individual project failures are intentionally
separate. An invalid, incompatible, or editor-unrestorable record remains in
the local library unchanged and visible for explicit deletion, while other
projects can still be selected and new projects created. Only an actual
IndexedDB initialization/access failure disables the local library and falls
back to file-only use.

## Adding a new persistable node type

Persistence is centralized in the node catalog
([`src/editor/node-catalog.ts`](../src/editor/node-catalog.ts)); nothing
in `validate.ts`/`serialize.ts`/`restore.ts`/`project.ts` mentions a
specific node type by name. To make a new node type persistable:

1. Implement the node's Rete class and OpenSCAD codegen as usual
   (`src/openscad/*.ts`, `src/editor/nodes/*.ts`), including a public
   `getPersistedParams()` method returning its full semantic parameter
   object (reused internally by `data()` too, so there is one source of
   truth).
2. Add a `validate<Type>Params(value: unknown): <Type>Params` function
   next to that node's param type, built from the shared primitives in
   [`src/openscad/param-validation.ts`](../src/openscad/param-validation.ts)
   (`requireFiniteNumber`, `requireBoolean`, `requireOneOf`,
   `requireOptionalFiniteNumber`, `requireParamsObject`). Remember to
   validate every field the node keeps internally, not just whichever
   ones the current UI mode shows.
3. Add the new stable id to the `NodeTypeId` union in `node-catalog.ts`.
4. Add a `NodeCatalogEntry` with: `type`, `category`, `labelKey`,
   `inputs`/`outputs` (the node's actual, fixed port ids), `create(context,
   params?)`, `matches(node)` (an `instanceof` check against the node
   class), `serializeParams(node)` (calls `getPersistedParams()`), and
   `validateParams(value)` (calls the new validator).

No changes are needed to the generic persistence pipeline itself.

## Example files

Three complete, currently-valid v1 examples live under
[`docs/examples/`](examples/) and are parsed through the real
`parseScadletProject()` implementation by
[`src/persistence/docs-examples.test.ts`](../src/persistence/docs-examples.test.ts)
- see "Keeping this document honest" below for why the examples are only
maintained in one place.

### Example A — empty project

[`docs/examples/empty-project.scadlet`](examples/empty-project.scadlet):

```json
{
  "format": "scadlet",
  "version": 1,
  "metadata": {
    "name": "Empty Project",
    "createdAt": "2026-09-01T00:00:00.000Z",
    "updatedAt": "2026-09-01T00:00:00.000Z"
  },
  "graph": { "nodes": [], "connections": [] },
  "editor": { "viewport": { "x": 0, "y": 0, "zoom": 1 } },
  "viewer": { "camera": { "position": [80, 80, 60], "target": [0, 0, 0] } }
}
```

### Example B — a Sphere with `$fn = 50`

[`docs/examples/sphere-fn50.scadlet`](examples/sphere-fn50.scadlet) - also
useful as a Render-performance benchmark fixture (see below):

```json
{
  "format": "scadlet",
  "version": 1,
  "metadata": {
    "name": "Sphere Benchmark",
    "createdAt": "2026-09-01T00:00:00.000Z",
    "updatedAt": "2026-09-01T00:00:00.000Z"
  },
  "graph": {
    "nodes": [
      {
        "id": "sphere-1",
        "type": "sphere",
        "position": { "x": 0, "y": 0 },
        "parameters": { "mode": "radius", "r": 25, "d": 50, "fn": 50 }
      }
    ],
    "connections": []
  },
  "editor": { "viewport": { "x": 0, "y": 0, "zoom": 1 } },
  "viewer": { "camera": { "position": [80, 80, 60], "target": [0, 0, 0] } }
}
```

### Example C — a composed graph

```text
Cube ─────┐
          ├→ Union → Translate
Sphere ───┘
```

[`docs/examples/cube-sphere-union-translate.scadlet`](examples/cube-sphere-union-translate.scadlet),
including non-trivial positions, a pinned node, a panned/zoomed viewport,
and a non-default camera:

```json
{
  "format": "scadlet",
  "version": 1,
  "metadata": {
    "name": "Cube Sphere Union Translate",
    "createdAt": "2026-09-01T00:00:00.000Z",
    "updatedAt": "2026-09-01T00:00:00.000Z"
  },
  "graph": {
    "nodes": [
      { "id": "cube-1", "type": "cube", "position": { "x": -200, "y": 0 }, "parameters": { "sizeX": 10, "sizeY": 10, "sizeZ": 10, "center": false } },
      { "id": "sphere-1", "type": "sphere", "position": { "x": -200, "y": 150 }, "parameters": { "mode": "radius", "r": 5, "d": 10 } },
      { "id": "union-1", "type": "union", "position": { "x": 0, "y": 75 }, "parameters": {} },
      { "id": "translate-1", "type": "translate", "position": { "x": 200, "y": 75 }, "parameters": { "x": 10, "y": 0, "z": 0 }, "pinned": true }
    ],
    "connections": [
      { "id": "c1", "source": "cube-1", "sourceOutput": "geometry", "target": "union-1", "targetInput": "a" },
      { "id": "c2", "source": "sphere-1", "sourceOutput": "geometry", "target": "union-1", "targetInput": "b" },
      { "id": "c3", "source": "union-1", "sourceOutput": "geometry", "target": "translate-1", "targetInput": "geometry" }
    ]
  },
  "editor": { "viewport": { "x": -50, "y": 20, "zoom": 1.2 } },
  "viewer": { "camera": { "position": [120, 100, 90], "target": [0, 0, 0] } }
}
```

### Keeping this document honest

The JSON shown above is a literal copy of the `.scadlet` fixture files
under `docs/examples/`, which are what `docs-examples.test.ts` actually
parses. They are intentionally maintained in only one authoritative
place (the fixture files) with this document's copies kept in sync by
hand; a test failure in `docs-examples.test.ts` is the signal that either
the fixtures or this document need attention. A Markdown-parsing test
that extracts fenced examples directly was considered but rejected as
unnecessary complexity for three short files.

## Benchmark/test-fixture use

Because a `.scadlet` file deterministically captures topology,
parameters (including `$fn`), and layout/view state, a saved project is
also a convenient deterministic fixture for regression tests and render
benchmarks - e.g. Example B above is sized specifically to be a
reasonable Render-performance probe for a tessellated primitive. This is
a reason to keep the format textual, explicit, and diff-friendly rather
than a motivation to define a separate formal benchmark format.

## File extension and content type

- File extension: **`.scadlet`**.
- Content: JSON, as described throughout this document.
- MIME type used consistently everywhere the implementation cares about
  one - the File System Access picker's `accept` map, the plain
  `<input type="file">` fallback's `accept` attribute, and the fallback
  Blob download - is **`application/json`** (see
  [`src/persistence/file-service.ts`](../src/persistence/file-service.ts)
  and `scadlet-app.ts`). No custom/registered MIME type (e.g. a
  hypothetical `application/vnd.scadlet`) is used anywhere.

## Security / trust boundary

`.scadlet` files are **untrusted external input**, exactly like any other
user-supplied file - they may come from another machine, another
SCADlet version, or a hand-edited/malicious source.

Current v1 files contain only **data**: strings, numbers, booleans, and
arrays/objects built from those. Loading a file never dynamically
`eval`s or constructs a class by an arbitrary name from its content - a
node's `type` string is only ever looked up in the fixed, hardcoded
`NODE_CATALOG` (`findCatalogEntry`), and an unrecognized type is rejected
rather than used to synthesize anything. Node `parameters` are plain
validated JSON values consumed by pure OpenSCAD code-generation
functions, never executed as code.

This trust boundary will need to be revisited once a Code Node (a
planned, later milestone per `AGENTS.md`) can embed literal OpenSCAD
source text: at that point a `.scadlet` file could carry content that is
subsequently fed to the OpenSCAD WASM interpreter, which changes what
"the file only contains inert data" means in practice, even though it
still would not directly execute arbitrary JavaScript in the browser.

## Implementation references

| Concern                              | Module |
| ------------------------------------- | ------ |
| Schema types, defaults                | `src/persistence/project.ts` |
| Parsing/validation                    | `src/persistence/validate.ts` |
| Serialization                         | `src/persistence/serialize.ts` |
| Restoration                           | `src/persistence/restore.ts` |
| Filename sanitization                 | `src/persistence/filename.ts` |
| Open/Save/Save As, File System Access | `src/persistence/file-service.ts` |
| Node type identity/persistence hooks  | `src/editor/node-catalog.ts` |
| Per-node param types + validators     | `src/openscad/{cube,cylinder,sphere,transform}.ts` |
| Shared param-validation primitives    | `src/openscad/param-validation.ts` |
| Viewer camera capture/restore         | `src/components/geometry-viewer.ts` |
| App-level Open/Save/dirty-state wiring | `src/scadlet-app.ts` |
| Example fixtures + drift-guard test   | `docs/examples/*.scadlet`, `src/persistence/docs-examples.test.ts` |
