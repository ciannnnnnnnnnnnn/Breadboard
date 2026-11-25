import { beforeEach, describe, expect, it } from 'vitest'
import { EXAMPLES } from '../data/examples'
import { useStore } from '../store/useStore'
import { TOOLS, checkCall, describeCircuit, toolParams } from './tools'

const s = () => useStore.getState()
const run = (name: string, input: unknown) => {
  const c = checkCall(name, input)
  return c.tool.run(c.input)
}
beforeEach(() => { s().stop(); s().load(EXAMPLES[1].build(), 'AND') })

describe('assistant tools', () => {
  it('describes the circuit', () => {
    const t = describeCircuit()
    expect(t).toMatch(/7408 powered/)
    expect(t).toMatch(/PROBLEMS\nnone found/)
  })
  it('tries inputs without touching the board', () => {
    const before = s().circuit
    const r = run('try_inputs', { cases: [0, 1, 2, 3].map((k) => `Switch A=${k & 1}, Switch B=${k >> 1}`) })
    expect(r.split('\n').map((l) => /: (on|off)/.exec(l)![1])).toEqual(['off', 'off', 'off', 'on'])
    expect(s().circuit).toBe(before)
  })
  it('sets switches to a value, including on a DIP', () => {
    run('set_switch', { name: 'Switch A', on: true })
    run('set_switch', { name: 'Switch A', on: true })
    expect(s().circuit.components.find((c) => c.props.label === 'Switch A')!.props.on).toBe(true)
    run('build_circuit', { spec: 'title: t\ninputs: A, B\nF = A AND B\noutputs: F' })
    run('set_switch', { name: 'B', on: true })
    run('set_switch', { name: 'B', on: true })
    expect(s().circuit.components.find((c) => c.type === 'dip4')!.props.switches![1]).toBe(true)
    expect(run('set_switch', { name: 'A', on: true })).toMatch(/F .*: on/)
  })
  it('edits: wire, part, value, remove, all undoable', () => {
    const n = s().circuit.components.length
    run('add_part', { type: 'ic', hole: 'f50', part: '7404' })
    const ic = s().circuit.components.at(-1)!
    expect(run('inspect_circuit', {})).toContain(`1(1A)@f50`)
    run('add_wire', { from: 'a50', to: 'tp50' })
    run('add_part', { type: 'resistor', hole: 'j61', rotation: 1, span: 3, ohms: 470 })
    const r = s().circuit.components.at(-1)!
    run('change_part', { id: r.id, ohms: 1000 })
    expect(s().circuit.components.at(-1)!.props.ohms).toBe(1000)
    run('remove', { id: ic.id })
    expect(s().circuit.components.length).toBe(n + 1)
    for (let i = 0; i < 5; i++) s().undo()
    expect(s().circuit.components.length).toBe(n)
  })
  it('explains occupied and missing holes', () => {
    const w = s().circuit.wires.find((x) => x.from[0] !== '@')!
    expect(() => run('add_wire', { from: w.from, to: 'a60' })).toThrow(/Free holes/)
    expect(() => run('add_wire', { from: '2.a1', to: 'a60' })).toThrow(/no hole/)
    expect(() => run('add_wire', { from: '@nope.+', to: 'a60' })).toThrow(/no terminal/)
    expect(() => run('add_part', { type: 'ic', hole: 'h50', part: '7404' })).toThrow(/channel|hole/)
  })
  it('rejects malformed calls', () => {
    expect(() => checkCall('toString', {})).toThrow(/no tool/)
    expect(() => checkCall('remove', null)).toThrow(/object/)
    expect(() => checkCall('remove', {})).toThrow(/required/)
    expect(() => checkCall('remove', { id: 'x', extra: 1 })).toThrow(/not a field/)
    expect(() => run('change_part', { id: s().circuit.components[0].id, volts: 'lots' })).toThrow(/number/)
    expect(() => run('build_circuit', { spec: 'inputs: A\nF = A +\noutputs: F' })).toThrow(/Line 2/)
  })
  it('everything that edits asks first', () => {
    for (const n of ['add_wire', 'add_part', 'change_part', 'remove', 'build_circuit']) expect(TOOLS[n].confirm).toBeDefined()
    expect(toolParams.length).toBe(Object.keys(TOOLS).length)
  })
})
