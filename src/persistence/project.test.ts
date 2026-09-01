import { describe, expect, it } from 'vitest'

import { createEmptyProject, DEFAULT_VIEWER_CAMERA, SCADLET_FORMAT, SCADLET_VERSION, UNTITLED_PROJECT_NAME } from './project'

describe('createEmptyProject', () => {
  it('produces a minimal, valid v1 project with no nodes/connections', () => {
    const project = createEmptyProject()
    expect(project.format).toBe(SCADLET_FORMAT)
    expect(project.version).toBe(SCADLET_VERSION)
    expect(project.graph.nodes).toEqual([])
    expect(project.graph.connections).toEqual([])
  })

  it('defaults to the untitled placeholder name', () => {
    expect(createEmptyProject().metadata.name).toBe(UNTITLED_PROJECT_NAME)
  })

  it('accepts an explicit name', () => {
    expect(createEmptyProject('Gearbox Experiment').metadata.name).toBe('Gearbox Experiment')
  })

  it('sets createdAt/updatedAt from the injected clock, identical for a fresh project', () => {
    const project = createEmptyProject('X', () => '2026-01-01T00:00:00.000Z')
    expect(project.metadata.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(project.metadata.updatedAt).toBe('2026-01-01T00:00:00.000Z')
  })

  it('has a centered, unzoomed default viewport', () => {
    expect(createEmptyProject().editor.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  it('uses the viewer default camera', () => {
    expect(createEmptyProject().viewer.camera).toEqual(DEFAULT_VIEWER_CAMERA)
  })
})
