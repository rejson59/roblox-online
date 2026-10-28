/**
 * query.ts — zapytania przestrzenne na drzewie instancji.
 *
 * Roblox trzyma części w strukturze spatialnej (octree). Dla kilkuset części
 * wystarczy liniowy przegląd AABB — i to robimy tutaj: promienie
 * (`workspace:Raycast`) oraz zapytania o części w obszarze.
 */
import { isAPart, type World, type Raw } from './world'

export interface PartBox {
  id: number
  min: [number, number, number]
  max: [number, number, number]
}

/** Axis-aligned bounding box części (obrót jest aproksymowany AABB). */
export function partBox(world: World, id: number): PartBox | null {
  const inst = world.get(id)
  if (!inst || !isAPart(inst.className)) return null
  if (inst.props.Transparency === 1) return null
  const cf = world.cframe(id)
  const size = world.size(id)
  const cx = cf[0], cy = cf[1], cz = cf[2]
  // ekstenty obróconej bryły: |R| * halfSize
  const hx = Math.abs(cf[3]) * size.x / 2 + Math.abs(cf[4]) * size.y / 2 + Math.abs(cf[5]) * size.z / 2
  const hy = Math.abs(cf[6]) * size.x / 2 + Math.abs(cf[7]) * size.y / 2 + Math.abs(cf[8]) * size.z / 2
  const hz = Math.abs(cf[9]) * size.x / 2 + Math.abs(cf[10]) * size.y / 2 + Math.abs(cf[11]) * size.z / 2
  return { id, min: [cx - hx, cy - hy, cz - hz], max: [cx + hx, cy + hy, cz + hz] }
}

export function collectPartBoxes(world: World, filter?: (id: number) => boolean): PartBox[] {
  const out: PartBox[] = []
  for (const inst of world.instances.values()) {
    if (!isAPart(inst.className)) continue
    if (filter && !filter(inst.id)) continue
    const b = partBox(world, inst.id)
    if (b) out.push(b)
  }
  return out
}

/**
 * Przecięcie promienia z AABB (slab method). Zwraca dystans wzdłuż promienia.
 * `dir` musi być znormalizowany.
 */
export function rayAABB(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  box: PartBox,
): { t: number; normal: [number, number, number] } | null {
  let tmin = -Infinity
  let tmax = Infinity
  let normal: [number, number, number] = [0, 0, 0]
  const o = [ox, oy, oz]
  const d = [dx, dy, dz]
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < box.min[i] || o[i] > box.max[i]) return null
    } else {
      let t1 = (box.min[i] - o[i]) / d[i]
      let t2 = (box.max[i] - o[i]) / d[i]
      let sign = -1
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1 }
      if (t1 > tmin) { tmin = t1; normal = [0, 0, 0]; normal[i] = sign }
      tmax = Math.min(tmax, t2)
      if (tmin > tmax) return null
    }
  }
  if (tmax < 0) return null
  return { t: tmin >= 0 ? tmin : 0, normal }
}

/** Odpowiednik `workspace:Raycast`. Zwraca [id, x, y, z, nx, ny, nz, distance] */
export function raycastWorld(
  world: World,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  ignore: number[] = [],
): Raw[] | null {
  const len = Math.hypot(dx, dy, dz)
  if (len < 1e-9) return null
  const ux = dx / len, uy = dy / len, uz = dz / len
  const ignoreSet = new Set(ignore)
  let best: { id: number; t: number; normal: [number, number, number] } | null = null
  for (const inst of world.instances.values()) {
    if (!isAPart(inst.className)) continue
    if (ignoreSet.has(inst.id)) continue
    if (inst.props.CanQuery === false) continue
    const box = partBox(world, inst.id)
    if (!box) continue
    const hit = rayAABB(ox, oy, oz, ux, uy, uz, box)
    if (hit && (!best || hit.t < best.t)) best = { id: inst.id, t: hit.t, normal: hit.normal }
  }
  if (!best) return null
  return [best.id, ox + ux * best.t, oy + uy * best.t, oz + uz * best.t, best.normal[0], best.normal[1], best.normal[2], best.t]
}

/** Odpowiednik `workspace:GetPartBoundsInBox` (zwraca id instancji). */
export function aabbQueryWorld(world: World, x: number, y: number, z: number, sx: number, sy: number, sz: number): number[] {
  const out: number[] = []
  const min = [x - sx / 2, y - sy / 2, z - sz / 2]
  const max = [x + sx / 2, y + sy / 2, z + sz / 2]
  for (const inst of world.instances.values()) {
    if (!isAPart(inst.className)) continue
    const b = partBox(world, inst.id)
    if (!b) continue
    if (b.min[0] <= max[0] && b.max[0] >= min[0] &&
        b.min[1] <= max[1] && b.max[1] >= min[1] &&
        b.min[2] <= max[2] && b.max[2] >= min[2]) out.push(inst.id)
  }
  return out
}
