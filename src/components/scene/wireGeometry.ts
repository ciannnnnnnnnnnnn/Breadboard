/** 3D shape of a tidy wire: flat right-angled runs on two heights with rounded corners. */
import * as THREE from 'three'

export const TIDY_R = 0.085
const Y_H = 0.28 // left-right runs
const Y_V = 0.52 // front-back runs pass above them

export function tidyPath(points: [number, number][], ya: number, yb: number): THREE.Vector3[] {
  // drop zero-length pieces, then lift each run to its own height
  const p = points.filter((q, i) => !i || Math.hypot(q[0] - points[i - 1][0], q[1] - points[i - 1][1]) > 1e-6)
  const raw: THREE.Vector3[] = [new THREE.Vector3(p[0][0], ya, p[0][1])]
  for (let i = 0; i + 1 < p.length; i++) {
    const [a, b] = [p[i], p[i + 1]]
    const y = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? Y_H : Y_V
    raw.push(new THREE.Vector3(a[0], y, a[1]), new THREE.Vector3(b[0], y, b[1]))
  }
  const last = p[p.length - 1]
  raw.push(new THREE.Vector3(last[0], yb, last[1]))
  const pts = raw.filter((q, i) => !i || q.distanceTo(raw[i - 1]) > 1e-4)
  // round every corner
  const out: THREE.Vector3[] = [pts[0]]
  for (let i = 1; i + 1 < pts.length; i++) {
    const c = pts[i]
    const r = Math.min(0.12, c.distanceTo(pts[i - 1]) / 2.01, c.distanceTo(pts[i + 1]) / 2.01)
    const a = c.clone().add(pts[i - 1].clone().sub(c).setLength(r)), b = c.clone().add(pts[i + 1].clone().sub(c).setLength(r))
    for (let k = 0; k <= 3; k++) {
      const t = k / 3, u = 1 - t
      out.push(new THREE.Vector3().addScaledVector(a, u * u).addScaledVector(c, 2 * u * t).addScaledVector(b, t * t))
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

export const pathLength = (p: THREE.Vector3[]) => p.reduce((s, q, i) => (i ? s + q.distanceTo(p[i - 1]) : 0), 0)
export function pathPoint(p: THREE.Vector3[], t: number): THREE.Vector3 {
  let left = pathLength(p) * t
  for (let i = 1; i < p.length; i++) {
    const d = p[i].distanceTo(p[i - 1])
    if (left <= d) return p[i - 1].clone().lerp(p[i], d ? left / d : 0)
    left -= d
  }
  return p[p.length - 1].clone()
}

/** tube through the points with uv.x = distance along the wire (0..1); rings only where needed */
export function polyTube(p: THREE.Vector3[], r: number, sides = 8): THREE.BufferGeometry {
  const total = pathLength(p) || 1
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = []
  const tan = p.map((_, i) => p[Math.min(i + 1, p.length - 1)].clone().sub(p[Math.max(i - 1, 0)]).normalize())
  let n = new THREE.Vector3(1, 0, 0)
  if (Math.abs(tan[0].x) > 0.9) n = new THREE.Vector3(0, 1, 0)
  let s = 0
  p.forEach((q, i) => {
    if (i) s += q.distanceTo(p[i - 1])
    // carry the previous frame along so the tube does not twist
    n = n.clone().addScaledVector(tan[i], -n.dot(tan[i]))
    if (n.lengthSq() < 1e-6) n = new THREE.Vector3(tan[i].y, tan[i].z, tan[i].x).cross(tan[i])
    n.normalize()
    const b = tan[i].clone().cross(n)
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2
      const d = n.clone().multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a))
      pos.push(q.x + d.x * r, q.y + d.y * r, q.z + d.z * r)
      nor.push(d.x, d.y, d.z)
      uv.push(s / total, k / sides)
    }
    if (i) {
      const w = sides + 1
      for (let k = 0; k < sides; k++) {
        const A = (i - 1) * w + k, B = i * w + k
        idx.push(A, A + 1, B, B, A + 1, B + 1)
      }
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return g
}
