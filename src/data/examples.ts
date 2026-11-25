import { textToDesign } from '../manual/expr'
import { synthesize } from '../manual/synthesize'
import { Builder } from './builder'
import type { Circuit } from './types'

export interface Example { id: string; name: string; description: string; build: () => Circuit }

export const EXAMPLES: Example[] = [
  {
    id: 'not', name: 'NOT gate with LED', description: '7404: the LED is on while the switch is at 0',
    build() {
      const b = new Builder()
      b.power()
      const a = b.toggle(9, 'Switch A')
      const u = b.ic('7404', 20)
      b.powerIC(u)
      b.wire(a, b.pin(u, 1), 'blue')
      b.wire(b.pin(u, 2), 'f32', 'yellow')
      b.indicator(32, 37, 'red', 330, 'h', 'NOT A')
      return b.c
    },
  },
  {
    id: 'and', name: 'AND gate with 2 switches', description: '7408: the LED needs A = 1 and B = 1',
    build() {
      const b = new Builder()
      b.power()
      const a = b.toggle(7, 'Switch A')
      const q = b.toggle(13, 'Switch B')
      const u = b.ic('7408', 22)
      b.powerIC(u)
      b.wire(a, b.pin(u, 1), 'blue')
      b.wire(q, b.pin(u, 2), 'orange')
      b.wire(b.pin(u, 3), 'f34', 'yellow')
      b.indicator(34, 39, 'green', 330, 'h', 'A AND B')
      return b.c
    },
  },
  {
    id: 'adder', name: 'XOR half adder (7486 + 7408)', description: 'SUM = A⊕B, CARRY = A·B',
    build() {
      const b = new Builder()
      b.power()
      const a = b.toggle(5, 'Switch A')
      const q = b.toggle(10, 'Switch B')
      const x = b.ic('7486', 18)
      const n = b.ic('7408', 30)
      b.powerIC(x)
      b.powerIC(n)
      b.wire(a, b.pin(x, 1), 'blue')
      b.wire(q, b.pin(x, 2), 'orange')
      b.wire(b.pin(x, 1), b.pin(n, 1), 'blue')
      b.wire(b.pin(x, 2), b.pin(n, 2), 'orange')
      b.wire(b.pin(x, 3), 'f42', 'yellow')
      b.wire(b.pin(n, 3), 'f51', 'white')
      b.indicator(42, 47, 'green', 330, 'h', 'SUM')
      b.indicator(51, 56, 'red', 330, 'h', 'CARRY')
      return b.c
    },
  },
  {
    id: 'all7', name: 'All 7 gates demo', description: 'Two switches drive one gate of every chip',
    build() {
      const b = new Builder()
      b.power()
      let prevA = b.toggle(2, 'Switch A', 'top')
      let prevB = b.toggle(2, 'Switch B', 'bottom')
      const chips: [part: string, inputs: number[], outColumn: number, led: string][] = [
        ['7404', [1], 1, 'red'], ['7408', [1, 2], 2, 'orange'], ['7432', [1, 2], 2, 'yellow'], ['7400', [1, 2], 2, 'green'],
        ['7402', [2, 3], 0, 'blue'], ['7486', [1, 2], 2, 'white'], ['74HC7266', [1, 2], 2, 'red'],
      ]
      chips.forEach(([part, ins, out, color], k) => {
        const s = 6 + 8 * k
        const u = b.ic(part, s)
        b.powerIC(u)
        // resistor and LED first, so wires only use the holes that are left over
        b.indicator(s + out, s + 7, color, 330, 'i', `${part} X`)
        b.wire(prevA, b.pin(u, ins[0]), 'blue')
        prevA = b.pin(u, ins[0])
        if (ins.length > 1) {
          b.wire(prevB, b.pin(u, ins[1]), 'orange')
          prevB = b.pin(u, ins[1])
        }
      })
      return b.c
    },
  },
  {
    id: 'nand7', name: 'All 7 gates from NAND only', description: 'Every gate built from 7400 chips. Set A and B on the DIP switch',
    build: () => synthesize(textToDesign(`title: All 7 gates from NAND only
inputs: A, B
NA = A NAND A
NB = B NAND B
L_NAND = A NAND B
L_AND = L_NAND NAND L_NAND
L_OR = NA NAND NB
L_NOR = L_OR NAND L_OR
M1 = A NAND L_NAND
M2 = B NAND L_NAND
L_XOR = M1 NAND M2
L_XNOR = L_XOR NAND L_XOR
L_NOT = NA
outputs: L_NOT red, L_AND orange, L_OR yellow, L_NAND green, L_NOR blue, L_XOR white, L_XNOR red`)).circuit,
  },
]
