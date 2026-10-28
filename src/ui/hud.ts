/**
 * hud.ts — nakładka w stylu Robloxa: pasek górny, lista graczy, czat, statystyki.
 */
import type { World } from '../engine/world'

export interface ChatLine { author: string; text: string; color: string }

export class Hud {
  topbar: HTMLDivElement
  playerList: HTMLDivElement
  chat: HTMLDivElement
  chatLog: HTMLDivElement
  chatInput: HTMLInputElement
  stats: HTMLDivElement
  toast: HTMLDivElement
  private toastTimer = 0

  constructor(private root: HTMLElement, private placeName: string, onChat: (text: string) => void) {
    this.topbar = div('roblox-topbar')
    this.topbar.innerHTML = `
      <div class="rbx-logo"><span class="rbx-mark"></span><span class="rbx-name">ROBLOX</span></div>
      <div class="rbx-place">${placeName}</div>
      <div class="rbx-pill" id="rbx-players">1 gracz</div>
      <div class="rbx-pill" id="rbx-ping">0 FPS</div>`
    root.appendChild(this.topbar)

    this.playerList = div('rbx-playerlist')
    root.appendChild(this.playerList)

    this.chat = div('rbx-chat')
    this.chatLog = div('rbx-chatlog')
    this.chatInput = document.createElement('input')
    this.chatInput.className = 'rbx-chatinput'
    this.chatInput.placeholder = 'Napisz wiadomość i naciśnij Enter…'
    this.chatInput.maxLength = 140
    this.chat.append(this.chatLog, this.chatInput)
    root.appendChild(this.chat)
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.chatInput.value.trim()) {
        onChat(this.chatInput.value.trim())
        this.chatInput.value = ''
        e.stopPropagation()
      }
    })

    this.stats = div('rbx-stats')
    root.appendChild(this.stats)

    this.toast = div('rbx-toast')
    root.appendChild(this.toast)
  }

  addChat(line: ChatLine) {
    const el = document.createElement('div')
    el.className = 'rbx-chatline'
    el.innerHTML = `<b style="color:${line.color}">${escapeHtml(line.author)}</b>: <span>${escapeHtml(line.text)}</span>`
    this.chatLog.appendChild(el)
    while (this.chatLog.children.length > 7) this.chatLog.firstElementChild?.remove()
    el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 160 })
  }

  showToast(text: string, kind: 'info' | 'error' = 'info') {
    this.toast.textContent = text
    this.toast.className = `rbx-toast visible ${kind}`
    clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => (this.toast.className = 'rbx-toast'), 2600)
  }

  update(world: World, localPlayerId: number, fps: number, parts: number) {
    const players: string[] = []
    for (const inst of world.instances.values()) {
      if (inst.className !== 'Player') continue
      const name = String(inst.props.Name ?? 'Gracz')
      let points = '0'
      for (const childId of world.getChildren(inst.id)) {
        const stats = world.get(childId)
        if (stats?.props.Name !== 'leaderstats') continue
        for (const sid of world.getChildren(childId)) {
          const stat = world.get(sid)
          if (stat?.props.Name === 'Punkty') points = String(stat.props.Value ?? 0)
        }
      }
      const you = inst.id === localPlayerId ? ' (Ty)' : ''
      players.push(`<div class="rbx-player"><span class="rbx-avatar" style="background:${inst.id === localPlayerId ? '#22c55e' : '#4b8cd6'}"></span>
        <span class="rbx-pname">${escapeHtml(name)}${you}</span><span class="rbx-ppts">${points} pkt</span></div>`)
    }
    this.playerList.innerHTML = `<div class="rbx-plisthead">GRACZE — ${players.length}</div>` + players.join('')
    const fpsEl = this.topbar.querySelector('#rbx-ping')
    if (fpsEl) fpsEl.textContent = `${fps} FPS`
    const pEl = this.topbar.querySelector('#rbx-players')
    if (pEl) pEl.textContent = `${players.length} gracz${players.length === 1 ? '' : 'y'}`
    this.stats.textContent = `${parts} części w scenie`
  }
}

function div(cls: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = cls
  return el
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
