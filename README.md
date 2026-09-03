# SCADlet

SCADlet is an early-stage, browser-based visual programming environment for OpenSCAD. It uses node graphs to make functional programming and constructive 3D modelling approachable for learners.

## What is SCADlet?

SCADlet is fully client-side: a graph evaluates to readable OpenSCAD source, which can be rendered in the browser through OpenSCAD WASM. It is designed for teaching and learning, rather than complete OpenSCAD language compatibility.

## Current features

- Geometry nodes for Cube, Cylinder, Sphere, transforms, and Boolean operations.
- Number, Boolean, Vector3, and basic math nodes for simple dataflow.
- Direct literal editing, compatible typed connections, compact expandable nodes, and intermediate-value inspection.
- In-browser OpenSCAD rendering with an interactive Three.js STL viewer.
- Export to `.scad` and `.stl`, plus local save/open and portable `.scadlet` project files.

## Usage

- Add nodes from the palette and connect compatible sockets.
- Edit literal values directly in nodes, or drive them with value and math nodes.
- Hover a node to expand its controls, or pin it open.
- Double-click a geometry or value-producing node to inspect an intermediate result.
- Use **Render** for the current preview; with no node inspected, it renders the complete model.
- Save or open `.scadlet` projects, and download generated OpenSCAD or STL files.

## Development

The Nix development shell provides Node.js, pnpm, Git, and Chromium:

```bash
nix develop
pnpm install
pnpm dev
```

Validate a change with:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
pnpm test:e2e
```

SCADlet is built with TypeScript and Vite. Lit provides the application UI, Rete.js owns graph structure and dataflow, OpenSCAD WASM produces geometry, and Three.js displays the resulting STL mesh.

## Open-source dependencies

The following significant direct runtime dependencies are bundled in the browser application. Their licenses were verified from the installed package metadata and upstream projects.

| Project | Purpose | License |
| --- | --- | --- |
| [Lit](https://lit.dev/) | Application Web Components | BSD-3-Clause |
| [Rete.js](https://retejs.org/) | Node graph model | MIT |
| [Rete Area Plugin](https://github.com/retejs/area-plugin) | Infinite-canvas editor interaction | MIT |
| [Rete Connection Plugin](https://github.com/retejs/connection-plugin) | Graph connection interaction | MIT |
| [Rete Engine](https://github.com/retejs/engine) | Dataflow evaluation | MIT |
| [rete-render-utils](https://github.com/retejs/render-utils) | Socket positioning and connection paths | MIT |
| [Three.js](https://threejs.org/) | STL mesh viewer | MIT |
| [OpenSCAD](https://openscad.org/) | Geometry language and engine | GPL-2.0-or-later |
| [openscad-wasm-prebuilt](https://github.com/lorenzowritescode/openscad-wasm) | Bundled OpenSCAD WASM integration | GPL-2.0-or-later |

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for distribution notices and source locations.

## License

SCADlet is licensed under the GNU General Public License v3.0 or later (`GPL-3.0-or-later`). See [LICENSE](LICENSE).
