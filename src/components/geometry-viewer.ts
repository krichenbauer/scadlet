import { LitElement, css, html, nothing } from 'lit'
import { customElement, property, query } from 'lit/decorators.js'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

import { DEFAULT_VIEW_DIRECTION, frameModelBounds } from './view-framing'
import { t } from '../i18n/translate'

/**
 * The minimal Three.js view state needed to restore the user's camera
 * (see `persistence/project.ts`'s `ScadletViewerCamera`, which mirrors
 * this shape) - deliberately not the `THREE.PerspectiveCamera`/
 * `OrbitControls` objects themselves.
 */
export interface CameraState {
  position: [number, number, number]
  target: [number, number, number]
}

/**
 * Interactive Three.js preview for the STL produced by the OpenSCAD
 * render worker (Milestone 2). This is a mesh viewer only - it has no
 * awareness of the Rete graph and never feeds state back into it (see
 * "Data flow" in AGENTS.md).
 */
@customElement('geometry-viewer')
export class GeometryViewer extends LitElement {
  static styles = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      background: #1e1e1e;
    }

    #canvas-host {
      position: absolute;
      inset: 0;
    }

    #canvas-host canvas {
      display: block;
    }

    .view-recovery-control {
      position: absolute;
      z-index: 1;
      top: 10px;
      right: 10px;
      display: grid;
      width: 30px;
      height: 30px;
      place-items: center;
      padding: 0;
      border: 1px solid #626262;
      border-radius: 4px;
      background: rgb(38 38 38 / 0.92);
      color: #e8e8e8;
      cursor: pointer;
    }

    .view-recovery-control:hover:not(:disabled) { background: #3a3a3a; border-color: #898989; }
    .view-recovery-control:focus-visible { outline: 2px solid rgb(122 192 255 / 0.7); outline-offset: 2px; }
    .view-recovery-control:disabled { cursor: default; opacity: 0.45; }
    .view-recovery-control svg { width: 17px; height: 17px; fill: none; stroke: currentcolor; stroke-width: 1.8; }

    .render-spinner {
      position: absolute;
      z-index: 1;
      top: 12px;
      left: 12px;
      width: 16px;
      height: 16px;
      border: 2px solid rgb(220 235 245 / 0.3);
      border-top-color: #cfe9fa;
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .render-controls {
      position: absolute;
      z-index: 1;
      bottom: 10px;
      left: 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px;
      border: 1px solid rgb(98 98 98 / 0.85);
      border-radius: 5px;
      background: rgb(30 30 30 / 0.92);
    }

    .live-toggle, .render-action {
      min-height: 28px;
      border: 1px solid #626262;
      border-radius: 4px;
      background: #292929;
      color: #eee;
      font: 12px/1 system-ui, sans-serif;
      cursor: pointer;
    }
    .live-toggle { padding: 0 8px; }
    .live-toggle[aria-pressed='true'] { border-color: #5d96b8; background: #254051; }
    .render-action { min-width: 58px; padding: 0 10px; }
    .live-toggle:hover, .render-action:hover { background: #3a3a3a; }
    .live-toggle:focus-visible, .render-action:focus-visible { outline: 2px solid rgb(122 192 255 / 0.7); outline-offset: 2px; }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .empty-geometry-status {
      position: absolute;
      right: 12px;
      bottom: 12px;
      max-width: calc(100% - 24px);
      margin: 0;
      padding: 6px 9px;
      border: 1px solid #496979;
      border-radius: 4px;
      background: rgb(31 55 65 / 0.94);
      color: #c5e8f4;
      font: 12px/1.4 system-ui, sans-serif;
    }
  `

  @query('#canvas-host')
  private host!: HTMLDivElement

  /** A restrained status owned by the preview, rather than an OpenSCAD error. */
  @property({ type: String })
  status = ''

  /** Presentation-only default-on control. It deliberately has no render side effect yet. */
  @property({ type: Boolean })
  live = true

  @property({ type: Boolean })
  rendering = false

  /** Stops are exposed only after the render has crossed the UI delay threshold. */
  @property({ type: Boolean })
  showStop = false

  private renderer?: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000)
  private controls?: OrbitControls
  private mesh?: THREE.Mesh
  private resizeObserver?: ResizeObserver
  private frameHandle = 0
  private hasFittedOnce = false
  private readonly cameraChangeListeners = new Set<() => void>()
  private persistedCamera: CameraState = { position: [80, 80, 60], target: [0, 0, 0] }

  render() {
    return html`
      <div id="canvas-host"></div>
      <button
        type="button"
        class="view-recovery-control"
        aria-label=${t('viewer.resetView')}
        title=${t('viewer.resetView')}
        ?disabled=${!this.mesh}
        @pointerdown=${this.stopRecoveryControlGesture}
        @click=${this.resetView}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M8 8l3-3 3 3M12 5v9M9 12l3 3 3-3" /></svg>
        <span class="visually-hidden">${t('viewer.resetView')}</span>
      </button>
      ${this.rendering ? html`<span class="render-spinner" role="status" aria-label=${t('viewer.rendering')}></span>` : nothing}
      <div class="render-controls" aria-label=${t('viewer.renderControls')}>
        <button
          type="button"
          class="live-toggle"
          aria-pressed=${String(this.live)}
          @click=${this.toggleLive}
        >${t('viewer.live')}</button>
        <button type="button" class="render-action" @click=${this.requestManualRender}>
          ${this.showStop ? t('toolbar.stop') : t('toolbar.render')}
        </button>
      </div>
      ${this.status
        ? html`<p class="empty-geometry-status" role="status" aria-live="polite" aria-atomic="true">${this.status}</p>`
        : nothing}
    `
  }

  firstUpdated() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(window.devicePixelRatio)
    this.host.appendChild(this.renderer.domElement)

    // OpenSCAD is Z-up; Three.js defaults to Y-up. Setting the camera's
    // own up-vector (read once by OrbitControls below) is what actually
    // controls the orbit/vertical convention - it must happen before the
    // OrbitControls is constructed, since it captures `camera.up` then.
    this.camera.up.set(0, 0, 1)

    // GridHelper always lies in the XZ plane (horizontal for Y-up). Rotate
    // it 90° around X so it lies flat in the XY plane instead, matching
    // OpenSCAD's horizontal modeling plane.
    const grid = new THREE.GridHelper(200, 20, 0x555555, 0x333333)
    grid.rotation.x = Math.PI / 2
    this.scene.add(grid)
    // AxesHelper needs no rotation: its Z axis already renders vertically
    // once the camera's up-vector is Z.
    this.scene.add(new THREE.AxesHelper(100))
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7))
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8)
    keyLight.position.set(1, 2, 3)
    this.scene.add(keyLight)

    this.camera.position.set(80, 80, 60)

    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    // 'end' fires once per completed orbit/pan/zoom gesture (a real
    // pointerup/wheel interaction) - never from a programmatic camera
    // change such as `setCameraState()`'s own `controls.update()` call,
    // which only ever dispatches OrbitControls' separate 'change' event.
    // This is what lets project-restore camera application never be
    // mistaken for a user edit without any extra suspension bookkeeping.
    this.controls.addEventListener('end', this.onUserCameraChange)
    for (const listener of this.cameraChangeListeners) this.controls.addEventListener('end', listener)

    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(this.host)
    this.handleResize()

    this.tick()
  }

  disconnectedCallback() {
    super.disconnectedCallback()
    cancelAnimationFrame(this.frameHandle)
    this.resizeObserver?.disconnect()
    this.controls?.dispose()
    this.renderer?.dispose()
  }

  /** Parses STL bytes and replaces the displayed mesh, keeping the scene/camera/controls alive. */
  showSTL(stl: ArrayBuffer): void {
    const geometry = new STLLoader().parse(stl)
    geometry.computeVertexNormals()

    this.clear()

    const material = new THREE.MeshStandardMaterial({ color: 0x7ac0ff, metalness: 0.1, roughness: 0.6 })
    this.mesh = new THREE.Mesh(geometry, material)
    this.scene.add(this.mesh)
    this.requestUpdate()

    if (!this.hasFittedOnce) {
      this.fitToView()
      this.hasFittedOnce = true
    }
  }

  /** Removes the current mesh, if any, without touching the rest of the scene. */
  clear(): void {
    if (!this.mesh) return
    this.scene.remove(this.mesh)
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh = undefined
    this.requestUpdate()
  }

  /**
   * Notifies `callback` once per completed user orbit/pan/zoom gesture
   * (see the `firstUpdated` comment on why OrbitControls' 'end' event,
   * not 'change', is used) - not on every intermediate frame, and safe to
   * call before `firstUpdated` has run. Returns an unsubscribe function.
   */
  onCameraChange(callback: () => void): () => void {
    this.cameraChangeListeners.add(callback)
    this.controls?.addEventListener('end', callback)
    return () => {
      this.cameraChangeListeners.delete(callback)
      this.controls?.removeEventListener('end', callback)
    }
  }

  /** Captures the current camera position and orbit target - see `CameraState`. */
  getCameraState(): CameraState {
    const position = this.camera.position
    const target = this.controls?.target
    return {
      position: [position.x, position.y, position.z],
      target: target ? [target.x, target.y, target.z] : [0, 0, 0],
    }
  }

  /** The serializable user/restored camera state, excluding transient reset actions. */
  getPersistedCameraState(): CameraState {
    return { position: [...this.persistedCamera.position], target: [...this.persistedCamera.target] }
  }

  /**
   * Restores a previously captured camera position/target (project
   * restore - see `persistence/restore.ts`). Marks the camera as already
   * "fitted" so a subsequent `showSTL` never overrides the restored view
   * with its own auto-fit framing.
   */
  setCameraState(state: CameraState): void {
    this.camera.position.set(...state.position)
    if (this.controls) {
      this.controls.target.set(...state.target)
      this.controls.update()
    }
    this.persistedCamera = { position: [...state.position], target: [...state.target] }
    this.hasFittedOnce = true
  }

  /** Returns false for an empty preview, otherwise resets to a stable model frame. */
  resetView = (): boolean => {
    if (!this.mesh || !this.controls) return false
    const bounds = new THREE.Box3().setFromObject(this.mesh)
    if (bounds.isEmpty()) return false
    const frame = frameModelBounds(
      { min: [bounds.min.x, bounds.min.y, bounds.min.z], max: [bounds.max.x, bounds.max.y, bounds.max.z] },
      this.camera.fov,
      this.camera.aspect,
    )
    if (!frame) return false
    // Z is up in this viewer, so the elevation component of the view
    // direction belongs on Z rather than Y.
    const direction = new THREE.Vector3(...DEFAULT_VIEW_DIRECTION).normalize()
    this.camera.position.set(...frame.target).addScaledVector(direction, frame.distance)
    this.camera.near = frame.near
    this.camera.far = frame.far
    this.camera.updateProjectionMatrix()

    this.controls.target.set(...frame.target)
    this.controls.update()
    return true
  }

  private fitToView(): void {
    // The mesh is already in the scene, so this uses the same world-space
    // bounds and reset policy as the explicit recovery control.
    this.resetView()
  }

  private handleResize(): void {
    if (!this.renderer) return
    const { clientWidth, clientHeight } = this.host
    if (clientWidth === 0 || clientHeight === 0) return
    this.renderer.setSize(clientWidth, clientHeight)
    this.camera.aspect = clientWidth / clientHeight
    this.camera.updateProjectionMatrix()
  }

  private readonly tick = (): void => {
    this.frameHandle = requestAnimationFrame(this.tick)
    this.controls?.update()
    if (this.renderer) this.renderer.render(this.scene, this.camera)
  }

  private readonly stopRecoveryControlGesture = (event: PointerEvent): void => {
    event.stopPropagation()
  }

  private readonly toggleLive = (): void => {
    // This intentionally only changes the control's own visual state. Live
    // scheduling is a separately designed follow-up feature.
    this.live = !this.live
  }

  private readonly requestManualRender = (): void => {
    this.dispatchEvent(new CustomEvent(this.showStop ? 'manual-render-stop' : 'manual-render', {
      bubbles: true,
      composed: true,
    }))
  }

  private readonly onUserCameraChange = (): void => {
    this.persistedCamera = this.getCameraState()
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'geometry-viewer': GeometryViewer
  }
}
