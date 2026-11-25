import { useEffect, useState } from 'react'
import { LED_COLORS, LED_MAX_MA, RESISTOR_PRESETS, TYPES, compTitle, formatOhms } from '../../data/components'
import { ICS } from '../../data/ics'
import type { Comp, Wire } from '../../data/types'
import { fmtMA, fmtV } from '../../simulation/simulate'
import { truthTable } from '../../simulation/logic'
import { useStore } from '../../store/useStore'
import { problemCenter } from '../../simulation/diagnose'
import { useDiagnosis } from '../../store/problems'
import { ICDiagram } from './ICDiagram'
import { Swatches } from './Palette'
import { Switch } from './Toolbar'

/** problems that involve the selected part or wire */
function ItsProblems({ id }: { id: string }) {
  const { problems } = useDiagnosis()
  const s = useStore()
  return problems.filter((p) => p.comps.includes(id) || p.wires.includes(id)).map((p) => (
    <button key={p.key} onClick={() => s.setActiveProblem(p.key, problemCenter(p, s.circuit))} className={`block w-full rounded-md border p-2 text-left text-xs ${p.severity === 'error' ? 'border-rose-500/60 bg-rose-950/60 text-rose-100' : 'border-amber-500/50 bg-amber-950/50 text-amber-100'}`}>
      ⚠ {p.title}
      <span className="mt-1 block text-emerald-300">Fix: {p.fix[0]}</span>
    </button>
  ))
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex items-center justify-between gap-2 text-xs text-slate-400"><span>{label}</span>{children}</label>
}
/** number box that commits on Enter / blur and rejects values out of range */
function Num({ value, set, min, max, step, unit }: { value: number; set: (v: number) => void; min: number; max: number; step?: number; unit?: string }) {
  const [t, setT] = useState(String(value))
  useEffect(() => setT(String(value)), [value])
  const commit = () => {
    const v = Number(t)
    if (t.trim() !== '' && Number.isFinite(v)) {
      const c = Math.min(max, Math.max(min, v))
      if (c !== value) set(c)
      setT(String(c))
    } else setT(String(value))
  }
  return (
    <span className="flex items-center gap-1">
      <input type="number" className="field w-24 text-right" value={t} min={min} max={max} step={step ?? 'any'} onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      {unit && <span className="w-4 text-slate-500">{unit}</span>}
    </span>
  )
}
const Stat = ({ k, v, c = 'text-slate-200' }: { k: string; v: string; c?: string }) => (
  <div className="flex justify-between text-xs"><span className="text-slate-400">{k}</span><span className={`font-mono ${c}`}>{v}</span></div>
)

function TruthTable({ comp }: { comp: Comp }) {
  const def = ICS[comp.props.part!]
  const st = useStore((s) => s.sim?.comps[comp.id])
  const [g, setG] = useState(0)
  useEffect(() => setG(0), [comp.id, def.part])
  const gate = def.gates[Math.min(g, def.gates.length - 1)]
  const lv = gate.inputs.map((p) => st?.pins[String(p)]?.level)
  const rows = truthTable(def.gateType)
  const powered = st?.powered
  const active = powered ? rows.findIndex((r) => r.inputs.every((v, i) => v === lv[i])) : -1
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <h4 className="text-[11px] font-semibold text-slate-400">{def.gateType} truth table</h4>
        <div className="flex gap-0.5" role="tablist" aria-label="Gate">
          {def.gates.map((_, i) => (
            <button key={i} role="tab" aria-selected={i === g} onClick={() => setG(i)} className={`h-5 w-5 rounded text-[10px] ${i === g ? 'bg-sky-600 text-white' : 'bg-slate-800 text-slate-400'}`}>{i + 1}</button>
          ))}
        </div>
      </div>
      <table className="w-full text-center font-mono text-xs" data-testid="truth-table">
        <thead>
          <tr className="text-slate-400">
            {gate.inputs.map((p, i) => <th key={p} className="border-b border-slate-700 py-1 font-normal">{'ABCD'[i]} <span className="text-[10px] text-slate-500">pin {p}</span></th>)}
            <th className="border-b border-slate-700 py-1 font-normal">X <span className="text-[10px] text-slate-500">pin {gate.output}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} data-active={i === active} className={i === active ? 'bg-emerald-500/25 text-emerald-200' : 'text-slate-300'}>
              {r.inputs.map((v, k) => <td key={k} className="py-0.5">{v}</td>)}
              <td className="py-0.5">{r.output}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {st && active < 0 && <p className="mt-1 text-[11px] text-amber-300">{powered ? 'An input of this gate is floating, so no row is active.' : 'Chip is not powered.'}</p>}
    </div>
  )
}

