import { describe, expect, it } from 'vitest'

import { t } from '../i18n/translate'
import { IntersectionNode } from './nodes/intersection-node'
import { DifferenceNode } from './nodes/difference-node'
import { UnionNode } from './nodes/union-node'
import { geometryInputPresentation } from './render'

describe('variadic Boolean child presentation', () => {
  it('keeps connected Union children unlabeled while exposing a localized extension affordance', () => {
    const union = new UnionNode({}, false)
    const first = Object.keys(union.inputs)[0]!
    expect(geometryInputPresentation(union, first)).toEqual({
      visibleLabel: '+', accessibleLabel: t('input.addGeometryChild'),
    })

    union.synchronizeChildren(new Set([first]))
    const extension = Object.keys(union.inputs).at(-1)!
    expect(geometryInputPresentation(union, first)).toEqual({
      visibleLabel: '', accessibleLabel: t('input.geometryChild'),
    })
    expect(geometryInputPresentation(union, extension)).toEqual({
      visibleLabel: '+', accessibleLabel: t('input.addGeometryChild'),
    })
  })

  it('uses the same stable-slot presentation for Intersection without changing ids or ordering', () => {
    const intersection = new IntersectionNode({}, false)
    const first = Object.keys(intersection.inputs)[0]!
    intersection.synchronizeChildren(new Set([first]))
    const ports = Object.keys(intersection.inputs)
    expect(ports).toHaveLength(2)
    expect(geometryInputPresentation(intersection, ports[0]!)).toMatchObject({ visibleLabel: '' })
    expect(geometryInputPresentation(intersection, ports[1]!)).toMatchObject({
      visibleLabel: '+', accessibleLabel: t('input.addGeometryChild'),
    })
  })

  it('keeps Difference base/subtract ports and reuses one trailing extension after disconnect', () => {
    const difference = new DifferenceNode()
    expect(Object.keys(difference.inputs)).toEqual(['base', 'subtract'])
    expect(geometryInputPresentation(difference, 'base')).toEqual({ visibleLabel: t('input.base'), accessibleLabel: t('input.base') })
    expect(geometryInputPresentation(difference, 'subtract')).toEqual({ visibleLabel: t('input.subtract'), accessibleLabel: t('input.subtract') })

    expect(difference.synchronizeChildren(new Set(['base', 'subtract']))).toBe(true)
    const extension = Object.keys(difference.inputs).at(-1)!
    expect(extension.startsWith('child:')).toBe(true)
    expect(geometryInputPresentation(difference, extension)).toEqual({ visibleLabel: '+', accessibleLabel: t('input.addGeometryChild') })
    expect(difference.synchronizeChildren(new Set(['base', 'subtract']))).toBe(false)

    expect(difference.synchronizeChildren(new Set(['base', 'subtract', extension]))).toBe(true)
    const trailing = Object.keys(difference.inputs).at(-1)!
    expect(difference.synchronizeChildren(new Set(['base', 'subtract', extension]))).toBe(false)
    expect(Object.keys(difference.inputs)).toEqual(['base', 'subtract', extension, trailing])
    expect(geometryInputPresentation(difference, trailing)).toMatchObject({ visibleLabel: '+' })
  })
})
