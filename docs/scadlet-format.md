# The `.scadlet` project format

This is the canonical specification of SCADlet's persisted project data.
The current version is **8** (`SCADLET_VERSION` in
[`project.ts`](../src/persistence/project.ts)). Writers and autosave emit v8;
the loader accepts versions 1–8 and migrates older records before validation.
The application/package version is independent of the format version.

Files are UTF-8 JSON with extension `.scadlet` and MIME type `application/json`.
The writer uses two-space indentation. No formal JSON Schema is provided;
[`validate.ts`](../src/persistence/validate.ts) and the
[node catalog](../src/editor/node-catalog.ts) implement validation.
Storage, rollback, autosave, and version-change policy belong in
[Persistence](agent-guides/persistence.md). Behavioural semantics belong in
[Definitions](agent-guides/definitions.md) and [Editor and UX](agent-guides/editor-ux.md).

## Envelope and metadata

A complete current empty project:

```json
{
  "format": "scadlet",
  "version": 8,
  "metadata": {
    "name": "Empty Project",
    "createdAt": "2026-09-01T00:00:00.000Z",
    "updatedAt": "2026-09-01T00:00:00.000Z"
  },
  "graph": { "nodes": [], "connections": [] },
  "definitions": [],
  "editor": { "viewport": { "x": 0, "y": 0, "zoom": 1 } },
  "viewer": { "camera": { "position": [80, 80, 60], "target": [0, 0, 0] } }
}
```

| Field | Required shape |
| --- | --- |
| `format` | Exactly `"scadlet"` |
| `version` | Numeric supported version; the current value is `8` |
| `metadata` | Object with `name`, nonempty after trimming; optional string `createdAt` and `updatedAt` |
| `graph` | Main graph object with `nodes` and `connections` arrays |
| `definitions` | Array of Module and Function definitions, including `[]` for none |
| `editor` | Object containing `viewport` |
| `viewer` | Object containing `camera` |

All seven envelope fields are required in v8. Metadata timestamps are written
as ISO 8601 UTC strings but loading validates only their string type. The name
is independent of the disk filename; filename sanitization supplies a default
Save As name, not graph identity. `ScadletProjectV8` is the canonical TypeScript
type; `ScadletProjectV1` and `ScadletProjectV7` remain compatibility aliases.

## Graph records and identities

Every graph requires both arrays, even when empty. Nodes belong to exactly one
Main or definition graph. This containment is scope membership; frame positions
are not membership. Node IDs must be nonempty strings, unique across the entire
project. Definition IDs are nonempty and project-unique. Connection IDs are
nonempty and unique within their graph. IDs are opaque: no UUID shape is required.

### Nodes

```json
{
  "id": "sphere-1",
  "type": "sphere",
  "position": { "x": 270.65, "y": 313.2 },
  "parameters": { "mode": "radius", "r": 5, "fn": 50 },
  "collapsed": true
}
```

| Field | Contract |
| --- | --- |
| `id` | Stable node identity |
| `type` | Known language-independent catalog ID, never a label/class/DOM name |
| `position` | Required finite `x` and `y`, the node's top-left graph coordinates |
| `parameters` | Node-specific object described below; omitted or `null` is normalized to `{}` before its validator runs, succeeding only where empty parameters are valid |
| `collapsed` | Optional boolean; omission means expanded. The writer omits it for expanded nodes |

`position` and `collapsed` are presentation state, not OpenSCAD parameters.
The complete current catalog is:

```text
cube cylinder sphere translate rotate scale difference union intersection
number boolean vector3 pi arithmetic trigonometry basic-math vector-math
min-max exponential-log compare conditional if for for-result scad-settings
module-inputs module-output module-call function-inputs function-output
function-call variable-reference
```

### Connections

```json
{
  "id": "connection-1",
  "source": "cube-1",
  "sourceOutput": "geometry",
  "target": "union-1",
  "targetInput": "child:slot-1"
}
```

All five fields are required strings. Endpoints must exist in the same graph.
Ports are stable semantic IDs validated against catalog state and definition
signatures; row indices, labels, and inactive alternative ports are invalid.
Each input accepts at most one connection. Ordinary connections require equal
Geometry, Number, Boolean, or Vector3 types, without implicit conversion.
Unresolved is presentation metadata, not a persisted value type.

