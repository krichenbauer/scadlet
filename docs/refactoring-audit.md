# SCADlet architecture and refactoring audit

Temporary engineering audit, not a contract. The permanent guides linked from
[AGENTS.md](../AGENTS.md) remain authoritative. Audited at commit `c52d83f`
on 2026-09-29 against a clean working tree. The audit itself was read-only.
Defects D-1, D-2, and D-3 were fixed afterwards in separate changes, and a
later-found restore defect (D-5) was fixed with the nested-loop rule change,
all recorded in section 9. All other sections describe the audited commit.

**Rating scale.** *Risk* is the regression risk of carrying out the
recommendation. *Benefit* is the expected reduction in defect risk and change
cost. *Scope* is the size of the change. References use file and symbol names;
line numbers are intentionally avoided.

## 1. Executive summary

**Overall health: good foundations, one overloaded centre.** The one-way
pipeline (Rete graph → OpenSCAD source → Worker → WASM → STL → Three.js) is
intact. The import graph of 89 production modules has no cycles. The render
subsystem (`src/render/`), `openscad/` formatters, `DefinitionRegistry`,
`graph-clipboard.ts` planning, `function-dependencies.ts`, and the
persistence store/autosave modules are small, cohesive, and well tested. All
required checks pass: 693 unit tests and 109 E2E tests.

**Major restructuring is not justified. Targeted consolidation is.** The
problems are concentrated, not systemic:

1. **`createEditor` in [editor.ts](../src/editor/editor.ts) is a 2,787-line
   closure** that owns about nine responsibilities. Every multi-step graph
   mutation is a hand-written transaction: 17 `dirtySuspended = true` sites,
   17 `window.confirm` sites, and 9 catch-block rollback loops. Their rollback
   and notification behaviour is inconsistent (RF-01, RF-07).
2. **Scope, binding, and For rules have no single authority.** The same rules
   are rebuilt in the editor, evaluator, scope transfer, clipboard, validator,
   and restore. Two editor-reachable states that persistence rejects were
   reproduced during this audit (RF-03, RF-11).
3. **Module and Function lifecycles are duplicated**, as are the four
   type-inference transition protocols. The copies have already diverged in
   rollback behaviour (RF-05, RF-06).

**Defects confirmed during the audit.** Each was reproduced with throwaway
scratch tests outside the repository.

| ID | Defect | Evidence | Finding | Status |
| --- | --- | --- | --- | --- |
| D-1 | Deleting the inspected node leaves Inspect active. The stale ID stays and the remaining nodes stay dimmed as out of scope, although [Editor and UX](agent-guides/editor-ux.md) requires deletion to clear it | Chromium: Delete on an inspected Cube; `getInspectedNodeId()` still returns the deleted ID and the Sphere keeps `node--inspect-out-of-scope` | RF-02 | Fixed (section 9) |
| D-2 | Renaming a Value to an existing For iterator name in the same scope is accepted, then autosave fails ("Local saving failed; recent changes may be lost."). Pasting a Value named like an iterator and naming a parameter like an iterator hit the same gap | Chromium: For plus Number, rename the Number to `i` | RF-03 | Fixed (section 9) |
| D-3 | Typing `0` into a For Step field is accepted, then autosave fails. Explicit Save As would write the same project unvalidated | Chromium plus unit reproduction (`serializeProject` → `parseScadletProject` throws "zero step") | RF-11 | Fixed (section 9) |
| D-4 | Two numeric literal formats coexist: Cube size `1.23456789` emits `cube(1.234568);` unwired but `cube(1.23456789, center=true);` once Center is wired. Output differs only beyond six decimals | Direct `data()` calls on `CubeNode`, `SphereNode`, `NumberNode`, `TranslateNode` | RF-10 | Reclassified: not a defect (section 9.3) |
| D-5 | Found after the audit: a project with two For pairs in one scope loses every wire, including both fixed loop boundaries, when it is reopened, and rendering reports "For nodes must remain a complete pair in one scope." The stored copy stays intact until the next edit, whose autosave then fails | Chromium on the committed code before the fix: two sibling For pairs in Main, reload → 0 wires | RF-13 | Fixed (section 9.4) |

**Recommended degree of refactoring:** incremental and medium-sized. Fix the
three defects in their own behaviour changes (D-1, D-2, and D-3 are done).
Then centralize duplicated policies (bindings, scope snapshots, transactions,
the Module/Function lifecycle). Split `createEditor` only after those seams exist. No new AST,
command framework, or folder reorganization is warranted.

**Main risk of doing nothing:** each new cross-cutting feature (Lists and
Strings, 2D Geometry) must be threaded through five or more rule copies and
more hand-rolled transactions. That is how D-1 to D-3 arose. `createEditor`
has no unit-test harness, so those paths are protected only by E2E tests.

**Main risk of over-refactoring:** the Rete integration depends on subtle,
documented timing, including async `connectioncreate` pipes, capture-phase
gesture bridges, deferred snap commits, and restore rollback. A broad rewrite
or a generic command/undo layer would likely regress these behaviours, which
are only partly covered.

## 2. Current architecture

**Layers (as they exist):**

| Layer | Modules | Notes |
| --- | --- | --- |
| Application shell | [scadlet-app.ts](../src/scadlet-app.ts), `components/*`, `layout/`, [transient-popups.ts](../src/ui/transient-popups.ts) | Lit. The app owns project lifecycle, render/Inspect orchestration, and dialogs |
| Editor orchestration | [editor.ts](../src/editor/editor.ts) (`createEditor`, `SCADletEditor`) | Wires Rete plugins and pipes and implements all transactional graph operations |
| Canvas presentation | [render.ts](../src/editor/render.ts), [definition-frames.ts](../src/editor/definition-frames.ts), `marquee.ts`, `selection.ts`, `connection-gesture.ts`, `presentation.ts`, `inspect.ts`, `view-fit.ts` | Custom DOM renderer; no Lit per node |
| Graph semantics | `nodes/*`, [node-catalog.ts](../src/editor/node-catalog.ts), `sockets.ts`, [definitions.ts](../src/editor/definitions.ts), [bindings.ts](../src/editor/bindings.ts), [for-validation.ts](../src/editor/for-validation.ts), [scope-transfer.ts](../src/editor/scope-transfer.ts), [connection-compatibility.ts](../src/editor/connection-compatibility.ts), `dataflow-cycle.ts`, `function-dependencies.ts`, [graph-clipboard.ts](../src/editor/graph-clipboard.ts), `port-lifecycle.ts` | Lives in `src/editor/` alongside the presentation modules |
| Code generation | [evaluate.ts](../src/editor/evaluate.ts) plus each node's `data()`, plus `openscad/*` pure formatters/validators | Rete `DataflowEngine` carries source strings |
| Persistence | [project.ts](../src/persistence/project.ts), [validate.ts](../src/persistence/validate.ts), [serialize.ts](../src/persistence/serialize.ts), [restore.ts](../src/persistence/restore.ts), `local-project-store.ts`, `autosave.ts`, `active-project.ts`, `project-events.ts`, `file-service.ts`, `builtin-examples.ts` | Depends on catalog and semantic editor modules, as documented |
| Render pipeline | `src/render/*` | Controller, worker, protocol, Live scheduler, LRU cache, execution generation |

**Dependency direction:** app → components/editor/persistence/render;
persistence → editor semantics (`node-catalog`, `definitions`,
`for-validation`, `dataflow-cycle`); editor → `openscad/`. Inside
`src/editor/`, presentation modules import `ui/transient-popups` and
`components/icons`; `node-catalog.ts` imports only the type
`CompactIconName`. There are no cycles.

**State ownership:**

| State | Owner |
| --- | --- |
| Nodes, ports, sockets, connections | Rete `NodeEditor` |
| Node semantic parameters | Node instances and controls (`getPersistedParams`) |
| Scope membership, signatures, protected interfaces | `DefinitionRegistry`, also bound to the editor through a module-level `WeakMap` (`bindDefinitionRegistry`) |
| Positions / viewport | `AreaPlugin` / area transform plus the `persistedViewport` closure variable |
| Collapse, connected-row disclosure | `NodePresentationManager` |
| Inspect root and provenance | `InspectManager`, plus `ExecutionGeneration` in the app |
| Selection | Rete selection plus `ConnectionSelectionManager` |
| Clipboard, placement ghosts, context menu, long press, scope drag, reference placement | Closure variables inside `createEditor` |
| Dirty and semantic notifications | Closure listener sets plus `dirtySuspended` / `graphTransactionSuspended` flags |
| Project identity, revision, autosave, render UI state | `ScadletApp` reactive fields |
| Camera | `GeometryViewer` |

**Graph mutation flow:** UI event → `createEditor` handler → preflight (catalog,
bindings, scope, `loopStructureProblem`) → optional `window.confirm` → set
`dirtySuspended` → Rete add/remove. Rete pipes then run the compatibility
guard, For guard, Function-result and Conditional transition pipes, the dirty
pipe, variadic slot growth, and `noderemoved` cleanup. Registry and area
updates follow, the flag is restored, and one `notifySemanticDirty()` fires →
the app marks autosave dirty and calls `LiveRenderScheduler.semanticChange()`.

**Evaluation flow:** `ScadletApp._renderProject` → `evaluateOpenSCAD`:
`assertValidForLoops` per scope, Main roots,
`assertNoIncompleteReachableBranch`, then `engine.fetch` per root, with nodes
emitting fragments in `data()`. Next come scope settings, dependency-ordered
scope variables, and definitions in SCC order from
`analyzeFunctionDependencies` (Functions, then Modules, then Main), joined into
source → `RenderController` → worker → STL → viewer. Inspect uses
`evaluateInspectNode`. `.scad` export calls `evaluate()` again.

**Persistence flow:**

- *Save:* `serializeProject` → `AutosaveController` →
  `IndexedDBLocalProjectStore.saveProject`, which validates with
  `parseScadletProject` and checks the revision. File Save As
  instead runs `JSON.stringify` with no validation.
- *Load:* `parseScadletProjectText` → sequential migrations v1…v8 →
  `validateV1` → `restoreProject`, which prepares the new plan and a rollback
  plan before clearing, then applies.

**Test structure:** Vitest runs in a Node environment, DOM-free: 78 files,
693 tests. It covers catalog, nodes, codegen (18 files call
`evaluateOpenSCAD`), persistence (about 200 tests), and render. Playwright
runs 23 specs with 109 tests against the production build, using
per-test contexts and diagnostic fixtures. No unit test constructs
`createEditor`.

## 3. Evidence and measurements

**Largest production files, with their responsibility assessment:**

