/**
 * character.ts — postać gracza w stylu R6 (klasyczny „noob” z Robloxa).
 *
 * Składa się z 6 części (Head, Torso, 2 ręce, 2 nogi), modelu i Humanoida.
 * Kontroler odtwarza zachowanie Humanoida: WalkSpeed 16, JumpPower 50,
 * grawitacja 196.2, wchodzenie po schodach, animacja chodu.
 */
import { GRAVITY, moveBox } from './physics'
import type { PartBox } from './query'
import type { World } from './world'

export interface CharInput {
  moveX: number
  moveZ: number
  jump: boolean
  cameraYaw: number
}

export interface RigParts {
  torso: number
  head: number
  leftArm: number
  rightArm: number
  leftLeg: number
  rightLeg: number
}

const WALK_SPEED = 16
const JUMP_POWER = 50
/** połowa wysokości kolizji postaci (5 studów wzrostu) */
const HALF_HEIGHT = 2.5
const HALF_WIDTH = 1.0
const HALF_DEPTH = 0.55

export class Character {
  modelId: number
  humanoidId: number
  parts: RigParts
  /** pozycja = środek torsu */
  pos: [number, number, number]
  vel: [number, number, number] = [0, 0, 0]
  grounded = false
  facing = 0
  walkPhase = 0
  dead = false
  health = 100
  respawnTimer = 0

  constructor(public world: World, name: string, spawn: [number, number, number], parentId = 2, colors = {
    head: [0.96, 0.8, 0.19], torso: [0.11, 0.4, 0.67], arms: [0.96, 0.8, 0.19], legs: [0.29, 0.6, 0.29],
  }) {
    const model = world.create('Model', { Name: name }, parentId)
    this.modelId = model.id
    const mk = (partName: string, size: number[], offset: number[], color: number[]) =>
      // części postaci są w pełni sterowane przez kontroler (jak zespawany rig),
      // więc są zakotwiczone — fizyka nie rusza nimi, a styki liczy kontroler
      world.create('Part', {
        Name: partName, Size: size, Color: color, Anchored: true,
        CFrame: [spawn[0] + offset[0], spawn[1] + offset[1], spawn[2] + offset[2], 1, 0, 0, 0, 1, 0, 0, 0, 1],
        CanCollide: false, Material: 256, TopSurface: 0, BottomSurface: 0,
      }, this.modelId).id

    this.parts = {
      torso: mk('Torso', [2, 2, 1], [0, 0, 0], colors.torso),
      head: mk('Head', [2, 1, 1], [0, 1.5, 0], colors.head),
      leftArm: mk('Left Arm', [1, 2, 1], [-1.5, 0, 0], colors.arms),
      rightArm: mk('Right Arm', [1, 2, 1], [1.5, 0, 0], colors.arms),
      leftLeg: mk('Left Leg', [1, 2, 1], [-0.5, -2, 0], colors.legs),
      rightLeg: mk('Right Leg', [1, 2, 1], [0.5, -2, 0], colors.legs),
    }
    const humanoid = world.create('Humanoid', {
      Name: 'Humanoid', Health: 100, MaxHealth: 100, WalkSpeed: WALK_SPEED, JumpPower: JUMP_POWER,
    }, this.modelId)
    this.humanoidId = humanoid.id
    this.pos = [spawn[0], spawn[1], spawn[2]]
  }

  get size(): [number, number, number] {
    return [HALF_WIDTH * 2, HALF_HEIGHT * 2, HALF_DEPTH * 2]
  }

