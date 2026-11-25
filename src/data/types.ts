/** Logic level: HIGH, LOW, or floating / unknown. */
export type Level = 0 | 1 | 'Z'
export type CompType =
  | 'supply' | 'battery' | 'gnd' | 'toggle' | 'button' | 'dip4' | 'input'
  | 'led' | 'probe' | 'resistor' | 'ic'

export interface CompProps {
  volts?: number
  on?: boolean
  switches?: boolean[]
  /** signal names of DIP switch positions */
  names?: string[]
  color?: string
  vf?: number
  ohms?: number
  span?: number
  part?: string
  /** per-chip override of the global "Show IC Internals" switch */
  internals?: boolean
  label?: string
}
export interface Comp { id: string; type: CompType; x: number; z: number; rot: number; props: CompProps }
/** A wire end is a breadboard hole id ("a12") or an off-board terminal ("@id.pin"). */
export interface Wire { id: string; from: string; to: string; color: string; bends: [number, number][] }
export interface Circuit { components: Comp[]; wires: Wire[]; /** number of breadboards, default 1 */ boards?: number }
