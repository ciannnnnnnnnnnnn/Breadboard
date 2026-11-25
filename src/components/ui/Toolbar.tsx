import { useRef, useState } from 'react'
import { ManualImport } from './ManualImport'
import { MAX_BOARDS } from '../../data/breadboard'
import { EXAMPLES } from '../../data/examples'
import { parseProject, readLocal, saveLocal, serialize, useStore } from '../../store/useStore'

export function Switch({ label, on, set, disabled }: { label: string; on: boolean; set: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={() => set(!on)} className="flex items-center gap-1.5 text-xs whitespace-nowrap text-slate-300 hover:text-white disabled:opacity-40">
      <span className={`relative h-4 w-7 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-600'}`}>
        <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? 'left-3.5' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  )
}

export function Toolbar() {
  const s = useStore()
  const [manual, setManual] = useState(false)
  const boards = s.circuit.boards ?? 1
  const file = useRef<HTMLInputElement>(null)
  const open = (text: string | null, what: string) => {
    if (!text) { s.say('No saved project in this browser yet'); return }
    try {
      const p = parseProject(text)
      s.load(p.circuit, p.name)
      s.say(`${what}: ${p.name}`)
    } catch (e) {
      s.say(`Could not open project: ${e instanceof Error ? e.message : e}`)
    }
  }
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([serialize()], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${s.name.replace(/[^\w-]+/g, '-').toLowerCase() || 'circuit'}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-slate-800 bg-slate-900 px-3 py-2">
      <input
        aria-label="Project name" value={s.name} onChange={(e) => s.setName(e.target.value)}
        className="w-56 rounded bg-transparent px-1.5 py-1 text-sm font-semibold text-slate-100 hover:bg-slate-800 focus:bg-slate-800 focus:outline-none"
      />
      <button
        onClick={s.running ? s.stop : s.start}
        className={`rounded-md px-3 py-1.5 text-xs font-semibold whitespace-nowrap text-white ${s.running ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500'}`}
      >
        {s.running ? '■ Stop Simulation' : '▶ Start Simulation'}
      </button>
      <button className={`btn ${s.checking ? 'border-amber-500 text-amber-300' : ''}`} aria-pressed={s.checking} title="Find problems without running" onClick={() => s.setChecking(!s.checking)}>Check Circuit</button>
      <Switch label="Show IC Internals" on={s.settings.internals} set={(v) => s.setSetting('internals', v)} />
      <Switch label="Current Labels" on={s.settings.labels} set={(v) => s.setSetting('labels', v)} />
      <Switch label="Tidy Wires" on={s.settings.tidy} set={(v) => s.setSetting('tidy', v)} />
      <Switch label="Pin Badges" on={s.settings.badges} set={(v) => s.setSetting('badges', v)} />
      <button className={`btn ${s.topView ? 'border-sky-500 text-sky-300' : ''}`} onClick={() => s.setView(!s.topView)} aria-pressed={s.topView}>Top View</button>
      <div className="flex gap-1">
        <button className="btn" onClick={s.undo} disabled={!s.past.length || s.running} title="Undo (Ctrl+Z)">↶ Undo</button>
        <button className="btn" onClick={s.redo} disabled={!s.future.length || s.running} title="Redo (Ctrl+Y)">↷ Redo</button>
      </div>
      <div className="flex items-center gap-1 text-xs text-slate-400">
        <button className="btn px-2" aria-label="Remove breadboard" disabled={s.running || boards < 2} onClick={s.removeBoard}>−</button>
        <span className="whitespace-nowrap">{boards} {boards === 1 ? 'board' : 'boards'}</span>
        <button className="btn px-2" aria-label="Add breadboard" disabled={s.running || boards >= MAX_BOARDS} onClick={s.addBoard}>+</button>
      </div>
      <button className="rounded-md bg-sky-600 px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-white hover:bg-sky-500" onClick={() => setManual(true)}>Build from Manual</button>
      <button className={`rounded-md px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-white ${s.assistant ? 'bg-violet-500' : 'bg-violet-700 hover:bg-violet-600'}`} aria-pressed={s.assistant} onClick={() => s.setAssistant(!s.assistant)}>Ask AI</button>
      {manual && <ManualImport close={() => setManual(false)} />}
      <div className="ml-auto flex flex-wrap items-center gap-1">
        <select
          aria-label="Load example" value="" className="btn max-w-36"
          onChange={(e) => {
            const x = EXAMPLES.find((q) => q.id === e.target.value)
            if (x) { s.load(x.build(), x.name); s.say(x.description) }
          }}
        >
          <option value="" disabled>Examples…</option>
          {EXAMPLES.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button className="btn" onClick={() => s.load({ components: [], wires: [] }, 'Untitled')}>New</button>
        <button className="btn" onClick={() => { try { saveLocal(); s.say('Saved in this browser') } catch { s.say('Could not save: browser storage is unavailable') } }}>Save</button>
        <button className="btn" onClick={() => open(readLocal(), 'Loaded')}>Load</button>
        <button className="btn" onClick={exportFile}>Export</button>
        <button className="btn" onClick={() => file.current?.click()}>Import</button>
        <input
          ref={file} type="file" accept=".json,application/json" className="hidden" data-testid="import"
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) open(await f.text(), 'Imported')
          }}
        />
      </div>
    </header>
  )
}
