import { pinsOf, rotate } from '../../../data/components'
import type { Comp } from '../../../data/types'
import { useStore } from '../../../store/useStore'
import { Label, Rod, levelColor, pinHandlers } from '../shared'

/** height of the binding posts where wires attach */
export const TERMINAL_Y = 0.9
const FLAT: [number, number, number] = [-Math.PI / 2, 0, 0]

function Terminals({ comp }: { comp: Comp }) {
  return pinsOf(comp).map((p) => {
    // back to the part's local frame, which is rotated by the parent group
    const [lx, lz] = rotate(p.x - comp.x, p.z - comp.z, -comp.rot)
    const color = p.name === '+' ? '#c62828' : '#1c1e22'
    return (
      <group key={p.name} position={[lx, 0, lz]}>
        <mesh position={[0, TERMINAL_Y - 0.75, 0]} castShadow {...pinHandlers(comp.id, p.name, p.strip)}>
          <cylinderGeometry args={[0.5, 0.6, 1.5, 20]} />
          <meshStandardMaterial color={color} roughness={0.4} />
        </mesh>
        <mesh position={[0, TERMINAL_Y + 0.02, 0]} raycast={() => null}>
          <cylinderGeometry args={[0.28, 0.28, 0.1, 16]} />
          <meshStandardMaterial color="#d9b64a" metalness={0.9} roughness={0.3} />
        </mesh>
        <Label size={0.9} color={p.name === '+' ? '#ff8080' : '#b9c4d4'} position={[1.1, TERMINAL_Y - 0.5, 0]} rotation={FLAT}>{p.name === '+' ? '+' : '-'}</Label>
      </group>
    )
  })
}

export function Supply({ comp }: { comp: Comp }) {
  const running = useStore((s) => s.running)
  const amps = useStore((s) => s.sim?.supplyCurrent ?? 0)
  return (
    <group>
      <mesh position={[0, -0.2, 0]} castShadow receiveShadow>
        <boxGeometry args={[7.6, 3.6, 8]} /><meshStandardMaterial color="#3a424e" roughness={0.6} />
      </mesh>
      <mesh position={[-0.2, 1.61, -1]} raycast={() => null}>
        <boxGeometry args={[6.4, 0.04, 4.6]} /><meshStandardMaterial color="#0b0f14" roughness={0.3} />
      </mesh>
      <Label size={1.35} color={running ? '#ff5a4a' : '#6d2f2a'} position={[-0.2, 1.65, -1.9]} rotation={FLAT}>{`${(comp.props.volts ?? 5).toFixed(2)} V`}</Label>
      <Label size={0.75} color={running ? '#4ade80' : '#2c5a3c'} position={[-0.2, 1.65, 0]} rotation={FLAT}>{`${(amps * 1000).toFixed(1)} mA`}</Label>
      <Label size={0.5} color="#aab4c3" position={[0, 1.62, 2.4]} rotation={FLAT}>DC SUPPLY</Label>
      <mesh position={[3.9, 0.1, 0]} raycast={() => null}>
        <boxGeometry args={[1.4, 0.5, 5]} /><meshStandardMaterial color="#2b313a" />
      </mesh>
      <Terminals comp={comp} />
    </group>
  )
}

export function Battery({ comp }: { comp: Comp }) {
  return (
    <group>
      <mesh position={[0, -0.9, 0]} castShadow receiveShadow>
        <boxGeometry args={[7.4, 2.2, 5]} /><meshStandardMaterial color="#22262d" roughness={0.6} />
      </mesh>
      {[-1.2, 1.2].map((z) => (
        <group key={z} position={[-0.1, 0.1, z]} rotation={[0, 0, Math.PI / 2]}>
          <mesh castShadow><cylinderGeometry args={[1, 1, 6, 24]} /><meshStandardMaterial color="#2c5d3f" roughness={0.4} /></mesh>
          <mesh position={[0, -2.4, 0]}><cylinderGeometry args={[1.01, 1.01, 1.2, 24]} /><meshStandardMaterial color="#c58a33" roughness={0.35} metalness={0.5} /></mesh>
        </group>
      ))}
      <Label size={0.9} color="#fff" position={[-0.4, 1.2, 0]} rotation={FLAT}>{`${comp.props.volts} V`}</Label>
      <mesh position={[3.9, -0.4, 0]} raycast={() => null}><boxGeometry args={[1.2, 0.5, 4]} /><meshStandardMaterial color="#2b313a" /></mesh>
      <Terminals comp={comp} />
    </group>
  )
}

export function Gnd({ comp }: { comp: Comp }) {
  const level = useStore((s) => s.sim?.comps[comp.id]?.pins.GND.level ?? null)
  return (
    <group>
      <Rod a={[0, -0.2, 0]} b={[0, 1, 0]} />
      <mesh position={[0, 1.2, 0]} castShadow {...pinHandlers(comp.id, 'GND')}>
        <cylinderGeometry args={[0.42, 0.42, 0.7, 20]} /><meshStandardMaterial color="#16181c" roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.56, 0]} rotation={FLAT} raycast={() => null}>
        <ringGeometry args={[0.3, 0.4, 24]} /><meshBasicMaterial color={level === null ? '#6b7280' : levelColor(level)} />
      </mesh>
      {[0.22, 0.14, 0.06].map((w, i) => (
        <mesh key={i} position={[0, 1.57, -0.06 + i * 0.1]} raycast={() => null}>
          <boxGeometry args={[w * 2, 0.01, 0.04]} /><meshBasicMaterial color="#e5e7eb" />
        </mesh>
      ))}
    </group>
  )
}