  update(dt: number, input: CharInput, boxes: PartBox[]) {
    const humanoid = this.world.get(this.humanoidId)
    if (!humanoid) return
    this.health = Number(humanoid.props.Health ?? 100)
    if (this.health <= 0) {
      if (!this.dead) {
        this.dead = true
        this.world.setProp(this.modelId, 'Dead', true)
      }
      this.applyRig(this.pos, 0, true)
      return
    }
    this.dead = false

    const walkSpeed = Number(humanoid.props.WalkSpeed ?? WALK_SPEED)
    // kierunek ruchu względem kamery
    const camYaw = input.cameraYaw
    const forward = { x: -Math.sin(camYaw), z: -Math.cos(camYaw) }
    const right = { x: Math.cos(camYaw), z: -Math.sin(camYaw) }
    let dx = forward.x * input.moveZ + right.x * input.moveX
    let dz = forward.z * input.moveZ + right.z * input.moveX
    const mag = Math.hypot(dx, dz)
    if (mag > 1) { dx /= mag; dz /= mag }

    const targetVX = dx * walkSpeed
    const targetVZ = dz * walkSpeed
    // przyspieszenie jak w Humanoidzie (gwałtowne, ale nie natychmiastowe)
    const accel = this.grounded ? 0.35 : 0.12
    this.vel[0] += (targetVX - this.vel[0]) * accel
    this.vel[2] += (targetVZ - this.vel[2]) * accel
    if (mag < 0.01 && this.grounded) {
      this.vel[0] *= 0.6
      this.vel[2] *= 0.6
    }

    const jumpPower = Number(humanoid.props.JumpPower ?? JUMP_POWER)
    if (input.jump && this.grounded) {
      this.vel[1] = jumpPower
      this.grounded = false
    }
    this.vel[1] -= GRAVITY * dt
    if (this.vel[1] < -250) this.vel[1] = -250

    // obrót w stronę ruchu
    if (mag > 0.1) {
      const targetFacing = Math.atan2(-dx, -dz)
      let diff = targetFacing - this.facing
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      this.facing += diff * Math.min(1, dt * 14)
    }

    const delta: [number, number, number] = [this.vel[0] * dt, this.vel[1] * dt, this.vel[2] * dt]
    const res = moveBox(this.pos, this.size, delta, boxes, new Set())
    const movedY = res.pos[1] - this.pos[1]
    this.pos = res.pos
    if (res.grounded) {
      if (this.vel[1] < 0) this.vel[1] = 0
      this.grounded = true
    } else {
      this.grounded = false
      if (res.hitNormalY === -1) this.vel[1] = 0
    }
    // jeśli ruch został zablokowany poziomo — wyzeruj składową
    if (Math.abs((this.pos[0] - (res.pos[0] - delta[0]))) > 100) { /* noop */ }

    // animacja chodu
    const horizontalSpeed = Math.hypot(this.vel[0], this.vel[2])
    if (this.grounded && horizontalSpeed > 0.5) this.walkPhase += dt * horizontalSpeed * 0.55
    else this.walkPhase *= 0.9

    this.applyRig(this.pos, this.walkPhase, false, movedY)
    // synchronizacja właściwości dla skryptów
    this.world.setProp(this.humanoidId, 'Grounded', this.grounded)
  }

  /**
   * Ustawia CFrame wszystkich sześciu części (R6). Kolejność transformacji:
   * obrót kończyny wokół zawiasu (Rx) → obrót całej postaci (Ry, `facing`).
   * Części są podnoszone o 0.5 studa, bo pudło kolizji jest wyśrodkowane
   * na torsie, a stopy modelu sięgają 3 study pod jego środek.
   */
  private applyRig(pos: [number, number, number], phase: number, dead: boolean, _movedY = 0) {
    const swing = dead ? 0 : Math.sin(phase) * 0.65
    const swing2 = dead ? 0 : Math.sin(phase + Math.PI) * 0.65
    const yaw = this.facing
    const cy = Math.cos(yaw), sy = Math.sin(yaw)
    const lift = dead ? -1.5 : 0.5

    const setPart = (id: number, offset: [number, number, number], rotX = 0, pivotY = 0) => {
      const px = offset[0], py = offset[1] + pivotY, pz = offset[2]
      const ca = Math.cos(rotX), sa = Math.sin(rotX)
      // wektor od zawiasu do środka części, obrócony wokół osi X
      const relY = offset[1] - py, relZ = offset[2] - pz
      const lx = px
      const ly = py + relY * ca - relZ * sa
      const lz = pz + relY * sa + relZ * ca
      // lokalne (lx, ly, lz) → świat przez obrót wokół Y
      const wx = pos[0] + lx * cy + lz * sy
      const wy = pos[1] + lift + ly
      const wz = pos[2] - lx * sy + lz * cy
      // R = Ry(yaw) * Rx(rotX)
      this.world.setProp(id, 'CFrame', [
        wx, wy, wz,
        cy, sy * sa, sy * ca,
        0, ca, -sa,
        -sy, cy * sa, cy * ca,
      ])
    }

    setPart(this.parts.torso, [0, 0, 0])
    setPart(this.parts.head, [0, 1.5, 0])
    setPart(this.parts.leftArm, [-1.5, 0, 0], swing2, 1)
    setPart(this.parts.rightArm, [1.5, 0, 0], swing, 1)
    setPart(this.parts.leftLeg, [-0.5, -2, 0], swing, 1)
    setPart(this.parts.rightLeg, [0.5, -2, 0], swing2, 1)
  }

  /** Zbiór AABB części postaci — do wykrywania styku z innymi obiektami. */
  boxes(): PartBox[] {
    const out: PartBox[] = []
    for (const key of Object.keys(this.parts) as Array<keyof RigParts>) {
      const id = this.parts[key]
      const cf = this.world.cframe(id)
      const s = this.world.size(id)
      out.push({
        id,
        min: [cf[0] - s.x / 2, cf[1] - s.y / 2, cf[2] - s.z / 2],
        max: [cf[0] + s.x / 2, cf[1] + s.y / 2, cf[2] + s.z / 2],
      })
    }
    return out
  }

  destroy() {
    this.world.destroy(this.modelId)
  }
}
