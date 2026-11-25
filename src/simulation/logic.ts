/** Three-valued gate evaluation. 'Z' stands for floating / unknown. */
import type { GateType } from '../data/ics'
import type { Level } from '../data/types'

const not = (a: Level): Level => (a === 'Z' ? 'Z' : a ? 0 : 1)
const and = (v: Level[]): Level => (v.includes(0) ? 0 : v.includes('Z') ? 'Z' : 1)
const or = (v: Level[]): Level => (v.includes(1) ? 1 : v.includes('Z') ? 'Z' : 0)
const xor = (v: Level[]): Level => (v.includes('Z') ? 'Z' : (v.filter((x) => x === 1).length % 2 as 0 | 1))

export function evalGate(type: GateType, inputs: Level[]): Level {
  switch (type) {
    case 'NOT': return not(inputs[0])
    case 'AND': return and(inputs)
    case 'OR': return or(inputs)
    case 'NAND': return not(and(inputs))
    case 'NOR': return not(or(inputs))
    case 'XOR': return xor(inputs)
    case 'XNOR': return not(xor(inputs))
  }
}

export function truthTable(type: GateType): { inputs: (0 | 1)[]; output: Level }[] {
  const rows: (0 | 1)[][] = type === 'NOT' ? [[0], [1]] : [[0, 0], [0, 1], [1, 0], [1, 1]]
  return rows.map((inputs) => ({ inputs, output: evalGate(type, inputs) }))
}
