# Persistence and compatibility

Read this for save/open, IndexedDB, autosave, restoration, and bundled examples.
The [format specification](../scadlet-format.md) owns exact schema fields,
validation constraints, current version, and historical migration mappings.

## Canonical data and identity

`.scadlet` is SCADlet-owned JSON, independent of Rete, DOM, and Three.js objects.
It stores semantic graphs plus explicit layout/view state. Connections use
stable node and port IDs; definitions, parameters, bindings, pairs, and dynamic
slots preserve identity across rename/reorder. `.scad` and `.stl` are exports,
not project files.

The format's [state table](../scadlet-format.md#persistent-and-transient-state)
is authoritative for persistence boundaries. In particular, explicit collapse
is saved, while selection, Inspect, graph clipboard, placement, view recovery,
and Live scheduling/cache state are never serialized or autosaved.

For a persistent change, update canonical types, catalog serialization and
validation, restore, affected migrations, fixtures/tests, and the specification
together. Existing field meanings and port IDs are compatibility contracts.
Use an explicit version bump and migration for incompatible changes; additive
node types or ports need no bump when old records retain their meaning.
Internal renderer or Rete refactoring alone does not change the file format.
Reject unsupported versions and unknown semantic types with useful errors.

Node persistence hooks belong in the catalog: register the stable `NodeTypeId`,
creation/matching, typed ports, and `serializeParams`/`validateParams` hooks.
Reuse `getPersistedParams()` for the complete semantic parameter object and
shared validation primitives beside the parameter types. Validate all retained
fallbacks, including inactive forms. Scope-wide constraints belong in the
[shared rule authorities](architecture.md#shared-rule-authorities) that
validation, restore, and the live editor all call; adding a catalog entry alone
is not always sufficient, and a rule enforced only on load or only live is a
bug.

## Validation and restore

Parse, migrate, and validate before touching the live editor. Prepare all nodes,
dynamic ports, and endpoints before clearing it. Application restore supplies
a snapshot of the previous valid project for rollback if applying the prepared
replacement fails. The low-level `restoreProject` helper requires that snapshot
via `rollbackProject` to provide rollback; failure of both restore and rollback
is surfaced explicitly.

A validated project whose node or connection the live editor still refuses or
removes is a bug, but must not cost learner work. `restoreProject` then
completes with everything else and reports each missing item. For a local
record, the application first stores the untouched original as a new local
project `<name> (backup)`, then shows a persistent, dismissible warning naming
the missing items and the backup. If the backup cannot be written, the graph
stays open without autosave so the original is never overwritten. An opened
file is its own original. Restore never runs the interactive loop or type
transition pipes.

Only a successful load becomes the active autosave target. Invalid,
incompatible, or unrestorable IndexedDB records remain unchanged and available
for explicit deletion; other projects can still open and new projects can be
created. Only an actual IndexedDB initialization/access failure disables the
library and falls back to file-only use.

## Files and local library

Keep canonical serialization independent of storage APIs. File access uses a
normal input/download fallback and may use File System Access APIs where
available; file-handle associations are external metadata. An unnamed project
needs a meaningful name before explicit Save, Save As, or export. Explicit file
saves validate the canonical project exactly as autosave and Open do; an
invalid project is reported and no file is written.

IndexedDB is the primary multi-project store; `localStorage` is not a project
database. A local storage ID is separate from portable graph identity. Import
creates a new local record, and `sessionStorage` tracks each tab's active
project independently.

Autosave uses dirty notifications, a short debounce, and one in-flight write.
Optimistic per-project revisions prevent silent same-project last-writer-wins.
`BroadcastChannel` may announce library changes but is neither a source of truth
nor a merge mechanism. Conflicts block overwrite and offer explicit recovery;
do not add a backend, synchronization framework, or CRDT behaviour.

Successful autosaves are silent. A real write failure produces persistent,
accessible feedback that changes may be lost; a later successful autosave
clears it. Rename, switching, import, and rendering must not manufacture that
failure state.

## Bundled examples

Maintain templates only as top-level `examples/example_*.scadlet` files.
Vite's eager raw glob discovers them automatically and bundles their text;
selection requires no runtime fetch or manually maintained manifest. Canonical
parsing validates templates. Their display names derive from filenames.

Templates are immutable and never become active editor state directly.
Selection flushes the current project, creates a fresh IndexedDB copy named
`Example: <name>` (then `Example: <name> 2`, and so on when needed), and uses
normal project activation. Editing/deleting a local example copy cannot alter
the template. Examples never open automatically.

Historical format fixtures under `docs/examples/` are distinct from bundled
examples. Keep their old versions to exercise compatibility; do not upgrade
fixtures merely to match the current writer.
