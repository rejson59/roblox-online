/**
 * luaRuntime.ts — uruchomienie VM Luau (WebAssembly) i wpięcie jej w silnik.
 *
 * Każda strona gry (serwer i klient) ma własną, niezależną maszynę Luau —
 * dokładnie jak w Robloxie, gdzie serwer i klient to dwa osobne procesy.
 */
import { InternalLuauWasmModule, LuauState } from 'luau-web'
import { createHost, type BridgeEnv, type LogLevel } from './bridge'
import type { World } from './world'

// luau-web domyślnie blokuje zapis do tabeli globalnej; skrypty Robloxa
// tworzą globalne zmienne, więc musimy to poluzować.
let optionSet = false
function enableWritableGlobals() {
  if (optionSet) return
  optionSet = true
  try {
    ;(InternalLuauWasmModule as any).options.set('LUA_NONSTRICT_READONLY', true)
  } catch {
    /* starsze wersje pakietu nie mają tej opcji */
  }
}

export const SERVICE_ORDER = [
  'Workspace', 'Players', 'Lighting', 'RunService', 'ReplicatedStorage', 'ServerScriptService',
  'ServerStorage', 'StarterGui', 'StarterPlayer', 'SoundService', 'TweenService', 'Debris',
  'ContentProvider', 'ReplicatedFirst', 'Chat',
] as const

export const DATA_MODEL_ID = 1

/** luau-web zwraca funkcje Lua jako obiekty-proxy; wyciągamy wywoływalne jądro. */
function asCallable(v: any): ((...args: any[]) => Promise<any>) | null {
  if (!v) return null
  if (typeof v === 'function') return v
  if (typeof v[0] === 'function') return v[0]
  if (typeof v.call === 'function') return v.call.bind(v)
  return null
}

export interface LuaSources {
  runtime: string
  services: string
  exports: string
}

export interface RuntimeOptions {
  world: World
  role: 'Server' | 'Client'
  log: (level: LogLevel, text: string) => void
  onRemote: BridgeEnv['onRemote']
  onRemoteInvoke: BridgeEnv['onRemoteInvoke']
  onBindableFire: BridgeEnv['onBindableFire']
  onBindableInvoke: BridgeEnv['onBindableInvoke']
  onChat: (msg: string) => void
  onHumanoidDied: (humanoidId: number) => void
  getKeyDown: (name: string) => boolean
  getMouse: () => { x: number; y: number }
  raycast: BridgeEnv['raycast']
  aabbQuery: BridgeEnv['aabbQuery']
  playSound?: (id: number) => void
  playerName: string
  localPlayerId?: number
}

/** Tworzy drzewo serwisów (game → Workspace, Players, ...) o deterministycznych id.
 *  Obie strony (serwer/klient) budują identyczne id, więc replikacja jest prosta. */
export function buildServiceTree(world: World): { rootId: number; ids: Record<string, number> } {
  const root = world.createWithId(DATA_MODEL_ID, 'DataModel', { Name: 'game' }, null)
  const ids: Record<string, number> = {}
  for (const name of SERVICE_ORDER) {
    const inst = world.create(name, { Name: name }, root.id)
    ids[name] = inst.id
  }
  // Workspace.CurrentCamera
  const camera = world.create('Camera', { Name: 'Camera', FieldOfView: 70, CFrame: [0, 5, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1] }, ids.Workspace)
  ids.CurrentCamera = camera.id
  // StarterPlayer scripts containers
  world.create('StarterPlayerScripts', { Name: 'StarterPlayerScripts' }, ids.StarterPlayer)
  world.create('StarterCharacterScripts', { Name: 'StarterCharacterScripts' }, ids.StarterPlayer)
  // default lighting, jak w Robloxie
  const ws = world.get(ids.Workspace)!
  ws.props.Gravity = 196.2
  const light = world.get(ids.Lighting)!
  light.props.ClockTime = 14.5
  light.props.Brightness = 2
  light.props.Ambient = [0.27, 0.27, 0.29]
  light.props.OutdoorAmbient = [0.5, 0.5, 0.55]
  light.props.FogEnd = 1000
  light.props.FogColor = [0.75, 0.83, 0.9]
  // wyczyść ślady tworzenia z replikacji
  world.drainChanges()
  return { rootId: root.id, ids }
}

export class LuaRuntime {
  state!: LuauState
  host!: ReturnType<typeof createHost>
  tickFn: any = null
  tickCall: (...args: any[]) => Promise<any> = async () => {}
  withScriptFn: any = null
  getInstFn: any = null
  readonly serviceIds: Record<string, number>
  private pendingRemotes: Array<() => void> = []
  loaded = false

  constructor(
    public opts: RuntimeOptions,
    serviceIds: Record<string, number>,
    public sources: LuaSources,
  ) {
    this.serviceIds = serviceIds
  }

