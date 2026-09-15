# Node Style Guide

This document defines the shared visual and interaction language for SCADlet
nodes. It is the source of truth for node rendering work. New node types and
changes to existing ones must follow it unless an explicit exception is listed
below.

## Purpose

The canvas should read as one coherent editor, not as a collection of
individually designed cards. Nodes may differ in their OpenSCAD semantics,
ports, and controls, but they use one common anatomy, typography, spacing,
border treatment, and action language.

Use colour to communicate the Geometry family and socket/wire types. Do not
introduce node-background colours merely because a node produces a particular
value type.

## Shared anatomy

An ordinary node consists of:

1. a header;
2. zero or more parameter and port rows;
3. optional body content that follows the same row rhythm.

All ordinary nodes use the same corner radius, border thickness, shadow,
header height, body padding, row height, font family, and font-size scale.
Headers are not a separate card style: they are the top part of the same node
surface.

### Header

The normal header layout is:

```text
[node-family icon]  Node title                         [+] [More] [Collapse]
```

- The node-family icon is left of the title and is present on every ordinary
  node. It is compact, locally supplied inline SVG, and has a stable meaning.
- The title is normally plain text. It is not an always-visible input field.
- Header action buttons are compact icon buttons with the established focus
  treatment, accessible name, tooltip/title, and at least the project-wide
  minimum touch target.
- Actions appear only when meaningful. Their order is always `Add`, `More`,
  `Collapse`, with Collapse at the far right.
- Icons must come from the local inline-SVG icon set; do not use literal glyphs
  such as `^`, `v`, `+`, `=`, or emoji as the final UI.

### Node icons

Icons help users scan and find nodes; they do not replace text labels or socket
type colours. Use familiar, simple metaphors and keep them visually consistent
with the existing local icon set. Examples include cube/sphere for primitives,
arrows for transforms, overlapping shapes for booleans, calculator/comparison
marks for value operations, and distinct module/function symbols for
definitions. Boolean icons use two overlapping filled primitives: the bright
area is the Boolean result, while non-result input areas are subdued. Union
shows both shapes brightly; Intersection highlights only the shared lens; and
Difference highlights only the retained part of its first input. Result and
subdued areas use explicit opaque local monochrome SVG colours so they remain
legible at the palette's compact size.

The left-hand node overview/palette uses the same icon immediately before every
node-type name. This makes scanning and finding an entry consistent with the
node header the user sees after adding it. The palette icon is decorative only
when its adjacent label already supplies the accessible name; it never replaces
the readable node-type label.

### Palette explanatory tooltips

Every draggable node entry in the left palette provides the same concise
explanatory tooltip for pointer hover and keyboard focus. Pointer hover uses a
short delay; keyboard focus shows it immediately. The trigger references the
non-interactive `role="tooltip"` surface with `aria-describedby`, and Escape,
focus loss, pointer exit, or starting a drag dismisses it. Scrolling dismisses
a pointer tooltip; a keyboard-focused tooltip follows its focused entry.
Tooltips use the browser top layer, flip and clamp to the viewport, and must
not be clipped by the scrolling palette or cover pointer targets.

The tooltip repeats the node icon at a clearly larger size on the left and
places its name and localized description on the right. Ordinary palette icons
remain 18px. Normal descriptions briefly explain the node's result or action;
Math-family descriptions name every selectable operation in that palette
entry. New palette node types must add localized explanatory copy alongside
their catalog entry and visible browser coverage.

## Node families and colour

- **Geometry nodes** use a subtle blue-grey tinted background. Their Geometry
  identity must not rely on a blue outline, because that conflicts with
  selection/highlight styling.
- **Non-Geometry nodes** use the neutral dark node background.
- Borders, selection, keyboard focus, errors, inspection, disabled state, and
  out-of-scope dimming use their own existing state treatments consistently;
  none is repurposed as a family colour.
- Socket and wire colours continue to communicate data types. A node does not
  gain a coloured background just because its output is Number, Boolean, or
  another value type.
- Module and Function definition frames retain their frame/container identity.
  They are not value- or Geometry-coloured node cards.

## Ports and parameter rows

- Rows use a shared vertical rhythm and a consistent label/control alignment.
- Input sockets are on the left and outputs are on the right. Socket keys,
  types, ordering, and connection semantics are defined by the node model and
  are not changed for visual consistency.
- A direct fallback control belongs beside its corresponding unconnected input
  according to the established value-control convention.
- A removable optional parameter has a compact **Remove parameter** icon button
  on the right of its own row. Required/default rows do not show a removal
  button.
- Removing an optional parameter that would disconnect wires uses the
  established concise confirmation/warning behaviour. On confirmation, the
  affected connections are removed through the normal lifecycle.

## Add parameter

The header Add button opens a small anchored menu of parameter forms that may
be added to that node.

- Do not render wide add buttons at the bottom of a node.
- Hide Add entirely when a node has no addable parameter category.
- Keep Add visible but disabled when optional parameters exist in principle but
  every currently permitted one has already been added.
- Menu entries describe the actual form to add, not an abstract mode switch.
  For example, a Vector form and scalar components are separate add choices
  where the underlying OpenSCAD node supports them.
