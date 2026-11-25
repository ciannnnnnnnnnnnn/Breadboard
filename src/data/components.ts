/** Component catalogue: palette entries, default properties and pin footprints. */
import { BOARD, BOARD_PITCH, HOLE_BY_ID, holeAt } from './breadboard'
import { ICS, pinXY, pinInfo } from './ics'
import type { Circuit, Comp, CompProps, CompType } from './types'

export const LED_MAX_MA = 20
export const IC_MAX_MA = 20
export const LED_COLORS: Record<string, { hex: string; vf: number }> = {
  red: { hex: '#ff2d2d', vf: 2.0 },
  orange: { hex: '#ff8a1f', vf: 2.0 },
  yellow: { hex: '#ffd91f', vf: 2.1 },
  green: { hex: '#2dff5e', vf: 2.1 },
  blue: { hex: '#2f7bff', vf: 3.0 },
  white: { hex: '#f4f7ff', vf: 3.0 },
}
export const RESISTOR_PRESETS = [100, 220, 330, 1000, 10000]
export const WIRE_COLORS: Record<string, string> = {
  red: '#d92b2b', black: '#23262b', blue: '#2767d8', yellow: '#e2bc1d',
  green: '#1f9d4a', white: '#e8e8e8', orange: '#e67a1e',
}

export interface PinSpec { name: string; dx: number; dz: number }
export interface PinPos { name: string; x: number; z: number; hole?: string; strip: string }
interface TypeDef {
  name: string
  defaults: CompProps
  offBoard?: boolean
  rotStep: 1 | 2
  pins: (p: CompProps) => PinSpec[]
  /** footprint used for selection boxes and off-board overlap */
  size: (p: CompProps) => { cx: number; cz: number; w: number; d: number; h: number }
}

const two = (a: string, b: string) => (p: CompProps): PinSpec[] => [
  { name: a, dx: 0, dz: 0 }, { name: b, dx: p.span ?? 4, dz: 0 },
]
export const TYPES: Record<CompType, TypeDef> = {
  supply: {
    name: 'DC Power Supply', defaults: { volts: 5 }, offBoard: true, rotStep: 1,
    pins: () => [{ name: '+', dx: 4.4, dz: -1.5 }, { name: '−', dx: 4.4, dz: 1.5 }],
    size: () => ({ cx: 0, cz: 0, w: 9, d: 8, h: 4 }),
  },
  battery: {
    name: 'Battery', defaults: { volts: 5 }, offBoard: true, rotStep: 1,
    pins: () => [{ name: '+', dx: 4.2, dz: -1 }, { name: '−', dx: 4.2, dz: 1 }],
    size: () => ({ cx: 0, cz: 0, w: 8.6, d: 5, h: 3 }),
  },
  gnd: {
    name: 'GND', defaults: {}, rotStep: 1, pins: () => [{ name: 'GND', dx: 0, dz: 0 }],
    size: () => ({ cx: 0, cz: 0, w: 1, d: 1, h: 2 }),
  },
  toggle: {
    name: 'Toggle Switch', defaults: { on: false }, rotStep: 1,
    pins: () => [{ name: 'A', dx: -1, dz: 0 }, { name: 'COM', dx: 0, dz: 0 }, { name: 'B', dx: 1, dz: 0 }],
    size: () => ({ cx: 0, cz: 0, w: 3, d: 1.4, h: 1.6 }),
  },
  button: {
    name: 'Push Button', defaults: { on: false }, rotStep: 2,
    pins: () => [
      { name: '1a', dx: -1, dz: -1.5 }, { name: '2a', dx: 1, dz: -1.5 },
      { name: '1b', dx: -1, dz: 1.5 }, { name: '2b', dx: 1, dz: 1.5 },
    ],
    size: () => ({ cx: 0, cz: 0, w: 3, d: 3.2, h: 1.5 }),
  },
  dip4: {
    name: 'DIP Switch', defaults: { switches: [false, false, false, false] }, rotStep: 2,
    pins: (p) => (p.switches ?? []).flatMap((_, i) => [
      { name: `${i + 1}a`, dx: i - 1, dz: -1.5 }, { name: `${i + 1}b`, dx: i - 1, dz: 1.5 },
    ]),
    size: (p) => ({ cx: (p.switches!.length - 1) / 2 - 1, cz: 0, w: p.switches!.length + 0.6, d: 3.2, h: 1.3 }),
  },
  input: {
    name: 'Logic Input', defaults: { on: false }, rotStep: 1, pins: () => [{ name: 'OUT', dx: 0, dz: 0 }],
    size: () => ({ cx: 0, cz: 0, w: 1.1, d: 1.1, h: 2.2 }),
  },
  led: {
    name: 'LED', defaults: { color: 'red', vf: 2, span: 1 }, rotStep: 1, pins: two('A', 'K'),
    size: (p) => ({ cx: (p.span ?? 1) / 2, cz: 0, w: Math.max(1.4, (p.span ?? 1) + 0.4), d: 1.3, h: 2.6 }),
  },
  probe: {
    name: 'Logic Probe', defaults: {}, rotStep: 1, pins: () => [{ name: 'IN', dx: 0, dz: 0 }],
    size: () => ({ cx: 0, cz: 0, w: 1.1, d: 1.1, h: 2.8 }),
  },
  resistor: {
    name: 'Resistor', defaults: { ohms: 330, span: 4 }, rotStep: 1, pins: two('1', '2'),
    size: (p) => ({ cx: (p.span ?? 4) / 2, cz: 0, w: (p.span ?? 4) + 0.5, d: 0.9, h: 1.1 }),
  },
  ic: {
    name: 'Logic IC', defaults: { part: '7408' }, rotStep: 2,
    pins: (p) => {
      const def = ICS[p.part!]
      return Array.from({ length: def.pinCount }, (_, i) => {
        const [x, y] = pinXY(def, i + 1)
        return { name: String(i + 1), dx: x, dz: -y }
      })
    },
    size: () => ({ cx: 0, cz: 0, w: 7.6, d: 3.4, h: 1.4 }),
  },
}

