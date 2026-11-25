import { BODY_EDGE, routedGates, type Pt } from '../../data/gateGeometry'
import { pinInfo, pinXY, type ICDef } from '../../data/ics'
import type { Level } from '../../data/types'

export const svgLevel = (l: Level | null) => (l === 1 ? '#2bff88' : l === 0 ? '#4a6785' : l === 'Z' ? '#868b95' : '#b8c4d4')
const d = (pts: Pt[]) => 'M' + pts.map(([x, y]) => `${x.toFixed(3)} ${(-y).toFixed(3)}`).join('L')

/** SVG pinout; reads the same geometry as the 3D chip */
export function ICDiagram({ def, pins, gateOut, className }: {
  def: ICDef
  pins?: Record<string, { level: Level }>
  gateOut?: Level[]
  className?: string
}) {
  const lv = (p: number): Level | null => pins?.[String(p)]?.level ?? null
  const line = (l: Level | null) => ({
    fill: 'none', stroke: svgLevel(l), strokeWidth: 0.05, strokeDasharray: l === 'Z' ? '0.1 0.07' : undefined,
    style: l === 1 ? { filter: 'drop-shadow(0 0 0.08px #2bff88)' } : undefined,
  })
  const W = 3.62, H = BODY_EDGE - 0.05
  return (
    <svg viewBox="-4 -2.35 8 4.7" className={className} role="img" aria-label={`${def.part} pinout`}>
      <path d={`M${-W} 0.28V${H}H${W}V${-H}H${-W}V-0.28A0.28 0.28 0 0 1 ${-W} 0.28`} fill="#0b1a2c" stroke="#7fb2e8" strokeWidth="0.04" strokeDasharray="0.18 0.1" />
      <circle cx={-3.3} cy={0.72} r={0.1} fill="#7fb2e8" />
      <text x={0.1} y={0.08} fontSize={0.24} fill="#9fc6f2" textAnchor="middle">{def.part} {def.gateType}</text>
      {routedGates(def).map((g, i) => {
        const o = pins ? (gateOut?.[i] ?? 'Z') : null
        return (
          <g key={i}>
            {g.inputs.map((t, k) => <path key={k} d={d(t.path)} {...line(lv(t.pin))} />)}
            {g.body.map((b, k) => <path key={k} d={d(b)} {...line(o)} />)}
            {g.bubble && <path d={d(g.bubble)} {...line(o)} />}
            <path d={d(g.output.path)} {...line(o)} />
            {g.inputs.map((t, k) => (
              <text key={k} x={t.label[0]} y={-t.label[1] + 0.06} fontSize={0.17} fill="#dfe9f5" textAnchor="middle">{'ABCD'[k]}</text>
            ))}
            <text x={g.output.label[0]} y={-g.output.label[1] + 0.06} fontSize={0.17} fill="#dfe9f5" textAnchor="middle">X</text>
          </g>
        )
      })}
      {Array.from({ length: def.pinCount }, (_, i) => {
        const n = i + 1
        const [x, y] = pinXY(def, n)
        const s = -Math.sign(y)
        const info = pinInfo(def, n)
        const c = info.role === 'vcc' ? '#ff7a7a' : info.role === 'gnd' ? '#8ab4ff' : '#dfe9f5'
        return (
          <g key={n}>
            <rect x={x - 0.14} y={s > 0 ? H : -H - 0.3} width={0.28} height={0.3} fill={lv(n) === null ? '#9aa3b0' : svgLevel(lv(n))} />
            <text x={x} y={s * 1.78 + 0.07} fontSize={0.24} fill="#ffd98a" textAnchor="middle">{n}</text>
            <text x={x} y={s * 2.12 + 0.08} fontSize={0.24} fill={c} textAnchor="middle">{info.label}</text>
            {(info.role === 'vcc' || info.role === 'gnd') && <path d={`M${x} ${s * BODY_EDGE}V${s * 0.95}`} {...line(lv(n))} />}
          </g>
        )
      })}
    </svg>
  )
}
