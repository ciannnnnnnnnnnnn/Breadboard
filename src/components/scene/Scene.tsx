import { Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { Suspense, useEffect, useRef } from 'react'
import * as THREE from 'three'
import type { OrbitControls as Controls } from 'three-stdlib'
import { BOARD_PITCH, nearestHole } from '../../data/breadboard'
import { holeExists } from '../../data/components'
import { useStore } from '../../store/useStore'
import { Breadboard } from './Breadboard'
import { Components } from './Components'
import { ResistorLabels } from './ResistorLabels'
import { Wires } from './Wires'
import { drag } from './shared'

const VIEWS = {
  orbit: { pos: new THREE.Vector3(-6, 58, 59), target: new THREE.Vector3(-6, 0, 3) },
  top: { pos: new THREE.Vector3(-7, 78, 0.01), target: new THREE.Vector3(-7, 0, 0) },
}

function Rig() {
  const controls = useRef<Controls>(null!)
  const { camera } = useThree()
  const top = useStore((s) => s.topView)
  const nonce = useStore((s) => s.viewNonce)
  const gl = useThree((s) => s.gl)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    // board coordinates → page pixels, for scripted checks
    Object.assign(window, {
      __project: (x: number, y: number, z: number) => {
        const v = new THREE.Vector3(x, y, z).project(camera)
        const r = gl.domElement.getBoundingClientRect()
        return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height]
      },
      __look: (p: number[], t: number[]) => { camera.position.set(p[0], p[1], p[2]); controls.current.target.set(t[0], t[1], t[2]); controls.current.update() },
    })
  }, [camera, gl])
  const boards = useStore((s) => s.circuit.boards ?? 1)
  const fly = useRef<(typeof VIEWS)['top'] | null>(null)
  useEffect(() => { if (nonce || boards > 1) fly.current = framed(top ? VIEWS.top : VIEWS.orbit, boards) }, [nonce, top, boards])
  const focus = useStore((s) => s.focus)
  useEffect(() => {
    if (!focus) return
    const t = useStore.getState().topView
    // the problem list covers the left edge, so aim a little left of the part
    fly.current = {
      pos: new THREE.Vector3(focus.x - 5, t ? 34 : 24, t ? focus.z + 0.01 : focus.z + 23),
      target: new THREE.Vector3(focus.x - 5, 0, focus.z),
    }
  }, [focus])
  useFrame((_, dt) => {
    const c = controls.current
    if (!c) return
    c.enabled = !drag.active && !fly.current
    const f = fly.current
    if (!f) return
    const k = 1 - Math.exp(-dt * 7)
    camera.position.lerp(f.pos, k)
    c.target.lerp(f.target, k)
    camera.lookAt(c.target)
    if (camera.position.distanceTo(f.pos) < 0.15) {
      camera.position.copy(f.pos)
      c.target.copy(f.target)
      fly.current = null
      c.enabled = true
      c.update()
    }
  })
  return (
    <OrbitControls
      ref={controls as never} makeDefault target={VIEWS.orbit.target} maxPolarAngle={Math.PI * 0.48} minDistance={5} maxDistance={220}
      enableRotate={!top}
      mouseButtons={{ LEFT: top ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
    />
  )
}

const liveHole = (x: number, z: number) => {
  const h = nearestHole(x, z, 0.5)
  return h && holeExists(h.id, useStore.getState().circuit) ? h : undefined
}

/** catches everything that is not a part or wire: hole hover, wiring, placing */
function Ground() {
  const down = useRef<[number, number] | null>(null)
  const st = useStore.getState
  const onMove = (e: ThreeEvent<PointerEvent>) => {
    if (drag.active) return
    // only when the board is the first thing under the pointer, unless drawing a wire
    if (e.intersections[0]?.eventObject !== e.eventObject && !st().wireStart) return
    const h = liveHole(e.point.x, e.point.z)
    st().setHover(h ? { kind: 'hole', hole: h.id } : null)
  }
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const s = st()
    if (e.delta > 5 || s.placing || drag.active) return
    if (s.wireStart && e.shiftKey) { s.addBend(e.point.x, e.point.z); return }
    const h = liveHole(e.point.x, e.point.z)
    if (h) s.clickEnd(h.id)
    else if (!s.wireStart) s.select(null)
  }
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={onMove}
      onPointerLeave={() => { if (st().hover?.kind === 'hole') st().setHover(null) }}
      onPointerDown={(e) => { down.current = [e.clientX, e.clientY] }}
      onPointerUp={(e) => {
        const s = st()
        // works for drag-and-drop from the palette and for click-then-click
        const d = down.current
        down.current = null
        if (!s.placing || e.button !== 0 || (d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 6)) return
        s.placeAt(e.point.x, e.point.z)
      }}
      onClick={onClick}
    >
      <planeGeometry args={[400, 300]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}

/** a view shifted and pulled back to take in every board */
function framed(v: (typeof VIEWS)['top'], boards: number) {
  const shift = new THREE.Vector3(0, 0, ((boards - 1) * BOARD_PITCH) / 2)
  const k = 1 + (boards - 1) * 0.12
  return { target: v.target.clone().add(shift), pos: v.pos.clone().sub(v.target).multiplyScalar(k).add(v.target).add(shift) }
}

export function Scene() {
  const boards = useStore((s) => s.circuit.boards ?? 1)
  return (
    <Canvas shadows="percentage" dpr={[1, 2]} camera={{ position: VIEWS.orbit.pos.toArray(), fov: 35, near: 1, far: 600 }} gl={{ antialias: true }}>
      <color attach="background" args={['#12161d']} />
      <hemisphereLight args={['#dfe9ff', '#20242c', 0.45]} />
      <directionalLight
        key={boards}
        position={[18, 40, 16]} intensity={1.35} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005}
        shadow-camera-left={-55} shadow-camera-right={45} shadow-camera-top={30} shadow-camera-bottom={-30 - (boards - 1) * BOARD_PITCH} shadow-camera-far={120 + boards * 20}
      />
      {/* locally rendered reflections; no network HDRs */}
      <Environment resolution={64} environmentIntensity={0.4}>
        <Lightformer intensity={2} position={[0, 10, 0]} scale={[20, 20, 1]} rotation={[Math.PI / 2, 0, 0]} />
        <Lightformer intensity={1} position={[-10, 4, 8]} scale={[8, 4, 1]} />
      </Environment>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.01, 0]} receiveShadow raycast={() => null}>
        <planeGeometry args={[500, 400]} /><meshStandardMaterial color="#1b212b" roughness={0.95} />
      </mesh>
      <gridHelper args={[240, 120, '#27303d', '#212935']} position={[0, -1.99, 0]} />
      {Array.from({ length: boards }, (_, k) => <Breadboard key={k} board={k} />)}
      <Ground />
      <Suspense fallback={null}>
        <Components />
      </Suspense>
      <Wires />
      <ResistorLabels />
      <Rig />
      <EffectComposer multisampling={4}>
        <Bloom mipmapBlur luminanceThreshold={1} luminanceSmoothing={0.15} intensity={0.85} radius={0.6} />
        <ToneMapping mode={ToneMappingMode.LINEAR} />
      </EffectComposer>
    </Canvas>
  )
}
