import { ClassicPreset } from 'rete'

import { DEFAULT_RESIZE_PARAMS, resizeToOpenSCAD, type ResizeParams } from '../../openscad/transform'
import { t } from '../../i18n/translate'
import { CheckboxControl, type ParameterAction, type RemovableRow } from '../controls'
import { booleanSocket } from '../sockets'
import { VectorTransformNode, type VectorTransformInputs } from './vector-transform-node'

/**
 * The `resize([x, y, z], auto=...) { ... }` transform: gives geometry an
 * exact size, where an axis of 0 keeps its current size. A new node starts
 * argument-less (`resize()` changes nothing); an added vector starts at
 * 10 x 10 x 10. The optional "Keep proportions" row is OpenSCAD's `auto`,
 * scaling the 0 axes proportionally; it starts enabled when added, since
 * leaving it out already means `false`.
 */
export class ResizeNode extends VectorTransformNode {
  constructor(params: Partial<ResizeParams> = {}, notify?: () => void, requestRemoveForm?: (keys: readonly string[], label: string) => Promise<boolean>) {
    super(t('node.resize'), 'resize', { ...DEFAULT_RESIZE_PARAMS, ...params }, resizeToOpenSCAD, notify, requestRemoveForm)
    if (params.auto !== undefined) this.addAuto(params.auto)
  }

  override getPersistedParams(): ResizeParams {
    const auto = this.controls.auto
    return { ...super.getPersistedParams(), ...(auto instanceof CheckboxControl ? { auto: auto.value } : {}) }
  }

  private addAuto(value: boolean): void {
    this.addInput('auto', new ClassicPreset.Input(booleanSocket, t('control.keepProportions')))
    this.addControl('auto', new CheckboxControl(t('control.keepProportions'), value))
  }

  protected override extraActions(): ParameterAction[] {
    if (this.controls.auto) return []
    return [{ id: 'add-auto', label: t('control.keepProportions'), run: () => { this.addAuto(true); this.notify?.() } }]
  }

  protected override extraRemovableRows(): RemovableRow[] {
    if (!this.controls.auto) return []
    return [{
      key: 'auto',
      label: t('control.keepProportions'),
      requestRemove: async () => {
        if (!(await (this.requestRemoveForm?.(['auto'], t('control.keepProportions')) ?? Promise.resolve(true)))) return false
        if (this.inputs.auto) this.removeInput('auto')
        if (this.controls.auto) this.removeControl('auto')
        this.notify?.()
        return true
      },
    }]
  }

  protected override extraArguments(inputs: VectorTransformInputs): string[] {
    const auto = this.controls.auto
    if (!(auto instanceof CheckboxControl)) return []
    return [`auto=${inputs.auto?.[0]?.code ?? (auto.value ? 'true' : 'false')}`]
  }
}