| File | Lines / bytes | Assessment |
| --- | --- | --- |
| `editor/editor.ts` | 3,305 / 167 KB (153 lines >120 chars) | `createEditor` spans about 2,787 lines. **Accumulated:** Rete setup and pipes, gesture bridge, clipboard with ghost, context menu and long press, reference placement, scope drag, definition CRUD, signature operations, type transitions, viewport, feedback. 56 `instanceof <Node>` checks |
| `scadlet-app.ts` | 1,779 / 72 KB | About 350 lines of CSS. Mixes project lifecycle, render/Inspect orchestration, and duplicated Module/Function dialogs. **Partly accumulated** |
| `editor/render.ts` | 1,778 / 83 KB | Node/port/popover DOM. **Largely cohesive presentation**, but 33 `instanceof <Node>` checks and 16 to 18 positional parameters per function |
| `components/node-editor.ts` | 1,548 / 43 KB | About 1,403 lines of node CSS. **Large but cohesive** |
| `editor/node-catalog.ts` | 916 / 54 KB | Registration table. **Cohesive**, with repeated per-entry port predicates |
| `persistence/validate.ts` | 765 / 43 KB | Migrations plus validation. **Cohesive**, with internal duplication |
| `editor/nodes/value-nodes.ts` | 551 / 35 KB | 13 node classes plus validators. **Cohesive** |

**Import fan-out:** `editor.ts` 34, `node-catalog.ts` 29, `scadlet-app.ts`
24, `render.ts` 23, `evaluate.ts` 15.
**Fan-in:** `i18n/translate` 29, `sockets` 21, `definitions` 18,
`schemes` 15, `node-catalog` 12, `controls` 12.

**Repeated patterns (verified by search):**

| Pattern | Copies |
| --- | --- |
| Live scope → `{id,type,parameters}` snapshot for `loopStructureProblem` | 4 (`editor.ts` ×3, `evaluate.ts` `assertValidForLoops`), plus a DTO variant in `validate.ts` |
| Scope binding table or name set | 6 (`bindingNamesInScope`, `resolveBindingInScope`, `scopeTransferProblem` `namesByScope`, `validateScopeBindings`, `restore.ts` `collectBindings`, clipboard `plannedBindingResolution`) plus 3 inline `enclosingNames` sets |
| Upstream "incoming edges" traversal | 6 (`inspectParticipatingNodeIds`, `isBodylessForResultRoot`, `assertNoIncompleteReachableBranch`, `evaluateScopeVariables`, `inspectDependsOnEscapedIterator`, `hasVariableBindingCycle`) |
| Binding dependency ordering / cycle detection | 2 (`evaluateScopeVariables`, `hasVariableBindingCycle`) |
| Inline value-type lists (`'number' \| 'boolean' \| 'vector3'` and similar) | About 24 occurrences in 11 files |
| Module vs Function Call nodes (after normalizing names) | 78 of 240 lines differ |
| Module vs Function interface nodes | 158 of 286 lines differ |
| `ScadletApp` "cancel active execution" block | 4 (`_invalidateProjectRender`, `_handleSemanticChange`, `_handleInspectEnd`, `_stop`) |
| User-facing English strings bypassing `t()` in `scadlet-app.ts` | 18 |
| Production comments citing stale milestones, phases, or `AGENTS.md section N` | 31 in 17 files |

**Node-kind dispatch.** By `instanceof <…Node>`: `editor.ts` 56, `render.ts`
33, `node-catalog.ts` 31, `evaluate.ts` 15. By `type === '<id>'` string:
`validate.ts` 38, `editor.ts` 38, `render.ts` 15, `graph-clipboard.ts` 9.

**`SCADletEditor` facade:** 54 members. Twelve have no caller outside
`editor.ts`: `removeInputSafely`, `removeOutputSafely`,
`getInspectParticipatingNodeIds`, and the nine Module/Function parameter and
Geometry-input operations, which are reached only through the internal
`nodecreated` pipe. `addVariableReferenceAt` is used only by E2E.

**Tests around hotspots:**

- `createEditor` transactions (cut/paste commit, parameter deletion rollback,
  Function-result/Conditional transitions, definition deletion) have zero unit
  tests and are exercised only through E2E.
- Only `transitionTrigonometryOperation` and `transitionVectorMathOperation`
  are exported for DOM-free tests.
- `local-persistence.spec.ts` holds 42 of the 109 E2E tests (2,628 lines) and
  spans Modules, Functions, recursion, math, collapse, and wiring.
- E2E helpers are redefined per spec with drift: `dropPaletteNode` in 11
  files (7 distinct bodies), `connect` in 10 (4), `seedActiveProject` in 5
  (4), `fileAction` in 8 (2).
- E2E reads internal state through 61 `as unknown as {…}` casts and 50
  `getEditorInstance()` calls.

## 4. Findings

### RF-01 — Graph mutations are hand-rolled transactions with inconsistent guarantees

- **Category:** graph mutation / transactions.
- **Evidence:** `createEditor` repeats this sequence: save `dirtySuspended` →
  set true → `connection.drop(); connectionGesture.cancel()` → mutate →
  catch-block re-add loops → restore flag → `if (!previous…) notifySemanticDirty()`.
  Counts: 17 `dirtySuspended = true`, 14 `connection.drop()` calls (most
  paired with `connectionGesture.cancel()`), 16 guarded notifications, 9
  rollback loops. The copies differ:
  - `deleteModuleParameter` restores parameters, Call fallbacks, and
    connections on failure; `deleteFunctionParameter` only resets the flag and
    throws.
  - `deleteModuleGeometryInput` neither suspends notifications nor cancels the
    gesture and has no rollback.
  - `editModuleParameter` and `editFunctionParameter` remove doomed
    connections outside suspension, so each removal emits its own semantic
    notification.
  - `withDirtyTrackingSuspended` resets the flag to `false` rather than to its
    previous value.
- **Affected:** `editor.ts`: `removeNodeAndReferences`, `cutNodes`,
  `commitClipboardPlacement`, `addNodeAt` (For pair),
  `deleteModuleParameter`, `deleteFunctionParameter`,
  `deleteModuleGeometryInput`, `edit*Parameter`, `deleteModule`,
  `deleteFunction`, `handleFunctionResultConnectionAttempt`,
  `handleConditionalBranchConnectionAttempt`, `removeConnectionOrConfirm`,
  `requestRemoveForm`, `request*OperationChange`.
- **Why it matters:** atomicity and "one semantic change per action" are
  documented contracts in [Editor and UX](agent-guides/editor-ux.md) and
  [Definitions](agent-guides/definitions.md), and each copy re-implements
  them.
- **Failure modes:** partial state after an unexpected Rete rejection
  (Function parameter delete); duplicate Live and autosave triggers; nested
  suspension re-enabling notifications early; new features copying the
  weakest variant.
- **Recommended direction:** one editor-internal helper, for example
  `runGraphTransaction({ confirm?, mutate, rollback })`. It suspends
  notifications (restoring the previous value), cancels the active gesture,
  records removed and added connections and nodes with position, scope, and
  collapse, restores in reverse on failure, and emits exactly one semantic
  notification. Keep it a function over the existing Rete APIs, not a command
  or undo framework. Migrate call sites one family at a time.
- **Keep unchanged:** Rete as graph authority; the preflight-then-confirm
  order; localized confirmation texts; `graphTransactionSuspended` semantics
  during paste.
- **Risk / Benefit / Scope:** High / High / Medium.
- **Currently protected by:** E2E `local-persistence.spec.ts` (parameter
  deletion, Function result transitions, recursive Module delete),
  `graph-clipboard.spec.ts`, `for-loops.spec.ts`, `variables.spec.ts`.
- **Characterization needed first:**
  - Per migrated operation, assert exactly one semantic notification. Use
    `onSemanticChange` counting in E2E, as `inspect-dismissal.spec.ts` counts
    evaluations.
  - Assert that cancelling confirmation leaves the project unchanged: the
    serialized graph, definitions, and view state are equal before and after,
    ignoring `metadata.updatedAt`.
  - Once RF-07 enables a DOM-free harness, inject Rete failures (a pipe
    returning `undefined`) to cover rollback.
