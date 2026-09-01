/**
 * Which Rete/`AreaPlugin` signal types correspond to a persisted-project
 * change, extracted as plain predicates so the "which signals count as
 * dirty" decision is unit-testable without constructing a real
 * `NodeEditor`/`AreaPlugin` (this project's Vitest environment has no
 * DOM). `editor.ts` calls these from its `editor.addPipe`/`area.addPipe`
 * hooks; the actual firing of these signals in response to real user
 * actions is browser-verified.
 */

/** Node/connection add or remove - graph topology, always persisted. */
const DIRTY_EDITOR_SIGNAL_TYPES = new Set(['nodecreated', 'noderemoved', 'connectioncreated', 'connectionremoved'])

/**
 * Node position changes (`nodetranslated`) and canvas pan/zoom
 * (`translated`/`zoomed`) - all three are persisted editor/layout state
 * (`ScadletNodeDTO.position`, `ScadletEditorState.viewport`).
 */
const DIRTY_AREA_SIGNAL_TYPES = new Set(['nodetranslated', 'translated', 'zoomed'])

export function isDirtyEditorSignal(type: string): boolean {
  return DIRTY_EDITOR_SIGNAL_TYPES.has(type)
}

export function isDirtyAreaSignal(type: string): boolean {
  return DIRTY_AREA_SIGNAL_TYPES.has(type)
}
