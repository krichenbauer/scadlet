# Editor and UX

Read this for canvas interaction, selection, connections, placement, clipboard,
popups, Inspect, and the application shell. [Node style](node-style.md) owns
visual/accessibility conventions; [Definitions](definitions.md) owns scopes
and bindings; [Architecture](architecture.md) owns preview execution.

## Creation and parameter editing

Built-ins use one stable-ID catalog and one editor-level creation path. Convert
palette client coordinates through the current area transform without changing
the viewport. A fresh project starts empty. Use beginner categories such as
Primitives, Transformations, and Boolean operations rather than CSG jargon.
Scope/singleton violations are refused with localized transient feedback before
creating invalid nodes.

A node starts with its smallest useful semantic signature. Add/remove optional
arguments explicitly; alternative forms represent one OpenSCAD parameter.
Without added parameters, a node emits OpenSCAD's own argument-less behaviour.
Translate, Rotate, and Scale start with a useful default vector form; Mirror
and Resize start without one (`mirror()`/`resize()`), and every transform
allows removing its form. An added parameter starts with a value that visibly
differs from leaving it out: added Booleans such as Center or Keep proportions
start enabled, and added settings do not repeat OpenSCAD's defaults.
An inline literal is a preserved direct fallback: a compatible connected
expression overrides and disables it, and disconnection restores it. Whole
Vector3 overrides retain inactive component wires and fallbacks. Representation
and signature changes preflight and confirm affected wires, then remove only
those connections through Rete. Cancellation leaves the graph unchanged.
Use explicit shared mechanisms, not a generic signature DSL.

Math families use operation selectors in the palette and node title. Dragging
creates the selected operation. Vector Math supports Add, Subtract, Scale,
Divide, Dot product, Cross product, Norm, and Negate; a change retains compatible
ports and confirms incompatible wire removal. Trigonometry retains `a` when
switching to/from `atan2`; only the extra `b` input is added/removed. Failed
signature changes roll back ports, operation, and wires.

Difference, Union, and Intersection retain stable ordered Geometry slots.
Difference requires Base and Subtract; later rows are additional subtractors.
Union/Intersection need at least one connected child to evaluate. Connecting
the last available slot appends one empty extension slot; disconnecting a child
keeps its slot reusable. Min/Max has two fixed Number operands and ordered
optional operands: connecting or filling the trailing input creates another
blank slot; unused blank interior operands are removed. Blank optional operands
are absent from generated expressions.

**Create variable reference** beside a Value or parameter output supports drag
and one-shot click-and-place; it never starts a wire. A Value needs a valid
unique binding name to enable it. Placement carries source node and binding IDs
and requires matching explicit source/destination scopes. Escape, scope
selection, project replacement, or editor destruction cancels without mutation.

## Canvas and connections

Nodes drag only from non-interactive header/background. Controls, sockets,
connections, buttons, inputs, and native selects retain direct interaction;
palette selects never start drags. Application text is non-selectable except
editable controls and the copyable source pane.

Connection gestures start only at resolved outputs, through pointer, touch,
Enter, or Space. Compatible inputs complete an active draft. An input alone is
a quiet no-op: no detach, preview, or error. Replace an occupied input by starting
from the new output and targeting that input. Existing wires are independently
selectable/removable. The fixed For structural connection and anchors cannot be
picked, rewired, selected, or deleted as an ordinary semantic connection.

