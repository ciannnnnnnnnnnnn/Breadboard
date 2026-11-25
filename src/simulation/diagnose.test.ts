import { describe, expect, it } from 'vitest'
import { Builder } from '../data/builder'
import { EXAMPLES } from '../data/examples'
import type { Circuit } from '../data/types'
import { diagnose, recommendedResistor } from './diagnose'
import { simulateWithBurn } from './simulate'

const run = (c: Circuit) => {
  const { result, burned } = simulateWithBurn(c, {}, {})
  return diagnose(c, result, burned)
}
const find = (c: Circuit, prefix: string) => {
  const p = run(c).find((q) => q.key.startsWith(prefix + ':'))
  expect(p, `${prefix} not reported`).toBeDefined()
  expect(p!.why.length).toBeGreaterThan(20)
  expect(p!.fix.length).toBeGreaterThan(0)
  return p!
}
const chip = (part: string, powered = true) => {
  const b = new Builder()
  b.power()
  const u = b.ic(part, 20)
  if (powered) b.powerIC(u)
  return { b, u }
}

describe('diagnose', () => {
  it.each(EXAMPLES)('$name has no problems in any switch position', ({ build }) => {
    for (let v = 0; v < 4; v++) {
      const c = build()
      c.components.filter((x) => x.type === 'toggle').forEach((x, i) => { x.props.on = !!((v >> i) & 1) })
      expect(run(c)).toEqual([])
    }
  })
  it('short: highlights exactly the wire that joins the rails', () => {
    const b = new Builder()
    const s = b.place('supply', -42, 0)
    const w1 = b.wire(`@${s.id}.+`, 'tp@1'), w2 = b.wire(`@${s.id}.−`, 'tn@1')
    const bad = b.wire('tp@30', 'tn@30')
    b.wire('tp@40', 'a40')
    expect(find(b.c, 'short').wires.sort()).toEqual([w1.id, w2.id, bad.id].sort())
  })
  it('a short hides its knock-on symptoms', () => {
    const c = EXAMPLES[0].build()
    c.wires.push({ id: 'bad', from: 'tp31', to: 'tn31', color: 'auto', bends: [] })
    expect(run(c).map((p) => p.key.split(':')[0])).toEqual(['short'])
  })
  it('unpowered chip: points at the missing pin', () => {
    const { b, u } = chip('7404', false)
    b.wire(b.pin(u, 14), 'tp@20')
    const p = find(b.c, 'power')
    expect(p.pins).toEqual([{ compId: u.id, pin: '7' }])
    expect(p.fix[0]).toContain('pin 7')
  })
  it('output contention and output tied to a rail', () => {
    const a = chip('7404')
    const w = a.b.wire(a.b.pin(a.u, 2), a.b.pin(a.u, 4))
    expect(find(a.b.c, 'multi').wires).toEqual([w.id])
    const r = chip('7404')
    const x = r.b.wire(r.b.pin(r.u, 2), 'bn@21')
    expect(find(r.b.c, 'outshort').wires).toContain(x.id)
  })
  it('oscillation highlights the feedback wire', () => {
    const { b, u } = chip('7404')
    const w = b.wire(b.pin(u, 1), b.pin(u, 2))
    expect(find(b.c, 'osc').wires).toEqual([w.id])
  })
  it('burned LED: suggests a resistor, or a larger one', () => {
    const b = new Builder()
    b.power()
    b.wire('tp@10', 'a10')
    b.at('led', 'c10', { span: 1 })
    b.wire('a11', 'tn@11')
    expect(find(b.c, 'burn').fix[0]).toContain('220Ω')
    const q = new Builder()
    q.power()
    q.wire('tp@10', 'a10')
    const r = q.at('resistor', 'c10', { ohms: 100 })
    q.at('led', 'd14', { span: 1 })
    q.wire('a15', 'tn@16')
    expect(find(q.c, 'burn').comps).toContain(r.id)
  })
  it('backwards LED, loose leg, bypassed part', () => {
    const mk = (a: string, k: string) => {
      const b = new Builder()
      b.power()
      b.at('led', 'c10', { span: 1 })
      if (a) b.wire('a10', `${a}@10`)
      if (k) b.wire('a11', `${k}@11`)
      return b.c
    }
    find(mk('tn', 'tp'), 'rev')
    expect(find(mk('tp', ''), 'leg').pins[0].pin).toBe('K')
    const b = new Builder()
    b.at('resistor', 'f5', { span: 4 }, 1)
    find(b.c, 'bypass')
  })
  it('floating input behind an open button suggests a pull-down', () => {
    const { b, u } = chip('7404')
    const s = b.place('button', -25, 0)
    b.wire(b.pin(s, '1a'), 'tp@5')
    b.wire(b.pin(s, '2b'), b.pin(u, 1))
    const p = find(b.c, 'float')
    expect(p.pins).toEqual([{ compId: u.id, pin: '1' }])
    expect(p.fix[0]).toContain('pull-down')
  })
  it('unused gates and unknowns inherited from another gate are not reported', () => {
    const { b, u } = chip('7404')
    b.wire(b.pin(u, 2), b.pin(u, 3))
    expect(run(b.c).map((p) => p.key)).toEqual([`float:${u.id}:0`])
  })
  it('supply terminal left open', () => {
    const b = new Builder()
    const s = b.place('supply', -42, 0)
    b.wire(`@${s.id}.+`, 'tp@1')
    b.at('probe', 'c5')
    expect(find(b.c, 'loose').pins).toEqual([{ compId: s.id, pin: '−' }])
  })
  it('recommended resistor', () => {
    expect(recommendedResistor(5, 2)).toBe(220)
    expect(recommendedResistor(5, 3)).toBe(150)
  })
})
