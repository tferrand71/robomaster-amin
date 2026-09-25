// Parser and state for the action log of the robot's AI vision program, e.g.
//   [2026-09-24 10:25:32] [FIRE] Automatic infrared fire triggered on target 'BOTTLE'
// The same lines are expected from the robot page's API once it exists.

export type RobotEvent =
  | { type: 'detected'; target: string; area: number }
  | { type: 'lost' }
  | { type: 'locked'; target: string }
  | { type: 'autoFire'; target: string }
  | { type: 'autoFireSetting'; enabled: boolean }
  | { type: 'connected' }
  | { type: 'disconnected' }

export interface LogEntry {
  time: number // ms since epoch, local time of the robot's computer
  event: RobotEvent
}

const LINE = /^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\] \[(\w+)\] (.*)$/

/** Parses one log line; lines that do not matter for the interface give null. */
export function parseLine(line: string): LogEntry | null {
  const m = LINE.exec(line.trim())
  if (!m) return null
  const [, stamp, category, msg] = m
  const event = parseEvent(category, msg)
  return event && { time: new Date(stamp.replace(' ', 'T')).getTime(), event }
}

function parseEvent(category: string, msg: string): RobotEvent | null {
  let m: RegExpExecArray | null
  switch (category) {
    case 'VISION':
      if ((m = /^Target '(.+)' detected \(Area: (\d+) px\)/.exec(msg))) return { type: 'detected', target: m[1], area: +m[2] }
      if (msg.startsWith('Target lost')) return { type: 'lost' }
      return null
    case 'LOCK':
      return (m = /^Target '(.+)' locked/.exec(msg)) ? { type: 'locked', target: m[1] } : null
    case 'FIRE':
      // Every automatic shot is followed by a plain "Infrared fire triggered",
      // which alone means a manual shot: only the automatic one is kept.
      return (m = /^Automatic infrared fire triggered on target '(.+)'/.exec(msg)) ? { type: 'autoFire', target: m[1] } : null
    case 'AI':
    case 'CONFIG':
      return (m = /AutoFire: (true|false)|Auto-fire on lock setting updated: (true|false)/i.exec(msg))
        ? { type: 'autoFireSetting', enabled: (m[1] ?? m[2]).toLowerCase() === 'true' }
        : null
    case 'CONNECTION':
      return { type: 'connected' }
    case 'DISCONNECTION':
      return { type: 'disconnected' }
  }
  return null
}

// Detection flickers: the target is usually "lost" and found again within a
// second, so it only counts as gone after this long without being seen.
const LOST_GRACE = 2000

export interface VisionState {
  connected: boolean
  autoFire: boolean
  target: string | null // last target seen
  lostAt: number | null // when it was last reported lost, if it was
  locked: boolean
  shots: number // automatic shots so far
}

export const initialVision: VisionState = {
  connected: false, autoFire: false, target: null, lostAt: null, locked: false, shots: 0,
}

export function applyEvent(s: VisionState, e: RobotEvent, now: number): VisionState {
  switch (e.type) {
    case 'detected': return { ...s, target: e.target, lostAt: null }
    case 'lost': return { ...s, lostAt: s.lostAt ?? now, locked: false }
    case 'locked': return { ...s, target: e.target, lostAt: null, locked: true }
    case 'autoFire': return { ...s, shots: s.shots + 1 }
    case 'autoFireSetting': return { ...s, autoFire: e.enabled }
    case 'connected': return { ...s, connected: true }
    case 'disconnected': return { ...initialVision, shots: s.shots }
  }
}

/** Whether something is in front of the robot (shown as the asteroid). */
export const targetInView = (s: VisionState, now: number) =>
  s.target !== null && (s.lostAt === null || now - s.lostAt < LOST_GRACE)
