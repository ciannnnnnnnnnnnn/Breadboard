/**
 * Tidy wire routing. Every wire runs in straight, right-angled segments over the
 * board, goes around part bodies, and never shares a lane with another wire.
 * Left-right runs lie in a lower layer and front-back runs in an upper one, so
 * where two wires must cross they pass over each other without touching.
 *
 * A* on a quarter-pitch grid; a state is (node, direction).
 */
import { HOLE_BY_ID } from '../data/breadboard'
import { TYPES, pinsOf, rotate } from '../data/components'
import type { Circuit, Comp, Wire } from '../data/types'

export const STEP = 0.25
export interface Route {
  /** corner points on the board plane, first and last are the wire's ends */
  points: [number, number][]
  /** false when no clean path exists and the wire had to break a rule */
  clean: boolean
}

interface Rect { x0: number; z0: number; x1: number; z1: number }
/** part bodies a wire must go around, in board coordinates */
export function obstacles(c: Comp): Rect[] {
  const s = TYPES[c.type].size(c.props)
  const span = c.props.span ?? 1
  // [centre x, centre z, width, depth] in the part's own frame
  const boxes: [number, number, number, number][] = (() => {
    switch (c.type) {
      case 'ic': return [[0, 0, 7.24, 3.4]]
      case 'resistor': return [[span / 2, 0, span + 0.2, 0.76]]
      case 'led': return [[span / 2, 0, 1.24, 1.24], [span / 2, 0, span + 0.2, 0.3]]
      case 'toggle': return [[0, 0, 2.9, 1.36]]
      case 'button': return [[0, 0, 2.9, 3.3]]
      case 'dip4': return [[s.cx, 0, s.w - 0.1, 3.3]]
      case 'supply': return [[-0.1, 0, 9.4, 8]]
      case 'battery': return [[-0.1, 0, 9, 5]]
      default: return [[0, 0, 0.95, 0.95]]
    }
  })()
  return boxes.map(([cx, cz, w, d]) => {
    const [x, z] = rotate(cx, cz, c.rot)
    const [W, D] = c.rot % 2 ? [d, w] : [w, d]
    return { x0: c.x + x - W / 2, x1: c.x + x + W / 2, z0: c.z + z - D / 2, z1: c.z + z + D / 2 }
  })
}

export function endXZ(end: string, circuit: Circuit): [number, number] | null {
  const h = HOLE_BY_ID.get(end)
  if (h) return [h.x, h.z]
  const m = /^@(.+)\.(.+)$/.exec(end)
  const c = m && circuit.components.find((q) => q.id === m[1])
  const p = c && pinsOf(c).find((q) => q.name === m[2])
  return p ? [p.x, p.z] : null
}

const COST = { step: 4, bend: 22, hole: 5, nearHole: 1, cross: 2, blocked: 3000, shared: 1500 }

class Grid {
  x0: number; z0: number; w: number; h: number
  /** 1 = part body */
  block: Uint8Array
  /** occupant of each node per direction (0 = free, otherwise wire number + 1) */
  occ: [Uint16Array, Uint16Array]
  /** extra cost of covering a hole */
  cover: Uint8Array
  constructor(circuit: Circuit, ends: [number, number][]) {
    let [x0, x1, z0, z1] = [-35, 35, -12, 12 + ((circuit.boards ?? 1) - 1) * 24]
    const grow = (x: number, z: number) => { x0 = Math.min(x0, x - 3); x1 = Math.max(x1, x + 3); z0 = Math.min(z0, z - 3); z1 = Math.max(z1, z + 3) }
    const rects = circuit.components.flatMap(obstacles)
    for (const r of rects) { grow(r.x0, r.z0); grow(r.x1, r.z1) }
    for (const e of ends) grow(...e)
    this.x0 = Math.floor(x0); this.z0 = Math.floor(z0)
    this.w = Math.ceil((x1 - this.x0) / STEP) + 1
    this.h = Math.ceil((z1 - this.z0) / STEP) + 1
    const n = this.w * this.h
    this.block = new Uint8Array(n)
    this.cover = new Uint8Array(n)
    this.occ = [new Uint16Array(n), new Uint16Array(n)]
    for (const r of rects)
      for (let j = Math.ceil((r.z0 - this.z0 - 0.06) / STEP); j <= (r.z1 - this.z0 + 0.06) / STEP; j++)
        for (let i = Math.ceil((r.x0 - this.x0 - 0.06) / STEP); i <= (r.x1 - this.x0 + 0.06) / STEP; i++)
          if (i >= 0 && j >= 0 && i < this.w && j < this.h) this.block[j * this.w + i] = 1
    for (const h of HOLE_BY_ID.values()) {
      if (h.board >= (circuit.boards ?? 1)) continue
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const k = this.node(h.x + dx * STEP, h.z + dz * STEP)
        this.cover[k] = Math.max(this.cover[k], dx || dz ? COST.nearHole : COST.hole)
      }
    }
  }
  node(x: number, z: number) { return Math.round((z - this.z0) / STEP) * this.w + Math.round((x - this.x0) / STEP) }
  xz(k: number): [number, number] { return [this.x0 + (k % this.w) * STEP, this.z0 + Math.floor(k / this.w) * STEP] }
}

