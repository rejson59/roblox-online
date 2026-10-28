# Jak działa klient Robloxa — analiza i wnioski

Ten dokument zbiera to, co udało się ustalić o prawdziwym kliencie Robloxa, oraz pokazuje, **co z tej wiedzy weszło do naszego silnika**, a co zostało świadomie pominięte.

---

## 1. Metoda — co udało się, a co nie

Zadanie zakładało analizę oficjalnego APK Robloxa. Przebieg próby:

| Krok | Wynik |
|---|---|
| `curl` na APKPure / APKMirror / `d.apkpure.com` | `HTTP 000` — ruch wychodzący do tych hostów jest zablokowany w tym środowisku |
| pobranie z Google Play (wymaga zalogowanego konta i integracji Play) | niewykonalne z sandboxa |
| dostępne hosty (`github.com`, `registry.npmjs.org`, `pypi.org`) | nie zawierają APK Robloxa |

**Wniosek: APK nie został pobrany ani rozpakowany.** Wszystko poniżej pochodzi z publicznej, otwartej dokumentacji oraz z publicznie znanej architektury, a nie z dekompilacji. Tam, gdzie coś jest rekonstrukcją lub wnioskiem, jest to zaznaczone.

Źródła, które udało się faktycznie otworzyć i wykorzystać:

* [`rojo-rbx/rbx-dom` — `docs/xml.md`](https://github.com/rojo-rbx/rbx-dom/blob/master/docs/xml.md) — pełna specyfikacja formatu miejsc `.rbxlx` (XML v4),
* [`rojo-rbx/rbx-dom` — `docs/binary.md`](https://github.com/rojo-rbx/rbx-dom/blob/master/docs/binary.md) — format binarny `.rbxl`,
* oficjalne [Luau](https://github.com/luau-lang/luau) (repo Robloxa) — język skryptów, użyty przez nas dosłownie (kompilacja do WASM),
* publiczna dokumentacja API Robloxa (klasy, usługi, sygnały, właściwości).

---

## 2. Czym jest APK Robloxa (struktura pakietu)

> To część oparta na publicznie znanej strukturze aplikacji Androidowych Robloxa — **niezweryfikowana tutaj**, bo pakietu nie udało się pobrać.

Typowy pakiet `com.roblox.client` to ZIP podpisany kluczem Google Play, zawierający:

```
AndroidManifest.xml        uprawnienia, aktywności, deep-linki (roblox://)
classes*.dex               kod Javy/Kotlina: warstwa UI Androida, logowanie,
                           integracja z Google Play, powiadomienia
lib/arm64-v8a/libroblox.so ~100 MB natywnego kodu: silnik gry (C++),
                           Luau VM, fizyka, renderer (OpenGL ES / Vulkan),
                           sieć, system assetów
lib/armeabi-v7a/…          warianty 32-bit
assets/                    czcionki, shadery, zasoby startowe, konfiguracja
res/                       ikony, layouty ekranów logowania
```

Najważniejsze: **cała gra żyje w `libroblox.so`**. Warstwa Androida to głównie „skorupa" do logowania i wejścia do doświadczenia. Z tego powodu analiza APK bez dekompilacji `.so` (IDA/Ghidra, miliony linii) niewiele by dała — realną wiedzę o silniku daje dokumentacja formatów i API, a nie sama zawartość pakietu.

Dodatkowy fakt istotny dla klonowania: **każde doświadczenie jest pobierane z serwerów Robloxa jako osobny plik miejsca** (`.rbxl`, rzadziej `.rbxlx`) plus assety po `rbxassetid://`. Klient sam z siebie nie zawiera gier.

---

## 3. Architektura prawdziwego klienta (rekonstrukcja)

Model, który Roblox opisuje publicznie i który widać w API:

```
        ┌──────────────────────── serwer (jedna instancja na serwer gry) ─┐
        │  DataModel: game                                               │
        │   ├─ Workspace      ← części, modele, fizyka                   │
        │   ├─ Players        ← Player + leaderstats + PlayerGui          │
        │   ├─ ServerScriptService  ← Script (tylko serwer)              │
        │   ├─ ReplicatedStorage    ← RemoteEvent, ModuleScript          │
        │   ├─ Lighting / SoundService / …                               │
        │                                                                │
        │  Luau VM (skrypty serwera)  +  solver fizyki  +  replikacja     │
        └───────────────┬────────────────────────────────────────────────┘
                        │  replikacja: instancje + właściwości + eventy
        ┌───────────────▼────────────────────────────────────────────────┐
        │  klient: kopia DataModel + LocalScript + PlayerGui             │
        │  Luau VM (skrypty klienta) + kamera + wejście + renderer       │
        └────────────────────────────────────────────────────────────────┘
```

Kluczowe cechy, które zdecydowałem się odtworzyć:

1. **Wszystko jest instancją** w drzewie `game`, z `Parent`, `Name`, `ClassName` i właściwościami. Nie ma „obiektów gry" obok drzewa.
2. **Serwer jest autorytatywny** — klient wysyła intencje (`RemoteEvent`), serwer zmienia świat i replikuje wynik.
3. **Skrypty to Luau**, uruchamiane równolegle, z własnym schedulerem (`task.wait`, `task.spawn`, `task.delay`), a nie pojedynczą pętlą.
4. **Sygnały** (`Touched`, `Changed`, `ChildAdded`, `Heartbeat`) są podstawowym mechanizmem komunikacji między skryptami a silnikiem.
5. **Fizyka i renderowanie są rozdzielone** — serwer liczy fizykę, klient rysuje; `RunService.RenderStepped` działa tylko na kliencie.
6. **Grawitacja 196,2 studa/s²** i domyślne `WalkSpeed = 16`, `JumpPower = 50` — wartości z Robloxa, sprawdzalne w każdej grze.

### Czego nie odtwarzaliśmy

* **Hyperion / Byfron** (anty‑cheat), **RakNet** (protokół sieciowy, szyfrowanie, kompresja) — poza zakresem,
* **streaming assety** (meshe, tekstury, dźwięki z `rbxassetid://`),
* **Animator / R15 / IK**, **Terrain** (voxel), **CSG**,
* **Luau bytecode** — u nas skrypty są kompilowane ze źródła w czasie startu (tak jak „Source" w Studio, nie jak zaszyfrowany bytecode w produkcji).

---

## 4. Format miejsca `.rbxlx` (XML v4) — zweryfikowany

Specyfikacja z `rbx-dom/docs/xml.md` (otwarta, opisuje to samo, co zapisuje Roblox Studio):

```xml
<roblox version="4">
  <Meta name="ExplicitAutoJoints">true</Meta>
  <External>null</External>
  <Item class="Workspace" referent="RBX0">
    <Properties>
      <string name="Name">Workspace</string>
      <CoordinateFrame name="CurrentCamera">
        <X>0</X><Y>10</Y><Z>20</Z>
        <R00>1</R00> … <R22>1</R22>
      </CoordinateFrame>
    </Properties>
    <Item class="Part" referent="RBX1"> … </Item>
  </Item>
</roblox>
```

Najważniejsze typy właściwości i ich reprezentacja:

| Typ XML | Zapis | Uwagi |
|---|---|---|
| `bool`, `int`, `int64`, `float`, `double`, `string`, `token` | tekst | `token` = enum (indeks liczbowy) |
| `Color3` | `<R><G><B>` 0–1 | float |
| `Color3uint8` | liczba `0xFFRRGGBB` | kolor części (`Part.Color`) |
| `CoordinateFrame` | `X Y Z` + `R00…R22` | **macierz 3×3 w wierszach** |
| `Vector3`, `Vector2` | `X Y Z` | studs |
| `UDim`, `UDim2` | `S O` | Scale/Offset, GUI |
| `Content` | `rbxassetid://123` | referencja do assetu |
| `ProtectedString` | treść skryptu | `Script.Source` |
| `Ref` | `RBX1` | referencja do innej instancji |
| `BinaryString`, `SharedString` | base64 / indeks | duże dane binarne |
| `Faces`, `Axes`, `PhysicalProperties`, `NumberSequence`, `ColorSequence`, `NumberRange`, `Rect2D`, `Ray`, `Font` | struktury złożone | |

**Wniosek dla naszego silnika:** układ `CFrame` przyjąłem dokładnie taki jak w XML — 12 liczb, `[x, y, z, R00, R01, R02, R10, R11, R12, R20, R21, R22]`, wiersze macierzy obrotu. Dzięki temu konwersja do/z przyszłego parsera `.rbxlx` będzie 1:1 (bez transpozycji), a `LookVector = (-R02, -R12, -R22)` — tak jak w Luau.

> Ten szczegół okazał się realnym źródłem błędu: macierz widoku kamery była początkowo transponowana (obraz „skręcał" przy obrocie). Test `scripts/math.test.ts` sprawdza teraz, że punkt przed kamerą trafia w środek ekranu dla dowolnego `yaw`.

---

## 5. Format binarny `.rbxl` — zweryfikowany ze specyfikacji

Nagłówek pliku:

```
"<roblox!" 89 FF 0D 0A 1A 0A     sygnatura
uint16  version (0)               wersja formatu
uint32  classCount                liczba klas
uint32  instanceCount             liczba instancji
8 bajtów  zarezerwowane
```

potem **chunki** (część może być skompresowana LZ4/Zstandard, wtedy ma flagę i rozmiar nieskompresowany):

| Chunk | Zawartość |
|---|---|
| `META` | pary klucz/wartość (np. `ExplicitAutoJoints`) |
| `SSTR` | `SharedString` — duże bufory binarne |
| `INST` | definicje klas: nazwa, referencje, typy właściwości |
| `PROP` | wartości właściwości instancji (kolumnowo, wg typów z `INST`) |
| `PRNT` | relacje rodzic→dziecko (drzewo instancji) |
| `SIGN` | sygnatury, kończy plik |

Nasz silnik **nie parsuje jeszcze** tego formatu (miejsce jest budowane w `src/game/place.ts`), ale **model danych jest zgodny**: instancje mają identyfikator, klasę, właściwości typowane i relację `Parent`. To dokładnie te cztery rzeczy, które niesie `INST + PROP + PRNT`.

---

## 6. Co z tego wyszło w praktyce

| Mechanizm Robloxa | Nasza implementacja |
|---|---|
| `Instance.new`, drzewo `game`, `Parent` | `World` w TypeScripcie + metatabla w Luau (`instancje[id]`) |
| `CFrame`, `Vector3`, `UDim2`, `Color3`, `Enum` | typy zaimplementowane w Luau (`runtime.lua`), z operatorami (`*`, `+`, `Lerp`) |
| `Script` / `LocalScript` / `ModuleScript` | osobne VM Luau dla serwera i klienta, `require` z cache |
| `task.wait/spawn/delay`, `Heartbeat` | własny scheduler korutyn w Luau + tick z JS |
| replikacja serwer→klient | snapshot + delty (`created`/`prop`/`destroyed`), filtrowane po `serviceIdMax` |
| `RemoteEvent` | kolejka `remote` w obie strony (`FireServer`/`FireClient`) |
| fizyka (`Touched`, grawitacja, schody) | AABB + `moveBox`, `Touched` z par AABB |
| `workspace:Raycast` | przecięcie promienia z AABB (OSU) po wszystkich częściach |
| `Humanoid` (`Health`, `WalkSpeed`, `JumpPower`) | własny kontroler + rig R6 z animacją chodu |
| `ScreenGui` → `Frame`/`TextLabel` | mapowanie instancji GUI na elementy DOM (pozycje z `UDim2`) |
| `TweenService` | interpolacja właściwości w Luau, wywoływana z `Heartbeat` |
| Studio (Explorer/Properties/Output) | panel pod `F2` po stronie klienta |

Świadome różnice: kolizje AABB zamiast OBB, brak assetów sieciowych, jeden gracz na kartę, brak `Terrain`.

---

## 7. Wnioski

1. **Format plików miejsc jest w pełni otwarty i opisany** — `.rbxlx` to zwykły XML, `.rbxl` to kilka udokumentowanych chunków. To najważniejsza „twarda" wiedza, jaką da się zdobyć bez APK.
2. **Największą wartością nie jest binarka, a API** — semantyka `Instance`/`Touched`/`CFrame`/replikacji jest publiczna i to ona decyduje, czy klon „zachowuje się jak Roblox".
3. **Luau jest naprawdę osadzalny** — oficjalny interpreter w WASM (0,9–1,4 MB) uruchamia nietknięte skrypty Robloxa w przeglądarce w kilka milisekund.
4. **Najtrudniejsze technicznie okazały się granice mostka JS ⇄ Luau**, nie fizyka ani renderer: tablice JS nie przechodzą do Luau (stąd „pakowanie" wektorów w obiekty pól) i nie wolno odczytywać tabel instancji z pominięciem ich leniwego tworzenia.