Each complete graph must be acyclic, including disconnected drafts. Binding
cycles are checked separately. This does not prohibit recursive definition
Calls, whose dependencies are distinct from node-dataflow edges. For pairs have
one persisted fixed `loop`→`loop` connection with the dedicated `structure`
socket type; it is not an ordinary semantic connection.

Connection IDs and endpoints survive restore unchanged. Round trips preserve
identity and meaning; normalization, metadata updates, and omitted defaults
mean byte-identical files are not guaranteed.

## Definitions and Calls

A Module record has this shape (the graph is abbreviated here):

```text
{
  id, kind: "module", name,
  interface: { inputs: <node ID>, output: <node ID> },
  parameters: [{ id, name, type, default }],
  geometryInputs: [{ id, name }],
  graph: { nodes: [...], connections: [...] }
}
```

A Function uses `kind: "function"`, no `geometryInputs`, and optional
`resultType: "number" | "boolean" | "vector3"`. Omit unresolved `resultType`;
`null` is invalid. Both kinds share the ordered parameter signature and interface
roles. Names are project-unique across both kinds and match
`^[A-Za-z_][A-Za-z0-9_]*$`; the validator does not check OpenSCAD reserved words.

| Signature field | Validation and identity |
| --- | --- |
| Parameter `id` | Nonempty, unique within signature; also a same-scope binding ID |
| Parameter `name` | Identifier, unique among parameters and bound Values in that scope |
| Parameter `type` | `number`, `boolean`, or `vector3` |
| Parameter `default` | Finite number, boolean, or exactly three finite numbers matching type |
| Geometry input `id` | Nonempty and unique within the ordered Geometry signature |
| Geometry input `name` | Nonempty after trim; display label, not an OpenSCAD identifier |

Missing definition `parameters` normalizes to `[]` for compatibility with old
parameterless records; writers include it. Module `geometryInputs` is required.
Each definition graph contains exactly one matching Inputs and Output node,
whose IDs match `interface`. These nodes have `{}` parameters; their ports
are derived from the owning signature. Interfaces are forbidden in Main;
Module and Function interfaces cannot appear in each other's scopes.

Module Inputs outputs `parameter:<id>` and Geometry `geometry:<id>`; Module
Output has one Geometry input `geometry`. Geometry signature order determines
`children(index);`; Call gaps before later connected children remain explicit
empty child blocks. Frame bounds are derived and are not persisted.

Function Inputs outputs only typed `parameter:<id>` ports. Function Output has
one `result` input. A resolved `resultType` requires exactly one matching result
connection; unresolved requires none. Function graphs permit only
`function-inputs`, `function-output`, `function-call`, `variable-reference`,
`number`, `boolean`, `vector3`, `pi`, `arithmetic`, `trigonometry`, `basic-math`,
`vector-math`, `min-max`, `exponential-log`, `compare`, and `conditional`.

### Call parameters

Both Call kinds store a nonempty `definitionId` and optional `arguments` object:

```json
{ "definitionId": "definition-wheel", "arguments": { "parameter-radius": 25 } }
```

The referenced definition must exist and have the corresponding kind.
`arguments` keys are parameter IDs, not names; unknown keys and wrong-typed
fallbacks are rejected. Missing fallbacks use the definition default when
constructed. Both Calls expose typed `parameter:<id>` inputs; Module Calls also
expose Geometry `geometry:<id>` inputs. Connected expressions override retained
Call fallbacks. Module
Calls occur only in Main/Module graphs and output `geometry`; Function Calls
occur in all three scopes and output `value` with the callee's result type.
A Call to an unresolved Function may persist as a disconnected draft but cannot
have outgoing wires. Deleting a callee does not license dangling Call records.

Direct and mutual recursion use these same fields without extra durable state.
Declaration ordering and safe signature edits are specified in
[Definitions](agent-guides/definitions.md).

## Per-node parameters and ports

All numeric fields below must be finite. Optional fields are omitted when
inactive unless explicitly retained as fallbacks. Ports are case-sensitive;
type names in prose are UI terminology, while lowercase IDs are serialized.