function CompProps({ comp }: { comp: Comp }) {
  const s = useStore()
  const p = comp.props
  const st = s.sim?.comps[comp.id]
  const up = (x: typeof p) => s.updateProps(comp.id, x)
  const span = (min: number, max: number) => (
    <Row label="Lead span"><Num value={p.span!} min={min} max={max} step={1} unit="" set={(v) => up({ span: Math.round(v) })} /></Row>
  )
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-slate-100">{compTitle(comp)}</h2>
        <p className="text-[11px] text-slate-500">{TYPES[comp.type].name}</p>
      </div>
      <ItsProblems id={comp.id} />
      <Row label="Label">
        <input className="field w-32" value={p.label ?? ''} placeholder="none" onChange={(e) => s.updateProps(comp.id, { label: e.target.value || undefined }, false)} />
      </Row>
      {(comp.type === 'supply' || comp.type === 'battery') && (
        <>
          <Row label="Voltage"><Num value={p.volts!} min={0} max={30} step={0.1} unit="V" set={(v) => up({ volts: v })} /></Row>
          <input type="range" aria-label="Voltage" className="w-full accent-emerald-500" min={0} max={12} step={0.1} value={p.volts} onChange={(e) => s.updateProps(comp.id, { volts: Number(e.target.value) }, false)} />
          <p className="text-[11px] text-slate-500">Logic ICs need 3–7 V. Use 5 V for 74-series parts.</p>
        </>
      )}
      {comp.type === 'resistor' && (
        <>
          <div className="flex flex-wrap gap-1">
            {RESISTOR_PRESETS.map((r) => (
              <button key={r} onClick={() => up({ ohms: r })} aria-pressed={p.ohms === r} className={`btn ${p.ohms === r ? 'border-sky-500 text-sky-300' : ''}`}>{formatOhms(r)}</button>
            ))}
          </div>
          <Row label="Custom"><Num value={p.ohms!} min={0.1} max={10e6} unit="Ω" set={(v) => up({ ohms: v })} /></Row>
          {span(2, 12)}
          {st?.resistor && (
            <div className="space-y-1 rounded-md bg-slate-950/60 p-2">
              <Stat k="V in" v={fmtV(st.resistor.vin)} /><Stat k="V out" v={fmtV(st.resistor.vout)} /><Stat k="V drop" v={fmtV(st.resistor.vr)} />
              <Stat k="Current" v={fmtMA(st.resistor.i)} c="text-emerald-300" />
              <Stat k="Power" v={`${(st.resistor.i * st.resistor.vr * 1000).toFixed(1)} mW`} />
              {st.resistor.i > 0 && <Stat k="Without resistor" v={Number.isFinite(st.resistor.iNo) ? fmtMA(st.resistor.iNo) : '∞ short'} c="text-rose-300" />}
              <p className="pt-1 text-[11px] text-slate-500">The current is the same on both sides. The resistor drops voltage and limits how much current flows.</p>
            </div>
          )}
        </>
      )}
      {comp.type === 'led' && (
        <>
          <div className="flex flex-wrap gap-1">
            {Object.entries(LED_COLORS).map(([n, c]) => (
              <button key={n} title={n} aria-label={`${n} LED`} aria-pressed={p.color === n} onClick={() => up({ color: n, vf: c.vf })} style={{ background: c.hex }} className={`h-6 w-6 rounded-full border-2 ${p.color === n ? 'border-white' : 'border-slate-700'}`} />
            ))}
          </div>
          <Row label="Forward voltage"><Num value={p.vf!} min={0.5} max={5} step={0.1} unit="V" set={(v) => up({ vf: v })} /></Row>
          {span(1, 6)}
          {st && (
            <div className="space-y-1 rounded-md bg-slate-950/60 p-2">
              {s.burned[comp.id] !== undefined
                ? <p className="text-xs text-rose-300">Burned out at {fmtMA(s.burned[comp.id])}. Stop the simulation to replace it.</p>
                : <Stat k="Current" v={`${fmtMA(st.current ?? 0)} / ${LED_MAX_MA} mA`} c="text-emerald-300" />}
            </div>
          )}
        </>
      )}
      {(comp.type === 'toggle' || comp.type === 'input') && <Switch label={p.on ? 'Set to 1' : 'Set to 0'} on={!!p.on} set={() => s.toggleInput(comp.id)} />}
      {comp.type === 'dip4' && p.switches!.map((_, i) => <Switch key={i} label={p.names?.[i] ?? `Switch ${i + 1}`} on={!!p.switches?.[i]} set={() => s.toggleInput(comp.id, i)} />)}
      {comp.type === 'button' && <p className="text-[11px] text-slate-500">Press and hold it on the board while the simulation runs.</p>}
      {comp.type === 'ic' && (
        <>
          <Row label="Type">
            <select className="field w-36" value={p.part} disabled={s.running} onChange={(e) => up({ part: e.target.value })}>
              {Object.values(ICS).map((d) => <option key={d.part} value={d.part}>{d.part} {d.name}</option>)}
            </select>
          </Row>
          <Switch label="Show internals on this chip" on={p.internals ?? s.settings.internals} set={(v) => up({ internals: v })} />
          <ICDiagram def={ICS[p.part!]} pins={st?.pins} gateOut={s.sim ? ICS[p.part!].gates.map((_, i) => s.sim!.gateOut[`${comp.id}:${i}`]) : undefined} className="w-full rounded-md bg-slate-950/60" />
          <TruthTable comp={comp} />
        </>
      )}
      {comp.type !== 'ic' && st && (
        <div className="space-y-1 rounded-md bg-slate-950/60 p-2">
          {Object.entries(st.pins).map(([n, q]) => <Stat key={n} k={`Pin ${n}`} v={`${q.level} · ${fmtV(q.v)}`} c={q.level === 1 ? 'text-emerald-300' : q.level === 0 ? 'text-slate-300' : 'text-slate-500'} />)}
        </div>
      )}
      <div className="flex gap-1">
        <button className="btn flex-1" disabled={s.running} onClick={s.rotateSelected}>Rotate (R)</button>
        <button className="btn flex-1 text-rose-300" disabled={s.running} onClick={s.deleteSelected}>Delete</button>
      </div>
    </div>
  )
}

