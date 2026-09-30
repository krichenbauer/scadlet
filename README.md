# SCADlet

SCADlet is a browser-based visual node editor for OpenSCAD. Build and connect
node graphs to explore functional programming and constructive 3D modelling,
then render real OpenSCAD geometry in your browser. It is designed for learners
and teaching, with a focused subset of the OpenSCAD language.

[Open SCADlet](https://scadlet.org/) · [Source on GitHub](https://github.com/krichenbauer/scadlet)

## What you can do

- Combine 3D primitives, transforms (Translate, Rotate, Scale, Mirror, and
  Resize), ordered Boolean operations, conditional geometry, and numeric `For`
  loops.
- Drive geometry with typed Number, Boolean, and Vector3 values, math,
  conditionals, scoped variables, and reusable Modules and Functions, including
  recursive calls. Adjust scope-level detail with **SCAD settings**.
- Select and move groups, Copy/Cut/Paste/Duplicate graph nodes, explicitly
  collapse controls, and Inspect intermediate geometry or values.
- See changes through default-on **Live** preview, use **Render** for a fresh
  render, and orbit, pan, or zoom the 3D result. **Fit graph** and **Reset 3D
  view** recover the workspace view.

Drag nodes from the palette, edit their inline values, and connect compatible
outputs to inputs. Use a node's chevron, where available, to collapse or expand
its controls and its **More → Inspect** action to examine a result.

## Projects and examples

Projects autosave locally in your browser's IndexedDB. **Projects** manages
that library and provides bundled examples; selecting an example creates a
separate editable local copy. The original template stays unchanged.

Use **File** to open or save portable `.scadlet` projects and export readable
OpenSCAD (`.scad`) or rendered STL (`.stl`). Download `.scadlet` files to keep
copies outside browser storage or move projects to another browser. OpenSCAD
source import is not supported.

SCADlet runs entirely client-side, with no account, backend, analytics, or
third-party runtime services. Application resources and examples are bundled;
normal use needs no network after loading. Desktop and laptop browsers are the
primary target. Small touch viewports (at most 700px wide or 500px high) show a
larger-screen notice; larger tablets remain usable. 2D geometry, extrusion,
Lists, and Strings are planned, not current features.

## Development

The Nix devShell supports Linux x86-64 and Intel/Apple-Silicon macOS. It provides
Node.js, pnpm, and Git; on Linux it also supplies Playwright's Chromium.

```bash
nix develop
pnpm install
pnpm dev
```

On macOS, install Playwright's Chromium once with `pnpm exec playwright install
chromium` if it is not already available. The main commands are:

```bash
pnpm test                  # Unit and integration tests
pnpm exec tsc --noEmit      # Type checking
pnpm build                 # Production build
pnpm preview               # Serve the production build
pnpm test:e2e              # Chromium tests; builds and starts Vite Preview
```

The stack is TypeScript, Vite, Lit, Rete.js, OpenSCAD WASM, and Three.js.
Start contributing with [AGENTS.md](AGENTS.md), which routes to the architecture,
interaction, persistence, and delivery guides. See the
[project format](docs/scadlet-format.md) for portable-file details and the
[roadmap](docs/agent-guides/roadmap.md) for future work.

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
