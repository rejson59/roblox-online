# Prawdziwy Roblox w przeglądarce — co jest legalne i co naprawdę działa

Stan wiedzy: **28 października 2026**. Ten dokument dotyczy gier **Roblox Corporation**, a nie silnika z tego repo.

> **Najkrócej:** grać w oryginalne gry da się **już teraz** — przez oficjalnego klienta (2 minuty) albo strumień z prawdziwego komputera do karty. Oficjalne granie w karcie bez instalacji Roblox zapowiedział na **koniec 2026** (Chrome). Nie istnieje legalna droga typu „zaloguj się w cudzej aplikacji webowej i graj”.

---

## 0. Szybki start — wybrana droga: oficjalny klient

### Windows / macOS

1. Wejdź na **<https://www.roblox.com/download>** (wpisz adres ręcznie — nie klikaj w linki z reklam).
2. Pobierz **Roblox Player** (kilkaset MB) i uruchom instalator.
3. Zainstaluj, potem otwórz stronę gry na roblox.com i kliknij zielony przycisk grania — gra uruchomi się w aplikacji Roblox.
4. Zaloguj się swoim kontem. Jeśli nie masz — utwórz je na roblox.com (data urodzenia wpływa na ustawienia bezpieczeństwa).

### Android

1. Otwórz **Google Play** i wyszukaj **Roblox** (wydawca: *Roblox Corporation*, kilkaset milionów pobrań — sprawdź wydawcę, nie samą nazwę).
2. Zainstaluj i zaloguj się. Alternatywnie: przeglądarka → <https://www.roblox.com/download> przekieruje do sklepu.

### iPhone / iPad

1. **App Store** → **Roblox** (wydawca: *Roblox Corporation*).
2. Zainstaluj i zaloguj się.

### Zanim zagrasz — 5 minut, które ratują konto

- **Włącz 2FA**: roblox.com → Settings → Security → *Authenticator App* (tokeny, nie SMS). Zapisz kody zapasowe.
- **Zweryfikuj e-mail** — bez tego odzyskanie konta jest bardzo trudne.
- **Ustaw PIN konta** i kod rodzicielski, jeśli ktoś jeszcze korzysta z urządzenia.
- **Nie wpisuj hasła nigdzie poza `roblox.com` i aplikacją Roblox.** Każda strona „darmowe Robux", „generator", „sprawdzian wieku" to phishing.
- **Nikomu nie wysyłaj `.ROBLOSECURITY`** ani kodu z aplikacji uwierzytelniającej — Roblox nigdy o nie nie prosi w wiadomości.
- Nie instaluj „odblokowanych klientów" ani executorów: od 2025 r. Roblox automatycznie karze za modyfikowanego klienta, łącznie z trwałym banem.

### Co dalej w tym repo

Ten silnik zostaje jako **piaskownica do nauki**: prawdziwy Luau, te same wzorce (`Instance`, `Touched`, `RemoteEvent`), zero instalacji. Klawisz **F1** w grze wraca do tego przewodnika.

---

## 1. Oficjalny klient — działa od ręki

