import { Html, Line } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useState } from 'react'
import * as THREE from 'three'
import { LED_MAX_MA, formatOhms, pinsOf } from '../../data/components'
import type { Comp } from '../../data/types'
import { fmtMA, fmtV } from '../../simulation/simulate'
import { useStore } from '../../store/useStore'

/** up close the label floats above its resistor; from afar it sits beside the board on a leader */
const NEAR = 30
const SLOT = 8.5

function ResistorLabel({ comp, at, parked, crowded }: { comp: Comp; at: THREE.Vector3; parked: THREE.Vector3 | null; crowded: boolean }) {
  const r = useStore((s) => s.sim?.comps[comp.id]?.resistor)
  const selected = useStore((s) => s.selection?.kind === 'comp' && s.selection.id === comp.id)
  const [near, setNear] = useState(false)
  useFrame(({ camera }) => {
    const n = camera.position.distanceTo(at) < NEAR
    if (n !== near) setNear(n)
  })
  if (!r) return null
  // no room beside this board: from afar show just the current, when there is any
  // (the same goes for neighbours packed closer than a label is wide, unless selected)
  if ((!near && !parked) || (crowded && !selected)) {
    return r.i < 1e-6 ? null : (
      <Html position={at} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
        <div data-testid="resistor-label" className="rounded bg-slate-950/85 px-1 font-mono text-[9px] whitespace-nowrap text-emerald-300">{fmtMA(r.i)}</div>
      </Html>
    )
  }
  const row = 'flex justify-between gap-2'
  const hot = r.iNo * 1000 > LED_MAX_MA
  return (
    <>
      {!near && parked && <Line points={[at, parked]} color="#f5c86a" lineWidth={1.2} transparent opacity={0.55} raycast={() => null} />}
      <Html key={String(near)} position={near || !parked ? at : parked} zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <div
          data-testid="resistor-label" style={{ transform: near ? 'translate(-50%, calc(-100% - 14px))' : 'translate(-50%, -10%)' }}
          className="w-max rounded-md border border-slate-600/70 bg-slate-950/85 px-1.5 py-1 font-mono text-[9px] leading-[12px] whitespace-nowrap text-slate-200 shadow-lg"
        >
          <div className="font-semibold text-amber-300">{formatOhms(comp.props.ohms!)}</div>
          <div className={row}><span className="text-slate-400">V_in</span><span>{fmtV(r.vin)}</span></div>
          <div className={row}><span className="text-slate-400">V_out</span><span>{fmtV(r.vout)}</span></div>
          <div className={row}><span className="text-slate-400">V_R drop</span><span>{fmtV(r.vr)}</span></div>
          <div className={row + ' text-emerald-300'}><span>I</span><span>{fmtMA(r.i)}</span></div>
          {r.i > 0 && (
            <div className={hot ? 'text-rose-300' : 'text-slate-400'}>
              <div>Without resistor:</div>
              <div className="text-right">{Number.isFinite(r.iNo) ? fmtMA(r.iNo) : '∞ short'}{hot ? ' ⚠' : ''}</div>
            </div>
          )}
        </div>
      </Html>
    </>
  )
}

export function ResistorLabels() {
  const components = useStore((s) => s.circuit.components)
  const boards = useStore((s) => s.circuit.boards ?? 1)
  const show = useStore((s) => s.running && s.settings.labels)
  const list = useMemo(() => {
    const mid = components.filter((c) => c.type === 'resistor').map((c) => { const [a, b] = pinsOf(c); return [(a.x + b.x) / 2, (a.z + b.z) / 2] })
    const taken: { x: number; side: number; slot: number }[] = []
    return components
      .filter((c) => c.type === 'resistor')
      .map((comp) => {
        const [a, b] = pinsOf(comp)
        return { comp, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
      })
      .sort((p, q) => p.x - q.x)
      .map(({ comp, x, z }) => {
        const side = z >= 0 ? 1 : -1
        let slot = 0
        while (taken.some((t) => t.side === side && t.slot === slot && Math.abs(t.x - x) < 6.5)) slot++
        taken.push({ x, side, slot })
        // beyond the board edge; further rows when neighbours are close
        const pz = side > 0 ? 11.5 + slot * SLOT : -17 - slot * SLOT
        return { comp, at: new THREE.Vector3(x, 0.9, z), parked: boards === 1 ? new THREE.Vector3(x, 0, pz) : null, crowded: mid.filter((q) => Math.abs(q[0] - x) < 3 && Math.abs(q[1] - z) < 4).length > 1 }
      })
  }, [components, boards])
  return show ? list.map((l) => <ResistorLabel key={l.comp.id} {...l} />) : null
}
