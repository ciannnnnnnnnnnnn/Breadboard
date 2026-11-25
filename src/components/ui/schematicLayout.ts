/** Turns the netlist into a left-to-right schematic: ranks, stacked columns, trunk routing. */
import { gateSymbol } from '../../data/gateGeometry'
import { compTitle } from '../../data/components'
import { ICS, type GateType } from '../../data/ics'
import type { Circuit, Comp } from '../../data/types'
import { buildNetlist, pinNet, powerNets } from '../../simulation/netlist'

export interface Port { pin: string; strip: string; net: number; side: 'l' | 'r'; dx: number; dy: number }
export interface Elem {
  key: string
  comp: Comp
  kind: 'gate' | 'toggle' | 'contact' | 'input' | 'resistor' | 'led' | 'probe' | 'supply'
  gate?: GateType
  gateIndex?: number
  /** contact index for DIP switches */
  index?: number
  label: string
  w: number
  h: number
  x: number
  y: number
  rank: number
  ports: Port[]
}
export interface Route { net: number; strip: string; d: string; dots: [number, number][] }
export interface Schematic { elems: Elem[]; routes: Route[]; width: number; height: number; vcc: Set<number>; gnd: Set<number>; minY: number }

export const GATE_SCALE = 60
const GAP_Y = 30

