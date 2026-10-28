/**
 * game.ts — serwer i klient gry + replikacja.
 *
 * W Robloxie serwer i klient to dwa osobne procesy, a między nimi działa
 * replikacja instancji i RemoteEventy. Tutaj mamy dwa niezależne światy
 * (World) i dwie maszyny Luau w jednej karcie przeglądarki — semantyka jest
 * ta sama, tylko „sieć" to kolejka w pamięci.
 */
import { Character, type CharInput } from './character'
import { LuaRuntime, buildServiceTree, type LuaSources } from './luaRuntime'
import { Physics } from './physics'
import { collectPartBoxes, raycastWorld, aabbQueryWorld } from './query'
import { isAPart, ref, type Raw, type World } from './world'
import { World as WorldClass } from './world'

export type NetMessage =
  | { t: 'snapshot'; instances: Array<{ id: number; class: string; props: Record<string, Raw>; parent: number | null }>; localPlayerId: number; time: number }
  | { t: 'created'; id: number; class: string; props: Record<string, Raw>; parent: number | null }
  | { t: 'prop'; id: number; key: string; value: Raw }
  | { t: 'destroyed'; id: number }
  | { t: 'remote'; id: number; playerId: number; args: Raw[] }
  | { t: 'chat'; playerId: number; text: string }

export interface LogSink {
  (level: 'info' | 'warn' | 'error' | 'print', text: string): void
}

const FIRST_USER_ID = 100

/** Wartości typu Instance trzymamy w świecie jako `@id`. */
export function asId(raw: unknown): number | null {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string' && raw.startsWith('@')) {
    const n = Number(raw.slice(1))
    return Number.isFinite(n) ? n : null
  }
  return null
}

export class GameServer {
  world = new WorldClass()
  serviceIds: Record<string, number>
  runtime!: LuaRuntime
  physics: Physics
  characters = new Map<number, Character>()
  /** wejście graczy: playerId → stan */
  inputs = new Map<number, CharInput>()
  outbox: NetMessage[] = []
  private touchState = new Map<string, boolean>()
  playerId = 0
  private clock = 0
  /** instancje o id <= tej wartości to serwisy wspólne dla obu stron */
  private serviceIdMax = 0

  constructor(public log: LogSink, private sources: LuaSources) {
    this.serviceIds = buildServiceTree(this.world).ids
    this.serviceIdMax = Math.max(...Object.values(this.serviceIds))
    this.physics = new Physics(this.world)
  }

  async start(playerName: string) {
    this.playerId = this.newPlayerId()
    const player = this.world.create('Player', {
      Name: playerName, DisplayName: playerName, UserId: 1, AccountAge: 0,
    }, this.serviceIds.Players)
    this.world.create('PlayerGui', { Name: 'PlayerGui' }, player.id)
    const leaderstats = this.world.create('Folder', { Name: 'leaderstats' }, player.id)
    this.world.create('IntValue', { Name: 'Punkty', Value: 0 }, leaderstats.id)
    this.world.create('IntValue', { Name: 'Wygrane', Value: 0 }, leaderstats.id)

    this.runtime = new LuaRuntime({
      world: this.world,
      role: 'Server',
      log: (l, t) => this.log(l as any, t),
      onRemote: (id, dir, pid, args) => this.handleRemote(id, dir, pid, args),
      onRemoteInvoke: () => null,
      onBindableFire: (id, args) => this.world.queueEvent(`i${id}:sig:Event`, args),
      onBindableInvoke: () => null,
      onChat: (msg) => this.onChat(this.playerId, msg),
      onHumanoidDied: () => {},
      getKeyDown: () => false,
      getMouse: () => ({ x: 0, y: 0 }),
      raycast: (ox, oy, oz, dx, dy, dz, ig) => raycastWorld(this.world, ox, oy, oz, dx, dy, dz, ig),
      aabbQuery: (x, y, z, sx, sy, sz) => aabbQueryWorld(this.world, x, y, z, sx, sy, sz),
      playerName,
    }, this.serviceIds, this.sources)
    await this.runtime.init()
    await this.runtime.loadModules()

    // kolejność jak w Robloxie: PlayerAdded, potem CharacterAdded
    this.world.queueEvent('__playerAdded', [ref(player.id)])
    this.spawnCharacter(this.playerId)

    // skrypty serwerowe
    await this.runtime.runContainerScripts([this.serviceIds.ServerScriptService, this.serviceIds.Workspace], 'Script')
    this.world.drainChanges()
  }

