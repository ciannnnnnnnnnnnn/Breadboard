import { contacts, pinsOf, stripOfEnd, type PinPos } from '../data/components'
import type { Circuit, Comp } from '../data/types'
import { UnionFind } from './unionFind'

export interface Edge { id: string; a: string; b: string; kind: 'wire' | 'contact' }
export interface Netlist {
  /** strip id → net index */
  netOf: Map<string, number>
  /** net index → strips */
  nets: string[][]
  edges: Edge[]
  pins: Map<string, Record<string, PinPos>>
  comps: Map<string, Comp>
}

/** `switchesOpen` ignores closable contacts: the schematic needs the nets on both sides of a switch. */
export function buildNetlist(c: Circuit, switchesOpen = false): Netlist {
  const uf = new UnionFind()
  const edges: Edge[] = []
  const pins = new Map<string, Record<string, PinPos>>()
  for (const comp of c.components) {
    const rec: Record<string, PinPos> = {}
    for (const p of pinsOf(comp)) { rec[p.name] = p; uf.add(p.strip) }
    pins.set(comp.id, rec)
    // with props reset, a button keeps only its permanent leg ties
    const closed = !switchesOpen ? contacts(comp) : comp.type === 'button' ? contacts({ ...comp, props: {} }) : []
    for (const [a, b] of closed) edges.push({ id: comp.id, a: rec[a].strip, b: rec[b].strip, kind: 'contact' })
  }
  for (const w of c.wires) edges.push({ id: w.id, a: stripOfEnd(w.from), b: stripOfEnd(w.to), kind: 'wire' })
  for (const e of edges) uf.union(e.a, e.b)

  const netOf = new Map<string, number>()
  const nets: string[][] = []
  const rootIdx = new Map<string, number>()
  for (const s of uf.keys()) {
    const r = uf.find(s)
    let i = rootIdx.get(r)
    if (i === undefined) { rootIdx.set(r, (i = nets.length)); nets.push([]) }
    nets[i].push(s)
    netOf.set(s, i)
  }
  return { netOf, nets, edges, pins, comps: new Map(c.components.map((x) => [x.id, x])) }
}

export const pinNet = (n: Netlist, compId: string, pin: string) => n.netOf.get(n.pins.get(compId)![pin].strip)!

/** nets that sit directly on a supply terminal (auto wire colours, schematic symbols) */
export function powerNets(n: Netlist): { vcc: Set<number>; gnd: Set<number> } {
  const vcc = new Set<number>(), gnd = new Set<number>()
  for (const c of n.comps.values()) {
    if (c.type === 'supply' || c.type === 'battery') {
      vcc.add(pinNet(n, c.id, '+')); gnd.add(pinNet(n, c.id, '−'))
    } else if (c.type === 'gnd') gnd.add(pinNet(n, c.id, 'GND'))
  }
  return { vcc, gnd }
}