- **Depends on:** RF-02 (separate the flag's two meanings first).

### RF-02 — `dirtySuspended` conflates notification suppression with "restore in progress"

- **Category:** state ownership / defect root cause (D-1).
- **Evidence:** the `noderemoved` pipe clears Inspect only `if (!dirtySuspended)`,
  so that restore's provisional removals keep provenance.
  `removeNodeAndReferences` sets `dirtySuspended = true` for ordinary
  deletion, which skips `inspect.remove`. Reproduced in Chromium (D-1).
  `graphTransactionSuspended` is a second, differently scoped flag.
- **Affected:** `editor.ts` `createEditor` (`noderemoved` pipe,
  `withDirtyTrackingSuspended`, all RF-01 sites);
  `ScadletApp._restoreProject`.
- **Why it matters:** one boolean encodes "do not notify", "restore may roll
  back", and "transaction in progress", so every new transaction silently
  changes Inspect cleanup.
- **Failure modes:** stale Inspect after deleting via Delete key, context menu,
  or More → Delete (all through `removeNodeAndReferences`), and potentially
  after definition or parameter deletion removes the inspected node (same
  flag, not reproduced). Cut and Paste are unaffected because `cutNodes` and
  `commitClipboardPlacement` call `endInspect()` explicitly. Future cleanup
  hooks keyed on the same flag inherit the problem.
- **Recommended direction:**
  - Fix D-1 as its own behaviour change: clear Inspect when a committed
    deletion removes the inspected node.
  - Then give restore an explicit mode (for example `restoring`) distinct from
    notification suppression. `withDirtyTrackingSuspended` should save and
    restore the previous value.
- **Keep unchanged:** restore rollback must still preserve the previous
  Inspect result until the replacement commits (the existing comment in the
  `noderemoved` pipe).
- **Risk / Benefit / Scope:** Medium / High / Small.
- **Currently protected by:** `inspect-dismissal.spec.ts`,
  `live-project-switch.spec.ts`, `restore.test.ts` (rollback).
- **Characterization needed first:**
  - E2E: deleting the inspected node (Delete key and More → Delete) clears
    Inspect and dimming. Written as the D-1 fix test.
  - E2E: a failed project switch preserves the Inspect marker.
- **Depends on:** none.
- **Status:** fixed (section 9). Restore now has its own `restoringProject`
  mode, and `withDirtyTrackingSuspended` restores previous flag values. The
  wider transaction consolidation remains RF-01.

### RF-03 — Binding name, visibility, and resolution rules have no single authority

- **Category:** scope and binding / duplicated policy (D-2).
- **Evidence:**
  - `bindingNamesInScope` collects bound Values and parameters but **not**
    For iterators.
  - `resolveBindingInScope` does include iterators.
  - `scopeTransferProblem` builds its own `namesByScope`.
  - `validateScopeBindings` (validate) rejects iterator/Value collisions.
  - `restore.ts` builds its own table (`collectBindings`).
  - `plannedBindingResolution` (clipboard) re-derives binding types.
  - The enclosing names passed to `loopStructureProblem` are computed per call
    site: inline in the For pipe, `assertValidForLoops`, and `validateGraph`,
    and through `bindingNamesInScope` in `renameValueBinding` and
    `preflightClipboardPaste`.

  `renameValueBinding` for a Value checks only `bindingNamesInScope`, so a
  Value may take an iterator's name. Validation then rejects the project
  (reproduced, D-2). `preflightClipboardPaste` computes
  `unavailableBindingNames` from the same helper, so a pasted Value named like
  an existing iterator is also accepted (reproduced by the section 9 E2E test
  against the audited code).
- **Status:** the naming gap (D-2) is fixed by
  `reservedBindingNamesInScope` (section 9). The structural recommendation
  below, one binding table shared with `validate.ts` and `restore.ts`, remains
  open.
- **Affected:** `bindings.ts`, `scope-transfer.ts`, `for-validation.ts`
  callers, `validate.ts` `validateScopeBindings`, `restore.ts`
  `prepareRestorePlan`, `editor.ts` `renameValueBinding` /
  `preflightClipboardPaste`, `graph-clipboard.ts` `planGraphClipboardPaste`.
- **Why it matters:** [Definitions](agent-guides/definitions.md) defines one
  uniqueness and visibility rule. Divergent copies allow the editor to create
  data that persistence refuses.
- **Failure modes:** autosave errors after a rename, paste, or transfer; the
  same file loading in one path and failing in another; each new binding kind
  (Lists, Strings) needs six edits.
- **Recommended direction:** a pure module (for example
  `editor/scope-bindings.ts`) over the DTO-shaped snapshot
  `{id,type,parameters}[]` plus the definition parameters. It returns the scope
  binding table (id → name, type, kind), the name-availability check including
  iterator rules, and reference resolution. Live callers use it through the
  RF-04 snapshot; `validate.ts` and `restore.ts` use it directly on DTOs. Keep
  the error message text in `validate.ts` (tests assert it).
- **Keep unchanged:** stable binding-ID identity, sibling iterator name reuse,
  the no-shadowing rule, and v7 label-only Values staying unbound.
- **Risk / Benefit / Scope:** High / High / Medium.
- **Currently protected by:** `variables.test.ts`, `for-loops.test.ts`,
  `for-scope-transfer.test.ts`, `graph-clipboard.test.ts`,
  `validate.test.ts`, E2E `variables.spec.ts`, `for-loops.spec.ts`.
- **Characterization needed first:** a table-driven unit test over the
  candidate names Value, parameter, iterator, sibling iterator, and nested
  iterator. For each, record the verdict of `bindingNamesInScope` plus
  `renameValueBinding` logic, `scopeTransferProblem`, `loopStructureProblem`,
  and `parseScadletProject`. Agreed rows lock behaviour; the D-2 row becomes
  the fix test.
- **Depends on:** RF-04.

### RF-04 — Repeated live scope snapshots and upstream traversals

- **Category:** duplication / preparatory extraction.
- **Evidence:** the same "filter scope nodes → `identifyNodeType` →
  `serializeParams` → in-scope edges with `String()` ports" builder appears in
  the `connectioncreate` For pipe, in `renameValueBinding`, in
  `preflightClipboardPaste`, and in `evaluate.ts` `assertValidForLoops`. Six
  separate incoming-edge traversals exist (section 3).
  `inspectDependsOnEscapedIterator` re-filters all connections per visited
  node.
- **Affected:** `editor.ts`, `evaluate.ts`, `validate.ts`
  (`hasVariableBindingCycle`).
- **Why it matters:** these builders define what `loopStructureProblem` and
  the binding checks see. A drift in one copy changes validation for only one
  path.
- **Failure modes:** one path forgets `String()` coercion or the scope filter;
  quadratic traversal on large graphs.
- **Recommended direction:** `liveScopeSnapshot(editor, definitions, scope,
  parameterOverrides?)` and a small `upstreamClosure(connections, roots)`
  helper. Behaviour-preserving extraction. See section 7.
- **Keep unchanged:** each call site's enclosing-name set (unified only in
  RF-03) and the prospective-edge append in the For pipe.
- **Risk / Benefit / Scope:** Low / Medium / Small.
- **Currently protected by:** `for-loops.test.ts`,
  `for-scope-transfer.test.ts`, `variables.test.ts`, `inspect.test.ts`,
  `evaluate.test.ts`, E2E `for-loops.spec.ts`, `graph-clipboard.spec.ts`.
- **Characterization needed first:** E2E coverage for the live For guard. No
  test currently asserts that an escaping iterator wire is refused with
  feedback, or that renaming an iterator to a Value name is refused.
- **Depends on:** none.
- **Status:** done (section 9.6). The live-scope builders now share
  `liveScopeSnapshot`, and two identical upstream walks share
  `upstreamNodeIds`. The other traversals (for example
  `assertNoIncompleteReachableBranch` and `hasVariableBindingCycle`) are
  unchanged.

### RF-05 — Module and Function definition lifecycles are duplicated and have diverged

- **Category:** duplication / definitions.
- **Evidence:**
  - These pairs are near-copies: `addModuleParameter`/`addFunctionParameter`,
    `editModuleParameter`/`editFunctionParameter`,
    `deleteModuleParameter`/`deleteFunctionParameter`,
    `synchronizeModuleSignature`/`synchronizeFunctionSignature`,
    `signatureConnections`/`functionSignatureConnections`,
    `createModule`/`createFunction`, `renameModule`/`renameFunction`,
    `deleteModule`/`deleteFunction`, and the nodes-created wiring for
    `ModuleInputsNode`/`FunctionInputsNode`.
  - Node classes: Call nodes differ in 78 of 240 normalized lines; interface
    nodes in 158 of 286.
  - `ScadletApp` duplicates the dialog state (`moduleDialogOpen`/
    `functionDialogOpen` and six sibling fields plus handlers).
  - Divergence: rollback exists only for Module parameter deletion (RF-01).
- **Affected:** `editor.ts`, `nodes/module-call-node.ts`,
  `nodes/function-call-node.ts`, `nodes/module-interface-nodes.ts`,
  `nodes/function-interface-nodes.ts`, `scadlet-app.ts`.
- **Why it matters:** the two contracts share the parameter signature by
  design (see [Definitions](agent-guides/definitions.md)); differences are
  limited to Geometry inputs, result type, and allowed scopes.
- **Failure modes:** fixes applied to only one kind; signature features
  (future List/String parameters) implemented twice.
- **Recommended direction:** one parameter-signature service parameterized by
  definition kind (Call node class predicate, error-key set, Geometry-input
  support). One `createDefinition(kind, name)` and `deleteDefinition(id)`,
  with Function result propagation as a kind-specific extension. Extract the
  shared Call parameter materialization, fallbacks, and argument emission into
  one helper used by both Call nodes. Keep separate exported classes.
- **Keep unchanged:** distinct error texts
  (`definition.duplicateFunctionParameter`), public `create*`/`rename*`
  events, Geometry-input semantics, persisted shapes.
- **Risk / Benefit / Scope:** Medium / High / Medium.
- **Currently protected by:** `module-parameters.test.ts`,
  `function-definitions.test.ts`, `definitions.test.ts`,
  `module-recursion.test.ts`, E2E `parameter-popover.spec.ts` and the
  definition tests in `local-persistence.spec.ts`.
- **Characterization needed first:**
  - E2E: Function parameter type change and deletion with connected Calls and
    references, mirroring the existing Module deletion test.
  - Unit: Call node fallback retention across `syncSignature` for both kinds.
- **Depends on:** RF-01.

### RF-06 — Four parallel type-transition protocols

- **Category:** type and port handling.
- **Evidence:** `handleFunctionResultConnectionAttempt`,
  `handleConditionalBranchConnectionAttempt`, and both branches of
  `removeConnectionOrConfirm` each implement: compute doomed connections →
  confirm → suspend → remove → retype sockets → roll back on failure. They
  total about 250 lines. Supporting special cases:
  - `canConnectSocketData` (Function Output `result`, Conditional branches);
  - two dedicated async `connectioncreate` pipes;
  - multi-connectable Conditional inputs in `ConditionalNode`;
  - neutral `unresolvedSocket`;
  - validation duplicates the Conditional rules in both `validateConnection`
    and `validateGraph`.
- **Affected:** `editor.ts`, `connection-compatibility.ts`,
  `nodes/value-nodes.ts` (`ConditionalNode`),
  `nodes/function-interface-nodes.ts`, `validate.ts`.
- **Why it matters:** inferred types are the model future dynamic types would
  extend. Each protocol re-derives the doomed set independently.
- **Failure modes:** inconsistent confirmation or rollback between connect and
  disconnect; a third inferred node would add two more copies.
- **Recommended direction:** keep the pre-signal interception, but express each
  case as `planTypeTransition(...) → { nextTypes, doomed }` plus one shared
  apply and rollback built on RF-01. Keep `planFunctionResultTransitions` as
  the Function planner.
- **Keep unchanged:** async ordering before Rete adds the wire (the comment on
  `guardPortRemoval` races), multi-connectable branch inputs, neutral
  unresolved presentation.
- **Risk / Benefit / Scope:** High / Medium / Medium.
- **Currently protected by:** `function-definitions.test.ts`,
  `socket-compatibility.test.ts`, E2E "propagates nested Function result
  transitions…" and the Conditional tests in `local-persistence.spec.ts`.
- **Characterization needed first:** E2E for Conditional unresolve on
  disconnecting the last branch with a connected Result (confirm and cancel);
  confirm-cancel of a Function result type change leaves source unchanged.
- **Depends on:** RF-01.

### RF-07 — `createEditor` accumulates unrelated responsibilities behind a wide facade

- **Category:** module boundaries.
- **Evidence:**
  - One closure contains Rete and pipe setup, the gesture bridge
    (`commitSnappedConnection`, `attachConnectionGestureEvents`), graph
    clipboard (payload, ghost preview, placement, commit), context menu,
    touch long press, keyboard shortcuts, reference placement, scope-drag
    transfer, definition CRUD, signatures (RF-05), type transitions (RF-06),
    viewport and fit, and feedback. `SCADletEditor` has 54 members, 12 of them
    without an external caller.
  - `attachDeletion`'s `keydown` listener and `isolateControlGestures`'
    `wheel` listener are anonymous and never removed by `destroy`.
  - `definitionAt` and `definitionAtGraphPosition` duplicate frame
    hit-testing.
- **Affected:** `editor.ts`, callers in `components/node-editor.ts`,
  `scadlet-app.ts`, E2E via `getEditorInstance()`.
