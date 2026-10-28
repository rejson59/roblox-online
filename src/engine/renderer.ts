/**
 * renderer.ts — renderer 3D (WebGL2) w stylu Robloxa.
 *
 * • bryły: Block / Ball / Cylinder / Wedge rysowane jednym programem i cieniami
 *   z mapy cieni (kierunkowe światło słońca),
 * • materiały: Neon emituje światło, Glass jest przezroczysty,
 * • niebo: gradient + tarcza słońca, liczona z kierunku kamery,
 * • mgła (FogEnd/FogColor z Lighting) dla głębi.
 */
import { Camera, multiply } from './camera'
import { boxMesh, cylinderMesh, sphereMesh, wedgeMesh, type MeshData } from './meshes'
import { cframeToMatrix, isAPart, type World } from './world'

const PART_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uProj, uView, uModel;
uniform mat4 uShadowMat;
out vec3 vNormal;
out vec3 vWorld;
out vec4 vShadow;
void main() {
  vec4 world = uModel * vec4(aPos, 1.0);
  vWorld = world.xyz;
  vNormal = mat3(uModel) * aNormal;
  vShadow = uShadowMat * vec4(world.xyz, 1.0);
  gl_Position = uProj * uView * world;
}`

const PART_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
in vec4 vShadow;
uniform vec3 uColor;
uniform float uTransparency;
uniform float uEmissive;
uniform vec3 uLightDir;
uniform vec3 uCameraPos;
uniform vec3 uFogColor;
uniform float uFogEnd;
uniform sampler2D uShadowTex;
uniform vec3 uAmbient;
out vec4 fragColor;

float shadowFactor() {
  vec3 proj = vShadow.xyz / vShadow.w;
  proj = proj * 0.5 + 0.5;
  if (proj.z > 1.0 || proj.x < 0.0 || proj.x > 1.0 || proj.y < 0.0 || proj.y > 1.0) return 1.0;
  float bias = 0.0018;
  float lit = 0.0;
  vec2 texel = 1.0 / vec2(textureSize(uShadowTex, 0));
  for (int x = -1; x <= 1; x++) {
    for (int y = -1; y <= 1; y++) {
      float depth = texture(uShadowTex, proj.xy + vec2(float(x), float(y)) * texel).r;
      lit += proj.z - bias > depth ? 0.0 : 1.0;
    }
  }
  return lit / 9.0;
}

void main() {
  vec3 n = normalize(vNormal);
  float ndl = max(dot(n, -uLightDir), 0.0);
  float shadow = uTransparency > 0.02 ? 1.0 : shadowFactor();
  vec3 ambient = uAmbient * (0.55 + 0.45 * n.y);
  vec3 diffuse = vec3(1.0, 0.97, 0.92) * ndl * 0.85 * shadow;
  vec3 base = uColor * (ambient + diffuse);
  // delikatny rysunek kierunkowy
  vec3 viewDir = normalize(uCameraPos - vWorld);
  vec3 halfV = normalize(viewDir - uLightDir);
  float spec = pow(max(dot(n, halfV), 0.0), 42.0) * 0.25 * shadow;
  base += vec3(spec) * (1.0 - uTransparency);
  base = mix(base, uColor * 1.45, uEmissive);
  float dist = length(uCameraPos - vWorld);
  float fog = clamp(dist / max(uFogEnd, 1.0), 0.0, 1.0);
  base = mix(base, uFogColor, fog * fog * 0.85);
  float alpha = 1.0 - uTransparency;
  if (uEmissive > 0.5) alpha = max(alpha, 0.85);
  fragColor = vec4(base, alpha);
}`

