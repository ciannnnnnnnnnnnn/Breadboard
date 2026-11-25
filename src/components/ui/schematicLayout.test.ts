import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../../data/examples'
import { layoutSchematic } from './schematicLayout'

describe('schematic layout', () => {
  it.each(EXAMPLES)('$name: nothing overlaps and signals flow left to right', ({ build }) => {
    const s = layoutSchematic(build())
    for (const a of s.elems) for (const b of s.elems) {
      if (a === b || a.x !== b.x) continue
      expect(a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
    }
    const rank = (k: string) => Math.max(...s.elems.filter((e) => e.kind === k).map((e) => e.rank))
    if (s.elems.some((e) => e.kind === 'toggle')) expect(rank('toggle')).toBeLessThan(rank('gate'))
    expect(rank('gate')).toBeLessThan(rank('resistor'))
    expect(rank('resistor')).toBeLessThan(rank('led'))
  })
  it('draws the same nets whichever way a switch is thrown', () => {
    const c = EXAMPLES[0].build()
    const before = layoutSchematic(c).routes.length
    c.components.find((x) => x.type === 'toggle')!.props.on = true
    expect(layoutSchematic(c).routes.length).toBe(before)
  })
})