- **Why it matters:** the size prevents unit testing (no DOM in Vitest, and no
  new DOM dependency without a decision), so every transactional path is
  E2E-only. It also makes ownership of transient state implicit.
- **Failure modes:** listener leaks across editor recreation; features added
  to the closure because it is the only place with access to everything.
- **Recommended direction:** after RF-01, RF-04, and RF-05, extract cohesive
  units that receive an explicit narrow context (editor, area, definitions,
  presentation, transaction helper, feedback):
  1. graph clipboard controller (payload, preview, placement, commit);
  2. context menu plus long press;
  3. reference placement;
  4. definition/signature service (DOM-free, unit-testable);
  5. scope-drag transfer.

  Keep `createEditor` as the composition root. Trim unused facade members
  only after checking E2E usage.
- **Keep unchanged:** the order of pipe registration, which is semantically
  significant; `SCADletEditor` members used by `scadlet-app`, `node-editor`,
  and E2E.
- **Risk / Benefit / Scope:** High / High / Large.
- **Currently protected by:** the full E2E suite.
- **Characterization needed first:** a pipe-order note or test (the
  compatibility guard runs before the Function/Conditional pipes); an E2E
  destroy/recreate check with no duplicate Delete handling after project
  switch.
- **Depends on:** RF-01, RF-04, RF-05.

### RF-08 — Renderer plumbing: positional callbacks and node-kind branching

- **Category:** UI infrastructure.
- **Evidence:**
  - `attachRenderer` takes 16 positional parameters, `renderNode` 17, and
    `renderHeader` 18; the callback list is threaded through three levels.
  - Rendering branches on `ConditionalNode`/`IfNode`, four interface classes,
    `NumberNode`/`BooleanNode`/`Vector3Node`, `ForHeaderNode`/`ForResultNode`,
    and Call classes.
  - `referenceCreationForOutput` re-derives which outputs are bindings, which
    duplicates `bindings.ts`.
  - Connected-input state is computed both by the editor pipe (looping all
    nodes × connections on every connection event into
    `presentation.setConnectedInputs`) and again inside `renderNode` to
    handle a race.
- **Affected:** `render.ts`, `editor.ts` (connection pipe), `bindings.ts`.
- **Why it matters:** adding a header action or node exception touches three
  signatures, and binding identity leaks into presentation.
- **Failure modes:** argument-order mistakes; presentation drifting from
  binding rules.
- **Recommended direction:** a single `RendererCallbacks` object; move
  "binding source of output" into `bindings.ts`; compute connected inputs only
  for the two endpoint nodes. Keep the DOM renderer.
- **Keep unchanged:** custom renderer, socket `render`/`unmount` emission,
  SVG padding workaround, focus restoration via `requestAnimationFrame`.
- **Risk / Benefit / Scope:** Low / Medium / Small.
- **Currently protected by:** `render.test.ts`, `presentation.test.ts`, E2E
  `node-ui-consistency.spec.ts`, `node-collapse.spec.ts`,
  `connection-direction.spec.ts`.
- **Characterization needed first:** none beyond existing tests for the
  callback object; a unit test that reference creation is enabled exactly for
  bound Values, parameters, and iterators.
- **Depends on:** none (the bindings part aligns with RF-03).

### RF-09 — Port schema knowledge is repeated per catalog entry and spread across layers

- **Category:** type and port handling / persistence.
- **Evidence:**
  - Most `CATALOG_ENTRIES` repeat the same port predicate in both
    `isInputPort` and `inputSocketType`. Translate, Rotate, and Scale entries
    are identical apart from class and label; Union and Intersection likewise.
  - Dynamic slot schemas (Difference/Union/Intersection/For result `children`,
    Min/Max `operands`) are encoded in the catalog, the node classes,
    `graph-clipboard.ts` `remapChildPorts`, and `validate.ts`
    (Min/Max slot rules).
  - Typing for interfaces, Calls, and references lives only in `validate.ts`
    `validateConnection` (catalog `outputSocketType: () => undefined`).
  - The `NODE_CATALOG` wrapper hand-forwards all eight `NodeCreationContext`
    fields; adding a field without forwarding silently drops it.
- **Affected:** `node-catalog.ts`, `graph-clipboard.ts`, `validate.ts`,
  `nodes/*`.
- **Why it matters:** the live port set comes from node constructors, while
  validation uses the catalog. Nothing checks that they agree.
- **Failure modes:** a representation change accepted live but rejected on
  load, or the reverse (the documented Union bare-ID mismatch is one existing
  instance); clipboard remap missing a new dynamic node.
- **Recommended direction:**
  - Shared entry factories for vector transforms and variadic Booleans.
  - Derive `isInputPort` from `inputSocketType(...) !== undefined` where
    equivalent.
  - An optional catalog hook for dynamic-slot remapping that the clipboard
    calls.
  - Spread the creation context (`{ ...context, onControlsChanged }`).
- **Keep unchanged:** persisted port IDs, legacy bare `a`/`b` acceptance, and
  error messages.
- **Risk / Benefit / Scope:** Medium / Medium / Medium.
- **Currently protected by:** `node-catalog.test.ts`,
  `builtin-port-invariants.test.ts`, `semantic-signatures.test.ts`,
  `round-trip.test.ts`, `graph-clipboard.test.ts`.
- **Characterization needed first:** a parity test. For every catalog type and
  its representative parameter variants, the live node's input keys equal
  `{p | isInputPort(p) || inputs.includes(p)}` and socket names equal
  `inputSocketType`.
- **Depends on:** none.

### RF-10 — Two numeric-literal formats in generated OpenSCAD

- **Category:** code generation consistency (D-4, reclassified as not a
  defect; see section 9.3).
- **Evidence:** `formatNumber` in [format.ts](../src/openscad/format.ts)
  rounds non-integers to 6 decimals. It is used by `cubeToOpenSCAD`, Sphere,
  Cylinder, settings, and transforms. Node `data()` paths use `String(value)`:
  `NumberNode`, math nodes, `Vector3Node`, `ForHeaderNode`, `CubeNode`'s
  wired-Center and XYZ paths, `VectorTransformNode` XYZ, and
  `ModuleCallNode`/`FunctionCallNode` arguments, as does `evaluate.ts`
  `moduleParameterLiteral`. Measured:

  | Input | Emitted source |
  | --- | --- |
  | Cube size `1.23456789` | `cube(1.234568);` |
  | Same size, Center wired | `cube(1.23456789, center=true);` |
  | Sphere radius `1.23456789` | `sphere(r=1.234568);` |
  | Number `1e-7` | `1e-7` |
  | Cube size `1e-7` | `cube(0);` |

- **Affected:** `openscad/*.ts`, `editor/nodes/*.ts`, `evaluate.ts`.
- **Why it matters (limited):** the source pane can show the same value in
  two formats depending on which code path emits it. The practical effect is
  negligible: differences start below 0.000001 model units, far beneath print
  or preview resolution, and only a value no learner would type (such as
  `1e-7`) rounds to zero. The 6-decimal formatting is deliberate:
  `formatNumber` avoids scientific notation so generated source stays readable
  for learners. The Architecture rule against lowering explicit detail
  concerns settings such as `$fn`, not literal decimals.
- **Failure modes:** a learner comparing source panes sees different digits
  for an identical value; a tiny non-zero value becomes `0` in primitives.
- **Recommended direction (optional, not scheduled):** route every emitter
  through the existing `formatNumber`, optionally adjusted so a non-zero value
  never formats as `0`. Keep the readable, exponent-free format. Do not switch
  the application to `String(value)` output. Saved files are unaffected;
  only generated source for values with more than six decimals would change.
- **Keep unchanged:** integer output, vector formatting, the exponent-free
  readable format.
- **Risk / Benefit / Scope:** Low / Low / Small.
- **Currently protected by:** `openscad/*.test.ts`, `round-trip.test.ts`,
  E2E `numeric-literals.spec.ts`.
- **Characterization needed first:** a snapshot of each emitter's literal at
  `1.5`, `1.23456789`, and `-0`.
- **Depends on:** none.

### RF-11 — No single "persistable graph" gate; write paths validate inconsistently

- **Category:** persistence and validation (D-2, D-3).
- **Evidence:**
  - `IndexedDBLocalProjectStore.saveProject` and `createProject` (via
    `withPersistenceTimestamp`) run `parseScadletProject` before writing.
  - `ProjectFileService.saveAs` writes `JSON.stringify(project)` without
    validation.
  - The editor admits states that validation rejects: D-2 (binding collision)
    and D-3 (zero Step). `ForHeaderNode` accepts any finite Step; persistence
    rejects a direct zero; codegen (`forToOpenSCAD`) rejects known zero at
    render.
  - `LoopStructureProblem.code` declares `'step'` but `loopStructureProblem`
    never returns it.
- **Affected:** `file-service.ts`, `scadlet-app.ts` `_saveAs`,
  `nodes/for-nodes.ts`, `for-validation.ts`, `validate.ts`.
- **Why it matters:** the [Persistence](agent-guides/persistence.md) guide
  requires that ordinary editing never manufactures the "changes may be lost"
  failure and that invalid data never becomes a project.
- **Failure modes:** persistent autosave error after one keystroke; a Save As
  file that cannot be reopened.
- **Recommended direction:**
  - Validate before file save and surface the validator message.
  - Decide zero-Step policy explicitly: either refuse it live like the
    existing NaN guard (`commitNumberLiteralOnInput`), or accept it as a
    persisted draft and error only at render. Then align the validator, For
    guard, and codegen.
  - Fix D-2 via RF-03.
  - Remove or implement the unused `'step'` code.
- **Keep unchanged:** validation before touching the live editor on load; old
  versions still load.
- **Risk / Benefit / Scope:** Medium / High / Small.
- **Currently protected by:** `for-loops.test.ts` (zero-step rejection),
  `file-service.test.ts`, `local-project-store.test.ts`, E2E
  `numeric-literals.spec.ts`.
- **Characterization needed first:** a unit test that `serializeProject` of
  any editor state reachable through the public `SCADletEditor` API passes
  `parseScadletProject` (start with D-2 and D-3 as fix tests).
- **Depends on:** RF-03 and a product decision for zero Step.
- **Status:** fixed for D-2 and D-3 (section 9). Zero Step is refused live;
  explicit Save and Save As validate before writing. Still open: the unused
  `'step'` problem code, and a hand-edited project whose connected Step keeps a
  zero fallback still becomes unsaveable when that wire is removed.

### RF-12 — Internal duplication in `validate.ts` and overlap with the evaluator

