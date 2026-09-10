import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'

import { t } from '../../i18n/translate'
import { booleanSocket, geometrySocket, type BooleanValue, type GeometryValue } from '../sockets'

function indent(code: string): string {
  return code.split('\n').map((line) => `  ${line}`).join('\n')
}

/** Formats OpenSCAD's statement-level conditional. Unlike the value-only
 * Conditional node, this selects Geometry statements and deliberately has
 * no inferred type state or literal fallback. */
export function ifToOpenSCAD(condition: string, whenThen: string, whenElse?: string): string {
  const thenBlock = `if (${condition}) {\n${indent(whenThen)}\n}`
  return whenElse === undefined ? thenBlock : `${thenBlock} else {\n${indent(whenElse)}\n}`
}

/** OpenSCAD's Geometry-producing `if` statement. Port identities are fixed
 * semantic ids so v6 persistence can represent this additive node directly. */
export class IfNode extends ClassicPreset.Node<
  { condition: ClassicPreset.Socket; then: ClassicPreset.Socket; else: ClassicPreset.Socket },
  { geometry: ClassicPreset.Socket },
  Record<string, never>
> implements DataflowNode {
  constructor() {
    super(t('node.if'))
    this.addInput('condition', new ClassicPreset.Input(booleanSocket, t('input.condition')))
    this.addInput('then', new ClassicPreset.Input(geometrySocket, t('input.then')))
    this.addInput('else', new ClassicPreset.Input(geometrySocket, t('input.else')))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, t('input.geometry')))
  }

  data(inputs: { condition?: BooleanValue[]; then?: GeometryValue[]; else?: GeometryValue[] }): { geometry: GeometryValue } {
    const condition = inputs.condition?.[0]?.code
    const whenThen = inputs.then?.[0]?.code
    const whenElse = inputs.else?.[0]?.code
    if (!condition || !whenThen) {
      // Reachability validation in evaluate.ts turns this draft state into a
      // localized error before source is displayed, exported, or rendered.
      return { geometry: { code: '', error: 'incomplete If' } }
    }
    return { geometry: { code: ifToOpenSCAD(condition, whenThen, whenElse) } }
  }
}
