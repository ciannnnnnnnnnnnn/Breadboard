/** Problems and their highlights, derived (and cached) from the store. */
import type { Circuit } from '../data/types'
import { diagnose, type Problem } from '../simulation/diagnose'
import { simulateWithBurn, type Severity, type SimResult } from '../simulation/simulate'
import { useStore } from './useStore'

interface Diagnosis {
  problems: Problem[]
  comps: Map<string, Severity>
  wires: Map<string, Severity>
  /** "compId:pin" */
  pins: Map<string, Severity>
}
const index = (problems: Problem[]): Diagnosis => {
  const d: Diagnosis = { problems, comps: new Map(), wires: new Map(), pins: new Map() }
  const mark = (m: Map<string, Severity>, k: string, s: Severity) => { if (m.get(k) !== 'error') m.set(k, s) }
  for (const p of problems) {
    for (const c of p.comps) mark(d.comps, c, p.severity)
    for (const w of p.wires) mark(d.wires, w, p.severity)
    for (const q of p.pins) mark(d.pins, `${q.compId}:${q.pin}`, p.severity)
  }
  return d
}
const EMPTY = index([])
let last: { circuit: Circuit; sim: SimResult | null; checking: boolean; d: Diagnosis } | null = null

type S = ReturnType<typeof useStore.getState>
export function getDiagnosis(s: S): Diagnosis {
  if (last && last.circuit === s.circuit && last.sim === s.sim && last.checking === s.checking) return last.d
  let d = EMPTY
  if (s.sim) d = index(diagnose(s.circuit, s.sim, s.burned))
  else if (s.checking) {
    const { result, burned } = simulateWithBurn(s.circuit, {}, {})
    d = index(diagnose(s.circuit, result, burned))
  }
  last = { circuit: s.circuit, sim: s.sim, checking: s.checking, d }
  return d
}
/** highlight only the problem in focus when there is one, otherwise everything */
export const useDiagnosis = () => useStore(getDiagnosis)
const pick = (kind: 'comps' | 'wires' | 'pins', key: string) => (s: S): Severity | null => {
  const d = getDiagnosis(s)
  const active = s.activeProblem ? d.problems.find((p) => p.key === s.activeProblem) : undefined
  if (!active) return d[kind].get(key) ?? null
  const hit = kind === 'pins' ? active.pins.some((q) => `${q.compId}:${q.pin}` === key) : active[kind].includes(key)
  return hit ? active.severity : null
}
export const useProblemSeverity = (kind: 'comps' | 'wires' | 'pins', key: string) => useStore(pick(kind, key))
export const PROBLEM_COLOR: Record<Severity, string> = { error: '#ff3b4e', warning: '#ffb020' }
