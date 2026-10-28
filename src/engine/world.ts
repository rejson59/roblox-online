/**
 * world.ts — drzewo instancji (odpowiednik DataModel w Robloxie).
 *
 * W prawdziwym Robloxie `Instance` to obiekt w C++ (DataModel), a skrypty
 * (Luau) dostają do niego referencję. U nas instancje żyją w JS, a Luau widzi
 * je jako liczbowy `id` + metatabelę, która tłumaczy `part.Position` na wywołanie
 * mostka `host.getProp(id, "Position")`. Dzięki temu stan gry jest jeden,
 * współdzielony przez renderer, fizykę i skrypty.
 */

export type Raw = number | string | boolean | number[] | null

/** Referencja do instancji w argumentach zdarzeń (np. `Touched` dostaje część). */
export const ref = (id: number): string => '@' + id

export interface Instance {
  id: number
  className: string
  props: Record<string, Raw>
  parent: number | null
  children: number[]
  tags: Set<string>
  attributes: Record<string, Raw>
}

export interface Vec3 { x: number; y: number; z: number }

/** Klasy, które renderer/fizyka traktują jako bryły. */
export const PART_CLASSES = new Set([
  'Part', 'WedgePart', 'CornerWedgePart', 'TrussPart', 'MeshPart', 'SpawnLocation',
  'Seat', 'VehicleSeat', 'UnionOperation', 'NegateOperation', 'Terrain',
])

export const isAPart = (className: string) => PART_CLASSES.has(className)

/** Klucz zdarzenia w kolejce mostka, np. `i12:Touched`, `run:Heartbeat`. */
export type EventKey = string
export type EventArgs = any[]

export interface WorldEvents {
  /** Wywoływane, gdy struktura drzewa się zmienia (dla replikacji/renderera). */
  onStructureChange?: () => void
}

export class World {
  instances = new Map<number, Instance>()
  private nextId = 1
  /** instancje utworzone od ostatniego drenażu (replikacja) */
  createdSinceDrain: number[] = []
  /** pary [id, propKey, value] zmienione od ostatniego drenażu */
  propChanges: Array<[number, string, Raw]> = []
  destroyedSinceDrain: number[] = []

  /** kolejka zdarzeń do odebrania przez Luau w najbliższym ticku */
  eventQueue: Array<{ key: EventKey; args: EventArgs }> = []

  constructor(public events: WorldEvents = {}) {}

  // ── podstawowe operacje ────────────────────────────────────────────────
  create(className: string, props: Record<string, Raw> = {}, parent: number | null = null): Instance {
    const id = this.nextId++
    const inst: Instance = { id, className, props: {}, parent: null, children: [], tags: new Set(), attributes: {} }
    for (const [k, v] of Object.entries(props)) inst.props[k] = v
    if (inst.props.Name === undefined) inst.props.Name = className
    this.instances.set(id, inst)
    this.createdSinceDrain.push(id)
    if (parent !== null) this.setParent(id, parent)
    this.events.onStructureChange?.()
    return inst
  }

  /** Tworzy instancję z konkretnym id — używane przez replikację, by klient
   *  widział te same identyfikatory co serwer. */
  createWithId(id: number, className: string, props: Record<string, Raw> = {}, parent: number | null = null): Instance {
    const existing = this.instances.get(id)
    if (existing) return existing
    const inst: Instance = { id, className, props: {}, parent: null, children: [], tags: new Set(), attributes: {} }
    for (const [k, v] of Object.entries(props)) inst.props[k] = v
    if (inst.props.Name === undefined) inst.props.Name = className
    this.instances.set(id, inst)
    if (id >= this.nextId) this.nextId = id + 1
    if (parent !== null) this.setParent(id, parent)
    return inst
  }

  get(id: number | null | undefined): Instance | undefined {
    return id === null || id === undefined ? undefined : this.instances.get(id)
  }

