import { create } from 'zustand'
import { HOLE_BY_ID, MAX_BOARDS } from '../data/breadboard'
import { LED_COLORS, TYPES, holeExists, occupiedHoles, placementError, snapPosition, rotate, type PaletteItem } from '../data/components'
import { EXAMPLES } from '../data/examples'
import { ICS } from '../data/ics'
import type { Circuit, Comp, CompProps, CompType, Level, Wire } from '../data/types'
import { buildNetlist, powerNets, type Netlist } from '../simulation/netlist'
import { simulateWithBurn, type SimResult } from '../simulation/simulate'

export interface Settings { internals: boolean; labels: boolean; badges: boolean; tidy: boolean }
export type Selection = { kind: 'comp' | 'wire'; id: string } | null
export type Hover =
  | { kind: 'hole'; hole: string }
  | { kind: 'pin'; compId: string; pin: string }
  | { kind: 'comp'; compId: string }
  | { kind: 'wire'; id: string }
  | null
interface Placing { type: CompType; props: CompProps; rot: number }
interface WireStart { from: string; bends: [number, number][] }

interface State {
  circuit: Circuit
  /** topology of the current circuit, available even while stopped */
  netlist: Netlist
  power: { vcc: Set<number>; gnd: Set<number> }
  past: Circuit[]
  future: Circuit[]
  name: string
  running: boolean
  sim: SimResult | null
  burned: Record<string, number>
  settings: Settings
  topView: boolean
  viewNonce: number
  selection: Selection
  placing: Placing | null
  wireStart: WireStart | null
  wireColor: string
  hover: Hover
  toast: { msg: string; n: number } | null
  schematicOpen: boolean
  assistant: boolean
  /** show problems while stopped */
  checking: boolean
  activeProblem: string | null
  /** camera request */
  focus: { x: number; z: number; n: number } | null

  say: (msg: string) => void
  load: (c: Circuit, name: string) => void
  undo: () => void
  redo: () => void
  start: () => void
  stop: () => void
  setSetting: (k: keyof Settings, v: boolean) => void
  setView: (top: boolean) => void
  select: (s: Selection) => void
  setHover: (h: Hover) => void
  beginPlacing: (item: Pick<PaletteItem, 'type' | 'props'>) => void
  cancel: () => void
  placeAt: (x: number, z: number) => boolean
  moveComp: (id: string, x: number, z: number) => boolean
  rotateSelected: () => void
  deleteSelected: () => void
  updateProps: (id: string, p: CompProps, history?: boolean) => void
  toggleInput: (id: string, index?: number, value?: boolean) => void
  clickEnd: (end: string) => void
  addBend: (x: number, z: number) => void
  moveWireEnd: (id: string, which: 'from' | 'to', end: string) => boolean
  updateWire: (id: string, p: Partial<Wire>) => void
  setWireColor: (c: string) => void
  setSchematicOpen: (v: boolean) => void
  setName: (n: string) => void
  setChecking: (v: boolean) => void
  setAssistant: (v: boolean) => void
  addBoard: () => void
  removeBoard: () => void
  setActiveProblem: (key: string | null, at: [number, number] | null) => void
}