export function layoutSchematic(circuit: Circuit): Schematic {
  const nl = buildNetlist(circuit, true)
  const { vcc, gnd } = powerNets(nl)
  const isPower = (n: number) => vcc.has(n) || gnd.has(n)
  const uses = new Map<number, number>()
  for (const rec of nl.pins.values()) for (const p of Object.values(rec)) {
    const n = nl.netOf.get(p.strip)!
    uses.set(n, (uses.get(n) ?? 0) + 1)
  }
  const elems: Elem[] = []
  const add = (e: Omit<Elem, 'x' | 'y' | 'rank'>) => elems.push({ ...e, x: 0, y: 0, rank: -1 })
  const port = (c: Comp, pin: string, side: 'l' | 'r', dx: number, dy: number): Port => ({ pin, strip: nl.pins.get(c.id)![pin].strip, net: pinNet(nl, c.id, pin), side, dx, dy })

  for (const c of circuit.components) {
    const label = compTitle(c)
    switch (c.type) {
      case 'supply': case 'battery':
        add({ key: c.id, comp: c, kind: 'supply', label: `${c.props.volts} V`, w: 50, h: 56, ports: [port(c, '+', 'r', 50, 10), port(c, '−', 'r', 50, 46)] })
        break
      case 'toggle':
        add({ key: c.id, comp: c, kind: 'toggle', label, w: 56, h: 44, ports: [port(c, 'B', 'l', 0, 10), port(c, 'A', 'l', 0, 34), port(c, 'COM', 'r', 56, 22)] })
        break
      case 'button':
        add({ key: c.id, comp: c, kind: 'contact', label, w: 56, h: 24, ports: [port(c, '1a', 'l', 0, 14), port(c, '2a', 'r', 56, 14)] })
        break
      case 'dip4':
        for (let i = 1; i <= c.props.switches!.length; i++) {
          const p = [port(c, `${i}a`, 'l', 0, 14), port(c, `${i}b`, 'r', 56, 14)]
          if (p.some((q) => uses.get(q.net)! > 1 || isPower(q.net))) add({ key: `${c.id}:${i}`, comp: c, kind: 'contact', index: i - 1, label: c.props.names?.[i - 1] ?? `${label} ${i}`, w: 56, h: 24, ports: p })
        }
        break
      case 'input':
        add({ key: c.id, comp: c, kind: 'input', label, w: 40, h: 24, ports: [port(c, 'OUT', 'r', 40, 12)] })
        break
      case 'probe':
        add({ key: c.id, comp: c, kind: 'probe', label, w: 34, h: 24, ports: [port(c, 'IN', 'l', 0, 12)] })
        break
      case 'resistor': case 'led': {
        const [a, b] = c.type === 'led' ? ['A', 'K'] : ['1', '2']
        const w = c.type === 'led' ? 46 : 60
        add({ key: c.id, comp: c, kind: c.type, label, w, h: 26, ports: [port(c, a, 'l', 0, 13), port(c, b, 'r', w, 13)] })
        break
      }
      case 'ic': {
        const def = ICS[c.props.part!]
        const sym = gateSymbol(def.gateType)
        def.gates.forEach((g, i) => {
          const nets = [...g.inputs, g.output].map((p) => pinNet(nl, c.id, String(p)))
          if (!nets.some((n) => uses.get(n)! > 1 || isPower(n))) return
          add({
            key: `${c.id}:${i}`, comp: c, kind: 'gate', gate: def.gateType, gateIndex: i, label: `${c.props.label?.split(' ')[0] ?? def.part} · ${i + 1}`, w: 70, h: 44,
            ports: [
              ...g.inputs.map((p, k) => port(c, String(p), 'l', 0, 22 - sym.inputs[k][1] * GATE_SCALE)),
              port(c, String(g.output), 'r', 70, 22),
            ],
          })
        })
      }
    }
  }

  // ── ranks ──
  const netRank = new Map<number, number>()
  const setNet = (n: number, r: number) => { if (!isPower(n) && !netRank.has(n)) netRank.set(n, r) }
  for (const e of elems) if (['supply', 'toggle', 'contact', 'input'].includes(e.kind)) {
    e.rank = 0
    e.ports.forEach((p) => setNet(p.net, 0))
  }
  const gates = elems.filter((e) => e.kind === 'gate')
  const driver = new Map(gates.map((g) => [g.ports[g.ports.length - 1].net, g]))
  gates.forEach((g) => { g.rank = 1 })
  for (let i = 0; i < Math.min(12, gates.length); i++)
    for (const g of gates)
      for (const p of g.ports.slice(0, -1)) {
        const d = driver.get(p.net)
        if (d && d !== g) g.rank = Math.min(12, Math.max(g.rank, d.rank + 1))
      }
  gates.forEach((g) => setNet(g.ports[g.ports.length - 1].net, g.rank))
  const passive = new Set(elems.filter((e) => e.rank < 0))
  while (passive.size) {
    // nearest to an already ranked net first; leftovers hang off the power rails
    let best: Elem | undefined
    let bestRank = Infinity
    for (const e of passive) {
      const r = Math.min(...e.ports.map((p) => netRank.get(p.net) ?? Infinity))
      if (r < bestRank) { best = e; bestRank = r }
    }
    if (!best) { best = [...passive].find((e) => e.ports.some((p) => isPower(p.net))) ?? [...passive][0]; bestRank = 0 }
    best.rank = bestRank + 1
    // signal enters on the left: VCC or the lower-ranked side left, GND right
    if (best.ports.length === 2) {
      const score = (p: Port) => (vcc.has(p.net) ? -1 : gnd.has(p.net) ? 99 : (netRank.get(p.net) ?? 50))
      const [a, b] = best.ports
      if (best.kind === 'resistor' && score(b) < score(a)) best.ports = [{ ...b, side: 'l', dx: 0 }, { ...a, side: 'r', dx: best.w }]
    }
    for (const p of best.ports) setNet(p.net, best.rank)
    passive.delete(best)
  }

  // ── columns ──
  const ranks = [...new Set(elems.map((e) => e.rank))].sort((a, b) => a - b)
  elems.forEach((e) => { e.rank = ranks.indexOf(e.rank) })
  const cols = ranks.map((_, r) => elems.filter((e) => e.rank === r))
  const portsOn = (n: number, below: number) => elems.filter((e) => e.rank < below).flatMap((e) => e.ports.filter((p) => p.net === n).map((p) => e.y + p.dy))
  cols.forEach((col, r) => {
    const want = new Map(col.map((e, i) => {
      const ys = e.ports.filter((p) => !isPower(p.net)).flatMap((p) => portsOn(p.net, r).map((y) => y - p.dy))
      return [e, ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : r === 0 ? i * 70 : 1e6 + i]
    }))
    col.sort((a, b) => want.get(a)! - want.get(b)!)
    let bottom = 0
    for (const e of col) {
      const w = want.get(e)!
      e.y = Math.max(bottom, w >= 1e6 ? 0 : Math.round(w))
      bottom = e.y + e.h + GAP_Y
    }
  })

  // ── routing: one vertical trunk per net in each gap it touches, joined above the drawing ──
  const nets = new Map<number, Map<number, { e: Elem; p: Port }[]>>()
  for (const e of elems) for (const p of e.ports) {
    if (isPower(p.net)) continue
    const gap = p.side === 'l' ? e.rank : e.rank + 1
    if (!nets.has(p.net)) nets.set(p.net, new Map())
    const m = nets.get(p.net)!
    m.set(gap, [...(m.get(gap) ?? []), { e, p }])
  }
  for (const [n, m] of [...nets]) if ([...m.values()].flat().length < 2) nets.delete(n)
  const lanes = cols.map(() => [] as number[]).concat([[]])
  for (const [n, m] of nets) for (const g of m.keys()) lanes[g].push(n)
  const LANE = 12, PAD = 46
  let x = 20
  const gapX: number[] = []
  const colW = cols.map((c) => Math.max(0, ...c.map((e) => e.w)))
  cols.forEach((col, r) => {
    gapX[r] = x
    x += lanes[r].length * LANE + PAD
    // sit against the gap that has the signal so leads stay short
    for (const e of col) e.x = x
    x += colW[r]
  })
  gapX[cols.length] = x
  x += lanes[cols.length].length * LANE + PAD
  const laneX = (g: number, n: number) => gapX[g] + PAD / 2 + lanes[g].indexOf(n) * LANE

  let busY = -14
  const routes: Route[] = []
  for (const [n, m] of nets) {
    const gaps = [...m.keys()].sort((a, b) => a - b)
    const dots: [number, number][] = []
    let d = ''
    const y0 = gaps.length > 1 ? busY : null
    if (y0 !== null) {
      busY -= LANE
      d += `M${laneX(gaps[0], n)} ${y0}H${laneX(gaps[gaps.length - 1], n)}`
      for (const g of gaps.slice(1, -1)) dots.push([laneX(g, n), y0])
    }
    for (const g of gaps) {
      const lx = laneX(g, n)
      const ys = m.get(g)!.map(({ e, p }) => {
        const py = e.y + p.dy
        d += `M${e.x + p.dx} ${py}H${lx}`
        return py
      })
      const all = y0 === null ? ys : [y0, ...ys]
      const lo = Math.min(...all), hi = Math.max(...all)
      if (lo !== hi) d += `M${lx} ${lo}V${hi}`
      for (const y of ys) if (y !== lo && y !== hi) dots.push([lx, y])
    }
    routes.push({ net: n, strip: [...m.values()][0][0].p.strip, d, dots })
  }
  const height = Math.max(60, ...elems.map((e) => e.y + e.h)) + 40
  return { elems, routes, width: x + 20, height, vcc, gnd, minY: Math.min(-24, busY - 4) }
}
