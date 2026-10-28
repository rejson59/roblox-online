/**
 * smoke.ts — test silnika bez przeglądarki.
 *
 * Buduje świat, uruchamia VM Luau na serwerze i wykonuje skrypt testowy,
 * który sprawdza najważniejsze elementy API Robloxa. Użycie:
 *   npm run smoke
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { World } from '../src/engine/world'
import { LuaRuntime, buildServiceTree } from '../src/engine/luaRuntime'
import { raycastWorld, aabbQueryWorld } from '../src/engine/query'

const here = dirname(fileURLToPath(import.meta.url))
const lua = (name: string) => readFileSync(join(here, '../src/engine/lua', name), 'utf8')

const logs: string[] = []
const log = (level: string, text: string) => {
  logs.push(`[${level}] ${text}`)
  console.log(`[${level}] ${text}`)
}

async function main() {
  const world = new World()
  const { ids } = buildServiceTree(world)
  const rt = new LuaRuntime({
    world,
    role: 'Server',
    log: log as any,
    onRemote: () => {},
    onRemoteInvoke: () => null,
    onBindableFire: () => {},
    onBindableInvoke: () => null,
    onChat: () => {},
    onHumanoidDied: () => {},
    getKeyDown: () => false,
    getMouse: () => ({ x: 0, y: 0 }),
    raycast: (ox, oy, oz, dx, dy, dz, ig) => raycastWorld(world, ox, oy, oz, dx, dy, dz, ig),
    aabbQuery: (x, y, z, sx, sy, sz) => aabbQueryWorld(world, x, y, z, sx, sy, sz),
    playerName: 'Tester',
  }, ids, { runtime: lua('runtime.lua'), services: lua('services.lua'), exports: lua('exports.lua') })

  console.log('── ładowanie VM ──')
  await rt.init()
  console.log('VM gotowa')

  // Skrypt testowy: tworzy części, łączy sygnały, używa task.wait i Heartbeat
  const testScript = `
    local folder = Instance.new("Folder")
    folder.Name = "TestFolder"
    folder.Parent = workspace

    local part = Instance.new("Part")
    part.Name = "TestPart"
    part.Size = Vector3.new(10, 1, 10)
    part.Position = Vector3.new(0, 5, 0)
    part.Color = Color3.fromRGB(255, 0, 0)
    part.Anchored = true
    part.Parent = folder

    print("part position:", tostring(part.Position))
    print("part size:", tostring(part.Size))
    print("part color:", tostring(part.Color))
    print("fullname:", part:GetFullName())
    print("children:", #folder:GetChildren())

    -- CFrame
    local cf = CFrame.new(1, 2, 3) * CFrame.Angles(0, math.pi / 2, 0)
    local v = cf * Vector3.new(1, 0, 0)
    print("CFrame*Vector3:", string.format("%.3f, %.3f, %.3f", v.X, v.Y, v.Z))
    print("lookVector:", tostring(cf.LookVector))

    -- Enum + właściwości enumowe
    part.Material = Enum.Material.Neon
    print("material:", tostring(part.Material), part.Material.Value)

    -- sygnał własny
    local changed = 0
    part:GetPropertyChangedSignal("Size"):Connect(function() changed += 1 end)
    part.Size = Vector3.new(2, 2, 2)
    part.Size = Vector3.new(3, 3, 3)
    print("changed count:", changed)

    -- task.wait działa (skrypt się wznawia)
    task.wait(0.05)
    print("po task.wait, czas:", string.format("%.2f", time()))

    -- Heartbeat
    local beats = 0
    local conn = game:GetService("RunService").Heartbeat:Connect(function(dt) beats += 1 end)
    task.wait(0.2)
    print("heartbeat beats:", beats)
    conn:Disconnect()

    -- Raycast przez mostek (przed tweenem, bo tween ustawia przezroczystość)
    local result = workspace:Raycast(Vector3.new(0, 100, 0), Vector3.new(0, -1, 0))
    print("raycast:", result and result.Instance.Name or "brak", result and string.format("%.2f", result.Distance) or "")

    -- TweenService
    local TS = game:GetService("TweenService")
    local tween = TS:Create(part, TweenInfo.new(0.1), { Transparency = 1 })
    tween:Play()
    task.wait(0.2)
    print("po tween transparency:", part.Transparency)

    -- FindFirstChild / WaitForChild
    print("find:", tostring(workspace:FindFirstChild("TestFolder")))
    -- Clone
    part.Name = "Oryginal"
    local copy = part:Clone()
    copy.Name = "Kopia"
    copy.Parent = folder
    print("po clone:", #folder:GetChildren())

    print("TEST OK")
  `

  const folder = world.create('Folder', { Name: 'Scripts' }, ids.ServerScriptService)
  const scriptInst = world.create('Script', { Name: 'Test', Source: testScript }, folder.id)

  console.log('── uruchamianie skryptu ──')
  await rt.runScript(scriptInst.id)

  // 30 klatek symulacji (0.5 s)
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 8))
    await rt.tick(0.05, i * 0.05)
  }

  console.log('── stan świata ──')
  for (const inst of world.instances.values()) {
    if (inst.className === 'Part') {
      console.log(`Part ${world.fullName(inst.id)} pos=${JSON.stringify(inst.props.CFrame)} transp=${inst.props.Transparency}`)
    }
  }
  const ok = logs.some((l) => l.includes('TEST OK'))
  console.log(ok ? '\n✅ SMOKE TEST OK' : '\n❌ SMOKE TEST NIE ZALICZONY')
  const errors = logs.filter((l) => l.startsWith('[error]'))
  if (errors.length) {
    console.log('Błędy:')
    for (const e of errors) console.log('  ' + e)
  }
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('KRYTYCZNY BŁĄD:', e)
  process.exit(1)
})
