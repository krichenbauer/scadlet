# Product boundary and roadmap

Current capabilities are summarized in [README](../../README.md); the other
guides describe their contracts. Keep this document forward-looking.

## Next work, in priority order

These are the ordered next areas of work, not implemented capabilities or
permission to add them during unrelated tasks. Detailed designs remain to be
settled by their feature tasks.

1. **List and String values.** Establish the type-system and value operations
   before dependent geometry features: general polygon point data needs lists,
   and text needs Strings. Candidate operations include indexing, `len`,
   `concat`, `lookup`, `search`, `str`, `chr`, `ord`, and later list comprehensions.
2. **Missing simple Geometry nodes.** Prioritize Mirror and Resize, retaining
   the existing scope, persistence, and effective-output rules.
3. **2D Geometry and extrusion.** Design 2D primitives, 2D Boolean composition,
   and linear/rotational extrusion as a coherent extension. Settle dimensional
   typing, compatible connections, and the transition to the existing 3D
   preview/export path together. General polygons and text follow their
   List/String prerequisites; no particular socket representation is decided
   by this roadmap.

## Later ideas requiring product decisions

- A secondary geometry-oriented OpenSCAD code node with explicit parameter
  inputs and possibly Geometry inputs.
- OpenSCAD source import; the current source pane remains a verification view,
  not an editor.
- Dedicated definition canvases, broader OpenSCAD coverage (including Hull and
  Minkowski), and teaching refinements such as detailed source-to-node errors.
- Collaboration/synchronization, which would require revisiting the current
  static, private, browser-only product boundary.

`color()` and multi-material output remain deferred. STL carries no colour
semantics, and arbitrary `color()` calls do not define separate STL parts.
This needs an explicit material model and deliberate multi-part export design.

Do not infer a general CAD framework, closures, macros, or complete OpenSCAD
compatibility from these ideas. Preserve the existing graph → OpenSCAD → WASM
→ STL path while extending the product.