  destroy(id: number): void {
    const inst = this.instances.get(id)
    if (!inst) return
    for (const child of [...inst.children]) this.destroy(child)
    if (inst.parent !== null) {
      const p = this.instances.get(inst.parent)
      if (p) p.children = p.children.filter((c) => c !== id)
      this.queueEvent(`i${inst.parent}:ChildRemoved`, [ref(id)])
    }
    this.instances.delete(id)
    this.destroyedSinceDrain.push(id)
    this.events.onStructureChange?.()
  }

  setParent(id: number, parentId: number | null): boolean {
    const inst = this.instances.get(id)
    if (!inst) return false
    if (parentId === id) return false
    // nie można być rodzicem samego siebie (cykl)
    if (parentId !== null) {
      let p = this.instances.get(parentId)
      while (p) {
        if (p.id === id) return false
        p = p.parent !== null ? this.instances.get(p.parent) : undefined
      }
    }
    const old = inst.parent
    if (old === parentId) return true
    if (old !== null) {
      const o = this.instances.get(old)
      if (o) o.children = o.children.filter((c) => c !== id)
      this.queueEvent(`i${old}:ChildRemoved`, [ref(id)])
      this.queueEvent(`i${old}:DescendantRemoving`, [ref(id)])
    }
    inst.parent = parentId
    if (parentId !== null) {
      const p = this.instances.get(parentId)
      if (!p) { inst.parent = null; return false }
      p.children.push(id)
      this.queueEvent(`i${parentId}:ChildAdded`, [ref(id)])
      this.queueEvent(`i${parentId}:DescendantAdded`, [ref(id)])
    }
    this.events.onStructureChange?.()
    return true
  }

  /** Głęboka kopia poddrzewa (odpowiednik `:Clone()`), bez tworzenia instancji-sierot. */
  clone(id: number, newParent: number | null = null): number | null {
    const src = this.instances.get(id)
    if (!src) return null
    const copy = this.create(src.className, {}, null)
    copy.props = JSON.parse(JSON.stringify(src.props))
    copy.tags = new Set(src.tags)
    copy.attributes = JSON.parse(JSON.stringify(src.attributes))
    for (const c of src.children) this.clone(c, copy.id)
    if (newParent !== null) this.setParent(copy.id, newParent)
    return copy.id
  }

  // ── właściwości ────────────────────────────────────────────────────────
  getProp(id: number, key: string): Raw {
    const inst = this.instances.get(id)
    if (!inst) return null
    if (key === 'Name') return (inst.props.Name as string) ?? inst.className
    if (key === 'ClassName') return inst.className
    if (key === 'Parent') return inst.parent
    const v = inst.props[key]
    return v === undefined ? null : v
  }

  /**
   * @param fromScript true, gdy zmianę wykonuje Luau — wtedy sygnały `Changed`
   *   są emitowane synchronicznie po stronie Luau i nie trzeba ich kolejkować.
   */
  setProp(id: number, key: string, value: Raw, fromScript = false): boolean {
    const inst = this.instances.get(id)
    if (!inst) return false
    if (key === 'Parent') return this.setParent(id, typeof value === 'number' ? value : null)
    if (key === 'ClassName') return false
    if (key === 'Name') {
      inst.props.Name = String(value)
      if (!fromScript) this.queueEvent(`i${id}:Changed`, ['Name'])
      return true
    }
    const old = inst.props[key] ?? null
    if (old === value) return true
    inst.props[key] = value
    this.propChanges.push([id, key, value])
    if (!fromScript) this.queueEvent(`i${id}:Changed`, [key])
    return true
  }

  // ── wyszukiwanie ───────────────────────────────────────────────────────
  findChild(id: number, name: string, recursive = false): number | null {
    const inst = this.instances.get(id)
    if (!inst) return null
    for (const c of inst.children) {
      const ci = this.instances.get(c)
      if (ci && (ci.props.Name === name || ci.className === name)) return c
    }
    if (recursive) {
      for (const c of inst.children) {
        const r = this.findChild(c, name, true)
        if (r !== null) return r
      }
    }
    return null
  }