const STORAGE_KEY = 'ic-breadboard-lab:project'
const SETTINGS_KEY = 'ic-breadboard-lab:settings'
const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 9)}`

const topology = (c: Circuit) => {
  const netlist = buildNetlist(c)
  return { netlist, power: powerNets(netlist) }
}

/** Validates untrusted project JSON. Throws with a readable reason. */
export function parseProject(text: string): { name: string; circuit: Circuit } {
  const j = JSON.parse(text)
  const c = j?.circuit
  if (!Array.isArray(c?.components) || !Array.isArray(c?.wires)) throw new Error('not a breadboard project file')
  const boards = Number.isInteger(c.boards) ? Math.min(MAX_BOARDS, Math.max(1, c.boards)) : undefined
  const circuit: Circuit = { components: [], wires: [], ...(boards && { boards }) }
  const ids = new Set<string>()
  const claim = (id: unknown) => {
    if (typeof id !== 'string' || ids.has(id)) throw new Error('invalid or duplicate part id')
    ids.add(id)
    return id
  }
  for (const x of c.components as Comp[]) {
    if (!Object.hasOwn(TYPES, x?.type)) throw new Error(`unknown part type "${x?.type}"`)
    if (!Number.isFinite(x.x) || !Number.isFinite(x.z)) throw new Error('a part has no position')
    const props = { ...TYPES[x.type].defaults, ...x.props }
    if (x.type === 'dip4' && !(Array.isArray(props.switches) && props.switches.length >= 1 && props.switches.length <= 12)) throw new Error('a DIP switch has an invalid number of positions')
    if (x.type === 'ic' && !Object.hasOwn(ICS, props.part!)) throw new Error(`unknown IC "${props.part}"`)
    if (x.type === 'led' && !Object.hasOwn(LED_COLORS, props.color!)) throw new Error(`unknown LED colour "${props.color}"`)
    const comp: Comp = { id: claim(x.id), type: x.type, x: x.x, z: x.z, rot: (Math.trunc(x.rot ?? 0) % 4 + 4) % 4, props }
    const err = placementError(comp, circuit)
    if (err) throw new Error(`${TYPES[x.type].name}: ${err}`)
    circuit.components.push(comp)
  }
  const terminals = new Set(circuit.components.flatMap((x) => (TYPES[x.type].offBoard ? TYPES[x.type].pins(x.props).map((p) => `@${x.id}.${p.name}`) : [])))
  for (const w of c.wires as Wire[]) {
    const occ = occupiedHoles(circuit)
    for (const e of [w?.from, w?.to]) {
      if (typeof e !== 'string' || (e[0] === '@' ? !terminals.has(e) : !holeExists(e, circuit))) throw new Error(`a wire ends at an unknown place "${e}"`)
      if (occ.has(e)) throw new Error(`hole ${e} is used twice`)
    }
    if (w.from === w.to) throw new Error(`a wire starts and ends at ${w.from}`)
    const bends = Array.isArray(w.bends) ? w.bends.filter((b) => Array.isArray(b) && Number.isFinite(b[0]) && Number.isFinite(b[1])) : []
    circuit.wires.push({ id: claim(w.id), from: w.from, to: w.to, color: String(w.color ?? 'auto'), bends })
  }
  return { name: typeof j.name === 'string' ? j.name : 'Untitled', circuit }
}
export const serialize = () => {
  const s = useStore.getState()
  return JSON.stringify({ format: 'ic-breadboard-lab', version: 1, name: s.name, circuit: s.circuit }, null, 2)
}
export function saveLocal() { localStorage.setItem(STORAGE_KEY, serialize()) }
export const readLocal = () => localStorage.getItem(STORAGE_KEY)

function initial(): { circuit: Circuit; name: string } {
  try {
    const t = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)
    if (t) return parseProject(t)
  } catch { /* corrupted autosave: fall back to the first example */ }
  return { circuit: EXAMPLES[0].build(), name: EXAMPLES[0].name }
}
function initialSettings(): Settings {
  const d = { internals: false, labels: true, badges: false, tidy: true }
  try { return { ...d, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') } } catch { return d }
}

const first = initial()

export const useStore = create<State>((set, get) => {
  /** recompute the simulation for a circuit; keeps latch state and burned LEDs */
  const resim = (circuit: Circuit, fresh = false) => {
    const s = get()
    const { result, burned } = simulateWithBurn(circuit, fresh ? {} : (s.sim?.gateOut ?? {}), fresh ? {} : s.burned)
    return { sim: result, burned }
  }
  /** change the circuit; `history` makes it undoable */
  const apply = (circuit: Circuit, history = true) => {
    const s = get()
    set({
      circuit,
      ...topology(circuit),
      ...(history ? { past: [...s.past.slice(-99), s.circuit], future: [] } : {}),
      ...(s.running ? resim(circuit) : {}),
    })
  }
  const mapComp = (id: string, f: (c: Comp) => Comp): Circuit => {
    const c = get().circuit
    return { ...c, components: c.components.map((x) => (x.id === id ? f(x) : x)) }
  }
  const locked = () => {
    if (get().running) { get().say('Stop the simulation to edit the circuit'); return true }
    return false
  }
  const travel = (from: 'past' | 'future') => {
    const s = get()
    if (locked() || !s[from].length) return
    const list = from === 'past' ? s.past : s.future
    const c = from === 'past' ? list[list.length - 1] : list[0]
    set({
      circuit: c, ...topology(c), selection: null, wireStart: null, placing: null,
      past: from === 'past' ? s.past.slice(0, -1) : [...s.past, s.circuit],
      future: from === 'past' ? [s.circuit, ...s.future] : s.future.slice(1),
    })
  }

  return {
    ...first,
    ...topology(first.circuit),
    past: [], future: [],
    running: false, sim: null, burned: {},
    settings: initialSettings(),
    topView: false, viewNonce: 0,
    selection: null, placing: null, wireStart: null, wireColor: 'auto', hover: null, toast: null,
    schematicOpen: true, assistant: false, checking: false, activeProblem: null, focus: null,

    say: (msg) => set((s) => ({ toast: { msg, n: (s.toast?.n ?? 0) + 1 } })),
    load: (circuit, name) => set((s) => ({
      circuit, name, ...topology(circuit), viewNonce: s.viewNonce + ((circuit.boards ?? 1) !== (s.circuit.boards ?? 1) ? 1 : 0), past: [...s.past, s.circuit], future: [], running: false, sim: null, burned: {},
      selection: null, placing: null, wireStart: null, hover: null, activeProblem: null,
    })),
    undo: () => travel('past'),
    redo: () => travel('future'),
    start: () => set((s) => ({ running: true, activeProblem: null, placing: null, wireStart: null, ...resim(s.circuit, true) })),
    stop: () => {
      // push buttons spring back
      const c = get().circuit
      const circuit = { ...c, components: c.components.map((x) => (x.type === 'button' && x.props.on ? { ...x, props: { ...x.props, on: false } } : x)) }
      set({ running: false, sim: null, burned: {}, circuit, ...topology(circuit) })
    },
    setSetting: (k, v) => set((s) => {
      const settings = { ...s.settings, [k]: v }
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* private mode */ }
      if (k !== 'internals') return { settings }
      // the global switch resets per-chip overrides
      const components = s.circuit.components.map((c) => (c.props.internals === undefined ? c : { ...c, props: { ...c.props, internals: undefined } }))
      return { settings, circuit: { ...s.circuit, components } }
    }),
    setView: (topView) => set((s) => ({ topView, viewNonce: s.viewNonce + 1 })),
    select: (selection) => set({ selection }),
    setHover: (hover) => set((s) => (JSON.stringify(s.hover) === JSON.stringify(hover) ? s : { hover })),
    beginPlacing: (item) => {
      if (locked()) return
      set({ placing: { type: item.type, props: { ...item.props }, rot: 0 }, wireStart: null, selection: null })
    },
    cancel: () => set({ placing: null, wireStart: null, selection: null }),

    placeAt: (x, z) => {
      const p = get().placing
      if (!p || locked()) return false
      const comp: Comp = { id: uid(p.type), type: p.type, x, z, rot: p.rot, props: { ...p.props } }
      Object.assign(comp, snapPosition(comp, x, z))
      const c = get().circuit
      const err = placementError(comp, c)
      if (err) { get().say(err); return false }
      apply({ ...c, components: [...c.components, comp] })
      set({ placing: null, selection: { kind: 'comp', id: comp.id } })
      return true
    },
    moveComp: (id, x, z) => {
      const c = get().circuit
      const comp = c.components.find((q) => q.id === id)
      if (!comp || locked()) return false
      const moved = { ...comp, ...snapPosition(comp, x, z) }
      if (moved.x === comp.x && moved.z === comp.z) return true
      const err = placementError(moved, c)
      if (err) { get().say(err); return false }
      apply(mapComp(id, () => moved))
      return true
    },
    rotateSelected: () => {
      const s = get()
      if (s.placing) {
        set({ placing: { ...s.placing, rot: (s.placing.rot + TYPES[s.placing.type].rotStep) % 4 } })
        return
      }
      if (s.selection?.kind !== 'comp' || locked()) return
      const comp = s.circuit.components.find((q) => q.id === s.selection!.id)!
      const step = TYPES[comp.type].rotStep
      let err: string | null = null
      // skip over orientations that do not fit here; also try pivoting about the other end
      for (let k = step; k < 4; k += step) {
        const rot = (comp.rot + k) % 4
        const span = comp.props.span ?? 0
        const [ox, oz] = rotate(span, 0, comp.rot), [nx, nz] = rotate(span, 0, rot)
        for (const [dx, dz] of [[0, 0], [ox - nx, oz - nz]]) {
          const r: Comp = { ...comp, rot, x: comp.x + dx, z: comp.z + dz }
          Object.assign(r, snapPosition(r, r.x, r.z))
          const e = placementError(r, s.circuit)
          if (!e) { apply(mapComp(comp.id, () => r)); return }
          err ??= e
        }
      }
      if (err) s.say(`Cannot rotate here: ${err}`)
    },
    deleteSelected: () => {
      const s = get()
      if (!s.selection || locked()) return
      const { kind, id } = s.selection
      const c = s.circuit
      apply(kind === 'wire'
        ? { ...c, wires: c.wires.filter((w) => w.id !== id) }
        : {
            ...c,
            components: c.components.filter((x) => x.id !== id),
            wires: c.wires.filter((w) => !w.from.startsWith(`@${id}.`) && !w.to.startsWith(`@${id}.`)),
          })
      set({ selection: null, hover: null })
    },
    updateProps: (id, p, history = true) => {
      const s = get()
      const comp = s.circuit.components.find((q) => q.id === id)
      if (!comp) return
      const next = { ...comp, props: { ...comp.props, ...p } }
      if (p.span !== undefined) {
        if (locked()) return
        const err = placementError(next, s.circuit)
        if (err) { s.say(err); return }
      }
      apply(mapComp(id, () => next), history)
    },
    toggleInput: (id, index, value) => {
      const comp = get().circuit.components.find((q) => q.id === id)
      if (!comp) return
      const props = comp.type === 'dip4'
        ? { switches: (comp.props.switches ?? []).map((v, i) => (i === (index ?? 0) ? (value ?? !v) : v)) }
        : { on: value ?? !comp.props.on }
      apply(mapComp(id, (c) => ({ ...c, props: { ...c.props, ...props } })), false)
    },

    clickEnd: (end) => {
      const s = get()
      if (locked()) return
      if (end[0] !== '@' && !holeExists(end, s.circuit)) return
      const user = end[0] === '@' ? undefined : occupiedHoles(s.circuit).get(end)
      if (user) { s.say(`Hole ${end} is already in use. Pick a free hole in the same column`); return }
      if (!s.wireStart) { set({ wireStart: { from: end, bends: [] }, selection: null }); return }
      if (s.wireStart.from === end) { set({ wireStart: null }); return }
      const w: Wire = { id: uid('w'), from: s.wireStart.from, to: end, color: s.wireColor, bends: s.wireStart.bends }
      apply({ ...s.circuit, wires: [...s.circuit.wires, w] })
      set({ wireStart: null, selection: { kind: 'wire', id: w.id } })
    },
    addBend: (x, z) => set((s) => (s.wireStart ? { wireStart: { ...s.wireStart, bends: [...s.wireStart.bends, [x, z]] } } : s)),
    moveWireEnd: (id, which, end) => {
      const s = get()
      const w = s.circuit.wires.find((q) => q.id === id)
      if (!w || locked() || w[which] === end) return false
      if (end[0] !== '@' && !holeExists(end, s.circuit)) return false
      if (w[which === 'from' ? 'to' : 'from'] === end || (end[0] !== '@' && occupiedHoles(s.circuit, id).has(end))) {
        s.say(`Hole ${end} is already in use`)
        return false
      }
      apply({ ...s.circuit, wires: s.circuit.wires.map((q) => (q.id === id ? { ...q, [which]: end } : q)) })
      return true
    },
    updateWire: (id, p) => {
      const c = get().circuit
      apply({ ...c, wires: c.wires.map((w) => (w.id === id ? { ...w, ...p } : w)) })
    },
    setWireColor: (wireColor) => set({ wireColor }),
    setSchematicOpen: (schematicOpen) => set({ schematicOpen }),
    setName: (name) => set({ name }),
    addBoard: () => {
      const s = get()
      const boards = (s.circuit.boards ?? 1) + 1
      if (locked()) return
      if (boards > MAX_BOARDS) { s.say(`Up to ${MAX_BOARDS} boards fit in the workspace`); return }
      const next = { ...s.circuit, boards }
      if (next.components.some((x) => TYPES[x.type].offBoard && placementError(x, next))) { s.say('Move the parts below the board out of the way first'); return }
      apply(next)
      set((q) => ({ viewNonce: q.viewNonce + 1 }))
    },
    removeBoard: () => {
      const s = get()
      const last = (s.circuit.boards ?? 1) - 1
      if (locked() || last < 1) return
      if ([...occupiedHoles(s.circuit).keys()].some((h) => HOLE_BY_ID.get(h)!.board === last)) { s.say(`Board ${last + 1} still has parts or wires on it`); return }
      apply({ ...s.circuit, boards: last })
      set((q) => ({ viewNonce: q.viewNonce + 1 }))
    },
    setAssistant: (assistant) => set({ assistant }),
    setChecking: (checking) => set({ checking, activeProblem: null }),
    setActiveProblem: (activeProblem, at) => set((s) => ({ activeProblem, focus: at ? { x: at[0], z: at[1], n: (s.focus?.n ?? 0) + 1 } : s.focus })),
  }
})

// autosave
let timer: ReturnType<typeof setTimeout> | undefined
useStore.subscribe((s, p) => {
  if (s.circuit === p.circuit && s.name === p.name) return
  clearTimeout(timer)
  timer = setTimeout(() => { try { saveLocal() } catch { /* storage full or blocked */ } }, 400)
})

/** resolved wire colour name ("auto" → by what the net is) */
export function wireColorName(w: Wire, netlist: Netlist, power: State['power']): string {
  if (w.color !== 'auto') return w.color
  const n = netlist.netOf.get(w.from[0] === '@' ? w.from : HOLE_BY_ID.get(w.from)!.strip)!
  if (power.vcc.has(n)) return 'red'
  if (power.gnd.has(n)) return 'black'
  return ['blue', 'yellow', 'green', 'orange', 'white'][n % 5]
}
export const useLevel = (compId: string, pin: string): Level | null =>
  useStore((s) => s.sim?.comps[compId]?.pins[pin]?.level ?? null)

// handle for scripted checks; stripped from production builds
if (import.meta.env?.DEV && typeof window !== 'undefined') Object.assign(window, { __store: useStore })
