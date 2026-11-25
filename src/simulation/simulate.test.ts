import { describe, expect, it } from 'vitest'
import { Builder } from '../data/builder'
import { EXAMPLES } from '../data/examples'
import { ICS, pinInfo, type GateType } from '../data/ics'
import { placementError } from '../data/components'
import { buildNetlist } from './netlist'
import { evalGate } from './logic'
import { simulate, simulateWithBurn, type SimResult } from './simulate'
import type { Circuit, Level } from '../data/types'

const PINOUTS: Record<string, [GateType, number[][]]> = {
  '7404': ['NOT', [[1, 2], [3, 4], [5, 6], [9, 8], [11, 10], [13, 12]]],
  '7408': ['AND', [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]]],
  '7432': ['OR', [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]]],
  '7400': ['NAND', [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]]],
  '7402': ['NOR', [[2, 3, 1], [5, 6, 4], [8, 9, 10], [11, 12, 13]]],
  '7486': ['XOR', [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]]],
  '74HC7266': ['XNOR', [[1, 2, 3], [5, 6, 4], [8, 9, 10], [12, 13, 11]]],
}
const setSwitch = (c: Circuit, label: string, on: boolean): Circuit => ({
  ...c, components: c.components.map((x) => (x.props.label === label ? { ...x, props: { ...x.props, on } } : x)),
})
const ledOn = (c: Circuit, label: string) => {
  const id = c.components.find((x) => x.type === 'led' && x.props.label === label)!.id
  return simulate(c).comps[id].current! > 0.001 ? 1 : 0
}
const hasWarning = (r: SimResult, re: RegExp) => r.warnings.some((w) => re.test(w.msg))

describe('IC pin mappings', () => {
  it.each(Object.entries(PINOUTS))('%s matches the datasheet', (part, [type, rows]) => {
    const d = ICS[part]
    expect(d.gateType).toBe(type)
    expect([d.vcc, d.gnd]).toEqual([14, 7])
    expect(d.gates.map((g) => [...g.inputs, g.output])).toEqual(rows)
    const roles = Array.from({ length: 14 }, (_, i) => pinInfo(d, i + 1).role)
    expect(roles).not.toContain('nc')
  })
  // every gate of every chip, every input combination, on a real breadboard
  it.each(Object.entries(PINOUTS))('%s works in circuit', (part, [type, rows]) => {
    for (const row of rows) {
      const ins = row.slice(0, -1), out = row[row.length - 1]
      for (let v = 0; v < 1 << ins.length; v++) {
        const b = new Builder()
        b.power()
        const u = b.ic(part, 20)
        b.powerIC(u)
        const bits = ins.map((p, k) => {
          const bit = ((v >> k) & 1) as 0 | 1
          b.at('input', b.pin(u, p).replace(/^e/, 'b').replace(/^f/, 'i'), { on: !!bit })
          return bit
        })
        expect(simulate(b.c).comps[u.id].pins[String(out)].level).toBe(evalGate(type, bits))
      }
    }
  })
})

describe('breadboard netlist', () => {
  it('joins 5-hole columns, splits at the channel, runs rails lengthwise', () => {
    const b = new Builder()
    const p = (h: string) => b.at('probe', h)
    const [a, e, f, t1, t2, n] = [p('a5'), p('e5'), p('f5'), p('tp1'), p('tp61'), p('tn1')]
    const nl = buildNetlist(b.c)
    const net = (c: { id: string }) => nl.netOf.get(nl.pins.get(c.id)!.IN.strip)
    expect(net(a)).toBe(net(e))
    expect(net(a)).not.toBe(net(f))
    expect(net(t1)).toBe(net(t2))
    expect(net(t1)).not.toBe(net(n))
  })
})

describe('examples', () => {
  it.each(EXAMPLES)('$name is legal and clean', ({ build }) => {
    const c = build()
    for (const x of c.components) expect(placementError(x, c)).toBeNull()
    for (let v = 0; v < 4; v++) {
      const s = simulate(setSwitch(setSwitch(c, 'Switch A', !!(v & 1)), 'Switch B', !!(v & 2)))
      expect(s.warnings).toEqual([])
      expect(s.overLeds).toEqual([])
    }
  })
  it('half adder adds', () => {
    const c = EXAMPLES.find((e) => e.id === 'adder')!.build()
    for (const a of [0, 1]) for (const q of [0, 1]) {
      const s = setSwitch(setSwitch(c, 'Switch A', !!a), 'Switch B', !!q)
      expect(ledOn(s, 'CARRY') * 2 + ledOn(s, 'SUM')).toBe(a + q)
    }
  })
  it('all-gates demo matches every truth table', () => {
    const c = EXAMPLES.find((e) => e.id === 'all7')!.build()
    for (const a of [0, 1] as const) for (const q of [0, 1] as const) {
      const s = setSwitch(setSwitch(c, 'Switch A', !!a), 'Switch B', !!q)
      for (const d of Object.values(ICS))
        expect(`${d.part}:${ledOn(s, `${d.part} X`)}`).toBe(`${d.part}:${evalGate(d.gateType, d.gateType === 'NOT' ? [a] : [a, q])}`)
    }
  })
})

