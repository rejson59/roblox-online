/**
 * main.ts — punkt wejścia aplikacji: boot, pętla gry, spinanie warstw.
 *
 * Architektura (taka jak w Robloxie, tylko w jednej karcie):
 *   serwer (świat + Luau + fizyka) ──replikacja──▶ klient (świat-obraz + Luau + renderer)
 */
import './ui/styles.css'
import { Camera } from './engine/camera'
import { GameClient, GameServer, type NetMessage } from './engine/game'
import { Input } from './engine/input'
import { LUA_SOURCES } from './engine/luaSources'
import { Renderer } from './engine/renderer'
import { World } from './engine/world'
import { buildPlace } from './game/place'
import { GAME_SCRIPTS } from './game/placeScripts'
import { GuiOverlay } from './ui/guiOverlay'
import { Hud } from './ui/hud'
import { Studio } from './ui/studio'

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T

const app = $('#app')
const canvas = $<HTMLCanvasElement>('#viewport')
const loader = $('#loader')
const loaderText = $('#loader-text')
const startBtn = $<HTMLButtonElement>('#start-btn')
const nameInput = $<HTMLInputElement>('#player-name')

const PLAYER_KEY = 'roblox-online:name'
nameInput.value = localStorage.getItem(PLAYER_KEY) || 'Gracz' + Math.floor(Math.random() * 900 + 100)

let server: GameServer | null = null
let client: GameClient | null = null
let renderer: Renderer | null = null
let camera = new Camera()
let input: Input | null = null
let hud: Hud | null = null
let studio: Studio | null = null
let gui: GuiOverlay | null = null
let running = false
let booting = false
let frames = 0
let fps = 60
let fpsTimer = performance.now()

function log(level: 'info' | 'warn' | 'error' | 'print', text: string) {
  if (level === 'error') console.error('[Luau]', text)
  studio?.log(level, text)
}

function setLoader(text: string) {
  if (loaderText) loaderText.textContent = text
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err)
  console.error(err)
  booting = false
  startBtn.disabled = false
  loader.classList.remove('hidden')
  loaderText.classList.add('error')
  setLoader('Nie udało się uruchomić gry: ' + msg)
}

async function boot(playerName: string) {
  if (booting) return
  if (typeof WebGL2RenderingContext === 'undefined') {
    return fail(new Error('ta przeglądarka nie obsługuje WebGL2'))
  }
  booting = true
  startBtn.disabled = true
  setLoader('Uruchamianie serwera…')
  try {
    await bootInner(playerName)
  } catch (err) {
    fail(err)
  }
}

async function bootInner(playerName: string) {
  await new Promise((r) => setTimeout(r, 30))

  server = new GameServer(log, LUA_SOURCES)
  buildPlace(server.world, server.serviceIds, GAME_SCRIPTS, { onProgress: setLoader })
  setLoader('Ładowanie skryptów Luau (serwer)…')
  await server.start(playerName)
  setLoader('Tworzenie klienta i replikacja świata…')
  await new Promise((r) => setTimeout(r, 30))
  client = new GameClient(log, LUA_SOURCES, () => 0)
  await client.start(server.snapshot() as NetMessage & { t: 'snapshot' }, playerName)

  camera = new Camera()
  input = new Input(canvas)
  input.onKey((name, down) => {
    if (!down) return
    if (name === 'F2' || name === 'Tab') studio?.toggle()
    if (name === 'R') respawn()
    if (name === 'M') $('.rbx-chat')?.classList.toggle('active')
  })

  hud = new Hud(app, 'Obby w Krakowie', (text) => {
    if (!server || !client) return
    const pid = client.localPlayerId
    const name = String(server.world.getProp(pid, 'Name') ?? 'Gracz')
    hud?.addChat({ author: name, text, color: '#7ee787' })
    server.onChat(pid, text)
  })
  hud.addChat({ author: 'System', text: 'Witaj w Obby w Krakowie! Zbieraj monety i dobiegnij do mety.', color: '#ffd166' })
  hud.addChat({ author: 'System', text: 'WSAD — ruch, SPACJA — skok, mysz — kamera, kółko — zoom, F2 — Studio, R — respawn', color: '#8ab4f8' })

  studio = new Studio(app, () => server!.world, () => restart(), (id) => studio?.showProps(id))
  studio.refresh()
  gui = new GuiOverlay(app)

  renderer = new Renderer(canvas)
  running = true
  booting = false
  loader.classList.add('hidden')
  requestAnimationFrame(frame)
}

