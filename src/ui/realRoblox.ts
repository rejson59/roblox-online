/**
 * realRoblox.ts — panel „Zagraj w prawdziwego Robloxa”.
 *
 * Ten projekt jest edukacyjnym silnikiem w stylu Robloxa, a nie klientem
 * Robloxa. Panel prowadzi gracza do legalnych dróg: oficjalnego klienta
 * (dostępny od ręki), streamowania prawdziwego klienta do karty oraz
 * oficjalnego web playera, który Roblox zapowiedział na koniec 2026.
 */

export type Platform = 'windows' | 'mac' | 'android' | 'ios' | 'chromeos' | 'linux' | 'other'

export function detectPlatform(): Platform {
  const ua = navigator.userAgent
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const headless = (nav.userAgentData?.platform || navigator.platform || '').toLowerCase()
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/cros/i.test(headless) || /CrOS/.test(ua)) return 'chromeos'
  if (/win/i.test(headless) || /Windows/i.test(ua)) return 'windows'
  if (/mac/i.test(headless) || /Macintosh|Mac OS X/i.test(ua)) return /iphone|ipad/i.test(ua) ? 'ios' : 'mac'
  if (/linux/i.test(headless) || /Linux/i.test(ua)) return 'linux'
  return 'other'
}

const PLATFORM_LABEL: Record<Platform, string> = {
  windows: 'Windows',
  mac: 'macOS',
  android: 'Android',
  ios: 'iPhone / iPad',
  chromeos: 'Chromebook',
  linux: 'Linux',
  other: 'ta przeglądarka',
}

interface ClientLink {
  label: string
  href: string
  note: string
}

function clientLink(p: Platform): ClientLink {
  switch (p) {
    case 'android':
      return {
        label: 'Otwórz Roblox w Google Play',
        href: 'https://play.google.com/store/apps/details?id=com.roblox.client',
        note: 'Oficjalna aplikacja Roblox Corporation.',
      }
    case 'ios':
      return {
        label: 'Otwórz Roblox w App Store',
        href: 'https://apps.apple.com/app/roblox/id431946152',
        note: 'Oficjalna aplikacja Roblox Corporation.',
      }
    case 'chromeos':
      return {
        label: 'Roblox w Google Play (Chromebook)',
        href: 'https://play.google.com/store/apps/details?id=com.roblox.client',
        note: 'Na Chromebooku działa oficjalna aplikacja Android — to wspierana droga.',
      }
    case 'linux':
      return {
        label: 'roblox.com/download',
        href: 'https://www.roblox.com/download',
        note: 'Linux nie jest oficjalnie wspierany przez Robloxa. Społeczność używa nieoficjalnych wrapperów — świadomie na własne ryzyko.',
      }
    default:
      return {
        label: 'Pobierz oficjalnego Robloxa',
        href: 'https://www.roblox.com/download',
        note: 'Instalator Roblox Player. Gry, znajomi i Robux działają normalnie.',
      }
  }
}

export interface RealPanel {
  el: HTMLElement
  open(): void
  close(): void
}

