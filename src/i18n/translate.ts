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
    'category.transformations': 'Transformations',
    'category.booleanOperations': 'Boolean operations',
    'category.values': 'Values',
    'category.math': 'Math',
    'node.cube': 'Cube',
    'node.cylinder': 'Cylinder',
    'node.sphere': 'Sphere',
    'node.translate': 'Translate',
    'node.rotate': 'Rotate',
    'node.scale': 'Scale',
    'node.difference': 'Difference',
    'node.union': 'Union',
    'node.intersection': 'Intersection',
    'node.number': 'Number',
    'node.boolean': 'Boolean',
    'node.vector3': 'Vector3',
    'node.add': 'Add',
    'node.subtract': 'Subtract',
    'node.multiply': 'Multiply',
    'node.divide': 'Divide',
    'node.pin': 'Pin node expanded',
    'node.unpin': 'Unpin node',
    'node.inspected': 'Inspecting this node\u2019s output',
    'node.inspectedValue': 'Inspected OpenSCAD value',
    'control.value': 'Value',
    'control.name': 'Name',
    'control.overridden': 'Connected value overrides the saved fallback literal.',
    'output.number': 'Number output',
    'output.boolean': 'Boolean output',
    'output.vector3': 'Vector3 output',
    'control.size': 'Size',
    'control.center': 'Center',
    'control.height': 'H',
    'control.radius': 'R',
    'control.diameter': 'D',
    'control.radiusBottom': 'R1',
    'control.radiusTop': 'R2',
    'control.enableFn': 'Enable $fn',
    'control.fn': '$fn',
    'control.x': 'X',
    'control.y': 'Y',
    'control.z': 'Z',
    'control.representation': 'Representation',
    'control.removeConnectionsBeforeSwitch': 'Remove active parameter connections before switching representation.',
    'mode.scalar': 'Scalar',
    'mode.xyz': 'XYZ',
    'mode.vector': 'Vector',
    'mode.radius': 'Radius',
    'mode.diameter': 'Diameter',
    'mode.tapered': 'Tapered',
    'input.geometry': 'Geometry',
    'input.base': 'Base',
    'input.subtract': 'Subtract',
    'input.geometryChild': 'Geometry child',
    'input.addGeometryChild': 'Add geometry child',
    'input.a': 'A',
    'input.b': 'B',
    'action.addSize': '+ Size',
    'action.removeSize': '− Size',
    'action.addCenter': '+ Center',
    'action.removeCenter': '− Center',
    'action.addHeight': '+ Height',
    'action.addFn': '+ $fn',
    'toolbar.new': 'New',
    'toolbar.delete': 'Delete',
    'toolbar.open': 'Open',
    'toolbar.save': 'Save',
    'toolbar.saveAs': 'Save As',
    'toolbar.render': 'Render',
    'toolbar.rendering': 'Rendering…',
    'toolbar.stop': 'Stop',
    'toolbar.downloadScad': 'Download .scad',
    'toolbar.downloadStl': 'Download .stl',
    'toolbar.localProject': 'Local project',
    'toolbar.github': 'SCADlet on GitHub',
    'toolbar.projectName': 'Project name',
    'toolbar.autosavePending': 'Changes waiting for local autosave',
    'toolbar.renderHint': 'Click “Render” to see the generated source',
    'toolbar.reloadStored': 'Reload stored version',
    'toolbar.saveAsNew': 'Save current as a new project',
  },
}

const currentLocale: LocaleId = 'en'

/** Resolves a label key to display text in the current locale, falling back to the key itself if missing. */
export function t(key: string): string {
  return dictionaries[currentLocale][key] ?? key
}