  async init(): Promise<void> {
    enableWritableGlobals()
    const stateRef: BridgeEnv['stateRef'] = {}
    this.host = createHost({
      world: this.opts.world,
      role: this.opts.role,
      log: this.opts.log,
      stateRef,
      onRemote: this.opts.onRemote,
      onRemoteInvoke: this.opts.onRemoteInvoke,
      onBindableFire: this.opts.onBindableFire,
      onBindableInvoke: this.opts.onBindableInvoke,
      onChat: this.opts.onChat,
      onHumanoidDied: this.opts.onHumanoidDied,
      getKeyDown: this.opts.getKeyDown,
      getMouse: this.opts.getMouse,
      raycast: this.opts.raycast,
      aabbQuery: this.opts.aabbQuery,
      playSound: this.opts.playSound,
    })

    const env: Record<string, unknown> = {
      host: this.host,
      __ROOT_ID: DATA_MODEL_ID,
      __WS_ID: this.serviceIds.Workspace,
      __PLAYERS_ID: this.serviceIds.Players,
      __LIGHTING_ID: this.serviceIds.Lighting,
      __RS_ID: this.serviceIds.RunService,
      __REPLICATED_ID: this.serviceIds.ReplicatedStorage,
      __SERVERSCRIPTS_ID: this.serviceIds.ServerScriptService,
      __SERVERSTORAGE_ID: this.serviceIds.ServerStorage,
      __STARTERGUI_ID: this.serviceIds.StarterGui,
      __STARTERPLAYER_ID: this.serviceIds.StarterPlayer,
      __SOUNDSERVICE_ID: this.serviceIds.SoundService,
      __TWEENSERVICE_ID: this.serviceIds.TweenService,
      __DEBRIS_ID: this.serviceIds.Debris,
      __CONTENTPROVIDER_ID: this.serviceIds.ContentProvider,
      __REPLICATEDFIRST_ID: this.serviceIds.ReplicatedFirst,
      __CHAT_ID: this.serviceIds.Chat,
      __RUNNING_AS: this.opts.role,
      __LOCAL_PLAYER_ID: this.opts.localPlayerId ?? 0,
      __PLACE_ID: 0,
    }

    this.state = await LuauState.createAsync(env)
    stateRef.loadstring = (src, name, throwOn) => this.state.loadstring(src, name, throwOn as any)

    // ładujemy preludium: najpierw DataTypy/scheduler/Instance, potem serwisy
    const load = async (src: string, name: string) => {
      const fn = this.state.loadstring(src, name, false)
      if (typeof fn === 'string') {
        this.opts.log('error', `Błąd kompilacji ${name}: ${fn}`)
        throw new Error(`Compile error in ${name}: ${fn}`)
      }
      await fn()
    }
    await load(this.sources.runtime, 'runtime.lua')
    await load(this.sources.services, 'services.lua')
    await load(this.sources.exports, 'exports.lua')

    this.tickFn = await this.state.loadstring('return RBX.tick', 'tick', true)()
    const tc = asCallable(this.tickFn)
    if (!tc) throw new Error('Nie udało się uzyskać funkcji tick z VM Luau')
    this.tickCall = tc
    this.loaded = true
  }

  /** Jeden tick VM: eventy, timery, Heartbeat. */
  async tick(dt: number, nowSec: number): Promise<void> {
    if (!this.loaded) return
    await this.tickCall(dt, nowSec)
  }

  /** Kod skryptu w Luau, opakowany tak, by `script` było lokalną zmienną
   *  i by mógł yieldować (task.wait) — jak w Robloxie. */
  private wrapScript(instanceId: number, source: string): string {
    // xpcall + debug.traceback: błędy w skryptach gracza pokazują numer linii,
    // tak jak w Output w Roblox Studio. Treść skryptu zaczyna się w linii 2,
    // więc numery w tracebacku są o 1 większe niż w edytorze.
    return `local __s = RBX.instanceTable(${instanceId})\n` +
      `RBX.runScriptThread(__s, function(script)\n` +
      `local __ok, __err = xpcall(function()\n${source}\nend, ` +
      "function(__e) return tostring(__e) .. '\\n' .. debug.traceback('', 2) end)\n" +
      `if not __ok then error(__err, 0) end\nend)`
  }

  async runScript(scriptId: number): Promise<void> {
    const inst = this.opts.world.get(scriptId)
    if (!inst) return
    const source = (inst.props.Source as string) ?? ''
    if (!source.trim()) return
    if (inst.props.Disabled === true) return
    const chunkName = `${inst.className} ${this.opts.world.fullName(scriptId)}`
    const fn = this.state.loadstring(this.wrapScript(scriptId, source), chunkName, false)
    if (typeof fn === 'string') {
      this.opts.log('error', `Błąd składni w ${chunkName}:\n${fn}`)
      return
    }
    try {
      const call = asCallable(fn)
      if (!call) { this.opts.log('error', `Nie udało się uruchomić ${chunkName}`); return }
      await call()
    } catch (e) {
      this.opts.log('error', `Błąd w ${chunkName}: ${String(e)}`)
    }
  }

  /** Rejestruje definicje wszystkich ModuleScriptów (żeby require() działał). */
  async loadModules(): Promise<void> {
    const defs: string[] = ['RBX.moduleDefs = RBX.moduleDefs or {}']
    for (const inst of this.opts.world.instances.values()) {
      if (inst.className !== 'ModuleScript') continue
      const src = String(inst.props.Source ?? '')
      if (!src.trim()) continue
      defs.push(`RBX.moduleDefs[${inst.id}] = function(script)\n${src}\nend`)
    }
    if (defs.length === 1) return
    const fn = this.state.loadstring(defs.join('\n'), 'modules', false)
    if (typeof fn === 'string') {
      this.opts.log('error', `Błąd kompilacji modułów: ${fn}`)
      return
    }
    const call = asCallable(fn)
    if (call) await call()
  }

  /** Uruchamia wszystkie skrypty danego typu w podanych kontenerach. */
  async runContainerScripts(containerIds: number[], className: 'Script' | 'LocalScript'): Promise<void> {
    for (const cid of containerIds) {
      const found: number[] = []
      const walk = (id: number) => {
        for (const child of this.opts.world.getChildren(id)) {
          const inst = this.opts.world.get(child)
          if (!inst) continue
          if (inst.className === className) found.push(child)
          walk(child)
        }
      }
      walk(cid)
      for (const sid of found) await this.runScript(sid)
    }
  }
}
