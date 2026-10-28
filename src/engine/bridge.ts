/**
 * bridge.ts — mostek JS ↔ Luau.
 *
 * To jest "API silnika" widziane ze skryptów: kilkadziesiąt niskopoziomowych
 * funkcji. Wszystko, co wygodne (Vector3, CFrame, Instance, sygnały, task.*)
 * jest zbudowane na tych funkcjach w plikach `lua/runtime.lua` i `lua/services.lua`.
 *
 * Ważne ograniczenie luau-web: nie wolno wywołać Luau z wnętrza funkcji JS,
 * która została wywołana przez Luau (re-entrancy). Dlatego eventy nie są
 * "wypychane" do skryptów — leżą w kolejce i są odbierane na początku ticku.
 */
import type { World, Raw } from './world'

export type LogLevel = 'info' | 'warn' | 'error' | 'print'

export interface BridgeEnv {
  world: World
  role: 'Server' | 'Client'
  log: (level: LogLevel, message: string) => void
  /** null = jeszcze nie zbudowany stan Luau (wypełniane po createAsync) */
  stateRef: { loadstring?: (src: string, name: string, throwOn?: boolean) => any }
  onRemote: (remoteId: number, dir: 'server' | 'client' | 'all', playerId: number, args: Raw[]) => void
  onRemoteInvoke: (remoteId: number, dir: string, playerId: number, args: Raw[]) => Raw
  onBindableFire: (instanceId: number, args: Raw[]) => void
  onBindableInvoke: (instanceId: number, args: Raw[]) => Raw
  onChat: (message: string) => void
  onHumanoidDied: (humanoidId: number) => void
  getKeyDown: (keyName: string) => boolean
  getMouse: () => { x: number; y: number }
  raycast: (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, ignore: number[]) => Raw[] | null
  aabbQuery: (x: number, y: number, z: number, sx: number, sy: number, sz: number) => number[]
  playSound?: (instanceId: number) => void
}

/**
 * luau-web nie potrafi przenieść tablicy JS → Lua (tablica staje się liczbą),
 * dlatego wektory/CFrame/UDim2 wysyłamy jako obiekty z nazwanymi polami.
 */
function pack(v: any): any {
  if (!Array.isArray(v)) return v
  const a = v as number[]
  if (a.length === 3) return { x: a[0], y: a[1], z: a[2] }
  if (a.length === 2) return { x: a[0], y: a[1] }
  if (a.length === 4) return { a: a[0], b: a[1], c: a[2], d: a[3] }
  if (a.length === 12) {
    return {
      x: a[0], y: a[1], z: a[2], r00: a[3], r01: a[4], r02: a[5],
      r10: a[6], r11: a[7], r12: a[8], r20: a[9], r21: a[10], r22: a[11],
    }
  }
  const out: Record<string, unknown> = { len: a.length }
  a.slice(0, 16).forEach((n, i) => (out['v' + (i + 1)] = n))
  return out
}

