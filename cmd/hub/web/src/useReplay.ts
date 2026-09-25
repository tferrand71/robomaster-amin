import { useCallback, useEffect, useRef, useState } from 'react'
import { applyEvent, initialVision, parseLine, targetInView, type LogEntry, type VisionState } from './robotLog'

// /app/?replay plays back a recorded session of the robot's action log in
// place of the simulation; ?replay=4 plays it 4 times faster. Once the robot
// page has an API, its lines go through the same parser and state.
const param = new URLSearchParams(location.search).get('replay')
export const REPLAY_SPEED = param === null ? 0 : Math.max(0.1, Number(param) || 1)

const MAX_GAP = 4000 // idle stretches of the log are shortened to this (ms)
const TICK = 100 // ms

export interface ReplayState {
  vision: VisionState
  obstacle: boolean
  clock: string // time in the log, HH:MM:SS
}

/**
 * Plays the recorded log in a loop. `state` is null when not replaying;
 * `setAutoFire` (the interface's switch) overrides the log's auto-fire setting
 * until the log changes it again.
 */
export function useReplay() {
  const [state, setState] = useState<ReplayState | null>(null)
  const override = useRef<boolean | null>(null)

  useEffect(() => {
    if (!REPLAY_SPEED) return
    let timer: ReturnType<typeof setInterval>
    let cancelled = false

    import('./replay/session.log?raw').then(({ default: text }) => {
      if (cancelled) return
      const entries = text.split('\n').map(parseLine).filter((e): e is LogEntry => e !== null)
      if (!entries.length) return

      // Playback time of each entry, with long pauses shortened.
      const at: number[] = []
      entries.forEach((e, i) => {
        at.push(i === 0 ? 0 : at[i - 1] + Math.min(MAX_GAP, e.time - entries[i - 1].time))
      })
      const end = at[at.length - 1] + MAX_GAP

      let start = performance.now()
      let next = 0
      let vision = initialVision
      timer = setInterval(() => {
        let t = (performance.now() - start) * REPLAY_SPEED
        if (t > end) { start = performance.now(); t = 0; next = 0; vision = { ...initialVision, shots: vision.shots } }
        for (; next < entries.length && at[next] <= t; next++) {
          const e = entries[next].event
          vision = applyEvent(vision, e, at[next])
          if (e.type === 'autoFireSetting') override.current = null
        }
        const o = override.current
        const v = o === null ? vision : { ...vision, autoFire: o }
        const time = entries[Math.max(0, next - 1)].time
        setState({ vision: v, obstacle: targetInView(v, t), clock: new Date(time).toTimeString().slice(0, 8) })
      }, TICK)
    })
    return () => { cancelled = true; clearInterval(timer) }
  }, [])

  const setAutoFire = useCallback((on: boolean) => { override.current = on }, [])
  return { state, setAutoFire }
}
