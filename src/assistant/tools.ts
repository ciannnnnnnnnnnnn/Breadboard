/** What the assistant can see and do. Every input is model output, so it is validated here. */
import type Anthropic from '@anthropic-ai/sdk'
import { HOLE_BY_ID } from '../data/breadboard'
import { LED_COLORS, TYPES, compTitle, formatOhms, holeExists, occupiedHoles, pinsOf, placementError, stripOfEnd } from '../data/components'
import { ICS, pinInfo } from '../data/ics'
import type { Circuit, Comp, CompProps, CompType } from '../data/types'
import { textToDesign } from '../manual/expr'
import { synthesize } from '../manual/synthesize'
import { diagnose, problemCenter } from '../simulation/diagnose'
import { simulateWithBurn } from '../simulation/simulate'
import { useStore } from '../store/useStore'

type Input = Record<string, unknown>
interface ToolDef {
  description: string
  properties: Record<string, object>
  required: string[]
  /** needs the user's OK; returns the sentence shown on the approval card */
  confirm?: (i: Input) => string
  run: (i: Input) => string
}

const S = () => useStore.getState()
const str = (i: Input, k: string): string => {
  if (typeof i[k] !== 'string' || !(i[k] as string).trim()) throw new Error(`"${k}" must be a non-empty string`)
  return i[k] as string
}
const num = (i: Input, k: string, min: number, max: number): number => {
  const n = i[k]
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new Error(`"${k}" must be a number from ${min} to ${max}`)
  return n
}
const bool = (i: Input, k: string): boolean => {
  if (typeof i[k] !== 'boolean') throw new Error(`"${k}" must be true or false`)
  return i[k] as boolean
}
const find = (id: string): Comp => {
  const c = S().circuit.components.find((x) => x.id === id)
  if (!c) throw new Error(`There is no part with id "${id}". Use inspect_circuit for the current ids.`)
  return c
}
const nameOf = (id: unknown) => {
  const c = S().circuit.components.find((x) => x.id === id)
  return c ? compTitle(c) : String(id)
}
/** editing is only allowed while stopped */
const edit = () => { if (S().running) S().stop() }

/** switch name → where it lives: "A0" on a DIP, or a toggle / logic input by its label or id */
function switches(c: Circuit): Map<string, { id: string; index?: number; on: boolean }> {
  const m = new Map<string, { id: string; index?: number; on: boolean }>()
  for (const x of c.components) {
    if (x.type === 'dip4') x.props.switches!.forEach((on, index) => m.set(x.props.names?.[index] ?? `${x.id}:${index + 1}`, { id: x.id, index, on }))
    else if (['toggle', 'input', 'button'].includes(x.type)) m.set(x.props.label && !m.has(x.props.label) ? x.props.label : x.id, { id: x.id, on: !!x.props.on })
  }
  return m
}
const getSwitch = (name: string) => {
  const all = switches(S().circuit)
  const s = all.get(name) ?? [...all.values()].find((x) => x.id === name && x.index === undefined)
  if (!s) throw new Error(`There is no switch "${name}". Available: ${[...all.keys()].join(', ') || 'none'}`)
  return s
}
const withSwitch = (c: Circuit, s: { id: string; index?: number }, on: boolean): Circuit => ({
  ...c,
  components: c.components.map((x) => (x.id !== s.id ? x : {
    ...x, props: s.index === undefined ? { ...x.props, on } : { ...x.props, switches: x.props.switches!.map((v, i) => (i === s.index ? on : v)) },
  })),
})
const readings = (c: Circuit, prev = {}) => {
  const { result, burned } = simulateWithBurn(c, prev, {})
  const list = c.components.flatMap((x) =>
    x.type === 'led' ? [`${compTitle(x)} (${x.id}): ${burned[x.id] !== undefined ? 'BURNED' : result.comps[x.id].current! > 1e-4 ? 'on' : 'off'}`]
    : x.type === 'probe' ? [`${compTitle(x)} (${x.id}): ${result.comps[x.id].pins.IN.level}`] : [])
  return { result, burned, text: list.join('; ') || 'no LEDs or probes' }
}

