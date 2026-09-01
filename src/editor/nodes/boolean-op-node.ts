import { ClassicPreset } from 'rete'
import type { DataflowNode } from 'rete-engine'
import { variadicBooleanToOpenSCAD } from '../../openscad/csg'
import { t } from '../../i18n/translate'
import { geometrySocket, type GeometryValue } from '../sockets'

export interface VariadicBooleanParams { children: { id: string }[] }

/** Ordered, persistent child slots for OpenSCAD's naturally variadic union
 * and intersection modules. Slot ids are semantic port identities, never
 * display labels or list indexes. */
export class BooleanOpNode extends ClassicPreset.Node<Record<string, ClassicPreset.Socket>, { geometry: ClassicPreset.Socket }, Record<string, never>> implements DataflowNode {
  private readonly op: 'union' | 'intersection'
  private slots: string[]
  constructor(label: string, op: 'union' | 'intersection', params: Partial<VariadicBooleanParams> = {}, legacy = true) {
    super(label); this.op = op
    this.slots = params.children?.map((child) => child.id) ?? (legacy ? ['a', 'b'] : [this.newSlotId()])
    if (this.slots.length === 0) this.slots.push(this.newSlotId())
    for (const slot of this.slots) this.addInput(this.port(slot), new ClassicPreset.Input(geometrySocket, t('input.geometryChild')))
    this.addOutput('geometry', new ClassicPreset.Output(geometrySocket, t('input.geometry')))
  }
  private newSlotId(): string { return globalThis.crypto?.randomUUID?.() ?? `child-${Math.random().toString(36).slice(2)}` }
  private port(id: string): string { return id === 'a' || id === 'b' ? id : `child:${id}` }
  /** Called by the editor after a connection change. Connecting the final
   * extension slot creates the next empty one without renumbering siblings. */
  synchronizeChildren(connectedInputs: ReadonlySet<string>): boolean {
    const last = this.slots[this.slots.length - 1]
    if (connectedInputs.has(this.port(last))) { const id = this.newSlotId(); this.slots.push(id); this.addInput(this.port(id), new ClassicPreset.Input(geometrySocket, t('input.geometryChild'))); return true }
    return false
  }
  getPersistedParams(): VariadicBooleanParams { return { children: this.slots.map((id) => ({ id })) } }
  isInputPort(port: string): boolean { return this.slots.some((slot) => this.port(slot) === port) }
  /** Presentation-only distinction for the compact renderer. The returned
   * value never participates in port IDs, persistence, or evaluation. */
  isExtensionPort(port: string): boolean { return this.port(this.slots[this.slots.length - 1]!) === port }
  data(inputs: Record<string, GeometryValue[] | undefined>): { geometry: GeometryValue } {
    const children = this.slots.map((slot) => inputs[this.port(slot)]?.[0]?.code).filter((code): code is string => Boolean(code))
    return { geometry: variadicBooleanToOpenSCAD(this.op, children) }
  }
}
