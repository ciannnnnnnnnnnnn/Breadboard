import { Html } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { HOLE_BY_ID, nearestHole } from '../../data/breadboard'
import { WIRE_COLORS, holeExists, pinsOf, stripOfEnd } from '../../data/components'
import type { Circuit, Wire } from '../../data/types'
import { fmtMA } from '../../simulation/simulate'
import { PROBLEM_COLOR, useProblemSeverity } from '../../store/problems'
import { useStore, wireColorName } from '../../store/useStore'
import { TERMINAL_Y } from './parts/Power'
import { boardPoint, drag } from './shared'

/** 3D position of a wire end */
export function endPos(end: string, circuit: Circuit): THREE.Vector3 | null {
  const h = HOLE_BY_ID.get(end)
  if (h) return new THREE.Vector3(h.x, 0, h.z)
  const m = /^@(.+)\.(.+)$/.exec(end)
  const c = m && circuit.components.find((q) => q.id === m[1])
  const p = c && pinsOf(c).find((q) => q.name === m[2])
  return p ? new THREE.Vector3(p.x, TERMINAL_Y, p.z) : null
}

export function wireCurve(a: THREE.Vector3, b: THREE.Vector3, bends: [number, number][]): THREE.CatmullRomCurve3 {
  const d = a.distanceTo(b)
  const top = Math.max(a.y, b.y) + Math.min(5.5, 1.3 + d * 0.13)
  const lift = (p: THREE.Vector3) => new THREE.Vector3(p.x, p.y + 0.9, p.z)
  const mids = bends.length
    ? bends.map(([x, z]) => new THREE.Vector3(x, Math.max(1.4, top * 0.6), z))
    : [a.clone().lerp(b, 0.3).setY(top * 0.97), a.clone().lerp(b, 0.7).setY(top * 0.97)]
  return new THREE.CatmullRomCurve3([a, lift(a), ...mids, lift(b), b], false, 'centripetal')
}

/** overlay shader: mode 1 = HIGH glow with moving pulses, 2 = floating grey dashes */
const overlayShader = {
  vertexShader: `varying float vU; void main(){ vU = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform float uTime, uLen, uMode, uSpeed, uDir, uGain; varying float vU;
    void main(){
      float s = vU * uLen;
      if (uMode > 1.5) {
        if (fract(s * 0.7) > 0.5) discard;
        float fl = 0.75 + 0.25 * sin(uTime * 9.0 + sin(uTime * 23.0) * 2.0);
        gl_FragColor = vec4(vec3(0.42, 0.43, 0.46) * fl, 1.0);
      } else {
        float p = fract(s * 0.3 - uDir * uTime * uSpeed);
        float pulse = smoothstep(0.0, 0.5, p) * (1.0 - smoothstep(0.5, 0.75, p));
        vec3 c = vec3(0.10, 1.0, 0.42);
        gl_FragColor = vec4(c * (0.55 + pulse * (0.9 + uGain * 1.8) + uGain * 0.25), 0.42 + 0.5 * pulse);
      }
    }`,
}

const noRay = () => null

