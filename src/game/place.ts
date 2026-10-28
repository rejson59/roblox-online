/**
 * place.ts — zawartość miejsca (odpowiednik pliku .rbxl).
 *
 * Tutaj budujemy mapę: bazę, lobby, tor przeszkód (obby), monety,
 * ruchomą platformę, checkpointy, metę i NPC. Do instancji dołączamy
 * prawdziwe skrypty Luau z katalogu `scripts/`.
 */
import type { Raw, World } from '../engine/world'

const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export interface PlaceOptions {
  onProgress?: (msg: string) => void
}

/** Źródła skryptów Luau dołączonych do miejsca. */
export interface PlaceScripts {
  coins: string
  killBrick: string
  movingPlatform: string
  gameService: string
  hud: string
}

export function buildPlace(world: World, ids: Record<string, number>, scripts: PlaceScripts, opts: PlaceOptions = {}) {
  const ws = ids.Workspace
  const report = opts.onProgress ?? (() => {})

  const part = (
    name: string,
    className: string,
    size: [number, number, number],
    pos: [number, number, number],
    color: [number, number, number],
    parent = ws,
    extra: Record<string, Raw> = {},
  ) => {
    const key = world.get(parent)!.children.length
    const rotation = (extra.CFrame as number[] | undefined) ?? IDENTITY
    const props: Record<string, Raw> = {
      Name: name,
      Size: size,
      CFrame: [pos[0], pos[1], pos[2], ...rotation],
      Color: color,
      Anchored: true,
      Material: 256,
      TopSurface: 0,
      BottomSurface: 0,
      ...extra,
    }
    void key
    return world.create(className, props, parent)
  }

  // ── oświetlenie ──────────────────────────────────────────────────────
  const light = world.get(ids.Lighting)!
  light.props.ClockTime = 14.2
  light.props.Brightness = 2.2
  light.props.EnvironmentDiffuseScale = 0.6
  light.props.Ambient = [0.32, 0.34, 0.38]

  // ── baza i lobby ─────────────────────────────────────────────────────
  // lobby to jedyny twardy grunt — tor przeszkód wisi nad pustką,
  // więc upadek z platformy kończy się respawnem.
  part('Baseplate', 'Part', [76, 2, 62], [0, -1, 34], [0.36, 0.56, 0.33], ws, { Material: 1280 })
  report('budowa lobby')

  // spawn
  const spawn = part('SpawnLocation', 'SpawnLocation', [16, 1, 16], [0, 0.5, 34], [0.62, 0.64, 0.66], ws, {
    Material: 816, Neutral: true,
  })
  part('SpawnGlow', 'Part', [16.5, 0.2, 16.5], [0, 0.05, 34], [0.3, 0.85, 1], ws, {
    Material: 288, CanCollide: false, Transparency: 0.55,
  })

  // brama wejściowa
  for (const x of [-9, 9]) {
    part('Filar', 'Part', [2, 18, 2], [x, 9, 18], [0.86, 0.82, 0.72], ws, { Material: 816 })
  }
  part('Belka', 'Part', [20, 2, 2], [0, 18, 18], [0.86, 0.82, 0.72], ws, { Material: 816 })
  part('Szyld', 'Part', [13, 3.2, 0.4], [0, 14.5, 18], [0.14, 0.16, 0.22], ws, {
    Material: 288, CanCollide: false,
  })

  // ławeczki i dekoracje
  for (const [x, z] of [[-14, 30], [14, 30], [-14, 40], [14, 40]]) {
    part('Ławka', 'Part', [5, 0.6, 1.6], [x, 1.6, z], [0.55, 0.36, 0.22], ws, { Material: 512 })
    part('Noga', 'Part', [0.4, 1.6, 1.2], [x - 1.8, 0.8, z], [0.3, 0.3, 0.32], ws, { Material: 1088 })
    part('Noga', 'Part', [0.4, 1.6, 1.2], [x + 1.8, 0.8, z], [0.3, 0.3, 0.32], ws, { Material: 1088 })
  }

  // ── tor przeszkód ────────────────────────────────────────────────────
  report('budowa toru przeszkód')
  const obby = world.create('Folder', { Name: 'Obby' }, ws)
  const coins = world.create('Folder', { Name: 'Coins' }, ws)
  const checkpoints = world.create('Folder', { Name: 'Checkpoints' }, ws)

  const platform = (name: string, size: [number, number, number], pos: [number, number, number], color: [number, number, number], extra: Record<string, Raw> = {}) =>
    part(name, 'Part', size, pos, color, obby.id, extra)

  const spawnCoin = (pos: [number, number, number]) => {
    part('Moneta', 'Part', [2, 2, 2], pos, [1, 0.85, 0.15], coins.id, {
      Shape: 0, Material: 288, CanCollide: false, CanTouch: true, Anchored: true,
    })
  }

  // 14 platform o rosnącej trudności
  const courseColors: Array<[number, number, number]> = [
    [0.42, 0.72, 0.9], [0.42, 0.8, 0.62], [0.95, 0.78, 0.35], [0.9, 0.55, 0.45],
  ]
  // schody z lobby na start trasy (kontroler wchodzi na stopień do 1.25 studa)
  for (let st = 0; st < 5; st++) {
    part('Stopien', 'Part', [12, 1.2, 3.4], [0, 0.6 + st * 1.1, 9 - st * 3.4], [0.72, 0.7, 0.64], obby.id, { Material: 816 })
  }

  let z = -10
  let y = 5
  const checkpointEvery = 4

  for (let i = 1; i <= 14; i++) {
    const width = 9 - Math.min(i * 0.2, 2)
    const depth = 8.5 - Math.min(i * 0.15, 1.8)
    const xOffset = Math.sin(i * 0.9) * 3.6
    const color = courseColors[Math.floor(i / 4) % courseColors.length]
    platform(`Platforma${i}`, [width, 1, depth], [xOffset, y, z], color, { Material: 272 })

    if (i % 3 === 0) spawnCoin([xOffset, y + 2.6, z])
    if (i % 4 === 2) {
      part(`Checkpoint${i}`, 'Part', [width + 1, 0.4, depth + 1], [xOffset, y + 0.7, z], [0.25, 0.95, 0.5], checkpoints.id, {
        Material: 288, CanCollide: false, CanTouch: true, Index: i,
      })
    }
    if (i === 7) {
      // pas lawy przy prawej krawędzi — środek platformy zostaje przechodni
      const killer = part('KillBrick', 'Part', [2.6, 0.7, depth * 0.85], [xOffset + width / 2 - 1.3, y + 0.85, z], [1, 0.28, 0.28], obby.id, {
        Material: 288, CanCollide: true, CanTouch: true,
      })
      world.create('Script', { Name: 'KillBrick', Source: scripts.killBrick, Disabled: false }, killer.id)
    }
    if (i === 10) {
      const moving = platform('PlatformaRuchoma', [8, 1, 8], [xOffset, y, z - 8], [0.65, 0.5, 0.95], { Material: 272 })
      world.create('Script', { Name: 'MovingPlatform', Source: scripts.movingPlatform }, moving.id)
    }

    // odstęp między platformami: ~2 study przerwy (skok gracza to ~8 studów)
    z -= 8.2 + (i % 2) * 0.8
    y += 1 + (i % 3) * 0.25
  }

  // ściany ochronne po bokach ostatnich platform
  for (const side of [-1, 1]) {
    part('Bariera', 'Part', [0.6, 4, 44], [side * 22, y - 6, z + 60], [0.9, 0.92, 0.95], obby.id, {
      Transparency: 0.65, CanCollide: false, Material: 288,
    })
  }

  // meta
  const finishPos: [number, number, number] = [0, y + 1, z - 4]
  part('Finish', 'Part', [18, 1, 10], finishPos, [1, 0.84, 0.2], obby.id, { Material: 288, CanTouch: true })
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2
    part('Gwiazda', 'Part', [1.2, 1.2, 1.2], [finishPos[0] + Math.cos(angle) * 7, finishPos[1] + 4, finishPos[2] + Math.sin(angle) * 5],
      [1, 0.9, 0.4], obby.id, { Shape: 0, Material: 288, CanCollide: false })
  }

  // skrypt monet pod folderem Coins
  world.create('Script', { Name: 'CoinService', Source: scripts.coins }, coins.id)

  // ── NPC ──────────────────────────────────────────────────────────────
  report('tworzenie NPC')
  const npcs = world.create('Folder', { Name: 'NPC' }, ws)
  const makeNpc = (name: string, pos: [number, number, number], colors: { torso: number[]; legs: number[]; head: number[] }) => {
    const model = world.create('Model', { Name: name }, npcs.id)
    const mk = (n: string, size: number[], offset: number[], color: number[]) => {
      world.create('Part', {
        Name: n, Size: size, Color: color, Anchored: true, CanCollide: false, Material: 256,
        CFrame: [pos[0] + offset[0], pos[1] + offset[1], pos[2] + offset[2], ...IDENTITY],
      }, model.id)
    }
    mk('Torso', [2, 2, 1], [0, 0, 0], colors.torso)
    mk('Head', [2, 1, 1], [0, 1.5, 0], colors.head)
    mk('Left Arm', [1, 2, 1], [-1.5, 0, 0], colors.head)
    mk('Right Arm', [1, 2, 1], [1.5, 0, 0], colors.head)
    mk('Left Leg', [1, 2, 1], [-0.5, -2, 0], colors.legs)
    mk('Right Leg', [1, 2, 1], [0.5, -2, 0], colors.legs)
    world.create('Humanoid', { Name: 'Humanoid', Health: 100, MaxHealth: 100, WalkSpeed: 0 }, model.id)
  }
  makeNpc('Przewodnik', [-6, 3, 26], { torso: [0.85, 0.2, 0.2], legs: [0.2, 0.2, 0.25], head: [0.96, 0.8, 0.19] })
  makeNpc('Turysta', [7, 3, 40], { torso: [0.2, 0.6, 0.45], legs: [0.35, 0.3, 0.25], head: [0.85, 0.65, 0.45] })

  // ── dekoracje w tle (miasto) ─────────────────────────────────────────
  const city = world.create('Folder', { Name: 'Miasto' }, ws)
  for (let i = 0; i < 26; i++) {
    const angle = (i / 26) * Math.PI * 2
    const dist = 150 + (i % 5) * 22
    const h = 24 + ((i * 37) % 60)
    const w = 12 + ((i * 13) % 18)
    part('Budynek', 'Part', [w, h, w], [Math.cos(angle) * dist, h / 2, -40 + Math.sin(angle) * dist],
      [0.35 + (i % 4) * 0.05, 0.38 + (i % 3) * 0.04, 0.45 + (i % 5) * 0.03], city.id, { CanCollide: false })
  }

  // ── zdalne eventy ────────────────────────────────────────────────────
  world.create('RemoteEvent', { Name: 'Notify' }, ids.ReplicatedStorage)
  world.create('RemoteEvent', { Name: 'ChatMessage' }, ids.ReplicatedStorage)

  // ── skrypty serwerowe ────────────────────────────────────────────────
  world.create('Script', { Name: 'GameService', Source: scripts.gameService }, ids.ServerScriptService)
  world.create('ModuleScript', {
    Name: 'Config',
    Source: `local Config = {}
Config.Wersja = "1.0"
Config.Nazwa = "Obby w Krakowie"
Config.PunktyZaMete = 1
return Config`,
  }, ids.ReplicatedStorage)
  // użycie require() w skrypcie klienckim
  world.create('LocalScript', { Name: 'Hud', Source: scripts.hud }, starterPlayerScriptsId(world, ids))

  report('gotowe')
  void spawn
}

function starterPlayerScriptsId(world: World, ids: Record<string, number>): number {
  const found = world.findChild(ids.StarterPlayer, 'StarterPlayerScripts', false)
  return found ?? ids.StarterPlayer
}

function gid(inst: { id: number }): number {
  return inst.id
}
