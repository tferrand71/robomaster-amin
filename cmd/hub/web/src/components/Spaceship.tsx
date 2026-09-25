import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// Conventions: nose towards +Z, up is +Y, starboard (right) is +X.

// --- Materials --------------------------------------------------------------

const hull = new THREE.MeshStandardMaterial({ color: '#d5dce6', metalness: 0.7, roughness: 0.28, flatShading: true })
const armor = new THREE.MeshStandardMaterial({ color: '#1c2331', metalness: 0.8, roughness: 0.35, flatShading: true })
const paint = new THREE.MeshStandardMaterial({ color: '#ff6a2b', metalness: 0.4, roughness: 0.4, flatShading: true })
const canopy = new THREE.MeshPhysicalMaterial({
  color: '#0a1c2e', metalness: 0.1, roughness: 0.05, clearcoat: 1, emissive: '#0b4a7a', emissiveIntensity: 0.6,
  flatShading: true,
})
// Colors above 1 exceed the bloom threshold and glow.
const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.4, 3.2), toneMapped: false })
const nozzleGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 2.6, 5), toneMapped: false })

// --- Geometry helpers -------------------------------------------------------

type Point = [number, number]
/** Cross-section station: z position, half width, half height, vertical center. */
type Station = [z: number, w: number, h: number, y: number]

const HULL_SECTION: Point[] = [
  [0, 1], [0.55, 0.8], [1, 0.1], [0.85, -0.5], [0.35, -1], [-0.35, -1], [-0.85, -0.5], [-1, 0.1], [-0.55, 0.8],
]
const CANOPY_SECTION: Point[] = [[0.35, 1], [0.8, 0.6], [1, 0], [-1, 0], [-0.8, 0.6], [-0.35, 1]]
const OCTAGON: Point[] = Array.from({ length: 8 }, (_, i) => {
  const a = Math.PI / 2 - (i + 0.5) * (Math.PI / 4)
  return [Math.cos(a), Math.sin(a)]
})

/** Faceted solid swept through the stations (ordered nose to tail), capped at both ends. */
function loft(stations: Station[], section: Point[]) {
  const rings = stations.map(([z, w, h, y]) => section.map(([sx, sy]) => new THREE.Vector3(sx * w, y + sy * h, z)))
  const pos: number[] = []
  const tri = (...v: THREE.Vector3[]) => v.forEach(p => pos.push(p.x, p.y, p.z))
  const n = section.length

  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < n; j++) {
      const a = rings[i][j], b = rings[i][(j + 1) % n], c = rings[i + 1][(j + 1) % n], d = rings[i + 1][j]
      tri(a, b, d)
      tri(b, c, d)
    }
  }
  const center = (ring: THREE.Vector3[]) => ring.reduce((s, p) => s.add(p), new THREE.Vector3()).divideScalar(n)
  const front = rings[0], back = rings[rings.length - 1]
  const fc = center(front), bc = center(back)
  for (let j = 0; j < n; j++) {
    tri(fc, front[(j + 1) % n], front[j])
    tri(bc, back[j], back[(j + 1) % n])
  }

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

/** Flat plate lying in the XZ plane, from an outline given as [x, z] points, extruded downwards. */
function plate(outline: Point[], thickness: number) {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, z)))
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: thickness, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1,
  })
  g.rotateX(Math.PI / 2)
  return g
}

/** Vertical plate in the YZ plane, from an outline given as [z, y] points. */
function fin(outline: Point[], thickness: number) {
  const shape = new THREE.Shape(outline.map(([z, y]) => new THREE.Vector2(z, y)))
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
  g.rotateY(-Math.PI / 2) // shape X becomes world +Z (forward)
  g.translate(thickness / 2, 0, 0)
  return g
}

/** Thin bar between two points. */
function Strip({ from, to, size = 0.035, material = glow }: {
  from: [number, number, number]; to: [number, number, number]; size?: number; material?: THREE.Material
}) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to)
    const dir = b.clone().sub(a)
    return {
      position: a.clone().add(b).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.clone().normalize()),
      length: dir.length(),
    }
  }, [from, to])
  return (
    <mesh position={position} quaternion={quaternion} material={material}>
      <boxGeometry args={[size, size, length]} />
    </mesh>
  )
}

