import { formatBlock } from './format'

export interface DifferenceResult {
  code: string
  /** Set when required geometry input(s) are missing; `code` is a comment describing why. */
  error?: string
}

/**
 * Composes two already-generated OpenSCAD fragments into a `difference()`
 * block. Unlike `cubeToOpenSCAD`/`cylinderToOpenSCAD`, this node doesn't
 * calculate any geometry itself - it takes source fragments produced by
 * its inputs rather than numeric parameters, so a fragment can be
 * missing (e.g. an unconnected input). That's reported as a validation
 * error and a descriptive comment instead of throwing or emitting
 * misleading geometry.
 */
export function differenceToOpenSCAD(
  base: string | undefined,
  subtract: string | undefined,
): DifferenceResult {
  if (!base || !subtract) {
    const missing = [!base && 'base', !subtract && 'subtract'].filter(
      (part): part is string => Boolean(part),
    )
    const error = `Difference is missing its ${missing.join(' and ')} geometry input`
    return { code: `// ${error}`, error }
  }

  return { code: formatBlock('difference', [base, subtract]) }
}
