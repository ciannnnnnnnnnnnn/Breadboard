import { Text } from '@react-three/drei'
import type { ThreeEvent } from '@react-three/fiber'
import { useMemo, type ReactNode } from 'react'
import * as THREE from 'three'
import fontUrl from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff?url'
import type { Level } from '../../data/types'
import { useStore } from '../../store/useStore'

export const FONT = fontUrl
/** HDR (>1) so the bloom pass picks it up */
export const HIGH = new THREE.Color('#14ff5e').multiplyScalar(1.7)
export const HIGH_TEXT = '#5dffa0'
export const LOW = new THREE.Color('#33506b')
/** brighter LOW for thin lines on the dark chip face */
export const LOW_LINE = new THREE.Color('#5b8fc4')
export const FLOAT = new THREE.Color('#7b7f88')
export const levelColor = (l: Level | null): THREE.Color => (l === 1 ? HIGH : l === 0 ? LOW : FLOAT)

// Text colours must be strings: troika keeps a Color instance it is given, and R3F
// would then write later colour props into that shared object.
export function Label({ children, size = 0.3, color = '#fff', ...p }: { children: ReactNode; size?: number; color?: string } & Record<string, unknown>) {
  return (
    <Text font={FONT} fontSize={size} color={color} anchorX="center" anchorY="middle" depthOffset={-4} raycast={() => null} {...p}>
      {children}
    </Text>
  )
}

const UP = new THREE.Vector3(0, 1, 0)
/** straight cylinder between two points */
export function Rod({ a, b, r = 0.07, color = '#c3c7ce', metal = 0.9 }: { a: [number, number, number]; b: [number, number, number]; r?: number; color?: string; metal?: number }) {
  const { pos, quat, len } = useMemo(() => {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b)
    const d = B.clone().sub(A)
    return { pos: A.clone().add(B).multiplyScalar(0.5), len: d.length(), quat: new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()) }
  }, [a, b])
  return (
    <mesh position={pos} quaternion={quat} raycast={() => null}>
      <cylinderGeometry args={[r, r, len, 8]} />
      <meshStandardMaterial color={color} metalness={metal} roughness={0.35} />
    </mesh>
  )
}

/** Pin hit target: hover shows the tooltip, click on an off-board terminal starts a wire. */
export function pinHandlers(compId: string, pin: string, terminal?: string) {
  return {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => {
      if (useStore.getState().placing) return
      e.stopPropagation()
      useStore.getState().setHover({ kind: 'pin', compId, pin })
    },
    onPointerOut: () => useStore.getState().setHover(null),
    ...(terminal && {
      onPointerDown: (e: ThreeEvent<PointerEvent>) => { if (!useStore.getState().placing) e.stopPropagation() },
      onClick: (e: ThreeEvent<MouseEvent>) => {
        if (useStore.getState().placing || e.delta > 5) return
        e.stopPropagation()
        useStore.getState().clickEnd(terminal)
      },
    }),
  }
}

/** shared state for drags that must disable the orbit controls */
export const drag = { active: false, pointerDown: [0, 0] as [number, number] }

/** pointer → point on the board plane (y = 0) */
export function boardPoint(e: { clientX: number; clientY: number }, camera: THREE.Camera, el: HTMLElement, y = 0): [number, number] | null {
  const r = el.getBoundingClientRect()
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  const ray = new THREE.Raycaster()
  ray.setFromCamera(ndc, camera)
  const hit = ray.ray.intersectPlane(new THREE.Plane(UP, -y), new THREE.Vector3())
  return hit ? [hit.x, hit.z] : null
}
