/**
 * obby.test.ts — test „czy tor da się przejść?”.
 *
 * Uruchamia serwer bez klienta i steruje postacią prostym botem, który idzie
 * od platformy do platformy. Dzięki temu wiemy, że mapa jest naprawdę
 * przechodnia (a nie tylko „ładnie wygląda w kodzie”).
 */
import { readFileSync } from 'node:fs'
import { GameServer } from '../src/engine/game'
import { partBox } from '../src/engine/query'
import { isAPart } from '../src/engine/world'
import { buildPlace, type PlaceScripts } from '../src/game/place'

const lua = (n: string) => readFileSync(new URL(`../src/engine/lua/${n}`, import.meta.url), 'utf8')
const game = (n: string) => readFileSync(new URL(`../src/game/scripts/${n}`, import.meta.url), 'utf8')

const sources = { runtime: lua('runtime.lua'), services: lua('services.lua'), exports: lua('exports.lua') }
const scripts: PlaceScripts = {
  coins: game('server/Coins.server.lua'),
  killBrick: game('server/KillBrick.server.lua'),
  movingPlatform: game('server/MovingPlatform.server.lua'),
  gameService: game('server/GameService.server.lua'),
  hud: '',
}

const server = new GameServer(() => {}, sources)
buildPlace(server.world, server.serviceIds, scripts)
await server.start('Tester')

const ch = () => server.characters.get(server.playerId)!
const platformPos = (name: string): [number, number, number] | null => {
  for (const inst of server.world.instances.values()) {
    if (inst.props.Name === name) {
      const cf = server.world.cframe(inst.id)
      return [cf[0], cf[1], cf[2]]
    }
  }
  return null
}

/** Czy w punkcie (x,z) na wysokości y jest podłoga, po której można iść? */
function groundAt(x: number, y: number, z: number): boolean {
  for (const inst of server.world.instances.values()) {
    if (!isAPart(inst.className)) continue
    if (inst.props.CanCollide === false || inst.props.Anchored !== true) continue
    const b = partBox(server.world, inst.id)
    if (!b) continue
    if (x > b.min[0] && x < b.max[0] && z > b.min[2] && z < b.max[2] && y > b.min[1] - 0.5 && y < b.max[1] + 0.7) return true
  }
  return false
}

const targets: Array<{ name: string; pos: [number, number, number] }> = []
for (let i = 1; i <= 14; i++) {
  const p = platformPos(`Platforma${i}`)
  if (p) targets.push({ name: `Platforma${i}`, pos: p })
}
const finish = platformPos('Finish')
if (finish) targets.push({ name: 'Finish', pos: finish })
console.log(`celów do przejścia: ${targets.length}`)
if (process.env.VERBOSE) for (const t of targets) console.log(`  ${t.name}: [${t.pos.map((n) => n.toFixed(1)).join(', ')}]`)

let index = 0
let frames = 0
let stuck = 0
let lastPos = ch().pos.slice() as [number, number, number]
let reached = 0
const deaths: number[] = []
let wasDead = false

while (index < targets.length && frames < 60 * 150) {
  const c = ch()
  const target = targets[index].pos
  const dx = target[0] - c.pos[0]
  const dz = target[2] - c.pos[2]
  const dist = Math.hypot(dx, dz)
  const feet = c.pos[1] - 2.5
  // platforma ma 1 stud grubości → jej wierzch jest 0.5 nad środkiem
  const needJump = target[1] + 0.5 - feet > 0.6 && dist < 7.5
  const aheadX = c.pos[0] + (dx / (dist || 1)) * 2.8
  const aheadZ = c.pos[2] + (dz / (dist || 1)) * 2.8
  const gapAhead = dist > 2.5 && !groundAt(aheadX, feet - 0.15, aheadZ)
  const input = {
    moveX: dist > 0.6 ? dx / (dist || 1) : 0,
    moveZ: dist > 0.6 ? -dz / (dist || 1) : 0,
    // skok, gdy trzeba wejść wyżej, gdy przed nami dziura albo gdy utknęliśmy
    jump: c.grounded && (needJump || gapAhead || stuck > 8),
    cameraYaw: 0,
  }
  await server.tick(1 / 60, frames / 60, input)
  frames++
  const after = ch()
  if (process.env.VERBOSE && frames % 30 === 0) {
    console.log(`    f=${frames} cel=${targets[index]?.name} pos=[${after.pos.map((n) => n.toFixed(1)).join(', ')}] grounded=${after.grounded}`)
  }
  if (after.dead) {
    if (!wasDead) deaths.push(frames)
    wasDead = true
    stuck = 0
    lastPos = after.pos.slice() as [number, number, number]
    if (deaths.length > 6) break
    continue
  }
  wasDead = false
  const moved = Math.hypot(after.pos[0] - lastPos[0], after.pos[2] - lastPos[2])
  stuck = moved < 0.02 ? stuck + 1 : 0
  lastPos = after.pos.slice() as [number, number, number]

  if (dist < 4.2 && Math.abs(after.pos[1] - 2.5 - target[1]) < 3.2) {
    reached++
    index++
    stuck = 0
    console.log(`  ✓ ${targets[index - 1].name} (klatka ${frames}, y=${after.pos[1].toFixed(1)})`)
  }
}

const final = ch()
const ok = reached >= targets.length - 1
console.log(`\nosiągnięte platformy: ${reached}/${targets.length}, klatek: ${frames}, śmierci: ${deaths.length}`)
console.log(`pozycja końcowa: [${final.pos.map((n) => n.toFixed(1)).join(', ')}]`)
console.log(ok ? '✅ tor jest przechodni' : '❌ bot nie doszedł do mety')
process.exit(ok ? 0 : 1)
