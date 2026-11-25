/** ANSI gate symbols + pin routing as pure polylines, shared by the 3D and SVG views. */
import { pinXY, type GateDef, type GateType, type ICDef } from './ics'

export type Pt = [number, number]
export interface GateSymbol {
  /** polylines making up the body; the first one is the closed outline */
  body: Pt[][]
  bubble?: { c: Pt; r: number }
  /** where the inputs attach, top (+y) first */
  inputs: Pt[]
  output: Pt
}

const quad = (a: Pt, c: Pt, b: Pt, n = 16): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]] as Pt
  })
export const circle = (c: Pt, r: number, n = 20): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r] as Pt
  })

const L = -0.35, R = 0.35, H = 0.28, BR = 0.055

function andBody(): Pt[] {
  const cx = R - H
  const arc = Array.from({ length: 25 }, (_, i) => {
    const a = Math.PI / 2 - (i / 24) * Math.PI
    return [cx + Math.cos(a) * H, Math.sin(a) * H] as Pt
  })
  return [[L, H], ...arc, [L, -H], [L, H]]
}
const orBack = (dx = 0): Pt[] => quad([L + dx, -H], [L + 0.2 + dx, 0], [L + dx, H])
const orBody = (): Pt[] => [...orBack(), ...quad([L, H], [0.12, H], [R, 0]), ...quad([R, 0], [0.12, -H], [L, -H])]

export function gateSymbol(type: GateType): GateSymbol {
  if (type === 'NOT') {
    return {
      body: [[[-0.25, 0.22], [0.2, 0], [-0.25, -0.22], [-0.25, 0.22]]],
      bubble: { c: [0.2 + BR, 0], r: BR }, inputs: [[-0.25, 0]], output: [0.2 + 2 * BR, 0],
    }
  }
  const inv = type === 'NAND' || type === 'NOR' || type === 'XNOR'
  const isAnd = type === 'AND' || type === 'NAND'
  const isX = type === 'XOR' || type === 'XNOR'
  const inX = isAnd ? L : L + 0.075 - (isX ? 0.1 : 0)
  return {
    body: isAnd ? [andBody()] : isX ? [orBody(), orBack(-0.1)] : [orBody()],
    bubble: inv ? { c: [R + BR, 0], r: BR } : undefined,
    inputs: [[inX, H / 2], [inX, -H / 2]],
    output: [inv ? R + 2 * BR : R, 0],
  }
}

/** y at which the body edge meets the pin leads */
export const BODY_EDGE = 1.35

export interface RoutedGate {
  body: Pt[][]
  bubble?: Pt[]
  /** one polyline per input pin, in def.inputs order, from pin to gate */
  inputs: { pin: number; path: Pt[]; label: Pt }[]
  output: { pin: number; path: Pt[]; label: Pt }
}

/** Places a gate in the chip and routes its internal traces to the real pins. */
export function routeGate(def: ICDef, gate: GateDef): RoutedGate {
  const sym = gateSymbol(def.gateType)
  const [cx, cy] = gate.at
  const f = gate.face
  const place = ([x, y]: Pt): Pt => [cx + f * x, cy + y]
  const [ox, oy] = pinXY(def, gate.output)
  const side = Math.sign(oy)
  const edge = side * BODY_EDGE
  const px = (p: number) => pinXY(def, p)[0]

  // Work from the back of the gate towards its tip: the input pin farthest back
  // takes the inner input of the gate and the nearer one jogs in underneath, so
  // the traces never cross.
  const order = [...gate.inputs].sort((a, b) => f * (px(a) - px(b)))
  const slots = sym.inputs.map(place).sort((a, b) => side * (a[1] - b[1])) // inner first
  const inputs = gate.inputs.map((pin) => {
    const rank = order.indexOf(pin)
    const slot = slots[Math.min(rank, slots.length - 1)]
    const x = px(pin)
    const path: Pt[] = [[x, edge]]
    const xk = cx + f * (L - 0.3)
    if (rank === 0) path.push([x, slot[1]])
    else path.push([x, side * 1.0], [xk, side * 1.0], [xk, slot[1]])
    path.push(slot)
    return { pin, path, label: [slot[0] - f * 0.13, slot[1] + (rank === 0 ? -side : side) * 0.1] as Pt }
  })
  const out = place(sym.output)
  return {
    body: sym.body.map((l) => l.map(place)),
    bubble: sym.bubble && circle(place(sym.bubble.c), sym.bubble.r),
    inputs,
    output: { pin: gate.output, path: [out, [ox, cy], [ox, edge]], label: [out[0] + f * 0.1, out[1] - side * 0.13] },
  }
}
const cache = new Map<string, RoutedGate[]>()
export function routedGates(def: ICDef): RoutedGate[] {
  let r = cache.get(def.part)
  if (!r) cache.set(def.part, (r = def.gates.map((x) => routeGate(def, x))))
  return r
}
