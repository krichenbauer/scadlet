# Product boundary and roadmap

Read this before implementing a capability that may be future work.

## Current baseline

Implemented and stable:

- the Rete-to-OpenSCAD-to-WASM-to-STL-to-Three.js path, including a valid
  empty-Geometry outcome with an informational preview state rather than a
  render error;
- Cube, Cylinder, Sphere; Translate, Rotate, Scale; Difference and ordered
  variadic Union/Intersection; Geometry If; and typed values with Math,
  Compare (including direct Number fallbacks), and Value Conditional;
- scoped reusable Modules and Functions, nested Calls, and direct/mutual
  definition recursion evaluated by OpenSCAD-WASM without static termination
  analysis;
- client-side `.scadlet` v6 persistence, restore validation, and rejection of
  cyclic node dataflow while retaining permitted definition recursion;
- immutable, eagerly bundled example templates that create ordinary local
  copies only when selected from the Projects menu;
- dark, compact node presentation with explicit fixed Conditional/If interfaces,
  Geometry recognition, semantic Inspect provenance, and standard selection;
- transient view recovery: Fit graph for the canvas and Reset 3D view for a
  nonempty preview mesh.

Current catalog/value semantics are intentionally limited. Geometry If is a
statement-level node valid in Main/Module scopes, with required Boolean
condition and Geometry then branch plus optional Geometry else branch. Value
Conditional is expression-level. Reachable incomplete nodes produce localized
evaluation errors; disconnected drafts do not create fake `undef` semantics.

## Later work

Implement later work in this order unless a concrete defect warrants a small,
independent repair first.

1. **Focused fixes and UI refinement.** Keep resolving concrete lifecycle,
   rendering, palette, canvas, and view usability problems as they arise.
   The following UX work is intentionally collected here for separate design
   discussions and small, well-bounded implementation tasks:

   - simplify the top toolbar and move rendering controls next to the 3D view;
     decide separately which project/file actions belong in an overflow menu;
   - default-on live rendering with visible in-progress state and a safe
     complexity cutoff: if a render exceeds 300 ms, disable live rendering and
     explain why;
   - make Inspect/preview mode clearer: dim nodes outside the inspected
     subgraph and provide an unambiguous way to leave the preview;
   - replace hover-driven node collapsing with explicit, default-expanded
     `^` / `v` controls while retaining visible connections; make normal node
     layouts compact enough that collapsing is rarely necessary;
   - establish a consistent node visual language: Geometry nodes should use a
     restrained background tint rather than a border that competes with
     selection, and node layout/naming should be harmonized;
   - give every node a compact contextual menu suitable for touch, covering at
     least Delete and Duplicate. Move optional parameter additions there, while
     direct parameter removal stays adjacent to the parameter. Add useful node
     icons for recognition and palette scanning;
   Broader diagnostic interpretation, cached hover previews,
   collision-avoidance while moving nodes, and automatic layout are
   deliberately low priority.
2. **Iteration / visual OpenSCAD `for`.** Start with Geometry iteration in Main
   and Module scopes and a loop-local binding. Its UI and exact range/list
   model must be settled before implementation; it does not imply general
   user-defined variables.
3. **Copy and paste.** Support copying and pasting selected nodes and their
   internal connections within the current semantic scope. Define clipboard,
   placement, protected-interface-node, and cross-scope behavior explicitly
   when this work begins.
4. **Missing basic value nodes.** Add useful arithmetic, mathematical, and
   logical operators selectively, preserving the current typed value model and
   Function-scope rules.
5. **Missing simple Geometry nodes.** Prioritize ordinary transformations such
   as Mirror and Resize, with the same scope, persistence, and effective-output
   rules as the existing Geometry catalog.
6. **2D Geometry and extrusion.** Treat 2D primitives, 2D Boolean operations,
   and linear/rotational extrusion as one coherent extension rather than
   isolated nodes.
7. **General variables and special variables.** Design local bindings / `let`
   and `$`-variable scoping explicitly after iteration; do not infer their
   semantics from the loop-local binding alone.
8. **Remaining larger extensions.** A secondary geometry-oriented OpenSCAD
   code node with explicit parameter and possibly Geometry inputs, import of
   existing `.scad`, dedicated definition canvases, collaboration/sync, and
   broader OpenSCAD compatibility each require their own product design.

`color()` and multi-material output are intentionally deferred. STL has no
color semantics, and OpenSCAD does not automatically split an arbitrary model
into one STL per `color()` call. Supporting this well would require an explicit
SCADlet color/material model and a deliberate multi-part export workflow.

Broader nodes (for example hull and minkowski), additional value types, and
the larger extensions above are not implied by the current baseline. Implement
them only when a task explicitly settles their product design.

The original MVP—editable graph, core primitives/Boolean connections, source
generation, Worker-based OpenSCAD rendering, STL preview, and SCAD/STL export—
exists. Preserve this path while extending the product.
