import { describe, expect, it } from 'vitest'
import { evalGate, truthTable } from './logic'

describe('gate evaluation', () => {
  it.each([
    ['NOT', [1, 0]], ['AND', [0, 0, 0, 1]], ['OR', [0, 1, 1, 1]], ['NAND', [1, 1, 1, 0]],
    ['NOR', [1, 0, 0, 0]], ['XOR', [0, 1, 1, 0]], ['XNOR', [1, 0, 0, 1]],
  ] as const)('%s truth table', (t, expected) => {
    expect(truthTable(t).map((r) => r.output)).toEqual(expected)
  })
  it('handles unknown inputs', () => {
    expect(evalGate('AND', [0, 'Z'])).toBe(0)
    expect(evalGate('AND', [1, 'Z'])).toBe('Z')
    expect(evalGate('OR', [1, 'Z'])).toBe(1)
    expect(evalGate('NAND', [0, 'Z'])).toBe(1)
    expect(evalGate('NOR', [1, 'Z'])).toBe(0)
    expect(evalGate('XOR', [1, 'Z'])).toBe('Z')
    expect(evalGate('NOT', ['Z'])).toBe('Z')
  })
})
