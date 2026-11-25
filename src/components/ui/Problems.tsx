import { problemCenter } from '../../simulation/diagnose'
import { useDiagnosis } from '../../store/problems'
import { useStore } from '../../store/useStore'

export function Problems() {
  const { problems } = useDiagnosis()
  const s = useStore()
  if (!s.running && !s.checking) return null
  if (!problems.length) {
    return s.checking && !s.running
      ? <div className="absolute top-3 left-3 z-40 rounded-md border border-emerald-600/60 bg-emerald-950/85 px-3 py-1.5 text-xs text-emerald-100" data-testid="warnings">✓ No problems found</div>
      : null
  }
  return (
    <section className="absolute top-3 left-3 z-40 flex max-h-[85%] w-84 max-w-[60%] flex-col rounded-lg border border-slate-700 bg-slate-950/92 shadow-xl" data-testid="warnings" aria-label="Problems">
      <h2 className="px-3 py-2 text-xs font-semibold text-slate-100" role="status">{problems.length} {problems.length === 1 ? 'problem' : 'problems'} in this circuit</h2>
      <ul className="min-h-0 space-y-1 overflow-y-auto px-2 pb-2">
        {problems.map((p) => {
          const open = s.activeProblem === p.key
          const err = p.severity === 'error'
          return (
            <li key={p.key} className={`rounded-md border ${err ? 'border-rose-500/60 bg-rose-950/60' : 'border-amber-500/50 bg-amber-950/50'}`}>
              <button
                aria-expanded={open} className={`flex w-full gap-2 px-2.5 py-1.5 text-left text-xs ${err ? 'text-rose-100' : 'text-amber-100'}`}
                onClick={() => s.setActiveProblem(open ? null : p.key, open ? null : problemCenter(p, s.circuit))}
              >
                <span>{err ? '⛔' : '⚠'}</span><span className="flex-1">{p.title}</span><span className="text-slate-400">{open ? '▾' : '▸'}</span>
              </button>
              {open && (
                <div className="space-y-2 border-t border-white/10 px-2.5 py-2 text-xs leading-relaxed text-slate-200">
                  <div><div className="font-semibold text-slate-400">Why it's a problem</div>{p.why}</div>
                  <div>
                    <div className="font-semibold text-emerald-300">How to fix it</div>
                    <ol className="list-decimal space-y-0.5 pl-4">{p.fix.map((f, i) => <li key={i}>{f}</li>)}</ol>
                  </div>
                  {s.running && <p className="text-slate-500">Stop the simulation to rewire. Use Check Circuit to keep this list while you edit.</p>}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
