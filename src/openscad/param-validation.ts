/**
 * Small, explicit validators shared by every node type's persisted-
 * parameter schema (see each `openscad/*.ts` module's `validate*Params`
 * function and `editor/node-catalog.ts`). Deliberately not a generic
 * schema-validation framework - just the handful of primitive checks
 * every current node parameter shape actually needs, each throwing a
 * descriptive `Error` identifying the offending field.
 */

/** Throws unless `value` is a plain, non-array object (or `.scadlet` parsing wouldn't have a params object to read fields from). */
export function requireParamsObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected an object`)
  }
  return value as Record<string, unknown>
}

export function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${label}: expected a finite number`)
  }
  return value
}

/** Like `requireFiniteNumber`, but `undefined` passes through unchanged (for optional fields such as `$fn`). */
export function requireOptionalFiniteNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  return requireFiniteNumber(value, label)
}

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid ${label}: expected a boolean`)
  }
  return value
}

export function requireOneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== 'string' || !(options as readonly string[]).includes(value)) {
    throw new Error(`Invalid ${label}: expected one of ${options.join(', ')}`)
  }
  return value as T
}