/** binary heap of states keyed by f */
class Heap {
  private s: number[] = []
  private f: number[] = []
  get size() { return this.s.length }
  push(state: number, f: number) {
    let i = this.s.length
    this.s.push(state); this.f.push(f)
    while (i) {
      const p = (i - 1) >> 1
      if (this.f[p] <= f) break
      this.s[i] = this.s[p]; this.f[i] = this.f[p]
      i = p
    }
    this.s[i] = state; this.f[i] = f
  }
  pop(): number {
    const out = this.s[0], s = this.s.pop()!, f = this.f.pop()!
    const n = this.s.length
    if (n) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && this.f[c + 1] < this.f[c]) c++
        if (this.f[c] >= f) break
        this.s[i] = this.s[c]; this.f[i] = this.f[c]
        i = c
      }
      this.s[i] = s; this.f[i] = f
    }
    return out
  }
}

/** cheapest path of nodes, or null; `strict` forbids breaking rules */
function search(g: Grid, from: number, to: number, me: number, strict: boolean, gScore: Int32Array, came: Int32Array, stamp: Uint32Array, tick: number): number[] | null {
  const tx = to % g.w, tz = Math.floor(to / g.w)
  const est = (k: number) => {
    const dx = Math.abs((k % g.w) - tx), dz = Math.abs(Math.floor(k / g.w) - tz)
    return (dx + dz) * COST.step + (dx && dz ? COST.bend : 0)
  }
  const heap = new Heap()
  const relax = (state: number, cost: number, prev: number) => {
    if (stamp[state] === tick && gScore[state] <= cost) return
    stamp[state] = tick
    gScore[state] = cost
    came[state] = prev
    heap.push(state, cost + est(state >> 1))
  }
  relax(from * 2, 0, -1)
  relax(from * 2 + 1, 0, -1)
  // legal at `from` and `to` even inside a body's clearance (a hole right beside a part)
  const enter = (k: number, dir: number): number => {
    if (k === to) return 0
    let c = g.cover[k]
    if (g.block[k]) { if (strict) return -1; c += COST.blocked }
    const o = g.occ[dir][k]
    if (o && o !== me) { if (strict) return -1; c += COST.shared }
    if (g.occ[1 - dir][k]) c += COST.cross
    return c
  }
  while (heap.size) {
    const state = heap.pop()
    const k = state >> 1, dir = state & 1
    const cost = gScore[state]
    if (k === to) {
      const path: number[] = []
      for (let s = state; s >= 0; s = came[s]) if (path[path.length - 1] !== s >> 1) path.push(s >> 1)
      return path.reverse()
    }
    // turn in place: needs both layers free here
    if (k !== from) {
      const other = g.occ[1 - dir][k]
      const clash = other && other !== me
      if (!clash || !strict) relax(k * 2 + (1 - dir), cost + COST.bend + (clash ? COST.shared : 0), state)
    }
    const i = k % g.w, j = Math.floor(k / g.w)
    const next = dir === 0 ? [i > 0 ? k - 1 : -1, i < g.w - 1 ? k + 1 : -1] : [j > 0 ? k - g.w : -1, j < g.h - 1 ? k + g.w : -1]
    for (const n of next) {
      if (n < 0) continue
      const e = enter(n, dir)
      if (e >= 0) relax(n * 2 + dir, cost + COST.step + e, state)
    }
  }
  return null
}

