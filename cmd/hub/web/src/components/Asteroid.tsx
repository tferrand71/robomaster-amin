import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import * as THREE from 'three'

const FAR_Z = 52 // where it appears, lost in the fog
const NEAR_Z = 13 // where it stops, just in front of the ship's nose
const APPROACH_RATE = 0.3 // lower is slower
const RADIUS = 3.4

const LASER_TIME = 0.8 // how long the beams stay on (s)
const IMPACT_TIME = 0.35 // when the rock breaks, after the beams start (s)
const DEBRIS_TIME = 3.5 // how long the debris flies before everything resets (s)
const DEBRIS_COUNT = 28
const FIREBALL_TIME = 1.4 // how long the fireball burns (s)
const SHOCKWAVE_TIME = 1.1 // how long the shockwave ring takes to fade (s)
const SPARK_TIME = 1.8 // how long the sparks fly (s)
const SPARK_COUNT = 260
const BURST_RATE = 2.5 // suppressive bursts per second while auto mode engages the rock
const BURST_DUTY = 0.35 // fraction of each burst period the beams are on

// Wing-tip cannons, in scene coordinates (see Spaceship).
const CANNONS = [new THREE.Vector3(4.44, -0.5, 2.2), new THREE.Vector3(-4.44, -0.5, 2.2)]

const rock = new THREE.MeshStandardMaterial({ color: '#6e5d50', roughness: 0.95, metalness: 0.05, flatShading: true })
const beamOuter = new THREE.MeshBasicMaterial({
  color: new THREE.Color(4, 0.25, 0.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
})
const beamCore = new THREE.MeshBasicMaterial({
  color: new THREE.Color(6, 4, 4), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
})
const flashMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color(6, 3, 1.5), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
})
const fireballMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
})
const shockwaveMaterial = new THREE.MeshBasicMaterial({
  color: new THREE.Color(3, 1.6, 0.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  toneMapped: false, side: THREE.DoubleSide,
})
const sparkMaterial = new THREE.PointsMaterial({
  color: new THREE.Color(5, 2.6, 1), size: 0.18, transparent: true, blending: THREE.AdditiveBlending,
  depthWrite: false, toneMapped: false,
})
// Debris glow hot at first, then cool down to plain rock.
const emberMaterial = new THREE.MeshStandardMaterial({
  color: '#6e5d50', roughness: 0.95, metalness: 0.05, flatShading: true, emissive: new THREE.Color(1, 0.35, 0.08),
})
const FIRE_HOT = new THREE.Color(6, 4.5, 2.5)
const FIRE_COOL = new THREE.Color(2.2, 0.4, 0.1)

/** Lumpy rock: an icosphere pushed in and out by a few overlapping waves. */
function rockGeometry(radius: number, detail: number, seed: number) {
  const g = new THREE.IcosahedronGeometry(radius, detail)
  const p = g.attributes.position
  const v = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const n = v.clone().normalize()
    const bump =
      0.22 * Math.sin(n.x * 3.1 + seed) * Math.cos(n.y * 2.7 + seed) +
      0.12 * Math.sin(n.y * 6.3 + n.z * 5.1 + seed) +
      0.06 * Math.sin(n.z * 11.7 + n.x * 9.2)
    v.multiplyScalar(1 + bump)
    p.setXYZ(i, v.x, v.y, v.z)
  }
  g.scale(1, 0.85, 1.1)
  g.computeVertexNormals()
  return g
}

interface Debris {
  geometry: THREE.BufferGeometry
  velocity: THREE.Vector3
  spin: THREE.Vector3
  size: number
}

type Phase = 'idle' | 'approach' | 'laser' | 'debris'

/**
 * Asteroid that drifts slowly towards the ship while `active` and backs off
 * when it is not. While `firing`, the ship's lasers pulse at it; each increment
 * of `shots` fires a full blast that breaks it apart.
 */