export function describeCircuit(): string {
  const s = S()
  const { circuit } = s
  const { result, burned } = s.sim ? { result: s.sim, burned: s.burned } : simulateWithBurn(circuit, {}, {})
  const out: string[] = [
    `Project: ${s.name}`,
    `Simulation: ${s.running ? 'running' : 'stopped (levels below are what it would show if started now)'}. Breadboards: ${circuit.boards ?? 1}. Supply current ${(result.supplyCurrent * 1000).toFixed(2)} mA.`,
    `Selected by the user: ${s.selection ? (s.selection.kind === 'comp' ? `${nameOf(s.selection.id)} (${s.selection.id})` : `wire ${s.selection.id}`) : 'nothing'}`,
    '', 'PARTS (id | what | pin@hole=level voltage)',
  ]
  for (const c of circuit.components) {
    const st = result.comps[c.id]
    const p = c.props
    const extra = [
      c.type === 'resistor' && `${formatOhms(p.ohms!)} ${(st.current! * 1000).toFixed(2)} mA`,
      c.type === 'led' && `${p.color} Vf=${p.vf} ${burned[c.id] !== undefined ? 'BURNED' : `${(st.current! * 1000).toFixed(2)} mA`}`,
      (c.type === 'supply' || c.type === 'battery') && `${p.volts} V`,
      c.type === 'ic' && `${p.part} ${st.powered ? 'powered' : 'NOT POWERED'}`,
      c.type === 'dip4' && p.switches!.map((v, i) => `${p.names?.[i] ?? i + 1}=${v ? 1 : 0}`).join(' '),
      ['toggle', 'input', 'button'].includes(c.type) && `set to ${p.on ? 1 : 0}`,
    ].filter(Boolean).join(' ')
    const pins = pinsOf(c).map((q) => {
      const n = st.pins[q.name]
      const role = c.type === 'ic' ? `(${pinInfo(ICS[p.part!], Number(q.name)).label})` : ''
      return `${q.name}${role}@${q.hole ?? q.strip}=${n.level}${n.v === null ? '' : ` ${n.v.toFixed(2)}V`}`
    })
    out.push(`${c.id} | ${compTitle(c)} ${extra} | ${pins.join(', ')}`)
  }
  out.push('', 'WIRES (id from>to)')
  out.push(circuit.wires.map((w) => `${w.id} ${w.from}>${w.to}`).join('; ') || 'none')
  out.push('', 'PROBLEMS')
  const problems = diagnose(circuit, result, burned)
  out.push(...(problems.length ? problems.map((p) => `[${p.severity}] ${p.title} | parts ${p.comps.join(',')} | wires ${p.wires.join(',')} | fix: ${p.fix.join(' ')}`) : ['none found']))
  return out.join('\n')
}

const ADDABLE: CompType[] = ['toggle', 'button', 'dip4', 'input', 'led', 'probe', 'resistor', 'ic', 'gnd']

