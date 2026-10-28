/**
 * math.test.ts — testy macierzy kamery i CFrame↔macierz.
 * Sprawdzają konwencję: CFrame = [x,y,z, R00,R01,R02, R10,R11,R12, R20,R21,R22]
 * (wiersze), a macierze WebGL są column-major.
 */
import { Camera, multiply, viewMatrix } from '../src/engine/camera'
import { cframeToMatrix } from '../src/engine/world'

let fails = 0
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)
  if (!cond) fails++
}

function project(cf: number[], point: [number, number, number], aspect = 16 / 9) {
  const view = viewMatrix(cf)
  const f = 1 / Math.tan((70 * Math.PI) / 360)
  const proj = new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, -1, -1, 0, 0, -0.3, 0])
  const m = multiply(proj, view)
  const x = point[0], y = point[1], z = point[2]
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12]
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13]
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15]
  return { x: cx / cw, y: cy / cw, w: cw }
}

// 1. punkt dokładnie przed kamerą trafia w środek ekranu (dowolny yaw)
for (const yaw of [0, 0.7, 2.2, Math.PI, -1.3]) {
  const cam = new Camera()
  cam.yaw = yaw
  cam.pitch = 0.1
  cam.distance = 12
  cam.target = [3, 5, -2]
  cam.update(1, [3, 5, -2], 0, 0, 0)
  const cf = cam.cframe()
  const fwd = cam.forward()
  const ahead: [number, number, number] = [
    cf[0] + fwd[0] * 20, cf[1] + fwd[1] * 20, cf[2] + fwd[2] * 20,
  ]
  const p = project(cf, ahead)
  check(`yaw=${yaw.toFixed(2)}: punkt przed kamera w srodku ekranu`, near(p.x, 0, 1e-3) && near(p.y, 0, 1e-3),
    `ndc=(${p.x.toFixed(3)}, ${p.y.toFixed(3)})`)
}

// 2. macierz rotacji CFrame jest ortonormalna i prawoskretna (det = +1)
{
  const cam = new Camera()
  cam.yaw = 0.9
  cam.pitch = -0.4
  cam.update(1, [1, 2, 3], 0, 0, 0)
  const c = cam.cframe()
  const R = [c[3], c[4], c[5], c[6], c[7], c[8], c[9], c[10], c[11]]
  const rows = [[R[0], R[1], R[2]], [R[3], R[4], R[5]], [R[6], R[7], R[8]]]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const det =
    rows[0][0] * (rows[1][1] * rows[2][2] - rows[1][2] * rows[2][1]) -
    rows[0][1] * (rows[1][0] * rows[2][2] - rows[1][2] * rows[2][0]) +
    rows[0][2] * (rows[1][0] * rows[2][1] - rows[1][1] * rows[2][0])
  check('rotacja ortonormalna', near(dot(rows[0], rows[0]), 1, 1e-6) && near(dot(rows[0], rows[1]), 0, 1e-6))
  check('rotacja prawoskretna (det=+1)', near(det, 1, 1e-6), `det=${det.toFixed(4)}`)
  // LookVector = -R02,-R12,-R22 = -trzecia kolumna
  const look = [-R[2], -R[5], -R[8]]
  const fwd = cam.forward()
  check('forward() = LookVector', near(look[0], fwd[0], 1e-6) && near(look[1], fwd[1], 1e-6) && near(look[2], fwd[2], 1e-6))
}

// 3. cframeToMatrix: lokalny +X po obrocie o -90° wokół Y daje światowe (0,0,1)
{
  const cf = [0, 0, 0, 0, 0, -1, 0, 1, 0, 1, 0, 0] // CFrame.Angles(0, -pi/2, 0)
  const m = cframeToMatrix(cf, { x: 1, y: 1, z: 1 }, new Float32Array(16))
  const wx = m[0] * 1 + m[4] * 0 + m[8] * 0
  const wy = m[1] * 1 + m[5] * 0 + m[9] * 0
  const wz = m[2] * 1 + m[6] * 0 + m[10] * 0
  check('cframeToMatrix obraca lokalny +X na swiat', near(wx, 0, 1e-6) && near(wy, 0, 1e-6) && near(wz, 1, 1e-6),
    `(${wx.toFixed(2)}, ${wy.toFixed(2)}, ${wz.toFixed(2)})`)
}

console.log(fails === 0 ? '\n✅ wszystkie testy macierzy przeszły' : `\n❌ ${fails} błąd(ów)`)
process.exit(fails === 0 ? 0 : 1)
