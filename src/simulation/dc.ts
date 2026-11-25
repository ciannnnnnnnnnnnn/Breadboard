/**
 * DC operating point for resistor / LED networks by nodal analysis.
 * Sources, IC outputs and ground are ideal fixed-voltage nodes. An LED is a
 * fixed forward drop, so I = (Vs − Vf) / R holds exactly in normal use. Far past
 * its rating (30 mA) it gains a 10 Ω slope, which keeps the "no resistor"
 * current finite and believable instead of infinite.
 */
export interface Branch { a: number; b: number; r: number }
export interface LedBranch { a: number; b: number; vf: number; open?: boolean }
export interface DCProblem { nodes: number; fixed: Map<number, number>; resistors: Branch[]; leds: LedBranch[] }
export interface DCSolution {
  /** node voltage; null = floating (no conducting path to any source) */
  v: (number | null)[]
  /** current a→b through each resistor (A) */
  resistorI: number[]
  ledI: number[]
}

export const LED_RS = 1e-3
export const LED_KNEE = 0.03
export const LED_OVER_R = 10
const GMIN = 1e-12

/** I = (Vsource − Vdrop) / R, clamped at zero */
export function seriesCurrent(vSource: number, vDrop: number, r: number): number {
  return Math.max(0, (vSource - vDrop) / r)
}

/** Gaussian elimination with partial pivoting; mutates its arguments. */
export function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length
  for (let i = 0; i < n; i++) {
    let p = i
    for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k
    if (Math.abs(A[p][i]) < 1e-18) continue
    ;[A[i], A[p]] = [A[p], A[i]]
    ;[b[i], b[p]] = [b[p], b[i]]
    for (let k = i + 1; k < n; k++) {
      const f = A[k][i] / A[i][i]
      if (f === 0) continue
      for (let j = i; j < n; j++) A[k][j] -= f * A[i][j]
      b[k] -= f * b[i]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i]
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j]
    x[i] = Math.abs(A[i][i]) < 1e-18 ? 0 : s / A[i][i]
  }
  return x
}

type LedState = 0 | 1 | 2 // off, on, overdriven
const ledModel = (s: LedState, vf: number) =>
  s === 1 ? { g: 1 / LED_RS, e: vf } : s === 2 ? { g: 1 / LED_OVER_R, e: vf - LED_KNEE * LED_OVER_R } : { g: 0, e: 0 }

export function solveDC(p: DCProblem): DCSolution {
  // only nodes that touch a resistor or LED and are not fixed are unknown
  const idx = new Map<number, number>()
  const note = (n: number) => { if (!p.fixed.has(n) && !idx.has(n)) idx.set(n, idx.size) }
  for (const r of p.resistors) { note(r.a); note(r.b) }
  for (const l of p.leds) { note(l.a); note(l.b) }
  const N = idx.size
  const state: LedState[] = p.leds.map(() => 0)
  let x: number[] = []
  const volt = (n: number) => p.fixed.get(n) ?? (idx.has(n) ? x[idx.get(n)!] : 0)

  const solve = () => {
    const A = Array.from({ length: N }, () => new Array<number>(N).fill(0))
    const b = new Array<number>(N).fill(0)
    for (let i = 0; i < N; i++) A[i][i] = GMIN
    /** conductance g between a and c with series drop e: I(a→c) = g·(Va − Vc − e) */
    const stamp = (a: number, c: number, g: number, e: number) => {
      const i = idx.get(a), j = idx.get(c)
      if (i !== undefined) {
        A[i][i] += g; b[i] += g * e
        if (j !== undefined) A[i][j] -= g
        else b[i] += g * p.fixed.get(c)!
      }
      if (j !== undefined) {
        A[j][j] += g; b[j] -= g * e
        if (i !== undefined) A[j][i] -= g
        else b[j] += g * p.fixed.get(a)!
      }
    }
    for (const r of p.resistors) if (r.a !== r.b) stamp(r.a, r.b, 1 / r.r, 0)
    p.leds.forEach((l, k) => {
      if (l.a === l.b || l.open || !state[k]) return
      const m = ledModel(state[k], l.vf)
      stamp(l.a, l.b, m.g, m.e)
    })
    x = solveLinear(A, b)
  }
  const ledCurrent = (k: number) => {
    const l = p.leds[k]
    if (!state[k] || l.open) return 0
    const m = ledModel(state[k], l.vf)
    return m.g * (volt(l.a) - volt(l.b) - m.e)
  }

  const maxIter = 60 + p.leds.length * 4
  for (let iter = 0; iter < maxIter; iter++) {
    solve()
    const flips: { k: number; to: LedState; mag: number }[] = []
    p.leds.forEach((l, k) => {
      if (l.open || l.a === l.b) return
      const vd = volt(l.a) - volt(l.b)
      const i = ledCurrent(k)
      let to: LedState = state[k]
      if (state[k] === 0) { if (vd > l.vf + 1e-6) to = 1 }
      else if (state[k] === 1) to = i < -1e-9 ? 0 : i > LED_KNEE * 1.0001 ? 2 : 1
      else to = i < LED_KNEE * 0.9999 ? 1 : 2
      if (to !== state[k]) flips.push({ k, to, mag: Math.abs(vd - l.vf) })
    })
    if (!flips.length) break
    // after a few rounds flip one at a time, which cannot ping-pong in step
    if (iter > 10) { flips.sort((a, b) => b.mag - a.mag); flips.length = 1 }
    for (const f of flips) state[f.k] = f.to
  }

  const resistorI = p.resistors.map((r) => (r.a === r.b ? 0 : (volt(r.a) - volt(r.b)) / r.r))
  const ledI = p.leds.map((_, k) => Math.max(0, ledCurrent(k)))

  // floating detection: reach out from fixed nodes through conducting parts
  const adj = new Map<number, number[]>()
  const link = (a: number, b: number) => {
    adj.set(a, [...(adj.get(a) ?? []), b])
    adj.set(b, [...(adj.get(b) ?? []), a])
  }
  for (const r of p.resistors) link(r.a, r.b)
  p.leds.forEach((l, k) => { if (ledI[k] > 1e-8) link(l.a, l.b) })
  const reached = new Set<number>(p.fixed.keys())
  const queue = [...reached]
  while (queue.length) for (const n of adj.get(queue.pop()!) ?? []) if (!reached.has(n)) { reached.add(n); queue.push(n) }
  const v = Array.from({ length: p.nodes }, (_, n) => (reached.has(n) ? volt(n) : null))
  return {
    v,
    resistorI: resistorI.map((i, k) => (v[p.resistors[k].a] === null || v[p.resistors[k].b] === null || Math.abs(i) < 1e-10 ? 0 : i)),
    ledI: ledI.map((i) => (i < 1e-8 ? 0 : i)),
  }
}

/** Current that would flow if resistor k were replaced by a wire (Infinity = dead short). */
export function currentWithoutResistor(p: DCProblem, k: number): number {
  const s = solveDC({ ...p, resistors: p.resistors.map((r, i) => (i === k ? { ...r, r: 1e-4 } : r)) })
  const i = Math.abs(s.resistorI[k])
  return i > 5 ? Infinity : i
}
