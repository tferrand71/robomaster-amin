import { Canvas } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls, Stars } from '@react-three/drei'
import { Bloom, EffectComposer, ToneMapping, Vignette } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { useEffect } from 'react'
import Asteroid from '../components/Asteroid'
import Spaceship from '../components/Spaceship'
import { useRobotStats } from '../useRobotStats'

const level = (p: number) => (p > 50 ? 'var(--ok)' : p > 20 ? 'var(--warn)' : 'var(--bad)')
const pad = (n: number) => String(Math.floor(n)).padStart(2, '0')
const duration = (s: number) => `${pad(s / 3600)}:${pad((s / 60) % 60)}:${pad(s % 60)}`

function Gauge({ label, value, unit, percent }: { label: string; value: number; unit: string; percent: number }) {
  return (
    <div className="card">
      <div className="label">{label}</div>
      <div className="value">{value}<small>{unit}</small></div>
      <div className="bar"><i style={{ width: `${percent}%`, background: level(percent) }} /></div>
    </div>
  )
}

function ObstacleAlert({ autoMode }: { autoMode: boolean }) {
  return (
    <div className={autoMode ? 'alert auto' : 'alert'} role="alert">
      <svg className="alert-sign" viewBox="0 0 100 88" aria-hidden="true">
        <path d="M50 4 L96 84 H4 Z" fill="none" stroke="currentColor" strokeWidth="8" strokeLinejoin="round" />
        <rect x="45" y="30" width="10" height="30" rx="3" fill="currentColor" />
        <circle cx="50" cy="71" r="6" fill="currentColor" />
      </svg>
      <div>
        <div className="alert-title">WARNING</div>
        <div className="alert-text">
          {autoMode ? 'Obstacle détecté : tir automatique en cours' : 'Obstacle détecté : veuillez prendre le contrôle'}
        </div>
      </div>
      {/* The manual controls page served by the hub. */}
      {!autoMode && <a className="take-control" href="/">Prendre le contrôle</a>}
    </div>
  )
}

export default function Interface() {
  const { stats: s, toggleObstacle, setAutoMode, replayClock } = useRobotStats()
  const battery = Math.round(s.battery)

  // Until the robot is connected, O simulates an obstacle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'o' || e.key === 'O') toggleObstacle() }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [toggleObstacle])

  return (
    <main className={s.obstacle && !s.autoMode ? 'interface danger' : 'interface'}>
      <Canvas
        className="scene"
        flat // tone mapping is done by the effect composer
        dpr={[1, 2]}
        camera={{ position: [12, 5, 14], fov: 40 }}
      >
        <color attach="background" args={['#05070d']} />
        <fogExp2 attach="fog" args={['#05070d', 0.012]} />
        <hemisphereLight args={[0x9fc8ff, 0x1a1020, 0.9]} />
        <directionalLight position={[6, 10, 8]} intensity={2.2} />
        <directionalLight position={[-8, 2, -10]} intensity={2.5} color={0x4fc3ff} />
        <Stars radius={80} depth={60} count={3000} factor={4} fade speed={0.5} />
        {/* Studio-like reflections for the metal hull, generated locally (no HDR download). */}
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={3} position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[12, 4, 1]} />
          <Lightformer form="rect" intensity={2} color="#4fc3ff" position={[-8, 1, -4]} rotation-y={Math.PI / 2} scale={[10, 2, 1]} />
          <Lightformer form="rect" intensity={1.5} color="#ff8a4a" position={[8, 0, 4]} rotation-y={-Math.PI / 2} scale={[10, 2, 1]} />
          <Lightformer form="ring" intensity={2} position={[0, 2, 9]} scale={3} />
        </Environment>
        <Spaceship battery={s.battery} />
        <Asteroid active={s.obstacle} firing={s.obstacle && s.autoMode} shots={s.shots} />
        <OrbitControls enableDamping enablePan={false} minDistance={8} maxDistance={30} autoRotate autoRotateSpeed={0.15} />
        <EffectComposer multisampling={4}>
          <Bloom mipmapBlur luminanceThreshold={1} intensity={1.2} radius={0.7} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <Vignette offset={0.25} darkness={0.75} />
        </EffectComposer>
      </Canvas>

      <div className="panel left">
        <Gauge label="Batterie" value={battery} unit="%" percent={battery} />
        <div className="card mode">
          <div>
            <div className="label">Mode auto</div>
            <div className="mode-state">{s.autoMode ? 'Tir automatique activé' : 'Contrôle manuel'}</div>
          </div>
          <button role="switch" aria-checked={s.autoMode} aria-label="Mode auto" className="switch"
            onClick={() => setAutoMode(!s.autoMode)}><i /></button>
        </div>
      </div>

      <div className="panel right">
        <div className="card">
          <div className="row"><span>Temps de mission</span><b>{duration(s.uptime)}</b></div>
        </div>
      </div>

      {s.obstacle && <ObstacleAlert autoMode={s.autoMode} />}

      {replayClock ? (
        <div className="sim">Relecture du log du robot : {replayClock}</div>
      ) : (
        <div className="sim">
          Données simulées : robot non connecté
          <button onClick={toggleObstacle}>{s.obstacle ? 'Retirer l’obstacle' : 'Simuler un obstacle'} (O)</button>
        </div>
      )}
    </main>
  )
}