- **Category:** persistence and validation.
- **Evidence:**
  - `validateDefinitions` validates identity, interface roles, and
    `resultType` twice: once in its reference pre-pass and again in the main
    loop, where the Module and Function branches repeat interface checks.
  - `validateModuleParameters` duplicates `definitions.ts`
    `validateModuleParameters` (same rules, different error type).
  - The Conditional unresolved-type checks appear in both `validateConnection`
    and `validateGraph`.
  - `validateNode`'s explicit Module-Call and interface scope checks overlap
    `FUNCTION_GRAPH_ALLOWED_NODE_TYPES` and `allowedScopes`.
  - `hasVariableBindingCycle` duplicates `evaluateScopeVariables`'
    dependency and cycle logic.
  - The current validator is named `validateV1` and returns `ScadletProjectV1`,
    an alias of V8.
- **Affected:** `validate.ts`, `definitions.ts`, `evaluate.ts`.
- **Why it matters:** additive features must update several parallel checks;
  error precedence can differ between paths.
- **Failure modes:** a new definition field validated in the pre-pass but not
  in the main pass, or the reverse.
- **Recommended direction:** validate definition headers once and reuse them
  in the graph pass; share a pure binding-dependency analysis (over DTOs) with
  the evaluator; rename `validateV1` internally to `validateCurrent` (keep the
  exported type aliases).
- **Keep unchanged:** every migration function and the sequential chain,
  message texts asserted by tests (`validate.test.ts`,
  `local-persistence.spec.ts`), and the unknown-field discard behaviour.
- **Risk / Benefit / Scope:** Medium / Medium / Medium.
- **Currently protected by:** `validate.test.ts`, `docs-examples.test.ts`,
  `historical-module-parameters.test.ts`, `for-loops.test.ts`,
  `arithmetic-math.test.ts`, `function-definitions.test.ts`
  (persistence).
- **Characterization needed first:** a corpus test that every fixture in
  `docs/examples/`, `src/persistence/fixtures/`, and `examples/` parses to an
  identical canonical result before and after.
- **Depends on:** RF-03 for the binding pieces.

### RF-13 — Restore ignores Rete rejections and runs interactive pipes

- **Category:** persistence / restore.
- **Evidence:**
  - `applyRestorePlan` awaits `editor.addNode` and `editor.addConnection`
    without checking their `boolean` results. Any pipe returning `undefined`
    silently drops the node or wire, and the rollback path never triggers.
  - During restore the editor's interactive pipes still run: the For guard
    rebuilds a scope snapshot per connection, and the Function-result and
    Conditional pipes can, in principle, reach `window.confirm`.
  - Interface nodes are constructed outside the catalog, and restore builds a
    third binding table (`collectBindings`).
- **Affected:** `restore.ts`, `editor.ts` pipes, `scadlet-app.ts`
  `_restoreProject`.
- **Why it matters:** AGENTS.md forbids silently discarding connected values;
  restore is the one path that must be all-or-nothing.
- **Failure modes:** a validation/pipe mismatch (as in RF-03 or RF-09) loads a
  project with missing wires instead of failing and rolling back.
- **Recommended direction:** throw on `false` so rollback runs; let restore
  bypass the confirm-capable transition pipes explicitly (as paste does with
  `graphTransactionSuspended`); keep the compatibility and cycle guards.
- **Keep unchanged:** the prepare-both-plans-before-clearing design and the
  rollback-failure `AggregateError`.
- **Risk / Benefit / Scope:** Medium / Medium / Small.
- **Currently protected by:** `restore.test.ts`, `round-trip.test.ts`,
  `active-project.test.ts`, E2E startup and broken-record tests.
- **Characterization needed first:** a unit test with a pipe that rejects one
  connection, expecting restore to fail and roll back.
- **Depends on:** RF-02 (restore mode).
- **Status:** fixed (sections 9.4 and 9.5). The For guard skips restore
  (D-5). Restore now reports every refused or removed item instead of
  dropping it silently, keeps a backup of the untouched original, and never
  runs the interactive transition pipes. The recommendation above to throw
  and roll back was revised: an unopenable project would cost learners more
  than a reported, repairable gap (section 9.5).

### RF-14 — `ScadletApp` mixes execution orchestration with project lifecycle and untranslated text

- **Category:** module boundaries / UI text.
- **Evidence:**
  - The execution-cancel block is repeated in `_invalidateProjectRender`,
    `_handleSemanticChange`, `_handleInspectEnd`, and `_stop`.
  - The valid-empty and "Nothing to render" handling is repeated in
    `_renderProject` and `_inspect`.
  - "Create local project → apply → publish → refresh" is repeated in
    `_createNewProject`, `_openBuiltinExample`, `_duplicateCurrentProject`,
    and `_open`.
  - 18 user-facing strings bypass `t()`, including
    `window.confirm('Discard changes…')` and "Local saving failed; recent
    changes may be lost.". One E2E test asserts such a literal.
  - A `console.log` of render timing ships in production.
- **Affected:** `scadlet-app.ts`, `i18n/translate.ts`,
  `e2e/local-persistence.spec.ts`.
- **Why it matters:** render cancellation rules
  ([Architecture](agent-guides/architecture.md)) live in private methods that
  are testable only via E2E; the AGENTS.md `t()` rule is violated.
- **Failure modes:** one cancel path forgets `renderController.stop()`; text
  inconsistencies.
- **Recommended direction:** extract a plain-TypeScript render/Inspect
  coordinator next to `LiveRenderScheduler`, with unit tests; add
  `_cancelActiveExecution()`; move all strings to `t()` keys; drop the
  `console.log`.
- **Keep unchanged:** generation and revision guards, cache admission rules,
  Stop semantics, degraded file-only mode.
- **Risk / Benefit / Scope:** Medium / Medium / Medium.
- **Currently protected by:** `render-controller.test.ts`,
  `live-render-scheduler.test.ts`, `preview-cache.test.ts`, E2E
  `preview-cache.spec.ts`, `live-project-switch.spec.ts`,
  `empty-geometry.spec.ts`, `inspect-dismissal.spec.ts`.
- **Characterization needed first:** existing coverage is adequate; add
  unit tests as the coordinator is extracted.
- **Depends on:** none.

### RF-15 — Test organization makes central refactoring riskier than necessary

- **Category:** tests.
- **Evidence:** no DOM-free harness for `createEditor` (section 3); E2E helper
  drift (7, 4, 4, and 2 distinct bodies of shared helpers);
  `local-persistence.spec.ts` mixes about eight domains in 42 tests; 61 casts
  into internal component state; E2E asserts English error text. Positives:
  per-test contexts, a diagnostics fixture, no `test.describe.serial` use, and
  fixed delays only where they assert an absence window.
- **Affected:** `e2e/*.spec.ts`, `e2e/support.ts`.
- **Why it matters:** refactors of RF-01, RF-05, and RF-07 are verified only by
  slow, broad E2E tests, and helper drift makes failures hard to compare.
- **Failure modes:** a helper fix applied to one copy; unrelated failures in
  one oversized spec.
- **Recommended direction:** move shared helpers into `e2e/support.ts`,
  unifying signatures; split `local-persistence.spec.ts` by domain without
  removing assertions; after RF-07, unit-test the extracted DOM-free services.
  Do not add jsdom or happy-dom without a dependency decision.
- **Keep unchanged:** every behavioural assertion, per-test isolation, and the
  production-build E2E target.
- **Risk / Benefit / Scope:** Low / Medium / Medium.
- **Currently protected by:** the suite itself (test count before and after
  must match).
- **Characterization needed first:** record the per-spec test titles before
  moving them.
- **Depends on:** none (the harness part depends on RF-07).

### RF-16 — Implicit registry lookup fails open

- **Category:** dependency direction / hidden state.
- **Evidence:** `bindDefinitionRegistry` stores the registry in a module-level
  `WeakMap`. `shareDefinitionScope` returns `true` and `definitionScopeOf`
  returns `null` when no registry is bound. `canConnectSocketData` and
  `wouldCreateNodeDataflowCycle` rely on that lookup.
- **Affected:** `definitions.ts`, `connection-compatibility.ts`, tests using
  bare `NodeEditor`.
- **Why it matters:** [Delivery and quality](agent-guides/delivery-quality.md)
  discourages hidden global state; a host that forgets to bind silently
  permits cross-scope wires.
- **Failure modes:** a future host or test path that creates cross-scope
  connections without error.
- **Recommended direction:** pass a `scopeOf` resolver explicitly (the editor
  already has it), or fail closed when unbound in the editor.
- **Keep unchanged:** Main-only hosts continue to work, with an explicit
  `() => null` resolver.
- **Risk / Benefit / Scope:** Low / Low / Small.
- **Currently protected by:** `socket-compatibility.test.ts`,
  `dataflow-cycle.test.ts`, `definitions.test.ts`.
- **Characterization needed first:** none.
- **Depends on:** none.

### RF-17 — Value-type and Geometry identity are scattered (2D/3D readiness)

- **Category:** type and port handling / roadmap preparation.
- **Evidence:**
  - The value-type union is declared separately as `ModuleParameterType`,
    `FunctionResultType` (alias), `ConditionalValueType`, and
    `VariableBindingResolution.type`, with about 24 inline literal lists.
  - `SocketType` is a closed string union compared by equality.
  - "Is a Geometry node" is decided by the port key `outputs.geometry` in
    `evaluate.ts` (Main roots, Inspect) and `editor.ts` (`isGeometryNode`,
    `isBodylessForResultRoot`), but by socket type in
    `geometry-accent.ts` `hasGeometryOutput`. [Node style](agent-guides/node-style.md)
    requires socket identity.
  - `render.ts` `updateSnapTarget` has its own socket-type allow-list.
  - `for-validation.ts` detects Geometry producers through catalog
    `outputSocketType`.
- **Affected:** `sockets.ts`, `definitions.ts`, `value-nodes.ts`,
  `evaluate.ts`, `editor.ts`, `render.ts`, `validate.ts`.
- **Why it matters:** future `Geometry2D`/`Geometry3D` (roadmap item 3) will
  need every key-based check to become type-based, and every list edited. A
  single equality check cannot express "any Geometry".
- **Failure modes:** a 2D node misclassified as a root or as not inspectable;
  a list missed.
- **Recommended direction (preparation only):** one exported `VALUE_TYPES`
  constant and type guard; one `producesGeometry(node)` helper based on socket
  type, used everywhere. Do not design 2D typing here.
- **Keep unchanged:** socket names and persisted type IDs.
- **Risk / Benefit / Scope:** Low / Medium / Small.
- **Currently protected by:** `geometry-accent.test.ts`, `sockets` and
  compatibility tests, `evaluate.test.ts`, `inspect.test.ts`.
- **Characterization needed first:** a unit test that Module Inputs (Geometry
  output under a `geometry:<id>` key) is classified identically by all
  helpers, recording the current difference first.
- **Depends on:** none.

### RF-18 — Dead, obsolete, and stale items

- **Category:** cleanup. Each item was checked for indirect use through the
  catalog, restore, E2E, and fixtures.
