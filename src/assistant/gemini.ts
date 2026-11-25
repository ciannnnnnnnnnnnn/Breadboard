/** Google Gemini (Interactions API). Same tools and approvals as the Claude agent. */
import { AgentBase, MAX_STEPS, SYSTEM, type AgentEvents } from './agent'
import { TOOLS } from './tools'

const URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'
/** all free of charge on the Gemini API free tier; the next one is tried when one is busy or out of quota */
const MODELS = ['gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite']
/** waits before retrying the same model */
const WAITS = [1500, 4000]

class ServiceError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms + Math.random() * 500)
  signal.addEventListener('abort', () => { clearTimeout(t); rej(new Error('stopped')) }, { once: true })
})

interface Step { type: string; content?: unknown; id?: string; name?: string; arguments?: unknown; [k: string]: unknown }
const TOOL_PARAMS = Object.entries(TOOLS).map(([name, t]) => ({
  type: 'function', name, description: t.description, ...(Object.keys(t.properties).length && { parameters: { type: 'object', properties: t.properties, required: t.required } }),
}))

function textOf(s: Step): string {
  if (typeof s.content === 'string') return s.content
  return Array.isArray(s.content) ? s.content.map((c) => (c?.type === 'text' && typeof c.text === 'string' ? c.text : '')).join('') : ''
}

function explain(status: number, message: string): string {
  if (/API key/i.test(message) || status === 401) return 'The Gemini API key was not accepted. Check it, or create a new one in Google AI Studio.'
  if (status === 403) return `Google did not allow this request: ${message}`
  if (status === 404) return 'This Gemini model is not available to your account right now.'
  if (status === 429) return 'The free limit has been reached for now. Wait a minute and try again. If it keeps happening, the daily limit is used up and resets at midnight Pacific time.'
  if (status >= 500) return `Google's Gemini service is failing right now (error ${status}${message ? `: ${message}` : ''}). The app already retried. Wait a few minutes and try again.`
  return `Gemini did not accept the request: ${message || status}`
}

export class GeminiAgent extends AgentBase<Step> {
  private model = 0

  /** one request, with retries; before any tool has run it may also move to another model */
  private async ask(apiKey: string, ev: AgentEvents, signal: AbortSignal, canSwitch: boolean): Promise<any> {
    const waits = canSwitch ? WAITS : [...WAITS, 8000]
    const tried = new Set<number>()
    for (;;) {
      let last!: ServiceError
      for (let k = 0; ; k++) {
        try {
          return await this.post(apiKey, MODELS[this.model], signal)
        } catch (e) {
          if (!(e instanceof ServiceError)) throw e
          last = e
          const transient = e.status === 408 || e.status >= 500
          if (!transient || k >= waits.length) break
          ev.onTool(`Gemini is busy (error ${e.status}). Retrying`, 'note')
          await sleep(waits[k], signal)
        }
      }
      tried.add(this.model)
      const next = MODELS.findIndex((_, i) => !tried.has(i))
      const worthIt = last.status === 408 || last.status === 429 || last.status === 404 || last.status >= 500
      if (!canSwitch || !worthIt || next < 0) {
        if (this.model) { this.model = 0; this.keepTalk() } // start from the best model next time
        throw new Error(explain(last.status, last.message))
      }
      this.model = next
      this.keepTalk()
      ev.onTool(`Switching to ${MODELS[next]}`, 'note')
    }
  }

  /** signed thoughts and calls belong to the model that wrote them: keep just the conversation */
  private keepTalk() {
    const talk = this.history.filter((s) => s.type === 'user_input' || s.type === 'model_output')
    this.history.splice(0, this.history.length, ...talk)
  }

  private async post(apiKey: string, model: string, signal: AbortSignal): Promise<any> {
    let res: Response
    try {
      res = await fetch(URL, {
        method: 'POST', signal, headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        // store: false asks Google not to keep the conversation; the full history is sent each time instead
        body: JSON.stringify({ model, store: false, system_instruction: SYSTEM, input: this.history, tools: TOOL_PARAMS }),
      })
    } catch (e) {
      if (signal.aborted) throw e
      throw new Error('Could not reach Gemini. Check your internet connection.')
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const err = Array.isArray(data) ? data[0]?.error : data?.error
      throw new ServiceError(res.status, String(err?.message ?? '').slice(0, 300))
    }
    return data
  }

  protected async turn(apiKey: string, ev: AgentEvents, signal: AbortSignal): Promise<void> {
    for (let step = 0; step < MAX_STEPS; step++) {
      const data = await this.ask(apiKey, ev, signal, step === 0)
      const steps: Step[] = Array.isArray(data?.steps) ? data.steps : []
      if (data?.status === 'failed' || !steps.length) throw new Error('Gemini did not return an answer. Try asking in a different way.')
      const calls = steps.filter((s) => s.type === 'function_call')
      const text = steps.filter((s) => s.type === 'model_output').map(textOf).join('')
      if (data.status === 'incomplete' && calls.length) throw new Error('The answer was cut off. Try a narrower request.')
      // model steps, including thoughts, must go back exactly as received
      this.history.push(...steps)
      if (text) ev.onText(text + '\n\n')
      if (!calls.length) {
        if (!text) throw new Error('Gemini returned an empty answer. Try again.')
        return
      }
      for (const c of calls) {
        let args: unknown = c.arguments
        if (typeof args === 'string') { try { args = JSON.parse(args) } catch { /* rejected by validation below */ } }
        const r = await this.runTool(String(c.name), args ?? {}, ev, signal)
        this.history.push({ type: 'function_result', name: c.name, call_id: c.id, result: [{ type: 'text', text: (r.error ? 'ERROR: ' : '') + r.content }] })
      }
    }
    throw new Error('Stopped after many steps. Ask to continue if it is not finished.')
  }
  protected userStep(text: string): Step { return { type: 'user_input', content: text } }
}
