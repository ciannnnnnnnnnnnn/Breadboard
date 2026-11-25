/**
 * Integrated-circuit catalogue. This is the ONLY place an IC is described:
 * the simulator, 3D renderer, schematic, pinout tooltip and truth table all
 * read from these entries. To add a 14-pin gate chip, add one entry.
 *
 * Chip coordinates: x runs along the body (pin 1 at -3 … pin 7 at +3),
 * y points from the pin 1–7 side (negative) to the pin 8–14 side (positive).
 */
export type GateType = 'NOT' | 'AND' | 'OR' | 'NAND' | 'NOR' | 'XOR' | 'XNOR'

export interface GateDef {
  inputs: number[]
  output: number
  /** centre of the gate symbol in chip coordinates */
  at: [number, number]
  /** +1: output points right, -1: output points left */
  face: 1 | -1
}

export interface ICDef {
  part: string
  name: string
  gateType: GateType
  pinCount: 14
  vcc: number
  gnd: number
  gates: GateDef[]
}

/** shorthand for a table row: input pins, output pin, symbol position, direction */
const g = (inputs: number[], output: number, x: number, y: number, face: 1 | -1 = 1): GateDef =>
  ({ inputs, output, at: [x, y], face })

const Y = 0.6
/** layout shared by 7400 / 7408 / 7432 / 7486 (top-row outputs sit left of their inputs) */
const standardQuad = (): GateDef[] => [
  g([1, 2], 3, -1.8, -Y), g([4, 5], 6, 1.2, -Y),
  g([9, 10], 8, 2.2, Y), g([12, 13], 11, -0.8, Y),
]
const chip = (part: string, name: string, gateType: GateType, gates: GateDef[]): ICDef =>
  ({ part, name, gateType, pinCount: 14, vcc: 14, gnd: 7, gates })

export const ICS: Record<string, ICDef> = Object.fromEntries(
  [
    chip('7404', 'Hex NOT', 'NOT', [
      g([1], 2, -2.5, -Y), g([3], 4, -0.5, -Y), g([5], 6, 1.5, -Y),
      g([9], 8, 2.5, Y), g([11], 10, 0.5, Y), g([13], 12, -1.5, Y),
    ]),
    chip('7408', 'Quad AND', 'AND', standardQuad()),
    chip('7432', 'Quad OR', 'OR', standardQuad()),
    chip('7400', 'Quad NAND', 'NAND', standardQuad()),
    chip('7402', 'Quad NOR', 'NOR', [
      g([2, 3], 1, -2.2, -Y, -1), g([5, 6], 4, 0.8, -Y, -1),
      g([8, 9], 10, 1.8, Y, -1), g([11, 12], 13, -1.2, Y, -1),
    ]),
    chip('7486', 'Quad XOR', 'XOR', standardQuad()),
    chip('74HC7266', 'Quad XNOR', 'XNOR', [
      g([1, 2], 3, -1.8, -Y), g([5, 6], 4, 0.8, -Y, -1),
      g([8, 9], 10, 1.8, Y, -1), g([12, 13], 11, -0.8, Y),
    ]),
  ].map((d) => [d.part, d]),
)

/** x/y of a pin in chip coordinates */
export function pinXY(def: ICDef, pin: number): [number, number] {
  const half = def.pinCount / 2
  return pin <= half ? [pin - (half + 1) / 2, -1.5] : [def.pinCount - pin - (half - 1) / 2, 1.5]
}

const INPUT_NAMES = ['A', 'B', 'C', 'D']
export interface PinInfo { role: 'vcc' | 'gnd' | 'in' | 'out' | 'nc'; label: string; gate: number }

export function pinInfo(def: ICDef, pin: number): PinInfo {
  if (pin === def.vcc) return { role: 'vcc', label: 'VCC', gate: -1 }
  if (pin === def.gnd) return { role: 'gnd', label: 'GND', gate: -1 }
  for (let i = 0; i < def.gates.length; i++) {
    const gate = def.gates[i]
    if (gate.output === pin) return { role: 'out', label: `${i + 1}X`, gate: i }
    const k = gate.inputs.indexOf(pin)
    if (k >= 0) return { role: 'in', label: `${i + 1}${INPUT_NAMES[k]}`, gate: i }
  }
  return { role: 'nc', label: 'NC', gate: -1 }
}
