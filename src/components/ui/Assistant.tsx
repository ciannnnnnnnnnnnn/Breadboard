import { useEffect, useRef, useState } from 'react'
import { ClaudeAgent } from '../../assistant/agent'
import { GeminiAgent } from '../../assistant/gemini'

const PROVIDERS = {
  gemini: {
    name: 'Gemini', tag: 'free tier', storage: 'ic-breadboard-lab:gemini-key', hint: 'AQ... or AIza...', company: 'Google',
    url: 'https://aistudio.google.com/apikey', site: 'Google AI Studio', agent: new GeminiAgent(),
    note: 'Google Gemini has a free tier with daily limits. On the free tier Google may use your messages to improve its products, so do not type private information.',
  },
  claude: {
    name: 'Claude', tag: 'paid', storage: 'ic-breadboard-lab:api-key', hint: 'sk-ant-...', company: 'Anthropic',
    url: 'https://platform.claude.com/settings/keys', site: 'platform.claude.com', agent: new ClaudeAgent(),
    note: 'Claude usage is billed to your own API account.',
  },
}
type Provider = keyof typeof PROVIDERS
const CHOICE = 'ic-breadboard-lab:ai'
const readChoice = (): Provider => { try { return localStorage.getItem(CHOICE) === 'claude' ? 'claude' : 'gemini' } catch { return 'gemini' } }
const readKey = (p: Provider) => { const KEY = PROVIDERS[p].storage; try { return sessionStorage.getItem(KEY) ?? localStorage.getItem(KEY) ?? '' } catch { return '' } }
function storeKey(p: Provider, k: string, remember: boolean) {
  const KEY = PROVIDERS[p].storage
  try {
    sessionStorage.removeItem(KEY)
    localStorage.removeItem(KEY)
    if (k) (remember ? localStorage : sessionStorage).setItem(KEY, k)
  } catch { /* storage blocked: the key lasts until the page closes */ }
}

type Item =
  | { kind: 'user' | 'ai' | 'error'; text: string }
  | { kind: 'tool'; text: string; state: string }

const STARTERS = ['Explain this circuit', 'Why is it not working?', 'Check my truth table', 'Build a full adder']

/** **bold**, `code` and line breaks; everything else is plain text, never HTML */
function Rich({ text }: { text: string }) {
  return text.trim().split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/).map((p, i) =>
    p.startsWith('**') && p.length > 4 ? <strong key={i} className="text-slate-50">{p.slice(2, -2)}</strong>
    : p.startsWith('`') && p.length > 2 ? <code key={i} className="rounded bg-slate-800 px-1 text-emerald-200">{p.slice(1, -1)}</code>
    : p)
}

