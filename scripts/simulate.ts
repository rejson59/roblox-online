/**
 * simulate.ts — integracyjny test gry bez przeglądarki.
 *
 * Uruchamia serwer + klienta, wczytuje mapę i skrypty Luau, a potem symuluje
 * kilka sekund rozgrywki i sprawdza, czy świat, fizyka i skrypty działają.
 *   npm run simulate
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { GameClient, GameServer, type NetMessage } from '../src/engine/game'
import { buildPlace, type PlaceScripts } from '../src/game/place'

const here = dirname(fileURLToPath(import.meta.url))
const lua = (name: string) => readFileSync(join(here, '../src/engine/lua', name), 'utf8')
const sources = { runtime: lua('runtime.lua'), services: lua('services.lua'), exports: lua('exports.lua') }
const gameScript = (name: string) => readFileSync(join(here, '../src/game/scripts', name), 'utf8')
const scripts: PlaceScripts = {
  coins: gameScript('server/Coins.server.lua'),
  killBrick: gameScript('server/KillBrick.server.lua'),
  movingPlatform: gameScript('server/MovingPlatform.server.lua'),
  gameService: gameScript('server/GameService.server.lua'),
  hud: gameScript('client/Hud.client.lua'),
}

const logs: Array<{ level: string; text: string }> = []
const log = (level: string, text: string) => {
  logs.push({ level, text })
  if (level === 'error' || level === 'warn') console.log(`[${level}] ${text}`)
}

async function main() {
  console.log('── boot serwera ──')
  const server = new GameServer(log, sources)
  buildPlace(server.world, server.serviceIds, scripts)
  await server.start('Tester')

  console.log('── boot klienta ──')
  const client = new GameClient(log, sources, () => 0)
  await client.start(server.snapshot() as NetMessage & { t: 'snapshot' }, 'Tester')

  console.log('── instancje: serwer', server.world.instances.size, '/ klient', client.world.instances.size)

  // sprawdzenie GUI utworzonego przez LocalScript
  const sg = [...client.world.instances.values()].find((i) => i.className === 'ScreenGui')
  console.log('ScreenGui z LocalScriptu:', sg ? String(sg.props.Name) : 'BRAK')

  // symulacja: 6 sekund biegu do przodu
  const dt = 1 / 60
  let t = 0
  const startPos = { ...server.characters.get(server.playerId)!.pos } as any
  for (let i = 0; i < 360; i++) {
    t += dt
    const input = { moveX: 0, moveZ: i > 30 ? 1 : 0, jump: i % 90 === 0, cameraYaw: 0 }
    await server.tick(dt, t, input)
    client.apply(server.drainForClient())
    await client.tick(dt, t)
  }
  const char = server.characters.get(server.playerId)!
  console.log('pozycja startowa:', startPos, '→ po 6 s:', char.pos.map((n: number) => +n.toFixed(2)))
  const moved = Math.hypot(char.pos[0] - startPos[0], char.pos[2] - startPos[2])
  console.log('przebyty dystans:', moved.toFixed(2), 'studów')

  // test monet: teleportujemy postać na pierwszą monetę
  const coins = [...server.world.instances.values()].filter((i) => i.props.Name === 'Moneta')
  console.log('monet w świecie:', coins.length)
  if (coins.length) {
    const coinPos = server.world.position(coins[0].id)
    char.pos = [coinPos.x, coinPos.y, coinPos.z]
    char.vel = [0, 0, 0]
    for (let i = 0; i < 40; i++) {
      t += dt
      await server.tick(dt, t, { moveX: 0, moveZ: 0, jump: false, cameraYaw: 0 })
      client.apply(server.drainForClient())
      await client.tick(dt, t)
    }
  }
  const stats = [...server.world.instances.values()].filter((i) => i.props.Name === 'Punkty')
  console.log('leaderstats Punkty:', stats.map((s) => s.props.Value))

  // test zabójczej płyty
  const kill = [...server.world.instances.values()].find((i) => i.props.Name === 'KillBrick')
  if (kill) {
    const kp = server.world.position(kill.id)
    char.pos = [kp.x, kp.y + 3, kp.z]
    char.vel = [0, 0, 0]
    for (let i = 0; i < 30; i++) {
      t += dt
      await server.tick(dt, t, { moveX: 0, moveZ: 0, jump: false, cameraYaw: 0 })
      client.apply(server.drainForClient())
      await client.tick(dt, t)
    }
    const hp = server.world.getProp(char.humanoidId, 'Health')
    console.log('zdrowie po wejściu na killbrick:', hp)
  }

  // test RemoteEventu (Notify z serwera do klienta)
  const notify = [...server.world.instances.values()].find((i) => i.props.Name === 'Notify')
  console.log('RemoteEvent Notify:', notify ? `id=${notify.id}` : 'BRAK')

  const errors = logs.filter((l) => l.level === 'error')
  console.log('\n── logi Luau (ostatnie 25) ──')
  for (const l of logs.slice(-25)) console.log(`  [${l.level}] ${l.text}`)

  const checks = [
    ['postać się poruszyła', moved > 3],
    ['LocalScript utworzył ScreenGui', !!sg],
    ['monety istnieją', coins.length >= 4],
    ['brak błędów Luau', errors.length === 0],
  ]
  console.log('\n── wyniki ──')
  let ok = true
  for (const [name, pass] of checks) {
    console.log(`${pass ? '✅' : '❌'} ${name}`)
    if (!pass) ok = false
  }
  if (errors.length) {
    console.log('Błędy:')
    for (const e of errors) console.log('  ' + e.text)
  }
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('KRYTYCZNY BŁĄD:', e)
  process.exit(1)
})
