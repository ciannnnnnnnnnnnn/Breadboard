/** Small helper for describing circuits in code (examples and tests). */
import { COLS, HOLES_BY_STRIP, HOLE_BY_ID, colX } from './breadboard'
import { LED_COLORS, occupiedHoles, placementError, pinsOf, TYPES } from './components'
import { ICS } from './ics'
import type { Circuit, Comp, CompProps, CompType } from './types'

export class Builder {
  c: Circuit = { components: [], wires: [] }
  private n = 0

  place(type: CompType, x: number, z: number, props: CompProps = {}, rot = 0): Comp {
    const comp: Comp = { id: `${type}${++this.n}`, type, x, z, rot, props: { ...TYPES[type].defaults, ...props } }
    const err = placementError(comp, this.c)
    if (err) throw new Error(`${comp.id}: ${err}`)
    this.c.components.push(comp)
    return comp
  }
  at(type: CompType, hole: string, props: CompProps = {}, rot = 0) {
    const h = HOLE_BY_ID.get(hole)
    if (!h) throw new Error(`no hole ${hole}`)
    return this.place(type, h.x, h.z, props, rot)
  }
  /** IC with pin 1 in column `col` */
  ic(part: string, col: number) {
    if (!ICS[part]) throw new Error(`no IC ${part}`)
    return this.place('ic', colX(col) + 3, 0, { part })
  }
  /** hole (or off-board terminal) of a component pin */
  pin(c: Comp, pin: string | number): string {
    const p = pinsOf(c).find((q) => q.name === String(pin))!
    return p.hole ?? p.strip
  }
  /** a free hole on the same strip; rails are written "tp@12" = near column 12 */
  private free(ref: string, towards: number): string {
    if (ref[0] === '@') return ref
    const occ = occupiedHoles(this.c)
    const m = /^((?:\d\.)?(?:tp|tn|bp|bn))@(\d+)$/.exec(ref)
    const strip = m ? m[1] : HOLE_BY_ID.get(ref)!.strip
    const list = HOLES_BY_STRIP.get(strip)!.filter((h) => !occ.has(h.id))
    if (!list.length) throw new Error(`strip ${strip} is full`)
    list.sort((a, b) => (m ? Math.abs(a.col - +m[2]) - Math.abs(b.col - +m[2]) : Math.abs(a.z - towards) - Math.abs(b.z - towards)))
    return list[0].id
  }
  private refZ(ref: string) {
    const m = /^((?:\d\.)?(?:tp|tn|bp|bn))@/.exec(ref)
    return m ? HOLES_BY_STRIP.get(m[1])![0].z : (HOLE_BY_ID.get(ref)?.z ?? 0)
  }
  wire(a: string, b: string, color = 'auto') {
    const from = this.free(a, this.refZ(b))
    const w = { id: `w${++this.n}`, from, to: from, color, bends: [] }
    this.c.wires.push(w) // reserves `from` while the other end is chosen
    w.to = this.free(b, this.refZ(a))
    return w
  }
  /** bench supply on the left, feeding all four rails */
  power(volts = 5) {
    const s = this.place('supply', -42, 0, { volts })
    this.wire(`@${s.id}.+`, 'tp@1')
    this.wire(`@${s.id}.−`, 'bn@1')
    this.wire(`tp@${COLS}`, `bp@${COLS}`)
    this.wire(`tn@${COLS - 1}`, `bn@${COLS - 1}`)
    return s
  }
  powerIC(c: Comp) {
    const def = ICS[c.props.part!]
    const v = this.pin(c, def.vcc), g = this.pin(c, def.gnd)
    this.wire(v, `tp@${HOLE_BY_ID.get(v)!.col}`)
    this.wire(g, `bn@${HOLE_BY_ID.get(g)!.col}`)
  }
  /** SPDT toggle (A = GND, B = VCC) starting at `col`; returns its COM hole */
  toggle(col: number, label: string, side: 'top' | 'bottom' = 'bottom') {
    const row = side === 'top' ? 'b' : 'i'
    const t = this.at('toggle', `${row}${col + 1}`, { label })
    const [p, n] = side === 'top' ? ['tp', 'tn'] : ['bp', 'bn']
    this.wire(this.pin(t, 'A'), `${n}@${col}`)
    this.wire(this.pin(t, 'B'), `${p}@${col + 2}`)
    return this.pin(t, 'COM')
  }
  /** series resistor + LED to ground, from bottom column `from` via column `node` */
  indicator(from: number, node: number, color = 'red', ohms = 330, row = 'h', label?: string) {
    this.at('resistor', `${row}${from}`, { ohms, span: node - from })
    return this.at('led', `j${node}`, { color, vf: LED_COLORS[color].vf, span: 3, label }, 1)
  }
}
