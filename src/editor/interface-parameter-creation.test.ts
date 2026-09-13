import { describe, expect, it } from 'vitest'

import { FunctionInputsNode } from './nodes/function-interface-nodes'
import { ModuleInputsNode } from './nodes/module-interface-nodes'

describe('Module and Function Inputs parameter creation', () => {
  it.each([
    ['Module', new ModuleInputsNode()],
    ['Function', new FunctionInputsNode()],
  ] as const)('%s opens a fresh Parameter proposal and delegates its typed default to the existing lifecycle', async (_kind, inputs) => {
    const created: { name: string; type: 'number' | 'boolean' | 'vector3'; default: number | boolean | [number, number, number] }[] = []
    inputs.configureParameterCreation(() => {}, async (parameter) => { created.push(parameter) })

    const action = inputs.controls.addActions.actions().find((item) => item.id === 'add-parameter')
    action?.run?.()
    const control = inputs.controls.addParameter
    expect(control.open).toBe(true)
    expect(control.name).toBe('')
    expect(control.type).toBe('number')
    expect(control.defaultNumber).toBe(0)

    control.name = 'offset'
    control.type = 'vector3'
    control.defaultVector = [2, 4, 6]
    await control.onSubmit({ name: control.name, type: control.type, default: control.defaultVector })
    expect(created).toEqual([{ name: 'offset', type: 'vector3', default: [2, 4, 6] }])

    // Cancel/Escape call `hide()` in the popover and never invoke this
    // lifecycle; opening again starts a distinct, clean proposal.
    control.hide()
    action?.run?.()
    expect(created).toHaveLength(1)
    expect(control.name).toBe('')
    expect(control.type).toBe('number')
    expect(control.defaultVector).toEqual([0, 0, 0])
  })
})
