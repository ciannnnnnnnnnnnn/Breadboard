import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { placementError } from '../data/components'
import { simulateWithBurn } from '../simulation/simulate'
import { diagnose } from '../simulation/diagnose'
import { analyze, minimize } from './analyze'
import { readDocx, readText } from './document'
import { designToText, evaluate, parseExpr, textToDesign } from './expr'
import { chooseGates, runTests, synthesize, toGates } from './synthesize'

const ADDER = `Lab 4: 4-bit Ripple-Carry Adder/Subtractor
Sum = A ⊕ B ⊕ Cin from two XOR gates, and Cout = (A·B) + (Cin·(A ⊕ B)) from two AND gates and one OR gate.
Four jumbo green LEDs show the result. Light a jumbo red sign LED when MODE = 1 and the final carry C4 = 0.
Parts: 74HC86 × 3, 74HC08 × 3, 74HC32 × 1, 74HC04 × 1. 10 kΩ × 9 (switch pull-down), 330 Ω × 5 (LED series)

| Stage | A input | B input | Carry-in | Sum LED |
| Bit 0 | A0 | B0 ⊕ MODE | C0 = MODE | S0 |
| Bit 1 | A1 | B1 ⊕ MODE | Cout of bit 0 | S1 |
| Bit 2 | A2 | B2 ⊕ MODE | Cout of bit 1 | S2 |
| Bit 3 | A3 | B3 ⊕ MODE | Cout of bit 2 | S3 |

| Mode | A (dec / bin) | B (dec / bin) | Expected result (bin) | LEDs | Sign LED (red) |
| ADD | 3 / 0011 | 5 / 0101 | 1000 | | Off |
| ADD | 15 / 1111 | 1 / 0001 | 10000 | | Off |
| SUB | 5 / 0101 | 9 / 1001 | 1100 | | On |
`
const TABLE = (extra: string) => `Lab 2: Indicator
${extra}
drive a red HOLD LED from the same signal inverted. green PROCEED LED.

| A | B | C | D | F (allowed?) | Reason |
${Array.from({ length: 16 }, (_, m) => `| ${[3, 2, 1, 0].map((b) => (m >> b) & 1).join(' | ')} | ${[13, 14, 15].includes(m) ? 1 : 0} | because |`).join('\n')}
`
const build = (text: string) => {
  const a = analyze(readText(text), 'x.txt')
  const d = textToDesign(designToText(a.design!)) // through the editable form, like the UI
  const r = synthesize(d, { parts: a.parts, ledOhms: a.ledOhms, pullOhms: a.pullOhms })
  return { a, d, r, results: runTests(r, a.tests, d.outputs.map((o) => o.name)) }
}
const clean = (r: ReturnType<typeof synthesize>) => {
  const { result, burned } = simulateWithBurn(r.circuit, {}, {})
  expect(diagnose(r.circuit, result, burned)).toEqual([])
  for (const c of r.circuit.components) expect(placementError(c, r.circuit)).toBeNull()
  const ends = r.circuit.wires.flatMap((w) => [w.from, w.to]).filter((e) => e[0] !== '@')
  expect(new Set(ends).size).toBe(ends.length)
}

describe('expressions', () => {
  it.each([
    ["A·B + C'", { A: 1, B: 1, C: 1 }, 1], ["AB'", { AB: 0 }, 1], ['A ⊕ B ⊕ C', { A: 1, B: 1, C: 1 }, 1],
    ['A NAND B', { A: 1, B: 1 }, 0], ['NOT (A OR B)', { A: 0, B: 0 }, 1], ['C̄ · D', { C: 0, D: 1 }, 1], ['A XNOR B', { A: 1, B: 1 }, 1],
  ])('%s', (s, env, out) => expect(evaluate(parseExpr(s), env as any)).toBe(out))
  it('reports mistakes by line', () => {
    expect(() => textToDesign('inputs: A\nF = A +\noutputs: F')).toThrow(/Line 2/)
    expect(() => textToDesign('inputs: A\nF = A + Q\noutputs: F')).toThrow(/"Q"/)
    expect(() => textToDesign('inputs: A\nF = NOT A\nF = A\noutputs: F')).toThrow(/twice/)
  })
})

describe('adder manual', () => {
  const { a, d, r, results } = build(ADDER)
  it('reads the design', () => {
    expect(a.method).toMatch(/adder/)
    expect(d.inputs).toEqual(['A0', 'A1', 'A2', 'A3', 'B0', 'B1', 'B2', 'B3', 'MODE'])
    expect(d.outputs.map((o) => `${o.name}:${o.color}`)).toEqual(['SIGN:red', 'S3:green', 'S2:green', 'S1:green', 'S0:green'])
    expect([a.ledOhms, a.pullOhms]).toEqual([330, 10000])
  })
  it('uses exactly the chips the manual lists', () => {
    const n = (t: string) => r.gates.filter((g) => g.type === t).length
    expect([n('XOR'), n('AND'), n('OR'), n('NOT')]).toEqual([12, 9, 4, 1])
    for (const p of a.parts) expect(r.packages.filter((q) => q.part === p.part).length).toBe(p.qty)
    expect(r.boards).toBe(2)
  })
  it('builds a clean circuit that passes the manual tests', () => {
    clean(r)
    expect(results.length).toBe(3)
    expect(results.filter((x) => !x.pass)).toEqual([])
  })
  it('is right for all 512 switch settings', () => {
    const bit = (n: number, i: number) => ((n >> i) & 1) as 0 | 1
    const tests = Array.from({ length: 512 }, (_, k) => {
      const A = k & 15, B = (k >> 4) & 15, m = k >> 8
      const y = m ? A - B : A + B
      const set: any = { MODE: m }, expect: any = { SIGN: m && A < B ? 1 : 0 }
      for (let i = 0; i < 4; i++) { set[`A${i}`] = bit(A, i); set[`B${i}`] = bit(B, i); expect[`S${i}`] = bit(y & 15, i) }
      return { label: `${A} ${m ? '-' : '+'} ${B}`, set, expect }
    })
    expect(runTests(r, tests, d.outputs.map((o) => o.name)).filter((x) => !x.pass)).toEqual([])
  }, 120000)
})

