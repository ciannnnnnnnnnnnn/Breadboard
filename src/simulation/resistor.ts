/** 4-band resistor colour code. */
const DIGITS = ['#1a1a1a', '#7a4a21', '#d3202a', '#f08020', '#f2d022', '#2f9e44', '#2563c9', '#8a3fc4', '#8c8c8c', '#f5f5f5']
const GOLD = '#c9a13b'
const SILVER = '#c4c7cc'

/** two significant digits and the power-of-ten multiplier */
export function bandDigits(ohms: number): { d1: number; d2: number; exp: number } {
  if (!(ohms > 0)) return { d1: 0, d2: 0, exp: 0 }
  let exp = Math.floor(Math.log10(ohms) + 1e-9) - 1
  let n = Math.round(ohms / 10 ** exp)
  if (n >= 100) { n = 10; exp++ }
  return { d1: Math.floor(n / 10), d2: n % 10, exp }
}
export function resistorBands(ohms: number): string[] {
  const { d1, d2, exp } = bandDigits(ohms)
  const mult = exp === -1 ? GOLD : exp <= -2 ? SILVER : DIGITS[Math.min(9, exp)]
  return [DIGITS[d1], DIGITS[d2], mult, GOLD]
}
