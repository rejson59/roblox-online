/**
 * input.ts — klawiatura i mysz (odpowiednik UserInputService).
 */
export const ROBLOX_KEY_NAMES: Record<string, string> = {
  KeyW: 'W', KeyA: 'A', KeyS: 'S', KeyD: 'D', Space: 'Space', ShiftLeft: 'LeftShift',
  ShiftRight: 'RightShift', KeyE: 'E', KeyF: 'F', KeyQ: 'Q', KeyR: 'R', KeyC: 'C',
  KeyX: 'X', KeyZ: 'Z', KeyM: 'M', Tab: 'Tab', Escape: 'Escape', Enter: 'Enter',
  F1: 'F1', F2: 'F2',
  Digit1: 'One', Digit2: 'Two', Digit3: 'Three', ArrowUp: 'Up', ArrowDown: 'Down',
  ArrowLeft: 'Left', ArrowRight: 'Right',
}

export class Input {
  keys = new Set<string>()
  mouse = { x: 0, y: 0, dx: 0, dy: 0 }
  wheel = 0
  dragging = false
  private listeners: Array<(name: string, down: boolean) => void> = []

  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const name = ROBLOX_KEY_NAMES[e.code]
      if (name && !this.keys.has(name)) {
        this.keys.add(name)
        this.emit(name, true)
        if (name === 'Space' || name === 'Tab' || name === 'F1') e.preventDefault()
      }
    })
    window.addEventListener('keyup', (e) => {
      const name = ROBLOX_KEY_NAMES[e.code]
      if (name) {
        this.keys.delete(name)
        this.emit(name, false)
      }
    })
    window.addEventListener('blur', () => this.keys.clear())

    target.addEventListener('mousedown', (e) => {
      this.dragging = true
      target.style.cursor = 'grabbing'
      this.emit(e.button === 2 ? 'MouseButton2' : 'MouseButton1', true)
    })
    window.addEventListener('mouseup', (e) => {
      this.dragging = false
      target.style.cursor = 'grab'
      this.emit(e.button === 2 ? 'MouseButton2' : 'MouseButton1', false)
    })
    target.addEventListener('contextmenu', (e) => e.preventDefault())
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = e.clientX
      this.mouse.y = e.clientY
      if (this.dragging) {
        this.mouse.dx += e.movementX
        this.mouse.dy += e.movementY
      }
    })
    target.addEventListener('wheel', (e) => {
      this.wheel += Math.sign(e.deltaY)
      e.preventDefault()
    }, { passive: false })
    target.style.cursor = 'grab'
  }

  onKey(fn: (name: string, down: boolean) => void) {
    this.listeners.push(fn)
  }

  private emit(name: string, down: boolean) {
    for (const fn of this.listeners) fn(name, down)
  }

  isDown(name: string): boolean {
    return this.keys.has(name)
  }

  /** Wektor ruchu WASD: -1..1 */
  moveAxis(): { x: number; z: number } {
    let x = 0, z = 0
    if (this.isDown('W') || this.isDown('Up')) z += 1
    if (this.isDown('S') || this.isDown('Down')) z -= 1
    if (this.isDown('D') || this.isDown('Right')) x += 1
    if (this.isDown('A') || this.isDown('Left')) x -= 1
    return { x, z }
  }

  consumeMouseDelta(): { dx: number; dy: number } {
    const d = { dx: this.mouse.dx, dy: this.mouse.dy }
    this.mouse.dx = 0
    this.mouse.dy = 0
    return d
  }

  consumeWheel(): number {
    const w = this.wheel
    this.wheel = 0
    return w
  }
}