describe('truth-table manual', () => {
  it('canonical SOP on request, with the manual chip count', () => {
    const { a, r, results } = build(TABLE('Build the canonical sum of products. 74HC08 × 3, 74HC32 × 1, 74HC04 × 1'))
    expect(a.method).toBe('Truth table')
    expect(r.gates.filter((g) => g.type === 'AND').length).toBe(9)
    expect(r.packages.length).toBe(5)
    clean(r)
    expect(results.length).toBe(16)
    expect(results.every((x) => x.pass)).toBe(true)
  })
  it('simplified otherwise', () => {
    const { r, results } = build(TABLE(''))
    expect(r.gates.filter((g) => g.type === 'AND').length).toBeLessThan(6)
    expect(results.every((x) => x.pass)).toBe(true)
  })
  it('minimize is equivalent for every 3-input function', () => {
    for (let f = 1; f < 255; f++) {
      const ones = [0, 1, 2, 3, 4, 5, 6, 7].filter((m) => (f >> m) & 1)
      const e = minimize(['A', 'B', 'C'], ones)
      for (let m = 0; m < 8; m++) expect(evaluate(e, { A: m >> 2, B: (m >> 1) & 1, C: m & 1 })).toBe((f >> m) & 1)
    }
  })
})

describe('other manuals', () => {
  it('plain equations', () => {
    const { a, r } = build("Experiment 1: Gates\nBuild the function F = A·B + C' on the board.\nG = A ⊕ B.")
    expect(a.method).toBe('Boolean equations')
    expect(a.design!.inputs).toEqual(['A', 'B', 'C'])
    clean(r)
  })
  it('ignores prose and unrelated files', () => {
    expect(analyze(readText('Set R = 330 ohms. V = the supply voltage. X = measured value'), 'a.txt').design).toBeNull()
    expect(() => readDocx(new Uint8Array([1, 2, 3]))).toThrow(/not a readable/)
  })
  it('outputs that copy a signal, and NAND/NOR/XNOR chips', () => {
    const d = textToDesign('inputs: A, B\nX = A NAND B\nY = X\nZ = A NOR B\nW = A XNOR B\noutputs: X, Y red, Z blue, W, A white')
    clean(synthesize(d))
  })
  it('refuses a circuit too large for the boards', () => {
    const n = 40
    const d = textToDesign(`inputs: ${Array.from({ length: 20 }, (_, i) => `A${i}`).join()}\n${Array.from({ length: n }, (_, i) => `F${i} = A${i % 20} NAND A${(i + 1 + (i > 19 ? 1 : 0)) % 20}`).join('\n')}\noutputs: ${Array.from({ length: n }, (_, i) => `F${i}`).join()}`)
    expect(() => synthesize(d)).toThrow(/breadboards/)
  })
  it('term sharing follows the parts list', () => {
    const d = textToDesign("inputs: A, B, C\nF = A·B·C + A·B·C'\noutputs: F")
    expect(toGates(d, true).length).toBeLessThan(toGates(d, false).length)
    expect(chooseGates(d, []).shared).toBe(true)
  })
})

const REAL = 'ITPE121_Lab_BB4_4_bit_Ripple_Carry_Adder_Subtractor_Built_from_Basic.docx'
describe.skipIf(!fs.existsSync(REAL))('the real BB4 manual', () => {
  it('builds and passes its own eight test cases', () => {
    const a = analyze(readDocx(new Uint8Array(fs.readFileSync(REAL))), REAL)
    const d = textToDesign(designToText(a.design!))
    const r = synthesize(d, { parts: a.parts, ledOhms: a.ledOhms, pullOhms: a.pullOhms })
    expect(a.parts.map((p) => `${p.part}x${p.qty}`)).toEqual(['7486x3', '7408x3', '7432x1', '7404x1'])
    expect(a.notes).toEqual([])
    expect(d.outputs.map((o) => `${o.name}:${o.color}`)).toEqual(['SIGN:red', 'S3:green', 'S2:green', 'S1:green', 'S0:green'])
    expect(r.packages.length).toBe(8)
    expect(a.boards).toBe(2)
    clean(r)
    const res = runTests(r, a.tests, d.outputs.map((o) => o.name))
    expect(res.length).toBe(8)
    expect(res.filter((x) => !x.pass)).toEqual([])
  })
})
