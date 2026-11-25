/**
 * Full simulation: netlist → (analog solve ⇄ gate evaluation) until stable →
 * currents, levels and warnings. Gate inputs read real node voltages, so
 * pull-up / pull-down resistors behave as they would on the bench.
 */
import { compTitle, IC_MAX_MA, LED_MAX_MA } from '../data/components'
import { ICS } from '../data/ics'
import type { Circuit, Comp, Level } from '../data/types'
import { currentWithoutResistor, solveDC, solveLinear, type DCProblem, type DCSolution } from './dc'
import { evalGate } from './logic'
import { buildNetlist, pinNet, type Netlist } from './netlist'

export type Severity = 'error' | 'warning'
export interface Warning { key: string; severity: Severity; msg: string; compId?: string }
export interface PinState { net: number; level: Level; v: number | null }
export interface ResistorState { vin: number | null; vout: number | null; vr: number; i: number; iNo: number; reversed: boolean }
export interface CompState {
  pins: Record<string, PinState>
  powered?: boolean
  current?: number
  resistor?: ResistorState
  warn?: string
}
export interface WireState { level: Level; v: number | null; current: number; dir: 1 | -1 }
export interface SimResult {
  netlist: Netlist
  netV: (number | null)[]
  netLevel: Level[]
  comps: Record<string, CompState>
  wires: Record<string, WireState>
  warnings: Warning[]
  /** "compId:gateIndex" → output; feed back into the next run so latches keep state */
  gateOut: Record<string, Level>
  overLeds: { id: string; current: number }[]
  supplyCurrent: number
  iterations: number
}

export const levelOf = (v: number | null): Level => (v === null ? 'Z' : v >= 2 - 1e-3 ? 1 : v <= 0.8 ? 0 : 'Z')
export const gateKey = (id: string, g: number) => `${id}:${g}`
const MAX_STEPS = 600