- **Evidence:**
  - `SCADletEditor.removeInputSafely`, `removeOutputSafely`, and
    `getInspectParticipatingNodeIds` have no caller. The `port-lifecycle.ts`
    functions themselves are used by tests.
  - `src/assets/hero.png`, `vite.svg`, `lit.svg`, and `public/icons.svg` are
    unreferenced since the initial template commit (`public/` ships in
    `dist`).
  - `LoopStructureProblem` `'step'` is never produced.
  - The `ModuleCallNode(string, string)` constructor overload is used only by
    tests.
  - `SphereNode` chooses different defaults depending on whether a `notify`
    callback is passed.
  - 31 comments cite obsolete milestones, phases, or `AGENTS.md section N`.
    Stale doc comments: `createEditor` ("code generation … added in a later
    step"), `evaluateOpenSCAD` ("no transformation/CSG nodes yet"),
    `SCADletEditor.addModuleCallAt` ("Main only … Phase 2").
  - Parameter and Geometry-input reorder (`ModuleParameterEditControl.onMove`,
    `ModuleGeometryInputEditControl.onMove`, `move` in `edit*Parameter`) is
    wired but no UI or test invokes it, while
    [Definitions](agent-guides/definitions.md) still describes reorder. This
    needs a product decision, not deletion.
- **Keep unchanged:** migrations, historical fixtures, legacy port acceptance,
  exported persistence aliases.
- **Risk / Benefit / Scope:** Low / Low / Small.
- **Currently protected by:** `tsc`, the full suites.
- **Characterization needed first:** none; verify with a search before each
  removal.
- **Depends on:** none.

## 5. Things that should not be refactored now

- **Migration chain and legacy acceptance** (`migrateV1ToV2` … `migrateV7ToV8`,
  explicit nested composition, bare `a`/`b` Union ports,
  `defaultModuleGeometryInput` deterministic IDs, `ScadletProjectV1` and
  `ScadletProjectV7` aliases). These are compatibility contracts in
  [scadlet-format.md](scadlet-format.md).
- **The custom DOM renderer** (`render.ts`), including the socket
  `render`/`rendered`/`unmount` emissions, SVG bounding-box padding, and
  per-render `replaceChildren`. It replaces the incompatible
  `rete-lit-plugin` by contract.
- **Gesture timing workarounds:**
  - `commitSnappedConnection` defers its insert with `setTimeout` to avoid
    racing Rete's pseudo-flow;
  - capture-phase `pointerup` on `window`;
  - keyboard-synthesized `PointerEvent`s for sockets;
  - `connectiondrop` snap retention;
  - `ClicklessZoom`, `container.style.overflow = 'clip'`, and
    `isolateControlGestures`.
- **Async `connectioncreate` pipes** for Function Output and Conditional
  branches, and the multi-connectable branch inputs. They exist so that a
  cancelled replacement never lets Rete add the wire. RF-06 may restructure
  their bodies, not their position.
- **`guardPortRemoval` and `wireDirtyNotifications` monkey-patching.** They are
  idempotent, WeakSet-guarded, and are the single enforcement points for
  orphan-free ports and control-level dirty tracking.
- **Restore's prepare-then-apply design** with a rollback plan built before
  clearing, and validation strictly before touching the editor.
- **Render pipeline:** a fresh OpenSCAD instance per render, worker
  termination on Stop, `ExecutionGeneration`, the narrow
  `empty-top-level.ts` classification, and the cache admission rules.
- **Transient popup registry** with one provider per surface and
  `composedPath` dismissal across shadow roots.
- **Touch long press and keyboard context-menu access.** The deliberate
  touch hold and Shift+F10 / Context Menu key handling are required by
  [Editor and UX](agent-guides/editor-ux.md); the 550 ms hold and 800 ms
  synthetic-event suppression constants are tuned behaviour that E2E depends
  on.
- **E2E fixed delays** that assert *absence* within a window (Live debounce,
  long press, no extra evaluation). The delivery guide explicitly permits
  them.
- **Large but cohesive files:** `node-editor.ts` (CSS), `node-catalog.ts`
  (registration table), `value-nodes.ts`.
- **No new AST or IR.** Codegen problems found here are literal formatting
  (RF-10) and traversal duplication (RF-04), not structural limits of
  Rete-dataflow string emission. AGENTS.md also forbids a parallel graph.

## 6. Recommended refactoring sequence

Every package: behaviour-preserving unless marked **(behaviour fix)**, one
concern only, and it must pass `pnpm test`, `pnpm exec tsc --noEmit`,
`pnpm build`, `pnpm test:e2e`, and `git diff --check` before the next starts.
Known defects get their own packages whose tests assert the documented
contract. Characterization tests pin current behaviour everywhere else.

**Group 1 — Safe preparatory cleanup**

| WP | Boundary | Findings | Files / responsibilities | Prerequisite tests | Extra verification |
| --- | --- | --- | --- | --- | --- |
| 1 | **Done** (section 9.6): extract the live scope snapshot helper (upstream-closure helper optional) | RF-04 | new `editor/scope-snapshot.ts`; `editor.ts`, `evaluate.ts` call sites | Section 7 | Unit and E2E For, clipboard, variables |
| 2 | Consolidate E2E helpers into `e2e/support.ts` | RF-15 | `e2e/*.spec.ts` | Record test titles and count (109) | Same titles and count after |
| 3 | Remove verified-dead facade members and template assets; refresh stale comments | RF-18 | `editor.ts`, `src/assets/*`, `public/icons.svg`, comments | Search proof per item | `pnpm build` output lists no removed asset |
| 4 | Catalog/node port parity tests (tests only) | RF-09 | new unit tests | — | — |

**Group 2 — Centralize duplicated policies**

| WP | Boundary | Findings | Files | Prerequisite tests | Extra verification |
| --- | --- | --- | --- | --- | --- |
| 5 | **Done** (section 9): clear Inspect on committed deletion | RF-02 | `editor.ts` `noderemoved` pipe | New D-1 E2E; failed-switch Inspect E2E | `inspect-dismissal.spec.ts` |
| 6 | Single scope binding authority (D-2 already fixed, section 9) | RF-03 | `scope-bindings.ts`, `bindings.ts`, `scope-transfer.ts`, `validate.ts`, `restore.ts`, `editor.ts` | Binding verdict matrix (RF-03) | Fixture corpus parses identically |
| 7 | **Done** (section 9): validate before file save; refuse zero Step live | RF-11 | `file-service.ts`, `for-nodes.ts`, `for-validation.ts`, `validate.ts` | D-3 unit and E2E | `file-service.test.ts` |
| 8 | **(optional, low priority)** Route all emitters through `formatNumber` | RF-10 | `openscad/format.ts`, emitters | Literal snapshot (RF-10) | Real OpenSCAD-WASM render E2E |
| 9 | Value-type constants and `producesGeometry` helper | RF-17 | `sockets.ts`, `definitions.ts`, `evaluate.ts`, `editor.ts`, `render.ts` | RF-17 classification test | — |
| 10 | Catalog entry factories, derived predicates, context spread | RF-09 | `node-catalog.ts`, `graph-clipboard.ts` | WP 4 parity test | `round-trip.test.ts` |
| 11 | `validate.ts` internal consolidation | RF-12 | `validate.ts` | Fixture corpus test | `docs-examples.test.ts` |

**Group 3 — Module extraction and responsibility separation**

| WP | Boundary | Findings | Files | Prerequisite tests | Extra verification |
| --- | --- | --- | --- | --- | --- |
| 12 | **Done** with WP 5 (section 9): separate restore mode from notification suppression; save and restore the previous value | RF-02 | `editor.ts`, `scadlet-app.ts` | WP 5 tests | `live-project-switch.spec.ts` |
| 13 | `runGraphTransaction` helper; migrate one operation family per PR | RF-01 | `editor.ts` | Single-notification and cancel-identity E2E | Full E2E per family |
| 14 | Restore checks Rete results and bypasses confirm-capable pipes | RF-13 | `restore.ts`, `editor.ts` | Rejecting-pipe unit test | Broken-record E2E |
| 15 | Unified Module/Function signature service and shared Call parameter helper | RF-05 | `editor.ts`, Call/interface nodes, `scadlet-app.ts` dialogs | Function parameter E2E | Recursive definitions E2E |
| 16 | Renderer callbacks object, bindings-owned reference eligibility, endpoint-only connected-input sync | RF-08 | `render.ts`, `bindings.ts`, `editor.ts` | Reference-eligibility unit test | UI-consistency E2E |
| 17 | App render/Inspect coordinator; `t()` strings | RF-14 | `scadlet-app.ts`, new `render/…coordinator.ts`, `translate.ts` | Existing render E2E | Update the one literal E2E assertion to the same text via its key |
| 18 | Explicit scope resolver for compatibility | RF-16 | `definitions.ts`, `connection-compatibility.ts` | — | Compatibility unit tests |

**Group 4 — Higher-risk architectural changes**

| WP | Boundary | Findings | Files | Prerequisite tests | Extra verification |
| --- | --- | --- | --- | --- | --- |
| 19 | Shared type-transition planner and apply for Function result and Conditional | RF-06 | `editor.ts`, `connection-compatibility.ts` | Conditional and Function cancel E2E | Nested-transition E2E |
| 20 | Extract clipboard, context menu and long press, reference placement, scope drag, and definitions from `createEditor`, one unit per PR | RF-07 | `editor.ts` → new modules | Pipe-order test; destroy/recreate E2E | Full E2E per extraction |
| 21 | DOM-free unit tests for extracted services; split `local-persistence.spec.ts` by domain | RF-15 | tests only | Title list from WP 2 | Same test count |

**Group 5 — Optional, not currently justified:** a new AST or IR; a
command/undo framework; a generic signature DSL (rejected by
[Editor and UX](agent-guides/editor-ux.md)); moving `src/editor/` into
semantic/presentation folders; replacing the explicit migration chain with a
loop; bundle code-splitting to silence the 500 kB build warning (a
performance topic, not an architectural one); replacing `window.confirm` with
modal dialogs (a UX decision).

## 7. Suggested first task

**Extract a shared live scope snapshot helper (RF-04, WP 1).**

**Exact scope:**

1. Add `src/editor/scope-snapshot.ts` exporting
   `liveScopeSnapshot(editor, definitions, scope, parameterOverrides?)`. It
   returns `{ nodes: LoopGraphNode[]; connections: LoopGraphConnection[] }`:
   - every node with `definitions.scopeOf(id) === scope` (scope `null` is
     Main) that `identifyNodeType` recognizes, with `parameters` from the
     catalog entry's `serializeParams`;
   - `parameterOverrides`, a `ReadonlyMap<nodeId, Partial<parameters>>` merged
     into the matching node's parameters (needed by `renameValueBinding`);
   - every connection whose endpoints are both in that node set, with
     `sourceOutput`/`targetInput` coerced by `String()`.
2. Replace the four inline builders with the helper:
   - the `connectioncreate` For-guard pipe in `createEditor` (then append the
     prospective edge exactly as today);
   - the ForHeader branch of `renameValueBinding`;
   - the `currentNodes`/`currentConnections` construction in
     `preflightClipboardPaste`;
   - `assertValidForLoops` in `evaluate.ts`.
3. Optionally, in the same package, add
   `upstreamNodeIds(connections, rootIds)` and use it only in
   `inspectParticipatingNodeIds` and `isBodylessForResultRoot`, which are
   textually identical traversals. Leave the other traversals for later.

**Explicit non-goals:** no change to any `enclosingNames` or
`bindingNamesInScope` computation (RF-03); no fix for D-2 or D-3; no change to
`loopStructureProblem`, `validate.ts`, restore, messages, or pipe order; no
new facade members; no persistence change.

**Expected affected areas:** `src/editor/scope-snapshot.ts` (new),
`src/editor/editor.ts`, `src/editor/evaluate.ts`, plus a new
`src/editor/scope-snapshot.test.ts`. The dependency direction stays the same:
the new module imports only `node-catalog`, `definitions` types, `schemes`,
and `for-validation` types.

**Behavioural invariants:**

- For each call site, `loopStructureProblem` receives node, parameter, and
  edge sets identical to today's, in the same order (the Rete insertion
  order).
