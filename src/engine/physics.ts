/**
 * physics.ts — uproszczona fizyka w stylu Robloxa.
 *
 * Prawdziwy Roblox używa własnego solvera (PGS) na bryłach OBB. Tutaj:
 *  • kolizje liczone są na osiowo wyrównanych AABB (obrót części jest
 *    aproksymowany), co dla typowych gier (obby, platformy) wystarcza,
 *  • grawitacja to 196.2 studa/s² — dokładnie jak w Robloxie,
 *  • części zakotwiczone (Anchored) stoją w miejscu, reszta spada,
 *  • wykrywanie styku (`Touched`) opiera się na parach AABB.
 */
import { collectPartBoxes, type PartBox } from './query'
import { isAPart, type World } from './world'

export const GRAVITY = 196.2

export interface Body {
  id: number
  pos: [number, number, number]
  vel: [number, number, number]
  size: [number, number, number]
  grounded: boolean
}

export interface MoveResult {
  pos: [number, number, number]
  grounded: boolean
  hitNormalY: number
}

const EPS = 1e-4

/** Przesuwa AABB o `delta` z rozwiązywaniem kolizji osiami. */
export function moveBox(
  pos: [number, number, number],
  size: [number, number, number],
  delta: [number, number, number],
  boxes: PartBox[],
  ignoreIds: Set<number>,
): MoveResult {
  const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2
  const p: [number, number, number] = [pos[0], pos[1], pos[2]]
  let grounded = false
  let hitNormalY = 0

  const overlaps = (x: number, y: number, z: number, b: PartBox) =>
    x + hx > b.min[0] + EPS && x - hx < b.max[0] - EPS &&
    y + hy > b.min[1] + EPS && y - hy < b.max[1] - EPS &&
    z + hz > b.min[2] + EPS && z - hz < b.max[2] - EPS

  // osie X i Z (ruch poziomy), potem Y
  for (const axis of [0, 2] as const) {
    if (delta[axis] === 0) continue
    const before = p[axis]
    p[axis] += delta[axis]
    for (const b of boxes) {
      if (ignoreIds.has(b.id)) continue
      if (!overlaps(p[0], p[1], p[2], b)) continue
      // próba wejścia na niską przeszkodę (Robloxowe wchodzenie po schodach)
      const stepHeight = b.max[1] - (p[1] - hy)
      if (stepHeight > 0 && stepHeight <= 1.25) {
        const lifted = p[1] + stepHeight + EPS
        if (!boxes.some((o) => !ignoreIds.has(o.id) && overlaps(p[0], lifted, p[2], o))) {
          p[1] = lifted
          const res = moveBox(p, size, [0, 0, 0], boxes, ignoreIds)
          if (res.grounded) grounded = true
          continue
        }
      }
      // cofnięcie do styku
      if (delta[axis] > 0) p[axis] = b.min[axis] - hx - EPS
      else p[axis] = b.max[axis] + hx + EPS
      if (Math.abs(p[axis] - before) < Math.abs(delta[axis]) * 0.01) p[axis] = before
    }
  }

  if (delta[1] !== 0) {
    p[1] += delta[1]
    for (const b of boxes) {
      if (ignoreIds.has(b.id)) continue
      if (!overlaps(p[0], p[1], p[2], b)) continue
      if (delta[1] < 0) {
        p[1] = b.max[1] + hy + EPS
        grounded = true
        hitNormalY = 1
      } else {
        p[1] = b.min[1] - hy - EPS
        hitNormalY = -1
      }
    }
  }
  // sprawdzenie "stania" tuż nad podłogą
  if (!grounded && delta[1] <= 0) {
    for (const b of boxes) {
      if (ignoreIds.has(b.id)) continue
      if (p[0] + hx > b.min[0] + EPS && p[0] - hx < b.max[0] - EPS &&
          p[2] + hz > b.min[2] + EPS && p[2] - hz < b.max[2] - EPS &&
          Math.abs(b.max[1] - (p[1] - hy)) < 0.12) {
        grounded = true
        break
      }
    }
  }
  return { pos: p, grounded, hitNormalY }
}

export interface TouchPair { a: number; b: number }

/** Fizyka świata: ciała swobodne + wykrywanie styku części. */
export class Physics {
  private bodies = new Map<number, Body>()
  private touching = new Set<string>()

  constructor(public world: World) {}

  /** Rejestruje nowe ciało (część niezakotwiczona). */
  bodyFor(id: number): Body | null {
    const inst = this.world.get(id)
    if (!inst || !isAPart(inst.className)) return null
    let body = this.bodies.get(id)
    if (!body) {
      const p = this.world.position(id)
      const s = this.world.size(id)
      body = { id, pos: [p.x, p.y, p.z], vel: [0, 0, 0], size: [s.x, s.y, s.z], grounded: false }
      this.bodies.set(id, body)
    }
    return body
  }

  removeBody(id: number) {
    this.bodies.delete(id)
  }

  /** Krok fizyki dla swobodnych części (nie postaci). */
  step(dt: number, onTouch: (a: number, b: number) => void, onTouchEnd: (a: number, b: number) => void) {
    const anchored = collectPartBoxes(this.world, (id) => this.world.isAnchored(id) && this.world.collides(id))
    const all = collectPartBoxes(this.world)
    const pairs: TouchPair[] = []

    // 1. ruch ciał swobodnych
    for (const inst of this.world.instances.values()) {
      if (!isAPart(inst.className)) continue
      if (this.world.isAnchored(inst.id)) { this.bodies.delete(inst.id); continue }
      if (inst.props.CanCollide === false) continue
      const body = this.bodyFor(inst.id)
      if (!body) continue
      body.vel[1] -= GRAVITY * dt
      // tłumienie
      body.vel[0] *= 0.995; body.vel[2] *= 0.995
      const delta: [number, number, number] = [body.vel[0] * dt, body.vel[1] * dt, body.vel[2] * dt]
      const res = moveBox(body.pos, body.size, delta, anchored, new Set([inst.id]))
      body.pos = res.pos
      if (res.grounded) { body.vel[1] = 0; body.grounded = true } else body.grounded = false
      if (res.hitNormalY === -1) body.vel[1] = 0
      const cf = this.world.cframe(inst.id)
      this.world.setProp(inst.id, 'CFrame', [body.pos[0], body.pos[1], body.pos[2], cf[3], cf[4], cf[5], cf[6], cf[7], cf[8], cf[9], cf[10], cf[11]])
    }

    // 2. pary styków (części ruchome + sensory)
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], b = all[j]
        if (a.min[0] > b.max[0] || a.max[0] < b.min[0]) continue
        if (a.min[1] > b.max[1] || a.max[1] < b.min[1]) continue
        if (a.min[2] > b.max[2] || a.max[2] < b.min[2]) continue
        if (this.world.isAnchored(a.id) && this.world.isAnchored(b.id)) continue
        pairs.push({ a: a.id, b: b.id })
      }
    }
    const seen = new Set<string>()
    for (const p of pairs) {
      const key = `${p.a}:${p.b}`
      seen.add(key)
      if (!this.touching.has(key)) {
        this.touching.add(key)
        onTouch(p.a, p.b)
      }
    }
    for (const key of [...this.touching]) {
      if (!seen.has(key)) {
        this.touching.delete(key)
        const [a, b] = key.split(':').map(Number)
        onTouchEnd(a, b)
      }
    }
  }
}