export default function Asteroid({ active, firing, shots }: { active: boolean; firing: boolean; shots: number }) {
  const geometry = useMemo(() => rockGeometry(RADIUS, 4, 1.3), [])
  const debris = useMemo<Debris[]>(() => Array.from({ length: DEBRIS_COUNT }, (_, i) => ({
    geometry: rockGeometry(0.35 + Math.random() * 0.7, 0, i),
    velocity: new THREE.Vector3().randomDirection().multiplyScalar(3 + Math.random() * 7),
    spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(4),
    size: 0.7 + Math.random() * 0.8,
  })), [])

  const sparks = useMemo(() => {
    const velocities = Array.from({ length: SPARK_COUNT }, () =>
      new THREE.Vector3().randomDirection().multiplyScalar(6 + Math.random() * 16))
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SPARK_COUNT * 3), 3))
    return { velocities, geometry }
  }, [])

  const group = useRef<THREE.Group>(null!)
  const rockMesh = useRef<THREE.Mesh>(null!)
  const danger = useRef<THREE.PointLight>(null!)
  const beams = useRef<THREE.Group>(null!)
  const flash = useRef<THREE.Mesh>(null!)
  const flashLight = useRef<THREE.PointLight>(null!)
  const fireball = useRef<THREE.Mesh>(null!)
  const shockwave = useRef<THREE.Mesh>(null!)
  const sparkPoints = useRef<THREE.Points>(null!)
  const pieces = useRef<THREE.Mesh[]>([])

  const phase = useRef<Phase>('idle')
  const phaseStart = useRef(0)
  const fireRequested = useRef(false)

  const lastShots = useRef(shots)
  useEffect(() => {
    if (shots !== lastShots.current) fireRequested.current = true
    lastShots.current = shots
  }, [shots])

  // Stretch a beam (unit cylinder along Y) from a cannon to the rock.
  const aimBeams = (target: THREE.Vector3) => {
    beams.current.children.forEach((beam, i) => {
      const from = CANNONS[i >> 1]
      const dir = target.clone().sub(from)
      beam.position.copy(from).addScaledVector(dir, 0.5)
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
      beam.scale.y = dir.length()
    })
  }

  useFrame(({ clock }, dt) => {
    const now = clock.elapsedTime
    let t = now - phaseStart.current
    const g = group.current
    // Reset t too: several phases can follow each other within one frame.
    const enter = (p: Phase) => { phase.current = p; phaseStart.current = now; t = 0 }

    if (phase.current === 'idle') {
      fireRequested.current = false
      if (active) {
        g.position.z = FAR_Z + 10
        rockMesh.current.visible = true
        enter('approach')
      }
    }

    if (phase.current === 'approach') {
      const target = active ? NEAR_Z : FAR_Z + 10
      g.position.z += (target - g.position.z) * (1 - Math.exp(-dt * APPROACH_RATE))
      if (fireRequested.current) {
        fireRequested.current = false
        enter('laser')
      } else if (!active && g.position.z > FAR_Z + 5) {
        enter('idle')
      } else if (firing) {
        aimBeams(g.position)
        const on = (now * BURST_RATE) % 1 < BURST_DUTY
        const flicker = 0.7 + Math.random() * 0.3
        beamOuter.opacity = on ? 0.35 * flicker : 0
        beamCore.opacity = on ? 0.7 * flicker : 0
      }
    }

    if (phase.current === 'laser') {
      aimBeams(g.position)
      const fade = 1 - t / LASER_TIME
      const flicker = 0.75 + Math.random() * 0.25
      beamOuter.opacity = 0.6 * fade * flicker
      beamCore.opacity = fade * flicker
      if (t >= IMPACT_TIME && rockMesh.current.visible) {
        rockMesh.current.visible = false
        pieces.current.forEach(p => { p.position.set(0, 0, 0); p.rotation.set(0, 0, 0) })
        ;(sparks.geometry.attributes.position.array as Float32Array).fill(0)
        enter('debris')
      }
    }

    if (phase.current === 'debris') {
      const beamT = t + IMPACT_TIME
      const fade = Math.max(0, 1 - beamT / LASER_TIME)
      beamOuter.opacity = 0.6 * fade
      beamCore.opacity = fade

      pieces.current.forEach((p, i) => {
        const d = debris[i]
        p.position.addScaledVector(d.velocity, dt * Math.exp(-t * 0.6))
        p.rotation.x += d.spin.x * dt
        p.rotation.y += d.spin.y * dt
        p.scale.setScalar(d.size * Math.max(0, 1 - t / DEBRIS_TIME))
      })
      const burst = Math.max(0, 1 - t / 0.6)
      flash.current.scale.setScalar(1 + t * 14)
      flashMaterial.opacity = burst
      flashLight.current.intensity = 80 * burst + 30 * Math.max(0, 1 - t / FIREBALL_TIME)

      // Fireball: swells fast, then cools from white-hot to dark red while fading.
      const fire = Math.min(1, t / FIREBALL_TIME)
      fireball.current.scale.setScalar(RADIUS * (0.6 + 1.6 * (1 - Math.pow(1 - fire, 3))))
      fireballMaterial.color.lerpColors(FIRE_HOT, FIRE_COOL, Math.min(1, fire * 1.6))
      fireballMaterial.opacity = 0.9 * Math.pow(1 - fire, 1.5)

      // Shockwave: a thin ring racing outwards.
      const wave = Math.min(1, t / SHOCKWAVE_TIME)
      shockwave.current.scale.setScalar(1 + wave * 16)
      shockwaveMaterial.opacity = Math.pow(1 - wave, 2)

      // Sparks: fast, slowing down, fading out.
      const pos = sparks.geometry.attributes.position as THREE.BufferAttribute
      const drag = dt * Math.exp(-t * 1.5)
      sparks.velocities.forEach((v, i) => {
        pos.setXYZ(i, pos.getX(i) + v.x * drag, pos.getY(i) + v.y * drag, pos.getZ(i) + v.z * drag)
      })
      pos.needsUpdate = true
      sparkMaterial.opacity = Math.max(0, 1 - t / SPARK_TIME)

      emberMaterial.emissiveIntensity = 3 * Math.max(0, 1 - t / 1.5)

      if (t >= DEBRIS_TIME) enter('idle')
    }

    const p = phase.current
    g.visible = p !== 'idle' && g.position.z < FAR_Z + 5
    beams.current.visible = p === 'laser' || (p === 'debris' && t < LASER_TIME - IMPACT_TIME) ||
      (p === 'approach' && firing && g.visible)
    flash.current.visible = p === 'debris' && t < 0.6
    fireball.current.visible = p === 'debris' && t < FIREBALL_TIME
    shockwave.current.visible = p === 'debris' && t < SHOCKWAVE_TIME
    sparkPoints.current.visible = p === 'debris' && t < SPARK_TIME
    pieces.current.forEach(m => { m.visible = p === 'debris' })
    danger.current.intensity = active && (p === 'approach' || p === 'laser') ? 14 + Math.sin(now * 5) * 9 : 0
    rockMesh.current.rotation.x += dt * 0.1
    rockMesh.current.rotation.y += dt * 0.06
  })

  return (
    <>
      <group ref={group} position={[0.4, 0.8, FAR_Z + 10]}>
        <mesh ref={rockMesh} geometry={geometry} material={rock} />
        <pointLight ref={danger} color="#ff2a2a" distance={14} decay={1.5} position={[0, 0, -RADIUS - 1.5]} />
        {debris.map((d, i) => (
          <mesh key={i} ref={m => { if (m) pieces.current[i] = m }} geometry={d.geometry} material={emberMaterial} visible={false} />
        ))}
        <mesh ref={flash} material={flashMaterial} visible={false}>
          <sphereGeometry args={[0.5, 24, 16]} />
        </mesh>
        <mesh ref={fireball} material={fireballMaterial} visible={false}>
          <icosahedronGeometry args={[1, 3]} />
        </mesh>
        <Billboard>
          <mesh ref={shockwave} material={shockwaveMaterial} visible={false}>
            <ringGeometry args={[0.92, 1, 96]} />
          </mesh>
        </Billboard>
        <points ref={sparkPoints} geometry={sparks.geometry} material={sparkMaterial} visible={false} />
        <pointLight ref={flashLight} color="#ffae5c" distance={40} decay={1.2} intensity={0} />
      </group>

      {/* Two beams per cannon: a wide red glow around a thin white-hot core. */}
      <group ref={beams} visible={false}>
        {CANNONS.flatMap((_, i) => [
          <mesh key={`o${i}`} material={beamOuter}><cylinderGeometry args={[0.16, 0.16, 1, 12, 1, true]} /></mesh>,
          <mesh key={`c${i}`} material={beamCore}><cylinderGeometry args={[0.05, 0.05, 1, 8, 1, true]} /></mesh>,
        ])}
      </group>
    </>
  )
}
