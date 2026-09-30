# Definitions, scopes, and bindings

Read this for Main, Module and Function definitions, Calls, signatures, Value
definitions, Variable references, SCAD settings, and iterator scope. Exact
serialized fields belong in the [format specification](../scadlet-format.md).

## Scope ownership

A project has a Main scope and a registry of Module and Function definitions.
Each definition owns a separate semantic graph on the shared infinite canvas.
Frames visualize explicit membership; position inside a frame is not membership.
Keep this model compatible with a future dedicated definition canvas.

The registry owns stable definition identity, kind, name/signature, and graph
membership; Rete remains graph authority. Calls reference definition IDs.
Parameters and Geometry inputs have stable IDs independent of name or order.
Definition names are valid OpenSCAD identifiers, unique across the project.

Ordinary connections never cross definition boundaries. Dependencies enter
through parameters, Geometry inputs, or Calls, without hidden captures. Value
types are Number (not separate int/float), Boolean, and Vector3. Planned types
belong in the [roadmap](roadmap.md), not current signatures.

Each definition has exactly one protected Inputs and Output interface node.
They may move but cannot be deleted, duplicated, or transferred. New definitions
place Inputs left and Output right. Definition deletion confirms its impact and
removes its graph and Calls. Rename preserves definition and Call identity.

## Modules and Functions

| Contract | Module definition | Function definition |
| --- | --- | --- |
| OpenSCAD form | `module name(parameters) { ... }` | `function name(parameters) = expression;` |
| Output | One Geometry body input; multiple branches require an explicit Union | One Number, Boolean, or Vector3 result |
| Permitted contents | Geometry and value nodes, Module Calls and Function Calls | Value/math/conditional nodes and Function Calls; no Geometry, Module Calls, SCAD settings, or For pair |
| Call locations | Main or Module scope | Main, Module, or Function scope |
| Unconnected Output | Empty Module body | Unresolved, saveable Function draft |

Value parameters have typed Inputs outputs and corresponding Call inputs.
Definition defaults and each Call's direct fallbacks are independent. A
connected expression overrides its fallback without erasing it. Rename/reorder
preserves wires. Type/removal changes preflight and confirm their impact, then
remove only incompatible connections. A parameter type change retains its ID
and resets each Call fallback for that parameter to the new definition default.
Parameter deletion also removes affected same-scope Variable references.

Module Geometry inputs are a separate ordered signature: Inputs outputs and
Call inputs correspond by stable ID and generate `children(index);`. They have
no defaults or Call fallbacks and do not imply a Union. A declaration itself
is not Main geometry; rendering it requires a Call reachable from Main. Gaps before a later
connected child emit `union() {}` placeholders to preserve indices.

Function result type is inferred from Output. An unresolved Function emits no
declaration and cannot create new Calls. Existing Calls remain disconnected,
unresolved drafts; incompatible outgoing wires use the normal confirmation
lifecycle. Function expressions are evaluated by OpenSCAD, never JavaScript.

## Dependency order and recursion

Direct and mutual recursion are valid for both definition kinds in their
permitted scopes. They use ordinary ports, fallbacks, and lifecycle rules.
Generate resolved Functions, then Modules, then Main. The shared reachable-Call
analysis collapses strongly connected components (SCCs): callees precede callers
between components; members within a component retain project order. Only Calls
reachable upstream from the owning Output affect this ordering; disconnected
Calls do not. Do not statically analyse termination; OpenSCAD-WASM evaluates it.

## Value definitions and Variable references

A deliberately renamed Number, Boolean, or Vector3 becomes a Value definition
when it gains a stable binding ID and a valid unique identifier. Historical
label-only Values remain unbound until explicitly activated. Definition
parameters are also bindings. Names must be unique among Values and parameters
in exactly one scope, and neither may reuse a For iterator name of that scope;
the same name in another scope is independent. Rename, parameter edits, and
Paste apply this same rule, so an accepted name is always saveable.

A Variable reference resolves by binding ID plus explicit scope, never by name.
It cannot capture across scopes. Rename updates references without changing
identity. Deleting a bound Value or parameter counts and confirms affected
references, then removes them together; deleting one reference is an ordinary
unconfirmed node deletion.

Number and Boolean accept a same-typed Value input. Vector3 accepts a whole
Vector3 Value input overriding its preserved X/Y/Z inputs and direct fallbacks.
The ordinary Value output emits that effective expression; a Variable reference
emits the binding's current identifier. Named Values are scope-level generation
roots even without an outgoing wire. Emit their assignments in dependency-safe
order before settings and Main/Module Geometry; Function-local assignments form
one `let(...)` around the result. Missing, cross-scope, circular bindings and
ordinary dataflow cycles are errors, never plausible substitute source.

## SCAD settings

Main and each Module may own at most one **SCAD settings** node; Functions
contain none. Its curated `$fn`, `$fa`, and `$fs` Number inputs use ordinary
same-scope dependencies and preserved fallbacks. It has no Geometry sockets but
is a generation root. Emit present assignments in `$fn`, `$fa`, `$fs` order
after local Value bindings and before the scope body, within the Module's
parameter context when applicable. Module-local settings use OpenSCAD's normal
lexical behaviour. They are not viewer or worker options, and arbitrary special
variable names are unsupported.

## Numeric For scope

The **For** action creates one `For` header and one `For result` in Main or a
Module. Their fixed structural connection is immutable. The header evaluates
Start, Step, and End in the enclosing scope and carries the range and stable
Number iterator binding to its result. The result wraps its ordered Geometry
inputs in one OpenSCAD `for` block; JavaScript never evaluates the range.

The iterator's lexical body is the dependency subgraph entering that result,
not a visual rectangle or a new registry scope. Direct iterator wires and
Variable references may cross only the matching result boundary. Enclosing
bindings remain readable. Nested pairs compose normally. An iterator cannot
take the name of a Value or parameter of its scope. Like OpenSCAD's lexical
scoping, a nested iterator may reuse an enclosing iterator's name and hides it
inside its body, unless that body also uses the enclosing iterator: generated
source names bindings, so such a use would silently read the nested iterator.
The nested header's Start, Step, and End belong to the enclosing scope and may
use the enclosing iterator. Independent sibling pairs may reuse a name.
Refusals explain the specific rule. Known literal zero steps and escaping dependencies are errors. The
Step field never stores a literal zero: it marks the entry invalid and keeps
the previous value.

A structurally valid result without connected valid Geometry emits no fragment
and the whole pair is omitted. This draft state does not relax pair, scope,
connection-type, iterator, or zero-step validation. Pair members move separately;
Delete and graph clipboard actions include both members and iterator references.

## Scope transfer and creation

Transfer happens only on a completed drag and is atomic. Preflight all touching
connections and binding names against proposed scopes; reject invalid results
without silently deleting wires. A moved Value must leave all its references
resolvable; moving only a reference to another scope is rejected. A For pair
transfers only as a complete set with the references/connections needed to keep
it valid. Protected interfaces never transfer.

My Modules and My Functions entries create compact Calls through the shared
creation path; separate focus/edit/delete actions manage definitions. Clipboard
remapping and placement follow [Editor and UX](editor-ux.md#graph-clipboard).