  newPlayerId() {
    let id = FIRST_USER_ID
    while (this.world.get(id)) id++
    return id
  }

  spawnLocation(): [number, number, number] {
    const ws = this.serviceIds.Workspace
    for (const child of this.world.getChildren(ws)) {
      const inst = this.world.get(child)
      if (inst && inst.className === 'SpawnLocation') {
        const cf = this.world.cframe(child)
        return [cf[0], cf[1] + 4, cf[2]]
      }
    }
    return [0, 8, 0]
  }

  spawnCharacter(playerTag: number, name?: string) {
    const pname = name ?? String(this.world.getProp(playerTag, 'Name') ?? 'Gracz')
    const sp = this.spawnLocation()
    const ch = new Character(this.world, pname, [sp[0], sp[1] + 3, sp[2]], this.serviceIds.Workspace)
    this.characters.set(playerTag, ch)
    this.world.setProp(playerTag, 'Character', ref(ch.modelId))
    this.world.queueEvent(`i${playerTag}:sig:CharacterAdded`, [ref(ch.modelId)])
    return ch
  }

  /* ── sieć ─────────────────────────────────────────────────────────────── */

  handleRemote(remoteId: number, dir: string, playerId: number, args: Raw[]) {
    if (dir === 'server') {
      // wywołanie z klienta: event trafia do świata serwera
      this.world.queueEvent('__remote', [remoteId, 'server', ref(playerId || this.playerId), args])
    } else if (dir === 'client') {
      this.outbox.push({ t: 'remote', id: remoteId, playerId, args })
    } else if (dir === 'all') {
      this.outbox.push({ t: 'remote', id: remoteId, playerId: 0, args })
    }
  }

  onChat(playerId: number, text: string) {
    this.world.queueEvent('__chat', [ref(playerId), text])
    this.outbox.push({ t: 'chat', playerId, text })
  }

  snapshot(): NetMessage {
    const instances: Array<{ id: number; class: string; props: Record<string, Raw>; parent: number | null }> = []
    for (const inst of this.world.instances.values()) {
      if (inst.id <= this.serviceIdMax) continue
      instances.push({ id: inst.id, class: inst.className, props: { ...inst.props }, parent: inst.parent })
    }
    return { t: 'snapshot', instances, localPlayerId: this.playerId, time: this.clock }
  }

  /** Krok serwera: skrypty → fizyka → postacie → replikacja. */
  async tick(dt: number, nowSec: number, input: CharInput | null) {
    this.clock = nowSec
    await this.runtime.tick(dt, nowSec)
    const anchored = collectPartBoxes(this.world, (id) => this.world.isAnchored(id) && this.world.collides(id))
    // części swobodne + styki
    this.physics.step(dt, (a, b) => this.fireTouch(a, b), () => {})
    // postacie
    for (const [playerTag, ch] of this.characters) {
      const inp: CharInput = input ?? { moveX: 0, moveZ: 0, jump: false, cameraYaw: 0 }
      ch.update(dt, inp, anchored)
      this.checkCharacterTouches(ch)
      if (ch.pos[1] < -40) {
        this.world.setProp(ch.humanoidId, 'Health', 0)
      }
      if (ch.dead) {
        ch.respawnTimer += dt
        if (ch.respawnTimer > 3) this.respawnCharacter(playerTag)
      }
    }
  }

