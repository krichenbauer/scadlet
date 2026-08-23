import { LitElement, css, html } from 'lit'
import { customElement, query } from 'lit/decorators.js'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

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
  `

  @query('#canvas-host')
  private host!: HTMLDivElement

  private renderer?: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10000)
  private controls?: OrbitControls
  private mesh?: THREE.Mesh
  private resizeObserver?: ResizeObserver
  private frameHandle = 0
  private hasFittedOnce = false

  render() {
    return html`<div id="canvas-host"></div>`
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

    if (!this.hasFittedOnce) {
      this.fitToView(geometry)
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
  }

  private fitToView(geometry: THREE.BufferGeometry): void {
    geometry.computeBoundingSphere()
    const sphere = geometry.boundingSphere
    if (!sphere || !this.controls) return

    const distance = (sphere.radius / Math.sin((this.camera.fov * Math.PI) / 360)) * 1.4
    // Z is up in this viewer, so the elevation component of the view
    // direction belongs on Z rather than Y.
    const direction = new THREE.Vector3(1, 1, 0.8).normalize()
    this.camera.position.copy(sphere.center).addScaledVector(direction, distance)
    this.camera.near = Math.max(distance / 100, 0.1)
    this.camera.far = distance * 100
    this.camera.updateProjectionMatrix()

    this.controls.target.copy(sphere.center)
    this.controls.update()
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
}

declare global {
  interface HTMLElementTagNameMap {
    'geometry-viewer': GeometryViewer
  }
}
