# Node style

This guide owns node/palette visuals and accessibility. Use
[Editor and UX](editor-ux.md) for interaction lifecycles and
[Definitions](definitions.md) for semantic scope rules.

## Shared visual language

Dark is the only theme, independent of system preference; native controls and
opened option lists must remain readable. Use the English `t()` dictionary for
natural-language UI/accessibility text. Do not add a language switcher or i18n
framework speculatively.

Ordinary cards share corner radius, border, shadow, typography, header height,
body padding, and row rhythm. Headers are part of the same surface. Geometry
and value nodes differ through the cues below, not bespoke card designs.

### Header and icons

```text
[family icon] Node title                         [Add] [More] [Collapse]
```

Every ordinary node has a compact local inline-SVG family icon before its title.
The title is plain text unless editing a name or selecting a Math operation.
Meaningful actions appear in Add, More, Collapse order, with Collapse far right.
Use local SVG icons, not literal `^`, `v`, `+`, `=` glyphs or emoji as final UI.
Header buttons are compact icons with accessible names, title tooltips, visible
focus treatment, and the shared minimum target size.

Icons support scanning without replacing labels or socket colours. Use familiar
primitive/transform/math metaphors and distinct Module/Function symbols.
Boolean icons show two overlapping filled primitives: opaque bright result and
subdued non-result regions. Union highlights both, Intersection the shared lens,
and Difference the retained first-input region. Keep them legible at palette size.

The palette uses the same icon immediately before each readable node-type name.
It is decorative when the adjacent text supplies the accessible name. Math
families retain one palette entry with an operation selector; the node's header
selector is its title, without a redundant operation row.

### Palette tooltips

Every draggable entry has a concise explanatory tooltip on delayed pointer
hover or immediate keyboard focus. The trigger uses `aria-describedby` with a
non-interactive `role="tooltip"` surface. Escape, focus loss, pointer exit, or
starting a drag dismisses it. Scrolling dismisses pointer tooltips; keyboard
focus tooltips follow the focused entry.

Use the browser top layer, flip/clamp to the viewport, and avoid clipping or
covering pointer targets. Show a larger icon at left and name/description at
right; normal palette icons remain 18px. Descriptions explain the result/action;
Math descriptions name every selectable operation. Add localized explanatory
copy and visible browser coverage with new palette types.

## Node families and colour

Geometry recognition follows canonical output socket identity, never labels,
names, or port keys. Palette recognition follows catalog typing, with an
explicit Geometry cue for For because its pair produces Geometry.

- Geometry-output cards use the subtle blue-grey background, not a family border.
- Value-only cards retain neutral dark backgrounds; output value type does not
  recolour the card.
- Selection, focus, errors, Inspect, disabled state, and out-of-scope dimming keep
  independent treatments. Do not reuse them as family colours.
- Definition frames retain container styling, not Geometry/value card colours.

| Socket/wire type | Colour |
| --- | --- |
| Geometry | Blue |
| Number | Amber |
| Vector3 | Purple |
| Boolean | Green |
| Unresolved Function Output or Conditional branch/result | Neutral grey; not a real type |

Dynamic ports adopt the resolved type colour. Unresolved outputs cannot start
connections; input type inference follows the normal interaction lifecycle.

## Ports and rows

Inputs sit left, outputs right, with consistent labels, controls, and row spacing.
Every ordinary output is an outward arrowhead; every input is the inverse notch.
Preserve the 10px layout box, border overlap, type fill/edge colours, connected,
disabled, hover, and visible keyboard-focus states. Shape expresses direction;
colour expresses type. Neither replaces port-specific accessible names.
Accessible descriptions are **Connection source** and **Connection target**.

