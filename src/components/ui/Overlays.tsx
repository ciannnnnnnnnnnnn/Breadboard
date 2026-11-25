import { useEffect, useRef, useState } from 'react'
import { HOLE_BY_ID, describeStrip } from '../../data/breadboard'
import { compTitle, pinDescription } from '../../data/components'
import { ICS } from '../../data/ics'
import type { Level } from '../../data/types'
import { fmtMA, fmtV } from '../../simulation/simulate'
import { useStore } from '../../store/useStore'
import { ICDiagram } from './ICDiagram'

const levelName = (l: Level) => (l === 1 ? '1 (HIGH)' : l === 0 ? '0 (LOW)' : 'Z (floating / unknown)')

export function Tooltip() {
  const { hover, circuit, sim, netlist, placing } = useStore()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const x = Math.min(e.clientX + 16, window.innerWidth - r.width - 8)
      const y = e.clientY + 18 + r.height > window.innerHeight ? e.clientY - r.height - 14 : e.clientY + 18
      el.style.transform = `translate(${x}px, ${Math.max(4, y)}px)`
    }
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [])

  let title = ''
  const lines: string[] = []
  let body: React.ReactNode = null
  if (hover && !placing) {
    if (hover.kind === 'hole') {
      const h = HOLE_BY_ID.get(hover.hole)!
      title = `Hole ${h.id}`
      lines.push(describeStrip(h.strip))
      const n = netlist.netOf.get(h.strip)
      if (sim) lines.push(n === undefined ? 'Z (nothing connected)' : `${levelName(sim.netLevel[n])} · ${fmtV(sim.netV[n])}`)
    } else if (hover.kind === 'wire') {
      const w = sim?.wires[hover.id]
      if (w) { title = 'Wire'; lines.push(`${levelName(w.level)} · ${fmtV(w.v)}`, fmtMA(w.current)) }
    } else {
      const c = circuit.components.find((q) => q.id === hover.compId)
      if (c && hover.kind === 'pin') {
        title = compTitle(c)
        lines.push(pinDescription(c, hover.pin))
        const st = sim?.comps[c.id]?.pins[hover.pin]
        if (st) lines.push(`${levelName(st.level)} · ${fmtV(st.v)}`)
      } else if (c && c.type === 'ic') {
        title = compTitle(c)
        const def = ICS[c.props.part!]
        body = <ICDiagram def={def} pins={sim?.comps[c.id]?.pins} gateOut={sim ? def.gates.map((_, i) => sim.gateOut[`${c.id}:${i}`]) : undefined} className="mt-1 w-72" />
      } else if (c) {
        title = compTitle(c)
        const i = sim?.comps[c.id]?.current
        if (i !== undefined) lines.push(fmtMA(i))
      }
    }
  }
  return (
    <div ref={ref} data-testid="tooltip" className={`pointer-events-none fixed top-0 left-0 z-50 rounded-md border border-slate-700 bg-slate-950/95 px-2.5 py-1.5 text-xs text-slate-200 shadow-xl ${title ? '' : 'invisible'}`}>
      <div className="font-semibold">{title}</div>
      {lines.map((l, i) => <div key={i} className="text-slate-400">{l}</div>)}
      {body}
    </div>
  )
}

export function Toast() {
  const toast = useStore((s) => s.toast)
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!toast) return
    setShow(true)
    const t = setTimeout(() => setShow(false), 2800)
    return () => clearTimeout(t)
  }, [toast])
  return (
    <div role="status" className={`pointer-events-none absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-md bg-slate-800 px-3 py-1.5 text-xs text-slate-100 shadow-lg transition-opacity ${show ? 'opacity-100' : 'opacity-0'}`}>
      {toast?.msg}
    </div>
  )
}

export function StatusHint() {
  const { running, placing, wireStart, sim } = useStore()
  const text = placing ? 'Click the board to place. R rotates, Esc cancels'
    : wireStart ? `Wire from ${wireStart.from[0] === '@' ? 'terminal' : wireStart.from}: click a hole to finish, Shift+click adds a bend, Esc cancels`
    : running ? `Running · supply ${fmtMA(sim?.supplyCurrent ?? 0)} · 1 = green, 0 = dark, floating = grey dashes`
    : 'Stopped'
  return <div className="pointer-events-none absolute right-3 bottom-3 z-30 rounded bg-slate-950/75 px-2 py-1 text-[11px] text-slate-300" data-testid="status">{text}</div>
}
