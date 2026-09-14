# SCADlet — Agent Instructions

## Read this first

SCADlet is an open-source, browser-only visual programming environment for
OpenSCAD. It teaches functional programming through node graphs that generate
and transform 3D geometry. The graph is the primary interface; OpenSCAD is the
single source of geometry semantics.

Priorities, in order:

1. A clear, learnable visual language for pupils and early university students.
2. Geometry-first interaction and immediate visual results.
3. A fully client-side application and clean OpenSCAD export.
4. Simple, maintainable architecture.
5. Desktop/laptop browsers first; touch support is secondary.
6. Clarity over complete OpenSCAD compatibility.

Do not turn SCADlet into generic CAD or a generic visual-programming framework
without an explicit product decision.

## Working rules

- Use TypeScript, Vite, Lit, Rete.js, OpenSCAD WASM, Three.js, pnpm, and the
  Nix devShell. Do not add another UI framework without an architectural
  decision.
- Preserve the one-way path: Rete graph → OpenSCAD source → Web Worker →
  OpenSCAD WASM → STL → Three.js viewer. The viewer is never program state or
  an alternate geometry engine.
- Keep Rete as the source of truth for each graph's nodes, ports, connections,
  interaction, and dataflow. Do not add a parallel graph/AST.
- Use stable, language-independent IDs for persistent graph entities. Labels,
  localized text, names, positions, and DOM details are never semantic IDs.
- Make the smallest change that fulfills the current task. Do not implement
  future roadmap work speculatively.
- Preserve existing user work: representation/signature changes must not leave
  dangling wires or silently discard connected values.
- Generated `.scad`, rendered previews, and exported STL must derive from the
  same OpenSCAD source. Do not add a second evaluator.
- A confirmed valid empty top-level Geometry result is a successful preview
  replacement: clear any prior STL/mesh and show localized informational UI,
  while preserving source and keeping actual OpenSCAD/WASM failures visible.
- Direct and mutual recursion are valid for Functions and Modules. Order both
  through the shared reachable-Call SCC dependency analysis; do not statically
  analyse termination, which remains OpenSCAD-WASM's responsibility.
- Keep the app static and private: no backend, analytics, CDN assets, fonts,
  icons, or runtime APIs hosted by third parties.
- Maintain bundled project templates only as top-level
  `examples/example_*.scadlet` files. Build discovery must remain automatic
  and eager/offline; templates are immutable and enter the editable project
  lifecycle only as newly created IndexedDB copies.
- View-recovery controls (Fit graph and Reset 3D view) are transient
  presentation actions. They must never change semantic graph data, generated
  source, dirty/autosave state, Inspect provenance, or persisted project view
  state.

## Read the relevant reference before changing its area

These files are deliberately not loaded for unrelated work. Read only those
that apply; their constraints are part of the project contract.

| Work area | Required reference |
| --- | --- |
| Rete, renderer, source generation, worker, or viewer | [Architecture](docs/agent-guides/architecture.md) |
| Nodes, sockets, palette, canvas, controls, inspection, or localization | [Editor and UX](docs/agent-guides/editor-ux.md) |
| Modules, Functions, scopes, calls, signatures, or definition frames | [Definitions](docs/agent-guides/definitions.md) |
| `.scadlet`, migration, save/open, autosave, IndexedDB, or tabs | [Persistence](docs/agent-guides/persistence.md) and [format specification](docs/scadlet-format.md) |
| Dependencies, build/development tooling, hosting, privacy, errors, or tests | [Delivery and quality](docs/agent-guides/delivery-quality.md) |
| Work that might be a later feature | [Roadmap](docs/agent-guides/roadmap.md) |
| Rules for node styles | [node-style](docs/agent-guides/node-style.md) |

When a change affects more than one area, read every applicable reference.
If a decision would change a documented contract, explain the tradeoff before
implementing it and update the relevant reference with the code.

## Current product boundary

The working baseline includes primitives (Cube, Cylinder, Sphere), transforms
(Translate, Rotate, Scale), Boolean composition (Difference, variadic Union
and Intersection), typed values/math/conditionals, project persistence,
intermediate inspection, and reusable Modules/Functions. Keep it educational
and geometry-led. Iteration, a geometry code node, broader OpenSCAD coverage,
and teaching refinements remain future work.

OpenSCAD source import is not a current requirement. The development source
pane is for verification, not a code editor.

The compact shell keeps local IndexedDB project management and a clearly
separate immutable Examples section in Projects, while portable
`.scadlet`/source/STL actions stay in File. Selecting an example creates and
activates an ordinary, independently named local copy; examples never open
automatically. The default-on Live toggle is
a transient session setting: semantic graph edits debounce through the normal
render lifecycle, while layout, navigation, autosave, and other presentation
state never schedule a render. Enabling Live, activating a different local
project, and successfully restoring an existing local project at startup
render the newly current stale graph immediately through that same lifecycle.
The freshly created empty-project fallback remains idle. Live is never
serialized or project-specific. Successful main-preview results may be reused
from a bounded session-memory cache keyed by exact OpenSCAD source and render
options; manual Render always executes OpenSCAD freshly. Each automatic cache
miss has its own 15-second execution limit.

Normally collapsible nodes start expanded and use their always-visible chevron
control for explicit, persistent per-node collapse. This presentation-only
`collapsed` state is saved with a project; omitted state in v6 records means
expanded. Value Conditional and Geometry If retain their fixed compact
interfaces and have no collapse control. Hover, selection, and a held wire
gesture never expand a node or reveal hidden controls; its downward-chevron
control can expand it without ending that gesture.

## Decision order

When alternatives are viable, prefer: educational clarity; browser-only/static
operation; OpenSCAD as the only geometry semantics; the chosen stack; then the
simplest solution that keeps the next committed milestone feasible. Do not
treat unresolved product questions as settled requirements.
