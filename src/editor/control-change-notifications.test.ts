import { describe, expect, it } from 'vitest'

import { CheckboxControl, LabeledNumberControl, LabeledTextControl, OptionalNumberControl, ParameterActionsControl, TitleSelectControl, Vector3Control, type ParameterAction } from './controls'
import type { ModuleDefinition } from './definitions'
import { NODE_CATALOG, type NodeCreationContext } from './node-catalog'
import type { Schemes } from './schemes'

const moduleDefinition: ModuleDefinition = {
  id: 'shape', kind: 'module', name: 'shape', inputsNodeId: 'shape-in', outputNodeId: 'shape-out',
  parameters: [
    { id: 'size', name: 'size', type: 'number', default: 1 },
    { id: 'flag', name: 'flag', type: 'boolean', default: false },
    { id: 'offset', name: 'offset', type: 'vector3', default: [0, 0, 0] },
  ],
  geometryInputs: [],
}
const functionDefinition: ModuleDefinition = { ...moduleDefinition, id: 'calc', kind: 'function', name: 'calc', inputsNodeId: 'calc-in', outputNodeId: 'calc-out', geometryInputs: undefined, resultType: 'number' }
const createParams: Record<string, Record<string, unknown>> = {
  'module-call': { definitionId: 'shape' },
  'function-call': { definitionId: 'calc' },
  'variable-reference': { bindingId: 'binding' },
}

/** Every leaf Add-menu action, as the ids needed to reach it. */
function actionPaths(actions: readonly ParameterAction[], prefix: string[] = []): string[][] {
  return actions.flatMap((action) => action.children ? actionPaths(action.children, [...prefix, action.id]) : action.run && !action.disabled ? [[...prefix, action.id]] : [])
}

function runAction(node: Schemes['Node'], path: readonly string[]): void {
  let actions = (Object.values(node.controls).find((control) => control instanceof ParameterActionsControl) as ParameterActionsControl | undefined)?.actions() ?? []
  for (const [index, id] of path.entries()) {
    const action = actions.find((item) => item.id === id)!
    if (index === path.length - 1) action.run!()
    else actions = action.children ?? []
  }
}

/** A different valid value for each editable control kind. */
function changeControl(control: unknown): boolean {
  if (control instanceof OptionalNumberControl || control instanceof LabeledNumberControl) { control.setValue((control.value ?? 1) + 1); return true }
  if (control instanceof CheckboxControl) { control.setValue(!control.value); return true }
  if (control instanceof Vector3Control) { control.setValue([control.value[0] + 1, control.value[1], control.value[2]]); return true }
  if (control instanceof LabeledTextControl) { control.setValue(`${control.value ?? ''}x`); return true }
  return false
}

describe('every user-editable node input reports a semantic change', () => {
  it('notifies for each control in every catalog node, operation, and added parameter form', async () => {
    const failures: string[] = []
    const checked = new Set<string>()
    for (const entry of NODE_CATALOG) {
      if (['module-inputs', 'module-output', 'function-inputs', 'function-output'].includes(entry.type)) continue
      let notifications = 0
      const context: NodeCreationContext = {
        onControlsChanged: () => {},
        notifyDirty: () => { notifications += 1 },
        getModuleDefinition: (id) => id === 'shape' ? moduleDefinition : id === 'calc' ? functionDefinition : undefined,
        resolveVariableBinding: () => ({ id: 'binding', name: 'n', type: 'number' }),
      }
      const fresh = () => entry.create(context, createParams[entry.type])
      const variants: { label: string; build: () => Promise<Schemes['Node']> }[] = [{ label: 'initial', build: async () => fresh() }]
      const operation = Object.values(fresh().controls).find((control) => control instanceof TitleSelectControl) as TitleSelectControl | undefined
      for (const option of operation?.options ?? []) {
        variants.push({ label: `operation ${option.value}`, build: async () => {
          const node = fresh()
          await (Object.values(node.controls).find((control) => control instanceof TitleSelectControl) as TitleSelectControl).requestValue(option.value)
          return node
        } })
      }
      const actions = (Object.values(fresh().controls).find((control) => control instanceof ParameterActionsControl) as ParameterActionsControl | undefined)?.actions() ?? []
      for (const path of actionPaths(actions)) {
        variants.push({ label: `add ${path.join(' > ')}`, build: async () => { const node = fresh(); runAction(node, path); return node } })
      }
      for (const variant of variants) {
        const node = await variant.build()
        for (const [key, control] of Object.entries(node.controls)) {
          const before = notifications
          if (!changeControl(control)) continue
          checked.add(`${entry.type}.${key}`)
          if (notifications === before) failures.push(`${entry.type} (${variant.label}): control "${key}"`)
        }
      }
    }
    // Operation selectors without an editor transition commit directly and
    // must report the change themselves (Trigonometry and Vector Math change
    // through the editor's confirmed transition, which notifies instead).
    for (const entry of NODE_CATALOG) {
      let notifications = 0
      const context: NodeCreationContext = { onControlsChanged: () => {}, notifyDirty: () => { notifications += 1 } }
      if (createParams[entry.type] || ['module-inputs', 'module-output', 'function-inputs', 'function-output'].includes(entry.type)) continue
      const node = entry.create(context)
      const select = Object.values(node.controls).find((control) => control instanceof TitleSelectControl) as TitleSelectControl | undefined
      if (!select || select.onRequestChange) continue
      const other = select.options.find((option) => option.value !== select.value)!
      await select.requestValue(other.value)
      checked.add(`${entry.type}.operation`)
      if (notifications === 0) failures.push(`${entry.type}: operation select`)
    }
    expect(failures).toEqual([])
    // Guard against the walk silently covering nothing.
    for (const expected of ['vector-math.factor', 'vector-math.divisor', 'trigonometry.b', 'resize.auto', 'cube.center', 'module-call.parameter:size', 'for.step', 'arithmetic.operation', 'compare.operation', 'min-max.operation']) {
      expect(checked).toContain(expected)
    }
  })
})
