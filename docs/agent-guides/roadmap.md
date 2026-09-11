# Product boundary and roadmap

Read this before implementing a capability that may be future work.

## Current baseline

Implemented and stable: the Rete-to-OpenSCAD-to-WASM-to-STL-to-Three.js path;
Cube, Cylinder, Sphere; Translate, Rotate, Scale; Difference and ordered
variadic Union/Intersection; semantic optional parameters and typed values;
math/comparison/conditionals; node selection, compact presentation, and
intermediate inspect; client-side `.scadlet` persistence; and scoped reusable
Modules and Functions, including direct and mutual recursion evaluated by
OpenSCAD-WASM without static termination analysis.

Current catalog/value semantics are intentionally limited. Geometry If is a
statement-level node valid in Main/Module scopes, with required Boolean
condition and Geometry then branch plus optional Geometry else branch. Value
Conditional is expression-level. Reachable incomplete nodes produce localized
evaluation errors; disconnected drafts do not create fake `undef` semantics.

## Later work

Implement later work in this order unless a concrete defect warrants a small,
independent repair first.

1. **Focused fixes and UI refinement.** Keep resolving concrete lifecycle,
   rendering, palette, and canvas usability problems as they arise. A small
   first-run example project is a possible onboarding improvement. Broader
   diagnostic interpretation, cached hover previews, collision-avoidance while
   moving nodes, and automatic layout are deliberately low priority.
2. **Iteration / visual OpenSCAD `for`.** Start with Geometry iteration in Main
   and Module scopes and a loop-local binding. Its UI and exact range/list
   model must be settled before implementation; it does not imply general
   user-defined variables.
3. **Missing basic value nodes.** Add useful arithmetic, mathematical, and
   logical operators selectively, preserving the current typed value model and
   Function-scope rules.
4. **Missing simple Geometry nodes.** Prioritize ordinary transformations such
   as Mirror and Resize, with the same scope, persistence, and effective-output
   rules as the existing Geometry catalog.
5. **2D Geometry and extrusion.** Treat 2D primitives, 2D Boolean operations,
   and linear/rotational extrusion as one coherent extension rather than
   isolated nodes.
6. **General variables and special variables.** Design local bindings / `let`
   and `$`-variable scoping explicitly after iteration; do not infer their
   semantics from the loop-local binding alone.
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
