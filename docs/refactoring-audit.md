# SCADlet refactoring audit: open work

Temporary engineering plan, not a contract. The permanent guides linked from
[AGENTS.md](../AGENTS.md) remain authoritative. The audit was made on
2026-09-29 (commit `c52d83f`) and brought up to date on 2026-09-30.

Completed findings, fixed defects, and their change logs were removed; git
history keeps them. Their lasting lessons are now design rules in the guides:

- [Shared rule authorities](agent-guides/architecture.md#shared-rule-authorities):
  one implementation per graph rule, and anything the editor accepts saves.
- [Architecture](agent-guides/architecture.md#scope-and-state-boundaries): the
  restore mode, change notifications, and label-free source generation.
- [Persistence](agent-guides/persistence.md#validation-and-restore): partial
  restore without silent loss, and validated file saves.
- [Delivery](agent-guides/delivery-quality.md#development-and-tests):
  characterization tests before refactoring, E2E wiring waits, and flake
  classification.

**Rating scale.** *Risk* is the regression risk of carrying out the
recommendation. *Benefit* is the expected reduction in defect risk and change
cost. *Scope* is the size of the change. References use file and symbol
names; line numbers are avoided.

## 1. Summary

The one-way pipeline is intact, and the rule duplication behind the audit's
defects is resolved:

- value types, scope bindings, loop rules, and scope snapshots each have one
  authority;
- file saves validate;
- restore never silently loses work;
- every editable input reports its changes.

No confirmed defect is open.

The remaining debt is concentrated in one place. `createEditor` in
[editor.ts](../src/editor/editor.ts) is still a 2,767-line closure with 17
hand-written transactions, and Module and Function lifecycles are still
duplicated. None of this causes known user-facing bugs today. It makes changes
to editing flows expensive, and only E2E tests protect it.

**Recommended order:**

1. **RF-01:** a transaction helper, introduced one operation family at a time.
2. **RF-05:** one Module/Function signature lifecycle.
3. **RF-06:** a shared type-transition planner.
4. **RF-07:** split `createEditor` into DOM-free services, which also enables
   unit tests for them (RF-15).

Everything else is independent, low-risk cleanup.

## 2. Current hotspots (measured 2026-09-30)

| File | Size | Assessment |
| --- | --- | --- |
| `editor/editor.ts` | 3,265 lines, 165 KB | `createEditor` spans 2,767 lines: Rete setup, gesture bridge, clipboard, context menu and long press, reference placement, scope drag, definition CRUD, signature operations, type transitions, viewport, feedback. 57 `instanceof <Node>` checks. The `SCADletEditor` facade has 54 members |
| `scadlet-app.ts` | 1,871 lines | About 350 lines of CSS. Mixes project lifecycle, render/Inspect orchestration, and duplicated Module/Function dialogs |
| `editor/render.ts` | 1,815 lines | Largely cohesive DOM presentation. `attachRenderer`, `renderNode`, and `renderHeader` take 16, 17, and 18 positional parameters; 33 `instanceof <Node>` checks |
| `editor/node-catalog.ts` | 990 lines | Cohesive registration table with repeated per-entry port predicates |
| `persistence/validate.ts` | 743 lines | Migrations plus validation, with internal duplication (RF-12) |

**Tests:** 87 unit test files with 737 tests; 25 E2E specs with 118 tests. No unit test constructs
`createEditor`. `local-persistence.spec.ts` holds 42 tests across unrelated
domains.

## 3. Open findings

### RF-01: Graph mutations are hand-rolled transactions

- **Evidence:** `createEditor` repeats this sequence: save `dirtySuspended` →
  set true → `connection.drop(); connectionGesture.cancel()` → mutate →
  catch-block re-add loops → restore flag → guarded `notifySemanticDirty()`.
  There are 17 such suspensions, 17 `window.confirm` calls, and 9 rollback
  loops. The copies differ:
  - `deleteModuleParameter` restores parameters, Call fallbacks, and
    connections on failure; `deleteFunctionParameter` only resets the flag and
    throws;
  - `deleteModuleGeometryInput` neither suspends notifications nor cancels the
    gesture and has no rollback;
  - `editModuleParameter` and `editFunctionParameter` remove doomed
    connections outside suspension, so each removal emits its own semantic
    change.
- **Why it matters / failure modes:** atomicity and "one semantic change per
  action" are documented contracts. The weaker copies leave partial state
  after an unexpected Rete rejection, trigger duplicate Live/autosave runs,
  and get copied by new features.
- **Direction:** one editor-internal helper, for example
  `runGraphTransaction({ confirm?, mutate, rollback })`. It suspends
  notifications (restoring the previous value), cancels the gesture, records
  removed/added connections and nodes with position, scope, and collapse,
  restores in reverse on failure, and emits exactly one semantic change. It is
  a function over the existing Rete APIs, not a command or undo framework.
  Migrate one operation family per change.
- **Keep unchanged:** Rete as graph authority; preflight before confirm;
  confirmation texts; the separate `restoringProject` mode; paste's
  `graphTransactionSuspended`.
- **Risk / Benefit / Scope:** High / High / Medium.
- **Protected by:** E2E `local-persistence.spec.ts` (parameter deletion,
  Function result transitions, recursive Module delete),
  `graph-clipboard.spec.ts`, `for-loops.spec.ts`, `variables.spec.ts`.
- **Tests needed first:**
  - per migrated family, exactly one semantic change (count `onSemanticChange`
    in E2E, as `graph-clipboard.spec.ts` does);
  - a cancelled confirmation leaves the project unchanged, comparing the
    serialized project and ignoring `metadata.updatedAt`.

### RF-05: Module and Function lifecycles are duplicated

- **Evidence:**
  - These pairs in `editor.ts` are near-copies: `add*Parameter`,
    `edit*Parameter`, `delete*Parameter`, `synchronize*Signature`,
    `signatureConnections`/`functionSignatureConnections`, `createModule`/
    `createFunction`, `renameModule`/`renameFunction`, and
    `deleteModule`/`deleteFunction`, plus the `nodecreated` wiring for the two
    Inputs nodes.
  - The Call node classes differ in 78 of 240 normalized lines, and the
    interface node classes in 158 of 286.
  - `ScadletApp` duplicates the dialog state and handlers.
  - The copies already diverge in rollback (RF-01).
- **Direction:** one parameter-signature service parameterized by definition
  kind (Call class, error keys, Geometry-input support), and one
  `createDefinition`/`deleteDefinition` with Function result propagation as a
  kind-specific extension. Extract the shared Call parameter materialization
  and argument emission into one helper. Keep separate exported classes and
  distinct error texts.
- **Risk / Benefit / Scope:** Medium / High / Medium.
- **Protected by:** `module-parameters.test.ts`,
  `function-definitions.test.ts`, `definitions.test.ts`,
  `module-recursion.test.ts`, E2E `parameter-popover.spec.ts`, and the
  definition tests in `local-persistence.spec.ts`.
- **Tests needed first:** an E2E Function parameter type change and deletion
  with connected Calls and references, mirroring the Module test; Call node
  fallback retention across `syncSignature` for both kinds.
- **Depends on:** RF-01.

### RF-06: Four parallel type-transition protocols

- **Evidence:** `handleFunctionResultConnectionAttempt`,
  `handleConditionalBranchConnectionAttempt`, and both branches of
  `removeConnectionOrConfirm` each implement: compute doomed connections →
  confirm → suspend → remove → retype sockets → roll back on failure. That is
  about 250 lines. Supporting special cases live in `canConnectSocketData`,
  two async `connectioncreate` pipes, multi-connectable Conditional inputs,
  and `unresolvedSocket`.
- **Direction:** keep the pre-signal interception, but express each case as
  `planTypeTransition(...) → { nextTypes, doomed }` with one shared apply and
  rollback built on RF-01. Keep `planFunctionResultTransitions` as the
  Function planner.
- **Keep unchanged:** async ordering before Rete adds the wire;
  multi-connectable branch inputs; the neutral unresolved presentation; the
  pipes skipping restore.
- **Risk / Benefit / Scope:** High / Medium / Medium.
- **Tests needed first:** E2E for Conditional unresolve on disconnecting the
  last branch with a connected Result (confirm and cancel); a cancelled
  Function result type change leaves the source unchanged.
- **Depends on:** RF-01.

### RF-07: `createEditor` accumulates unrelated responsibilities

- **Evidence:**
  - One closure holds all the responsibilities listed in section 2.
  - Twelve of the 54 facade members have no caller outside `editor.ts`:
    `removeInputSafely`, `removeOutputSafely`,
    `getInspectParticipatingNodeIds`, and the nine Module/Function parameter
    and Geometry-input operations, which are reached only through the
    internal `nodecreated` pipe.
  - `attachDeletion`'s `keydown` and `isolateControlGestures`' `wheel`
    listeners are anonymous and never removed by `destroy`.
  - `definitionAt` and `definitionAtGraphPosition` duplicate frame
    hit-testing.
- **Direction:** after RF-01 and RF-05, extract cohesive units with an
  explicit narrow context:
  - graph clipboard;
  - context menu plus long press;
  - reference placement;
  - scope-drag transfer;
  - a DOM-free definition/signature service.

  Keep `createEditor` as the composition root and the pipe registration
  order. Trim unused facade members only after checking E2E use.
- **Risk / Benefit / Scope:** High / High / Large.
- **Tests needed first:** a pipe-order test (the compatibility guard runs
  before the For, Function, and Conditional pipes); an E2E destroy/recreate
  check with no duplicate Delete handling after a project switch.
- **Depends on:** RF-01, RF-05.

### RF-08: Renderer plumbing

- **Evidence:**
  - `attachRenderer`, `renderNode`, and `renderHeader` thread 16–18 positional
    parameters.
  - Rendering branches on about 12 node classes.
  - `referenceCreationForOutput` re-derives which outputs are bindings,
    instead of asking the binding authority.
  - The editor's connection pipe recomputes connected inputs for every node
    on each connection event, and `renderNode` recomputes them again to handle
    a race.
- **Direction:** one `RendererCallbacks` object; derive reference eligibility
  from `bindings.ts`/`scope-bindings.ts`; update connected inputs only for the
  two endpoint nodes. Keep the custom DOM renderer.
- **Risk / Benefit / Scope:** Low / Medium / Small.
- **Protected by:** `render.test.ts`, `presentation.test.ts`, E2E
  `node-ui-consistency.spec.ts`, `node-collapse.spec.ts`,
  `connection-direction.spec.ts`.

### RF-09: Port schema repeated per catalog entry

- **Evidence:**
  - Most `CATALOG_ENTRIES` repeat one port predicate in both `isInputPort`
    and `inputSocketType`, with 8 hand-written `isInputPort` blocks.
  - The Translate/Rotate/Scale/Mirror/Resize entries and the Union/
    Intersection entries are near-identical.
  - Dynamic slot schemas are encoded in the catalog, the node classes,
    `graph-clipboard.ts` `remapChildPorts`, and `validate.ts`.
  - The `NODE_CATALOG` wrapper hand-forwards all eight `NodeCreationContext`
    fields; a new field that isn't forwarded is silently dropped.
  - No test checks that catalog predicates agree with live node ports.
- **Direction:**
  - shared entry factories for vector transforms and variadic Booleans;
  - derive `isInputPort` from `inputSocketType(...) !== undefined` where
    equivalent;
  - a catalog hook for dynamic-slot remapping;
  - spread the creation context.
- **Keep unchanged:** persisted port IDs, legacy bare `a`/`b` acceptance, and
  error messages.
- **Risk / Benefit / Scope:** Medium / Medium / Medium.
- **Tests needed first:** a parity test. For every catalog type and its
  representative parameter variants, the live input keys and socket names
  must match `isInputPort`/`inputSocketType`.

### RF-10: Two numeric-literal formats in generated source (optional)

- **Evidence:** `formatNumber` in [format.ts](../src/openscad/format.ts)
  rounds to 6 decimals without exponents. It is used by primitive, settings,
  and transform formatters. Node `data()` paths use `String(value)`. The same
  Cube size prints as `cube(1.234568);` unwired and
  `cube(1.23456789, center=true);` once Center is wired.
- **Assessment:** not a defect. Differences start below 0.000001 units, and
  the exponent-free format is an intentional readability choice.
- **Direction if ever done:** route every emitter through `formatNumber`,
  optionally so a non-zero value never formats as `0`. Keep the readable
  format.
- **Risk / Benefit / Scope:** Low / Low / Small.

### RF-11: Remaining zero-Step edge cases

- **Evidence:**
  - The Step field refuses a literal zero, and validation rejects an
    unconnected zero Step. A hand-edited file whose connected Step keeps a `0`
    fallback still loads, and becomes unsaveable once that wire is removed.
  - `LoopStructureProblem.code` declares `'step'`, but `loopStructureProblem`
    never returns it.
- **Direction:** when a Step wire is removed and the fallback is `0`, restore
  the Step control's last valid value or refuse with feedback (a small product
  decision); remove the unused `'step'` code.
- **Risk / Benefit / Scope:** Low / Low / Small.

### RF-12: Internal duplication in `validate.ts`

- **Evidence:**
  - `validateDefinitions` validates identity, interface roles, and
    `resultType` twice: once in its reference pre-pass and again in the main
    loop, where the Module and Function branches repeat the interface checks.
  - The local `validateModuleParameters` duplicates the rules of
    `definitions.ts` `validateModuleParameters`.
  - The Conditional unresolved-type checks exist in both `validateConnection`
    and `validateGraph`.
  - `hasVariableBindingCycle` duplicates the dependency and cycle logic of
    `evaluate.ts` `evaluateScopeVariables`.
  - The current validator is still named `validateV1`.
- **Direction:** validate definition headers once and reuse them; share a pure
  binding-dependency analysis over node records with the evaluator; rename
  `validateV1` internally.
- **Keep unchanged:** every migration and the sequential chain, the error
  messages asserted by tests, and the unknown-field discard behaviour.
- **Risk / Benefit / Scope:** Medium / Medium / Medium.
- **Tests needed first:** a corpus test that every fixture in `docs/examples/`,
  `src/persistence/fixtures/`, and `examples/` parses to an identical canonical
  result before and after.

### RF-14: `ScadletApp` mixes execution orchestration and untranslated text

- **Evidence:**
  - The "cancel active execution" block is repeated (5 `renderController.stop()`
    sites).
  - The valid-empty and "Nothing to render" handling is repeated in
    `_renderProject` and `_inspect`.
  - "Create local project → apply → publish → refresh" is repeated four times.
  - 19 user-facing strings bypass `t()`, such as
    `window.confirm('Discard changes…')` and "Local saving failed; recent
    changes may be lost.".
  - A render-timing `console.log` ships in production.
- **Direction:** a plain-TypeScript render/Inspect coordinator next to
  `LiveRenderScheduler`, with unit tests; `_cancelActiveExecution()`; move
  every string to `t()` keys; drop the `console.log`.
- **Risk / Benefit / Scope:** Medium / Medium / Medium.
- **Protected by:** `render-controller.test.ts`,
  `live-render-scheduler.test.ts`, `preview-cache.test.ts`, E2E
  `preview-cache.spec.ts`, `live-project-switch.spec.ts`,
  `empty-geometry.spec.ts`, `inspect-dismissal.spec.ts`.

### RF-15: Test organization

- **Evidence:**
  - There is no DOM-free harness for `createEditor`.
  - E2E helpers are redefined per spec and have drifted: `dropPaletteNode` in
    13 files (7 distinct bodies), `connect` in 12 (4), `seedActiveProject` in
    5 (4), `fileAction` in 8 (2), and `ready` in 8 (3).
  - `local-persistence.spec.ts` mixes about eight domains in 42 tests.
  - E2E reads internal state through 70 `as unknown as {…}` casts and 53
    `getEditorInstance()` calls.
  - Three full parallel repeat runs (351 of 351) found no flaky test.
- **Direction:** shared helpers in `e2e/support.ts`, including a `connect`
  that waits for the new wire; split `local-persistence.spec.ts` by domain
  without removing assertions; unit-test the DOM-free services from RF-07. Do
  not add jsdom or happy-dom without a dependency decision.
- **Risk / Benefit / Scope:** Low / Medium / Medium.
- **Tests needed first:** record the per-spec test titles and counts before
  moving anything.

### RF-16: Implicit registry lookup fails open

- **Evidence:** `bindDefinitionRegistry` stores the registry in a
  module-level `WeakMap`. `shareDefinitionScope` returns `true` when none is
  bound, and `canConnectSocketData` and `wouldCreateNodeDataflowCycle` rely on
  it.
- **Direction:** pass a `scopeOf` resolver explicitly, or fail closed when
  unbound in the editor.
- **Risk / Benefit / Scope:** Low / Low / Small.

### RF-18: Dead, obsolete, and stale items

Each item was checked for indirect use through the catalog, restore, E2E, and
fixtures.

- **No callers:** `SCADletEditor.removeInputSafely`, `removeOutputSafely`, and
  `getInspectParticipatingNodeIds` have no caller (the `port-lifecycle.ts`
  functions themselves are tested).
- **Unreferenced template assets:** `src/assets/hero.png`, `vite.svg`,
  `lit.svg`, and `public/icons.svg` (`public/` ships in `dist`).
- **Test-only code:** the `ModuleCallNode(string, string)` constructor
  overload.
- **Surprising defaults:** `SphereNode` chooses different defaults depending
  on whether a `notify` callback is passed.
- **Stale comments:**
  - 31 comments cite obsolete milestones, phases, or `AGENTS.md section N`;
  - `createEditor` ("added in a later step");
  - `evaluateOpenSCAD` ("no transformation/CSG nodes yet");
  - `SCADletEditor.addModuleCallAt` ("refused in Phase 2").
- **Unreachable reorder:** parameter and Geometry-input reorder
  (`onMove`, and `move` in `edit*Parameter`) is wired but no UI or test calls
  it, while [Definitions](agent-guides/definitions.md) still describes
  reorder. This needs a product decision, not deletion.
- **Risk / Benefit / Scope:** Low / Low / Small.

## 4. Things that should not be refactored now

- **Migration chain and legacy acceptance:**
  - `migrateV1ToV2` … `migrateV7ToV8`;
  - the bare `a`/`b` Union ports;
  - `defaultModuleGeometryInput` deterministic IDs;
  - the `ScadletProjectV1`/`ScadletProjectV7` aliases.

  These are compatibility contracts in [scadlet-format.md](scadlet-format.md).
- **The custom DOM renderer:** its socket `render`/`rendered`/`unmount`
  emissions, the SVG bounding-box padding, and per-render `replaceChildren`.
- **Gesture timing workarounds:**
  - the deferred insert in `commitSnappedConnection`;
  - capture-phase `pointerup` on `window`;
  - keyboard-synthesized `PointerEvent`s for sockets;
  - `connectiondrop` snap retention;
  - `ClicklessZoom`, `overflow: clip`, and `isolateControlGestures`.
- **The async `connectioncreate` pipes** for Function Output and Conditional
  branches, and multi-connectable branch inputs. RF-06 may restructure their
  bodies, not their position.
- **The `guardPortRemoval` and catalog change-tracking wrappers.** They are
  idempotent and are the single enforcement points for orphan-free ports and
  change notification, including later-added controls.
- **Restore's prepare-then-apply design,** the rollback plan built before
  clearing, and partial restore with backup.
- **The render pipeline:** a fresh OpenSCAD instance per render, worker
  termination on Stop, `ExecutionGeneration`, the narrow empty-top-level
  classification, and the cache admission rules.
- **The transient popup registry,** long-press timing, and keyboard
  context-menu access.
- **E2E fixed delays** that assert absence within a window.
- **Large but cohesive files:** `node-editor.ts` (CSS), `node-catalog.ts`,
  and `value-nodes.ts`.
- **No new AST or IR.** Rete-dataflow string emission shows no structural
  limit; AGENTS.md forbids a parallel graph.

## 5. Recommended sequence

Each package is behaviour-preserving, covers one concern, and passes all
required checks before the next starts. Characterization tests come first
([Delivery](agent-guides/delivery-quality.md#development-and-tests)).

| # | Package | Findings | Prerequisite tests |
| --- | --- | --- | --- |
| 1 | `runGraphTransaction`, first family: `requestRemoveForm` and the Geometry-input operations | RF-01 | Single-change and cancel-identity E2E |
| 2 | Remaining transaction families, one per change | RF-01 | Same, per family |
| 3 | Unified Module/Function signature service and shared Call parameter helper | RF-05 | Function parameter E2E |
| 4 | Shared type-transition planner | RF-06 | Conditional and Function cancel E2E |
| 5 | Extract services from `createEditor`, one per change, with unit tests | RF-07, RF-15 | Pipe-order test; destroy/recreate E2E |
| 6 | Shared E2E helpers; split `local-persistence.spec.ts` | RF-15 | Title and count list |
| 7 | Renderer callbacks object and endpoint-only connected-input sync | RF-08 | Reference-eligibility unit test |
| 8 | Catalog parity test, then entry factories and context spread | RF-09 | Parity test |
| 9 | `validate.ts` consolidation | RF-12 | Fixture corpus test |
| 10 | App render coordinator and `t()` strings | RF-14 | Existing render E2E |
| 11 | Small items: explicit scope resolver, zero-Step edge, dead code and stale comments | RF-16, RF-11, RF-18 | Search proof per item |
| – | Optional: one literal formatter | RF-10 | Literal snapshot |

**Not currently justified:**

- a new AST or IR, a command/undo framework, or a generic signature DSL;
- moving `src/editor/` into separate folders;
- replacing the explicit migration chain with a loop;
- bundle code-splitting for the 500 kB build warning;
- replacing `window.confirm` with modal dialogs, which is a UX decision.

## 6. Suggested next task: RF-01, first transaction family

**Scope:** add an editor-internal `runGraphTransaction` helper in
`editor.ts` (or a small sibling module receiving editor, area, presentation,
gesture, and notification access). Migrate only two families:

- `requestRemoveForm`, which removes wires before a node drops an optional
  form;
- the Module Geometry-input operations (`addModuleGeometryInput`,
  `editModuleGeometryInput`, `deleteModuleGeometryInput`).

The deletion path is currently the weakest copy: no suspension, no gesture
cancel, no rollback.

**Non-goals:**

- other families;
- confirmation texts;
- Function or parameter operations (RF-05);
- facade changes.

**Invariants:**

- one semantic change per completed action and none for a cancelled
  confirmation;
- an unchanged project after cancellation;
- an unchanged Rete-driven connection removal and pipe order;
- the previous `dirtySuspended` value restored rather than forced off.

**Characterization tests (before the change):** E2E that counts
`onSemanticChange` while:

- removing a connected optional form (for example a wired Cube size);
- deleting a connected Module Geometry input, with confirm and cancel.

Assert the resulting wires, the generated source, and a clean autosave.

**Completion:** both families use the helper; all new and existing tests pass,
with existing tests unchanged unless a change genuinely makes sense; all
required checks are green.

## 7. Verification

Documentation-only update on 2026-09-30, on commit `9dd68d1` in the Nix
devShell (macOS arm64, Node v24.19.0, pnpm 11.25.0, Playwright Chromium):

| Check | Result |
| --- | --- |
| `pnpm test` | Pass. 87 files, 737 tests passed |
| `pnpm exec tsc --noEmit` | Pass. Exit 0 |
| `pnpm build` | Pass. Exit 0, with the known 500 kB chunk-size warning |
| `pnpm test:e2e` | Pass. 118 passed in 37.3 s |
| `git diff --check` | Pass. Exit 0 |