- Cross-scope edges stay excluded.
- Unrecognized nodes stay skipped.
- The prospective edge stays last in the For pipe.
- Generated source and all user feedback stay unchanged.

**Characterization tests (add before refactoring, green on current code):**

- *Unit (`scope-snapshot.test.ts`, DOM-free):* build a `NodeEditor` with a
  `DefinitionRegistry` containing Main plus one Module. Include a For pair, a
  bound Number, a reference, and one cross-scope-looking edge. Assert
  snapshot nodes, parameters, and edges per scope, and that overrides apply to
  one node only. Before switching call sites, assert equality with the current
  inline construction (copied into the test once).
- *Unit:* the existing `persistence/for-loops.test.ts` and
  `editor/variables.test.ts` still pass unmodified; they exercise
  `assertValidForLoops` through `evaluateOpenSCAD`.
- *E2E (new, in `e2e/for-loops.spec.ts`), neither covered today:*
  1. Wiring the iterator `value` output into a Geometry chain that does not
     enter the matching For result is refused, with the localized
     `for.iteratorEscape` feedback and an unchanged connection count.
  2. Renaming a For iterator to an existing Value name is refused with
     `variable.duplicateName`.
- *E2E (existing, keep as regression guards):* the For pair paste in
  `graph-clipboard.spec.ts` and the joint duplication test in
  `for-loops.spec.ts` cover the `preflightClipboardPaste` call site.

**Completion criteria:** the four inline builders are removed and each call
site uses the helper; all new and existing tests pass. Existing tests stay
as they are unless a change genuinely makes sense (a test that only
restates old internals, for example); a failing test otherwise signals an
unintended behaviour change; `pnpm test`,
`pnpm exec tsc --noEmit`, `pnpm build`, `pnpm test:e2e`, and
`git diff --check` all succeed; the diff touches only the files listed; the
report states that no documented contract changed.

## 8. Baseline verification

**Environment:** macOS 26 (Darwin 25.6.0, arm64). `nix develop` devShell with
Node v24.19.0 and pnpm 11.25.0; Vitest 4.1.11, Vite 8.2.2. Playwright used its
installed Chromium (`ms-playwright/chromium-1234`) because the devShell
provides no Chromium on macOS; `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` was
unset.

**Working tree:** clean at commit `c52d83f` (`git status --short` was empty
before the audit). Dependencies were installed with
`pnpm install --frozen-lockfile` (exit 0). The required checks regenerated the
git-ignored `dist/` and `test-results/` directories only.

| Check | Result |
| --- | --- |
| `pnpm test` | Pass. 78 files, 693 tests passed (1.02 s) |
| `pnpm exec tsc --noEmit` | Pass. Exit 0, no diagnostics |
| `pnpm build` | Pass. Exit 0. Warning: chunks >500 kB (`index-*.js` 1,077.56 kB, gzip 264.33 kB; `render-worker-*.js` 10,973.24 kB) |
| `pnpm test:e2e` | Pass. 109 passed in 37.0 s (50% workers). No retries, flaky, or skipped tests |
| `git diff --check` | Pass. Exit 0, no output |

**Baseline classification:** no failing checks; no flakes observed in one
full run. D-1 to D-3 in section 1 are reproducible baseline defects that the
existing suites do not cover (D-4 was later reclassified, section 9.3). They
were confirmed with temporary Vitest and Playwright specs kept outside the
repository (served from the built `dist` on a separate port) and are not part
of this change.

**Confidence limits:** a single E2E run cannot prove the absence of flakes.
Performance remarks (per-connection scope snapshots, O(N·E) presentation sync)
are from code reading, not measurement.

## 9. Post-audit changes

### 9.1 Save-breaking names and zero Step (D-2, D-3)

A focused behaviour fix for D-2 and D-3 (RF-03 naming gap, RF-11 write gate),
made after the audit on 2026-09-29. It is not part of the refactoring
sequence. The aim was only that the editor never creates, and file saving
never writes, a project the loader refuses.

**Decisions taken:**

- A literal zero For Step is refused live, not saved as a draft. This keeps the
  format specification unchanged: a direct zero Step was already invalid.
- A Value or definition parameter may not take the name of a For iterator in
  the same scope. This was already the loader's rule
  (`validateScopeBindings`); the editor now applies it too.

**Changes:**

| Area | Change |
| --- | --- |
| [bindings.ts](../src/editor/bindings.ts) | New `reservedBindingNamesInScope`: the Value and parameter names of a scope plus its For iterator names |
| [editor.ts](../src/editor/editor.ts) | Value rename (`renameValueBinding`), paste copy naming (`preflightClipboardPaste`), and Module/Function parameter add/edit use the new helper. Iterator rename and the `loopStructureProblem` enclosing names are unchanged, since sibling loops may share a name |
| `controls.ts`, `nodes/for-nodes.ts` | `LabeledNumberControl` accepts an optional `rejectionFor` rule and never stores a rejected value; the For Step control rejects `0` |
| [render.ts](../src/editor/render.ts), `node-editor.ts` | `commitNumberLiteralOnInput` shows a refused literal as invalid (`setCustomValidity`, `aria-invalid`, localized title, red outline) and restores the stored value when the edit ends |
| `file-service.ts`, `scadlet-app.ts`, `translate.ts` | `ProjectFileService.save`/`saveAs` validate with `parseScadletProject` before any picker, download, or write; the app reports "This project was not saved because it is invalid: …" |
| [Definitions](agent-guides/definitions.md), [Persistence](agent-guides/persistence.md) | Document the iterator-name rule, the Step field behaviour, and validated file saves |

**Tests added:**

- `src/editor/bindings.test.ts`: the helper's contents per scope, and that
  every reserved name fails `parseScadletProject` while a free name saves.
- `for-nodes.test.ts`: Step refuses zero and keeps the previous value; Start
  and End accept zero.
- `file-service.test.ts`: `saveAs`, handle `save`, and the download fallback
  write nothing for an invalid project.
- `e2e/for-loops.spec.ts` "names and Step literals the saved format refuses
  are rejected before autosave":
  - a Value pasted after a For iterator `i` becomes `i_copy`;
  - renaming it to `i` is refused with feedback;
  - Step `0` is marked invalid, restored to `1`, and never autosaved;
  - reload shows the saved state.

  Run against the audited code, this test fails at the paste step. That
  confirms the paste variant of D-2, previously only suspected.

**Verification** (same environment as section 8):

| Check | Result |
| --- | --- |
| `pnpm test` | Pass. 79 files, 698 tests passed |
| `pnpm exec tsc --noEmit` | Pass. Exit 0 |
| `pnpm build` | Pass. Exit 0, same chunk-size warning as the baseline |
| `pnpm test:e2e` | Pass. 110 passed in 35.1 s |
| `git diff --check` | Pass. Exit 0 |

**Remaining related gaps:**

- The parameter-naming path is covered through the shared helper's unit test,
  not by its own E2E test.
- From code reading: dropping a For into a scope that already has a Value
  named `i` is refused with "For nodes must remain a complete pair in one
  scope.", because the default iterator name is not made unique. It is safe
  but confusing.
- The zero-fallback edge case and the unused `'step'` problem code (RF-11)
  are still open.
- D-1 is fixed in 9.2. D-4 is reclassified in 9.3.

### 9.2 Stale Inspect after deleting the inspected node (D-1)