function WireProps({ wire }: { wire: Wire }) {
  const s = useStore()
  const st = s.sim?.wires[wire.id]
  const end = (e: string) => {
    if (e[0] !== '@') return e
    const [id, pin] = e.slice(1).split('.')
    const c = s.circuit.components.find((q) => q.id === id)
    return `${c ? compTitle(c) : '?'} ${pin}`
  }
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-slate-100">Wire</h2>
      <ItsProblems id={wire.id} />
      <p className="text-xs text-slate-400">{end(wire.from)} → {end(wire.to)}</p>
      <Swatches value={wire.color} set={(color) => s.updateWire(wire.id, { color })} />
      {st && (
        <div className="space-y-1 rounded-md bg-slate-950/60 p-2">
          <Stat k="Level" v={String(st.level)} c={st.level === 1 ? 'text-emerald-300' : 'text-slate-300'} /><Stat k="Voltage" v={fmtV(st.v)} /><Stat k="Current" v={fmtMA(st.current)} />
        </div>
      )}
      {wire.bends.length > 0 && <button className="btn w-full" disabled={s.running} onClick={() => s.updateWire(wire.id, { bends: [] })}>Remove bends</button>}
      {!s.running && <p className="text-[11px] text-slate-500">Drag the blue handles to move an end to another hole.</p>}
      <button className="btn w-full text-rose-300" disabled={s.running} onClick={s.deleteSelected}>Delete</button>
    </div>
  )
}

export function Properties() {
  const sel = useStore((s) => s.selection)
  const circuit = useStore((s) => s.circuit)
  const comp = sel?.kind === 'comp' ? circuit.components.find((c) => c.id === sel.id) : undefined
  const wire = sel?.kind === 'wire' ? circuit.wires.find((w) => w.id === sel.id) : undefined
  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-900 p-3" aria-label="Properties">
      {comp ? <CompProps key={comp.id} comp={comp} /> : wire ? <WireProps wire={wire} /> : (
        <div className="space-y-3 text-xs leading-relaxed text-slate-400">
          <h2 className="text-sm font-semibold text-slate-100">Nothing selected</h2>
          <p>Drag a part from the left onto the board. Click a hole to start a wire and another to finish it.</p>
          <ul className="space-y-1.5">
            {[['Shift + click', 'add a bend to the wire'], ['R', 'rotate'], ['Delete', 'remove'], ['Esc', 'cancel'], ['Ctrl+Z / Ctrl+Y', 'undo / redo'], ['Space', 'start / stop'], ['Drag', 'orbit (right-drag pans)']].map(([k, v]) => (
              <li key={k} className="flex justify-between gap-2"><kbd className="rounded bg-slate-800 px-1.5 text-slate-200">{k}</kbd><span className="text-right">{v}</span></li>
            ))}
          </ul>
          <p>While the simulation runs, click switches and logic inputs on the board to change them.</p>
        </div>
      )}
    </aside>
  )
}
