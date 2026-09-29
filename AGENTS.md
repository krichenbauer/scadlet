# SCADlet — Agent and contributor instructions

SCADlet is an open-source, browser-only visual programming environment for
OpenSCAD. It teaches functional programming through geometry-led node graphs
for pupils and early university students. Prefer educational clarity, immediate
visual results, client-side operation, and maintainable design over complete
OpenSCAD compatibility. Desktop/laptop browsers come first; touch is secondary.

## Read before changing an area

Read this file first, then every guide relevant to the task. The guides own
subject-specific contracts; read all affected areas for changes spanning them.

| Area | Authoritative reference |
| --- | --- |
| Layers, Rete, source generation, worker, preview, viewer | [Architecture](docs/agent-guides/architecture.md) |
| Scopes, Modules, Functions, calls, parameters, bindings, iteration | [Definitions](docs/agent-guides/definitions.md) |
| Selection, connections, placement, clipboard, popups, Inspect, shell | [Editor and UX](docs/agent-guides/editor-ux.md) |
| Node layout, palette, sockets, colours, collapse, accessibility | [Node style](docs/agent-guides/node-style.md) |
| Save/open, IndexedDB, autosave, examples, compatibility | [Persistence](docs/agent-guides/persistence.md) |
| Exact persisted schema and historical migrations | [Format specification](docs/scadlet-format.md) |
| Tooling, privacy, errors, verification, delivery | [Delivery and quality](docs/agent-guides/delivery-quality.md) |
| Pending features and product decisions | [Roadmap](docs/agent-guides/roadmap.md) |

## Global invariants

- Use TypeScript, Vite, Lit, Rete.js, OpenSCAD WASM, Three.js, pnpm, and the
  Nix devShell. Another UI framework requires an architectural decision.
- Rete owns nodes, ports, connections, interaction, and dataflow. Keep the path
  Rete graph → OpenSCAD source → Web Worker → OpenSCAD WASM → STL → Three.js.
  Do not add a parallel graph/AST, evaluator, or viewer-owned model state.
  Preview and exports derive from the same OpenSCAD source.
- Keep the application static and private: no backend, analytics, CDN assets,
  external fonts/icons, or third-party runtime APIs.
- Use stable, language-independent IDs. Names, labels, positions, and DOM details
  are never semantic identity. Preserve existing work through edits and loads;
  never silently discard connected values or leave dangling wires.
- Keep UI text, accessibility labels, code, comments, examples, and documentation
  in English. User-facing natural-language text uses the existing `t()` keys.
- Make the smallest change that fulfills the task. Do not implement roadmap
  items speculatively or turn SCADlet into generic CAD or a general visual
  programming framework without an explicit product decision.

## Commands and completion

Enter `nix develop`, install dependencies with `pnpm install`, and start with
`pnpm dev`. `pnpm preview` serves a built application.

Update relevant tests and the owning documentation with behavioural changes.
Explain a documented-contract change before implementing it. Completion requires
reviewing the diff, preserving compatibility and unique constraints, validating
links for documentation edits, and passing these checks in the Nix environment:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm test:e2e
git diff --check
```

Follow the delivery guide for isolation, failure handling, and the final report.
Do not claim completion with failed, interrupted, skipped, or uncertified checks.
