# ROBLOX Online — Obby w Krakowie

**Grywalna gra w przeglądarce z prawdziwym Luau (WASM), drzewem instancji w stylu Robloxa, fizyką, cieniami i mini‑Studiem pod klawiszem F2.**

To nie jest atrapa ani makieta: skrypty gry to zwykły kod Luau (`Script` / `LocalScript` / `ModuleScript`), który uruchamia interpreter Luau skompilowany do WebAssembly, a każda część (Part) jest instancją w hierarchii `game.Workspace` — tak jak w Robloxie.

```
npm install
npm run dev      # http://localhost:5173
npm test         # 4 zestawy testów silnika (bez przeglądarki)
npm run build    # produkcyjny build do dist/
```

---

## ⚠️ To nie jest klient Robloxa — jak zagrać w oryginał

Ten projekt jest **edukacyjnym silnikiem w stylu Robloxa**, nie klientem Roblox Corporation. Nie loguje do prawdziwego konta i nie łączy się z serwerami Robloxa — i nie da się tego zrobić legalnie z poziomu aplikacji webowej (szczegóły i źródła: **[docs/prawdziwy-roblox.md](docs/prawdziwy-roblox.md)**).

Legalne drogi do oryginalnych gier:

| Kiedy | Jak |
|---|---|
| **Teraz** (2 min) | oficjalny klient: [roblox.com/download](https://www.roblox.com/download), Google Play, App Store |
| **Teraz, w karcie** | strumień prawdziwego Windowsa do przeglądarki (Guacamole / Sunshine / cloud PC) — działa, ale to remote desktop |
| **Do końca 2026** | oficjalny web player Robloxa: Chrome, bez instalacji, z zalogowaniem ([zapowiedź RDC 2026](https://about.roblox.com/newsroom/2026/09/rdc-2026-the-world-needs-more-play)) |

W grze ten sam ekran otworzysz klawiszem **F1** (albo przyciskiem „★ zagraj w prawdziwego Robloxa” w menu startowym).

**Czego nie robimy:** nie zbieramy haseł, kodów 2FA ani ciasteczek `.ROBLOSECURITY`. Ciasteczko daje dostęp do strony www, ale nie do gry — potrzebny jest zamknięty silnik i szyfrowany protokół; w praktyce wklejanie sesji kończy się utratą konta.

---

## ⚠️ Uczciwa notatka o APK Robloxa

Pierwotne zadanie brzmiało: *pobrać oficjalne APK Robloxa, rozpakować je i na tej podstawie odtworzyć klienta*.

**W tym środowisku nie było to możliwe** — wszystkie źródła APK (APKPure, APKMirror, CDN APKPure) zwracały `HTTP 000` (ruch wychodzący zablokowany). Nie pobrałem więc APK i **nie analizowałem jego wnętrza**; nie twierdzę inaczej.

Zamiast tego użyłem publicznych, otwartych źródeł, które opisują dokładnie te same mechanizmy:

| Źródło | Co z niego wzięto |
|---|---|
| [Luau](https://github.com/luau-lang/luau) (oficjalny język Robloxa), paczka `luau-web` | prawdziwy interpreter Luau w WASM (te same semantyki: `task.wait`, `Instance`, `Enum`, `CFrame`, `UDim2`) |
| [rbx-dom `docs/xml.md`](https://github.com/rojo-rbx/rbx-dom/blob/master/docs/xml.md) | specyfikacja formatu miejsc `.rbxlx` (XML v4): typy właściwości, `CoordinateFrame`, `Color3uint8`, `ProtectedString` dla `Source`, `Ref` |
| [rbx-dom `docs/binary.md`](https://github.com/rojo-rbx/rbx-dom/blob/master/docs/binary.md) | struktura binarnego `.rbxl`: nagłówek `"<roblox!"`, chunki `META/SSTR/INST/PROP/PRNT/SIGN/END` |
| publiczna dokumentacja API Robloxa | nazwy klas, właściwości, sygnałów i usług odtworzonych w silniku |

Szczegółowe porównanie „jak działa prawdziwy klient" i „co z tego odtworzyliśmy" jest w **[docs/analiza-roblox.md](docs/analiza-roblox.md)** — z wyraźnym rozdzieleniem faktów ze specyfikacji od mojej rekonstrukcji.

---

## W co się gra

**Obby w Krakowie** — tor przeszkód nad miastem:

* lobby z bramą, ławkami i dwoma NPC,
* 5 schodków i **14 platform** o rosnącej wysokości, z odstępami do przeskoczenia,
* **10 monet** (+10 punktów, wracają po 4 sekundach),
* **checkpointy** co 4 platformy (zapamiętują miejsce odrodzenia),
* **killbrick** (pas lawy na 7. platformie),
* **ruchoma platforma** (TweenService, w górę i w dół),
* meta z gwiazdami — +1 „Wygrane",
* leaderstats: **Punkty / Wygrane / Śmierci**, lista graczy, czat.

### Sterowanie

| Klawisz | Akcja |
|---|---|
| `W A S D` / strzałki | ruch (względem kamery) |
| `Spacja` | skok (JumpPower 50, grawitacja 196,2 studa/s²) |
| ruch myszą z wciśniętym LPM | obrót kamery |
| kółko myszy | zoom (do pierwszej osoby) |
| `F2` lub `Tab` | mini‑Studio: Explorer, właściwości, edytor `Source`, Output |
| `R` | respawn |
| `M` | pokaż/ukryj czat |

---

## Architektura

Silnik jest podzielony dokładnie tak, jak prawdziwy Roblox: **serwer** (autorytatywny) i **klient** (to, co widzi gracz), połączone replikacją. W przeglądarce oba działają w jednej karcie, ale mają **osobne instancje maszyny Luau i osobne drzewa instancji**.

```
                    ┌──────────────────────────────────────────────┐
   Twój kod Luau    │  Script  (ServerScriptService, Workspace)     │
   (serwer)         │  ModuleScript (require)                      │
                    └───────────────┬──────────────────────────────┘
                                    │  host.* (mostek JS ⇄ Luau)
                    ┌───────────────▼──────────────────────────────┐
                    │  World (drzewo instancji)  +  Physics         │  ← serwer
                    │  grawitacja, AABB, Touched, Raycast, Humanoid │
                    └───────────────┬──────────────────────────────┘
                                    │  snapshot → created/prop/destroyed
                                    │  RemoteEvent / czat
                    ┌───────────────▼──────────────────────────────┐
                    │  World‑kopia  +  LocalScript + PlayerGui      │  ← klient
                    │  kamera, wejście, ScreGui → DOM               │
                    └───────────────┬──────────────────────────────┘
                                    │
                              Renderer (WebGL2)
```

### Kluczowe moduły

| Plik | Rola |
|---|---|
| `src/engine/world.ts` | drzewo instancji: `Instance.new`, `Parent`, `FindFirstChild`, `Clone`, właściwości, `Changed` |
| `src/engine/bridge.ts` | mostek JS ⇄ Luau — **serce projektu**; mapuje właściwości, sygnały i typy danych |
| `src/engine/luaRuntime.ts` | uruchamianie `Script`/`LocalScript`/`ModuleScript`, `require`, tick VM |
| `src/engine/lua/runtime.lua` | implementacja API Robloxa *w Luau*: metatabla instancji, `Vector3`, `CFrame`, `UDim2`, `Color3`, `Enum`, sygnały, `task.*`, tweeny |
| `src/engine/lua/services.lua` | usługi: `Players`, `RunService`, `TweenService`, `Debris`, `Lighting`, `workspace:Raycast`, `RemoteEvent` |
| `src/engine/lua/exports.lua` | globalne nazwy zgodne z Robloxem (`game`, `workspace`, `Instance`, `Enum`, `Vector3`, …) |
| `src/engine/physics.ts` | grawitacja 196,2, kolizje AABB, wchodzenie po schodach, `Touched` |
| `src/engine/character.ts` | rig R6 (6 części), Humanoid: `WalkSpeed`, `JumpPower`, animacja chodu |
| `src/engine/game.ts` | `GameServer` / `GameClient`: replikacja, `RemoteEvent`, leaderstats, respawn |
| `src/engine/renderer.ts` | renderer WebGL2: cienie (2048², 3×3 PCF), mgła, niebo, materiał Neon |
| `src/ui/*` | HUD, czat, lista graczy, `ScreenGui` → DOM, mini‑Studio |
| `src/game/place.ts` | „miejsce" (odpowiednik `.rbxl`): mapa, NPC, skrypty |
| `src/game/scripts/**` | prawdziwe skrypty gry w Luau |

### Model skryptów

```lua
-- ServerScriptService/GameService
local Players = game:GetService("Players")

Players.PlayerAdded:Connect(function(player)
    local stats = Instance.new("Folder")
    stats.Name = "leaderstats"
    stats.Parent = player

    local points = Instance.new("IntValue")
    points.Name = "Punkty"
    points.Value = 0
    points.Parent = stats
end)
```

```lua
-- Workspace/Coins/CoinService
coin.Touched:Connect(function(hit)
    local humanoid = hit.Parent:FindFirstChild("Humanoid")
    if not humanoid then return end
    ...
end)
```

Skrypty z `src/game/scripts/` są **prawdziwym Luau**, a nie uproszczonym pseudo‑kodem. Te same pliki działają w Roblox Studio (poza `notify:FireClient`, które jest naszym `RemoteEvent`).

### Mostek wartości (JS ⇄ Luau)

Najważniejsza i najtrudniejsza część: `luau-web` **nie przenosi tablic JS do Luau** (tablica JS trafiała do Luau jako `number` — to objawiało się tym, że każdy `Vector3` był `(0,0,0)`).

Rozwiązanie: przed przekroczeniem granicy wartości są „pakowane" w obiekty z nazwanymi polami:

| Typ | Postać w mostku |
|---|---|
| `Vector3` | `{ x, y, z }` |
| `Vector2` | `{ x, y }` |
| `UDim2` | `{ a, b, c, d }` |
| `CFrame` | `{ x, y, z, r00…r22 }` (wiersze macierzy, jak w XML v4) |
| instancja | `'@<id>'` (referencja tekstowa) |
| tablica Lua | tablica JS (tylko w stronę Lua → JS) |

---

## Co z API Robloxa działa

**Instancje:** `Instance.new`, `Clone`, `Destroy`, `Parent`, `Name`, `FindFirstChild`, `FindFirstChildOfClass`, `FindFirstAncestor*`, `GetChildren`, `GetDescendants`, `IsA`, `GetFullName`, `GetAttribute`/`SetAttribute`, `WaitForChild`.

**Sygnały:** `Touched`, `TouchEnded`, `ChildAdded`, `ChildRemoved`, `DescendantAdded`, `Changed`, `GetPropertyChangedSignal`, `AttributeChanged`, `Humanoid.Died`, `PlayerAdded`, `PlayerRemoving`, `CharacterAdded`, `Heartbeat`, `Stepped`, `RenderStepped`, `BindableEvent`, `RemoteEvent` (`FireServer`/`FireClient`/`OnServerEvent`/`OnClientEvent`).

**Typy:** `Vector3`, `Vector2`, `CFrame` (z `Angles`, `lookAt`, `*`, `Lerp`, `ToEulerAnglesXYZ`, `LookVector`), `Color3`, `UDim2`, `UDim`, `BrickColor`, `TweenInfo`, `Enum` (m.in. `Material`, `EasingStyle`, `KeyCode`, `Font`), `NumberRange`, `NumberSequence`, `ColorSequence`, `Ray`, `Random`, `DateTime`.

**Usługi:** `Players`, `RunService`, `TweenService`, `Debris`, `Lighting`, `ReplicatedStorage`, `ServerScriptService`, `ServerStorage`, `StarterGui`, `StarterPlayer`, `SoundService`, `ContentProvider`, `Chat`.

**Fizyka i zapytania:** grawitacja, kolizje AABB ze wchodzeniem po schodach, `workspace:Raycast`, `GetPartBoundsInBox`, `Touched`/`TouchEnded` dla części i postaci, `Humanoid.Health`, `WalkSpeed`, `JumpPower`.

**Grafika:** `Part` (Block/Ball/Cylinder/Wedge), `Color`, `Material` (Neon, Glass, Metal, …), `Transparency`, `Anchored`, `CanCollide`, `CanTouch`, `CanQuery`, `CFrame`, `Size`, `Visible`, `ScreenGui`, `Frame`, `TextLabel`, `TextButton`, `ImageLabel`, `ScrollingFrame`, `UIPadding`, `UICorner` (częściowo), `TextScaled`.

---

## Znane ograniczenia (świadome decyzje)

1. **Kolizje są AABB** — obrócone części są aproksymowane pudłem osiowo wyrównanym. Prawdziwy Roblox używa pełnego solvera OBB/PGS. Dla obby i platform wystarcza, ale `Part` obrócona o 45° koliduje „po prostokącie".
2. **Brak assetów z serwerów Robloxa** — zero zewnętrznych CDN‑ów. Meshe, dźwięki i obrazki z `rbxassetid://` nie są pobierane; `Sound` jest zaślepką (gra generuje tylko dźwięki UI).
3. **Jedna karta = jeden gracz** — serwer i klient żyją w tym samym oknie, więc „multiplayer" jest lokalny. Architektura (replikacja, snapshot, `RemoteEvent`) jest jednak prawdziwa i dałaby się rozdzielić na WebSocket.
4. **Uproszczona animacja** — rig R6 ma animację chodu (ręce/nogi), ale bez `Animator` i `AnimationTrack` z Robloxa.
5. **Brak `Terrain`, `MeshPart`, `Texture`, `SurfaceGui`, `BillboardGui`** — klasy GUI obsługiwane to te używane przez grę.
6. **Sterowanie klawiaturą i myszą** — brak wirtualnego joysticka dla telefonów (interfejs jest responsywny, ale gra wymaga WASD + myszy).
7. **Brak plików `.rbxl`/`.rbxlx`** — miejsce jest budowane w kodzie (`src/game/place.ts`). Parser formatu nie został jeszcze podłączony, choć typy właściwości są zgodne ze specyfikacją.

---

## Testy

Testy nie potrzebują przeglądarki — uruchamiają prawdziwą maszynę Luau w Node:

```
npm test
```

| Test | Co sprawdza |
|---|---|
| `scripts/math.test.ts` | macierze kamery i `CFrame` — punkt przed kamerą trafia w środek ekranu dla dowolnego obrotu, rotacja ortonormalna (`det = +1`) |
| `scripts/smoke.ts` | API Robloxa: `Instance.new`, właściwości, `CFrame`, `Enum`, sygnały, `task.wait`, `Heartbeat`, `Raycast`, `TweenService`, `Clone` |
| `scripts/obby.test.ts` | **czy tor da się przejść** — bot przechodzi wszystkie 15 platform, raportuje śmierci i czas |
| `scripts/simulate.ts` | pełny duet serwer+klient: ruch postaci, `ScreenGui` z `LocalScript`, monety, `RemoteEvent`, zero błędów Luau |

Stan na dziś: **wszystkie zielone**.

---

## Struktura repozytorium

```
src/
  engine/          silnik: świat, mostek, Luau, fizyka, renderer, kamera, wejście
    lua/           API Robloxa napisane w Luau (runtime, services, exports)
  game/
    place.ts       mapa (odpowiednik pliku .rbxl)
    scripts/       prawdziwe skrypty gry w Luau (serwer + klient)
  ui/              HUD, czat, ScreenGui→DOM, mini-Studio, style
scripts/           testy silnika (Node, bez przeglądarki)
docs/              analiza klienta Robloxa i formatów plików
```

## Stos

`luau-web` (oficjalne Luau w WASM) · TypeScript · własny renderer WebGL2 (bez three.js) · Vite. Zero zależności runtime poza interpreterem Luau.

## Zastrzeżenie prawne

Projekt edukacyjny, nieoficjalny. Nie jest powiązany z Roblox Corporation. „Roblox", „Luau" i nazwy API należą do ich właścicieli. Wszystkie assety graficzne (części, GUI, mapa) są generowane proceduralnie w kodzie.