export function Assistant({ close }: { close: () => void }) {
  const [provider, setProvider] = useState(readChoice)
  const P = PROVIDERS[provider]
  const agent = P.agent
  const [key, setKey] = useState(() => readKey(provider))
  const [draftKey, setDraftKey] = useState('')
  const [remember, setRemember] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState<{ text: string; answer: (ok: boolean) => void } | null>(null)
  const end = useRef<HTMLDivElement>(null)
  const auto = useRef(false)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [items, ask])

  const push = (it: Item) => setItems((l) => [...l, it])
  const send = async (text: string) => {
    if (!text.trim() || busy) return
    setInput('')
    setBusy(true)
    auto.current = false
    push({ kind: 'user', text })
    try {
      await agent.send(key, text, {
        onText: (d) => setItems((l) => {
          const last = l[l.length - 1]
          if (last?.kind === 'ai') return [...l.slice(0, -1), { kind: 'ai', text: last.text + d }]
          return d.trim() ? [...l, { kind: 'ai', text: d }] : l
        }),
        onTool: (t, state) => push({ kind: 'tool', text: t, state }),
        approve: (t) => auto.current ? Promise.resolve(true) : new Promise((res) => setAsk({ text: t, answer: (ok) => { setAsk(null); res(ok) } })),
      })
    } catch (e) {
      push({ kind: 'error', text: (e as Error).message })
    } finally {
      setBusy(false)
      setAsk(null)
    }
  }
  const stop = () => { agent.stop(); ask?.answer(false) }
  const switchTo = (p: Provider) => {
    stop()
    agent.reset()
    try { localStorage.setItem(CHOICE, p) } catch { /* not remembered */ }
    setProvider(p)
    setKey(readKey(p))
    setDraftKey('')
    setItems([])
  }
  // a fresh panel starts a fresh conversation
  useEffect(() => { Object.values(PROVIDERS).forEach((q) => q.agent.reset()) }, [])
  // closing the panel ends any reply in progress
  const stopRef = useRef(stop)
  stopRef.current = stop
  useEffect(() => () => stopRef.current(), [])

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-slate-800 bg-slate-900" aria-label="AI assistant">
      <header className="flex items-center gap-1 border-b border-slate-800 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-100">AI assistant</h2>
        <div className="ml-auto flex gap-1">
          {key && items.length > 0 && <button className="btn" onClick={() => { stop(); agent.reset(); setItems([]) }}>Clear</button>}
          {key && <button className="btn" onClick={() => { stop(); agent.reset(); storeKey(provider, '', false); setKey(''); setItems([]) }}>Remove key</button>}
          <button className="btn" aria-label="Close assistant" onClick={close}>✕</button>
        </div>
      </header>
      <div className="flex gap-1 border-b border-slate-800 p-2" role="radiogroup" aria-label="AI service">
        {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
          <button key={p} role="radio" aria-checked={p === provider} onClick={() => p !== provider && switchTo(p)} className={`flex-1 rounded-md border px-2 py-1 text-xs ${p === provider ? 'border-violet-500 bg-violet-950 text-violet-100' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>
            {PROVIDERS[p].name} <span className="text-[10px] opacity-70">{PROVIDERS[p].tag}</span>
          </button>
        ))}
      </div>
      {!key ? (
        <form
          className="space-y-3 p-3 text-xs leading-relaxed text-slate-300"
          onSubmit={(e) => {
            e.preventDefault()
            const k = draftKey.trim()
            if (!k) return
            storeKey(provider, k, remember)
            setKey(k)
            setDraftKey('')
          }}
        >
          <p>Paste your own {P.name} API key to start. {P.note}</p>
          <label className="block text-slate-400">API key
            <input type="password" autoComplete="off" value={draftKey} onChange={(e) => setDraftKey(e.target.value)} placeholder={P.hint} className="field mt-1 w-full" />
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember on this device</label>
          <button className="w-full rounded-md bg-sky-600 px-3 py-1.5 font-semibold text-white hover:bg-sky-500">Use this key</button>
          <p className="text-slate-500">Create one at <a className="text-sky-400 underline" href={P.url} target="_blank" rel="noreferrer">{P.site}</a>. The key stays in this browser and is sent only to {P.company}, along with your messages and the circuit details the assistant looks at. Do not enter it on a shared computer.</p>
        </form>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-xs leading-relaxed" data-testid="chat" aria-live="polite">
            {!items.length && (
              <div className="space-y-2">
                <p className="text-slate-400">Ask about the circuit on the board. I can see it, test it, and change it with your approval.</p>
                {STARTERS.map((q) => <button key={q} className="btn block w-full text-left" onClick={() => void send(q)}>{q}</button>)}
              </div>
            )}
            {items.map((it, i) =>
              it.kind === 'tool' ? <div key={i} className={`text-[11px] ${it.state === 'error' ? 'text-amber-300' : 'text-slate-500'}`}>{it.state === 'done' ? '✓' : it.state === 'note' ? '…' : it.state === 'declined' ? '⊘ Declined:' : '⚠'} {it.text}</div>
              : it.kind === 'error' ? <div key={i} role="alert" className="rounded-md border border-rose-500/60 bg-rose-950/60 p-2 text-rose-100">{it.text}</div>
              : it.kind === 'user' ? <div key={i} className="ml-6 rounded-lg bg-sky-900/60 px-2.5 py-1.5 whitespace-pre-wrap text-sky-50">{it.text}</div>
              : <div key={i} className="whitespace-pre-wrap text-slate-200"><Rich text={it.text} /></div>)}
            {ask && (
              <div className="space-y-2 rounded-md border border-sky-500/60 bg-sky-950/60 p-2" role="group" aria-label="Approve change">
                <p className="text-sky-50">{ask.text}?</p>
                <div className="flex gap-1">
                  <button className="rounded-md bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-500" onClick={() => ask.answer(true)}>Apply</button>
                  <button className="btn" onClick={() => ask.answer(false)}>Decline</button>
                  <button className="btn" title="Apply the rest of this reply's changes without asking" onClick={() => { auto.current = true; ask.answer(true) }}>Apply all</button>
                </div>
              </div>
            )}
            {busy && !ask && <div className="animate-pulse text-slate-500">Working…</div>}
            <div ref={end} />
          </div>
          <form className="flex gap-1 border-t border-slate-800 p-2" onSubmit={(e) => { e.preventDefault(); void send(input) }}>
            <textarea
              aria-label="Message" rows={2} value={input} placeholder="Ask about your circuit" className="field min-w-0 flex-1 resize-none"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input) } }}
            />
            {busy ? <button type="button" className="btn" onClick={stop}>Stop</button> : <button className="rounded-md bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-40" disabled={!input.trim()}>Send</button>}
          </form>
          <p className="px-3 pb-2 text-[10px] text-slate-500">AI can make mistakes. Check important answers.</p>
        </>
      )}
    </aside>
  )
}
