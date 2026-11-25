/** 3D models of switches, LEDs, probes and resistors. */
import { Billboard } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import { LED_COLORS, LED_MAX_MA } from '../../../data/components'
import type { Comp, Level } from '../../../data/types'
import { resistorBands } from '../../../simulation/resistor'
import { useStore } from '../../../store/useStore'
import { HIGH_TEXT, Label, Rod, levelColor, pinHandlers } from '../shared'

const FLAT: [number, number, number] = [-Math.PI / 2, 0, 0]
type V3 = [number, number, number]

/** invisible hover target around a lead */
function PinHit({ comp, pin, at }: { comp: Comp; pin: string; at: V3 }) {
  return (
    <mesh position={at} {...pinHandlers(comp.id, pin)}>
      <cylinderGeometry args={[0.24, 0.24, 0.7, 8]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}

export function Toggle({ comp }: { comp: Comp }) {
  const on = !!comp.props.on
  return (
    <group>
      {[-1, 0, 1].map((x) => <Rod key={x} a={[x, -0.3, 0]} b={[x, 0.4, 0]} />)}
      <PinHit comp={comp} pin="A" at={[-1, 0.2, 0.5]} />
      <PinHit comp={comp} pin="COM" at={[0, 0.2, 0.5]} />
      <PinHit comp={comp} pin="B" at={[1, 0.2, 0.5]} />
      <mesh position={[0, 0.75, 0]} castShadow>
        <boxGeometry args={[2.9, 0.8, 1.35]} /><meshStandardMaterial color="#2a6fb5" roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.16, 0]}><boxGeometry args={[1.9, 0.04, 0.6]} /><meshStandardMaterial color="#12161c" /></mesh>
      <mesh position={[on ? 0.55 : -0.55, 1.4, 0]} castShadow>
        <boxGeometry args={[0.7, 0.55, 0.5]} />
        <meshStandardMaterial color={on ? '#e8fff2' : '#e5e7eb'} roughness={0.4} />
      </mesh>
      <Label size={0.36} color={on ? '#5f7a94' : '#fff'} position={[-1.2, 1.17, 0]} rotation={FLAT}>0</Label>
      <Label size={0.36} color={on ? HIGH_TEXT : '#5f7a94'} position={[1.2, 1.17, 0]} rotation={FLAT}>1</Label>
    </group>
  )
}

export function Button({ comp }: { comp: Comp }) {
  return (
    <group>
      {[-1, 1].flatMap((x) => [-1.5, 1.5].map((z) => <Rod key={`${x}${z}`} a={[x, -0.3, z]} b={[x, 0.5, z]} />))}
      {([['1a', -1, -1.5], ['2a', 1, -1.5], ['1b', -1, 1.5], ['2b', 1, 1.5]] as const).map(([n, x, z]) => (
        <PinHit key={n} comp={comp} pin={n} at={[x, 0.3, z]} />
      ))}
      <mesh position={[0, 0.65, 0]} castShadow><boxGeometry args={[2.9, 0.7, 2.7]} /><meshStandardMaterial color="#33373e" /></mesh>
      <mesh position={[0, 1.02, 0]}><boxGeometry args={[2.6, 0.08, 2.4]} /><meshStandardMaterial color="#b6bac2" metalness={0.8} roughness={0.35} /></mesh>
      <mesh position={[0, comp.props.on ? 1.08 : 1.3, 0]} castShadow>
        <cylinderGeometry args={[0.8, 0.8, 0.5, 28]} /><meshStandardMaterial color={comp.props.on ? '#ff6a4d' : '#c0392b'} roughness={0.4} />
      </mesh>
    </group>
  )
}