export function simulate(circuit: Circuit, prev: Record<string, Level> = {}, burned: Record<string, number> = {}): SimResult {
  const nl = buildNetlist(circuit)
  const warnings: Warning[] = []
  const warn = (key: string, severity: Severity, msg: string, compId?: string) => {
    if (!warnings.some((w) => w.key === key)) warnings.push({ key, severity, msg, compId })
  }
  const net = (c: Comp, pin: string) => pinNet(nl, c.id, pin)
  const strip = (c: Comp, pin: string) => nl.pins.get(c.id)![pin].strip
  const byType = (...t: Comp['type'][]) => circuit.components.filter((c) => t.includes(c.type))

  const supplies = byType('supply', 'battery')
  const grounds = byType('gnd')
  const inputs = byType('input')
  const ics = byType('ic')
  const resistors = byType('resistor')
  const leds = byType('led')

  // ── fixed supply voltages, propagated from the ground reference ──
  const supplyV = new Map<number, number>()
  for (const g of grounds) supplyV.set(net(g, 'GND'), 0)
  const live = supplies.filter((s) => {
    if (net(s, '+') !== net(s, '−')) return true
    if ((s.props.volts ?? 0) > 0) warn(`short:${s.id}`, 'error', `Short circuit: ${compTitle(s)} + is wired directly to −`, s.id)
    return false
  })
  const pending = new Set(live)
  while (pending.size) {
    let s = [...pending].find((q) => supplyV.has(net(q, '+')) || supplyV.has(net(q, '−')))
    if (!s) { s = [...pending][0]; supplyV.set(net(s, '−'), 0) }
    pending.delete(s)
    const p = net(s, '+'), m = net(s, '−'), V = s.props.volts ?? 5
    if (!supplyV.has(m)) supplyV.set(m, supplyV.get(p)! - V)
    else if (!supplyV.has(p)) supplyV.set(p, supplyV.get(m)! + V)
    else if (Math.abs(supplyV.get(p)! - supplyV.get(m)! - V) > 1e-6)
      warn(`short:${s.id}`, 'error', `Short circuit: ${compTitle(s)} is in conflict with another source or ground`, s.id)
  }

  // ── gates ──
  interface G { key: string; ic: Comp; g: number; inNets: number[]; outNet: number; outPin: string }
  const gates: G[] = ics.flatMap((ic) =>
    ICS[ic.props.part!].gates.map((gd, g) => ({
      key: gateKey(ic.id, g), ic, g, outPin: String(gd.output),
      inNets: gd.inputs.map((p) => net(ic, String(p))), outNet: net(ic, String(gd.output)),
    })),
  )
  const out: Record<string, Level> = {}
  for (const g of gates) out[g.key] = prev[g.key] ?? 'Z'
  const locked = new Set<string>()

  const ledBranches = leds.map((l) => ({ a: net(l, 'A'), b: net(l, 'K'), vf: l.props.vf ?? 2, open: burned[l.id] !== undefined }))
  const rBranches = resistors.map((r) => ({ a: net(r, '1'), b: net(r, '2'), r: Math.max(r.props.ohms ?? 330, 0.01) }))
  const problem = (fixed: Map<number, number>): DCProblem => ({ nodes: nl.nets.length, fixed, resistors: rBranches, leds: ledBranches })

  let fixed = new Map(supplyV)
  let sol: DCSolution = solveDC(problem(fixed))
  const rail = (ic: Comp) => {
    const def = ICS[ic.props.part!]
    return { vcc: sol.v[net(ic, String(def.vcc))], gnd: sol.v[net(ic, String(def.gnd))] }
  }
  const powered = (ic: Comp) => {
    const r = rail(ic)
    return r.vcc !== null && r.gnd !== null && r.vcc - r.gnd >= 3 && r.vcc - r.gnd <= 7
  }
  const inputLevel = (ic: Comp, n: number): Level => {
    const v = sol.v[n], r = rail(ic)
    if (v === null || r.vcc === null || r.gnd === null) return 'Z'
    const span = r.vcc - r.gnd
    return v - r.gnd >= 0.4 * span - 2e-3 ? 1 : v - r.gnd <= 0.16 * span ? 0 : 'Z'
  }
  interface Driver { net: number; v: number; comp: Comp; pin: string }
  const drivers = (): Driver[] => {
    const d: Driver[] = inputs.map((c) => ({ net: net(c, 'OUT'), v: c.props.on ? 5 : 0, comp: c, pin: 'OUT' }))
    for (const g of gates) {
      if (out[g.key] === 'Z' || !powered(g.ic)) continue
      const r = rail(g.ic)
      d.push({ net: g.outNet, v: out[g.key] ? r.vcc! : r.gnd!, comp: g.ic, pin: g.outPin })
    }
    return d
  }
  const resolve = () => {
    const f = new Map(supplyV)
    const contested = new Set<number>()
    for (const d of drivers()) {
      if (supplyV.has(d.net) || contested.has(d.net)) continue
      if (f.has(d.net) && Math.abs(f.get(d.net)! - d.v) > 0.5) { f.delete(d.net); contested.add(d.net) }
      else f.set(d.net, d.v)
    }
    fixed = f
    sol = solveDC(problem(f))
  }
  const desired = (g: G): Level =>
    locked.has(g.key) || !powered(g.ic) ? 'Z' : evalGate(ICS[g.ic.props.part!].gateType, g.inNets.map((n) => inputLevel(g.ic, n)))

  // ── event loop: update one gate at a time until nothing wants to change ──
  let steps = 0
  let cursor = 0
  let recent: string[] = []
  const settle = (): boolean => {
    const limit = Math.max(MAX_STEPS, gates.length * 20)
    for (let n = 0; n < limit; n++) {
      let changed = false
      for (let k = 0; k < gates.length; k++) {
        const g = gates[(cursor + k) % gates.length]
        const want = desired(g)
        if (want === out[g.key]) continue
        out[g.key] = want
        recent.push(g.key)
        cursor = (cursor + k + 1) % gates.length
        changed = true
        steps++
        resolve()
        break
      }
      if (!changed) return true
    }
    return false
  }
  const settleOrLock = () => {
    recent = []
    if (settle()) return
    // never settled: whatever is still toggling oscillates, so mark it unknown
    for (const k of new Set(recent.slice(-Math.max(50, gates.length * 2)))) {
      locked.add(k)
      out[k] = 'Z'
      const g = gates.find((q) => q.key === k)!
      warn(`osc:${g.ic.id}`, 'error', `Oscillation: ${compTitle(g.ic)} never settles (feedback loop)`, g.ic.id)
    }
    resolve()
    settle()
  }
  resolve()
  settleOrLock()

  // Feedback loops start out all-unknown. Seed loops whose unknowns come only
  // from each other with 0: latches then power up in a state, odd rings oscillate.
  let loop = gates.filter((g) => powered(g.ic) && out[g.key] === 'Z' && !locked.has(g.key))
  for (;;) {
    const outs = new Set(loop.map((g) => g.outNet))
    const next = loop.filter((g) => g.inNets.every((n) => inputLevel(g.ic, n) !== 'Z' || outs.has(n)))
    if (next.length === loop.length) break
    loop = next
  }
  if (loop.length) {
    for (const g of loop) out[g.key] = 0
    resolve()
    settleOrLock()
  }

  // ── final levels ──
  const netV = sol.v
  const netLevel = netV.map(levelOf)
  const comps: Record<string, CompState> = {}
  for (const c of circuit.components) {
    const pins: Record<string, PinState> = {}
    for (const p of Object.values(nl.pins.get(c.id)!)) {
      const n = nl.netOf.get(p.strip)!
      pins[p.name] = { net: n, level: netLevel[n], v: netV[n] }
    }
    comps[c.id] = { pins }
  }

  // ── contention & power warnings (a powered but unknown gate still drives its pin) ──
  const driverPins = new Map<number, { comp: Comp; pin: string }[]>()
  for (const c of inputs) push(driverPins, net(c, 'OUT'), { comp: c, pin: 'OUT' })
  for (const g of gates) if (powered(g.ic)) push(driverPins, g.outNet, { comp: g.ic, pin: g.outPin })
  for (const [n, list] of driverPins) {
    const who = list.map((d) => `${compTitle(d.comp)} pin ${d.pin}`).join(' and ')
    if (list.length > 1) warn(`multi:${n}`, 'error', `Two outputs drive the same net: ${who}`, list[0].comp.id)
    if (supplyV.has(n)) warn(`outshort:${n}`, 'error', `Output tied directly to a power rail: ${who}`, list[0].comp.id)
  }
  for (const ic of ics) {
    const ok = powered(ic)
    comps[ic.id].powered = ok
    if (ok) continue
    const r = rail(ic)
    const why =
      r.vcc === null && r.gnd === null ? 'VCC (14) and GND (7) are not connected'
      : r.vcc === null ? 'VCC (pin 14) is not connected'
      : r.gnd === null ? 'GND (pin 7) is not connected'
      : r.vcc - r.gnd > 7 ? `over-voltage (${(r.vcc - r.gnd).toFixed(1)} V, use 5 V)`
      : r.vcc < r.gnd ? 'VCC and GND are reversed'
      : `supply too low (${(r.vcc - r.gnd).toFixed(1)} V)`
    comps[ic.id].warn = why
    warn(`power:${ic.id}`, 'warning', `${compTitle(ic)} is not powered: ${why}`, ic.id)
  }

  // ── branch currents ──
  const inj = new Map<string, number>() // current flowing INTO the net at a strip
  const addI = (s: string, i: number) => inj.set(s, (inj.get(s) ?? 0) + i)
  const prob = problem(fixed)
  resistors.forEach((c, k) => {
    const i = sol.resistorI[k]
    addI(strip(c, '1'), -i); addI(strip(c, '2'), i)
    const a = netV[rBranches[k].a], b = netV[rBranches[k].b]
    const reversed = (a ?? -Infinity) < (b ?? -Infinity)
    const [vin, vout] = reversed ? [b, a] : [a, b]
    comps[c.id].current = Math.abs(i)
    comps[c.id].resistor = {
      vin, vout, vr: vin !== null && vout !== null ? vin - vout : 0, i: Math.abs(i),
      iNo: Math.abs(i) > 1e-8 ? currentWithoutResistor(prob, k) : 0, reversed,
    }
  })
  const overLeds: SimResult['overLeds'] = []
  leds.forEach((c, k) => {
    const i = sol.ledI[k]
    addI(strip(c, 'A'), -i); addI(strip(c, 'K'), i)
    comps[c.id].current = i
    if (burned[c.id] !== undefined)
      warn(`burn:${c.id}`, 'error', `${compTitle(c)} burned out: ${fmtMA(burned[c.id])} exceeds ${LED_MAX_MA} mA. Add a larger series resistor`, c.id)
    else if (i * 1000 > LED_MAX_MA + 0.01) overLeds.push({ id: c.id, current: i })
  })

  const netSum = (n: number) => nl.nets[n].reduce((s, st) => s + (inj.get(st) ?? 0), 0)
  // IC outputs / logic inputs supply whatever their net needs
  const onNet = new Map<number, Driver[]>()
  for (const d of drivers()) push(onNet, d.net, d)
  for (const [n, list] of onNet) {
    if (supplyV.has(n) || !fixed.has(n)) continue
    const total = -netSum(n) / list.length
    for (const d of list) {
      addI(strip(d.comp, d.pin), total)
      if (d.comp.type === 'ic') {
        const def = ICS[d.comp.props.part!]
        if (total > 0) addI(strip(d.comp, String(def.vcc)), -total)
        else addI(strip(d.comp, String(def.gnd)), -total)
      }
      if (Math.abs(total) * 1000 > IC_MAX_MA + 0.01)
        warn(`outI:${d.comp.id}:${d.pin}`, 'warning', `${compTitle(d.comp)} pin ${d.pin} carries ${fmtMA(total)}, above its ${IC_MAX_MA} mA limit`, d.comp.id)
    }
  }
  // supply terminals balance the rest
  const terms = new Map<number, string[]>()
  for (const s of live) { push(terms, net(s, '+'), strip(s, '+')); push(terms, net(s, '−'), strip(s, '−')) }
  for (const g of grounds) if (!terms.has(net(g, 'GND'))) push(terms, net(g, 'GND'), strip(g, 'GND'))
  let supplyCurrent = 0
  for (const [n, list] of terms) {
    const each = -netSum(n) / list.length
    for (const s of list) addI(s, each)
    if (each > 0) supplyCurrent += each * list.length
  }

  // ── current in each wire: every net is a small mesh of equal-resistance jumpers ──
  const wires: SimResult['wires'] = {}
  const edgesByNet = new Map<number, typeof nl.edges>()
  for (const e of nl.edges) push(edgesByNet, nl.netOf.get(e.a)!, e)
  for (const [n, edges] of edgesByNet) {
    const strips = nl.nets[n]
    const ix = new Map(strips.map((s, i) => [s, i]))
    const N = strips.length
    let pot: number[] | null = null
    if (N > 1 && strips.some((s) => Math.abs(inj.get(s) ?? 0) > 1e-9)) {
      const A = Array.from({ length: N }, () => new Array<number>(N).fill(0))
      for (const e of edges) {
        const i = ix.get(e.a)!, j = ix.get(e.b)!
        if (i === j) continue
        A[i][i]++; A[j][j]++; A[i][j]--; A[j][i]--
      }
      for (let i = 0; i < N; i++) A[i][i] += 1e-9
      pot = solveLinear(A, strips.map((s) => inj.get(s) ?? 0))
    }
    // signal direction when no current flows: away from whatever drives the net
    const src = [...(terms.get(n) ?? []), ...(onNet.get(n) ?? []).map((d) => strip(d.comp, d.pin))]
    const dist = new Map<string, number>(src.map((s) => [s, 0]))
    const q = [...src]
    while (q.length) {
      const s = q.shift()!
      for (const e of edges) {
        const o = e.a === s ? e.b : e.b === s ? e.a : null
        if (o && !dist.has(o)) { dist.set(o, dist.get(s)! + 1); q.push(o) }
      }
    }
    for (const e of edges) {
      if (e.kind !== 'wire') continue
      const i = pot ? pot[ix.get(e.a)!] - pot[ix.get(e.b)!] : 0
      const dir = Math.abs(i) > 1e-6 ? (i > 0 ? 1 : -1) : (dist.get(e.a) ?? 1e9) <= (dist.get(e.b) ?? 1e9) ? 1 : -1
      wires[e.id] = { level: netLevel[n], v: netV[n], current: Math.abs(i) > 1e-7 ? Math.abs(i) : 0, dir }
    }
  }

  return { netlist: nl, netV, netLevel, comps, wires, warnings, gateOut: out, overLeds, supplyCurrent, iterations: steps }
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const l = m.get(k)
  if (l) l.push(v)
  else m.set(k, [v])
}

/** Simulate, burning any LED that is over its limit until the circuit is steady. */
export function simulateWithBurn(circuit: Circuit, prev: Record<string, Level>, burned: Record<string, number>) {
  let b = burned
  let r = simulate(circuit, prev, b)
  for (let n = 0; r.overLeds.length && n < 50; n++) {
    b = { ...b }
    for (const l of r.overLeds) b[l.id] = l.current
    r = simulate(circuit, r.gateOut, b)
  }
  return { result: r, burned: b }
}

export function fmtMA(i: number): string {
  if (!Number.isFinite(i)) return '∞'
  const ma = Math.abs(i) * 1000
  if (ma < 1e-5) return '0 mA'
  if (ma < 0.1) return `${(ma * 1000).toFixed(ma < 0.01 ? 1 : 0)} µA`
  return `${ma.toFixed(ma < 100 ? 2 : 0)} mA`
}
export const fmtV = (v: number | null) => (v === null ? 'floating' : `${(Math.abs(v) < 0.005 ? 0 : v).toFixed(2)} V`)
