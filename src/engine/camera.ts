/**
 * camera.ts — kamera orbitalna w stylu Robloxa (zoom kółkiem, obrót myszą).
 */
export class Camera {
  yaw = Math.PI
  pitch = -0.25
  distance = 13
  minDistance = 0.7
  maxDistance = 60
  fov = 70
  /** wygładzona pozycja celu */
  target: [number, number, number] = [0, 5, 0]
  position: [number, number, number] = [0, 10, 20]
  firstPerson = false

  update(dt: number, targetPos: [number, number, number], dx: number, dy: number, wheel: number) {
    this.yaw -= dx * 0.0035
    this.pitch -= dy * 0.0035
    const limit = Math.PI / 2 - 0.05
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch))
    if (wheel !== 0) {
      this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance * (1 + wheel * 0.12)))
    }
    const smooth = Math.min(1, dt * 16)
    for (let i = 0; i < 3; i++) this.target[i] += (targetPos[i] - this.target[i]) * smooth

    const dist = this.distance
    const cp = Math.cos(this.pitch)
    this.position = [
      this.target[0] + Math.sin(this.yaw) * cp * dist,
      this.target[1] - Math.sin(this.pitch) * dist + 1.2,
      this.target[2] + Math.cos(this.yaw) * cp * dist,
    ]
  }

  /** CFrame kamery w formacie Robloxa (12 liczb) — widoczny dla skryptów. */
  cframe(): number[] {
    if (this.distance <= this.minDistance + 0.1) {
      // pierwsza osoba: patrzymy w kierunku orbity
      const dirX = -Math.sin(this.yaw) * Math.cos(this.pitch)
      const dirY = Math.sin(this.pitch)
      const dirZ = -Math.cos(this.yaw) * Math.cos(this.pitch)
      return this.lookCframe([this.target[0], this.target[1] + 1.4, this.target[2]], [dirX, dirY, dirZ])
    }
    const dirX = this.target[0] - this.position[0]
    const dirY = this.target[1] + 1.2 - this.position[1]
    const dirZ = this.target[2] - this.position[2]
    return this.lookCframe(this.position, [dirX, dirY, dirZ])
  }

  private lookCframe(pos: number[], dir: number[]): number[] {
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1
    const lx = dir[0] / len, ly = dir[1] / len, lz = dir[2] / len
    // z = -look
    const zx = -lx, zy = -ly, zz = -lz
    let xx = 0, xy = 0, xz = 0
    // x = up × z
    xx = 1 * zz - 0 * zy
    xy = 0 * zx - 0 * zz
    xz = 0 * zy - 1 * zx
    if (Math.hypot(xx, xy, xz) < 1e-5) { xx = 1; xy = 0; xz = 0 }
    const xl = Math.hypot(xx, xy, xz)
    xx /= xl; xy /= xl; xz /= xl
    // y = z × x
    const yx = zy * xz - zz * xy
    const yy = zz * xx - zx * xz
    const yz = zx * xy - zy * xx
    // wiersze macierzy rotacji: R00..R02 = right, R10..R12 = up, R20..R22 = back
    return [pos[0], pos[1], pos[2], xx, xy, xz, yx, yy, yz, zx, zy, zz]
  }

  /** Perspektywiczna macierz projekcji (column-major) + widok. */
  viewProjection(aspect: number): Float32Array {
    const cf = this.cframe()
    const view = viewMatrix(cf)
    const proj = perspective((this.fov * Math.PI) / 180, aspect, 0.15, 3000)
    return multiply(proj, view)
  }

  forward(): [number, number, number] {
    const cf = this.cframe()
    return [-cf[5], -cf[8], -cf[11]]
  }
}

export function perspective(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2)
  const nf = 1 / (near - far)
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ])
}

/** Macierz widoku z CFrame (odwrotność transformacji kamery). */
export function viewMatrix(cf: number[]): Float32Array {
  const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = cf
  // Macierz widoku = odwrotność CFrame kamery. W pamięci column-major (WebGL)
  // kolumna 0 to (R00, R01, R02) — czyli WIERSZ 0 macierzy R, nie kolumna.
  return new Float32Array([
    r00, r01, r02, 0,
    r10, r11, r12, 0,
    r20, r21, r22, 0,
    -(r00 * x + r10 * y + r20 * z),
    -(r01 * x + r11 * y + r21 * z),
    -(r02 * x + r12 * y + r22 * z),
    1,
  ])
}

export function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3]
    }
  }
  return out
}