export function Dip({ comp }: { comp: Comp }) {
  const n = comp.props.switches!.length
  const idx = Array.from({ length: n }, (_, i) => i)
  return (
    <group>
      {idx.flatMap((i) => [-1.5, 1.5].map((z) => (
        <group key={`${i}${z}`}>
          <Rod a={[i - 1, -0.3, z]} b={[i - 1, 0.6, z]} />
          <PinHit comp={comp} pin={`${i + 1}${z < 0 ? 'a' : 'b'}`} at={[i - 1, 0.3, z]} />
        </group>
      )))}
      <mesh position={[(n - 1) / 2 - 1, 0.7, 0]} castShadow><boxGeometry args={[n + 0.5, 0.8, 2.6]} /><meshStandardMaterial color="#b3261e" roughness={0.5} /></mesh>
      {idx.map((i) => {
        const on = comp.props.switches?.[i]
        const flip = (e: ThreeEvent<MouseEvent>) => {
          if (!useStore.getState().running || e.delta > 5) return
          e.stopPropagation()
          useStore.getState().toggleInput(comp.id, i)
        }
        return (
          <group key={i} position={[i - 1, 1.1, 0]} onClick={flip}>
            <mesh><boxGeometry args={[0.6, 0.04, 1.5]} /><meshStandardMaterial color="#14171c" /></mesh>
            <mesh position={[0, 0.12, on ? -0.4 : 0.4]}><boxGeometry args={[0.5, 0.3, 0.55]} /><meshStandardMaterial color="#f1f1f1" /></mesh>
            <Label size={comp.props.names?.[i] ? Math.min(0.38, 1.4 / comp.props.names[i].length) : 0.3} position={[0, 0.02, 1.05]} rotation={FLAT}>{comp.props.names?.[i] ?? String(i + 1)}</Label>
            <Label size={0.24} color={on ? HIGH_TEXT : '#e8b4b0'} position={[0, 0.02, -1.05]} rotation={FLAT}>ON</Label>
          </group>
        )
      })}
    </group>
  )
}

function Puck({ level, tall, text }: { level: Level | null; tall: number; text: string }) {
  return (
    <Billboard position={[0, tall, 0]}>
      <mesh raycast={() => null}><circleGeometry args={[0.52, 28]} /><meshBasicMaterial color="#0d1218" /></mesh>
      <mesh position={[0, 0, 0.005]} raycast={() => null}>
        <ringGeometry args={[0.45, 0.54, 28]} /><meshBasicMaterial color={level === null ? '#8b93a1' : levelColor(level)} toneMapped={false} />
      </mesh>
      <Label size={0.62} color={level === 1 ? HIGH_TEXT : '#cbd5e1'} position={[0, 0, 0.01]}>{text}</Label>
    </Billboard>
  )
}

export function Input({ comp }: { comp: Comp }) {
  const on = !!comp.props.on
  const running = useStore((s) => s.running)
  return (
    <group>
      <Rod a={[0, -0.3, 0]} b={[0, 0.5, 0]} />
      <PinHit comp={comp} pin="OUT" at={[0, 0.2, 0.2]} />
      <mesh position={[0, 0.85, 0]} castShadow><boxGeometry args={[0.95, 0.9, 0.95]} /><meshStandardMaterial color="#3b2f63" roughness={0.5} /></mesh>
      <Puck level={running ? (on ? 1 : 0) : null} tall={1.9} text={on ? '1' : '0'} />
    </group>
  )
}

export function Probe({ comp }: { comp: Comp }) {
  const level = useStore((s) => s.sim?.comps[comp.id]?.pins.IN.level ?? null)
  return (
    <group>
      <Rod a={[0, -0.3, 0]} b={[0, 1.2, 0]} />
      <PinHit comp={comp} pin="IN" at={[0, 0.2, 0.2]} />
      <mesh position={[0, 1.2, 0]} castShadow><cylinderGeometry args={[0.3, 0.1, 1, 16]} /><meshStandardMaterial color="#0f766e" /></mesh>
      <Puck level={level} tall={2.3} text={level === null ? '?' : String(level)} />
    </group>
  )
}

