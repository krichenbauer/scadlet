# Persistence contract

Read this and the canonical [`.scadlet` format specification](../scadlet-format.md)
before changing persistent state, migrations, save/open behavior, autosave, or
the browser project library.

## Canonical project data

`.scadlet` is a SCADlet-owned, versioned JSON contract—not serialized Rete,
DOM, or Three.js objects. It preserves semantic graph state (stable node/type
IDs, parameters, definitions, and explicit stable-port connections), editor
positions/viewport, and minimal reproducible viewer state. It excludes
transient selection, marquee, hover, drag, and Inspect; explicit per-node
collapse is persistent presentation state. Omitted `collapsed` state in a v6
record restores expanded, preserving compatibility with older v6 files.

The specification is the detailed authoritative schema. Current format is v6.
Runtime render state, including the default-on Live render preference, pending
debounces, render revisions, and preview result freshness, is session-only and
is never written to `.scadlet` or IndexedDB project data.
Connections address node and stable port IDs, never displayed labels or port
indices. Dynamic slots, definitions, and parameters retain identity across
rename/reorder. `.scad` and `.stl` are exports, not project files.

Any persistent language/editor change must update the canonical types,
serializer, validator, restore path, migrations, fixtures/tests, and format
specification together. Existing parameter shapes and port IDs are compatibility
contracts. Prefer small explicit migrations; reject unsupported newer formats,
unknown semantic node types, and incompatible state with useful errors rather
than silently dropping information. Restore validates/prepares before replacing
a live project and leaves the previous valid project intact on failure.

Definitions persist as project-level objects with stable IDs, kind/name,
ordered parameter signatures, result type where applicable, graph content, and
positions. Interface nodes restore as protected roles. Calls reference IDs.
Old pre-definition projects open as Main plus an empty registry.
Direct and mutual Function/Module recursion add no durable fields: existing
definition IDs, scoped Call nodes, stable ports, fallbacks, and connections
already represent recursive SCCs in v6. Restore must preserve those ports and
wires exactly across repeated loads.

## File access and local library

Keep canonical serialization independent from storage APIs. File access uses a
normal input/download fallback and may use File System Access APIs where
available; browser file-handle associations are external metadata. The user
must give an unnamed project a meaningful name before an explicit Save, Save
As, or export.

IndexedDB is the primary local multi-project store; `localStorage` is not a
project database. Local storage IDs are unrelated to portable project and graph
identity; importing a `.scadlet` creates a new local record. The active project
is tab-scoped (`sessionStorage`), so tabs can work independently.

Built-in examples are maintained as top-level `examples/example_*.scadlet`
sources and eagerly bundled as immutable text templates. They are not
IndexedDB records and never become the active project directly. Selection
first parses the canonical source, gives it a clear `Example: <name>` local
name with a numeric suffix when needed, creates a fresh IndexedDB record, and
then uses the ordinary atomic project-activation path. Editing or deleting
that record cannot affect the bundled source. The current project is flushed
before this copy/activation, exactly as for an ordinary project switch.

Autosave is intentionally simple: use dirty notifications with a short debounce
and one in-flight write. Use optimistic per-project revision checks to prevent
silent same-project last-writer-wins. `BroadcastChannel` may notify tabs of
library changes but is never a second source of truth or a merge mechanism.
On conflict, block overwrite and offer an explicit recovery route. Do not add a
backend, synchronization framework, or CRDT behavior.

Successful autosaves are intentionally silent in the application shell. An
actual IndexedDB write failure is persistent, accessible feedback that recent
changes may be lost; a later successful autosave clears it. Project rename,
switch, import, and rendering must not manufacture autosave-failure feedback.