function respawn() {
  if (!server || !client) return
  server.respawnCharacter(client.localPlayerId)
}

function restart() {
  running = false
  localStorage.setItem(PLAYER_KEY, nameInput.value || 'Gracz')
  location.reload()
}

function characterFocus(): [number, number, number] {
  if (!client) return [0, 6, 0]
  const model = client.characterModel()
  if (model) {
    for (const child of client.world.getChildren(model)) {
      const inst = client.world.get(child)
      if (inst?.props.Name === 'Torso') {
        const p = client.world.position(child)
        return [p.x, p.y + 1.2, p.z]
      }
    }
  }
  return [0, 6, 0]
}

let lastTime = performance.now()
let hudTimer = 0
let busy = false

async function frame(now: number) {
  requestAnimationFrame(frame)
  if (!running || !server || !client || !renderer || !input || busy) return
  busy = true
  try {
    const rawDt = (now - lastTime) / 1000
    lastTime = now
    const dt = Math.max(0.0005, Math.min(rawDt, 0.05))
    const gameTime = now / 1000

    frames++
    if (now - fpsTimer > 500) {
      fps = Math.round((frames * 1000) / (now - fpsTimer))
      frames = 0
      fpsTimer = now
    }

    // 1. wejście gracza + kamera
    const axis = input.moveAxis()
    const mouse = input.consumeMouseDelta()
    const wheel = input.consumeWheel()
    const focusBefore = characterFocus()
    camera.update(dt, focusBefore, mouse.dx, mouse.dy, wheel)
    const charInput = {
      moveX: axis.x,
      moveZ: axis.z,
      jump: input.isDown('Space'),
      cameraYaw: camera.yaw,
    }

    // 2. serwer: skrypty + fizyka + postacie
    await server.tick(dt, gameTime, charInput)

    // 3. replikacja serwer → klient
    const messages = server.drainForClient()
    client.apply(messages)
    for (const m of messages) {
      if (m.t === 'chat') {
        const name = String(server.world.getProp(m.playerId, 'Name') ?? 'Gracz')
        hud?.addChat({ author: name, text: m.text, color: '#7ee787' })
      }
    }

    // 4. klient: skrypty lokalne + eventy do serwera
    await client.tick(dt, gameTime)
    for (const ev of client.drainToServer()) {
      server.handleRemote(ev.id, 'server', client.localPlayerId, ev.args)
    }

    // 5. kamera i render
    const focus = characterFocus()
    camera.update(0, focus, 0, 0, 0)
    const camInst = server.serviceIds.CurrentCamera
    server.world.setProp(camInst, 'CFrame', camera.cframe())
    renderer.render(client.world, camera, focus)

    // 6. UI (HUD odświeżamy 4×/s — przebudowa listy graczy co klatkę to zbędny koszt)
    gui?.update(client.world)
    if (now - hudTimer > 250) {
      hudTimer = now
      hud?.update(server.world, client.localPlayerId, fps, renderer.frameStats.parts)
    }
    if (studio?.isOpen() && frames % 30 === 0) studio.refresh()


  } catch (err) {
    console.error(err)
    hud?.showToast('Błąd silnika: ' + String(err), 'error')
  } finally {
    busy = false
  }
}

$('#docs-link')?.addEventListener('click', () => $('#about-panel').classList.remove('is-hidden'))
$('#about-close')?.addEventListener('click', () => $('#about-panel').classList.add('is-hidden'))

startBtn.addEventListener('click', () => {
  const name = (nameInput.value || 'Gracz').slice(0, 20)
  localStorage.setItem(PLAYER_KEY, name)
  void boot(name)
})

window.addEventListener('resize', () => renderer?.resize())

// start od razu po kliknięciu lub Enterze
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startBtn.click()
})

// Diagnostyka dostępna z konsoli przeglądarki
;(window as any).roblox = {
  get server() { return server },
  get client() { return client },
  get world(): World | null { return server?.world ?? null },
}
