/** Design → gates → packages → parts and wires on one or more breadboards. */
import { Builder } from '../data/builder'
import { COLS, HOLE_BY_ID, MAX_BOARDS, boardPrefix, colX, BOARD_PITCH } from '../data/breadboard'
import { LED_COLORS } from '../data/components'
import { ICS, type GateType } from '../data/ics'
import type { Circuit, Comp } from '../data/types'
import { simulate } from '../simulation/simulate'
import type { PartLine, TestCase } from './analyze'
import type { Design, Expr } from './expr'

export interface GateUse { type: GateType; inputs: string[]; output: string; chip?: string; pins?: number[] }
export interface Package { name: string; part: string; gates: GateUse[] }
export interface Built { circuit: Circuit; packages: Package[]; gates: GateUse[]; switches: { dip: string; id: string; names: string[] }[]; boards: number }

/** Break expressions into 2-input gates. `share` reuses identical AND/OR terms. */
export function toGates(d: Design, share = true): GateUse[] {
  const gates: GateUse[] = []
  const memo = new Map<string, string>()
  const taken = new Set([...d.inputs, ...d.equations.map((e) => e.name)])
  let n = 0
  const fresh = () => { let s; do s = `N${++n}`; while (taken.has(s)); return s }
  const emit = (type: GateType, inputs: string[], want?: string): string => {
    const key = `${type}(${[...inputs].sort().join()})`
    const reuse = share || type === 'NOT' || type === 'XOR'
    const old = reuse ? memo.get(key) : undefined
    if (old && !want) return old
    const output = want ?? fresh()
    gates.push({ type, inputs, output })
    if (!old) memo.set(key, output)
    return output
  }
  const alias = new Map<string, string>()
  const build = (e: Expr, want?: string): string => {
    if (e.op === 'VAR') {
      if (want) alias.set(want, e.name)
      return e.name
    }
    const a = e.args.map((x) => build(x))
    if (e.op === 'NOT') return emit('NOT', a, want)
    if (a.length === 2) return emit(e.op, a, want)
    if (e.op === 'XOR') { // fold left so A⊕B can be reused
      let acc = a[0]
      a.slice(1).forEach((x, i) => { acc = emit('XOR', [acc, x], i === a.length - 2 ? want : undefined) })
      return acc
    }
    // pair up: (A·B)·(C·D)
    let level = a
    while (level.length > 2) {
      const next: string[] = []
      for (let i = 0; i < level.length; i += 2) next.push(i + 1 < level.length ? emit(e.op, [level[i], level[i + 1]]) : level[i])
      level = next
    }
    return emit(e.op, level, want)
  }
  for (const q of d.equations) build(q.expr, q.name)
  const real = (s: string): string => {
    const seen = new Set<string>()
    while (alias.has(s)) {
      if (seen.has(s)) throw new Error(`${s} is defined in terms of itself`)
      seen.add(s)
      s = alias.get(s)!
    }
    return s
  }
  for (const g of gates) g.inputs = g.inputs.map(real)
  // outputs that are plain copies of another signal
  d.outputs = d.outputs.map((o) => ({ ...o }))
  aliases.set(d, real)
  return gates
}
const aliases = new WeakMap<Design, (s: string) => string>()

const partFor = (t: GateType) => Object.values(ICS).find((d) => d.gateType === t)!
const packageCount = (gates: GateUse[]) => {
  const m = new Map<string, number>()
  for (const g of gates) m.set(g.type, (m.get(g.type) ?? 0) + 1)
  return new Map([...m].map(([t, n]) => [partFor(t as GateType).part, Math.ceil(n / partFor(t as GateType).gates.length)]))
}

/** Gates, choosing whether to share repeated terms so the chip count matches the manual. */
export function chooseGates(d: Design, parts: PartLine[]): { gates: GateUse[]; shared: boolean } {
  const fits = (g: GateUse[]) => {
    const c = packageCount(g)
    return parts.length > 0 && parts.every((p) => (c.get(p.part) ?? 0) === p.qty)
  }
  const a = toGates(d, true)
  if (fits(a)) return { gates: a, shared: true }
  const b = toGates(d, false)
  if (fits(b)) return { gates: b, shared: false }
  return { gates: toGates(d, true), shared: true }
}

