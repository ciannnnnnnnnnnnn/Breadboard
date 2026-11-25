import { Edges } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import type { MeshBasicMaterial } from 'three'
import { TYPES, placementError, snapPosition } from '../../data/components'
import type { Comp } from '../../data/types'
import { useStore } from '../../store/useStore'
import { PROBLEM_COLOR, useProblemSeverity } from '../../store/problems'
import { IC, WarningIcon } from './parts/IC'
import { Button, Dip, Input, Led, Probe, Resistor, Toggle } from './parts/Parts'
import { Battery, Gnd, Supply } from './parts/Power'
import { boardPoint, drag } from './shared'

const MODELS: Record<Comp['type'], (p: { comp: Comp }) => React.ReactNode> = {
  supply: Supply, battery: Battery, gnd: Gnd, toggle: Toggle, button: Button, dip4: Dip,
  input: Input, led: Led, probe: Probe, resistor: Resistor, ic: IC,
}

function Outline({ comp, color, opacity }: { comp: Comp; color: string; opacity: number }) {
  const s = TYPES[comp.type].size(comp.props)
  const off = TYPES[comp.type].offBoard
  return (
    <mesh position={[s.cx, s.h / 2 - (off ? 2 : 0) + 0.02, s.cz]} raycast={() => null}>
      <boxGeometry args={[s.w + 0.3, s.h + 0.2, s.d + 0.3]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      <Edges color={color} lineWidth={2} raycast={() => null} />
    </mesh>
  )
}

/** pulsing halo on parts (and dots on pins) named by a problem */
function ProblemMark({ comp }: { comp: Comp }) {
  const sev = useProblemSeverity('comps', comp.id)
  const mat = useRef<MeshBasicMaterial>(null)
  useFrame(({ clock }) => { if (mat.current) mat.current.opacity = 0.2 + 0.14 * Math.sin(clock.elapsedTime * 5) })
  const s = TYPES[comp.type].size(comp.props)
  const off = TYPES[comp.type].offBoard
  return (
    <>
      {sev && (
        <>
          <mesh position={[s.cx, s.h / 2 - (off ? 2 : 0) + 0.02, s.cz]} raycast={() => null}>
            <boxGeometry args={[s.w + 0.5, s.h + 0.3, s.d + 0.5]} />
            <meshBasicMaterial ref={mat} color={PROBLEM_COLOR[sev]} transparent depthWrite={false} />
            <Edges color={PROBLEM_COLOR[sev]} lineWidth={3} raycast={() => null} />
          </mesh>
          <group position={[s.cx, 0, s.cz]}><WarningIcon y={s.h + (off ? 1 : 1.6)} color={PROBLEM_COLOR[sev]} /></group>
        </>
      )}
      {TYPES[comp.type].pins(comp.props).map((p) => <PinMark key={p.name} id={comp.id + ':' + p.name} at={[p.dx, off ? 1.2 : 0.06, p.dz]} />)}
    </>
  )
}
function PinMark({ id, at }: { id: string; at: [number, number, number] }) {
  const sev = useProblemSeverity('pins', id)
  return sev && (
    <mesh position={at} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5} raycast={() => null}>
      <ringGeometry args={[0.42, 0.62, 28]} />
      <meshBasicMaterial color={PROBLEM_COLOR[sev]} depthTest={false} transparent />
    </mesh>
  )
}