export function createRealRobloxPanel(parent: HTMLElement, docsHref = 'https://github.com/rejson59/roblox-online/blob/arena/3ae74037-roblox-online/docs/prawdziwy-roblox.md'): RealPanel {
  const p = detectPlatform()
  const link = clientLink(p)

  const el = document.createElement('div')
  el.className = 'about-panel real-panel is-hidden'
  el.innerHTML = `
    <h2>Zagraj w prawdziwego Robloxa</h2>
    <p class="real-lead">
      Ta strona to edukacyjny silnik w stylu Robloxa — <b>nie jest klientem Robloxa</b>.
      Oryginalne gry uruchamia wyłącznie oprogramowanie Robloxa. Oto legalne drogi,
      w tym jedna dostępna od ręki i jedna działająca w karcie przeglądarki.
    </p>
    <p class="real-detect">Wykryto: <b>${PLATFORM_LABEL[p]}</b></p>

    <div class="real-cards">
      <div class="real-card">
        <div class="real-badge">Dostępne teraz</div>
        <h3>1. Oficjalny klient (bez pośredników)</h3>
        <p>Najczystsza droga: oryginalna aplikacja na Twoim sprzęcie, bez streamu
        i bez pośredników. Wszystkie gry, znajomi, Robuxy, najniższe opóźnienie.</p>
        <a class="real-cta" href="${link.href}" target="_blank" rel="noopener noreferrer">${link.label} ↗</a>
        <p class="real-note">${link.note}</p>
      </div>

      <div class="real-card real-card-hit">
        <div class="real-badge real-badge-alt">Działa dziś — sprawdzone 29.10</div>
        <h3>2. Strumień PRAWDZIWEGO klienta do karty</h3>
        <p>Prawdziwy Roblox (aplikacja Android) uruchomiony na serwerze, obraz
        strumieniowany do karty przeglądarki. Logujesz się <b>swoim kontem Robloxa</b>
        — postęp, itemy i znajomi zostają. To nie klon: to oryginalna gra.</p>
        <a class="real-cta" href="https://web.cloudmoonapp.com/game/com.roblox.client/" target="_blank" rel="noopener noreferrer">CloudMoon — zagraj w karcie ↗</a>
        <a class="real-cta real-cta-ghost" href="${docsHref}" data-real-docs>Inne serwisy + ryzyka →</a>
        <p class="real-note">Min. 6 Mbps. Wersja mobilna (sterowanie dotykowe/ekranowe).
        To usługa zewnętrzna — Roblox traktuje chmurę jako „niewspieraną”, a now.gg
        dostał blokadę w lutym 2026. Konto trzymaj pod 2FA.</p>
      </div>

      <div class="real-card">
        <div class="real-badge real-badge-wait">Zapowiedziane</div>
        <h3>3. Oficjalny web player Robloxa</h3>
        <p>Roblox zapowiedział na RDC 2026 granie w Chrome bez instalacji —
        <b>do końca 2026</b>: przycisk „graj” na stronie gry, wymagane logowanie,
        najpierw Chrome na Windows, macOS i Androidzie.</p>
        <a class="real-cta real-cta-ghost" href="https://www.roblox.com/discover" target="_blank" rel="noopener noreferrer">roblox.com/discover ↗</a>
        <p class="real-note">Sprawdzaj stronę gry — tam pojawi się granie bez instalacji.</p>
      </div>
    </div>

    <div class="real-warn">
      <b>Czego ten projekt nie zrobi i dlaczego</b>
      <p>Nie zbiera haseł, kodów 2FA ani ciasteczek sesji (<code>.ROBLOSECURITY</code>) — nie z braku zgody,
      ale z powodów technicznych: samo ciasteczko daje dostęp do strony www, a do wejścia do gry i narysowania
      świata potrzebny jest zamknięty silnik Robloxa i jego szyfrowany protokół. Nie da się ich odtworzyć
      z przeglądarki, a wklejanie sesji do nieznanej aplikacji to najczęstszy sposób utraty konta.</p>
      <p>Narzędzia modyfikujące klienta (executory, „odblokowane” klienty) łamią regulamin Robloxa:
      od 2025 r. grożą za to bany, łącznie z trwałym.</p>
      <p><b>Strumieniowanie w chmurze</b> to inna sytuacja: uruchamiasz <i>niezmienioną</i> oficjalną
      aplikację, więc nie jest to „modified client”. Ryzyko jest inne: Roblox nie wspiera maszyn
      wirtualnych, a dostawcy takich usług bywają blokowani (now.gg — luty 2026). Najbezpieczniejszy
      wariant to strumień z <i>własnego</i> Windowsa lub wynajęty cloud PC.</p>
    </div>

    <button type="button" data-real-close>Zamknij</button>
  `

  const open = () => el.classList.remove('is-hidden')
  const close = () => el.classList.add('is-hidden')
  el.querySelector('[data-real-close]')?.addEventListener('click', close)
  el.addEventListener('click', (e) => {
    if (e.target === el) close()
  })
  parent.appendChild(el)
  return { el, open, close }
}
