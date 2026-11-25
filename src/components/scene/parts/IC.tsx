import { Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BODY_EDGE, routedGates, type Pt } from '../../../data/gateGeometry'
import { ICS, pinInfo, pinXY } from '../../../data/ics'
import type { Comp, Level } from '../../../data/types'
import { useStore } from '../../../store/useStore'
import { LOW_LINE, Label, levelColor, pinHandlers } from '../shared'

const TOP = 1.15
const HALF_W = 3.62

/** a trace or symbol outline on the chip's top face, coloured by logic level */
function Trace({ pts, level, w = 0.045, y = TOP + 0.03 }: { pts: Pt[]; level: Level | null; w?: number; y?: number }) {
  const points = useMemo(() => pts.map(([px, py]) => [px, y, -py] as [number, number, number]), [pts, y])
  return (
    <Line
      points={points} color={level === null ? '#aab4c3' : level === 0 ? LOW_LINE : levelColor(level)} toneMapped={false}
      lineWidth={level === 1 ? w * 1.35 : w} worldUnits raycast={() => null}
      dashed={level === 'Z'} dashSize={0.09} gapSize={0.06}
    />
  )
}

const OUTLINE: Pt[] = (() => {
  const h = BODY_EDGE - 0.05
  const notch = Array.from({ length: 13 }, (_, i) => {
    const a = -Math.PI / 2 + (i / 12) * Math.PI
    return [-HALF_W + Math.cos(a) * 0.28, Math.sin(a) * 0.28] as Pt
  })
  return [[-HALF_W, -h], ...notch, [-HALF_W, h], [HALF_W, h], [HALF_W, -h], [-HALF_W, -h]]
})()

function Internals({ comp }: { comp: Comp }) {
  const def = ICS[comp.props.part!]
  const pins = useStore((s) => s.sim?.comps[comp.id]?.pins)
  const powered = useStore((s) => s.sim?.comps[comp.id]?.powered)
  const gateOut = useStore((s) => s.sim?.gateOut)
  const lv = (p: number): Level | null => pins?.[String(p)]?.level ?? null
  const flip = comp.rot === 2
  // keep text upright when the chip is turned around
  const R: [number, number, number] = [-Math.PI / 2, 0, flip ? Math.PI : 0]
  const text = (x: number, y: number) => [x, TOP + 0.035, -y] as [number, number, number]
  return (
    <group>
      <mesh position={[0, 0.72, 0]} raycast={() => null}>
        <boxGeometry args={[HALF_W * 2, 0.82, BODY_EDGE * 2 - 0.1]} />
        <meshStandardMaterial color="#0b1a2c" transparent opacity={0.9} roughness={0.5} />
      </mesh>
      <Line
        points={OUTLINE.map(([x, y]) => [x, TOP + 0.02, -y] as [number, number, number])} color="#7fb2e8"
        lineWidth={0.04} worldUnits dashed dashSize={0.18} gapSize={0.11} raycast={() => null}
      />
      <mesh position={text(-3.35, -0.72)} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <circleGeometry args={[0.1, 20]} /><meshBasicMaterial color="#7fb2e8" />
      </mesh>
      <Label size={0.2} color="#9fc6f2" position={text(0.1, 0)} rotation={R}>{`${def.part} ${def.gateType}`}</Label>
      {routedGates(def).map((g, i) => {
        // the gate's own computed output, which can differ from its net under contention
        const o = pins ? (gateOut?.[`${comp.id}:${i}`] ?? 'Z') : null
        return (
          <group key={i}>
            {g.inputs.map((t, k) => (
              <group key={k}>
                <Trace pts={t.path} level={lv(t.pin)} />
                <Label size={0.15} color="#dfe9f5" position={text(...t.label)} rotation={R}>{'ABCD'[k]}</Label>
              </group>
            ))}
            {g.body.map((b, k) => <Trace key={k} pts={b} level={o} w={0.055} />)}
            {g.bubble && <Trace pts={g.bubble} level={o} w={0.045} />}
            <Trace pts={g.output.path} level={o} />
            <Label size={0.15} color="#dfe9f5" position={text(...g.output.label)} rotation={R}>X</Label>
          </group>
        )
      })}
      {[def.vcc, def.gnd].map((p) => {
        const [x, y] = pinXY(def, p)
        const s = Math.sign(y)
        const c = powered === false ? '#ffb14a' : p === def.vcc ? '#ff7a7a' : '#8ab4ff'
        return (
          <group key={p}>
            <Trace pts={[[x, s * BODY_EDGE], [x, s * 0.85]]} level={lv(p)} />
            <Label size={0.17} color={c} position={text(x, s * 0.72)} rotation={R}>{p === def.vcc ? 'VCC' : 'GND'}</Label>
          </group>
        )
      })}
      {Array.from({ length: def.pinCount }, (_, i) => {
        const [x, y] = pinXY(def, i + 1)
        return <Label key={i} size={0.16} color="#ffd98a" position={text(x + 0.17, Math.sign(y) * 1.16)} rotation={R}>{String(i + 1)}</Label>
      })}
    </group>
  )
}

