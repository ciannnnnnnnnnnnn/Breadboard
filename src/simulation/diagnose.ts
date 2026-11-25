/**
 * Turns a simulation result into problems a learner can act on: what is wrong,
 * why it matters, how to fix it, and exactly which parts / pins / wires to highlight.
 */
import { compTitle, formatOhms, LED_MAX_MA, TYPES } from '../data/components'
import { ICS, pinInfo } from '../data/ics'
import type { Circuit, Comp } from '../data/types'
import { pinNet, powerNets, type Edge } from './netlist'
import type { Severity, SimResult } from './simulate'

export interface Problem {
  key: string
  severity: Severity
  title: string
  why: string
  fix: string[]
  comps: string[]
  wires: string[]
  pins: { compId: string; pin: string }[]
}

const STANDARD = [47, 100, 150, 220, 330, 470, 680, 1000, 1500, 2200, 3300, 4700, 10000]
/** smallest common resistor that keeps an LED at or below 15 mA */
export const recommendedResistor = (volts: number, vf: number) => {
  const need = Math.max(0, volts - vf) / 0.015
  return STANDARD.find((r) => r >= need) ?? Math.ceil(need / 1000) * 1000
}

export function diagnose(circuit: Circuit, sim: SimResult, burned: Record<string, number> = {}): Problem[] {
  const nl = sim.netlist
  const out: Problem[] = []
  const comp = (id: string) => nl.comps.get(id)!
  const net = (c: Comp, pin: string) => pinNet(nl, c.id, pin)
  const strip = (c: Comp, pin: string) => nl.pins.get(c.id)![pin].strip
  const add = (p: Partial<Problem> & Pick<Problem, 'key' | 'severity' | 'title' | 'why' | 'fix'>) =>
    out.push({ comps: [], wires: [], pins: [], ...p })
  const { vcc, gnd } = powerNets(nl)
  const supplies = circuit.components.filter((c) => c.type === 'supply' || c.type === 'battery')
  const volts = Math.max(0, ...supplies.map((s) => s.props.volts ?? 5)) || 5

  // net → pins sitting on it
  const pinsOn = new Map<number, { c: Comp; pin: string }[]>()
  for (const c of circuit.components) for (const p of Object.keys(nl.pins.get(c.id)!)) {
    const n = net(c, p)
    pinsOn.set(n, [...(pinsOn.get(n) ?? []), { c, pin: p }])
  }
  const isOutput = (c: Comp, pin: string) =>
    c.type === 'input' || (c.type === 'ic' && pinInfo(ICS[c.props.part!], Number(pin)).role === 'out')
  const outputsOn = (n: number) => (pinsOn.get(n) ?? []).filter((q) => isOutput(q.c, q.pin))
  /** no other pin shares this net */
  const alone = (c: Comp, pin: string) => (pinsOn.get(net(c, pin)) ?? []).length < 2

  /** edges of the shortest connection from one strip to any of the targets */
  const route = (from: string, targets: Set<string>): Edge[] => {
    const seen = new Map<string, { edge: Edge; prev: string } | null>([[from, null]])
    const q = [from]
    while (q.length) {
      const s = q.shift()!
      if (targets.has(s)) {
        const path: Edge[] = []
        for (let at = s, step = seen.get(at); step; at = step.prev, step = seen.get(at)) path.push(step.edge)
        return path
      }
      for (const e of nl.edges) {
        const o = e.a === s ? e.b : e.b === s ? e.a : null
        if (o && !seen.has(o)) { seen.set(o, { edge: e, prev: s }); q.push(o) }
      }
    }
    return []
  }
  const split = (edges: Edge[]) => ({
    wires: [...new Set(edges.filter((e) => e.kind === 'wire').map((e) => e.id))],
    switches: [...new Set(edges.filter((e) => e.kind === 'contact').map((e) => e.id))],
  })
  const railStrips = (n: number) => new Set((pinsOn.get(n) ?? []).filter((q) => ['supply', 'battery', 'gnd'].includes(q.c.type)).map((q) => strip(q.c, q.pin)))
  const pinName = (q: { c: Comp; pin: string }) => (q.c.type === 'ic' ? `${compTitle(q.c)} pin ${q.pin}` : compTitle(q.c))
  const list = (a: string[]) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`)

  for (const w of sim.warnings) {
    const [kind, id, pin] = w.key.split(':')
    const base = { key: w.key, severity: w.severity, title: w.msg }
    switch (kind) {
      case 'short': {
        const s = comp(id)
        const path = split(route(strip(s, '+'), new Set([strip(s, '−')])))
        if (!path.wires.length && !path.switches.length) {
          add({
            ...base, comps: [id, ...supplies.filter((q) => q.id !== id).map((q) => q.id)],
            why: 'Two sources are trying to hold the same connection at different voltages, or a source is tied to ground the wrong way round. In a real circuit a very large current would flow between them.',
            fix: ['Use a single supply for the circuit, or set both sources to the same voltage.', 'Check that every − terminal goes to the − (blue) rail and every + terminal to the + (red) rail.'],
          })
          break
        }
        add({
          ...base, comps: [id, ...path.switches], wires: path.wires,
          why: 'There is a path from + straight back to − with nothing in it to limit the current. A real supply would overheat or shut down and the wires could burn. Nothing in the circuit works while the short is there.',
          fix: [
            `Follow the highlighted path and remove or move ${path.wires.length === 1 ? 'that wire' : 'one of its wires'} so + and − are no longer joined.`,
            ...(path.switches.length ? [`The path runs through ${list(path.switches.map((q) => compTitle(comp(q))))}. A switch must not connect + to − directly.`] : []),
            'If you meant to light an LED or pull a signal down, put a resistor in the path.',
          ],
        })
        break
      }
      case 'multi': {
        const n = Number(id), who = outputsOn(n)
        // only the wires that actually join the outputs
        const joins = split(who.slice(1).flatMap((q) => route(strip(q.c, q.pin), new Set([strip(who[0].c, who[0].pin)]))))
        add({
          ...base, comps: [...new Set([...who.map((q) => q.c.id), ...joins.switches])], pins: who.map((q) => ({ compId: q.c.id, pin: q.pin })), wires: joins.wires,
          why: 'Each output forces its own 0 or 1. When they disagree they fight, a large current flows between the chips, and the level is undefined.',
          fix: [`Disconnect ${list(who.slice(1).map(pinName))} so only one output drives this net.`, 'To combine signals, feed both outputs into a gate (for example OR 7432 or AND 7408) and use its output.'],
        })
        break
      }
      case 'outshort': {
        const n = Number(id), who = outputsOn(n)
        const path = split(who.flatMap((q) => route(strip(q.c, q.pin), railStrips(n))))
        add({
          ...base, comps: [...new Set([...who.map((q) => q.c.id), ...path.switches])], pins: who.map((q) => ({ compId: q.c.id, pin: q.pin })), wires: path.wires,
          why: 'An output is wired directly to a power rail. Whenever it tries to drive the other level it is short-circuited, which damages the chip.',
          fix: ['Remove the highlighted connection between the output and the rail.', 'To drive an LED from the output, use output → resistor → LED → GND.', 'If you meant to set an input, check the pinout: you may be one pin off.'],
        })
        break
      }
      case 'power': {
        const c = comp(id), def = ICS[c.props.part!]
        const V = sim.comps[id].pins[def.vcc].v, G = sim.comps[id].pins[def.gnd].v
        const pins = [...(V === null ? [def.vcc] : []), ...(G === null ? [def.gnd] : [])]
        const fix = pins.map((p) => `Wire pin ${p} (${p === def.vcc ? 'VCC' : 'GND'}) to the ${p === def.vcc ? '+ (red)' : '− (blue)'} rail.`)
        if (pins.length) {
          if (!supplies.length) fix.push('There is no power supply yet. Add one and connect it to the rails.')
          else fix.push('Check that the rail itself is connected to the supply. Top and bottom rails are separate until you join them with wires.')
        } else if (V! < G!) fix.push('Swap the two power wires: pin 14 goes to +, pin 7 goes to −.', 'If the chip is rotated, pin 1 is the one next to the dot and notch.')
        else fix.push(V! - G! > 7 ? 'Lower the supply to 5 V.' : 'Raise the supply to 5 V.', 'Check that VCC is not being fed through a resistor.')
        add({
          ...base, comps: [id], pins: (pins.length ? pins : [def.vcc, def.gnd]).map((p) => ({ compId: id, pin: String(p) })), fix,
          why: 'A logic chip only works when VCC and GND are connected and about 5 V apart. Until then every output floats, so everything after it is unknown.',
        })
        break
      }
      case 'osc': {
        const c = comp(id), def = ICS[c.props.part!]
        const loop = def.gates.map((g) => g.output).filter((p) => sim.gateOut[`${id}:${def.gates.findIndex((g) => g.output === p)}`] === 'Z' && !alone(c, String(p)))
        const fed = def.gates.flatMap((g) => [...g.inputs, g.output]).filter((p) => loop.some((o) => net(c, String(o)) === net(c, String(p))))
        const nets = new Set(loop.map((p) => net(c, String(p))))
        add({
          ...base, comps: [id], pins: fed.map((p) => ({ compId: id, pin: String(p) })),
          wires: circuit.wires.filter((x) => nl.edges.some((e) => e.id === x.id && nets.has(nl.netOf.get(e.a)!))).map((x) => x.id),
          why: 'An output feeds back to its own input through an odd number of inversions. Each time it settles it flips itself again, so it never becomes a steady 0 or 1.',
          fix: ['Remove the highlighted wire that returns the output to the input.', 'For memory, use two cross-coupled NOR or NAND gates (an SR latch), which is a stable loop.'],
        })
        break
      }
      case 'burn': {
        const c = comp(id)
        const R = recommendedResistor(volts, c.props.vf ?? 2)
        const series = circuit.components.filter((r) => r.type === 'resistor' && ['1', '2'].some((p) => [net(c, 'A'), net(c, 'K')].includes(net(r, p)) && !vcc.has(net(r, p)) && !gnd.has(net(r, p))))
        add({
          ...base, title: w.msg, comps: [id, ...series.map((r) => r.id)],
          why: series.length
            ? `The series resistance is too small, so more than ${LED_MAX_MA} mA flowed. I = (V − Vf) ÷ R: with ${volts} V and Vf = ${c.props.vf} V you need at least ${Math.ceil((volts - c.props.vf!) / (LED_MAX_MA / 1000))} Ω.`
            : 'An LED does not limit its own current. Without a series resistor the current rises until the LED is destroyed.',
          fix: [
            series.length ? `Change ${compTitle(series[0])} to ${formatOhms(R)} or more.` : `Put a ${formatOhms(R)} resistor in series with the LED, on either leg.`,
            'Stop and restart the simulation to replace the burned LED.',
          ],
        })
        break
      }
      case 'outI': {
        const c = comp(id)
        add({
          ...base, comps: [id], pins: [{ compId: id, pin }],
          wires: circuit.wires.filter((x) => sim.wires[x.id]?.current > 0.02 && nl.edges.some((e) => e.id === x.id && nl.netOf.get(e.a) === net(c, pin))).map((x) => x.id),
          why: 'The output is supplying more current than a logic chip can safely deliver. A real chip would overheat and its HIGH voltage would sag.',
          fix: ['Use a larger resistor in the path (330 Ω suits one LED).', 'Drive fewer LEDs from this pin, or give each LED its own gate output.'],
        })
        break
      }
      default:
        add({ ...base, why: '', fix: [], comps: w.compId ? [w.compId] : [] })
    }
  }

  // ── wiring mistakes that are not electrical faults but stop the circuit working ──
  for (const c of circuit.components) {
    const title = compTitle(c)
    if (c.type === 'supply' || c.type === 'battery') {
      const loose = ['+', '−'].filter((p) => alone(c, p) && nl.nets[net(c, p)].length < 2)
      if (loose.length && circuit.components.length > 1) add({
        key: `loose:${c.id}`, severity: 'warning', title: `${title}: ${list(loose)} terminal not connected`, comps: [c.id], pins: loose.map((pin) => ({ compId: c.id, pin })),
        why: 'Current needs a complete loop from + through the circuit and back to −. With a terminal open, nothing is powered.',
        fix: loose.map((p) => `Click the ${p} terminal, then click a hole in the ${p === '+' ? '+ (red)' : '− (blue)'} rail.`),
      })
    }
    if (c.type === 'led' || c.type === 'resistor') {
      const [a, b] = c.type === 'led' ? ['A', 'K'] : ['1', '2']
      const legs: Record<string, string> = { A: 'anode (+)', K: 'cathode (−)', '1': 'leg 1', '2': 'leg 2' }
      if (net(c, a) === net(c, b)) {
        const same = strip(c, a) === strip(c, b)
        add({
          key: `bypass:${c.id}`, severity: 'warning', title: `${title}: both legs are on the same connection`, comps: [c.id], wires: split(route(strip(c, a), new Set([strip(c, b)]))).wires,
          why: same ? 'Both legs sit in holes that the breadboard already joins together (the same 5-hole column or rail), so no voltage can appear across the part.' : 'The highlighted wiring bridges the two legs, so current goes around the part instead of through it.',
          fix: same ? ['Rotate it (R) or move it so each leg is in a different column.'] : ['Remove the wire that connects the two sides.'],
        })
        continue
      }
      const loose = [a, b].filter((p) => alone(c, p) && !vcc.has(net(c, p)) && !gnd.has(net(c, p)))
      if (loose.length) add({
        key: `leg:${c.id}`, severity: 'warning', title: `${title}: ${list(loose.map((p) => legs[p]))} not connected`, comps: [c.id], pins: loose.map((pin) => ({ compId: c.id, pin })),
        why: 'Nothing else touches this leg, so no current can flow through the part.',
        fix: [`Wire the ${list(loose.map((p) => legs[p]))} to the rest of the circuit. Any free hole in the same column works.`, ...(c.type === 'led' && loose.includes('K') ? ['The cathode usually goes to the − (blue) rail.'] : [])],
      })
      if (c.type === 'led' && !loose.length && burned[c.id] === undefined && (vcc.has(net(c, 'K')) || gnd.has(net(c, 'A')))) add({
        key: `rev:${c.id}`, severity: 'warning', title: `${title} is backwards`, comps: [c.id], pins: [{ compId: c.id, pin: 'A' }, { compId: c.id, pin: 'K' }],
        why: 'An LED only conducts from anode (+) to cathode (−). Here the cathode faces + or the anode faces −, so it blocks current and stays dark.',
        fix: ['Turn it around: select it and press R until the anode faces the positive side.', 'Or swap the wires on its two legs.'],
      })
    }
    if (c.type === 'ic' && sim.comps[c.id].powered) {
      const def = ICS[c.props.part!]
      def.gates.forEach((g, i) => {
        const used = [...g.inputs, g.output].some((p) => !alone(c, String(p)) || vcc.has(net(c, String(p))) || gnd.has(net(c, String(p))))
        if (!used) return
        // unknowns coming from another gate are that gate's problem
        const bad = g.inputs.filter((p) => sim.comps[c.id].pins[p].v === null && !outputsOn(net(c, String(p))).length)
        if (!bad.length) return
        const viaSwitch = bad.some((p) => (pinsOn.get(net(c, String(p))) ?? []).some((q) => q.c.type === 'button' || q.c.type === 'dip4'))
        add({
          key: `float:${c.id}:${i}`, severity: 'warning', title: `${title}: gate ${i + 1} input ${list(bad.map((p) => `pin ${p}`))} is floating`, comps: [c.id], pins: bad.map((p) => ({ compId: c.id, pin: String(p) })),
          why: viaSwitch
            ? 'While the switch is open nothing sets this input, so it is neither 0 nor 1 and the output cannot be trusted.'
            : 'Nothing drives this input to 0 or 1, so the gate output can be unknown.',
          fix: viaSwitch
            ? ['Add a 10 kΩ pull-down resistor from the input to − (reads 0 when open), with the switch connecting it to +.', 'Or use a toggle switch, which always connects to one side or the other.']
            : [`Connect ${list(bad.map((p) => `pin ${p}`))} to a switch, a logic input or another gate's output.`, 'If you do not need it, tie it to + or − so the gate still gives the result you want.'],
        })
      })
    }
  }
  const rank = (p: Problem) => (p.severity === 'error' ? 0 : 1)
  // a short takes the whole supply down; everything that follows from it would mislead
  const shorted = out.some((p) => p.key.startsWith('short:'))
  const shown = shorted ? out.filter((p) => !/^(power|rev|float|bypass):/.test(p.key)) : out
  return shown.sort((a, b) => rank(a) - rank(b))
}

/** board position of a problem, for markers and the camera */
export function problemCenter(p: Problem, circuit: Circuit): [number, number] | null {
  const c = circuit.components.find((q) => q.id === p.comps[0])
  if (!c) return null
  const s = TYPES[c.type].size(c.props)
  return c.rot % 2 ? [c.x - s.cz, c.z + s.cx] : [c.x + s.cx, c.z + s.cz]
}