function WireMesh({ wire }: { wire: Wire }) {
  const circuit = useStore((s) => s.circuit)
  const state = useStore((s) => s.sim?.wires[wire.id])
  const color = useStore((s) => WIRE_COLORS[wireColorName(wire, s.netlist, s.power)] ?? '#888')
  const selected = useStore((s) => s.selection?.kind === 'wire' && s.selection.id === wire.id)
  const hovered = useStore((s) => s.hover?.kind === 'wire' && s.hover.id === wire.id)
  const problem = useProblemSeverity('wires', wire.id)
  const body = useRef<THREE.MeshStandardMaterial>(null)
  const [override, setOverride] = useState<{ which: 'from' | 'to'; p: THREE.Vector3 } | null>(null)
  const A = endPos(wire.from, circuit), B = endPos(wire.to, circuit)
  const a = override?.which === 'from' ? override.p : A
  const b = override?.which === 'to' ? override.p : B
  const key = a && b ? `${a.toArray()}|${b.toArray()}|${wire.bends}` : ''

  const geo = useMemo(() => {
    if (!a || !b) return null
    const curve = wireCurve(a, b, wire.bends)
    const len = curve.getLength()
    const seg = Math.min(120, Math.max(32, Math.round(len * 3)))
    return { len, tube: new THREE.TubeGeometry(curve, seg, 0.17, 10), glow: new THREE.TubeGeometry(curve, seg, 0.185, 10) }
    // key captures everything the curve depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => () => { geo?.tube.dispose(); geo?.glow.dispose() }, [geo])

  const mat = useMemo(() => new THREE.ShaderMaterial({
    ...overlayShader, transparent: true, depthWrite: false, toneMapped: false,
    uniforms: { uTime: { value: 0 }, uLen: { value: 1 }, uMode: { value: 0 }, uSpeed: { value: 0.4 }, uDir: { value: 1 }, uGain: { value: 0 } },
  }), [])
  useEffect(() => () => mat.dispose(), [mat])
  const mode = state ? (state.level === 1 ? 1 : state.level === 'Z' ? 2 : 0) : 0
  // glow and flow speed follow the current (saturating around 20 mA)
  const gain = state ? Math.min(1, state.current / 0.02) : 0
  const phase = useRef(0)
  useFrame(({ clock }, dt) => {
    if (problem && body.current) body.current.emissiveIntensity = 1 + 0.7 * Math.sin(clock.elapsedTime * 6)
    if (!mode || problem) return
    phase.current += dt * (0.35 + gain * 1.6)
    const u = mat.uniforms
    u.uTime.value = mode === 1 ? phase.current : u.uTime.value + dt
    u.uSpeed.value = 1
    u.uLen.value = geo?.len ?? 1
    u.uMode.value = mode
    u.uDir.value = state!.dir
    u.uGain.value = gain
  })
  if (!geo || !a || !b) return null

  const base = new THREE.Color(color)
  if (state?.level === 0) base.multiplyScalar(0.4)
  else if (state?.level === 'Z' && !problem) base.lerp(new THREE.Color('#55585e'), 0.6)
  const handlers = {
    onClick: (e: ThreeEvent<MouseEvent>) => {
      const s = useStore.getState()
      if (s.placing || s.wireStart || e.delta > 5) return
      e.stopPropagation()
      s.select({ kind: 'wire', id: wire.id })
    },
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      if (useStore.getState().placing || useStore.getState().wireStart) return
      e.stopPropagation()
      useStore.getState().setHover({ kind: 'wire', id: wire.id })
    },
    onPointerOut: () => useStore.getState().setHover(null),
  }
  return (
    <group>
      <mesh geometry={geo.tube} castShadow {...handlers}>
        <meshStandardMaterial ref={body} color={problem ? PROBLEM_COLOR[problem] : base} roughness={0.5} emissive={problem ? PROBLEM_COLOR[problem] : selected || hovered ? '#1b6fff' : '#000'} emissiveIntensity={selected ? 0.8 : 0.3} />
      </mesh>
      {mode > 0 && !problem && <mesh geometry={geo.glow} material={mat} raycast={noRay} />}
      {[a, b].map((p, i) => (
        <group key={i} position={p}>
          <mesh position={[0, 0.25, 0]} raycast={noRay}>
            <cylinderGeometry args={[0.1, 0.07, 0.6, 8]} />
            <meshStandardMaterial color="#d5d8de" metalness={0.9} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.62, 0]} raycast={noRay}>
            <cylinderGeometry args={[0.22, 0.22, 0.55, 10]} />
            <meshStandardMaterial color="#17181b" roughness={0.6} />
          </mesh>
        </group>
      ))}
      {selected && <EndHandles wire={wire} a={A!} b={B!} setOverride={setOverride} />}
    </group>
  )
}