function useShipGeometry() {
  return useMemo(() => ({
    fuselage: loft([
      [5.6, 0.04, 0.04, -0.05],
      [4.6, 0.32, 0.22, 0],
      [3.0, 0.68, 0.42, 0.05],
      [1.0, 0.95, 0.58, 0.1],
      [-1.5, 1.1, 0.65, 0.1],
      [-3.3, 1.0, 0.6, 0.05],
      [-3.9, 0.85, 0.48, 0.05],
    ], HULL_SECTION),
    noseCap: loft([
      [5.62, 0.045, 0.045, -0.05],
      [4.9, 0.24, 0.17, -0.01],
      [4.55, 0.33, 0.23, 0],
    ], HULL_SECTION),
    canopy: loft([
      [3.4, 0.04, 0.02, 0.48],
      [2.6, 0.36, 0.3, 0.44],
      [1.3, 0.46, 0.4, 0.5],
      [0.3, 0.36, 0.26, 0.56],
      [-0.3, 0.08, 0.05, 0.6],
    ], CANOPY_SECTION),
    spine: loft([
      [0.2, 0.05, 0.04, 0.72],
      [-0.6, 0.22, 0.12, 0.74],
      [-3.4, 0.26, 0.12, 0.66],
      [-3.9, 0.2, 0.08, 0.55],
    ], HULL_SECTION),
    nacelle: loft([
      [-0.4, 0.12, 0.1, 0],
      [-1.1, 0.44, 0.4, 0],
      [-3.6, 0.5, 0.46, 0],
      [-4.25, 0.44, 0.4, 0],
    ], OCTAGON),
    wing: plate([[0.7, 1.4], [4.3, -1.9], [4.5, -2.7], [2.6, -2.6], [0.7, -3.4]], 0.1),
    wingArmor: plate([[1.4, -0.2], [3.4, -1.9], [3.5, -2.35], [1.4, -2.7]], 0.02),
    canard: plate([[0.55, 3.1], [1.7, 2.1], [1.75, 1.8], [0.55, 1.9]], 0.06),
    fin: fin([[-1.2, 0], [-3.0, 1.7], [-3.7, 1.75], [-3.9, 0]], 0.08),
  }), [])
}

// --- Parts ------------------------------------------------------------------

/** Engine nozzle with a glowing core and an exhaust plume scaled by `power`. */
function Thruster({ position, radius, power }: { position: [number, number, number]; radius: number; power: number }) {
  const outer = useRef<THREE.Mesh>(null!)
  const inner = useRef<THREE.Mesh>(null!)
  const light = useRef<THREE.PointLight>(null!)
  const seed = position[0] * 7.3

  useFrame(({ clock }) => {
    const f = 1 + Math.sin(clock.elapsedTime * 38 + seed) * 0.07 + Math.random() * 0.05
    const len = power * f
    outer.current.scale.set(1, len, 1)
    outer.current.position.z = -(1.1 * len)
    inner.current.scale.set(1, len * 0.7, 1)
    inner.current.position.z = -(0.75 * len)
    light.current.intensity = 6 + power * 10 * f
  })

  return (
    <group position={position}>
      <mesh material={armor} rotation-x={Math.PI / 2} position-z={0.05}>
        <cylinderGeometry args={[radius * 1.05, radius * 1.2, 0.35, 8, 1, true]} />
      </mesh>
      <mesh material={nozzleGlow} rotation-y={Math.PI} position-z={0.02}>
        <circleGeometry args={[radius * 0.92, 24]} />
      </mesh>
      <mesh ref={outer} rotation-x={-Math.PI / 2}>
        <coneGeometry args={[radius * 0.9, 2.2, 24, 1, true]} />
        <meshBasicMaterial color={new THREE.Color(0.2, 0.9, 2.4)} transparent opacity={0.35}
          blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={inner} rotation-x={-Math.PI / 2}>
        <coneGeometry args={[radius * 0.5, 2.2, 24, 1, true]} />
        <meshBasicMaterial color={new THREE.Color(2.5, 3.5, 5)} transparent opacity={0.6}
          blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <pointLight ref={light} color="#4fc3ff" distance={8} decay={1.5} position-z={-0.8} />
    </group>
  )
}

/** Navigation light that blinks with the given phase. */
function NavLight({ position, color, phase }: { position: [number, number, number]; color: THREE.Color; phase: number }) {
  const mat = useRef<THREE.MeshBasicMaterial>(null!)
  useFrame(({ clock }) => {
    const on = (clock.elapsedTime + phase) % 1.6 < 0.12
    mat.current.color.copy(color).multiplyScalar(on ? 4 : 0.4)
  })
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.07, 12, 8]} />
      <meshBasicMaterial ref={mat} toneMapped={false} />
    </mesh>
  )
}

