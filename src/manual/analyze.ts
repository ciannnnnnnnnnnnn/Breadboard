/**
 * Works out the logic a manual asks for. Rule-based, no AI: it looks for an adder
 * chain, a truth table, or Boolean equations, plus the parts list and test cases.
 */
import type { Doc } from './document'
import { evaluate, gate, not, parseExpr, v, variables, type Design, type Equation, type Expr } from './expr'

export interface TestCase { label: string; set: Record<string, 0 | 1>; expect: Record<string, 0 | 1> }
export interface PartLine { part: string; gate: string; qty: number }
export interface Analysis {
  design: Design | null
  method: string
  /** what was found and where, shown to the user */
  evidence: string[]
  notes: string[]
  parts: PartLine[]
  boards: number
  ledOhms: number
  pullOhms: number
  tests: TestCase[]
}

const PART_GATE: Record<string, [string, string]> = {
  '04': ['7404', 'NOT'], '08': ['7408', 'AND'], '32': ['7432', 'OR'], '00': ['7400', 'NAND'],
  '02': ['7402', 'NOR'], '86': ['7486', 'XOR'], '7266': ['74HC7266', 'XNOR'],
}
const ID = /^[A-Za-z][A-Za-z0-9_]*$/
const subst = (e: Expr, map: Record<string, Expr>): Expr =>
  e.op === 'VAR' ? (map[e.name] ?? e) : { op: e.op, args: e.args.map((a) => subst(a, map)) }
const tryParse = (s: string): Expr | null => { try { return parseExpr(s) } catch { return null } }
const isLogic = (e: Expr | null): e is Expr => !!e && e.op !== 'VAR'
const word = (s: string) => /[A-Za-z]\w*/.exec(s)?.[0] ?? ''
const binary = (s: string) => /^[01]$/.test(s.trim())

function findParts(text: string, doc: Doc): PartLine[] {
  const parts = new Map<string, PartLine>()
  const put = (code: string, qty: number) => {
    const p = PART_GATE[code]
    if (p && qty > 0 && qty < 100 && !parts.has(p[0])) parts.set(p[0], { part: p[0], gate: p[1], qty })
  }
  for (const m of text.matchAll(/\b74(?:HC|LS|HCT|ALS|F)?(7266|\d{2})\s*[×x]\s*(\d+)/g)) put(m[1], Number(m[2]))
  for (const t of doc.tables) for (const row of t) {
    const m = /\b74(?:HC|LS|HCT|ALS|F)?(7266|\d{2})\b/.exec(row.join(' '))
    const q = row.slice(1).find((c) => /^\d{1,2}$/.test(c.trim()))
    if (m && q) put(m[1], Number(q))
  }
  return [...parts.values()]
}