/** draggable end points of the selected wire */
function EndHandles({ wire, a, b, setOverride }: { wire: Wire; a: THREE.Vector3; b: THREE.Vector3; setOverride: (o: { which: 'from' | 'to'; p: THREE.Vector3 } | null) => void }) {
  const { camera, gl } = useThree()
  const running = useStore((s) => s.running)
  if (running) return null
  const begin = (which: 'from' | 'to') => (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    drag.active = true
    let target: string | null = null
    const move = (ev: PointerEvent) => {
      const p = boardPoint(ev, camera, gl.domElement)
      if (!p) return
      const near = nearestHole(p[0], p[1])
      const h = near && holeExists(near.id, useStore.getState().circuit) ? near : undefined
      target = h?.id ?? null
      setOverride({ which, p: h ? new THREE.Vector3(h.x, 0, h.z) : new THREE.Vector3(p[0], 0.4, p[1]) })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setTimeout(() => { drag.active = false }, 0)
      setOverride(null)
      if (target) useStore.getState().moveWireEnd(wire.id, which, target)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <>
      {([['from', a], ['to', b]] as const).map(([w, p]) => (
        <mesh key={w} position={[p.x, p.y + 1.1, p.z]} onPointerDown={begin(w)} onClick={(e) => e.stopPropagation()}>
          <sphereGeometry args={[0.36, 16, 12]} />
          <meshBasicMaterial color="#4aa3ff" />
        </mesh>
      ))}
    </>
  )
}

/** current labels on wires that feed or drain a resistor */
function WireCurrents() {
  const { circuit, sim, settings, netlist } = useStore()
  const list = useMemo(() => {
    if (!sim || !settings.labels) return []
    const strips = new Set<string>()
    for (const c of circuit.components) if (c.type === 'resistor') for (const p of Object.values(netlist.pins.get(c.id) ?? {})) strips.add(p.strip)
    return circuit.wires.flatMap((w) => {
      const st = sim.wires[w.id]
      if (!st || st.current < 1e-6 || (!strips.has(stripOfEnd(w.from)) && !strips.has(stripOfEnd(w.to)))) return []
      const a = endPos(w.from, circuit), b = endPos(w.to, circuit)
      return a && b ? [{ id: w.id, p: wireCurve(a, b, w.bends).getPoint(0.5), i: st.current }] : []
    })
  }, [circuit, sim, settings.labels, netlist])
  return list.map((l) => (
    <Html key={l.id} position={l.p} center zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
      <div data-testid="wire-current" className="rounded bg-slate-950/85 px-1 font-mono text-[10px] whitespace-nowrap text-emerald-300">{fmtMA(l.i)}</div>
    </Html>
  ))
}

/** rubber-band wire while drawing */
function WirePreview() {
  const { circuit, wireStart, hover } = useStore()
  const { camera, gl } = useThree()
  const [p, setP] = useState<[number, number] | null>(null)
  const active = !!wireStart
  useEffect(() => {
    if (!active) { setP(null); return }
    const move = (e: PointerEvent) => setP(boardPoint(e, camera, gl.domElement))
    window.addEventListener('pointermove', move)
    return () => window.removeEventListener('pointermove', move)
  }, [active, camera, gl])
  const a = wireStart && endPos(wireStart.from, circuit)
  const b = hover?.kind === 'hole' ? endPos(hover.hole, circuit) : p ? new THREE.Vector3(p[0], 0.3, p[1]) : null
  const key = a && b ? `${a.toArray()}|${b.toArray()}|${wireStart!.bends}` : ''
  const geo = useMemo(
    () => (a && b && a.distanceTo(b) > 0.3 ? new THREE.TubeGeometry(wireCurve(a, b, wireStart!.bends), 48, 0.15, 8) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  useEffect(() => () => geo?.dispose(), [geo])
  return geo && <mesh geometry={geo} raycast={noRay}><meshBasicMaterial color="#4aa3ff" transparent opacity={0.7} /></mesh>
}

export function Wires() {
  const wires = useStore((s) => s.circuit.wires)
  return (
    <>
      {wires.map((w) => <WireMesh key={w.id} wire={w} />)}
      <WirePreview />
      <WireCurrents />
    </>
  )
}
