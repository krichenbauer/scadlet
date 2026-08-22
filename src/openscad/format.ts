/**
 * Small, dependency-free helpers for formatting OpenSCAD source fragments.
 * Kept free of Rete/DOM concerns so it can be unit-tested directly and
 * reused by future geometry nodes (transformations, CSG, ...).
 */

/** Formats a number the way OpenSCAD expects: no scientific notation, no trailing zeros. */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}

/** Formats a 3D vector literal, e.g. `[10, 20, 30]`. */
export function formatVector3(x: number, y: number, z: number): string {
  return `[${formatNumber(x)}, ${formatNumber(y)}, ${formatNumber(z)}]`
}

/**
 * Formats a single OpenSCAD module/function call statement from positional
 * arguments followed by named arguments, e.g.
 * `formatCall('cube', ['10'], { center: 'true' })` -> `cube(10, center=true);`
 */
export function formatCall(
  name: string,
  positional: readonly string[],
  named: Readonly<Record<string, string>> = {},
): string {
  const args = [...positional, ...Object.entries(named).map(([key, value]) => `${key}=${value}`)]
  return `${name}(${args.join(', ')});`
}