export function createHost(env: BridgeEnv) {
  const { world, log } = env

  const host = {
    // ── diagnostyka ──────────────────────────────────────────────────────
    log(level: string, message: string) {
      log((level as LogLevel) ?? 'info', String(message))
    },

    // ── czas ─────────────────────────────────────────────────────────────
    now: () => performance.now() / 1000,

    // ── drzewo instancji ─────────────────────────────────────────────────
    newInstance(className: string, parentId: number | null) {
      const inst = world.create(className, {}, parentId ?? null)
      return inst.id
    },
    destroy(id: number) {
      world.destroy(id)
    },
    clone(id: number) {
      return world.clone(id) ?? null
    },
    setParent(id: number, parentId: number | null) {
      return world.setParent(id, parentId ?? null)
    },
    getParent(id: number) {
      return world.get(id)?.parent ?? null
    },
    getChildren(id: number) {
      return JSON.stringify(world.getChildren(id))
    },
    findChild(id: number, name: string, recursive: boolean) {
      return world.findChild(id, name, !!recursive)
    },
    findFirstChildOfClass(id: number, className: string, recursive: boolean) {
      return world.findFirstChildOfClass(id, className, !!recursive)
    },
    getClassName(id: number) {
      return world.get(id)?.className ?? 'Instance'
    },
    fullName(id: number) {
      return world.fullName(id)
    },
    getProp(id: number, key: string) {
      return pack(world.getProp(id, key))
    },
    setProp(id: number, key: string, value: Raw, fromScript: boolean) {
      return world.setProp(id, key, value ?? null, !!fromScript)
    },
    getAttribute(id: number, key: string) {
      return world.get(id)?.attributes[key] ?? null
    },
    setAttribute(id: number, key: string, value: Raw) {
      const inst = world.get(id)
      if (!inst) return false
      if (value === null) delete inst.attributes[key]
      else inst.attributes[key] = value
      return true
    },
    getAttributes(id: number) {
      return JSON.stringify(world.get(id)?.attributes ?? {})
    },
    addTag(id: number, tag: string) {
      world.get(id)?.tags.add(tag)
    },
    removeTag(id: number, tag: string) {
      world.get(id)?.tags.delete(tag)
    },
    hasTag(id: number, tag: string) {
      return !!world.get(id)?.tags.has(tag)
    },
    getTags(id: number) {
      return [...(world.get(id)?.tags ?? [])]
    },

    // ── kolejka zdarzeń (odbierana raz na tick) ──────────────────────────
    pollEvent(): string | null {
      const ev = world.eventQueue.shift()
      if (!ev) return null
      return JSON.stringify({ key: ev.key, args: ev.args })
    },

    // ── kompilacja kodu (dla require()) ──────────────────────────────────
    compile(source: string, chunkName: string): any {
      const st = env.stateRef.loadstring
      if (!st) return null
      const fn = st(source, chunkName, false)
      if (typeof fn === 'string') {
        log('error', `Błąd kompilacji ${chunkName}: ${fn}`)
        return null
      }
      return fn
    },

    // ── komunikacja sieciowa (RemoteEvent / BindableEvent) ───────────────
    remoteFire(remoteId: number, dir: string, playerId: number, args: Raw[]) {
      env.onRemote(remoteId, dir as 'server' | 'client' | 'all', playerId, args ?? [])
    },
    remoteInvoke(remoteId: number, dir: string, playerId: number, args: Raw[]) {
      return env.onRemoteInvoke(remoteId, dir, playerId, args ?? [])
    },
    bindableFire(instanceId: number, args: Raw[]) {
      env.onBindableFire(instanceId, args ?? [])
    },
    bindableInvoke(instanceId: number, args: Raw[]) {
      return env.onBindableInvoke(instanceId, args ?? [])
    },
    chat(message: string) {
      env.onChat(String(message))
    },
    humanoidDied(id: number) {
      env.onHumanoidDied(id)
    },

    // ── świat / zapytania fizyczne ───────────────────────────────────────
    raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, ignoreJson: string) {
      let ignore: number[] = []
      try {
        const parsed = JSON.parse(ignoreJson || '[]')
        // pusty obiekt zamiast tablicy (Lua: {}) traktujemy jak brak ignorowanych
        ignore = Array.isArray(parsed) ? parsed.map(Number) : []
      } catch { ignore = [] }
      const raw = env.raycast(ox, oy, oz, dx, dy, dz, ignore)
      return raw ? JSON.stringify(raw) : null
    },
    aabbQuery(x: number, y: number, z: number, sx: number, sy: number, sz: number) {
      return JSON.stringify(env.aabbQuery(x, y, z, sx, sy, sz))
    },

    // ── wejście ──────────────────────────────────────────────────────────
    isKeyDown(name: string) {
      return env.getKeyDown(name)
    },
    mouseX: () => env.getMouse().x,
    mouseY: () => env.getMouse().y,

    // ── dźwięk ───────────────────────────────────────────────────────────
    playSound(id: number) {
      env.playSound?.(id)
    },
  }
  return host
}