A focused behaviour fix for RF-02, made on 2026-09-29 after 9.1. It brings the
editor in line with [Editor and UX](agent-guides/editor-ux.md) ("deletion of
the inspected node clears it"), so no guide changed.

**Cause:** the `noderemoved` pipe skipped `inspect.remove` whenever
`dirtySuspended` was set. That flag also groups every editor transaction's
notifications, including ordinary deletion in `removeNodeAndReferences`.

**Changes, all in [editor.ts](../src/editor/editor.ts):**

- New closure flag `restoringProject`, set only by
  `withDirtyTrackingSuspended`, which is used solely by project restore
  (`ScadletApp._restoreProject`).
- The `noderemoved` pipe keeps Inspect provenance only while
  `restoringProject` is set; every other removal clears it.
- `withDirtyTrackingSuspended` now saves and restores both flags' previous
  values instead of forcing `dirtySuspended = false`.

No new Inspect-end notification was added. Deletion is already a semantic
change, which cancels any running Inspect execution and reschedules the Live
preview.

**Tests added:**

- `e2e/inspect-dismissal.spec.ts` "deleting the inspected node ends Inspect
  and removes out-of-scope dimming": keyboard Delete and More → Delete of the
  inspected root. Afterwards `getInspectedNodeId()` is `null`, no node is
  dimmed, and Live renders the remaining graph. It failed on the previous code
  (the deleted ID was still inspected).
- `e2e/live-project-switch.spec.ts` "a project switch that fails and rolls
  back keeps the previous Inspect result": injects an `addNode` failure during
  restore. The previous project and its Inspect marker survive the rollback.
  This passed before and after the change, guarding the restore behaviour the
  old flag protected.

**Verification** (same environment as section 8):

| Check | Result |
| --- | --- |
| `pnpm test` | Pass. 79 files, 698 tests passed |
| `pnpm exec tsc --noEmit` | Pass. Exit 0 |
| `pnpm build` | Pass. Exit 0, same chunk-size warning as the baseline |
| `pnpm test:e2e` | Pass. 112 passed |
| `git diff --check` | Pass. Exit 0 |

**Remaining related gaps:**

- From code reading: definition and parameter deletion now also clear Inspect
  when they remove the inspected node. They share the corrected pipe but have
  no dedicated test.
- A transaction that deletes the inspected node and then rolls back after an
  unexpected Rete failure also ends Inspect. That is acceptable, but an
  explicit transaction helper (RF-01) should decide it deliberately.

### 9.3 Reclassification of D-4

On review, the audit had overstated D-4:

- The rounding affects only digits beyond six decimals, which is below any
  practical model resolution.
- The zero case needs an input no learner would enter.
- The 6-decimal, exponent-free format is an intentional readability choice.
- The cited Architecture rule concerns detail settings such as `$fn`.

D-4 is therefore no longer a defect. RF-10 is rated Low / Low / Small and
kept as an optional consistency cleanup (WP 8). No code changed; the
audit's own count stands at three confirmed defects, all fixed. D-5 was
found later (section 9.4).

### 9.4 Nested iterator name reuse, and restore of multi-loop scopes (D-5)

A product-rule change requested after checking real OpenSCAD behaviour, made on
2026-09-29. Running the bundled OpenSCAD-WASM confirmed:

- nested `for (i …) { for (i …) … }` runs without warnings, and the inner `i`
  hides the outer one;
- an inner range such as `[0 : 1 : i]` reads the outer `i`;
- the outer `i` is intact after the inner loop;
- the result renders to STL.

**New rule:** a nested iterator may reuse an enclosing iterator's name unless
the nested body also uses the enclosing iterator (by wire or Variable
reference). The nested body is everything entering the nested result's
Geometry slots, including deeper loop ranges but not the nested header's own
Start/Step/End. That single exception exists because generated source
refers to bindings by name, so such a use would silently read the inner
iterator. Siblings may still share names; iterators still may not share a
Value's or parameter's name. The documented contract changed in
[Definitions](agent-guides/definitions.md) and
[scadlet-format.md](scadlet-format.md). This is an additive v8 relaxation:
every previously valid file keeps its meaning, and no version bump is needed.

**Changes:**

| Area | Change |
| --- | --- |
| [for-validation.ts](../src/editor/for-validation.ts) | `loopStructureProblem` reports the new `shadow` code only when the enclosing iterator is used in the nested body; `name` now means only a collision with a Value or parameter. New `loopProblemFeedback` returns a specific localized message per problem |
| [editor.ts](../src/editor/editor.ts), [evaluate.ts](../src/editor/evaluate.ts) | Wire refusals, iterator rename, paste preflight, and source generation use `loopProblemFeedback` instead of the misleading "For nodes must remain a complete pair in one scope." for every non-escape problem |
| [editor.ts](../src/editor/editor.ts) | **D-5 fix:** the live For guard skips `connectioncreate` while `restoringProject` is set. Restore adds wires one at a time, so the guard saw partly restored scopes as broken pairs; the whole project was already validated by the same rules |
| `translate.ts` | New keys `for.shadowedIteratorUsed`, `for.iteratorNameCollision` |

The single shared checker means the live editor, rename, paste, source
generation, and file validation changed together.

**Tests:**

- New `src/editor/for-validation.test.ts`:
  - sibling reuse;
  - nested reuse with the outer iterator only in the inner range;
  - refusal when the outer iterator reaches the inner body by wire or by
    Variable reference;
  - a three-level case where the outer iterator in a deeper loop's range is
    refused, while in the nested loop's own range it is allowed;
  - the Value-collision code and all feedback messages.
- `src/persistence/for-loops.test.ts`: the former "no shadowing" assertion now
  asserts that the same file is valid and generates `for (i = …) { for (i =
  [0 : 1 : i]) … }`, plus rejection of the ambiguous variant.
- `e2e/for-loops.spec.ts` "nested loops may reuse an iterator name unless the
  inner body also uses the outer iterator" covers:
  - building nested `i`/`i` loops in the browser;
  - the exact generated source, a real OpenSCAD-WASM mesh, and a clean
    autosave;
  - the refused ambiguous wire with its message;
  - a reload that keeps all 7 wires (the D-5 regression; on the previous code
    every wire disappeared).

**Verification** (same environment as section 8):

| Check | Result |
| --- | --- |
| `pnpm test` | Pass. 80 files, 705 tests passed |
| `pnpm exec tsc --noEmit` | Pass. Exit 0 |
| `pnpm build` | Pass. Exit 0, same chunk-size warning as the baseline |
| `pnpm test:e2e` | Pass. 113 passed in 35.5 s |
| `git diff --check` | Pass. Exit 0 |

**Remaining related gaps:**

- The default name of every new For is still `i`. With this rule a nested `i`
  now works unless the outer `i` is also used inside, which is when the
  specific message appears.
- Iterator/Value name collisions keep the stricter rule. OpenSCAD would also
  allow them under the same condition.
- Restore still ignored `addNode`/`addConnection` results (RF-13); fixed in
  9.5.

### 9.5 No silent loss when restore is refused (RF-13)

Made on 2026-09-30. The audit's original recommendation was to throw when the
editor refuses a restored node or wire, so that the existing rollback runs.
It was revised before implementation. A pupil cannot open or export a local
record that fails to load, so a refusal caused by a bug (as D-5 was) would
make the whole project unreachable, which is worse than a few missing wires.
The actual problems were that the loss was silent and that the next autosave
overwrote the intact stored original.

**Behaviour now:**

- **Best-effort load.** Everything the editor accepts is restored. Every
  planned node or connection missing afterwards is reported, whether it was
  refused or removed again by a later editor step. A refused node's wires are
  reported with it. Thrown errors still roll back as before.
- **Backup of the original.** For a local record, the untouched stored
  version is saved as a new local project `<name> (backup)` (numbered when
  taken) before this project can be autosaved; the previous project's
  autosave controller is stopped during that write. If the backup cannot be
  written, the graph stays open without an autosave target, and the warning
  says to use Save As. An opened file is its own original.
- **Persistent warning.** A dismissible `role="alert"` notice, independent of
  autosave status, names up to five missing items with node and port labels
  (for example "Cube (Geometry) → Translate (Geometry)") and where the
  original was kept.
- **No interactive pipes during restore.** The Function-result and
  Conditional-branch pipes, which can confirm, remove wires, or retype
  sockets, now skip restore like the For guard. Restored nodes are built with
  their validated saved types.

**Changes:**

| Area | Change |
| --- | --- |
| [restore.ts](../src/persistence/restore.ts) | `restoreProject` returns a `RestoreReport` (`RestoreIssue` per missing node/connection, with a readable description); missing endpoints no longer throw, and positions are applied only to restored nodes |
| [editor.ts](../src/editor/editor.ts) | The Function-result and Conditional-branch `connectioncreate` pipes return early while `restoringProject` is set |
| [scadlet-app.ts](../src/scadlet-app.ts) | `_restoreProject` returns the report. `_applyStoredProject` creates the backup (`_backupOriginalProject`) or falls back to no autosave, then sets `restoreWarning` (`_restoreWarningText`). File opens report "The opened file itself is unchanged." |
| `translate.ts` | `restore.*` messages and the Dismiss label |
| [Persistence](agent-guides/persistence.md) | Documents the partial-restore contract |

**Tests:**

- `restore.test.ts`, 4 new cases:
  - a refused connection: everything else is restored and positioned, and the
    exact readable description is reported;
  - a refused node reported together with its wire;
  - a wire removed by a later editor step;
  - an empty report for a clean restore.
- `live-project-switch.spec.ts` "a project whose wire the editor refuses
  still opens, names what is missing, and keeps a backup of the original":
  - the project opens with both nodes and no wire;
  - the `role="alert"` warning text names the missing wire and the backup;
  - the warning survives an edit and a successful autosave until dismissed;
  - "Wired (backup)" opens with the original wire intact.

**Verification** (same environment as section 8):

| Check | Result |
| --- | --- |
| `pnpm test` | Pass. 80 files, 709 tests passed |
| `pnpm exec tsc --noEmit` | Pass. Exit 0 |
| `pnpm build` | Pass. Exit 0, same chunk-size warning as the baseline |
| `pnpm test:e2e` | Pass. 114 passed in 35.7 s |
| `git diff --check` | Pass. Exit 0 |

**Remaining related gaps:**

- The warning lists node and port labels, not positions. A pupil with several
  nodes of the same type must still find the right one.
- The backup-failure path (no autosave, Save As advice) is covered by code
  review only, not by a test.
- A refused structural wire, such as a For loop boundary, leaves a graph that
  cannot be saved until repaired. The warning and the backup cover it, but no
  specific repair hint is shown.

### 9.6 Shared live scope snapshot (RF-04, WP 1)

A behaviour-preserving refactoring made on 2026-09-30, following section 7.

**Changes:**

| Area | Change |
| --- | --- |
| New [scope-snapshot.ts](../src/editor/scope-snapshot.ts) | `liveScopeSnapshot(editor, definitions, scope, parameterOverrides?)` returns one scope's nodes (with catalog-serialized parameters, editor order, unknown nodes skipped) and its internal connections (ports as strings); `upstreamNodeIds(connections, roots)` returns roots plus their dependencies |
| [editor.ts](../src/editor/editor.ts) | The For guard pipe, the iterator branch of `renameValueBinding` (with the proposed name as an override), and `preflightClipboardPaste` use `liveScopeSnapshot`; `inspectParticipatingNodeIds` and `isBodylessForResultRoot` use `upstreamNodeIds` |
| [evaluate.ts](../src/editor/evaluate.ts) | `assertValidForLoops` uses `liveScopeSnapshot` |

Every call site's enclosing-name set, the prospective edge in the For guard,
and all messages and pipe order are unchanged.

**Tests:**

- The characterization E2E test was added before refactoring and passed 5 of
  5 runs on the old code. In `e2e/for-loops.spec.ts`, "the live For guard
  refuses an escaping iterator wire and an iterator renamed like a Value"
  covers both previously untested guard paths.
- New `src/editor/scope-snapshot.test.ts`:
  - per-scope contents and order, with cross-scope wires excluded;
  - equality with a copy of the former inline construction for Main, a
    Module, a rename override, and a registry-less host;
  - the override affecting only its node;
  - `upstreamNodeIds` behaviour.
- No existing test changed. All 722 existing unit tests and all existing E2E
  tests pass as before.

**Verification** (same environment as section 8):

| Check | Result |
| --- | --- |
| `pnpm test` | Pass. 83 files, 725 tests passed |
| `pnpm exec tsc --noEmit` | Pass. Exit 0 |
| `pnpm build` | Pass. Exit 0, same chunk-size warning as the baseline |
| `pnpm test:e2e` | Pass. 118 passed in 37.9 s |
| `git diff --check` | Pass. Exit 0 |