function Package({ comp }: { comp: Comp }) {
  const def = ICS[comp.props.part!]
  const R: [number, number, number] = [-Math.PI / 2, 0, comp.rot === 2 ? Math.PI : 0]
  return (
    <group>
      <mesh position={[0, 0.72, 0]} castShadow raycast={() => null}>
        <boxGeometry args={[HALF_W * 2, 0.85, 2.6]} />
        <meshStandardMaterial color="#1b1c1f" roughness={0.65} />
      </mesh>
      <mesh position={[-HALF_W + 0.05, 1.12, 0]} raycast={() => null}>
        <cylinderGeometry args={[0.32, 0.32, 0.08, 24, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color="#08090a" roughness={0.9} />
      </mesh>
      <mesh position={[-3.1, 1.152, 0.85]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
        <circleGeometry args={[0.16, 20]} /><meshStandardMaterial color="#55585f" />
      </mesh>
      <Label size={0.75} color="#d9dce2" position={[0.1, 1.16, -0.12]} rotation={R}>{def.part}</Label>
      <Label size={0.28} color="#8e939c" position={[0.1, 1.16, 0.62]} rotation={R}>{def.name}</Label>
    </group>
  )
}

const HIT = new THREE.BoxGeometry(0.5, 1.3, 0.55)
function Pin({ comp, n }: { comp: Comp; n: number }) {
  const def = ICS[comp.props.part!]
  const [x, y] = pinXY(def, n)
  const level = useStore((s) => s.sim?.comps[comp.id]?.pins[String(n)]?.level ?? null)
  const badges = useStore((s) => s.settings.badges)
  const z = -y, s = Math.sign(z)
  const c = level === null ? '#c9ccd2' : levelColor(level)
  const info = pinInfo(def, n)
  const mat = level === 1
    ? <meshBasicMaterial color={c} toneMapped={false} />
    : <meshStandardMaterial color={c} metalness={0.7} roughness={0.4} />
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.25, 0]} raycast={() => null}><boxGeometry args={[0.24, 0.9, 0.09]} />{mat}</mesh>
      <mesh position={[0, 0.69, -s * 0.11]} raycast={() => null}><boxGeometry args={[0.42, 0.1, 0.3]} />{mat}</mesh>
      <mesh geometry={HIT} position={[0, 0.45, s * 0.12]} {...pinHandlers(comp.id, String(n))}>
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {badges && level !== null && info.role !== 'nc' && (
        <group position={[0, 0.85, s * 0.45]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => null}>
            <circleGeometry args={[0.24, 24]} />
            <meshBasicMaterial color={level === 1 ? '#0c5a30' : level === 0 ? '#1b2a3a' : '#3a3c41'} />
          </mesh>
          <Label size={0.32} color={level === 1 ? '#7dffb5' : '#c8d2de'} position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, comp.rot === 2 ? Math.PI : 0]}>{String(level)}</Label>
        </group>
      )}
    </group>
  )
}

export function IC({ comp }: { comp: Comp }) {
  const global = useStore((s) => s.settings.internals)
  const show = comp.props.internals ?? global
  const def = ICS[comp.props.part!]
  return (
    <group>
      {show ? <Internals comp={comp} /> : <Package comp={comp} />}
      {Array.from({ length: def.pinCount }, (_, i) => <Pin key={i} comp={comp} n={i + 1} />)}
    </group>
  )
}

const TRI = (() => {
  const s = new THREE.Shape()
  s.moveTo(0, 0.75); s.lineTo(0.8, -0.6); s.lineTo(-0.8, -0.6); s.closePath()
  return new THREE.ShapeGeometry(s)
})()
export function WarningIcon({ y, color = '#ffb020' }: { y: number; color?: string }) {
  const ref = useRef<THREE.Group>(null!)
  useFrame(({ camera, clock }) => {
    ref.current.parent!.getWorldQuaternion(ref.current.quaternion).invert().multiply(camera.quaternion)
    ref.current.position.y = y + Math.sin(clock.elapsedTime * 3) * 0.12
  })
  return (
    <group ref={ref} position={[0, y, 0]}>
      <mesh geometry={TRI} raycast={() => null}><meshBasicMaterial color={color} /></mesh>
      <Label size={0.95} color="#1a1200" position={[0, -0.08, 0.02]}>!</Label>
    </group>
  )
}