/** rotate an offset by rot × 90° (clockwise seen from above: +x → +z) */
export function rotate(x: number, z: number, rot: number): [number, number] {
  switch (((rot % 4) + 4) % 4) {
    case 1: return [-z, x]
    case 2: return [-x, -z]
    case 3: return [z, -x]
    default: return [x, z]
  }
}

export function pinsOf(c: Comp): PinPos[] {
  const t = TYPES[c.type]
  return t.pins(c.props).map((p) => {
    const [dx, dz] = rotate(p.dx, p.dz, c.rot)
    const x = c.x + dx, z = c.z + dz
    if (t.offBoard) return { name: p.name, x, z, strip: `@${c.id}.${p.name}` }
    const h = holeAt(x + 0, z + 0)
    return { name: p.name, x, z, hole: h?.id, strip: h?.strip ?? `?${c.id}.${p.name}` }
  })
}

/** Snap a free position so that the part's first pin falls on the hole lattice. */
export function snapPosition(c: Comp, x: number, z: number): { x: number; z: number } {
  const t = TYPES[c.type]
  if (t.offBoard) return { x: Math.round(x), z: Math.round(z) }
  const p = t.pins(c.props)[0]
  const [dx, dz] = rotate(p.dx, p.dz, c.rot)
  return { x: Math.round(x + dx) - dx, z: Math.round(z + dz - 0.5) + 0.5 - dz }
}

export function stripOfEnd(end: string): string {
  return end[0] === '@' ? end : (HOLE_BY_ID.get(end)?.strip ?? `?${end}`)
}

/** a real hole on a board this circuit has */
export const holeExists = (id: string, c: Circuit) => (HOLE_BY_ID.get(id)?.board ?? Infinity) < (c.boards ?? 1)

/** holes in use, mapped to the id of the part/wire using them */
export function occupiedHoles(c: Circuit, exceptId?: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const comp of c.components) {
    if (comp.id === exceptId) continue
    for (const p of pinsOf(comp)) if (p.hole) m.set(p.hole, comp.id)
  }
  for (const w of c.wires) {
    if (w.id === exceptId) continue
    for (const e of [w.from, w.to]) if (e[0] !== '@') m.set(e, w.id)
  }
  return m
}

/** null when legal, otherwise the reason the part cannot go there */
export function placementError(c: Comp, circuit: Circuit): string | null {
  const t = TYPES[c.type]
  if (t.offBoard) {
    const s = t.size(c.props)
    const [w, d] = c.rot % 2 ? [s.d, s.w] : [s.w, s.d]
    const hit = (x: number, z: number, hw: number, hd: number) => Math.abs(c.x - x) < w / 2 + hw && Math.abs(c.z - z) < d / 2 + hd
    for (let k = 0; k < (circuit.boards ?? 1); k++) if (hit(0, k * BOARD_PITCH, BOARD.width / 2, BOARD.depth / 2)) return 'Place this part beside the breadboard'
    for (const o of circuit.components) {
      if (o.id === c.id || !TYPES[o.type].offBoard) continue
      const os = TYPES[o.type].size(o.props)
      if (hit(o.x, o.z, (o.rot % 2 ? os.d : os.w) / 2, (o.rot % 2 ? os.w : os.d) / 2)) return 'Overlaps another part'
    }
    return null
  }
  const occ = occupiedHoles(circuit, c.id)
  for (const p of pinsOf(c)) {
    if (!p.hole || !holeExists(p.hole, circuit)) return c.type === 'ic' ? 'ICs must straddle the centre channel' : 'Every pin must sit in a hole'
    if (occ.has(p.hole)) return `Hole ${p.hole} is already in use`
  }
  if (c.type === 'ic') {
    const rows = new Set(pinsOf(c).map((p) => HOLE_BY_ID.get(p.hole!)!.row))
    if (!rows.has('e') || !rows.has('f')) return 'ICs must straddle the centre channel'
  }
  return null
}