  findFirstChildOfClass(id: number, className: string, recursive = false): number | null {
    const inst = this.instances.get(id)
    if (!inst) return null
    for (const c of inst.children) {
      const ci = this.instances.get(c)
      if (ci && ci.className === className) return c
    }
    if (recursive) {
      for (const c of inst.children) {
        const r = this.findFirstChildOfClass(c, className, true)
        if (r !== null) return r
      }
    }
    return null
  }

  getChildren(id: number): number[] {
    return this.instances.get(id)?.children.slice() ?? []
  }

  /** Pełna ścieżka instancji, np. `Workspace.Obby.Coin1` (dla UI i błędów). */
  fullName(id: number): string {
    const parts: string[] = []
    let cur = this.instances.get(id)
    while (cur && cur.id !== 0) {
      parts.unshift(String(cur.props.Name ?? cur.className))
      cur = cur.parent !== null ? this.instances.get(cur.parent) : undefined
    }
    return parts.join('.')
  }

  descendants(id: number, out: number[] = []): number[] {
    const inst = this.instances.get(id)
    if (!inst) return out
    for (const c of inst.children) {
      out.push(c)
      this.descendants(c, out)
    }
    return out
  }

  // ── zdarzenia ──────────────────────────────────────────────────────────
  queueEvent(key: EventKey, args: EventArgs): void {
    this.eventQueue.push({ key, args })
  }

  drainEvents(): Array<{ key: EventKey; args: EventArgs }> {
    const q = this.eventQueue
    this.eventQueue = []
    return q
  }

  // ── replikacja ─────────────────────────────────────────────────────────
  drainChanges(): { created: number[]; props: Array<[number, string, Raw]>; destroyed: number[] } {
    const out = { created: this.createdSinceDrain, props: this.propChanges, destroyed: this.destroyedSinceDrain }
    this.createdSinceDrain = []
    this.propChanges = []
    this.destroyedSinceDrain = []
    return out
  }

  // ── wygodne gettery fizyki/renderera ────────────────────────────────────
  size(id: number): Vec3 {
    const s = this.get(id)?.props.Size as number[] | undefined
    if (Array.isArray(s) && s.length >= 3) return { x: s[0], y: s[1], z: s[2] }
    return { x: 4, y: 1, z: 2 } // domyślny rozmiar Part w Robloxie
  }

  cframe(id: number): number[] {
    const c = this.get(id)?.props.CFrame as number[] | undefined
    if (Array.isArray(c) && c.length >= 12) return c
    const pos = this.get(id)?.props.Position as number[] | undefined
    const x = Array.isArray(pos) ? pos[0] : 0
    const y = Array.isArray(pos) ? pos[1] : 0
    const z = Array.isArray(pos) ? pos[2] : 0
    return [x, y, z, 1, 0, 0, 0, 1, 0, 0, 0, 1]
  }

  position(id: number): Vec3 {
    const c = this.cframe(id)
    return { x: c[0], y: c[1], z: c[2] }
  }

  isAnchored(id: number): boolean {
    return this.get(id)?.props.Anchored === true
  }

  collides(id: number): boolean {
    const p = this.get(id)?.props
    return !!p && p.CanCollide !== false
  }
}

/** Zamiana CFrame (12 liczb, wiersze macierzy obrotu) na macierz 4x4 (column-major, WebGL). */
export function cframeToMatrix(c: number[], size: Vec3, out: Float32Array): Float32Array {
  const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = c
  const sx = size.x, sy = size.y, sz = size.z
  out[0] = r00 * sx; out[1] = r10 * sx; out[2] = r20 * sx; out[3] = 0
  out[4] = r01 * sy; out[5] = r11 * sy; out[6] = r21 * sy; out[7] = 0
  out[8] = r02 * sz; out[9] = r12 * sz; out[10] = r22 * sz; out[11] = 0
  out[12] = x; out[13] = y; out[14] = z; out[15] = 1
  return out
}