export const TOOLS: Record<string, ToolDef> = {
  inspect_circuit: {
    description: "Read the whole circuit: every part with its pins, holes, logic levels and voltages, all wires, what the user has selected, and the simulator's own list of problems. Call this before answering anything about the user's circuit, and again after edits, because the user can change the board between messages.",
    properties: {}, required: [], run: describeCircuit,
  },
  try_inputs: {
    description: 'Simulate up to 32 switch combinations and report the LEDs and probes for each, without changing the board. Use it to check a truth table or test a theory. Combinations keep latch state from one to the next, in order.',
    properties: { cases: { type: 'array', description: 'Each case lists switch settings as text, such as "A0=1, Switch B=0". Switches left out keep their current setting.', items: { type: 'string' } } },
    required: ['cases'],
    run: (i) => {
      if (!Array.isArray(i.cases) || !i.cases.length || i.cases.length > 32) throw new Error('"cases" must be a list of 1 to 32 cases')
      let prev = {}
      return i.cases.map((k) => {
        if (typeof k !== 'string') throw new Error('each case must be text such as "A=1, B=0"')
        let c = S().circuit
        for (const part of k.split(',').filter((x) => x.trim())) {
          const m = /^(.+?)\s*=\s*([01])$/.exec(part.trim())
          if (!m) throw new Error(`"${part.trim()}" should look like "A=1"`)
          c = withSwitch(c, getSwitch(m[1]), m[2] === '1')
        }
        const r = readings(c, prev)
        prev = r.result.gateOut
        return `${k} -> ${r.text}${r.result.warnings.length ? ` [${r.result.warnings[0].msg}]` : ''}`
      }).join('\n')
    },
  },
  show_part: {
    description: 'Select a part and move the camera to it, so the user can see what you are talking about.',
    properties: { id: { type: 'string' } }, required: ['id'],
    run: (i) => {
      const c = find(str(i, 'id'))
      S().select({ kind: 'comp', id: c.id })
      const at = problemCenter({ comps: [c.id] } as never, S().circuit)
      S().setActiveProblem(null, at)
      return `Showing ${compTitle(c)}`
    },
  },
  set_switch: {
    description: 'Set one switch or logic input on the board.',
    properties: { name: { type: 'string', description: 'Switch name such as "A0" or "Switch A", or a part id' }, on: { type: 'boolean' } }, required: ['name', 'on'],
    run: (i) => {
      const s = getSwitch(str(i, 'name')), on = bool(i, 'on')
      if (s.on !== on) S().toggleInput(s.id, s.index, on)
      return `${i.name} is ${on ? 1 : 0}. ${readings(S().circuit, S().sim?.gateOut).text}`
    },
  },
  run_simulation: {
    description: 'Start or stop the simulation.',
    properties: { run: { type: 'boolean' } }, required: ['run'],
    run: (i) => {
      const r = bool(i, 'run')
      if (r !== S().running) (r ? S().start : S().stop)()
      return r ? 'Running' : 'Stopped'
    },
  },
  add_wire: {
    description: 'Connect two places with a wire. An end is a hole id ("a12"; second board "2.a12"; rails "tp5" top +, "tn5" top −, "bp5", "bn5"; rails have no hole at columns divisible by 6) or a supply terminal ("@partId.+" or "@partId.−"). Each hole takes one lead, so choose a free hole in the same 5-hole column as the pin.',
    properties: { from: { type: 'string' }, to: { type: 'string' }, color: { type: 'string', enum: ['auto', 'red', 'black', 'blue', 'yellow', 'green', 'white', 'orange'] } }, required: ['from', 'to'],
    confirm: (i) => `Add a wire from ${i.from} to ${i.to}`,
    run: (i) => {
      edit()
      const c = S().circuit
      const ends = [str(i, 'from'), str(i, 'to')].map((e) => e.replace(/^(@.*\.)-$/, '$1−'))
      const occ = occupiedHoles(c)
      for (const e of ends) {
        if (e[0] === '@') {
          const ok = c.components.some((x) => TYPES[x.type].offBoard && pinsOf(x).some((p) => p.strip === e))
          if (!ok) throw new Error(`There is no terminal "${e}"`)
        } else if (!holeExists(e, c)) throw new Error(`There is no hole "${e}" on the boards in use`)
        else if (occ.has(e)) {
          const free = [...HOLE_BY_ID.values()].filter((h) => h.strip === stripOfEnd(e) && !occ.has(h.id) && !ends.includes(h.id)).slice(0, 8).map((h) => h.id)
          throw new Error(`Hole ${e} is in use. Free holes on the same strip: ${free.join(', ') || 'none'}`)
        }
      }
      if (ends[0] === ends[1]) throw new Error('Both ends are the same')
      const old = S().wireColor
      S().setWireColor(['red', 'black', 'blue', 'yellow', 'green', 'white', 'orange'].includes(i.color as string) ? (i.color as string) : 'auto')
      S().cancel()
      S().clickEnd(ends[0])
      S().clickEnd(ends[1])
      S().setWireColor(old)
      return `Added wire ${S().circuit.wires.at(-1)!.id} ${ends.join(' > ')}`
    },
  },
  add_part: {
    description: 'Place a part. `hole` is where its first pin goes; for an IC it is the hole of pin 1, which must be in row f (pin 14 lands in row e above it). Resistors and LEDs lie along the row unless rotated; rotation 1 points them toward the bottom rail.',
    properties: {
      type: { type: 'string', enum: ADDABLE }, hole: { type: 'string' }, rotation: { type: 'integer', description: '0 to 3 quarter turns clockwise' },
      part: { type: 'string', enum: Object.keys(ICS), description: 'IC only' }, ohms: { type: 'number', description: 'resistor only' },
      color: { type: 'string', enum: Object.keys(LED_COLORS), description: 'LED only' }, span: { type: 'integer', description: 'resistor or LED: distance between legs in holes' }, label: { type: 'string' },
    },
    required: ['type', 'hole'],
    confirm: (i) => `Place ${i.type === 'ic' ? `a ${i.part}` : i.type === 'resistor' ? `a ${i.ohms ?? 330} Ω resistor` : `${/^[aeio]/.test(String(i.type)) ? 'an' : 'a'} ${i.type === 'led' ? `${i.color ?? 'red'} LED` : i.type}`} at ${i.hole}`,
    run: (i) => {
      edit()
      const type = str(i, 'type') as CompType
      if (!ADDABLE.includes(type)) throw new Error(`"type" must be one of ${ADDABLE.join(', ')}`)
      const h = HOLE_BY_ID.get(str(i, 'hole'))
      if (!h || !holeExists(h.id, S().circuit)) throw new Error(`There is no hole "${i.hole}"`)
      const rot = i.rotation === undefined ? 0 : num(i, 'rotation', 0, 3)
      if (rot % TYPES[type].rotStep) throw new Error('This part only fits at rotation 0 or 2')
      const props: CompProps = { ...TYPES[type].defaults }
      if (type === 'ic') { props.part = str(i, 'part'); if (!Object.hasOwn(ICS, props.part)) throw new Error('Unknown IC') }
      if (type === 'resistor' && i.ohms !== undefined) props.ohms = num(i, 'ohms', 0.1, 1e7)
      if (type === 'led' && i.color !== undefined) {
        props.color = str(i, 'color')
        if (!Object.hasOwn(LED_COLORS, props.color)) throw new Error('Unknown LED colour')
        props.vf = LED_COLORS[props.color].vf
      }
      if ((type === 'led' || type === 'resistor') && i.span !== undefined) props.span = Math.round(num(i, 'span', 1, 12))
      if (i.label !== undefined) props.label = str(i, 'label').slice(0, 40)
      const c: Comp = { id: '', type, x: 0, z: 0, rot, props }
      const first = pinsOf(c)[0]
      c.x = h.x - first.x; c.z = h.z - first.z
      const err = placementError(c, S().circuit)
      if (err) throw new Error(err)
      useStore.setState({ placing: { type, props, rot } })
      if (!S().placeAt(c.x, c.z)) { S().cancel(); throw new Error('The part does not fit there') }
      const made = S().circuit.components.at(-1)!
      return `Placed ${made.id}: ${pinsOf(made).map((p) => `${p.name}@${p.hole}`).join(', ')}`
    },
  },
  change_part: {
    description: 'Change the value of a part: resistor ohms, LED colour, supply volts, or a label.',
    properties: { id: { type: 'string' }, ohms: { type: 'number' }, color: { type: 'string', enum: Object.keys(LED_COLORS) }, volts: { type: 'number' }, label: { type: 'string' } }, required: ['id'],
    confirm: (i) => `Change ${nameOf(i.id)}: ${['ohms', 'color', 'volts', 'label'].filter((k) => i[k] !== undefined).map((k) => `${k} = ${i[k]}`).join(', ')}`,
    run: (i) => {
      const c = find(str(i, 'id'))
      const p: CompProps = {}
      if (i.ohms !== undefined) { if (c.type !== 'resistor') throw new Error('Only resistors have ohms'); p.ohms = num(i, 'ohms', 0.1, 1e7) }
      if (i.color !== undefined) {
        if (c.type !== 'led' || !Object.hasOwn(LED_COLORS, str(i, 'color'))) throw new Error('Not a valid LED colour')
        p.color = str(i, 'color'); p.vf = LED_COLORS[p.color].vf
      }
      if (i.volts !== undefined) { if (c.type !== 'supply' && c.type !== 'battery') throw new Error('Only supplies have volts'); p.volts = num(i, 'volts', 0, 30) }
      if (i.label !== undefined) p.label = str(i, 'label').slice(0, 40)
      if (!Object.keys(p).length) throw new Error('Nothing to change')
      S().updateProps(c.id, p)
      return `Changed ${compTitle(find(c.id))}`
    },
  },
  remove: {
    description: 'Remove one part or wire by id.',
    properties: { id: { type: 'string' } }, required: ['id'],
    confirm: (i) => {
      const w = S().circuit.wires.find((x) => x.id === i.id)
      return w ? `Remove the wire ${w.from} to ${w.to}` : `Remove ${nameOf(i.id)}`
    },
    run: (i) => {
      const id = str(i, 'id')
      const wire = S().circuit.wires.some((w) => w.id === id)
      if (!wire) find(id)
      edit()
      S().select({ kind: wire ? 'wire' : 'comp', id })
      S().deleteSelected()
      return `Removed ${id}`
    },
  },
  build_circuit: {
    description: `Build a complete, wired circuit from Boolean equations, replacing the current one. This is the reliable way to make anything with several gates: it places chips, switches with pull-downs, LEDs with resistors, power and all wiring. The spec is text, one statement per line:
title: Half adder
inputs: A, B
SUM = A XOR B
CARRY = A AND B
outputs: CARRY red, SUM green
Operators: AND OR XOR NOT NAND NOR XNOR and parentheses. Equations may use other equations. Output colours: ${Object.keys(LED_COLORS).join(', ')}. Combinational logic only.`,
    properties: { spec: { type: 'string' } }, required: ['spec'],
    confirm: (i) => `Replace the circuit with "${/title:\s*(.+)/i.exec(String(i.spec))?.[1] ?? 'a new circuit'}" (Undo brings the old one back)`,
    run: (i) => {
      const text = str(i, 'spec')
      if (text.length > 8000) throw new Error('The spec is too long')
      const d = textToDesign(text)
      const r = synthesize(d)
      S().load(r.circuit, d.title)
      return `Built ${r.packages.length} chips and ${r.gates.length} gates on ${r.boards} board(s). Gate map: ${r.packages.flatMap((p) => p.gates.map((g) => `${p.name} ${p.part} pins ${g.pins!.join('/')}: ${g.inputs.join(', ')} -> ${g.output}`)).join('; ')}`
    },
  },
}

export const toolParams: Anthropic.Beta.BetaTool[] = Object.entries(TOOLS).map(([name, t]) => ({
  name, description: t.description, eager_input_streaming: true,
  input_schema: { type: 'object', properties: t.properties, required: t.required, additionalProperties: false },
}))

const asInput = (v: unknown): Input => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('the input must be an object')
  return v as Input
}
/** reject unknown tools, missing or unexpected fields before anything runs or is shown for approval */
export function checkCall(name: string, input: unknown): { tool: ToolDef; input: Input } {
  if (!Object.hasOwn(TOOLS, name)) throw new Error(`There is no tool "${name}"`)
  const tool = TOOLS[name]
  const i = asInput(input)
  for (const k of tool.required) if (!(k in i)) throw new Error(`"${k}" is required`)
  for (const k of Object.keys(i)) if (!Object.hasOwn(tool.properties, k)) throw new Error(`"${k}" is not a field of ${name}`)
  return { tool, input: i }
}
