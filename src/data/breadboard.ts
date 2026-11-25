/**
 * Breadboard geometry + internal connectivity.
 * One world unit = one 0.1" hole pitch. x is the column, z the row; all holes
 * sit on integer x and half-integer z, so any part can be snapped to a lattice.
 */
export const COLS = 63
export const ROWS_TOP = ['a', 'b', 'c', 'd', 'e'] as const
export const ROWS_BOTTOM = ['f', 'g', 'h', 'i', 'j'] as const
export const RAILS = ['tp', 'tn', 'bp', 'bn'] as const

export const ROW_Z: Record<string, number> = {
  tp: -8.5, tn: -7.5,
  a: -5.5, b: -4.5, c: -3.5, d: -2.5, e: -1.5,
  f: 1.5, g: 2.5, h: 3.5, i: 4.5, j: 5.5,
  bp: 7.5, bn: 8.5,
}
export const BOARD = { width: 66, depth: 20, height: 2 }

export const MAX_BOARDS = 4
/** z distance between boards; an integer so every board shares one lattice */
export const BOARD_PITCH = 24
/** board 0 uses bare ids ("a12"), board 1 "2.a12", and so on */
export const boardPrefix = (board: number) => (board ? `${board + 1}.` : '')

export interface Hole { id: string; board: number; row: string; col: number; x: number; z: number; strip: string }

export const colX = (col: number) => col - (COLS + 1) / 2
const isRail = (row: string) => (RAILS as readonly string[]).includes(row)

/** The electrical group (spring clip) a hole belongs to. */
function stripFor(row: string, col: number) {
  if (isRail(row)) return row
  return ((ROWS_TOP as readonly string[]).includes(row) ? 'T' : 'B') + col
}

export const HOLES: Hole[] = []
for (let board = 0; board < MAX_BOARDS; board++) for (const row of Object.keys(ROW_Z)) {
  const p = boardPrefix(board)
  for (let col = 1; col <= COLS; col++) {
    if (isRail(row) && col % 6 === 0) continue // rail holes come in groups of five
    HOLES.push({ id: p + row + col, board, row, col, x: colX(col), z: ROW_Z[row] + board * BOARD_PITCH, strip: p + stripFor(row, col) })
  }
}
export const HOLE_BY_ID = new Map(HOLES.map((h) => [h.id, h]))
const HOLE_BY_POS = new Map(HOLES.map((h) => [`${h.x},${h.z}`, h]))
export const HOLES_BY_STRIP = new Map<string, Hole[]>()
for (const h of HOLES) {
  const l = HOLES_BY_STRIP.get(h.strip)
  if (l) l.push(h)
  else HOLES_BY_STRIP.set(h.strip, [h])
}

export const holeAt = (x: number, z: number) => HOLE_BY_POS.get(`${x},${z}`)

/** Nearest hole to an arbitrary point, or undefined if none is close enough. */
export function nearestHole(x: number, z: number, maxDist = 0.75): Hole | undefined {
  const h = holeAt(Math.round(x) + 0, Math.round(z - 0.5) + 0.5)
  return h && Math.hypot(h.x - x, h.z - z) <= maxDist ? h : undefined
}

export function describeStrip(strip: string): string {
  const rails: Record<string, string> = {
    tp: 'Top rail +', tn: 'Top rail −', bp: 'Bottom rail +', bn: 'Bottom rail −',
  }
  const m = /^(\d)\.(.*)$/.exec(strip)
  if (m) return `Board ${m[1]}: ${describeStrip(m[2])}`
  if (rails[strip]) return rails[strip]
  if (strip[0] === 'T') return `Column ${strip.slice(1)} (a–e)`
  if (strip[0] === 'B') return `Column ${strip.slice(1)} (f–j)`
  return strip
}
