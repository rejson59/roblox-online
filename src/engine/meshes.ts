/**
 * meshes.ts — geometria brył Robloxa (Block, Ball, Cylinder, Wedge).
 * Format wierzchołka: pozycja (3) + normalna (3), indeksy 16-bitowe.
 */
export interface MeshData {
  vertices: Float32Array
  indices: Uint16Array
}

function build(verts: number[][], norms: number[][], idx: number[]): MeshData {
  const data = new Float32Array(verts.length * 6)
  for (let i = 0; i < verts.length; i++) {
    data[i * 6] = verts[i][0]; data[i * 6 + 1] = verts[i][1]; data[i * 6 + 2] = verts[i][2]
    data[i * 6 + 3] = norms[i][0]; data[i * 6 + 4] = norms[i][1]; data[i * 6 + 5] = norms[i][2]
  }
  return { vertices: data, indices: new Uint16Array(idx) }
}

/** Sześcian jednostkowy (od -0.5 do 0.5) — skalujemy przez rozmiar części. */
export function boxMesh(): MeshData {
  const v: number[][] = []
  const n: number[][] = []
  const idx: number[] = []
  const faces: Array<[number[], number[]]> = [
    [[1, 0, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1]],
    [[-1, 0, 0], [0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0]],
    [[0, 1, 0], [0, 1, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1]],
    [[0, -1, 0], [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]],
    [[0, 0, 1], [1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1]],
    [[0, 0, -1], [0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]],
  ]
  for (const [normal, corners] of faces) {
    const base = v.length
    for (let i = 0; i < 4; i++) {
      v.push([corners[i * 3] - 0.5, corners[i * 3 + 1] - 0.5, corners[i * 3 + 2] - 0.5])
      n.push(normal)
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return build(v, n, idx)
}

/** Kula jednostkowa. */
export function sphereMesh(segments = 20, rings = 14): MeshData {
  const v: number[][] = []
  const n: number[][] = []
  const idx: number[] = []
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2
      const x = Math.sin(phi) * Math.cos(theta)
      const y = Math.cos(phi)
      const z = Math.sin(phi) * Math.sin(theta)
      v.push([x * 0.5, y * 0.5, z * 0.5])
      n.push([x, y, z])
    }
  }
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * (segments + 1) + s
      const b = a + segments + 1
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  return build(v, n, idx)
}

/** Walec (oś Y) z podstawami. */
export function cylinderMesh(segments = 22): MeshData {
  const v: number[][] = []
  const n: number[][] = []
  const idx: number[] = []
  for (let s = 0; s <= segments; s++) {
    const t = (s / segments) * Math.PI * 2
    const x = Math.cos(t), z = Math.sin(t)
    v.push([x * 0.5, -0.5, z * 0.5]); n.push([x, 0, z])
    v.push([x * 0.5, 0.5, z * 0.5]); n.push([x, 0, z])
  }
  for (let s = 0; s < segments; s++) {
    const a = s * 2
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
  }
  // podstawy
  for (const [y, ny] of [[-0.5, -1], [0.5, 1]] as const) {
    const center = v.length
    v.push([0, y, 0]); n.push([0, ny, 0])
    for (let s = 0; s <= segments; s++) {
      const t = (s / segments) * Math.PI * 2
      v.push([Math.cos(t) * 0.5, y, Math.sin(t) * 0.5]); n.push([0, ny, 0])
    }
    for (let s = 0; s < segments; s++) {
      if (ny > 0) idx.push(center, center + 1 + s, center + 2 + s)
      else idx.push(center, center + 2 + s, center + 1 + s)
    }
  }
  return build(v, n, idx)
}

/** Klin (WedgePart) — trójkątny przekrój w płaszczyźnie ZY. */
export function wedgeMesh(): MeshData {
  const p = (x: number, y: number, z: number) => [x, y, z]
  const verts: number[][] = []
  const norms: number[][] = []
  const idx: number[] = []
  const addQuad = (a: number[], b: number[], c: number[], d: number[], normal: number[]) => {
    const base = verts.length
    verts.push(a, b, c, d)
    for (let i = 0; i < 4; i++) norms.push(normal)
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const addTri = (a: number[], b: number[], c: number[], normal: number[]) => {
    const base = verts.length
    verts.push(a, b, c)
    for (let i = 0; i < 3; i++) norms.push(normal)
    idx.push(base, base + 1, base + 2)
  }
  const x0 = -0.5, x1 = 0.5, y0 = -0.5, y1 = 0.5, z0 = -0.5, z1 = 0.5
  // spód
  addQuad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), [0, -1, 0])
  // tył (pionowa ściana z0)
  addQuad(p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), p(x1, y0, z0), [0, 0, -1])
  // góra (nachylona)
  addQuad(p(x0, y1, z0), p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z0), [0, 0.707, 0.707])
  // boki
  addTri(p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z0), [-1, 0, 0])
  addTri(p(x1, y0, z0), p(x1, y1, z0), p(x1, y0, z1), [1, 0, 0])
  return build(verts, norms, idx)
}