  /** Odrodzenie w miejscu checkpointu (atrybut RespawnPoint ustawiany przez skrypt). */
  respawnCharacter(playerTag: number) {
    const ch = this.characters.get(playerTag)
    if (!ch) return
    const point = this.world.get(playerTag)?.attributes.RespawnPoint
    let spawn: [number, number, number]
    if (Array.isArray(point) && point.length >= 3) {
      spawn = [Number(point[0]), Number(point[1]), Number(point[2])]
    } else {
      spawn = this.spawnLocation()
    }
    this.world.setProp(ch.humanoidId, 'Health', 100)
    this.world.setProp(ch.modelId, 'Dead', false)
    ch.dead = false
    ch.respawnTimer = 0
    ch.vel = [0, 0, 0]
    ch.pos = [spawn[0], spawn[1] + 2.5, spawn[2]]
  }

  private fireTouch(a: number, b: number) {
    const ia = this.world.get(a), ib = this.world.get(b)
    if (!ia || !ib) return
    if (ia.props.CanTouch === false || ib.props.CanTouch === false) return
    this.world.queueEvent(`i${a}:sig:Touched`, [ref(b)])
    this.world.queueEvent(`i${b}:sig:Touched`, [ref(a)])
  }

  private checkCharacterTouches(ch: Character) {
    const parts = ch.boxes()
    const targets = collectPartBoxes(this.world)
    for (const pb of parts) {
      const partner = this.world.get(pb.id)
      if (!partner) continue
      for (const tb of targets) {
        if (tb.id === pb.id) continue
        if (this.isDescendantOf(tb.id, ch.modelId)) continue
        const overlap = pb.min[0] < tb.max[0] && pb.max[0] > tb.min[0] &&
          pb.min[1] < tb.max[1] && pb.max[1] > tb.min[1] &&
          pb.min[2] < tb.max[2] && pb.max[2] > tb.min[2]
        const key = `${pb.id}:${tb.id}`
        const was = this.touchState.get(key) ?? false
        if (overlap && !was) {
          this.touchState.set(key, true)
          this.fireTouch(pb.id, tb.id)
        } else if (!overlap && was) {
          this.touchState.set(key, false)
          this.world.queueEvent(`i${pb.id}:sig:TouchEnded`, [ref(tb.id)])
          this.world.queueEvent(`i${tb.id}:sig:TouchEnded`, [ref(pb.id)])
        }
      }
    }
  }

  private isDescendantOf(id: number, ancestor: number): boolean {
    let cur = this.world.get(id)?.parent ?? null
    while (cur !== null) {
      if (cur === ancestor) return true
      cur = this.world.get(cur)?.parent ?? null
    }
    return false
  }

  /** Zmiany do wysłania klientowi. */
  drainForClient(): NetMessage[] {
    const changes = this.world.drainChanges()
    const out: NetMessage[] = [...this.outbox]
    this.outbox = []
    for (const id of changes.destroyed) out.push({ t: 'destroyed', id })
    for (const id of changes.created) {
      if (id <= this.serviceIdMax) continue
      const inst = this.world.get(id)
      if (!inst) continue
      out.push({ t: 'created', id, class: inst.className, props: { ...inst.props }, parent: inst.parent })
    }
    for (const [id, key, value] of changes.props) {
      out.push({ t: 'prop', id, key, value })
    }
    return out
  }
}

export class GameClient {
  world = new WorldClass()
  serviceIds: Record<string, number>
  runtime!: LuaRuntime
  localPlayerId = 0
  private pendingRemotes: NetMessage[] = []

  constructor(public log: LogSink, private sources: LuaSources, public serverClock: () => number) {
    this.serviceIds = buildServiceTree(this.world).ids
  }

