import { useState } from 'react'
import { LED_COLORS, PALETTE, WIRE_COLORS, type PaletteItem } from '../../data/components'
import { gateSymbol } from '../../data/gateGeometry'
import { ICS } from '../../data/ics'
import { resistorBands } from '../../simulation/resistor'
import { useStore } from '../../store/useStore'

function Icon({ item }: { item: PaletteItem }) {
  const p = item.props
  const svg = (c: React.ReactNode) => <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0">{c}</svg>
  switch (item.type) {
    case 'ic': {
      const s = gateSymbol(ICS[p.part!].gateType)
      const d = (pts: [number, number][]) => 'M' + pts.map(([x, y]) => `${14 + x * 28} ${16 - y * 28}`).join('L')
      return svg(
        <g fill="none" stroke="#7fb2e8" strokeWidth="1.4">
          {s.body.map((b, i) => <path key={i} d={d(b)} />)}
          {s.bubble && <circle cx={14 + s.bubble.c[0] * 28} cy={16} r={s.bubble.r * 28} />}
          {s.inputs.map((q, i) => <path key={i} d={`M1 ${16 - q[1] * 28}H${14 + q[0] * 28}`} />)}
          <path d={`M${14 + s.output[0] * 28} 16H31`} />
        </g>,
      )
    }
    case 'led': return svg(<><path d="M10 20V12a6 6 0 0 1 12 0v8z" fill={LED_COLORS[p.color!].hex} /><path d="M8 20h16v2H8zM13 22v8M19 22v6" stroke="#cbd5e1" fill="#cbd5e1" /></>)
    case 'resistor': return svg(<><path d="M1 16h30" stroke="#cbd5e1" /><rect x="6" y="11" width="20" height="10" rx="4" fill="#d9bd8b" />{resistorBands(p.ohms!).map((c, i) => <rect key={i} x={[9, 12.5, 16, 21][i]} y="11" width="2" height="10" fill={c} />)}</>)
    case 'supply': return svg(<><rect x="3" y="6" width="26" height="20" rx="3" fill="#475569" /><rect x="6" y="9" width="20" height="7" fill="#0b0f14" /><text x="16" y="15" fontSize="6" fill="#ff5a4a" textAnchor="middle">5.00</text><circle cx="11" cy="21" r="2.4" fill="#dc2626" /><circle cx="21" cy="21" r="2.4" fill="#111" /></>)
    case 'battery': return svg(<><rect x="4" y="10" width="22" height="12" rx="2" fill="#2c5d3f" /><rect x="20" y="10" width="6" height="12" fill="#c58a33" /><rect x="26" y="13" width="3" height="6" fill="#cbd5e1" /></>)
    case 'gnd': return svg(<path d="M16 5v11M7 16h18M11 20h10M14 24h4" stroke="#93b4e8" strokeWidth="2" />)
    case 'toggle': return svg(<><rect x="3" y="11" width="26" height="12" rx="2" fill="#2a6fb5" /><rect x="8" y="14" width="16" height="6" fill="#12161c" /><rect x="17" y="12" width="6" height="8" fill="#e5e7eb" /></>)
    case 'button': return svg(<><rect x="5" y="5" width="22" height="22" rx="3" fill="#64748b" /><circle cx="16" cy="16" r="7" fill="#c0392b" /></>)
    case 'dip4': return svg(<><rect x="2" y="7" width="28" height="18" rx="2" fill="#b3261e" />{[0, 1, 2, 3].map((i) => <g key={i}><rect x={4.5 + i * 6.3} y="10" width="4" height="12" fill="#14171c" /><rect x={4.5 + i * 6.3} y={i % 2 ? 10 : 17} width="4" height="5" fill="#fff" /></g>)}</>)
    case 'input': return svg(<><rect x="5" y="8" width="16" height="16" rx="3" fill="#3b2f63" /><text x="13" y="20" fontSize="11" fill="#fff" textAnchor="middle">1</text><path d="M21 16h9" stroke="#2bff88" strokeWidth="2" /></>)
    default: return svg(<><circle cx="19" cy="16" r="9" fill="#0d1d22" stroke="#2bff88" strokeWidth="2" /><text x="19" y="20" fontSize="11" fill="#fff" textAnchor="middle">?</text><path d="M1 16h9" stroke="#2bff88" strokeWidth="2" /></>)
  }
}

export function Palette() {
  const [q, setQ] = useState('')
  const placing = useStore((s) => s.placing)
  const begin = useStore((s) => s.beginPlacing)
  const wireColor = useStore((s) => s.wireColor)
  const setWireColor = useStore((s) => s.setWireColor)
  const running = useStore((s) => s.running)
  const items = PALETTE.filter((i) => `${i.name} ${i.hint} ${i.category}`.toLowerCase().includes(q.trim().toLowerCase()))
  const cats = [...new Set(items.map((i) => i.category))]
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-900" aria-label="Components">
      <div className="p-2">
        <input type="search" placeholder="Search parts" aria-label="Search parts" value={q} onChange={(e) => setQ(e.target.value)} className="field w-full" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {cats.map((c) => (
          <div key={c} className="mb-2">
            <h3 className="sticky top-0 z-10 bg-slate-900 py-1 text-[11px] font-semibold text-slate-400">{c}</h3>
            {items.filter((i) => i.category === c).map((i) => (
              <button
                key={i.key} disabled={running} title="Drag onto the board, or click and then click the board"
                className={`flex w-full touch-none items-center gap-2 rounded-md border px-1.5 py-1 text-left select-none hover:bg-slate-800 disabled:opacity-40 ${placing?.type === i.type && JSON.stringify(placing.props) === JSON.stringify(i.props) ? 'border-sky-500 bg-slate-800' : 'border-transparent'}`}
                onPointerDown={(e) => {
                  if (e.button !== 0 || running) return
                  ;(e.target as Element).releasePointerCapture?.(e.pointerId)
                  begin(i)
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') begin(i) }}
              >
                <Icon item={i} />
                <span className="min-w-0">
                  <span className="block truncate text-xs text-slate-200">{i.name}</span>
                  <span className="block truncate text-[10px] text-slate-500">{i.hint}</span>
                </span>
              </button>
            ))}
          </div>
        ))}
        {!items.length && <p className="p-2 text-xs text-slate-500">No parts match “{q}”.</p>}
      </div>
      <div className="border-t border-slate-800 p-2">
        <div className="mb-1.5 text-[11px] font-semibold text-slate-400">New wire colour</div>
        <Swatches value={wireColor} set={setWireColor} />
      </div>
    </aside>
  )
}

export function Swatches({ value, set }: { value: string; set: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      <button onClick={() => set('auto')} aria-pressed={value === 'auto'} className={`h-6 rounded border px-1.5 text-[10px] text-slate-200 ${value === 'auto' ? 'border-sky-400 bg-slate-700' : 'border-slate-600'}`}>Auto</button>
      {Object.entries(WIRE_COLORS).map(([n, c]) => (
        <button key={n} title={n} aria-label={`${n} wire`} aria-pressed={value === n} onClick={() => set(n)} style={{ background: c }} className={`h-6 w-6 rounded border-2 ${value === n ? 'border-sky-400' : 'border-slate-700'}`} />
      ))}
    </div>
  )
}
