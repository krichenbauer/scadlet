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
- client-side `.scadlet` v7 persistence, restore validation, and rejection of
  cyclic node dataflow while retaining permitted definition recursion;
- immutable, eagerly bundled example templates that create ordinary local
  copies only when selected from the Projects menu;
- dark, compact node presentation with explicit fixed Conditional/If interfaces,
  Geometry recognition, semantic Inspect provenance, and standard selection;
- the focused UI refinement pass: compact, touch-aware node controls and
  palette guidance; clear Inspect exit and normal-preview resumption; and
  responsive live-preview rendering with bounded cached results;
- transient view recovery: Fit graph for the canvas and Reset 3D view for a
  nonempty preview mesh.
- one scope-level SCAD settings node in Main and each Module, with optional
  `$fn`/`$fa`/`$fs` Number rows, connected expression dependencies, and no
  Function-scope availability.

Current catalog/value semantics are intentionally limited. Geometry If is a
statement-level node valid in Main/Module scopes, with required Boolean
condition and Geometry then branch plus optional Geometry else branch. Value
Conditional is expression-level. Reachable incomplete nodes produce localized
evaluation errors; disconnected drafts do not create fake `undef` semantics.

## Later work

Implement later work in this order unless a concrete defect warrants a small,
independent repair first.

1. **Named values and references.** Let uniquely named Value nodes act as
   bindings. Their compact reference nodes must remain stable through renames,
   validate scope usage, and generate readable OpenSCAD bindings.
2. **Iteration / visual OpenSCAD `for`.** Add Geometry iteration in Main and
   Module scopes using a fixed Header/Result pair with a structural wire and a
   loop-local binding, built on the named-value/scope model.
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
7. **Remaining larger extensions.** A secondary geometry-oriented OpenSCAD
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