Rete owns selection. A plain interaction with an unselected node replaces it;
Shift/Ctrl/Cmd-click toggles membership; Shift-drag on empty canvas creates a
marquee. Dragging a selected member moves the explicit group. Connections never
implicitly select endpoints. Delete/Backspace acts only with canvas focus, never
while editing a control; a selected connection takes precedence over node
deletion. Selection, hover, and connection drafts are non-semantic and transient.
Use Rete DOM ordering to bring interacted nodes forward, not a parallel z-index
model. Collapse behaviour belongs in [Node style](node-style.md#collapse).

## Graph clipboard

The graph clipboard is detached plain data for one exact active-project identity
and semantic scope, held only in the session. It never uses the operating-system
clipboard. Copy/Cut/Paste/Duplicate use Cmd+C/X/V/D on Apple platforms and
Ctrl+C/X/V/D elsewhere, without intercepting native editing shortcuts in inputs,
textareas, selects, or contenteditable surfaces.

Copy and Cut use explicit selection. Duplicate uses selection without replacing
the clipboard. Node More actions target that node only. A graph context menu
opened by secondary click, Shift+F10, the Context Menu key, or deliberate touch
hold targets an unselected clicked node or preserves an already selected group.
On a node it offers Copy, Cut, Paste, Duplicate, and Delete; empty canvas offers
Paste only. Protected definition interfaces are excluded.

Snapshots contain ordinary connections only when both endpoints are included.
Selecting either For member includes the whole pair and every reference to its
iterator; its structural connection is reconstructed separately. Internal Value
references follow copied bindings; external references retain their binding ID
only if it still resolves in the same scope. Copied binding-name conflicts use
`<name>_copy`, `<name>_copy_2`, and so on.

Paste/Duplicate first show a placement ghost with relative layout and internal
wires, tracking through pan and zoom. No Rete mutation occurs until a primary
canvas click. Escape, replacement placement, incompatible scope change, project
replacement, or editor destruction cancels the ghost without clearing a valid
clipboard. Stale payloads cannot retarget another scope/project.

Commit plans fresh node, connection, binding, For pair/iterator, and dynamic
Geometry/operand-slot IDs and validates the combined target scope before adding
anything. Mixed scopes, invalid bindings/pairs, protected interfaces, and a
second SCAD settings node fail preflight. Commit is atomic, selects exactly the
new nodes, and emits one semantic change; failure rolls back and retains the
clipboard. Every Paste creates a new plan. Copy is non-semantic; Cut is one
atomic semantic change.

## Transient popups and focus

File, Projects, graph context menus, node Add/More and nested menus,
definition-frame More, and anchored parameter forms share one shadow-DOM-aware
outside-interaction dismissal lifecycle. Pointer, keyboard, focus, or wheel
interaction outside both surface and trigger closes it immediately, including
interactions in the viewer. Opening an unrelated popup closes the previous one.
Outside dismissal does not steal focus; Escape restores focus to the trigger.
Inside controls and scrolling remain usable. Do not add listeners per node or
render. Modal dialogs, persistent inline editors, and palette hover tooltips
have their own lifecycles.

Rename uses selected inline title text: Enter or focus loss validates/commits;
Escape cancels. Interface parameter/Geometry-input pencils use the same editing
model without changing identity. Parameter Add opens an anchored form with
explicit confirm/cancel, not permanent rows or keyboard stops.

## Inspect and preview controls

Inspect from a node's More menu or double-click on its non-interactive surface
runs its upstream output through normal Rete/codegen/OpenSCAD evaluation.
Geometry replaces the preview; values run headlessly and display the result.
Inspect never rewires, copies, or changes graph semantics.

The Geometry marker is provenance of the successfully displayed inspected mesh.
A valid empty Geometry Inspect clears the mesh and marker and shows informational
status. Failed Inspect preserves the previous successful result/marker. A
semantic edit clears provenance, though the last valid mesh may remain.

A plain empty-canvas click ends Inspect alongside selection clearing. A
non-interactive header/background interaction outside the inspected dependency
set also ends it; participating node/control interactions, wires, panning, and
marquee gestures preserve it.
Inspecting the same node again toggles Inspect off; choosing another switches
the root. A successful palette drop ends it; starting/cancelling a drag does not.
Project replacement or deletion of the inspected node clears it. Non-manual exit queues normal debounced Live
preview; manual Render cancels that delay, clears provenance immediately, and
renders the full project even if that render later fails.

The viewer's bottom strip holds **Render** and default-on **Live**, a labelled
accessible switch. **Stop** and the upper-left spinner appear after 200 ms of
execution. Scheduling, timeout, cancellation, startup, and cache rules are owned
by [Architecture](architecture.md#program-and-render-flow).

## View recovery

Resizable panes resize existing instances without resetting graph, viewport, or
camera. **Fit graph** frames rendered nodes and visible definition frames with
padding; **Reset 3D view** frames the current nonempty mesh from the stable Z-up
default perspective and is disabled for an empty preview. Both controls are
keyboard-reachable. Recovery preserves graph/source, dirty/autosave state,
selection, Inspect provenance, and persisted viewport/camera state.

## Projects and small screens

The header contains SCADlet, the editable active-project name, Projects, File,
and GitHub. Enter/focus loss commits the name through normal dirty/autosave.
Projects manages local records with New, Duplicate active, Delete active, and
the active project first. Its separate Examples section lists immutable
templates without rename/delete actions. Selection creates an ordinary local
copy through [Persistence](persistence.md#bundled-examples). Keep portable
open/save/export in File, with no per-row rename/delete, extra examples menu,
automatic example opening, or first-run screen.

With a coarse primary pointer and viewport width ≤700px or height ≤500px,
visually and accessibly replace the shell with a non-dismissible larger-screen
notice. A live media-query listener reacts immediately to resize/rotation.
Keep the application mounted and preserve editor, project, and render state;
returning to a supported viewport restores access without resetting it.
768×1024 and 1024×768 tablets remain supported. Fine-pointer narrow windows do
not trigger the notice.