  async start(snapshot: NetMessage & { t: 'snapshot' }, playerName: string) {
    this.localPlayerId = snapshot.localPlayerId
    for (const inst of snapshot.instances) {
      this.world.createWithId(inst.id, inst.class, { ...inst.props }, null)
    }
    // parentowanie po utworzeniu wszystkich
    for (const inst of snapshot.instances) {
      if (inst.parent !== null) this.world.setParent(inst.id, inst.parent)
    }
    this.world.drainChanges()
    this.world.eventQueue = []

    this.runtime = new LuaRuntime({
      world: this.world,
      role: 'Client',
      log: (l, t) => this.log(l as any, t),
      onRemote: (id, dir, pid, args) => {
        if (dir === 'server') this.pendingRemotes.push({ t: 'remote', id, playerId: this.localPlayerId, args })
        void pid
      },
      onRemoteInvoke: () => null,
      onBindableFire: (id, args) => this.world.queueEvent(`i${id}:sig:Event`, args),
      onBindableInvoke: () => null,
      onChat: () => {},
      onHumanoidDied: () => {},
      getKeyDown: () => false,
      getMouse: () => ({ x: 0, y: 0 }),
      raycast: (ox, oy, oz, dx, dy, dz, ig) => raycastWorld(this.world, ox, oy, oz, dx, dy, dz, ig),
      aabbQuery: (x, y, z, sx, sy, sz) => aabbQueryWorld(this.world, x, y, z, sx, sy, sz),
      playerName,
      localPlayerId: snapshot.localPlayerId,
    }, this.serviceIds, this.sources)
    await this.runtime.init()
    await this.runtime.loadModules()

    const starterPlayer = this.world.get(this.serviceIds.StarterPlayer)
    const containers = [this.serviceIds.StarterGui, this.serviceIds.ReplicatedFirst]
    for (const child of this.world.getChildren(starterPlayer?.id ?? 0)) {
      const inst = this.world.get(child)
      if (inst?.props.Name === 'StarterPlayerScripts') containers.push(child)
    }
    const player = this.world.get(this.localPlayerId)
    if (player) {
      for (const child of this.world.getChildren(player.id)) {
        const inst = this.world.get(child)
        if (inst?.className === 'PlayerGui') containers.push(child)
      }
    }
    await this.runtime.runContainerScripts(containers, 'LocalScript')
    // uruchom też LocalScripty leżące w Workspace (częsta praktyka)
    await this.runtime.runContainerScripts([this.serviceIds.Workspace], 'LocalScript')
    this.world.drainChanges()
  }

  apply(messages: NetMessage[]) {
    for (const msg of messages) {
      switch (msg.t) {
        case 'created':
          this.world.createWithId(msg.id, msg.class, { ...msg.props }, msg.parent)
          break
        case 'prop': {
          const before = this.world.getProp(msg.id, msg.key)
          this.world.setProp(msg.id, msg.key, msg.value)
          const cls = this.world.get(msg.id)?.className
          if (msg.key === 'Character' && cls === 'Player') {
            const modelId = asId(msg.value)
            if (modelId !== null) this.world.queueEvent(`i${msg.id}:sig:CharacterAdded`, [ref(modelId)])
          }
          if (msg.key === 'Health' && cls === 'Humanoid' && Number(msg.value) <= 0 && Number(before) > 0) {
            this.world.queueEvent(`i${msg.id}:sig:Died`, [])
            this.world.queueEvent(`i${msg.id}:sig:HealthChanged`, [0])
          }
          if (msg.key === 'Health' && cls === 'Humanoid' && Number(msg.value) > 0) {
            this.world.queueEvent(`i${msg.id}:sig:HealthChanged`, [Number(msg.value)])
          }
          break
        }
        case 'destroyed':
          this.world.destroy(msg.id)
          break
        case 'remote':
          this.world.queueEvent('__remote', [msg.id, 'client', msg.playerId, msg.args])
          break
        case 'chat':
          this.world.queueEvent('__chat', [msg.playerId, msg.text])
          break
      }
    }
    this.world.drainChanges()
  }

  /** Zdarzenia klienta (RemoteEvent:FireServer) do wysłania na serwer. */
  drainToServer(): Array<{ id: number; args: Raw[] }> {
    const out = this.pendingRemotes.map((m) => ({ id: (m as any).id as number, args: (m as any).args as Raw[] }))
    this.pendingRemotes = []
    return out
  }

  /** Krok klienta: zdarzenia sieci, skrypty klienta. */
  async tick(dt: number, nowSec: number) {
    await this.runtime.tick(dt, nowSec)
    // kamera widoczna dla skryptów
    void dt
  }

  characterModel(): number | null {
    const player = this.world.get(this.localPlayerId)
    if (!player) return null
    return asId(player.props.Character)
  }

  isCollidablePart(id: number): boolean {
    const inst = this.world.get(id)
    return !!inst && isAPart(inst.className)
  }
}
