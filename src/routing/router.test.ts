import { describe, expect, it } from 'vitest'
import { Builder } from '../data/builder'
import { EXAMPLES } from '../data/examples'
import type { Circuit } from '../data/types'
import { textToDesign } from '../manual/expr'
import { synthesize } from '../manual/synthesize'
import { STEP, endXZ, obstacles, routeAll } from './router'

const adder = () => {
  let t = 'inputs: A0,A1,A2,A3,B0,B1,B2,B3,MODE\n'
  for (let i = 0; i < 4; i++) {
    const c = i ? `C${i}` : 'MODE'
    t += `X${i} = B${i} ^ MODE\nP${i} = A${i} ^ X${i}\nS${i} = P${i} ^ ${c}\nC${i + 1} = (A${i} * X${i}) + (${c} * P${i})\n`
  }
  return synthesize(textToDesign(t + "SIGN = MODE * C4'\noutputs: SIGN red, S3, S2, S1, S0")).circuit
}
/** independent check of the rules, not using the router's own grid */
function check(c: Circuit) {
  const routes = routeAll(c)
  expect(routes.size).toBe(c.wires.length)
  expect([...routes].filter(([, r]) => !r.clean).map(([id]) => id)).toEqual([])
  const rects = c.components.flatMap(obstacles)
  const lanes = new Map<string, string>()
  for (const w of c.wires) {
    const { points: p } = routes.get(w.id)!
    expect(p[0]).toEqual(endXZ(w.from, c))
    expect(p[p.length - 1]).toEqual(endXZ(w.to, c))
    for (let i = 0; i + 1 < p.length; i++) {
      const [x, z] = p[i], [X, Z] = p[i + 1]
      const nudge = i === 0 || i + 2 === p.length ? STEP : 0 // supply posts sit between grid lines
      expect(Math.min(Math.abs(X - x), Math.abs(Z - z))).toBeLessThanOrEqual(nudge / 2 + 1e-9)
      const horizontal = Math.abs(X - x) > Math.abs(Z - z)
      const n = Math.round(Math.max(Math.abs(X - x), Math.abs(Z - z)) / STEP)
      for (let k = 0; k <= n; k++) {
        const px = x + ((X - x) * k) / Math.max(1, n), pz = z + ((Z - z) * k) / Math.max(1, n)
        const atEnd = [p[0], p[p.length - 1]].some((e) => Math.hypot(e[0] - px, e[1] - pz) < STEP + 1e-6)
        if (!atEnd) for (const r of rects) expect(px > r.x0 && px < r.x1 && pz > r.z0 && pz < r.z1, `${w.id} crosses a part at ${px},${pz}`).toBe(false)
        const key = `${horizontal ? 'H' : 'V'}${Math.round(px / STEP)},${Math.round(pz / STEP)}`
        expect(lanes.get(key) ?? w.id, `lane ${key} is shared`).toBe(w.id)
        lanes.set(key, w.id)
      }
    }
  }
}

describe('tidy wiring', () => {
  it.each(EXAMPLES)('$name', ({ build }) => check(build()))
  it('a 26-gate, 8-chip, two-board adder', () => {
    const c = adder()
    const t = performance.now()
    check(c)
    console.log(`adder: ${c.wires.length} wires, checked in ${Math.round(performance.now() - t)} ms`)
  })
  it('goes through user bends and around a chip in the way', () => {
    const b = new Builder()
    b.ic('7408', 20)
    b.wire('c23', 'h23')
    const w = b.wire('a5', 'a15')
    b.c.wires[b.c.wires.indexOf(w)] = { ...w, bends: [[-27, -10]] }
    check(b.c)
    const r = routeAll(b.c)
    expect(r.get(b.c.wires[0].id)!.points.length).toBeGreaterThan(2)
    expect(r.get(b.c.wires[1].id)!.points.some(([, z]) => z <= -10)).toBe(true)
  })
})