Sockets are keyboard-focusable and obey the output-origin connection rules in
[Editor and UX](editor-ux.md#canvas-and-connections). Styling never changes
socket keys, types, ordering, or compatibility. Structural For anchors are the
explicit exception below.

Place direct fallback controls beside corresponding inputs. A connected
expression blanks/disables its fallback using the overridden tooltip while
retaining the saved value; disconnection restores it. Number/Boolean use one
always-visible Value input/fallback row, without adding Collapse. Expose
connected/fallback state to assistive technology. Vector3 places its whole-Value
row above collapsible X/Y/Z rows; overridden components remain visible where
wires require them, subdued with disabled direct controls.

Removable optional rows have a right-adjacent **Remove parameter** icon; required
rows do not. Wire-affecting removal follows the shared confirmation lifecycle.

### Add and dynamic rows

Add opens an anchored menu of available parameter forms, not wide bottom buttons.
Hide it when no parameter category is addable; keep it visible but disabled when
all permitted optional forms are present. Choices name semantic forms such as
Vector or scalar components. Do not expose representation selectors such as
XYZ/Vector/Scalar: remove a form and add the desired alternative. Transforms
allow removal of their final form.

**SCAD settings** starts without rows. Add offers only absent Fragment count
(`$fn`), Minimum angle (`$fa`), and Minimum size (`$fs`). Keep the technical name
visible beside the Number fallback and Remove action; disable Add with all three
present.

Ordered Geometry rows use the shared trailing extension affordance. Difference
keeps Base and Subtract labels, then ordered subtractors; Union/Intersection and
For result use ordered children. Stable slot semantics belong in Editor and UX
and the format spec. Min/Max uses two fixed Number rows plus optional rows and
one blank extension input, without numeric sentinels for blanks. Vector Math
uses typed Vector3/Number sockets for its selected operation.

## More and naming

More contains applicable Inspect, Rename, Copy, Cut, Duplicate, and separated
destructive Delete actions, each with a local icon before its label. Protected
interfaces have no More menu. SCAD settings Duplicate is disabled with a
localized reason; For actions follow the pair lifecycle. More does not replace
parameter controls or Add.

Graph context menus use the same action rows, with selection/targeting rules in
[Editor and UX](editor-ux.md#graph-clipboard). Disabled actions expose their
reason in accessible labels and titles. All contextual menus/forms use the
shared [transient-popup lifecycle](editor-ux.md#transient-popups-and-focus).

Renameable Values show plain title text and a pencil-icon Rename action.
Module Geometry inputs and Module/Function parameters instead have a compact
pencil beside the row name. Both use the shared inline editing lifecycle;
type/default editing remains separate.

Value and parameter output rows show a 24px icon-only **Create variable
reference** button beside the socket. Its local icon depicts a small source
box pointing to an output arrow. Use standard focus/disabled styling, localized
accessible name, and tooltip. An unbound Value's button is disabled with a reason;
parameter controls are enabled. Click-and-place uses a dashed name ghost.

Variable references are compact exceptions: current binding name, reference
icon, More, and one typed Value output. They have no inputs, editable title,
literal control, Add, or Collapse, but retain normal selection, movement,
Inspect, accessibility, and deletion. PI is a compact source without editable
parameters or a Value-definition action.

## Collapse

Normally collapsible nodes start expanded and use an always-visible far-right
chevron with **Collapse node** / **Expand node** names and accurate
`aria-expanded`. Explicit collapse persists; connected ports remain visible.
Keep ordinary main input/output anchors stable and expand controls below them,
without changing card width just to expand.

Hover, selection, and drawing a wire never expand nodes or reveal hidden rows.
Activating Expand during a held wire gesture preserves the gesture. Fixed compact
nodes have no Collapse action; in particular, value **Conditional** and Geometry
**If** retain fixed Condition, Case: True, Case: False order, with no pin or
optional-parameter controls.

## Definition frames and interfaces

Frame headers use a definition icon and readable `Module · enclosure` or
`Function · chamfer(…)` label, emphasizing the name. Their More menu provides
definition-level Rename/Delete; frames have no Add or Collapse controls.

Inputs interfaces follow ordinary surfaces/rows with an Inputs icon and Add,
but no More. Module Add offers Geometry input and Parameter; Function Add offers
Parameter only. Parameter creation uses the anchored name/type/default form
without changing
permanent layout or keyboard order. Removable items use row-level Remove and
normal disconnection confirmation. The Geometry output interface is labelled
**Output**, with its socket/family styling conveying the type.

## For pair

For and For result use the shared loop icon and ordinary card anatomy. Geometry
family treatment applies where the node has a Geometry output; the palette's
For cue does not recolour its Number output or structural anchors.

The fixed pair boundary uses small muted neutral-grey rectangular anchors and a
thick dashed neutral-grey path. Its anchor is the last physical row on each
card: below End on For, and below all Geometry rows plus the extension control
on For result, including dynamically added/restored rows. Both cards expose
their durable pair state to assistive technology.

The structural path/anchors are non-interactive: no selection styling,
arrow/notch shapes, ordinary connector roles, tab stops, hover/focus state, or
connection-start behaviour. Number/Geometry rows retain ordinary conventions.

## Accessibility and review

Icon-only shell controls have localized names, native titles, visible focus,
and 32px targets; the compact reference button is the explicit 24px exception.
Keep type, direction, selection, error, and Inspect cues distinguishable beyond
colour alone.

Review anatomy, row/socket positions, action visibility, focus/names/descriptions,
collapse exceptions, and visible browser behaviour when restyling. Preserve
connections, semantics, scope, serialization, and restoration. Follow
[Delivery and quality](delivery-quality.md) for required checks.
