# Editor and UX contract

Read this before changing built-in nodes, socket/connection behavior, canvas
interaction, palette, node controls, inspection, presentation, or UI labels.

## Node semantics

Geometry is the dominant visual type. Number is one type (never int/float);
Vector3, Boolean, and later genuinely different types may have distinct typed
sockets. Values support geometry rather than dominating the product.

Expose OpenSCAD semantics without forcing a value graph for literals:

- A node begins with its smallest valid OpenSCAD signature. Optional arguments
  are explicitly added and removable; mutually exclusive forms use semantic
  modes, not conflicting fields.
- A semantic parameter remains one parameter even when a convenient editor
  decomposes it (for example Vector3 X/Y/Z).
- An inline literal is a preserved fallback. A compatible connection overrides
  and disables it without erasing it; disconnect restores it. A whole Vector3
  overrides component values/connections, which remain preserved but inactive.
- Connected ports must never disappear through collapse or representation
  changes. When removal/type change affects wires, preflight and confirm, then
  remove only affected Rete connections through its lifecycle.
- Function and Module Calls may be recursive in their permitted scopes. They
  keep the same dynamic ports, fallbacks, confirmation, and restoration rules
  as acyclic Calls; recursion adds no special syntax or UI mode.
- Union and Intersection use ordered, variadic geometry-child slots. Each slot
  has a stable ID; retain connected slots plus one empty extension slot.
  Difference remains asymmetric (`base`/`subtract`).

Do not build a generic signature DSL prematurely. Reuse small, explicit
mechanisms for optional parameters, typed inputs, alternative editors, and
ordered children.

## Canvas and node interaction

Dark is the only theme, independent of system preference; native controls and
their opened option lists must remain readable. Application text is
non-selectable except normal editable controls and the copyable source pane.

Canvas nodes drag only from non-interactive header/background. Controls,
sockets, connections, inputs, buttons, and selects keep their native/direct
interaction. Palette configuration selects are native controls and never begin
a drag; dragging any other part creates the selected operation through the
shared creation path.

Rete remains selection authority: click selects, Ctrl/Cmd-click toggles,
Shift-drag empty canvas creates a marquee, and dragging a selected member moves
the selection. Delete/Backspace removes selected nodes/connections only while
the canvas has focus, never while editing a control. One selected connection
may be deleted before node deletion. No selection/hover/gesture state changes
program semantics or persistence.

Nodes are compact/collapsible presentation only. Controls begin collapsed when
possible; hover-capable devices temporarily expand on hover, pinning keeps a
node open, and non-hover devices use selection for temporary expansion. Keep
structural input/output anchors stable in a fixed row; expansion grows below.
Reveal all connected inputs while compact and compatible unused targets during
a wire gesture without moving the aimed socket. Use Rete DOM ordering—not a
parallel z-index model—to bring hovered nodes forward.

Geometry-output nodes receive the restrained complete blue border based on
canonical output socket type/identity, never labels or port keys. Value-only
nodes remain neutral. Palette geometry cues follow the same principle.

Resizable panes must resize existing editor/viewer instances without resetting
the graph, viewport, or camera.

Each canvas/viewer has one compact, keyboard-reachable recovery control in its
corner: **Fit graph** frames all rendered nodes plus visible definition frames
with consistent padding; **Reset 3D view** frames the currently displayed
nonempty mesh from the stable Z-up default perspective. They are transient
presentation actions, so they preserve graph data, source, dirty/autosave
state, selection, and Inspect provenance. The mesh action is disabled when
the preview is empty. Use localized accessible names and a title; the compact
icon is supplementary rather than its only label.

## Creation, inspect, and labels

Built-ins come from one stable-ID node catalog and one editor-level creation
path. Palette drop coordinates must convert browser coordinates to the current
area transform; creation must not disturb viewport state. A fresh project is
empty (no automatic Cube). Beginner labels use categories such as Primitives,
Transformations, and Boolean operations rather than CSG jargon.

Double-clicking a geometry output performs one-shot upstream Geometry Inspect;
double-clicking a value output runs OpenSCAD headlessly and displays the value.
Inspect is presentation state: it never rewires, copies, or changes graph
semantics. Its Geometry marker is provenance: it means the currently displayed
mesh was successfully produced by Inspecting that node. A confirmed valid
empty Geometry Inspect clears the preview and does not create or retain that
marker; its restrained localized preview status is not an error. Normal Render
clears the marker immediately and always renders the full project, including if
it later fails. A changed semantic graph clears Inspect provenance (while the
last valid Geometry mesh may remain visible); presentation-only interactions do
not. A failed Inspect preserves the previous successful result and its marker.
Clear Inspect after a committed project replacement and when its node is
deleted. Keep it inside the existing Rete/dataflow/codegen route.

All user-facing/accessibility natural-language labels use `t()` keys; internal
node, category, port, and operation IDs remain stable and language-independent.
The current dictionary is English-only. Do not add a full i18n framework or a
language switcher merely in anticipation of German.

## Application shell

The header contains SCADlet, the directly editable active-project name, a
Projects popover, File menu, and the GitHub icon. Enter and focus loss commit
the project name through the normal dirty/autosave lifecycle. Projects manages
only local IndexedDB records: New, Duplicate active, Delete active, active
first, and ordering of the remaining rows. Portable open/save/export actions
belong only in File. Do not add row-level rename/delete affordances.

The viewer's bottom-edge strip holds the manual Render action and a default-on
Live toggle. The Live toggle is a real accessible visual control, but must not
schedule work until its dedicated behavior is implemented. A manual render
shows a quiet upper-left spinner; Stop replaces Render only after 200 ms.