const GREEN = new THREE.Color(0.2, 1, 0.5)
const RED = new THREE.Color(1, 0.15, 0.2)

/** Everything mirrored on both sides; built for starboard, flipped for port. */
function Side({ side, geo, power }: { side: 1 | -1; geo: ReturnType<typeof useShipGeometry>; power: number }) {
  return (
    <group scale-x={side}>
      {/* Main wing, slight anhedral */}
      <group position={[0, -0.12, 0]} rotation-z={-0.07}>
        <mesh geometry={geo.wing} material={hull} />
        <mesh geometry={geo.wingArmor} material={armor} position-y={0.05} />
        <Strip from={[0.9, 0.02, 1.1]} to={[4.2, 0.02, -1.8]} size={0.03} />
        <Strip from={[2.7, 0.03, -2.55]} to={[4.4, 0.03, -2.65]} size={0.05} material={paint} />

        {/* Wing-tip cannon */}
        <mesh material={armor} position={[4.45, -0.08, -0.6]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.13, 0.16, 3.6, 8]} />
        </mesh>
        <mesh material={hull} position={[4.45, -0.08, 1.9]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.05, 0.05, 1.8, 8]} />
        </mesh>
        <mesh material={glow} position={[4.45, -0.08, 2.82]}>
          <sphereGeometry args={[0.045, 8, 6]} />
        </mesh>
        <NavLight position={[4.45, 0.1, -2.35]} color={side > 0 ? GREEN : RED} phase={side > 0 ? 0 : 0.8} />
      </group>

      {/* Canard */}
      <mesh geometry={geo.canard} material={paint} position={[0.2, 0.05, 0]} rotation-z={0.05} />

      {/* Engine nacelle with thruster */}
      <mesh geometry={geo.nacelle} material={armor} position={[1.35, -0.05, 0]} />
      <Strip from={[1.35, 0.42, -1.2]} to={[1.35, 0.42, -3.5]} size={0.04} />
      <mesh material={hull} position={[1.35, -0.48, -2.2]}>
        <boxGeometry args={[0.35, 0.12, 1.4]} />
      </mesh>
      <Thruster position={[1.35, -0.05, -4.25]} radius={0.4} power={power} />

      {/* Canted twin tail fin, swept back */}
      <group position={[0.5, 0.52, 0]} rotation-z={-0.38}>
        <mesh geometry={geo.fin} material={hull} />
        <Strip from={[0, 1.72, -3.05]} to={[0, 1.72, -3.65]} size={0.1} material={paint} />
        <Strip from={[0, 0.05, -1.3]} to={[0, 1.65, -2.95]} size={0.03} />
      </group>

      {/* Hull side light line and intake */}
      <Strip from={[0.89, -0.05, 1.0]} to={[1.03, -0.05, -1.5]} />
      <mesh material={armor} position={[0.82, -0.28, 1.4]} rotation-y={-0.12}>
        <boxGeometry args={[0.28, 0.24, 1.2]} />
      </mesh>
    </group>
  )
}

/** Sci-fi fighter. Exhaust length follows `battery` (0–100). */
export default function Spaceship({ battery }: { battery: number }) {
  const geo = useShipGeometry()
  const ship = useRef<THREE.Group>(null!)
  const power = 0.45 + (battery / 100) * 0.75

  useFrame(({ clock }) => {
    const t = clock.elapsedTime
    ship.current.position.y = Math.sin(t * 1.1) * 0.22
    ship.current.rotation.z = Math.sin(t * 0.7) * 0.07
    ship.current.rotation.x = Math.sin(t * 0.5) * 0.035
  })

  return (
    <group ref={ship} position-z={-0.6}>
      <mesh geometry={geo.fuselage} material={hull} />
      <mesh geometry={geo.noseCap} material={armor} scale={1.02} />
      <mesh geometry={geo.canopy} material={canopy} />
      <mesh geometry={geo.spine} material={armor} />
      <Strip from={[0, 0.84, -0.8]} to={[0, 0.84, -3.3]} size={0.04} />

      <Side side={1} geo={geo} power={power} />
      <Side side={-1} geo={geo} power={power} />

      {/* Main engine */}
      <Thruster position={[0, 0.08, -3.9]} radius={0.5} power={power * 1.1} />
    </group>
  )
}
