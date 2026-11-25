/** Boolean expressions: parser, evaluator, and the editable text form of a design. */
import type { GateType } from '../data/ics'

export type Expr = { op: 'VAR'; name: string } | { op: GateType; args: Expr[] }
export const v = (name: string): Expr => ({ op: 'VAR', name })
export const not = (a: Expr): Expr => ({ op: 'NOT', args: [a] })
export const gate = (op: GateType, ...args: Expr[]): Expr => ({ op, args })

type Tok = { t: 'id' | 'op' | '(' | ')' | 'bar'; v: string }
const WORDS: Record<string, string> = { AND: '*', OR: '+', XOR: '^', XNOR: '=', NAND: 'NAND', NOR: 'NOR', NOT: '!' }

function tokenize(s: string): Tok[] {
  const out: Tok[] = []
  const src = s.normalize('NFD')
  const re = /\s+|([A-Za-z][A-Za-z0-9_]*)|([⊕^])|([·•∙⋅×*&∧])|([+|∨])|(⊙)|([!~¬])|(['’′̄̅])|([([{])|([)\]}])/y
  while (re.lastIndex < src.length) {
    const at = re.lastIndex
    const m = re.exec(src)
    if (!m) throw new Error(`unexpected "${src[at]}"`)
    if (m[1]) out.push(WORDS[m[1]] ? { t: 'op', v: WORDS[m[1]] } : { t: 'id', v: m[1] })
    else if (m[2]) out.push({ t: 'op', v: '^' })
    else if (m[3]) out.push({ t: 'op', v: '*' })
    else if (m[4]) out.push({ t: 'op', v: '+' })
    else if (m[5]) out.push({ t: 'op', v: '=' })
    else if (m[6]) out.push({ t: 'op', v: '!' })
    else if (m[7]) out.push({ t: 'bar', v: "'" })
    else if (m[8]) out.push({ t: '(', v: '(' })
    else if (m[9]) out.push({ t: ')', v: ')' })
  }
  return out
}

/** Precedence: NOT, AND (also by juxtaposition), XOR/XNOR, OR. NAND/NOR words bind like AND/OR. */
export function parseExpr(s: string): Expr {
  if (s.length > 2000) throw new Error('expression is too long')
  const toks = tokenize(s)
  let i = 0
  let depth = 0
  const peek = (val: string) => toks[i]?.t === 'op' && toks[i].v === val
  const chain = (next: () => Expr, ops: Record<string, GateType>) => () => {
    let left = next()
    for (;;) {
      const t = toks[i]
      const op = t?.t === 'op' ? ops[t.v] : undefined
      // two factors side by side mean AND
      const implied = !op && '*' in ops && (t?.t === 'id' || t?.t === '(' || peek('!'))
      if (!op && !implied) return left
      if (op) i++
      const g = op ?? 'AND'
      const right = next()
      left = left.op === g && g !== 'NAND' && g !== 'NOR' && g !== 'XNOR' ? { op: g, args: [...left.args, right] } : gate(g, left, right)
    }
  }
  const atom = (): Expr => {
    if (++depth > 200) throw new Error('expression is nested too deeply')
    const t = toks[i++]
    let e: Expr
    if (!t) throw new Error('expression ends early')
    if (t.t === 'op' && t.v === '!') e = not(atom())
    else if (t.t === 'id') e = v(t.v)
    else if (t.t === '(') {
      e = or()
      if (toks[i++]?.t !== ')') throw new Error('missing ")"')
      // keep the grouping: (A⊕B)⊕C must stay two separate gates
    } else throw new Error(`unexpected "${t.v}"`)
    while (toks[i]?.t === 'bar') { i++; e = not(e) }
    depth--
    return e
  }
  const and = chain(atom, { '*': 'AND', NAND: 'NAND' })
  const xor = chain(and, { '^': 'XOR', '=': 'XNOR' })
  const or = chain(xor, { '+': 'OR', NOR: 'NOR' })
  const e = or()
  if (i < toks.length) throw new Error(`unexpected "${toks[i].v}"`)
  return e
}

export function variables(e: Expr, into = new Set<string>()): Set<string> {
  if (e.op === 'VAR') into.add(e.name)
  else e.args.forEach((a) => variables(a, into))
  return into
}
export function evaluate(e: Expr, env: Record<string, number>): number {
  if (e.op === 'VAR') return env[e.name] ?? 0
  const a = e.args.map((x) => evaluate(x, env))
  const all = a.every(Boolean), any = a.some(Boolean), odd = a.filter(Boolean).length % 2 === 1
  return Number({ NOT: !a[0], AND: all, OR: any, NAND: !all, NOR: !any, XOR: odd, XNOR: !odd }[e.op])
}
export function format(e: Expr, top = true): string {
  if (e.op === 'VAR') return e.name
  if (e.op === 'NOT') return e.args[0].op === 'VAR' ? `${e.args[0].name}'` : `NOT (${format(e.args[0])})`
  const sym = { AND: ' · ', OR: ' + ', XOR: ' ⊕ ', XNOR: ' XNOR ', NAND: ' NAND ', NOR: ' NOR ' }[e.op]
  const s = e.args.map((a) => format(a, false)).join(sym)
  return top ? s : `(${s})`
}

// ── design ──
export interface OutputDef { name: string; color: string }
export interface Equation { name: string; expr: Expr }
export interface Design { title: string; inputs: string[]; outputs: OutputDef[]; equations: Equation[] }
const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'white']

export function designToText(d: Design): string {
  return [
    `title: ${d.title}`,
    `inputs: ${d.inputs.join(', ')}`,
    ...d.equations.map((e) => `${e.name} = ${format(e.expr)}`),
    `outputs: ${d.outputs.map((o) => `${o.name} ${o.color}`).join(', ')}`,
  ].join('\n')
}

/** Parses and validates the text form. Throws with the offending line. */
export function textToDesign(text: string): Design {
  const d: Design = { title: 'From manual', inputs: [], outputs: [], equations: [] }
  text.split(/\r?\n/).forEach((raw, n) => {
    const line = raw.replace(/#.*/, '').trim()
    if (!line) return
    const fail = (m: string) => { throw new Error(`Line ${n + 1}: ${m}`) }
    const kv = /^(title|inputs|outputs)\s*:\s*(.*)$/i.exec(line)
    if (kv) {
      const key = kv[1].toLowerCase()
      if (key === 'title') d.title = kv[2].slice(0, 120)
      else {
        for (const item of kv[2].split(',').map((x) => x.trim()).filter(Boolean)) {
          const [name, color] = item.split(/\s+/)
          if (!/^[A-Za-z]\w*$/.test(name)) fail(`"${name}" is not a valid signal name`)
          if (key === 'inputs') d.inputs.push(name)
          else {
            if (color && !COLORS.includes(color)) fail(`LED colour "${color}" is not one of ${COLORS.join(', ')}`)
            d.outputs.push({ name, color: color ?? 'green' })
          }
        }
      }
      return
    }
    const eq = /^([A-Za-z]\w*)\s*=\s*(.+)$/.exec(line)
    if (!eq) return fail('expected "NAME = expression", "inputs:" or "outputs:"')
    try { d.equations.push({ name: eq[1], expr: parseExpr(eq[2]) }) } catch (e) { fail((e as Error).message) }
  })
  const known = new Set<string>()
  for (const n of [...d.inputs, ...d.equations.map((e) => e.name)]) {
    if (known.has(n)) throw new Error(`"${n}" is defined twice`)
    known.add(n)
  }
  if (!d.inputs.length) throw new Error('Add an "inputs:" line')
  if (!d.equations.length) throw new Error('Add at least one equation')
  if (!d.outputs.length) throw new Error('Add an "outputs:" line')
  for (const e of d.equations) for (const x of variables(e.expr)) if (!known.has(x)) throw new Error(`"${x}" in the equation for ${e.name} is not an input or another equation`)
  for (const o of d.outputs) if (!known.has(o.name)) throw new Error(`Output "${o.name}" has no equation`)
  return d
}