/** group switches: up to five per DIP so every pull-down lands on a rail hole */
function groupInputs(inputs: string[]): string[][] {
  const groups: string[][] = []
  const families = new Map<string, string[]>()
  for (const i of inputs) {
    const k = i.replace(/\d+$/, '')
    families.set(k, [...(families.get(k) ?? []), i])
  }
  for (const f of families.values()) {
    for (let k = 0; k < f.length; k += 5) {
      const part = f.slice(k, k + 5)
      const last = groups[groups.length - 1]
      if (last && last.length + part.length <= 5) last.push(...part)
      else groups.push([...part])
    }
  }
  return groups
}

export interface SynthOptions { ledOhms?: number; pullOhms?: number; parts?: PartLine[] }

export function synthesize(d: Design, opt: SynthOptions = {}): Built {
  const { gates } = chooseGates(d, opt.parts ?? [])
  const real = aliases.get(d)!
  const b = new Builder()
  b.c.boards = 1

  // ── pack gates into chips, in the order they were described ──
  const packages: Package[] = []
  for (const g of gates) {
    const def = partFor(g.type)
    let p = packages.find((q) => q.part === def.part && q.gates.length < def.gates.length)
    if (!p) packages.push((p = { name: '', part: def.part, gates: [] }))
    p.gates.push(g)
  }
  const order = ['7486', '7408', '7432', '7404', '7400', '7402', '74HC7266']
  packages.sort((x, y) => order.indexOf(x.part) - order.indexOf(y.part))
  packages.forEach((p, i) => { p.name = `U${i + 1}` })

  // ── floor plan: switches, LEDs, then chips ──
  const groups = groupInputs(d.inputs)
  type Slot = { kind: 'dip' | 'led' | 'chip'; i: number; board: number; col: number }
  const slots: Slot[] = []
  let board = 0, col = 1
  const reserve = (kind: Slot['kind'], i: number, width: number, mod6: boolean) => {
    const align = () => { if (mod6) while (col % 6 !== 1) col++ }
    align()
    if (col + width - 1 > COLS) { board++; col = 1 }
    slots.push({ kind, i, board, col })
    col += width + (kind === 'led' ? 0 : 1)
  }
  groups.forEach((_, i) => reserve('dip', i, 8, true))
  d.outputs.forEach((_, i) => reserve('led', i, 6, true))
  // keep all the logic together on its own board when it does not fit beside the switches
  const start = slots.length && col > 1 ? Math.ceil((col - 1) / 8) * 8 + 1 : 1
  if (start + packages.length * 8 - 2 > COLS) { board++; col = 1 } else col = start
  packages.forEach((_, i) => reserve('chip', i, 7, false))
  const boards = board + 1
  if (boards > MAX_BOARDS) throw new Error(`This circuit needs ${boards} breadboards. The limit is ${MAX_BOARDS}.`)
  b.c.boards = boards

  // ── parts ──
  const z0 = (k: number) => k * BOARD_PITCH
  /** signal → holes of the strips it must reach, driver first */
  const ends = new Map<string, string[]>()
  const reach = (sig: string, hole: string, driver = false) => {
    const l = ends.get(sig) ?? []
    if (driver) l.unshift(hole)
    else l.push(hole)
    ends.set(sig, l)
  }
  const chips: { slot: Slot; comp: Comp; p: Package }[] = []
  const switches: Built['switches'] = []
  for (const s of slots) {
    const pre = boardPrefix(s.board)
    if (s.kind === 'dip') {
      const names = groups[s.i]
      const dip = b.place('dip4', colX(s.col) + 1, z0(s.board), { switches: Array(8).fill(false), names, label: `SW${s.i + 1}: ${names.join(' ')}` })
      names.forEach((n, k) => {
        b.wire(b.pin(dip, `${k + 1}a`), `${pre}tp@${s.col + k}`)
        b.at('resistor', `${pre}j${s.col + k}`, { ohms: opt.pullOhms ?? 10000, span: 3 }, 1)
        reach(n, b.pin(dip, `${k + 1}b`), true)
      })
      switches.push({ dip: dip.props.label!, id: dip.id, names })
    } else if (s.kind === 'led') {
      const o = d.outputs[s.i]
      const at = `${pre}f${s.col}`
      b.at('resistor', `${pre}h${s.col}`, { ohms: opt.ledOhms ?? 330, span: 4 })
      b.at('led', `${pre}j${s.col + 4}`, { color: o.color, vf: LED_COLORS[o.color].vf, span: 3, label: o.name }, 1)
      reach(real(o.name), at)
    } else {
      const p = packages[s.i]
      const comp = b.place('ic', colX(s.col) + 3, z0(s.board), { part: p.part, label: `${p.name} ${p.part} ${ICS[p.part].name}` })
      chips.push({ slot: s, comp, p })
      p.gates.forEach((g, k) => {
        const def = ICS[p.part].gates[k]
        g.chip = p.name
        g.pins = [...def.inputs, def.output]
        g.inputs.forEach((sig, q) => reach(sig, b.pin(comp, def.inputs[q])))
        reach(g.output, b.pin(comp, def.output), true)
      })
    }
  }

  // ── supply and rails, after the parts whose legs need particular rail holes ──
  b.power(5)
  for (let k = 1; k < boards; k++) {
    const p = boardPrefix(k), q = boardPrefix(k - 1)
    b.wire(`${q}bp@61`, `${p}tp@61`)
    b.wire(`${q}bn@62`, `${p}tn@62`)
    b.wire(`${p}tp@${COLS}`, `${p}bp@${COLS}`)
    b.wire(`${p}tn@${COLS - 1}`, `${p}bn@${COLS - 1}`)
  }

  // ── chip power first, then spare inputs to ground, then signals ──
  const rail = (hole: string, kind: 'p' | 'n') => {
    const h = HOLE_BY_ID.get(hole)!
    b.wire(hole, `${boardPrefix(h.board)}${h.row <= 'e' ? 't' : 'b'}${kind}@${h.col}`, kind === 'p' ? 'red' : 'black')
  }
  for (const { comp, p } of chips) {
    const def = ICS[p.part]
    rail(b.pin(comp, def.vcc), 'p')
    rail(b.pin(comp, def.gnd), 'n')
    def.gates.slice(p.gates.length).forEach((g) => g.inputs.forEach((pin) => rail(b.pin(comp, pin), 'n')))
  }
  const palette = ['blue', 'yellow', 'green', 'orange', 'white']
  let ci = 0
  for (const [, list] of ends) {
    if (list.length < 2) continue
    const color = palette[ci++ % palette.length]
    // daisy-chain from the driver to the nearest remaining end: at most two wires per column
    const left = [...new Set(list.slice(1))]
    let at = list[0]
    while (left.length) {
      const A = HOLE_BY_ID.get(at)!
      const dist = (x: string) => { const B = HOLE_BY_ID.get(x)!; return Math.hypot(A.x - B.x, A.z - B.z) }
      left.sort((x, y) => dist(x) - dist(y))
      const next = left.shift()!
      if (HOLE_BY_ID.get(next)!.strip !== A.strip) b.wire(at, next, color)
      at = next
    }
  }
  return { circuit: b.c, packages, gates, switches, boards }
}

export interface TestResult { label: string; pass: boolean; expected: string; got: string }
/** set the switches on the built board, simulate it, and read the LEDs */
export function runTests(built: Built, tests: TestCase[], outputs: string[]): TestResult[] {
  return tests.map((t) => {
    const circuit: Circuit = {
      ...built.circuit,
      components: built.circuit.components.map((c) => {
        const sw = built.switches.find((s) => s.id === c.id)
        return sw ? { ...c, props: { ...c.props, switches: c.props.switches!.map((_, i) => !!t.set[sw.names[i]]) } } : c
      }),
    }
    const sim = simulate(circuit)
    const names = outputs.filter((o) => o in t.expect)
    const read = (o: string) => {
      const led = circuit.components.find((c) => c.type === 'led' && c.props.label === o)
      return led && sim.comps[led.id].current! > 1e-3 ? 1 : 0
    }
    const got = names.map(read), want = names.map((o) => t.expect[o])
    const s = (a: number[]) => names.map((o, i) => `${o}=${a[i]}`).join(' ')
    return { label: t.label, pass: !sim.warnings.length && got.join() === want.join(), expected: s(want), got: s(got) + (sim.warnings.length ? ` (${sim.warnings[0].msg})` : '') }
  })
}