/** grey puffs rising from a burned LED */
function Smoke({ at }: { at: V3 }) {
  const ref = useRef<THREE.Group>(null!)
  useFrame(({ clock }) => {
    ref.current.children.forEach((c, i) => {
      const t = (clock.elapsedTime * 0.45 + i / 7) % 1
      c.position.set(Math.sin(i * 2.4 + t * 4) * 0.5 * t, t * 4.2, Math.cos(i * 1.7 + t * 3) * 0.5 * t)
      c.scale.setScalar(0.25 + t * 0.9)
      ;((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.6 * (1 - t)
    })
  })
  return (
    <group ref={ref} position={at}>
      {Array.from({ length: 7 }, (_, i) => (
        <mesh key={i} raycast={() => null}><sphereGeometry args={[0.6, 12, 10]} /><meshBasicMaterial color="#43464c" transparent depthWrite={false} /></mesh>
      ))}
    </group>
  )
}

export function Led({ comp }: { comp: Comp }) {
  const span = comp.props.span ?? 1
  const hex = LED_COLORS[comp.props.color!].hex
  const current = useStore((s) => s.sim?.comps[comp.id]?.current ?? 0)
  const burned = useStore((s) => s.burned[comp.id])
  const k = Math.min(1, (current * 1000) / LED_MAX_MA)
  const lit = k > 0.002
  const x = span / 2
  const glow = useMemo(() => new THREE.Color(hex), [hex])
  const body = burned !== undefined ? '#1a1614' : hex
  const mat = (
    <meshStandardMaterial
      color={body} transparent opacity={burned !== undefined ? 1 : lit ? 0.95 : 0.72} roughness={0.25}
      emissive={glow} emissiveIntensity={burned !== undefined ? 0 : lit ? 0.8 + 3.2 * Math.sqrt(k) : 0.04} toneMapped={!lit}
    />
  )
  return (
    <group>
      <Rod a={[0, -0.3, 0]} b={[0, 0.5, 0]} />
      <Rod a={[0, 0.5, 0]} b={[x - 0.22, 1.1, 0]} />
      <Rod a={[span, -0.3, 0]} b={[span, 0.5, 0]} />
      <Rod a={[span, 0.5, 0]} b={[x + 0.22, 1.1, 0]} />
      <PinHit comp={comp} pin="A" at={[0, 0.3, 0]} />
      <PinHit comp={comp} pin="K" at={[span, 0.3, 0]} />
      <mesh position={[x, 1.18, 0]} castShadow><cylinderGeometry args={[0.62, 0.62, 0.2, 28]} />{mat}</mesh>
      <mesh position={[x, 1.65, 0]} castShadow><cylinderGeometry args={[0.52, 0.52, 0.8, 28]} />{mat}</mesh>
      <mesh position={[x, 2.05, 0]}><sphereGeometry args={[0.52, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />{mat}</mesh>
      {comp.props.label && (
        <Billboard position={[x, 3.1, 0]}><Label size={0.75} color="#111827" outlineWidth={0.09} outlineColor="#ffffff">{comp.props.label.slice(0, 14)}</Label></Billboard>
      )}
      {burned !== undefined && <Smoke at={[x, 2.2, 0]} />}
    </group>
  )
}

export function Resistor({ comp }: { comp: Comp }) {
  const span = comp.props.span ?? 4
  const x = span / 2
  const L = Math.min(2.3, span - 0.5)
  const bands = resistorBands(comp.props.ohms ?? 330)
  const y = 0.62
  return (
    <group>
      <Rod a={[0, -0.3, 0]} b={[0, y, 0]} />
      <Rod a={[span, -0.3, 0]} b={[span, y, 0]} />
      <Rod a={[0, y, 0]} b={[span, y, 0]} />
      <PinHit comp={comp} pin="1" at={[0, 0.3, 0]} />
      <PinHit comp={comp} pin="2" at={[span, 0.3, 0]} />
      <group position={[x, y, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <mesh castShadow><cylinderGeometry args={[0.3, 0.3, L, 20]} /><meshStandardMaterial color="#d9bd8b" roughness={0.6} /></mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0, (s * L) / 2, 0]} castShadow><sphereGeometry args={[0.37, 20, 14]} /><meshStandardMaterial color="#d9bd8b" roughness={0.6} /></mesh>
        ))}
        {bands.map((c, i) => (
          <mesh key={i} position={[0, [-0.36, -0.14, 0.08, 0.36][i] * L, 0]}>
            <cylinderGeometry args={[0.318, 0.318, L * 0.09, 20]} />
            <meshStandardMaterial color={c} roughness={i === 3 ? 0.3 : 0.6} metalness={i === 3 ? 0.6 : 0} />
          </mesh>
        ))}
      </group>
    </group>
  )
}