- Representation/mode selectors such as `XYZ`, `Vector`, or `Scalar` are not
  part of the finished node UI. To change form, remove the current removable
  parameter and add the desired form from Add.
- Nodes such as `Translate`, `Rotate`, and `Scale` still start with their useful
  default input form. The last remaining form may be removed; an empty
  `translate()`/`rotate()`/`scale()` node is valid even if it has no useful
  effect.

SCAD settings follows this same header Add convention. It starts with no rows;
Add offers only the absent Fragment count (`$fn`), Minimum angle (`$fa`), and
Minimum size (`$fs`) settings. The technical OpenSCAD name remains visible in
each user-friendly row label, beside its normal Number fallback and directly
adjacent Remove action. With all three rows present, Add remains visible and
disabled.

## More menu

The header More button opens the node context menu. Entries use a conventional
local icon to the left of their label. It contains actions which are not part
of the node's normal parameter editing surface.

For applicable ordinary nodes, the menu contains:

- **Inspect** where that node type can be inspected;
- **Rename** where the node has a user-editable name;
- **Duplicate** where an existing duplication lifecycle already supports it;
- a separated destructive **Delete** action.

No current ordinary node has a working Duplicate lifecycle yet, so today's
menus omit it rather than call an invented/placeholder action; it appears once
a real duplication lifecycle exists for that node kind.

The menu may grow later with copy/paste-related actions, but it must not become
a substitute for direct parameter controls or the Add menu.

All Add and More disclosures, their nested submenus, definition-frame More
menus, and anchored parameter popovers participate in the application's shared
transient-popup dismissal mechanism. Do not add document listeners per node or
per render. Outside interaction closes them without stealing focus; Escape
closes them and returns focus to the trigger. Inside controls and scrolling do
not dismiss their containing popup.

## Naming and inline editing

### Value nodes

Renameable value/input nodes show their current name as normal title text.
Their More menu contains **Rename** with a pencil icon. Selecting it turns the
title into an inline text field with its full current text selected. Enter or
focus loss validates and commits the name; Escape cancels the edit and restores
the prior title.

### Module and Function interface inputs

Module Geometry inputs and Module/Function parameter rows display a compact
pencil icon beside their name. Activating it starts the same inline edit model:
the name is selected, Enter or focus loss commits, and Escape cancels.

Renaming changes the public parameter/input name but preserves the existing
port identity and compatible live connections. Type and default-value editing
remain separate controls.

## Collapse

Normally collapsible nodes use the shared far-right header chevron button.

- New normally collapsible nodes start expanded.
- The button has accessible names **Collapse node** and **Expand node**, an
  accurate `aria-expanded` state, and uses the local chevron SVG icons.
- Collapsed state is persistent for normally collapsible nodes and does not
  remove or hide their existing connections.
- Hover, selection, and drawing a wire never expand a node. A held wire remains
  active when the user activates an Expand button.

Fixed compact nodes do not have Collapse controls. In particular, Value
Conditional and Geometry If remain fixed interfaces.

## Definition frames and interface nodes

Definitions are two related but distinct surfaces.

### Module and Function frames

The frame header presents a definition icon and a readable label, for example
`Module · enclosure` or `Function · chamfer(…)`. The actual definition name is
visually stronger than the keyword.

Frames provide a More menu for definition-level actions, including **Rename**
and **Delete**. Frames never show Add or Collapse controls. They remain
containers rather than ordinary node cards.

### Inputs interface node

The interface node inside a definition follows the ordinary node surface and
row rules. It uses an Inputs icon and an Add button, but no More menu: an
interface cannot be duplicated or deleted as an ordinary graph node.

- In a Module definition, Add offers **Geometry input** and **Parameter**.
- In a Function definition, Add offers **Parameter** only.
- Choosing Parameter from Add opens a compact anchored popover for name,
  type, and default value where applicable, with explicit confirmation/cancel
  actions. It never changes the Inputs node's layout or permanent keyboard
  order while open.
- Each removable interface item uses the row-level Remove parameter action and
  the established wire-disconnection warning when required.

The Geometry output interface uses the concise label **Output**; its Geometry
socket and family styling communicate the type.

## Exceptions and preservation rules

- Value Conditional and Geometry If retain their deliberately fixed compact
  interfaces and port order: `Condition`, `Case: True`, `Case: False`. They do
  not gain collapse, pin, or optional-parameter controls.
- This style guide does not alter node semantics, OpenSCAD generation, port
  keys, scope rules, connection lifecycle, persistence schema, or `.scadlet`
  compatibility.
- Existing accessibility, keyboard operation, touch behaviour, selection,
  Inspect, error, and Geometry-accent behaviour remain supported when a node
  is restyled.

## Implementation and review checklist

When adding or restyling a node, verify:

1. header order, icon, title, action visibility, accessible names, and focus;
2. family background and state styling do not conflict;
3. shared port/row spacing and socket positions;
4. Add menu, disabled/hidden rules, and row-level removal behaviour;
5. naming/editing behaviour appropriate to the node category;
6. collapse exception/status and persistence where applicable;
7. unchanged source generation, connections, scope rules, serialization, and
   restore behaviour;
8. visible UI coverage as well as focused unit/persistence coverage.