/** permanent / closed internal contacts of switch-like parts (pairs of pin names) */
export function contacts(c: Comp): [string, string][] {
  switch (c.type) {
    case 'toggle': return [['COM', c.props.on ? 'B' : 'A']]
    case 'button': return [['1a', '1b'], ['2a', '2b'], ...(c.props.on ? [['1a', '2a'] as [string, string]] : [])]
    case 'dip4': return (c.props.switches ?? []).flatMap((s, i) => (s ? [[`${i + 1}a`, `${i + 1}b`] as [string, string]] : []))
    default: return []
  }
}

export function pinDescription(c: Comp, pin: string): string {
  if (c.type === 'ic') {
    const i = pinInfo(ICS[c.props.part!], Number(pin))
    const role = { vcc: 'power +5 V', gnd: 'ground', in: 'input', out: 'output', nc: 'not connected' }[i.role]
    return `Pin ${pin} · ${i.label} · ${role}`
  }
  const names: Record<string, string> = {
    A: c.type === 'led' ? 'Anode (+)' : 'Throw A (selected at 0)', K: 'Cathode (−)', COM: 'Common', B: 'Throw B (selected at 1)',
    '+': 'Positive terminal', '−': 'Negative terminal', GND: 'Ground reference (0 V)', OUT: 'Logic output', IN: 'Probe tip',
  }
  return names[pin] ?? `Pin ${pin}`
}

export function compTitle(c: Comp): string {
  if (c.props.label) return c.props.label
  if (c.type === 'ic') return `${c.props.part} ${ICS[c.props.part!].name}`
  if (c.type === 'resistor') return `${formatOhms(c.props.ohms!)} Resistor`
  if (c.type === 'led') return `${c.props.color![0].toUpperCase()}${c.props.color!.slice(1)} LED`
  return TYPES[c.type].name
}
export function formatOhms(r: number): string {
  const t = (n: number) => String(Number(n.toPrecision(4)))
  return r >= 1e6 ? `${t(r / 1e6)}MΩ` : r >= 1000 ? `${t(r / 1000)}kΩ` : `${t(r)}Ω`
}

export interface PaletteItem { key: string; type: CompType; name: string; hint: string; category: string; props: CompProps }
const item = (category: string, type: CompType, hint: string, props: CompProps = {}, name?: string): PaletteItem => ({
  key: type + JSON.stringify(props), category, type, hint, name: name ?? TYPES[type].name, props: { ...TYPES[type].defaults, ...props },
})
export const PALETTE: PaletteItem[] = [
  item('Power', 'supply', 'Adjustable bench supply'),
  item('Power', 'battery', 'Battery pack, 2 leads'),
  item('Power', 'gnd', '0 V reference, 1 pin'),
  item('Inputs', 'toggle', 'SPDT: A · COM · B'),
  item('Inputs', 'button', 'Momentary, 4 pins'),
  item('Inputs', 'dip4', 'Four independent contacts', {}, 'DIP Switch (4)'),
  item('Inputs', 'dip4', 'Eight independent contacts', { switches: Array(8).fill(false) }, 'DIP Switch (8)'),
  item('Inputs', 'input', 'Click to drive 0 / 1'),
  ...Object.keys(LED_COLORS).map((c) => item('Outputs', 'led', `Vf ${LED_COLORS[c].vf} V · max 20 mA`, { color: c, vf: LED_COLORS[c].vf }, `LED ${c}`)),
  item('Outputs', 'probe', 'Shows 0 / 1 / Z'),
  ...RESISTOR_PRESETS.map((r) => item('Passive', 'resistor', 'Value editable', { ohms: r }, `Resistor ${formatOhms(r)}`)),
  ...Object.values(ICS).map((d) => item('Logic ICs', 'ic', `${d.gates.length} × ${d.gateType} · DIP-14`, { part: d.part }, `${d.part} ${d.name}`)),
]
