import type { ScadletProjectV1 } from './project'
import { parseScadletProjectText } from './validate'

export const BUILTIN_EXAMPLE_FILENAME_PATTERN = /^example_(.+)\.scadlet$/

export interface BuiltinExample {
  /** The source filename is a stable template identifier, not local-project identity. */
  id: string
  filename: string
  name: string
  source: string
}

function filenameFromPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Turns `example_parametric_bowl.scadlet` into `Parametric Bowl`. */
export function exampleDisplayName(filename: string): string {
  const match = BUILTIN_EXAMPLE_FILENAME_PATTERN.exec(filename)
  if (!match) throw new Error(`Invalid built-in example filename: ${filename}`)
  return match[1]
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => `${word[0]?.toLocaleUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ')
}

const bundledSources = import.meta.glob<string>('../../examples/example_*.scadlet', {
  eager: true,
  import: 'default',
  query: '?raw',
})

/** Eager raw imports keep templates inside the application bundle: opening an
 * example performs no fetch and works on GitHub Pages or fully offline. */
export const BUILTIN_EXAMPLES: readonly BuiltinExample[] = Object.entries(bundledSources)
  .map(([path, source]) => {
    const filename = filenameFromPath(path)
    // Validate maintained sources as the module loads, before they can be
    // offered as immutable templates in the project menu.
    parseScadletProjectText(source)
    return { id: filename, filename, name: exampleDisplayName(filename), source }
  })
  .sort((a, b) => a.name.localeCompare(b.name))

function nextExampleCopyName(displayName: string, existingNames: Iterable<string>): string {
  const usedNames = new Set([...existingNames].map((name) => name.trim().toLocaleLowerCase()))
  const base = `Example: ${displayName}`
  let name = base
  let suffix = 2
  while (usedNames.has(name.toLocaleLowerCase())) name = `${base} ${suffix++}`
  return name
}

/** Returns a freshly parsed, independently named project payload. IndexedDB
 * assigns its ordinary local ID, revision, and timestamps on creation. */
export function createBuiltinExampleCopy(
  exampleId: string,
  existingNames: Iterable<string>,
): ScadletProjectV1 {
  const example = BUILTIN_EXAMPLES.find((candidate) => candidate.id === exampleId)
  if (!example) throw new Error(`Unknown built-in example: ${exampleId}`)
  const project = parseScadletProjectText(example.source)
  return {
    ...project,
    metadata: { name: nextExampleCopyName(example.name, existingNames) },
  }
}