/** mark a path in the occupancy layers; corners and ends take both */
function claim(g: Grid, path: number[], id: number) {
  path.forEach((k, i) => {
    for (const n of [path[i - 1], path[i + 1]]) if (n !== undefined) g.occ[Math.abs(n - k) === 1 ? 0 : 1][k] = id
  })
}

function corners(g: Grid, path: number[]): [number, number][] {
  return path.filter((k, i) => i === 0 || i === path.length - 1 || k - path[i - 1] !== path[i + 1] - k).map((k) => g.xz(k))
}

function attempt(circuit: Circuit, wires: Wire[]): { routes: Map<string, Route>; dirty: string[] } {
  const ends = new Map<string, [[number, number], [number, number]]>()
  for (const w of wires) {
    const a = endXZ(w.from, circuit), b = endXZ(w.to, circuit)
    if (a && b) ends.set(w.id, [a, b])
  }
  const g = new Grid(circuit, [...ends.values()].flat().concat(wires.flatMap((w) => w.bends)))
  const N = g.w * g.h * 2
  const gs = new Int32Array(N), came = new Int32Array(N), stamp = new Uint32Array(N)
  let tick = 0
  // plugs and part leads stand in the way of everyone else
  wires.forEach((w, n) => {
    for (const e of ends.get(w.id) ?? []) { const k = g.node(...e); g.occ[0][k] = g.occ[1][k] = n + 1 }
  })
  for (const c of circuit.components) for (const p of pinsOf(c)) if (p.hole) {
    const k = g.node(p.x, p.z)
    g.block[k] = 1
  }
  const routes = new Map<string, Route>()
  const dirty: string[] = []
  wires.forEach((w, n) => {
    const e = ends.get(w.id)
    if (!e) return
    const stops = [e[0], ...w.bends, e[1]].map((p) => g.node(...(p as [number, number])))
    const path: number[] = []
    let clean = true
    for (let i = 0; i + 1 < stops.length; i++) {
      if (stops[i] === stops[i + 1]) continue
      let leg = search(g, stops[i], stops[i + 1], n + 1, true, gs, came, stamp, ++tick)
      if (!leg) { clean = false; leg = search(g, stops[i], stops[i + 1], n + 1, false, gs, came, stamp, ++tick) }
      if (leg) path.push(...(path.length ? leg.slice(1) : leg))
    }
    if (path.length < 2) { routes.set(w.id, { points: [e[0], e[1]], clean: true }); return }
    claim(g, path, n + 1)
    const pts = corners(g, path)
    pts[0] = e[0]
    pts[pts.length - 1] = e[1]
    routes.set(w.id, { points: pts, clean })
    if (!clean) dirty.push(w.id)
  })
  return { routes, dirty }
}

/** Route every wire; wires that end up stuck are moved to the front and everything is tried again. */
export function routeAll(circuit: Circuit): Map<string, Route> {
  const len = (w: Wire) => {
    const a = endXZ(w.from, circuit), b = endXZ(w.to, circuit)
    return a && b ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) : 0
  }
  let order = [...circuit.wires].sort((a, b) => len(a) - len(b))
  let best = attempt(circuit, order)
  for (let k = 0; k < 4 && best.dirty.length; k++) {
    const stuck = new Set(best.dirty)
    order = [...order.filter((w) => stuck.has(w.id)), ...order.filter((w) => !stuck.has(w.id))]
    const next = attempt(circuit, order)
    if (next.dirty.length < best.dirty.length) best = next
  }
  return best.routes
}

let cache: { key: string; routes: Map<string, Route> } | null = null
/** cached by geometry, so flipping switches or changing values costs nothing */
export function getRoutes(circuit: Circuit): Map<string, Route> {
  const key = `${circuit.boards ?? 1}|` + circuit.components.map((c) => `${c.id},${c.type},${c.x},${c.z},${c.rot},${c.props.span ?? ''},${c.props.switches?.length ?? ''}`).join(';') + '|' + circuit.wires.map((w) => `${w.id},${w.from},${w.to},${w.bends}`).join(';')
  if (cache?.key !== key) cache = { key, routes: routeAll(circuit) }
  return cache.routes
}