const SKY_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.9999, 1.0); }`

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec3 uRight, uUp, uForward;
uniform float uAspect, uTanFov;
uniform vec3 uLightDir;
uniform vec3 uFogColor;
out vec4 fragColor;
void main() {
  vec2 p = (vUv * 2.0 - 1.0);
  p.x *= uAspect * uTanFov;
  p.y *= uTanFov;
  vec3 dir = normalize(uForward + uRight * p.x + uUp * p.y);
  float h = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 horizon = uFogColor;
  vec3 zenith = vec3(0.24, 0.47, 0.83);
  vec3 col = mix(horizon, zenith, pow(clamp(dir.y, 0.0, 1.0), 0.55));
  // słońce
  float sun = max(dot(dir, -uLightDir), 0.0);
  col += vec3(1.0, 0.92, 0.75) * pow(sun, 380.0) * 2.2;
  col += vec3(1.0, 0.85, 0.6) * pow(sun, 12.0) * 0.14;
  fragColor = vec4(col, 1.0);
}`

const SHADOW_VS = `#version 300 es
layout(location=0) in vec3 aPos;
uniform mat4 uShadowMat, uModel;
void main() { gl_Position = uShadowMat * uModel * vec4(aPos, 1.0); }`

const SHADOW_FS = `#version 300 es
precision mediump float;
void main() { }`

interface GLMesh {
  vao: WebGLVertexArrayObject
  count: number
  mode: number
}

const SHADOW_SIZE = 2048

