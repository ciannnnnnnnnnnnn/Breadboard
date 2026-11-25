import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { BOARD, BOARD_PITCH, COLS, HOLES as ALL_HOLES, HOLES_BY_STRIP, HOLE_BY_ID, ROW_Z, ROWS_BOTTOM, ROWS_TOP, colX } from '../../data/breadboard'
import { occupiedHoles } from '../../data/components'
import { useStore } from '../../store/useStore'
import { FLOAT, HIGH, LOW } from './shared'

/** printed markings: rail stripes, row letters, column numbers */
function makeTexture() {
  const S = 62
  const c = document.createElement('canvas')
  c.width = BOARD.width * S
  c.height = BOARD.depth * S
  const g = c.getContext('2d')!
  const X = (x: number) => (x + BOARD.width / 2) * S
  const Y = (z: number) => (z + BOARD.depth / 2) * S
  g.fillStyle = '#d9d8d2'
  g.fillRect(0, 0, c.width, c.height)
  // centre channel and the grooves that separate the rails
  g.fillStyle = '#aaa9a3'
  g.fillRect(0, Y(-0.55), c.width, 1.1 * S)
  g.fillStyle = '#8f8e89'
  g.fillRect(0, Y(-0.55), c.width, 0.12 * S)
  g.fillStyle = '#bcbbb5'
  for (const z of [-6.6, 6.6]) g.fillRect(0, Y(z) - 3, c.width, 6)
  const line = (z: number, color: string) => {
    g.fillStyle = color
    g.fillRect(X(colX(1) - 0.6), Y(z) - 4, (COLS + 0.2) * S, 8)
  }
  line(-9.2, '#cf2f2f'); line(-6.95, '#2b55c9'); line(6.95, '#cf2f2f'); line(9.2, '#2b55c9')
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = `600 ${0.62 * S}px "JetBrains Mono", monospace`
  g.fillStyle = '#5d5f63'
  for (const r of [...ROWS_TOP, ...ROWS_BOTTOM]) for (const x of [-32.3, 32.3]) g.fillText(r, X(x), Y(ROW_Z[r]))
  g.font = `700 ${0.9 * S}px "JetBrains Mono", monospace`
  for (const x of [-32.3, 32.3]) {
    g.fillStyle = '#cf2f2f'
    g.fillText('+', X(x), Y(ROW_Z.tp)); g.fillText('+', X(x), Y(ROW_Z.bp))
    g.fillStyle = '#2b55c9'
    g.fillText('−', X(x), Y(ROW_Z.tn)); g.fillText('−', X(x), Y(ROW_Z.bn))
  }
  g.font = `600 ${0.5 * S}px "JetBrains Mono", monospace`
  g.fillStyle = '#5d5f63'
  for (let i = 1; i <= COLS; i++) if (i === 1 || i % 5 === 0) for (const z of [-6.15, 6.15]) g.fillText(String(i), X(colX(i)), Y(z))
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 16
  return t
}

const m = new THREE.Matrix4()
const HIGH_BAR = HIGH.clone().multiplyScalar(0.55)
const HOLE_COLOR = new THREE.Color('#26272a')

let texture: THREE.Texture | null = null

export function Breadboard({ board }: { board: number }) {
  const tex = (texture ??= makeTexture())
  const { HOLES, STRIPS } = useMemo(() => {
    const HOLES = ALL_HOLES.filter((h) => h.board === board)
    return { HOLES, STRIPS: [...new Set(HOLES.map((h) => h.strip))] }
  }, [board])
  const holes = useRef<THREE.InstancedMesh>(null!)
  const rims = useRef<THREE.InstancedMesh>(null!)
  const bars = useRef<THREE.InstancedMesh>(null!)
  const sim = useStore((s) => s.sim)
  const netlist = useStore((s) => s.netlist)
  const circuit = useStore((s) => s.circuit)
  const hover = useStore((s) => s.hover)
  const wireStart = useStore((s) => s.wireStart)

  useLayoutEffect(() => {
    HOLES.forEach((h, i) => {
      holes.current.setMatrixAt(i, m.makeTranslation(h.x, 0.012, h.z))
      rims.current.setMatrixAt(i, m.makeTranslation(h.x, 0.006, h.z))
    })
    holes.current.instanceMatrix.needsUpdate = true
    rims.current.instanceMatrix.needsUpdate = true
  }, [HOLES])

  // logic state: holes of every used strip take the level colour, HIGH strips get a glowing bar
  useLayoutEffect(() => {
    const occ = occupiedHoles(circuit)
    const hoverStrip = hover?.kind === 'hole' ? HOLE_BY_ID.get(hover.hole)?.strip : undefined
    const startStrip = wireStart && HOLE_BY_ID.get(wireStart.from)?.strip
    const level = (strip: string) => {
      const n = netlist.netOf.get(strip)
      return sim && n !== undefined ? sim.netLevel[n] : null
    }
    const color = new THREE.Color()
    HOLES.forEach((h, i) => {
      const l = level(h.strip)
      color.copy(l === 1 ? HIGH : l === 0 ? LOW : l === 'Z' && occ.has(h.id) ? FLOAT : HOLE_COLOR)
      if (h.strip === hoverStrip) color.set('#e0912a')
      else if (h.strip === startStrip) color.set('#3aa0ff')
      if (hover?.kind === 'hole' && hover.hole === h.id) color.set('#ffcf6b')
      holes.current.setColorAt(i, color)
    })
    holes.current.instanceColor!.needsUpdate = true
    STRIPS.forEach((s, i) => {
      const l = level(s)
      const hs = HOLES_BY_STRIP.get(s)!
      const a = hs[0], b = hs[hs.length - 1]
      const show = l === 1 || l === 0 || s === hoverStrip
      const rail = a.z === b.z
      m.makeScale(show ? (rail ? b.x - a.x + 0.8 : 0.16) : 0, 1, show ? (rail ? 0.16 : b.z - a.z + 0.8) : 0)
      m.setPosition((a.x + b.x) / 2, 0.004, (a.z + b.z) / 2)
      bars.current.setMatrixAt(i, m)
      bars.current.setColorAt(i, s === hoverStrip ? color.set('#e0912a') : l === 1 ? HIGH_BAR : LOW)
    })
    bars.current.instanceMatrix.needsUpdate = true
    bars.current.instanceColor!.needsUpdate = true
  }, [sim, netlist, circuit, hover, wireStart, HOLES, STRIPS])

  return (
    <group>
      <mesh position={[0, -BOARD.height / 2, board * BOARD_PITCH]} receiveShadow castShadow raycast={() => null}>
        <boxGeometry args={[BOARD.width, BOARD.height - 0.02, BOARD.depth]} />
        {[0, 1, 2, 3, 4, 5].map((i) =>
          i === 2
            ? <meshStandardMaterial key={i} attach={`material-${i}`} map={tex} roughness={0.75} />
            : <meshStandardMaterial key={i} attach={`material-${i}`} color="#c4c3bd" roughness={0.8} />,
        )}
      </mesh>
      <instancedMesh ref={rims} args={[undefined, undefined, HOLES.length]} raycast={() => null} frustumCulled={false}>
        <boxGeometry args={[0.58, 0.004, 0.58]} />
        <meshStandardMaterial color="#b9b8b1" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={bars} args={[undefined, undefined, STRIPS.length]} raycast={() => null} frustumCulled={false}>
        <boxGeometry args={[1, 0.012, 1]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={holes} args={[undefined, undefined, HOLES.length]} raycast={() => null} frustumCulled={false}>
        <boxGeometry args={[0.38, 0.008, 0.38]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  )
}
