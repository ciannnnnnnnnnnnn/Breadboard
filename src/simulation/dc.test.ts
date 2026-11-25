import { describe, expect, it } from 'vitest'
import { currentWithoutResistor, seriesCurrent, solveDC, type DCProblem } from './dc'
import { bandDigits } from './resistor'

// node 0 = GND, 1 = 5 V, 2.. = unknown
const prob = (o: Partial<DCProblem>): DCProblem => ({ nodes: 4, fixed: new Map([[0, 0], [1, 5]]), resistors: [], leds: [], ...o })

describe("Ohm's law", () => {
  it('series formula', () => expect(seriesCurrent(5, 2, 330)).toBeCloseTo(0.0090909, 6))
  it.each([220, 330, 1000, 10000])('LED through %i Ω', (r) => {
    const s = solveDC(prob({ resistors: [{ a: 1, b: 2, r }], leds: [{ a: 2, b: 0, vf: 2 }] }))
    expect(s.ledI[0]).toBeCloseTo(3 / r, 5)
    expect(s.resistorI[0]).toBeCloseTo(s.ledI[0], 9) // same current before and after
    expect(s.v[2]).toBeCloseTo(2, 3)
  })
  it('voltage divider', () => {
    const s = solveDC(prob({ resistors: [{ a: 1, b: 2, r: 1000 }, { a: 2, b: 0, r: 4000 }] }))
    expect(s.v[2]).toBeCloseTo(4, 6)
    expect(s.resistorI[0]).toBeCloseTo(0.001, 8)
  })
  it('reverse LED blocks', () => {
    const s = solveDC(prob({ resistors: [{ a: 1, b: 2, r: 330 }], leds: [{ a: 0, b: 2, vf: 2 }] }))
    expect(s.ledI[0]).toBe(0)
    expect(s.v[2]).toBeCloseTo(5, 6)
  })
  it('two LEDs in series and in parallel', () => {
    const ser = solveDC(prob({ resistors: [{ a: 1, b: 2, r: 100 }], leds: [{ a: 2, b: 3, vf: 2 }, { a: 3, b: 0, vf: 2 }] }))
    expect(ser.ledI[0]).toBeCloseTo(0.01, 4)
    expect(ser.ledI[1]).toBeCloseTo(ser.ledI[0], 8)
    const par = solveDC(prob({ resistors: [{ a: 1, b: 2, r: 300 }], leds: [{ a: 2, b: 0, vf: 2 }, { a: 2, b: 0, vf: 2 }] }))
    expect(par.ledI[0] + par.ledI[1]).toBeCloseTo(0.01, 4)
  })
  it('lowest Vf wins between parallel LEDs', () => {
    const s = solveDC(prob({ resistors: [{ a: 1, b: 2, r: 300 }], leds: [{ a: 2, b: 0, vf: 3 }, { a: 2, b: 0, vf: 2 }] }))
    expect(s.ledI[0]).toBe(0)
    expect(s.ledI[1]).toBeCloseTo(0.01, 4)
  })
  it('floating nodes are null', () => {
    const s = solveDC(prob({ resistors: [{ a: 2, b: 3, r: 100 }], leds: [{ a: 1, b: 2, vf: 2 }] }))
    expect(s.v[2]).toBeNull()
    expect(s.v[3]).toBeNull()
  })
  it('current without the resistor', () => {
    const p = prob({ resistors: [{ a: 1, b: 2, r: 330 }], leds: [{ a: 2, b: 0, vf: 2 }] })
    expect(currentWithoutResistor(p, 0)).toBeCloseTo(0.33, 3)
    expect(currentWithoutResistor(prob({ resistors: [{ a: 1, b: 0, r: 1000 }] }), 0)).toBe(Infinity)
  })
})

describe('colour bands', () => {
  it.each([[100, 1, 0, 1], [220, 2, 2, 1], [330, 3, 3, 1], [1000, 1, 0, 2], [10000, 1, 0, 3], [4.7, 4, 7, -1]])('%d Ω', (r, d1, d2, exp) => {
    expect(bandDigits(r)).toEqual({ d1, d2, exp })
  })
})
