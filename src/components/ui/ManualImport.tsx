import { useMemo, useRef, useState } from 'react'
import { ICS } from '../../data/ics'
import { analyze, type Analysis } from '../../manual/analyze'
import { readManual } from '../../manual/document'
import { designToText, textToDesign } from '../../manual/expr'
import { runTests, synthesize } from '../../manual/synthesize'
import { useStore } from '../../store/useStore'

const TEMPLATE = 'title: My circuit\ninputs: A, B, C\nF = A · B + C\'\noutputs: F green'
const H = ({ children }: { children: React.ReactNode }) => <h3 className="mb-1 text-[11px] font-semibold text-slate-400">{children}</h3>

export function ManualImport({ close }: { close: () => void }) {
  const load = useStore((s) => s.load)
  const say = useStore((s) => s.say)
  const file = useRef<HTMLInputElement>(null)
  const [a, setA] = useState<Analysis | null>(null)
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [over, setOver] = useState(false)

  const take = async (f?: File) => {
    if (!f) return
    setError('')
    try {
      const r = analyze(await readManual(f), f.name)
      setA(r)
      setName(f.name)
      setText(r.design ? designToText(r.design) : TEMPLATE)
    } catch (e) {
      setA(null)
      setError((e as Error).message)
    }
  }
  // rebuilt on every edit, so errors and test results follow the text
  const built = useMemo(() => {
    if (!a) return null
    try {
      const d = textToDesign(text)
      const r = synthesize(d, { parts: a.parts, ledOhms: a.ledOhms, pullOhms: a.pullOhms })
      const names = new Set([...d.inputs, ...d.outputs.map((o) => o.name)])
      const tests = a.tests.filter((t) => [...Object.keys(t.set), ...Object.keys(t.expect)].every((k) => names.has(k)))
      return { d, r, results: runTests(r, tests, d.outputs.map((o) => o.name)), skipped: a.tests.length - tests.length }
    } catch (e) {
      return (e as Error).message
    }
  }, [a, text])
  const ok = built && typeof built !== 'string' ? built : null
  const need = new Map<string, number>()
  ok?.r.packages.forEach((p) => need.set(p.part, (need.get(p.part) ?? 0) + 1))
  const passed = ok?.results.filter((r) => r.pass).length ?? 0

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label="Build from a manual" className="flex max-h-full w-full max-w-4xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close() }}>
        <header className="flex items-center border-b border-slate-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Build from a manual</h2>
          <button className="btn ml-auto" aria-label="Close" onClick={close}>✕</button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-xs text-slate-300">
          <div
            onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files[0]) }}
            className={`flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed p-4 ${over ? 'border-sky-400 bg-sky-950/40' : 'border-slate-700'}`}
          >
            <button className="rounded-md bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-500" onClick={() => file.current?.click()}>Choose manual</button>
            <span>{name || 'or drop a .docx, .txt or .md file here. It is read on this computer and not uploaded.'}</span>
            <input ref={file} data-testid="manual-file" type="file" accept=".docx,.txt,.md" className="hidden" onChange={(e) => { void take(e.target.files?.[0]); e.target.value = '' }} />
          </div>
          {error && <p role="alert" className="rounded-md border border-rose-500/60 bg-rose-950/60 p-2 text-rose-100">{error}</p>}
          {a && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-4">
                <section>
                  <H>What was found: {a.method}</H>
                  <ul className="list-disc space-y-0.5 pl-4">{a.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
                  {!a.design && <p className="text-amber-200">No adder chain, complete truth table or Boolean equation was recognised. Write the logic in the box on the right and it will be built for you.</p>}
                  {a.notes.map((n, i) => <p key={i} className="mt-1 text-amber-200">⚠ {n}</p>)}
                </section>
                <section>
                  <H>Parts</H>
                  <table className="w-full text-left">
                    <thead><tr className="text-slate-500"><th className="font-normal">Part</th><th className="font-normal">Manual</th><th className="font-normal">This build</th></tr></thead>
                    <tbody>
                      {[...new Set([...a.parts.map((p) => p.part), ...need.keys()])].map((p) => {
                        const m = a.parts.find((q) => q.part === p)?.qty
                        const n = need.get(p) ?? 0
                        return <tr key={p}><td>{p} {ICS[p].name}</td><td>{m ?? '–'}</td><td className={m !== undefined && m !== n ? 'text-amber-300' : ''}>{n}{m !== undefined && m > n ? ' (fewer gates needed)' : ''}</td></tr>
                      })}
                      <tr><td>Breadboards</td><td>{a.boards}</td><td>{ok?.r.boards ?? '–'}</td></tr>
                    </tbody>
                  </table>
                </section>
                {ok && (
                  <section>
                    <H>Simulated against the manual's test cases</H>
                    {ok.results.length ? (
                      <>
                        <p className={`font-semibold ${passed === ok.results.length ? 'text-emerald-300' : 'text-rose-300'}`} data-testid="manual-tests">{passed} of {ok.results.length} pass</p>
                        <ul className="mt-1 max-h-40 overflow-y-auto font-mono text-[10px]">
                          {ok.results.map((r, i) => <li key={i} className={r.pass ? 'text-slate-400' : 'text-rose-300'}>{r.pass ? '✓' : '✗'} {r.label} → {r.got}{r.pass ? '' : `, expected ${r.expected}`}</li>)}
                        </ul>
                      </>
                    ) : <p className="text-slate-500">No test table was found in the manual.</p>}
                    {ok.skipped > 0 && <p className="text-amber-200">{ok.skipped} test cases use signals that are not in the logic, so they were skipped.</p>}
                  </section>
                )}
              </div>
              <div className="space-y-4">
                <section>
                  <H>Logic to build (edit if anything was misread)</H>
                  <textarea aria-label="Logic to build" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} className="field h-64 w-full font-mono leading-5" />
                  {typeof built === 'string' && <p role="alert" className="mt-1 text-rose-300">{built}</p>}
                  <p className="mt-1 text-slate-500">Operators: · + ⊕ ' or AND OR XOR NOT NAND NOR XNOR.</p>
                </section>
                {ok && (
                  <section>
                    <H>Gate map</H>
                    <div className="max-h-48 overflow-y-auto">
                      <table className="w-full text-left font-mono text-[10px]">
                        <thead><tr className="text-slate-500"><th className="font-normal">Chip</th><th className="font-normal">Gate</th><th className="font-normal">In / in / out</th><th className="font-normal">Signals</th></tr></thead>
                        <tbody>{ok.r.packages.flatMap((p) => p.gates.map((g, i) => <tr key={p.name + i}><td>{p.name} {p.part}</td><td>{g.type}</td><td>{g.pins!.join(' / ')}</td><td>{g.inputs.join(', ')} → {g.output}</td></tr>))}</tbody>
                      </table>
                    </div>
                  </section>
                )}
              </div>
            </div>
          )}
        </div>
        {a && (
          <footer className="flex items-center gap-3 border-t border-slate-800 px-4 py-3 text-xs text-slate-400">
            <span>{ok ? `${ok.r.packages.length} chips, ${ok.r.gates.length} gates, ${ok.r.circuit.wires.length} wires on ${ok.r.boards} ${ok.r.boards === 1 ? 'board' : 'boards'}. Replaces the current circuit; Undo brings it back.` : ''}</span>
            <button
              disabled={!ok} className="ml-auto rounded-md bg-emerald-600 px-4 py-1.5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
              onClick={() => { load(ok!.r.circuit, ok!.d.title); say(`Built ${ok!.d.title}`); close() }}
            >
              Build breadboard
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}
