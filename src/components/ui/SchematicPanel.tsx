import { useMemo, useState } from 'react'
import { gateSymbol, type Pt } from '../../data/gateGeometry'
import { LED_COLORS } from '../../data/components'
import type { Level } from '../../data/types'
import { fmtMA } from '../../simulation/simulate'
import { useStore } from '../../store/useStore'
import { PROBLEM_COLOR, useDiagnosis } from '../../store/problems'
import { svgLevel } from './ICDiagram'
import { GATE_SCALE, layoutSchematic, type Elem } from './schematicLayout'

const path = (pts: Pt[], cx: number, cy: number) => 'M' + pts.map(([x, y]) => `${cx + x * GATE_SCALE} ${cy - y * GATE_SCALE}`).join('L')
const wireProps = (l: Level | null) => ({
  fill: 'none', stroke: svgLevel(l), strokeWidth: l === 1 ? 2.2 : 1.6,
  strokeDasharray: l === 'Z' ? '4 3' : undefined,
  style: l === 1 ? { filter: 'drop-shadow(0 0 3px #2bff88)' } : undefined,
})

function Symbol({ e, lv }: { e: Elem; lv: (strip: string) => Level | null }) {
  const sim = useStore((s) => s.sim)
  const burned = useStore((s) => s.burned[e.comp.id] !== undefined)
  const ink = '#cbd5e1'
  const n = (i: number) => lv(e.ports[i].strip)
  switch (e.kind) {
    case 'gate': {
      const s = gateSymbol(e.gate!)
      const o: Level | null = sim ? (sim.gateOut[`${e.comp.id}:${e.gateIndex}`] ?? 'Z') : null
      const cx = 35, cy = 22
      return (
        <>
          {s.inputs.map((p, i) => <path key={i} d={`M0 ${cy - p[1] * GATE_SCALE}H${cx + p[0] * GATE_SCALE}`} {...wireProps(n(i))} />)}
          <path d={`M${cx + s.output[0] * GATE_SCALE} ${cy}H70`} {...wireProps(o)} />
          {s.body.map((b, i) => <path key={i} d={path(b, cx, cy)} {...wireProps(o)} fill={i === 0 ? '#101a28' : 'none'} />)}
          {s.bubble && <circle cx={cx + s.bubble.c[0] * GATE_SCALE} cy={cy} r={s.bubble.r * GATE_SCALE} {...wireProps(o)} fill="#101a28" />}
          {e.ports.map((p, i) => (
            <text key={p.pin} x={p.side === 'l' ? -3 : 73} y={p.dy - 3} fontSize={8} fill="#fbbf24" textAnchor={p.side === 'l' ? 'end' : 'start'}>{p.pin}</text>
          ))}
        </>
      )
    }
    case 'toggle': {
      const on = e.comp.props.on
      return (
        <>
          <path d="M0 10H14M0 34H14" {...wireProps(null)} stroke={ink} />
          <path d={`M42 22L15 ${on ? 11 : 33}`} {...wireProps(n(2))} />
          <path d="M42 22H56" {...wireProps(n(2))} />
          {[[15, 10], [15, 34], [42, 22]].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r={2.6} fill={ink} />)}
        </>
      )
    }
    case 'contact': {
      const on = e.index !== undefined ? e.comp.props.switches?.[e.index] : e.comp.props.on
      return (
        <>
          <path d="M0 14H16" {...wireProps(n(0))} />
          <path d="M40 14H56" {...wireProps(n(1))} />
          <path d={on ? 'M16 14H40' : 'M16 14L38 3'} stroke={ink} strokeWidth={1.8} fill="none" />
          <circle cx={16} cy={14} r={2.6} fill={ink} /><circle cx={40} cy={14} r={2.6} fill={ink} />
        </>
      )
    }
    case 'input':
      return (
        <>
          <rect x={4} y={2} width={24} height={20} rx={4} fill="#2e2650" stroke={svgLevel(n(0))} />
          <text x={16} y={16} fontSize={12} fill="#fff" textAnchor="middle">{e.comp.props.on ? 1 : 0}</text>
          <path d="M28 12H40" {...wireProps(n(0))} />
        </>
      )
    case 'probe':
      return (
        <>
          <path d="M0 12H8" {...wireProps(n(0))} />
          <circle cx={20} cy={12} r={11} fill="#0d1d22" {...{ stroke: svgLevel(n(0)), strokeWidth: 2 }} />
          <text x={20} y={16} fontSize={12} fill="#fff" textAnchor="middle">{n(0) ?? '?'}</text>
        </>
      )
    case 'resistor':
      return (
        <>
          <path d="M0 13H10" {...wireProps(n(0))} /><path d="M50 13H60" {...wireProps(n(1))} />
          <path d="M10 13l3.3 -7l6.7 14l6.7 -14l6.7 14l6.7 -14l6.7 14l3.2 -7" fill="none" stroke="#e2b96b" strokeWidth={1.8} />
        </>
      )
    case 'led': {
      const i = sim?.comps[e.comp.id]?.current ?? 0
      const c = burned ? '#57534e' : LED_COLORS[e.comp.props.color!].hex
      return (
        <>
          <path d="M0 13H12" {...wireProps(n(0))} /><path d="M32 13H46" {...wireProps(n(1))} />
          <path d="M12 3V23L32 13Z" fill={i > 5e-5 ? c : '#101a28'} stroke={c} strokeWidth={1.6} style={i > 5e-5 ? { filter: `drop-shadow(0 0 6px ${c})` } : undefined} />
          <path d="M32 3V23M30 -1l5 -5M36 3l5 -5" stroke={c} strokeWidth={1.6} fill="none" />
        </>
      )
    }
    case 'supply':
      return (
        <>
          <path d="M50 10H24V22M50 46H24V32" {...wireProps(null)} stroke={ink} />
          <path d="M12 22H36M17 32H31" stroke={ink} strokeWidth={2} />
        </>
      )
  }
}