export class Renderer {
  gl: WebGL2RenderingContext
  private partProgram!: WebGLProgram
  private skyProgram!: WebGLProgram
  private shadowProgram!: WebGLProgram
  private meshes: Record<string, GLMesh> = {}
  private skyVao!: WebGLVertexArrayObject
  private shadowFbo!: WebGLFramebuffer
  private shadowTex!: WebGLTexture
  private lightDir = normalize([-0.42, -0.78, -0.46])
  private shadowMat: any = new Float32Array(16)
  private proj: any = new Float32Array(16)
  private view: any = new Float32Array(16)
  private model: any = new Float32Array(16)
  frameStats = { parts: 0, drawn: 0 }

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' })
    if (!gl) throw new Error('Ta przeglądarka nie obsługuje WebGL2')
    this.gl = gl
    this.init()
  }

  private compile(vs: string, fs: string): WebGLProgram {
    const gl = this.gl
    const make = (type: number, src: string) => {
      const sh = gl.createShader(type)!
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('Shader: ' + gl.getShaderInfoLog(sh))
      }
      return sh
    }
    const p = gl.createProgram()!
    gl.attachShader(p, make(gl.VERTEX_SHADER, vs))
    gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p))
    return p
  }

  private upload(mesh: MeshData): GLMesh {
    const gl = this.gl
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    const vbo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12)
    const ibo = gl.createBuffer()!
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW)
    gl.bindVertexArray(null)
    return { vao, count: mesh.indices.length, mode: gl.TRIANGLES }
  }

  private init() {
    const gl = this.gl
    this.partProgram = this.compile(PART_VS, PART_FS)
    this.skyProgram = this.compile(SKY_VS, SKY_FS)
    this.shadowProgram = this.compile(SHADOW_VS, SHADOW_FS)
    this.meshes.box = this.upload(boxMesh())
    this.meshes.ball = this.upload(sphereMesh())
    this.meshes.cylinder = this.upload(cylinderMesh())
    this.meshes.wedge = this.upload(wedgeMesh())

    // VAO dla nieba (pełnoekranowy trójkąt)
    this.skyVao = gl.createVertexArray()!
    gl.bindVertexArray(this.skyVao)
    const vbo = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)

    // mapa cieni
    this.shadowTex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, SHADOW_SIZE, SHADOW_SIZE, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.shadowFbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0)
    gl.drawBuffers([gl.NONE])
    gl.readBuffer(gl.NONE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.floor(this.canvas.clientWidth * dpr)
    const h = Math.floor(this.canvas.clientHeight * dpr)
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
  }

  render(world: World, camera: Camera, focus: [number, number, number]) {
    const gl = this.gl
    this.resize()
    const w = this.canvas.width, h = this.canvas.height
    gl.viewport(0, 0, w, h)

    const aspect = w / Math.max(h, 1)
    this.proj = perspectiveArray((camera.fov * Math.PI) / 180, aspect, 0.15, 2500) as unknown as Float32Array
    const camCf = camera.cframe()
    this.view = viewMatrixArray(camCf) as unknown as Float32Array
    const fogColor: [number, number, number] = [0.74, 0.83, 0.92]
    const fogEnd = 700

    // ── 1. mapa cieni ────────────────────────────────────────────────────
    const lightView = lookAtArray(
      [focus[0] - this.lightDir[0] * 120, focus[1] - this.lightDir[1] * 120, focus[2] - this.lightDir[2] * 120],
      focus, [0, 1, 0])
    const lightProj = orthoArray(-60, 60, -60, 60, 1, 400)
    this.shadowMat = multiply(lightProj, lightView) as unknown as Float32Array

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo)
    gl.viewport(0, 0, SHADOW_SIZE, SHADOW_SIZE)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    gl.enable(gl.DEPTH_TEST)
    gl.disable(gl.CULL_FACE)
    gl.useProgram(this.shadowProgram)
    gl.uniformMatrix4fv(gl.getUniformLocation(this.shadowProgram, 'uShadowMat'), false, this.shadowMat)
    const uModelShadow = gl.getUniformLocation(this.shadowProgram, 'uModel')
    this.drawParts(world, (model, mesh, transparent) => {
      if (transparent) return
      gl.uniformMatrix4fv(uModelShadow, false, model)
      gl.bindVertexArray(mesh.vao)
      gl.drawElements(mesh.mode, mesh.count, gl.UNSIGNED_SHORT, 0)
    }, false)

    // ── 2. scena ─────────────────────────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, w, h)
    gl.clearColor(fogColor[0], fogColor[1], fogColor[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    // niebo
    gl.disable(gl.DEPTH_TEST)
    gl.useProgram(this.skyProgram)
    const cf = camCf
    gl.uniform3f(gl.getUniformLocation(this.skyProgram, 'uRight'), cf[3], cf[6], cf[9])
    gl.uniform3f(gl.getUniformLocation(this.skyProgram, 'uUp'), cf[4], cf[7], cf[10])
    gl.uniform3f(gl.getUniformLocation(this.skyProgram, 'uForward'), -cf[5], -cf[8], -cf[11])
    gl.uniform1f(gl.getUniformLocation(this.skyProgram, 'uAspect'), aspect)
    gl.uniform1f(gl.getUniformLocation(this.skyProgram, 'uTanFov'), Math.tan((camera.fov * Math.PI) / 360))
    gl.uniform3f(gl.getUniformLocation(this.skyProgram, 'uLightDir'), ...this.lightDir)
    gl.uniform3f(gl.getUniformLocation(this.skyProgram, 'uFogColor'), ...fogColor)
    gl.bindVertexArray(this.skyVao)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.enable(gl.DEPTH_TEST)

    // bryły
    const prog = this.partProgram
    gl.useProgram(prog)
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uProj'), false, this.proj)
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uView'), false, this.view)
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, 'uShadowMat'), false, this.shadowMat)
    gl.uniform3f(gl.getUniformLocation(prog, 'uLightDir'), ...this.lightDir)
    gl.uniform3f(gl.getUniformLocation(prog, 'uCameraPos'), ...camera.position)
    gl.uniform3f(gl.getUniformLocation(prog, 'uFogColor'), ...fogColor)
    gl.uniform1f(gl.getUniformLocation(prog, 'uFogEnd'), fogEnd)
    gl.uniform3f(gl.getUniformLocation(prog, 'uAmbient'), 0.52, 0.54, 0.6)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex)
    gl.uniform1i(gl.getUniformLocation(prog, 'uShadowTex'), 0)
    const uModel = gl.getUniformLocation(prog, 'uModel')
    const uColor = gl.getUniformLocation(prog, 'uColor')
    const uTransparency = gl.getUniformLocation(prog, 'uTransparency')
    const uEmissive = gl.getUniformLocation(prog, 'uEmissive')

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    this.frameStats = { parts: 0, drawn: 0 }

    // najpierw nieprzezroczyste, potem przezroczyste
    for (const pass of [false, true]) {
      if (pass) gl.depthMask(false)
      else gl.depthMask(true)
      this.drawParts(world, (model, mesh, transparent, color, emissive, alpha) => {
        if (transparent !== pass) return
        gl.uniformMatrix4fv(uModel, false, model)
        gl.uniform3f(uColor, color[0], color[1], color[2])
        gl.uniform1f(uTransparency, Math.max(0, Math.min(1, alpha)))
        gl.uniform1f(uEmissive, emissive)
        gl.bindVertexArray(mesh.vao)
        gl.drawElements(mesh.mode, mesh.count, gl.UNSIGNED_SHORT, 0)
        this.frameStats.drawn++
      }, true)
    }
    gl.depthMask(true)
    gl.disable(gl.BLEND)
  }

  /** Iteruje po wszystkich renderowalnych bryłach świata. */
  private drawParts(
    world: World,
    draw: (model: Float32Array, mesh: GLMesh, transparent: boolean, color: [number, number, number], emissive: number, transparency: number) => void,
    _mainPass: boolean,
  ) {
    for (const inst of world.instances.values()) {
      if (!isAPart(inst.className)) continue
      if (inst.props.Visible === false) continue
      const transparency = Number(inst.props.Transparency ?? 0)
      if (transparency >= 1) continue
      const size = world.size(inst.id)
      if (size.x <= 0 || size.y <= 0 || size.z <= 0) continue
      const cf = world.cframe(inst.id)
      cframeToMatrix(cf, size, this.model)
      const colorRaw = inst.props.Color as number[] | undefined
      const color: [number, number, number] = Array.isArray(colorRaw) && colorRaw.length >= 3
        ? [colorRaw[0], colorRaw[1], colorRaw[2]]
        : [0.64, 0.64, 0.64]
      const material = Number(inst.props.Material ?? 256)
      const emissive = material === 288 ? 1 : material === 1040 ? 0.1 : 0
      const shape = Number(inst.props.Shape ?? 1)
      let mesh = this.meshes.box
      if (inst.className === 'WedgePart' || inst.className === 'CornerWedgePart') mesh = this.meshes.wedge
      else if (shape === 0) mesh = this.meshes.ball
      else if (shape === 2) mesh = this.meshes.cylinder
      if (inst.props.Shape === undefined && inst.className === 'Part') mesh = this.meshes.box
      this.frameStats.parts++
      draw(this.model, mesh, transparency > 0.02, color, emissive, transparency)
    }
  }
}

/* ── macierze pomocnicze ─────────────────────────────────────────────── */

function normalize(v: number[]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}

function perspectiveArray(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2)
  const nf = 1 / (near - far)
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ])
}

function viewMatrixArray(cf: number[]): Float32Array {
  const [x, y, z, r00, r01, r02, r10, r11, r12, r20, r21, r22] = cf
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

function lookAtArray(eye: number[], center: number[], up: number[]): Float32Array {
  const z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]])
  let x = normalize([up[1] * z[2] - up[2] * z[1], up[2] * z[0] - up[0] * z[2], up[0] * z[1] - up[1] * z[0]])
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]]
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]),
    -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]),
    -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]),
    1,
  ])
}

function orthoArray(l: number, r: number, b: number, t: number, n: number, f: number): Float32Array {
  return new Float32Array([
    2 / (r - l), 0, 0, 0,
    0, 2 / (t - b), 0, 0,
    0, 0, -2 / (f - n), 0,
    -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1,
  ])
}