### Primitive Geometry

Primitives output `geometry`. Inputs are Number except Boolean `center` and
Cube's Vector3 `sizeVector`. Empty parameters are valid for Cube, Cylinder,
and Sphere and represent omitted OpenSCAD arguments.

| Type | Parameters | Active input ports |
| --- | --- | --- |
| `cube` | Optional `size` (number or `{x,y,z}`), `sizeRepresentation` (`scalar`, `xyz`, `vector`), retained `sizeScalar` (number), retained `sizeVector` (`{x,y,z}`), `center` (boolean) | Scalar: Number `size`; XYZ: Number `sizeX`, `sizeY`, `sizeZ`; Vector: Vector3 `sizeVector`; Boolean `center` when present |
| `cylinder` | Optional `h`, `r`, `d`, `r1`, `r2`, `fn` (numbers), `center` (boolean), `mode` (`radius`, `diameter`, `tapered`) | Present `h`, `fn`, `center`; present `r` in radius mode, `d` in diameter mode, `r1`/`r2` in tapered mode |
| `sphere` | Optional `r`, `d`, `fn` (numbers), `mode` (`radius`, `diameter`) | Present `fn`; present `r` or `d` in the selected mode |

Cube's writer retains Scalar/XYZ literals independently and omits active `size`
for connection-only Vector form. Its validator accepts optional retained fields
and infers missing `sizeRepresentation` from `size`: number → Scalar, object →
XYZ. It also recognizes the legacy `sizeX`/`sizeY`/`sizeZ` plus boolean `center`
shape; v1 migration converts normal v1 records as described below.

Cylinder/Sphere may retain inactive sizing literals, which are validated but do
not activate ports. Cylinder `h` is height; `r1`/`r2` are bottom/top radii.
`r` and `d` are radius and diameter. Sphere has no `center` parameter and is
centred at the origin. `fn` represents `$fn`;
omission leaves OpenSCAD's default. Validators do not require positive dimensions
or integer facet counts. See [Cube](../src/openscad/cube.ts),
[Cylinder](../src/openscad/cylinder.ts), and [Sphere](../src/openscad/sphere.ts).

### Transforms

`translate`, `rotate`, and `scale` require numeric `x`, `y`, `z`; optional
`representation` is `xyz`, `vector`, or `none`, defaulting to `xyz` when omitted.
All have Geometry input/output `geometry`. XYZ exposes Number inputs `x`/`y`/`z`;
Vector exposes only Vector3 `vector`; None exposes no value inputs and emits an
argumentless transform around its Geometry. XYZ literals remain stored in every
representation. Default Translate/Rotate values are zero; Scale values are one.
Rotate uses Euler degrees, not axis-angle form.

### Ordered Boolean Geometry inputs

`union` and `intersection` require `children: [{ "id": "..." }]`, a nonempty
ordered list of nonempty unique IDs; ports are `child:<id>`. `difference` uses
the same list with at least two entries: positions zero and one map to stable
ports `base` and `subtract`, and later IDs map to `child:<id>`. Missing Difference
`children` normalizes to `[{id: "base"}, {id: "subtract"}]`.

All output `geometry`. The editor retains an empty extension slot and appends
one when the last slot is connected; the file validator checks list shape and
port addressing but does not require a trailing disconnected Geometry slot.
Disconnecting Geometry leaves reusable slots; their order controls source order.

Legacy Union/Intersection slot IDs `a` and `b` restore with bare `a`/`b` port
keys. The validator also accepts bare IDs for other children, but restoration
constructs only `child:<id>` for those slots and rejects such edges during
preparation. Use canonical prefixed ports for non-legacy slots; this existing
validation/restoration mismatch does not change the format version.

### SCAD settings

`scad-settings` stores optional finite `fn`, `fa`, and `fs`. Present fields
activate matching Number inputs, with connected expressions overriding retained
fallbacks. There are no outputs. Main and each Module allow at most one;
Functions reject it. These are scope-level source settings, not render options.
Only these three names are recognized; unknown fields are discarded.

### Values and Variable references