/** "Name = expression" statements anywhere in the document */
function findEquations(doc: Doc): Equation[] {
  const found = new Map<string, Expr>()
  const chunks = doc.lines.flatMap((l) => l.split(/\s\|\s|[;,:]\s|\.\s|\sand\s(?=[A-Z]\w*\s*=)/))
  for (const c of chunks) for (const m of c.matchAll(/(?:^|[\s(])([A-Z][A-Za-z0-9_]{0,11})\s*=\s*([^=]+)/g)) {
    // take the longest leading part that is a valid expression
    const toks = m[2].trim().split(/\s+/).slice(0, 80)
    for (let n = toks.length; n > 0; n--) {
      let s = toks.slice(0, n).join(' ').replace(/[.,;]+$/, '')
      let e = tryParse(s)
      if (!e && s.endsWith(')')) e = tryParse((s = s.slice(0, -1)))
      // prose such as "F = the sum of" parses as a product of words, so insist on an operator
      // and on symbol-like names
      if (isLogic(e) && (/[⊕^·•∙⋅×*&+|'’′~!¬̄]/.test(s) || /\b(AND|OR|XOR|NOT|NAND|NOR|XNOR)\b/.test(s)) && [...variables(e)].every((x) => /^[A-Z][A-Za-z]{0,3}\d{0,2}$|^[A-Z]{1,8}\d{0,2}$/.test(x))) {
        const old = found.get(m[1])
        if (!old) found.set(m[1], e)
        break
      }
    }
  }
  // "AB + C" style: split letter groups when their letters are used as variables on their own
  const single = new Set([...found.values()].flatMap((e) => [...variables(e)]).filter((x) => x.length === 1))
  const splitLetters = (e: Expr): Expr => {
    if (e.op !== 'VAR') return { op: e.op, args: e.args.map(splitLetters) }
    if (/^[A-Z]{2,4}$/.test(e.name) && !found.has(e.name) && [...e.name].some((x) => single.has(x))) return gate('AND', ...[...e.name].map(v))
    return e
  }
  return [...found].map(([name, expr]) => ({ name, expr: splitLetters(expr) }))
}

const COLOR = '(red|orange|yellow|green|blue|white)'
function ledColor(text: string, near: RegExp, fallback: string): string {
  const m = new RegExp(`\\b${COLOR}\\b[^.|]{0,20}?${near.source}`, 'i').exec(text)
  return m ? m[1].toLowerCase() : fallback
}

// ── ripple-carry adder / subtractor ──
function adder(doc: Doc, text: string, title: string, eqs: Equation[]): Partial<Analysis> | null {
  const m = /\b(\d{1,2}|one|two|three|four|eight)[- ]bit\b[^.|]{0,40}\b(?:adder|subtractor)/i.exec(text)
  if (!m || !/ripple|full[- ]adder/i.test(text)) return null
  const bits = { one: 1, two: 2, three: 3, four: 4, eight: 8 }[m[1].toLowerCase()] ?? Number(m[1])
  if (!(bits >= 1 && bits <= 8)) return null
  const evidence = [`Title and text describe a ${bits}-bit ripple-carry ${/subtract/i.test(text) ? 'adder/subtractor' : 'adder'}`]

  // the cell: prefer the manual's own formulas, over the names A, B, Cin
  const cellVars = (e?: Expr) => !!e && [...variables(e)].every((x) => ['A', 'B', 'Cin'].includes(x))
  const eq = (re: RegExp) => eqs.find((q) => re.test(q.name) && cellVars(q.expr))?.expr
  const sumE = eq(/^Sum$|^S$/i), outE = eq(/^Cout$/i)
  if (sumE && outE) evidence.push('Full-adder cell formulas for Sum and Cout were read from the manual')
  const stdSum = gate('XOR', gate('XOR', v('A'), v('B')), v('Cin'))
  const stdOut = gate('OR', gate('AND', v('A'), v('B')), gate('AND', v('Cin'), gate('XOR', v('A'), v('B'))))
  const same = (a: Expr | undefined, b: Expr) => !!a && [0, 1, 2, 3, 4, 5, 6, 7].every((k) => {
    const env = { A: k & 1, B: (k >> 1) & 1, Cin: k >> 2 }
    return evaluate(a, env) === evaluate(b, env)
  })
  const notes: string[] = []
  if (sumE && !same(sumE, stdSum)) notes.push('The Sum formula in the manual is not a full adder. The standard one was used instead.')
  if (outE && !same(outE, stdOut)) notes.push('The Cout formula in the manual is not a full adder. The standard one was used instead.')
  const cout = same(outE, stdOut) ? outE! : stdOut

  // the chain map table, if there is one
  const rows = doc.tables.flat().filter((r) => /^(bit|stage|fa)\s*\d+$/i.test(r[0] ?? ''))
  const subtract = /subtract/i.test(text) && /\bMODE\b/.test(text)
  const inputs: string[] = [], equations: Equation[] = []
  let fromTable = rows.length >= bits
  const stages = Array.from({ length: bits }, (_, i) => {
    const r = rows.find((q) => Number(/\d+/.exec(q[0])![0]) === i)
    const bE = r && tryParse(r[2] ?? '')
    const ok = r && ID.test(r[1]) && bE
    if (!ok) fromTable = false
    return { a: ok ? r[1] : `A${i}`, b: ok ? bE : subtract ? gate('XOR', v(`B${i}`), v('MODE')) : v(`B${i}`), s: r && ID.test(r[4] ?? '') ? r[4] : `S${i}` }
  })
  if (fromTable) evidence.push(`Ripple-carry chain map: ${bits} stages read from the table`)
  else notes.push('No complete chain-map table was found, so standard signal names were used.')

  const bVars = stages.flatMap((s) => [...variables(s.b)])
  const modeVar = bVars.find((x) => bVars.filter((y) => y === x).length === bits && bits > 1)
  inputs.push(...stages.map((s) => s.a), ...[...new Set(bVars)].filter((x) => x !== modeVar))
  if (modeVar) inputs.push(modeVar)
  const carry0 = rows.length && new RegExp(`C0\\s*=\\s*(\\w+)`).exec(text)?.[1]
  const c0 = modeVar ?? (carry0 && inputs.includes(carry0) ? carry0 : null)
  if (c0) evidence.push(`Carry-in C0 is tied to ${c0}`)

  let carry: Expr | null = c0 ? v(c0) : null
  stages.forEach((s, i) => {
    let b: Expr = s.b
    if (b.op !== 'VAR') { equations.push({ name: `BX${i}`, expr: b }); b = v(`BX${i}`) }
    const p = gate('XOR', v(s.a), b)
    const map = { A: v(s.a), B: b }
    if (carry) {
      equations.push({ name: `P${i}`, expr: p })
      equations.push({ name: s.s, expr: gate('XOR', v(`P${i}`), carry) })
      // the cell's A⊕B term is the P signal, so that gate is shared inside the cell
      const withP = (e: Expr): Expr => e.op === 'VAR' ? e
        : e.op === 'XOR' && e.args.length === 2 && e.args.every((x) => x.op === 'VAR') && [...variables(e)].sort().join() === 'A,B' ? v(`P${i}`)
        : { op: e.op, args: e.args.map(withP) }
      equations.push({ name: `C${i + 1}`, expr: subst(withP(cout), { ...map, Cin: carry }) })
    } else {
      notes.push('Stage 0 has no carry-in, so it was built as a half adder.')
      equations.push({ name: s.s, expr: p }, { name: `C${i + 1}`, expr: gate('AND', v(s.a), b) })
    }
    carry = v(`C${i + 1}`)
  })
  const green = ledColor(text, /\bLEDs?\b/, 'green')
  const outputs = stages.map((s) => ({ name: s.s, color: ledColor(text, /LEDs?\s*(?:show|display)?[^.|]{0,10}result/, green) })).reverse()

  // "sign LED when MODE = 1 and the final carry C4 = 0"
  const sign = /\bsign\b[^.]{0,80}?\bwhen\s+(\w+)\s*=\s*([01])\s+and\s+(?:the\s+)?(?:final\s+)?(?:carry\s+)?(?:out\s+)?(\w+)\s*=\s*([01])/i.exec(text)
  let signName: string | null = null
  if (sign && [sign[1], sign[3]].every((x) => inputs.includes(x) || equations.some((e) => e.name === x))) {
    signName = 'SIGN'
    const lit = (n: string, val: string) => (val === '1' ? v(n) : not(v(n)))
    equations.push({ name: signName, expr: gate('AND', lit(sign[1], sign[2]), lit(sign[3], sign[4])) })
    outputs.unshift({ name: signName, color: ledColor(text, /sign\s+LED/, 'red') })
    evidence.push(`Sign LED rule: on when ${sign[1]} = ${sign[2]} and ${sign[3]} = ${sign[4]}`)
  } else if (!subtract) outputs.unshift({ name: `C${bits}`, color: 'red' })

  // test table: Mode | A dec/bin | B dec/bin | expected | observed | sign
  const tests: TestCase[] = []
  const bitsOf = (c: string) => new RegExp(`\\b[01]{${bits}}\\b`).exec(c)?.[0]
  for (const t of doc.tables) {
    const h = t[0].map((c) => c.toLowerCase())
    const col = (re: RegExp) => h.findIndex((c) => re.test(c))
    const [ca, cb, ce, cm, cs] = [col(/^a\b/), col(/^b\b/), col(/expected/), col(/^mode/), col(/sign/)]
    if (ca < 0 || cb < 0 || ce < 0) continue
    for (const r of t.slice(1)) {
      const a = bitsOf(r[ca] ?? ''), b = bitsOf(r[cb] ?? ''), e = /\b[01]+\b/.exec(r[ce] ?? '')?.[0]
      if (!a || !b || !e || e.length < bits) continue
      const set: TestCase['set'] = {}, expect: TestCase['expect'] = {}
      const bit = (s: string, i: number) => Number(s[s.length - 1 - i]) as 0 | 1
      stages.forEach((s, i) => {
        set[s.a] = bit(a, i)
        const bn = [...variables(s.b)].find((x) => x !== modeVar)
        if (bn) set[bn] = bit(b, i)
        expect[s.s] = bit(e, i)
      })
      const mode = cm >= 0 ? r[cm] : ''
      if (modeVar) set[modeVar] = /sub|1/i.test(mode) ? 1 : 0
      if (signName && cs >= 0 && /^(on|off)$/i.test(r[cs])) expect[signName] = /on/i.test(r[cs]) ? 1 : 0
      tests.push({ label: `${mode} ${r[ca]}, ${r[cb]}`.trim(), set, expect })
    }
  }
  if (tests.length) evidence.push(`${tests.length} test cases read from the manual's test table`)
  return { method: 'Ripple-carry adder chain', design: { title, inputs, outputs, equations }, evidence, notes, tests }
}

// ── truth table ──
function minterms(inputs: string[], ones: number[]): Expr {
  const terms = ones.map((m) => gate('AND', ...inputs.map((n, i) => ((m >> (inputs.length - 1 - i)) & 1 ? v(n) : not(v(n))))))
  return terms.length === 1 ? terms[0] : gate('OR', ...terms)
}
/** Quine–McCluskey with a greedy cover */
export function minimize(inputs: string[], ones: number[]): Expr {
  const n = inputs.length
  let cur = new Map(ones.map((m) => [`${m}/0`, { val: m, mask: 0 }]))
  const primes: { val: number; mask: number }[] = []
  while (cur.size) {
    const next: typeof cur = new Map()
    const used = new Set<string>()
    const list = [...cur]
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const [ka, a] = list[i], [kb, b] = list[j]
      const d = a.val ^ b.val
      if (a.mask !== b.mask || d === 0 || d & (d - 1)) continue
      used.add(ka); used.add(kb)
      const t = { val: a.val & ~d, mask: a.mask | d }
      next.set(`${t.val}/${t.mask}`, t)
    }
    for (const [k, t] of list) if (!used.has(k)) primes.push(t)
    cur = next
  }
  const left = new Set(ones)
  const covers = (p: { val: number; mask: number }) => [...left].filter((m) => (m & ~p.mask) === p.val)
  const terms: Expr[] = []
  // essential primes first
  const chosen = new Set<(typeof primes)[0]>()
  for (const m of ones) {
    const c = primes.filter((p) => (m & ~p.mask) === p.val)
    if (c.length === 1) chosen.add(c[0])
  }
  for (const p of chosen) covers(p).forEach((m) => left.delete(m))
  while (left.size) {
    const p = primes.reduce((a, b) => (covers(b).length > covers(a).length ? b : a))
    chosen.add(p)
    covers(p).forEach((m) => left.delete(m))
  }
  for (const p of chosen) {
    const lits = inputs.flatMap((name, i) => {
      const bit = 1 << (n - 1 - i)
      return p.mask & bit ? [] : [p.val & bit ? v(name) : not(v(name))]
    })
    terms.push(lits.length === 1 ? lits[0] : gate('AND', ...lits))
  }
  return terms.length === 1 ? terms[0] : gate('OR', ...terms)
}

function truthTable(doc: Doc, text: string, title: string, eqs: Equation[]): Partial<Analysis> | null {
  for (const t of doc.tables) {
    const body = t.slice(1).filter((r) => r.filter(binary).length >= 2)
    const k = Math.log2(body.length)
    if (!Number.isInteger(k) || k < 1 || k > 6) continue
    const head = t[0].map(word)
    const full = (c: number) => body.every((r) => binary(r[c] ?? ''))
    const inCols = Array.from({ length: k }, (_, i) => i)
    if (!inCols.every((c) => full(c) && ID.test(head[c]))) continue
    const index = (r: string[]) => inCols.reduce((a, c) => a * 2 + Number(r[c]), 0)
    if (new Set(body.map(index)).size !== body.length) continue
    const outCols = head.map((_, c) => c).filter((c) => c >= k && full(c) && ID.test(head[c]) && !head.slice(0, c).includes(head[c]))
    if (!outCols.length) continue
    const inputs = inCols.map((c) => head[c])
    const canonical = /canonical|unsimplified|no simplification|without (?:applying )?any (?:boolean )?simplification/i.test(text)
    const notes: string[] = [], equations: Equation[] = [], outputs: Design['outputs'] = []
    const evidence = [`Complete ${body.length}-row truth table over ${inputs.join(', ')}`]
    for (const c of outCols) {
      const name = head[c]
      const ones = body.filter((r) => r[c].trim() === '1').map(index).sort((a, b) => a - b)
      if (!ones.length || ones.length === body.length) { notes.push(`${name} is constant in the truth table, so it was left out.`); continue }
      const stated = eqs.find((e) => e.name === name && [...variables(e.expr)].every((x) => inputs.includes(x)))?.expr
      const agrees = stated && body.every((r) => evaluate(stated, Object.fromEntries(inCols.map((i) => [inputs[i], Number(r[i])]))) === Number(r[c]))
      if (stated && !agrees) notes.push(`The equation for ${name} in the text disagrees with the truth table. The table was used.`)
      equations.push({ name, expr: agrees ? stated : canonical ? minterms(inputs, ones) : minimize(inputs, ones) })
      evidence.push(`${name} = Σm(${ones.join(', ')}), ${agrees ? 'using the equation in the text' : canonical ? 'built as the canonical sum of products' : 'simplified'}`)
      outputs.push({ name, color: ledColor(text, /LED/, 'green') })
    }
    if (!equations.length) continue
    // a second lamp driven from the inverted signal
    const inv = new RegExp(`\\b${COLOR}\\s+(\\w+)\\s+(?:LED|lamp)\\s+from\\s+the\\s+(?:same\\s+signal\\s+inverted|inverted)`, 'i').exec(text)
    if (inv && equations.length === 1 && !inputs.includes(inv[2])) {
      equations.push({ name: inv[2], expr: not(v(equations[0].name)) })
      outputs.push({ name: inv[2], color: inv[1].toLowerCase() })
      evidence.push(`${inv[2]} lamp is the inverse of ${equations[0].name}`)
      const main = new RegExp(`\\b${COLOR}\\s+[A-Z]{3,}\\s+LED`).exec(text)
      if (main) outputs[0].color = main[1].toLowerCase()
    }
    const env = (r: string[]) => Object.fromEntries(inCols.map((c) => [inputs[c], Number(r[c]) as 0 | 1]))
    const tests = body.map((r) => {
      const expect: TestCase['expect'] = {}
      for (const c of outCols) if (equations.some((e) => e.name === head[c])) expect[head[c]] = Number(r[c]) as 0 | 1
      if (inv && equations.length === 2) expect[inv[2]] = (1 - expect[equations[0].name]) as 0 | 1
      return { label: inputs.map((n) => `${n}=${env(r)[n]}`).join(' '), set: env(r), expect }
    })
    return { method: 'Truth table', design: { title, inputs, outputs, equations }, evidence, notes, tests }
  }
  return null
}

// ── plain equations ──
function equationsOnly(text: string, title: string, eqs: Equation[]): Partial<Analysis> | null {
  if (!eqs.length) return null
  const names = new Set(eqs.map((e) => e.name))
  const used = new Set(eqs.flatMap((e) => [...variables(e.expr)]))
  const inputs = [...used].filter((x) => !names.has(x)).sort()
  const outs = eqs.filter((e) => !used.has(e.name))
  if (!inputs.length || inputs.length > 20) return null
  return {
    method: 'Boolean equations', tests: [], notes: [],
    design: { title, inputs, outputs: (outs.length ? outs : eqs).map((e) => ({ name: e.name, color: ledColor(text, /LED/, 'green') })), equations: eqs },
    evidence: eqs.map((e) => `Equation found for ${e.name}`),
  }
}

export function analyze(doc: Doc, fileName: string): Analysis {
  const text = doc.lines.join('\n')
  const title = (doc.lines.find((l) => /^(lab|experiment|exercise|activity|project)\b.*[:–-]/i.test(l) && !l.includes('|')) ?? fileName.replace(/\.\w+$/, '').replace(/_/g, ' ')).slice(0, 90)
  const eqs = findEquations(doc)
  const r = adder(doc, text, title, eqs) ?? truthTable(doc, text, title, eqs) ?? equationsOnly(text, title, eqs)
  const ohms = (re: RegExp, d: number) => {
    const m = re.exec(text)
    return m ? Number(m[1]) * (m[2] ? 1000 : 1) : d
  }
  const boardRow = doc.tables.flat().find((x) => /breadboard/i.test(x[0] ?? '') && !/module|power/i.test(x[0]))
  return {
    design: r?.design ?? null, method: r?.method ?? 'Nothing recognised', evidence: r?.evidence ?? [], notes: r?.notes ?? [], tests: r?.tests ?? [],
    parts: findParts(text, doc),
    boards: Number(boardRow?.find((c) => /^\d$/.test(c.trim())) ?? 1),
    ledOhms: ohms(/(\d+(?:\.\d+)?)\s*(k)?\s*Ω[^.|;,]{0,20}(?:LED|series)/i, 330),
    pullOhms: ohms(/(\d+(?:\.\d+)?)\s*(k)?\s*Ω[^.|;,]{0,20}pull/i, 10000),
  }
}