export function SchematicPanel() {
  const { circuit, sim, selection, select, schematicOpen, setSchematicOpen } = useStore()
  const { problems } = useDiagnosis()
  const activeKey = useStore((s) => s.activeProblem)
  const [zoom, setZoom] = useState(1)
  const sch = useMemo(() => (schematicOpen ? layoutSchematic(circuit) : null), [circuit, schematicOpen])
  // nets differ from the simulator's (switches are drawn open), so look levels up by strip
  const lv = (strip: string): Level | null => (sim ? (sim.netLevel[sim.netlist.netOf.get(strip) ?? -1] ?? 'Z') : null)
  return (
    <section className="flex flex-col border-t border-slate-800 bg-slate-900" aria-label="Schematic">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button className="flex items-center gap-2 text-xs font-semibold text-slate-300 hover:text-white" onClick={() => setSchematicOpen(!schematicOpen)} aria-expanded={schematicOpen}>
          <span className="inline-block w-3">{schematicOpen ? '▾' : '▸'}</span>Schematic
        </button>
        {schematicOpen && (
          <div className="ml-auto flex items-center gap-1 text-xs">
            <button className="btn px-2" aria-label="Zoom out schematic" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}>−</button>
            <span className="w-10 text-center text-slate-400">{Math.round(zoom * 100)}%</span>
            <button className="btn px-2" aria-label="Zoom in schematic" onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}>+</button>
          </div>
        )}
      </div>
      {sch && (
        <div className="h-56 overflow-auto bg-[#0c1220] px-2 pb-2" data-testid="schematic">
          {sch.elems.length === 0 ? <p className="p-4 text-sm text-slate-500">Place some parts to see their schematic.</p> : (
            <svg width={sch.width * zoom} height={(sch.height - sch.minY) * zoom} viewBox={`0 ${sch.minY} ${sch.width} ${sch.height - sch.minY}`} style={{ margin: '0 auto', display: 'block' }}>
              {sch.routes.map((r) => (
                <g key={r.net}>
                  <path d={r.d} {...wireProps(lv(r.strip))} className={lv(r.strip) === 1 ? 'sch-flow' : undefined} />
                  {r.dots.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={3} fill={svgLevel(lv(r.strip))} />)}
                </g>
              ))}
              {sch.elems.map((e) => {
                const sel = selection?.kind === 'comp' && selection.id === e.comp.id
                const i = sim?.comps[e.comp.id]?.current
                // gates are only marked when the problem is about the whole chip or one of their own pins
                const shown = problems.filter((p) => (!problems.some((q) => q.key === activeKey) || p.key === activeKey) && p.comps.includes(e.comp.id)
                  && (e.kind !== 'gate' || p.key.startsWith('power') || !p.pins.some((q) => q.compId === e.comp.id) || p.pins.some((q) => q.compId === e.comp.id && e.ports.some((o) => o.pin === q.pin))))
                const bad = shown[0]
                return (
                  <g key={e.key} transform={`translate(${e.x} ${e.y})`} onClick={() => select({ kind: 'comp', id: e.comp.id })} className="cursor-pointer">
                    <rect x={-4} y={-6} width={e.w + 8} height={e.h + 10} rx={4} fill={sel ? '#1d4ed833' : 'transparent'} stroke={sel ? '#3b82f6' : 'none'} />
                    {bad && <rect x={-5} y={-7} width={e.w + 10} height={e.h + 12} rx={5} fill={PROBLEM_COLOR[bad.severity]} fillOpacity={0.15} stroke={PROBLEM_COLOR[bad.severity]} strokeWidth={2} className="animate-pulse" data-testid="sch-problem"><title>{bad.title}</title></rect>}
                    <Symbol e={e} lv={lv} />
                    <text x={e.w / 2} y={e.h + 10} fontSize={9} fill="#94a3b8" textAnchor="middle">
                      {e.label}{(e.kind === 'resistor' || e.kind === 'led') && i ? ` · ${fmtMA(i)}` : ''}
                    </text>
                    {e.ports.filter((p) => sch.vcc.has(p.net) || sch.gnd.has(p.net)).map((p) => {
                      const s = p.side === 'l' ? -1 : 1
                      const x = p.dx + s * 9
                      return sch.vcc.has(p.net) ? (
                        <g key={p.pin} stroke="#f87171" strokeWidth={1.6} fill="none">
                          <path d={`M${p.dx} ${p.dy}H${x}V${p.dy - 7}M${x - 5} ${p.dy - 7}H${x + 5}`} />
                          <text x={x} y={p.dy - 10} fontSize={8} fill="#f87171" stroke="none" textAnchor="middle">VCC</text>
                        </g>
                      ) : (
                        <path key={p.pin} stroke="#93b4e8" strokeWidth={1.6} fill="none"
                          d={`M${p.dx} ${p.dy}H${x}V${p.dy + 5}M${x - 6} ${p.dy + 5}H${x + 6}M${x - 4} ${p.dy + 8}H${x + 4}M${x - 1.5} ${p.dy + 11}H${x + 1.5}`} />
                      )
                    })}
                  </g>
                )
              })}
            </svg>
          )}
        </div>
      )}
    </section>
  )
}
