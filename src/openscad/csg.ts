import { formatBlock } from './format'

export interface DifferenceResult {
  code: string
  /** Set when required geometry input(s) are missing; `code` is a comment describing why. */
  error?: string
}

interface NamedInput {
  label: string
  code: string | undefined
}

/**
 * Shared implementation for OpenSCAD boolean-operation blocks that
 * compose two already-generated OpenSCAD fragments (difference/union/
 * intersection) instead of calculating any geometry themselves. A
 * fragment can be missing (e.g. an unconnected input); that's reported as
 * a validation error and a descriptive comment instead of throwing or
 * emitting misleading geometry.
 */
function booleanOpToOpenSCAD(name: string, inputs: readonly NamedInput[]): DifferenceResult {
  const missing = inputs.filter((input) => !input.code).map((input) => input.label)
  if (missing.length > 0) {
    const capitalized = name.charAt(0).toUpperCase() + name.slice(1)
    const error = `${capitalized} is missing its ${missing.join(' and ')} geometry input`
    return { code: `// ${error}`, error }
  }

  return { code: formatBlock(name, inputs.map((input) => input.code as string)) }
}

/** Composes `base`/`subtract` fragments into a `difference() { ... }` block. */
export function differenceToOpenSCAD(
  base: string | undefined,
  subtract: string | undefined,
): DifferenceResult {
  return booleanOpToOpenSCAD('difference', [
    { label: 'base', code: base },
    { label: 'subtract', code: subtract },
  ])
}

/** Composes two fragments into a `union() { ... }` block. */
export function unionToOpenSCAD(a: string | undefined, b: string | undefined): DifferenceResult {
  return booleanOpToOpenSCAD('union', [
    { label: 'a', code: a },
    { label: 'b', code: b },
  ])
}

/** Variadic OpenSCAD child list used by the Union/Intersection nodes. */
export function variadicBooleanToOpenSCAD(name: 'union' | 'intersection', children: readonly string[]): DifferenceResult {
  if (children.length === 0) {
    const label = name.charAt(0).toUpperCase() + name.slice(1)
    const error = `${label} needs at least one geometry child`
    return { code: `// ${error}`, error }
  }
  return { code: formatBlock(name, children) }
}

/** Composes two fragments into an `intersection() { ... }` block. */
export function intersectionToOpenSCAD(a: string | undefined, b: string | undefined): DifferenceResult {
  return booleanOpToOpenSCAD('intersection', [
    { label: 'a', code: a },
    { label: 'b', code: b },
  ])
}
