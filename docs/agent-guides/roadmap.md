# Product boundary and roadmap

Read this before implementing a capability that may be future work.

## Current baseline

Implemented and stable: the Rete-to-OpenSCAD-to-WASM-to-STL-to-Three.js path;
Cube, Cylinder, Sphere; Translate, Rotate, Scale; Difference and ordered
variadic Union/Intersection; semantic optional parameters and typed values;
math/comparison/conditionals; node selection, compact presentation, and
intermediate inspect; client-side `.scadlet` persistence; and scoped reusable
Modules and Functions.

Current catalog/value semantics are intentionally limited. Geometry If is a
statement-level node valid in Main/Module scopes, with required Boolean
condition and Geometry then branch plus optional Geometry else branch. Value
Conditional is expression-level. Reachable incomplete nodes produce localized
evaluation errors; disconnected drafts do not create fake `undef` semantics.

## Later work

1. Iteration / visual OpenSCAD `for` (UX deliberately undecided).
2. A secondary geometry-oriented OpenSCAD code node with explicit parameter
   and possibly geometry inputs.
3. Teaching features: stepwise evaluation, dependency/geometry highlighting,
   exercises, explanations, and later UX refinement.

Broader nodes (extrusion, hull, minkowski, mirror, resize), variables and `$`
special variables, additional value types, import of existing `.scad`, dedicated
definition canvases, collaboration/sync, and broad OpenSCAD compatibility are
not implied by the current baseline. Implement them only when a task explicitly
settles their product design.

The original MVP—editable graph, core primitives/Boolean connections, source
generation, Worker-based OpenSCAD rendering, STL preview, and SCAD/STL export—
exists. Preserve this path while extending the product.
