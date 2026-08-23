export type LocaleId = 'en'

/**
 * Minimal localization layer: a flat `key -> string` dictionary per
 * locale, resolved through `t()`. This is deliberately not a full i18n
 * framework (no plural rules, interpolation, or lazy-loaded bundles) -
 * AGENTS.md only asks that user-facing labels (e.g. the node palette) be
 * resolved through stable, language-independent keys instead of scattered
 * hardcoded display strings, so a German dictionary can be added later
 * without touching any call site. `currentLocale` is fixed to `'en'` for
 * now; a language switcher is an explicit non-goal of this step.
 */
const dictionaries: Record<LocaleId, Record<string, string>> = {
  en: {
    'palette.title': 'Nodes',
    'category.primitives': 'Primitives',
    'category.booleanOperations': 'Boolean operations',
    'node.cube': 'Cube',
    'node.cylinder': 'Cylinder',
    'node.difference': 'Difference',
    'node.pin': 'Pin node expanded',
    'node.unpin': 'Unpin node',
  },
}

const currentLocale: LocaleId = 'en'

/** Resolves a label key to display text in the current locale, falling back to the key itself if missing. */
export function t(key: string): string {
  return dictionaries[currentLocale][key] ?? key
}
