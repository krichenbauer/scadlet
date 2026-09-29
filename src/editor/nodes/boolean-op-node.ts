import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'
import { differenceToOpenSCAD, variadicBooleanToOpenSCAD } from '../../openscad/csg'
import { t } from '../../i18n/translate'
import { geometrySocket, type GeometryValue } from '../sockets'

export interface VariadicBooleanParams { children: { id: string }[] }

/** Ordered, persistent Geometry slots shared by Difference, Union, and
 * Intersection. Slot ids are semantic port identities, never display labels
 * or list indexes. */
export class BooleanOpNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { geometry: ClassicPreset.Socket }, Record<string, never>> implements DataflowNode {
  private readonly op: 'difference' | 'union' | 'intersection'
  private slots: string[]
  constructor(label: string, op: 'difference' | 'union' | 'intersection', params: Partial<VariadicBooleanParams> = {}, legacy = true) {
    super(label); this.op = op
    const minimumSlots = op === 'difference' ? ['base', 'subtract'] : ['a', 'b']
    this.slots = params.children?.map((child) => child.id) ?? (legacy ? minimumSlots : [this.newSlotId()])
    if (this.slots.length === 0) this.slots.push(this.newSlotId())
    for (const [index, slot] of this.slots.entries()) {
      const label = op === 'difference' && index === 0 ? t('input.base')
        : op === 'difference' && index === 1 ? t('input.subtract') : t('input.geometryChild')
      this.addInput(this.port(slot, index), new ClassicPreset.Input(geometrySocket, label))
    }
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, t('input.geometry')))
  }
  private newSlotId(): string { return globalThis.crypto?.randomUUID?.() ?? `child-${Math.random().toString(36).slice(2)}` }
  private port(id: string, index: number): string {
    if (this.op === 'difference') return index === 0 ? 'base' : index === 1 ? 'subtract' : `child:${id}`
    return id === 'a' || id === 'b' ? id : `child:${id}`
  }
  /** Called by the editor after a connection change. Connecting the final
   * extension slot creates the next empty one without renumbering siblings. */
  synchronizeChildren(connectedInputs: ReadonlySet<string>): boolean {
    const last = this.slots[this.slots.length - 1]
    if (connectedInputs.has(this.port(last, this.slots.length - 1))) {
      const id = this.newSlotId()
      const index = this.slots.length
      this.slots.push(id)
      this.addInput(this.port(id, index), new ClassicPreset.Input(geometrySocket, t('input.geometryChild')))
      return true
    }
    return false
  }
  getPersistedParams(): VariadicBooleanParams { return { children: this.slots.map((id) => ({ id })) } }
  isInputPort(port: string): boolean { return this.slots.some((slot, index) => this.port(slot, index) === port) }
  /** Presentation-only distinction for the compact renderer. The returned
   * value never participates in port IDs, persistence, or evaluation. */
  isExtensionPort(port: string): boolean { return this.port(this.slots[this.slots.length - 1]!, this.slots.length - 1) === port }
  data(inputs: Record<string, GeometryValue[] | undefined>): { geometry: GeometryValue } {
    const children = this.slots.map((slot, index) => inputs[this.port(slot, index)]?.[0]?.code)
    if (this.op === 'difference') return { geometry: differenceChildrenToOpenSCAD(children) }
    return { geometry: variadicBooleanToOpenSCAD(this.op, children.filter((code): code is string => Boolean(code))) }
  }
}

/** Keeps Difference's first two required inputs while allowing ordered
 * optional subtractors to follow the same stable child-slot lifecycle. */
function differenceChildrenToOpenSCAD(children: readonly (string | undefined)[]): GeometryValue {
  return differenceToOpenSCAD(children[0], children[1], children.slice(2).filter((code): code is string => Boolean(code)))
}
