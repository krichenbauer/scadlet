import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  BUILTIN_EXAMPLE_FILENAME_PATTERN,
  BUILTIN_EXAMPLES,
  createBuiltinExampleCopy,
  exampleDisplayName,
} from './builtin-examples'
import { parseScadletProjectText } from './validate'

const EXAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../examples')

describe('built-in example discovery', () => {
  it('eagerly bundles every and only examples/example_*.scadlet source', () => {
    const maintainedFiles = readdirSync(EXAMPLES_DIR)
      .filter((filename) => BUILTIN_EXAMPLE_FILENAME_PATTERN.test(filename))
      .sort()
    const bundledFiles = BUILTIN_EXAMPLES.map((example) => example.filename).sort()

    expect(bundledFiles).toEqual(maintainedFiles)
    expect(bundledFiles).not.toHaveLength(0)
    for (const example of BUILTIN_EXAMPLES) {
      expect(example.source).toBe(readFileSync(join(EXAMPLES_DIR, example.filename), 'utf8'))
      expect(() => parseScadletProjectText(example.source)).not.toThrow()
    }
  })

  it('derives readable names without exposing the filename prefix', () => {
    expect(exampleDisplayName('example_parametric_bowl.scadlet')).toBe('Parametric Bowl')
    expect(BUILTIN_EXAMPLES.map((example) => example.name)).toEqual([
      'Boolean Operations',
      'House',
      'Parametric Bowl',
    ])
    expect(BUILTIN_EXAMPLES.every((example) => !example.name.includes('example_'))).toBe(true)
  })

  it('creates independent, clearly named copies and increments repeated names', () => {
    const first = createBuiltinExampleCopy('example_house.scadlet', [])
    const second = createBuiltinExampleCopy('example_house.scadlet', [first.metadata.name])
    const third = createBuiltinExampleCopy('example_house.scadlet', [
      first.metadata.name,
      second.metadata.name,
      'example: house 3',
    ])

    expect(first.metadata).toEqual({ name: 'Example: House' })
    expect(second.metadata).toEqual({ name: 'Example: House 2' })
    expect(third.metadata).toEqual({ name: 'Example: House 4' })
    expect(first).not.toBe(second)
    expect(first.graph).not.toBe(second.graph)
  })
})