| Platforma | Droga | Status |
|---|---|---|
| Windows | [roblox.com/download](https://www.roblox.com/download) → Roblox Player | oficjalna |
| macOS | [roblox.com/download](https://www.roblox.com/download) → Roblox.app | oficjalna |
| Android | Google Play: `com.roblox.client` | oficjalna |
| iPhone / iPad | App Store: Roblox | oficjalna |
| Chromebook | Google Play (aplikacja Android) | oficjalna |
| Linux | brak wsparcia | nieoficjalne wrappery — na własne ryzyko |
| Xbox / PlayStation | sklep konsoli | oficjalna |

To jest odpowiedź na „chcę teraz”: instalacja jest darmowa, a jedyne opóźnienie to czas pobrania (~300–500 MB).

## 2. Prawdziwy klient w karcie przeglądarki — strumieniowanie

Idea: Roblox działa na **prawdziwym Windowsie**, a Ty widzisz jego obraz w przeglądarce i sterujesz nim zdalnie. To legalne — to zwykły remote desktop na Twoim własnym sprzęcie, bez modyfikowania klienta.

### 2A. Własny PC z Windowsem (najlepsza jakość)

**Wariant „najlepsza płynność” (aplikacja, nie karta):** Sunshine (host) + Moonlight (klient). Moonlight ma natywne aplikacje na Windows/macOS/Linux/Android/iOS/Apple TV — nie ma klienta webowego, ale opóźnienie jest najniższe z możliwych (~1 klatka w LAN).

**Wariant „naprawdę w karcie”:** Apache Guacamole (RDP przez WebSocket) albo Kasm Workspaces / KasmVNC.

Minimalny zarys (Guacamole, Docker na dowolnym Linuxie w sieci LAN):

1. Na Windowsie: **Ustawienia → System → Zdalny pulpit → włącz** (wymaga Windows 11/10 **Pro**; Home nie ma serwera RDP).
2. Na maszynie z Dockerem uruchom `guacamole/guacd` + `guacamole/guacamole` + bazę (Postgres/MySQL) — oficjalna instrukcja: <https://guacamole.apache.org/doc/gug/guacamole-docker.html>.
3. W panelu Guacamole dodaj połączenie RDP wskazujące na IP Windowsa (port 3389), ustaw rozdzielczość i skalowanie.
4. Otwórz `https://<host>/guacamole` w przeglądarce — to już pulpit Windowsa; uruchom tam Robloxa.

**Uczciwe ograniczenia:**

- RDP/WebRTC dodaje opóźnienie — gry zręcznościowe będą odczuwalnie „ciężkie”, obby i gry turowane są OK.
- Roblox **nie wspiera** maszyn wirtualnych ani zdalnych pulpitów. Działa, ale nie jest to konfiguracja oficjalna.
- Sesja RDP może wyłączyć akcelerację GPU na hoście; najlepiej, gdy Roblox działa na **drugiej** maszynie/VM z przekazanym GPU.
- Nie loguj się przez RDP do maszyny, na której ktoś inny jest zalogowany — Windows tego nie lubi.

### 2B. Cloud PC

Wynajmij Windowsa z GPU (AWS `g4dn`/`g5`, Paperspace, Shadow) → zainstaluj tam oficjalnego Robloxa → połącz się przez Parsec/Guacamole/Sunshine. Zaleta: działa nawet na słabym laptopie czy Chromebooku. Wady: abonament, opóźnienie zależne od odległości do serwerowni, a Roblox nadal traktuje VM jako konfigurację niewspieraną.

Platformy chmurowe, które wprost oferowały „Roblox w przeglądarce” (np. now.gg), **były blokowane przez Robloxa** i ich dostępność się zmienia — traktuj je jako niestabilne, a nie jako rozwiązanie.

## 3. Oficjalny web player (zapowiedź Robloxa)

Na **RDC 2026 (11 września 2026)** Roblox ogłosił:

- granie **w karcie Chrome bez instalacji**, start z podstrony gry (Experience Details Page),
- termin: **do końca 2026**, kolejne przeglądarki później,
- **wymagane zalogowanie na konto Roblox**, czat tekstowy i Robux działają, dostępne wszystkie gry,
- na start: **Chrome na Windows, macOS i Androidzie** (Chrome na iOS to inny silnik — wykluczony).

Źródła: [about.roblox.com/newsroom/2026/09/rdc-2026-the-world-needs-more-play](https://about.roblox.com/newsroom/2026/09/rdc-2026-the-world-needs-more-play), [theverge.com](https://www.theverge.com/games/993563/roblox-will-soon-let-you-play-games-in-your-browser).

Jak sprawdzić, czy już działa: wejdź w Chrome na stronę dowolnej gry na roblox.com i zaloguj się. Jeśli pojawi się przycisk grania bez instalacji — funkcja jest już włączona dla Twojego konta/regionu. Jeśli nie — zostaje droga 1 lub 2.

## 4. Czego nie wolno i co nie działa (mimo że „się da”)

| Pomysł | Dlaczego odpada |
|---|---|
| **Wklejanie `.ROBLOSECURITY`** (ciasteczka sesji) do jakiejkolwiek aplikacji | To przejęcie sesji. Daje dostęp do strony www, ale **nie do gry**: wejście do doświadczenia i rysowanie świata wymaga zamkniętego silnika i szyfrowanego protokołu, a Roblox aktywnie wykrywa natywnych klientów spoza swojego kodu. W praktyce: utrata konta (Robux, itemy, konto e-mail). |
| **Modyfikowane klienty / executory** | Od maja 2025 Roblox automatycznie karze za „modified clients” — do **trwałego bana** włącznie ([ogłoszenie na DevForum](https://devforum.roblox.com/t/an-update-on-automated-action-against-modified-clients/3640609)). Hyperion (Byfron) wykrywa ingerencję w pamięć procesu. |
| **Własna reimplementacja klienta łącząca się z serwerami Robloxa** | Wymaga odtworzenia całego silnika i protokołu — nikt legalnie tego nie zrobił; łamie ToU (dostęp do usługi w sposób nieautoryzowany). |
| **Strony „darmowe Robux / generator”** | Zawsze phishing. Konto Roblox nigdy nie prosi o hasło poza `roblox.com` i aplikacją. |
| **Iframe z roblox.com** | Roblox ustawia nagłówki blokujące osadzanie (`X-Frame-Options`/CSP) — strona się nie wczyta. |

## 5. Nasz projekt a prawdziwy Roblox

Ten silnik (`src/engine/`) **nie jest i nie będzie** klientem Robloxa. Różnica jest fundamentalna:

- **on** — zamknięty, natywny silnik Robloxa + ich serwery,
- **my** — własny silnik + własne API zgodne z Robloxem, uruchamiane w całości w przeglądarce.

Co to daje legalnie i realnie:

- **naukę** — prawdziwy Luau (ten sam interpreter co w Roblox Studio) i te same wzorce (`Instance`, `Touched`, `RemoteEvent`, `Humanoid`),
- **prototypowanie** — własne miejsce, własne skrypty, bez instalacji,
- **wczytywanie prawdziwych plików miejsc** (`.rbxlx`) zapisanych w Roblox Studio — mapa i skrypty z oryginalnego projektu, uruchomione naszym silnikiem.

Czego to nie zastąpi: prawdziwych serwerów Robloxa, znajomych, Robux i oficjalnych doświadczeń.

## 6. Podsumowanie

1. **Chcesz grać teraz** → oficjalny klient (2 minuty, darmowo, wszystkie gry).
2. **Musisz mieć to w karcie** → strumień z prawdziwego Windowsa (Guacamole/Sunshine lub cloud PC). Działa, ale to remote desktop.
3. **Chcesz oficjalnie, bez instalacji** → Chrome + strona gry, funkcja wchodzi do końca 2026.
4. **Nie ma** legalnej drogi „zaloguj się do prawdziwego Robloxa w cudzej aplikacji webowej”. Nie zbuduję jej i nie poproszę Cię o hasło ani sesję — nie dlatego, że „nie wolno”, ale dlatego, że to nie kończy się grą, tylko utratą konta.
