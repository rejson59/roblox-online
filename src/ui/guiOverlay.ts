/**
 * guiOverlay.ts — mostek ScreenGui/Frame/TextLabel/TextButton → HTML.
 *
 * Dzięki temu skrypty w Luau mogą budować interfejs tak jak w Robloxie
 * (`Instance.new("TextLabel")`), a my renderujemy go jako elementy DOM
 * na wierzchu sceny 3D.
 */
import type { World } from '../engine/world'

const colorOf = (raw: unknown, fallback: string): string => {
  if (Array.isArray(raw) && raw.length >= 3) {
    const c = (n: number) => Math.round(Math.max(0, Math.min(1, Number(n))) * 255)
    return `rgb(${c(raw[0] as number)}, ${c(raw[1] as number)}, ${c(raw[2] as number)})`
  }
  return fallback
}

const udim2 = (raw: unknown): [number, number, number, number] | null => {
  if (Array.isArray(raw) && raw.length >= 4) {
    return [Number(raw[0]), Number(raw[1]), Number(raw[2]), Number(raw[3])]
  }
  return null
}

const FONT_WEIGHT: Record<string, string> = {
  GothamBold: '800', Gotham: '600', GothamSemibold: '700', SourceSans: '500',
  Cartoon: '700', Fantasy: '600', Antique: '600', SciFi: '600', Arcade: '700', Code: '500',
}

export class GuiOverlay {
  root: HTMLDivElement
  private nodes = new Map<number, HTMLElement>()
  private fired = new Set<string>()

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = 'gui-overlay'
    parent.appendChild(this.root)
  }

  update(world: World) {
    const alive = new Set<number>()
    let order = 0
    for (const inst of world.instances.values()) {
      if (inst.className !== 'ScreenGui') continue
      if (inst.props.Enabled === false) continue
      const container = this.ensure(inst.id, 'div', alive)
      container.className = 'gui-layer'
      container.style.zIndex = String(80 + (Number(inst.props.DisplayOrder ?? 0) as number))
      container.style.pointerEvents = 'none'
      this.buildChildren(world, inst.id, container, alive, 0)
      order++
    }
    for (const [id, el] of this.nodes) {
      if (!alive.has(id)) {
        el.remove()
        this.nodes.delete(id)
      }
    }
    void order
  }

  private ensure(id: number, tag: string, alive: Set<number>): HTMLElement {
    let el = this.nodes.get(id)
    if (!el) {
      el = document.createElement(tag)
      this.nodes.set(id, el)
    }
    alive.add(id)
    return el
  }

  private buildChildren(world: World, parentId: number, parentEl: HTMLElement, alive: Set<number>, depth: number) {
    if (depth > 8) return
    for (const childId of world.getChildren(parentId)) {
      const inst = world.get(childId)
      if (!inst) continue
      const cls = inst.className
      if (!['Frame', 'TextLabel', 'TextButton', 'ImageLabel', 'ImageButton', 'ScrollingFrame'].includes(cls)) continue
      if (inst.props.Visible === false) {
        const existing = this.nodes.get(childId)
        if (existing) existing.style.display = 'none'
        continue
      }
      const isButton = cls === 'TextButton' || cls === 'ImageButton'
      const el = this.ensure(childId, isButton ? 'button' : 'div', alive)
      el.className = 'gui-object' + (isButton ? ' gui-button' : '')
      el.style.display = 'block'
      const pos = udim2(inst.props.Position)
      const size = udim2(inst.props.Size)
      const bg = colorOf(inst.props.BackgroundColor3, 'rgba(0,0,0,0)')
      const bgT = Number(inst.props.BackgroundTransparency ?? 0)
      el.style.position = 'absolute'
      el.style.left = pos ? `${pos[0] * 100}%` : '0'
      el.style.top = pos ? `${pos[2] * 100}%` : '0'
      el.style.marginLeft = pos ? `${pos[1]}px` : '0'
      el.style.marginTop = pos ? `${pos[3]}px` : '0'
      el.style.width = size ? `calc(${size[0] * 100}% + ${size[1]}px)` : 'auto'
      el.style.height = size ? `calc(${size[2] * 100}% + ${size[3]}px)` : 'auto'
      el.style.background = bgT >= 1 ? 'transparent' : bg
      el.style.opacity = String(1 - bgT * (bgT >= 1 ? 0 : 0))
      el.style.borderRadius = `${Number(inst.props.BorderSizePixel ?? 0) === 0 ? 6 : 0}px`
      if (inst.props.ZIndex !== undefined) el.style.zIndex = String(Number(inst.props.ZIndex))
      el.style.pointerEvents = isButton ? 'auto' : 'none'

      const text = inst.props.Text
      if (typeof text === 'string' && (cls === 'TextLabel' || cls === 'TextButton')) {
        el.textContent = text
        const ts = Number(inst.props.TextSize ?? 14)
        el.style.fontSize = `${ts}px`
        el.style.color = colorOf(inst.props.TextColor3, '#fff')
        el.style.fontWeight = FONT_WEIGHT[String(inst.props.Font ?? 'Gotham')] ?? '600'
        el.style.display = 'flex'
        el.style.alignItems = 'center'
        el.style.justifyContent = 'center'
        el.style.whiteSpace = 'pre-wrap'
        el.style.textAlign = 'center'
        el.style.padding = '4px 8px'
        el.style.boxSizing = 'border-box'
        el.style.border = 'none'
        el.style.fontFamily = 'inherit'
      }

      if (isButton) {
        const key = `${childId}`
        if (!this.fired.has(key + ':bound')) {
          this.fired.add(key + ':bound')
          el.addEventListener('click', () => {
            world.queueEvent(`i${childId}:sig:MouseButton1Click`, [])
            world.queueEvent(`i${childId}:sig:Activated`, [])
          })
        }
      }
      if (el.parentElement !== parentEl) parentEl.appendChild(el)
      this.buildChildren(world, childId, el, alive, depth + 1)
    }
  }
}