function Part({ comp }: { comp: Comp }) {
  const { camera, gl } = useThree()
  const selected = useStore((s) => s.selection?.kind === 'comp' && s.selection.id === comp.id)
  const [ghost, setGhost] = useState<{ x: number; z: number; ok: boolean } | null>(null)
  const Model = MODELS[comp.type]
  const size = TYPES[comp.type].size(comp.props)

  const onPointerDown = (e: ThreeEvent<PointerEvent>) => {
    const s = useStore.getState()
    if (e.button !== 0 || s.placing || s.wireStart) return
    e.stopPropagation()
    if (s.running) {
      if (comp.type === 'button') {
        s.toggleInput(comp.id, 0, true)
        const release = () => {
          window.removeEventListener('pointerup', release)
          if (useStore.getState().running) useStore.getState().toggleInput(comp.id, 0, false)
        }
        window.addEventListener('pointerup', release)
      }
      return
    }
    s.select({ kind: 'comp', id: comp.id })
    drag.active = true
    const start = boardPoint(e, camera, gl.domElement)
    const x0 = e.clientX, y0 = e.clientY
    let target: { x: number; z: number } | null = null
    const move = (ev: PointerEvent) => {
      const p = boardPoint(ev, camera, gl.domElement)
      if (!p || !start || (!target && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5)) return
      target = snapPosition(comp, comp.x + p[0] - start[0], comp.z + p[1] - start[1])
      const err = placementError({ ...comp, ...target }, useStore.getState().circuit)
      setGhost({ ...target, ok: !err })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setTimeout(() => { drag.active = false }, 0)
      setGhost(null)
      if (target) useStore.getState().moveComp(comp.id, target.x, target.z)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const s = useStore.getState()
    if (s.placing || s.wireStart || e.delta > 5) return
    e.stopPropagation()
    s.select({ kind: 'comp', id: comp.id })
    if (s.running && (comp.type === 'toggle' || comp.type === 'input')) s.toggleInput(comp.id)
  }
  const pos = ghost ?? comp
  return (
    <group
      position={[pos.x, ghost ? 0.5 : 0, pos.z]} rotation={[0, (-comp.rot * Math.PI) / 2, 0]}
      onPointerDown={onPointerDown} onClick={onClick}
      onPointerOver={(e) => {
        if (useStore.getState().placing) return
        e.stopPropagation()
        useStore.getState().setHover({ kind: 'comp', compId: comp.id })
      }}
      onPointerOut={() => useStore.getState().setHover(null)}
    >
      <Model comp={comp} />
      {comp.type === 'ic' && (
        <mesh position={[0, 0.72, 0]}>
          <boxGeometry args={[7.24, 0.86, 2.5]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      {(comp.type === 'led' || comp.type === 'resistor') && (
        <mesh position={[size.cx, size.h / 2 + 0.3, 0]}>
          <boxGeometry args={[Math.max(0.9, size.w - 1.4), size.h * 0.8, 0.8]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
      <ProblemMark comp={comp} />
      {(selected || ghost) && <Outline comp={comp} color={ghost && !ghost.ok ? '#ff4d4d' : '#3aa0ff'} opacity={ghost ? 0.25 : 0.04} />}
    </group>
  )
}

/** translucent preview of a part being placed from the palette */
function PlacingGhost() {
  const placing = useStore((s) => s.placing)
  const circuit = useStore((s) => s.circuit)
  const { camera, gl } = useThree()
  const [p, setP] = useState<[number, number] | null>(null)
  const active = !!placing
  useEffect(() => {
    if (!active) { setP(null); return }
    const move = (e: PointerEvent) => {
      const r = gl.domElement.getBoundingClientRect()
      const inside = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom
      setP(inside ? boardPoint(e, camera, gl.domElement) : null)
    }
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [active, camera, gl])
  if (!placing || !p) return null
  const comp: Comp = { id: '__ghost', type: placing.type, x: p[0], z: p[1], rot: placing.rot, props: placing.props }
  Object.assign(comp, snapPosition(comp, comp.x, comp.z))
  const ok = !placementError(comp, circuit)
  const Model = MODELS[comp.type]
  return (
    <group position={[comp.x, 0.4, comp.z]} rotation={[0, (-comp.rot * Math.PI) / 2, 0]}>
      <Model comp={comp} />
      <Outline comp={comp} color={ok ? '#34f5a0' : '#ff4d4d'} opacity={0.25} />
    </group>
  )
}

export function Components() {
  const list = useStore((s) => s.circuit.components)
  return (
    <>
      {list.map((c) => <Part key={c.id} comp={c} />)}
      <PlacingGhost />
    </>
  )
}