| Type | Required parameters | Optional parameters | Inputs | Output |
| --- | --- | --- | --- | --- |
| `number` | `value` (number) | `name`, `bindingId` | Number `value` | Number `value` |
| `boolean` | `value` (boolean) | `name`, `bindingId` | Boolean `value` | Boolean `value` |
| `vector3` | Numeric `x`, `y`, `z` | `name`, `bindingId` | Vector3 `value`; Number `x`, `y`, `z` | Vector3 `value` |
| `variable-reference` | Nonempty string `bindingId` | None | None | `value`, resolved from same-scope binding |
| `pi` | None (`{}`) | None | None | Number `value`, expression `PI` |

Missing or non-string Value `name` normalizes to `Number`, `Boolean`, or
`Vector3`. Without `bindingId`, it remains a label. A present `bindingId` must
be a nonempty string and requires an identifier name unique among bound Values
and parameters in its scope. IDs also must be scope-unique. A reference stores
only binding identity, not a copied name/type, and cannot resolve across scopes.
Initial editor activation uses the Value node ID as its binding ID; later rename
or valid scope transfer preserves it. Clipboard copies receive fresh IDs.

Direct fields remain saved fallbacks. Whole-Vector3 `value` overrides preserved
component inputs/fallbacks. Binding assignment ordering and reference evaluation
follow [Definitions](agent-guides/definitions.md#value-definitions-and-variable-references).

### Math families

All output Number `value` except operation-dependent Vector Math.

| Type | Parameters | Operation IDs | Inputs |
| --- | --- | --- | --- |
| `arithmetic` | `operation`, numeric `a`, `b` | `addition`, `subtraction`, `multiplication`, `division`, `modulo`, `power` | Number `a`, `b` |
| `trigonometry` | `operation`, numeric `a`, `b`, `inputPorts` | `sin`, `cos`, `tan`, `asin`, `acos`, `atan`, `atan2` | Number `a`, plus `b` for `atan2` |
| `basic-math` | `operation`, numeric `x` | `abs`, `sign`, `sqrt`, `floor`, `ceil`, `round`, `negate` | Number `x` |
| `exponential-log` | `operation`, numeric `x` | `exp`, `ln`, `log` | Number `x` |
| `vector-math` | `operation`, numeric `a`, `b`, `factor` | `add`, `subtract`, `scale`, `divide`, `dot`, `cross`, `norm`, `negate` | See below |

Trigonometry `inputPorts` must be exactly `["a"]` for unary operations or
`["a", "b"]` for `atan2`, without duplicates/reordering. Its `b` fallback stays
persisted while inactive. `atan2` emits `atan2(a, b)` (Y then X).
Arithmetic power emits `pow(a, b)` and Number negate emits `-(x)`.

Vector Math ports/results are:

| Operations | Inputs | Result |
| --- | --- | --- |
| `add`, `subtract`, `cross` | Vector3 `a`, `b` | Vector3 |
| `dot` | Vector3 `a`, `b` | Number |
| `scale` | Vector3 `vector`, Number `factor` | Vector3 |
| `divide` | Vector3 `vector`, Number `divisor` | Vector3 |
| `norm` | Vector3 `vector` | Number |
| `negate` | Vector3 `vector` | Vector3 |

Vector inputs require connections; numeric `a` and `b` are retained schema
fields, not Vector3 literal fallbacks (the writer emits zero for them).
`factor` stores the shared scale/divisor fallback. Inactive ports cannot carry
persisted connections.

`min-max` stores `operation: "minimum" | "maximum"` and ordered
`operands: [{ id, value? }]`. It requires at least three records. The first two
IDs are exactly `a`, `b`, each with a numeric fallback. Later IDs are nonempty
and unique and address Number ports `operand:<id>`. Every optional interior
record needs a fallback or connection. The final record has no fallback or
connection: it is the blank extension slot. Unused interior and connected
trailing records are rejected. Output is Number `value`; blank optional values
are not numeric sentinels and do not enter the generated argument list.

### Comparison and conditionals

`compare` stores `operator` (`<`, `<=`, `>`, `>=`, `==`, `!=`) and numeric
`a`, `b` fallbacks. Omitted fallbacks normalize to zero. Inputs `a`, `b` are
Number; output `value` is Boolean.

`conditional` stores `{}` when unresolved or `valueType: "number" | "boolean"
| "vector3"`. Inputs are Boolean `condition` and typed `true`, `false`; output
is typed `result`. Unresolved state cannot have branch/result connections.
Resolved state requires at least one connected branch. A result connection
requires all three inputs connected, and both branches/result share the type.

`if` stores `{}` and has Boolean `condition`, Geometry `then`, optional Geometry
`else`, and Geometry output `geometry`. It is allowed only in Main/Module.
Incomplete drafts may persist; a reachable If needs Condition and Then for source
generation. It does not synthesize `undef`. Connected branches participate in
reachable dependencies even when the runtime condition chooses only one.

### For pairs

`for` stores nonempty `pairId`, `bindingId`, identifier `name`, and finite
`start`, `step`, `end`. Number inputs are `start`, `step`, `end`; outputs are
Number `value` and structural `loop`.

`for-result` stores the matching `pairId` and a nonempty ordered
`children: [{id}]` list with unique nonempty IDs. Its inputs are structural
`loop` and Geometry `child:<id>`; output is Geometry `geometry`.

Each pair has exactly one header, result, and fixed structural connection in
the same Main/Module graph. Pair IDs and iterator binding IDs are scope-unique.
Iterator wires/references are confined to dependencies entering the matching
result, including nested-loop lexical checks. Iterator names cannot collide
with Values or parameters of their scope. A nested iterator may reuse an
enclosing iterator's name unless the enclosing iterator is used inside the
nested body (the dependencies entering the nested result's Geometry slots,
including deeper loop ranges, but not the nested header's own range);
independent siblings may reuse a name.
Orphaned, duplicate, mismatched, cross-scope, and escaping pairs are rejected.
A zero direct step is rejected when not overridden by a connection; source
generation also rejects a known literal zero effective step.

A complete pair with no connected Geometry body remains a valid saved draft
and emits no fragment. The editor retains the result's trailing extension slot;
validation does not require a connected body or relax structural checks for it.

## View state

`editor.viewport` requires finite numeric `x`, `y`, `zoom`, corresponding to
Rete pan and absolute zoom (`transform.k`). Validation currently checks finiteness,
not positivity of zoom. Node positions use graph coordinates independently.

`viewer.camera` requires `position` and `target`, each an array of exactly three
finite numbers in the viewer's Z-up world coordinates. They represent camera
position and OrbitControls target, not geometry transforms. FOV, projection,
zoom, and clipping planes are not serialized; restore uses the viewer's default
perspective configuration (50° FOV) with these position/target values.

## Persistent and transient state

| State | Persisted? |
| --- | --- |
| Node/type IDs, parameters, stable-port connections | Yes |
| Definitions, signatures, bindings, pair IDs, dynamic slot ordering | Yes |
| Node positions and explicit collapse | Yes; omitted collapse means expanded |
| User canvas viewport and camera position/target | Yes |
| Selection, marquee, hover, drag, wire drafts/highlighting, foreground order | No |
| Inspect root, provenance, echoed values, rendered meshes/STL | No |
| Graph clipboard and Paste/Duplicate/reference placement ghosts | No |
| Popups, Live preference, debounce/revisions/freshness, preview cache | No |
| Fit graph / Reset 3D view adjustments | No; preserve saved view state |
| File handles and IndexedDB local-record identity | Not in `.scadlet` |

Opening a project starts without selection, Inspect, or placement. Clipboard
payloads cannot be imported/exported or pasted into another local project
identity. Persistent layout changes do not imply semantic render changes.

## Validation and normalization

`parseScadletProjectText` parses JSON; `parseScadletProject` accepts an already
parsed object. Invalid input throws `ScadletProjectError` before restoration.
Validation includes the envelope, per-node parameters, scope restrictions,
definition interfaces/Calls, matching typed ports, input occupancy, dataflow and
binding cycles, SCAD settings singleton, For structure/scoping, dynamic Min/Max
slots, conditional/result inference, and finite layout/camera values.

Unknown types and unsupported versions fail explicitly. Unknown additional
object fields are generally ignored and discarded when validators build the
canonical result; they are not a forward-field round-trip guarantee. Semantic
maps such as Call `arguments` are different: unknown parameter IDs are invalid.
Retained legacy/optional fields follow their documented normalizations above.

Loading treats projects as untrusted data. Types resolve only through the fixed
catalog; file contents do not select arbitrary constructors or execute
JavaScript. No raw OpenSCAD code node is part of this format.

## Historical migrations

All accepted historical versions pass through sequential migrations and then
the current validator. Unsupported numeric versions fail with
`Unsupported SCADlet project version: N`. Migration preserves existing IDs,
positions, collapse, and connections except for the explicit port mappings below.

| Step | Mapping and compatibility guarantee |
| --- | --- |
| v1 → v2 | Cube `sizeX`/`sizeY`/`sizeZ` becomes scalar `size` when equal, otherwise `{x,y,z}`; `center: true` is retained. Union/Intersection gain deterministic children `v1-a`, `v1-b`, `v1-next`; input endpoints `a`/`b` become `child:v1-a`/`child:v1-b` |
| v2 → v3 | Adds `definitions: []`; Main graph is preserved |
| v3 → v4 | Adds each Module's first Geometry signature entry with ID `<definitionId>:geometry-1`, name `Geometry 1`; legacy Inputs `children` output and Main Call `children` input endpoints map to `geometry:<id>` |
| v4 → v5 | Version-only change; existing Module definitions remain unchanged and no Function entries are invented |
| v5 → v6 | In Main and every definition, `add`, `subtract`, `multiply`, `divide` become `arithmetic` with `addition`, `subtraction`, `multiplication`, `division`; `a`/`b`/`value` endpoints and fallbacks survive |
| v6 → v7 | Version-only change; no SCAD settings node is invented, retaining OpenSCAD defaults |
| v7 → v8 | Version-only change; no binding IDs are invented from old Value names, which remain labels |

Within supported shapes, missing parameter signatures normalize to empty arrays,
old Cube representations infer from `size`, missing transform representation is
XYZ, missing Compare fallbacks become zero, and missing collapse means expanded.
Recursion adds no fields. Typed Value inputs, For pairs, extended Difference
slots, PI, Number negate, Vector Math, Min/Max, and nested iterator name reuse
are additive v8 capabilities;
older graphs without them retain their meaning. Do not remove migrations or
rewrite historical fixtures merely because the current writer emits v8.

## Examples and implementation references

The fixtures below are parsed by
[`docs-examples.test.ts`](../src/persistence/docs-examples.test.ts). They are
historical compatibility examples, intentionally maintained as files rather than
duplicated JSON blocks here. The same test reads the current envelope example
and catalog list from this Markdown; it does not validate the prose.

| Fixture | Coverage |
| --- | --- |
| [Empty project](examples/empty-project.scadlet) | v1 envelope |
| [Sphere with `$fn = 50`](examples/sphere-fn50.scadlet) | v1 primitive and deterministic render fixture |
| [Cube/Sphere/Union/Translate](examples/cube-sphere-union-translate.scadlet) | v1 topology, collapse, non-default viewport/camera |
| [Empty Cube signature](examples/v2-empty-cube.scadlet) | v2 omitted parameters |
| [Recursive Functions](examples/recursive-functions-v6.scadlet) | v6 direct/mutual Function Calls |
| [Recursive Modules](examples/recursive-modules-v6.scadlet) | v6 direct/mutual Module Calls |

Bundled application templates are separate top-level
[`examples/example_*.scadlet`](../examples/) files; their copy lifecycle belongs
in [Persistence](agent-guides/persistence.md#bundled-examples).

| Concern | Implementation |
| --- | --- |
| Schema/defaults | [project.ts](../src/persistence/project.ts) |
| Migration/validation | [validate.ts](../src/persistence/validate.ts) |
| Serialization/restoration | [serialize.ts](../src/persistence/serialize.ts), [restore.ts](../src/persistence/restore.ts) |
| Type identity and parameter hooks | [node-catalog.ts](../src/editor/node-catalog.ts) |
| File access and filenames | [file-service.ts](../src/persistence/file-service.ts), [filename.ts](../src/persistence/filename.ts) |
| Viewer state | [geometry-viewer.ts](../src/components/geometry-viewer.ts) |