describe('all gates from NAND', () => {
  it('uses only 7400 chips and matches every truth table', () => {
    const c = EXAMPLES.find((e) => e.id === 'nand7')!.build()
    const parts = new Set(c.components.filter((x) => x.type === 'ic').map((x) => x.props.part))
    expect([...parts]).toEqual(['7400'])
    for (const a of [0, 1] as const) for (const q of [0, 1] as const) {
      const s: Circuit = { ...c, components: c.components.map((x) => (x.type === 'dip4' ? { ...x, props: { ...x.props, switches: x.props.switches!.map((_, i) => !!(i === 0 ? a : i === 1 && q)) } } : x)) }
      for (const d of Object.values(ICS)) expect(`${d.gateType}:${ledOn(s, 'L_' + d.gateType)}`).toBe(`${d.gateType}:${evalGate(d.gateType, d.gateType === 'NOT' ? [a] : [a, q])}`)
    }
  })
})

describe('simulation behaviour', () => {
  const chip = (part: string, powerIt = true) => {
    const b = new Builder()
    b.power()
    const u = b.ic(part, 20)
    if (powerIt) b.powerIC(u)
    return { b, u }
  }
  it('unpowered IC floats and warns', () => {
    const { b, u } = chip('7404', false)
    b.at('input', 'i20', { on: true })
    const r = simulate(b.c)
    expect(r.comps[u.id].powered).toBe(false)
    expect(r.comps[u.id].pins['2'].level).toBe('Z')
    expect(hasWarning(r, /not powered/)).toBe(true)
  })
  it('detects a short circuit', () => {
    const b = new Builder()
    b.power()
    b.wire('tp@30', 'tn@30')
    expect(hasWarning(simulate(b.c), /Short circuit/)).toBe(true)
  })
  it('detects two outputs on one net', () => {
    const { b, u } = chip('7404')
    b.wire(b.pin(u, 2), b.pin(u, 4))
    expect(hasWarning(simulate(b.c), /Two outputs/)).toBe(true)
  })
  it('detects oscillation of a looped inverter', () => {
    const { b, u } = chip('7404')
    b.wire(b.pin(u, 1), b.pin(u, 2))
    const r = simulate(b.c)
    expect(hasWarning(r, /Oscillation/)).toBe(true)
    expect(r.comps[u.id].pins['2'].level).toBe('Z')
  })
  it('does not report oscillation for merely floating inputs', () => {
    expect(simulate(chip('7404').b.c).warnings).toEqual([])
  })
  it('NOR latch remembers its state', () => {
    const { b, u } = chip('7402')
    b.wire(b.pin(u, 1), b.pin(u, 5)) // Q to gate 2
    b.wire(b.pin(u, 4), b.pin(u, 3)) // not-Q to gate 1
    const R = b.at('input', 'i21'), S = b.at('input', 'i25')
    let state: Record<string, Level> = {}
    const q = (s: boolean, r: boolean) => {
      S.props.on = s; R.props.on = r
      const res = simulate(b.c, state)
      state = res.gateOut
      return res.comps[u.id].pins['1'].level
    }
    // pin 1 = NOR(R, not-Q) = Q
    expect([q(true, false), q(false, false), q(false, true), q(false, false)]).toEqual([1, 1, 0, 0])
  })
  it('pull-down resistor gives a clean 0 and the button a 1', () => {
    const b = new Builder()
    b.power()
    const s = b.place('button', -10, 0)
    b.wire(b.pin(s, '1a'), 'tp@20')
    b.at('resistor', 'j23', { ohms: 10000, span: 3 }, 1)
    const p = b.at('probe', 'h23')
    expect(simulate(b.c).comps[p.id].pins.IN.level).toBe(0)
    s.props.on = true
    expect(simulate(b.c).comps[p.id].pins.IN.level).toBe(1)
  })
  it('LED without a resistor burns', () => {
    const b = new Builder()
    b.power()
    b.wire('tp@10', 'a10')
    const led = b.at('led', 'c10', { span: 1 })
    b.wire('a11', 'tn@11')
    const { result, burned } = simulateWithBurn(b.c, {}, {})
    expect(burned[led.id]).toBeCloseTo(0.33, 2)
    expect(hasWarning(result, /burned/)).toBe(true)
  })
  it('330 Ω gives 9.09 mA in every series wire', () => {
    const q = new Builder()
    q.power()
    const w1 = q.wire('tp@10', 'a10')
    const r = q.at('resistor', 'c10', { ohms: 330, span: 4 })
    q.at('led', 'd14', { span: 1 })
    const w2 = q.wire('a15', 'tn@16')
    const s = simulate(q.c)
    const st = s.comps[r.id].resistor!
    expect(st.vin).toBe(5)
    expect(st.i * 1000).toBeCloseTo(9.09, 2)
    expect(st.vr).toBeCloseTo(3, 2)
    expect(st.iNo).toBeGreaterThan(0.3)
    expect(s.wires[w1.id].current * 1000).toBeCloseTo(9.09, 2)
    expect(s.wires[w2.id].current * 1000).toBeCloseTo(9.09, 2)
    expect(s.supplyCurrent * 1000).toBeCloseTo(9.09, 2)
  })
  it('warns when an IC output exceeds 20 mA', () => {
    const { b } = chip('7404')
    b.at('input', 'i20')
    b.at('resistor', 'j21', { ohms: 100, span: 3 }, 1)
    expect(hasWarning(simulate(b.c), /limit/)).toBe(true)
  })
  it('batteries in series add up', () => {
    const b = new Builder()
    const x = b.place('battery', -42, -8, { volts: 3 }), y = b.place('battery', -42, 8, { volts: 1.5 })
    b.wire(`@${x.id}.+`, `@${y.id}.−`)
    b.wire(`@${y.id}.+`, 'a5')
    const p = b.at('probe', 'b5')
    const r = simulate(b.c)
    expect(r.comps[p.id].pins.IN.v).toBeCloseTo(4.5)
    expect(r.warnings).toEqual([])
  })
})
