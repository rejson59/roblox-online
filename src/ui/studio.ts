/**
 * studio.ts — mini-Roblox Studio w przeglądarce.
 *
 * Explorer pokazuje drzewo instancji serwera (to samo, co widzi DataModel),
 * Output zbiera print/warn/error ze skryptów Luau, a Properties pokazuje
 * rzeczywiste właściwości wybranej instancji — w tym kod źródłowy skryptów.
 */
import { isAPart, type World } from '../engine/world'

export class Studio {
  panel: HTMLDivElement
  tree: HTMLDivElement
  output: HTMLDivElement
  props: HTMLDivElement
  source: HTMLTextAreaElement
  selected: number | null = null
  private logs: Array<{ level: string; text: string }> = []
  private open = false

  constructor(
    parent: HTMLElement,
    private getWorld: () => World,
    private onRestart: () => void,
    private onSelect: (id: number | null) => void,
  ) {
    this.panel = document.createElement('div')
    this.panel.className = 'studio'
    this.panel.innerHTML = `
      <div class="studio-head">
        <span class="studio-title">⚙ Studio</span>
        <span class="studio-hint">F2 / Tab — schowaj</span>
        <button class="studio-btn" id="studio-restart">Restart świata</button>
      </div>
      <div class="studio-body">
        <div class="studio-col explorer">
          <div class="studio-label">Explorer</div>
          <div class="studio-tree" id="studio-tree"></div>
        </div>
        <div class="studio-col mid">
          <div class="studio-label">Properties</div>
          <div class="studio-props" id="studio-props"></div>
        </div>
        <div class="studio-col out">
          <div class="studio-label">Output</div>
          <div class="studio-output" id="studio-output"></div>
        </div>
      </div>
      <div class="studio-sourcebar">
        <div class="studio-label">Source</div>
        <textarea class="studio-source" id="studio-source" spellcheck="false" placeholder="Wybierz skrypt w Explorerze, aby zobaczyć jego kod Luau"></textarea>
      </div>`
    this.panel.classList.add('hidden')
    parent.appendChild(this.panel)
    this.tree = this.panel.querySelector('#studio-tree')!
    this.output = this.panel.querySelector('#studio-output')!
    this.props = this.panel.querySelector('#studio-props')!
    this.source = this.panel.querySelector('#studio-source')!
    this.panel.querySelector('#studio-restart')!.addEventListener('click', () => this.onRestart())
  }

  toggle() {
    this.open = !this.open
    this.panel.classList.toggle('hidden', !this.open)
  }

  isOpen() {
    return this.open
  }

  log(level: string, text: string) {
    this.logs.push({ level, text })
    if (this.logs.length > 300) this.logs.shift()
    const el = document.createElement('div')
    el.className = `out-line ${level}`
    el.textContent = `${new Date().toLocaleTimeString()}  ${text}`
    this.output.appendChild(el)
    while (this.output.children.length > 300) this.output.firstElementChild?.remove()
    this.output.scrollTop = this.output.scrollHeight
  }

  refresh() {
    const world = this.getWorld()
    this.tree.innerHTML = ''
    const root = [...world.instances.values()].find((i) => i.className === 'DataModel')
    if (!root) return
    this.tree.appendChild(this.node(world, root.id, 0))
  }

  private node(world: World, id: number, depth: number): HTMLElement {
    const inst = world.get(id)
    const row = document.createElement('div')
    row.className = 'tree-row' + (this.selected === id ? ' selected' : '')
    const icon = iconFor(inst?.className ?? 'Instance')
    row.innerHTML = `<span class="tree-indent"></span><span class="tree-icon" style="background:${icon.color}">${icon.glyph}</span>
      <span class="tree-name">${inst?.props.Name ?? 'Instance'}</span><span class="tree-class">${inst?.className ?? ''}</span>`
    row.style.paddingLeft = `${depth * 12}px`
    row.addEventListener('click', (e) => {
      e.stopPropagation()
      this.selected = id
      this.onSelect(id)
      this.refresh()
    })
    if (depth < 4) {
      const kids = world.getChildren(id)
      for (const k of kids) {
        if (depth > 2 && kids.length > 24) break
        row.appendChild(this.node(world, k, depth + 1))
      }
    }
    return row
  }

  showProps(id: number | null) {
    const world = this.getWorld()
    if (id === null) {
      this.props.innerHTML = '<div class="prop-empty">Kliknij instancję w drzewie</div>'
      this.source.value = ''
      return
    }
    const inst = world.get(id)
    if (!inst) return
    const rows: string[] = []
    rows.push(this.propRow('ClassName', inst.className))
    for (const [k, v] of Object.entries(inst.props)) {
      if (k === 'Source') continue
      rows.push(this.propRow(k, Array.isArray(v) ? `[${v.map((n) => Number(n).toFixed(2)).join(', ')}]` : String(v)))
    }
    if (inst.parent !== null) rows.push(this.propRow('Parent', world.fullName(inst.parent)))
    this.props.innerHTML = rows.join('')
    const src = inst.props.Source
    this.source.value = typeof src === 'string' ? src : ''
    this.source.disabled = typeof src !== 'string'
    this.source.placeholder = typeof src === 'string'
      ? 'Źródło skryptu (edytowalne — zadziała po restarcie świata)'
      : isAPart(inst.className) ? 'To jest część — brak kodu' : 'Ta instancja nie ma kodu'
    if (typeof src === 'string') {
      this.source.oninput = () => {
        inst.props.Source = this.source.value
      }
    }
  }

  private propRow(key: string, value: string): string {
    const safe = value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))
    return `<div class="prop-row"><span class="prop-key">${key}</span><span class="prop-val" title="${safe}">${safe}</span></div>`
  }
}

function iconFor(cls: string): { glyph: string; color: string } {
  if (isAPart(cls)) return { glyph: '◼', color: '#6b8afd' }
  if (cls === 'Script' || cls === 'LocalScript') return { glyph: '⌨', color: '#3ba55d' }
  if (cls === 'ModuleScript') return { glyph: '📦', color: '#4f9d69' }
  if (cls === 'Model') return { glyph: '⬡', color: '#c07af5' }
  if (cls === 'Folder') return { glyph: '▤', color: '#d9a441' }
  if (cls === 'Player') return { glyph: '☺', color: '#e05f5f' }
  if (cls === 'Humanoid') return { glyph: '☻', color: '#e08a3c' }
  if (cls === 'ScreenGui' || cls === 'Frame' || cls === 'TextLabel') return { glyph: '▣', color: '#59b6e0' }
  if (cls === 'RemoteEvent') return { glyph: '⇄', color: '#8f7ae0' }
  return { glyph: '•', color: '#8b93a3' }
}
