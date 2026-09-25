import { useCallback, useEffect, useState } from 'react'
import { REPLAY_SPEED, useReplay } from './useReplay'

export interface RobotStats {
  battery: number // %
  uptime: number // s
  obstacle: boolean // something detected in front of the robot
  autoMode: boolean // the robot handles obstacles by itself
  shots: number // incremented every time the robot fires on its own
}

// Simulated delays for auto mode: time before the robot fires at an obstacle,
// then time before the obstacle is reported gone.
const AUTO_FIRE_DELAY = 6000
const OBSTACLE_CLEAR_DELAY = 1500

// The robot is unavailable for now, so stats come from a simulation: the
// obstacle is toggled by hand and auto-mode firing is simulated below. With
// ?replay, the robot's recorded action log drives the obstacle, auto mode and
// shots instead (see useReplay); the live robot page API will do the same.
// The battery should come from '/api/status', which the hub already exposes.
function next(s: RobotStats): RobotStats {
  return { ...s, battery: Math.max(5, s.battery - Math.random() * 0.05), uptime: s.uptime + 1 }
}

const initial: RobotStats = { battery: 87, uptime: 0, obstacle: false, autoMode: false, shots: 0 }

export function useRobotStats() {
  const [stats, setStats] = useState(initial)
  useEffect(() => {
    const id = setInterval(() => setStats(next), 1000)
    return () => clearInterval(id)
  }, [])

  // Simulated auto mode: fire at the obstacle, which is then gone.
  const firing = !REPLAY_SPEED && stats.autoMode && stats.obstacle
  useEffect(() => {
    if (!firing) return
    let clear: ReturnType<typeof setTimeout>
    const fire = setTimeout(() => {
      setStats(s => ({ ...s, shots: s.shots + 1 }))
      clear = setTimeout(() => setStats(s => ({ ...s, obstacle: false })), OBSTACLE_CLEAR_DELAY)
    }, AUTO_FIRE_DELAY)
    return () => { clearTimeout(fire); clearTimeout(clear) }
  }, [firing])

  const toggleObstacle = useCallback(() => setStats(s => ({ ...s, obstacle: !s.obstacle })), [])
  // TODO: send the mode to the robot once it is connected.
  const setAutoMode = useCallback((autoMode: boolean) => setStats(s => ({ ...s, autoMode })), [])

  const replay = useReplay()
  if (replay.state) {
    const { vision, obstacle, clock } = replay.state
    return {
      stats: { ...stats, obstacle, autoMode: vision.autoFire, shots: vision.shots },
      toggleObstacle: () => {},
      setAutoMode: replay.setAutoFire,
      replayClock: clock,
    }
  }
  return { stats, toggleObstacle, setAutoMode, replayClock: null }
}
