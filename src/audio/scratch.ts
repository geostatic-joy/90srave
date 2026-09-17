import { conformChannels, conformSampleRate } from './buffers'
import { createAudioBuffer } from './context'

/** Range the scratch length slider covers, in seconds. */
export const MIN_SCRATCH_LENGTH = 0.3
export const MAX_SCRATCH_LENGTH = 5
/** Below this clip length the scratch has nothing to work with. */
export const MIN_CLIP_FOR_SCRATCH = 3
/** Click-avoiding micro fade applied at every hard edge. */
export const EDGE_FADE = 0.005

export type ScratchStyleId =
  | 'classic'
  | 'chatter'
  | 'rewind'
  | 'needle-drag'
  | 'power-down'
  | 'power-surge'
  | 'warped-vinyl'
  | 'cd-skip'
  | 'tape-chew'
  | 'radio-tune-out'
  | 'dub-echo'
  | 'underwater'
  | 'digital-death'
  | 'dissolve'
  | 'doppler'

/**
 * Dropdown grouping: a hand on the record, the machine itself failing, or the
 * track carried off somewhere else entirely.
 */
export type ScratchStyleGroup = 'turntable' | 'malfunction' | 'transform'

export interface ScratchStyle {
  id: ScratchStyleId
  group: ScratchStyleGroup
  label: string
  hint: string
  /** Length the slider jumps to when this style is picked, in seconds. */
  defaultLength: number
  /** Material needed before and after the cut, as multiples of the length. */
  lookBehind: number
  lookAhead: number
  /**
   * Where the needle sits at normalized time `t`, in seconds relative to the
   * cut point. Negative reads material the track already played; positive
   * reads on past the cut. Styles define either this or `rateAt`.
   */
  offsetAt?: (t: number, duration: number) => number
  /**
   * Playback speed at normalized time `t`, as a multiple of normal: 1 keeps up
   * with the track, 0 is a dead platter, negative runs backwards. Integrated
   * from the cut point, which is how a failing motor is easiest to describe.
   */
  rateAt?: (t: number, duration: number) => number
  /** Level of the music itself, before the closing fade. */
  levelAt?: (t: number) => number
  /** Normalized time at which the sound dies away. */
  stopAt: number
  /**
   * Surface noise: transient at direction changes, hiss that tracks speed, an
   * optional swell that only depends on time, and the band edges.
   */
  noise: {
    burst: number
    motion: number
    lowHz: number
    highHz: number
    swellAt?: (t: number) => number
  }
  /** Lowpass corner for the music, in Hz: closes the top end off over time. */
  filterAt?: (t: number, duration: number) => number
  /** Digital degradation: sample-and-hold rate in Hz, and bit depth. */
  crushAt?: (t: number, duration: number) => { hz: number; bits: number }
  /** A feedback delay applied after everything else, so repeats ring out past the music. */
  echo?: { timeAt: (duration: number) => number; feedback: number; dampingHz: number }
  /** An added tone: mains hum on a failing deck, a whistle drifting off the dial. */
  tone?: {
    hzAt: (t: number, duration: number) => number
    levelAt: (t: number) => number
    /** Harmonically rich, for a buzz rather than a pure whistle. */
    buzz?: boolean
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Deterministic scatter, so a render is always the same render. */
function hash(index: number): number {
  const value = Math.sin(index * 12.9898) * 43758.5453
  return value - Math.floor(value)
}

/** Grain length for the dissolve, in seconds. */
const GRAIN = 0.06

/** Which grain of the dissolve is sounding, and how far through it we are. */
function grainAt(t: number, duration: number): { index: number; phase: number } {
  const elapsed = t * duration
  const index = Math.floor(elapsed / GRAIN)
  return { index, phase: (elapsed % GRAIN) / GRAIN }
}

/**
 * A CD skip replays a fragment that ends at the cut, each pass shorter than
 * the last. Both the position and the seam dips need the same phase.
 */
function skipPhase(t: number, duration: number): { phase: number; length: number } {
  const elapsed = t * duration
  let start = 0
  let length = duration * 0.22
  for (let repeat = 0; repeat < 24 && length > 0.02; repeat++) {
    if (elapsed < start + length) {
      return { phase: clamp01((elapsed - start) / length), length }
    }
    start += length
    length *= 0.78
  }
  return { phase: 1, length }
}

/** Ease with zero velocity at both ends, so direction changes do not click. */
function smoothstep(x: number): number {
  return x * x * (3 - 2 * x)
}

interface Knot {
  /** normalized time within the scratch, 0..1 */
  t: number
  /** normalized position, 1 = the cut point, 0 = the far end of the look-behind */
  p: number
}

/**
 * Turntable motion for the classic scratch: start at the cut, yank the record
 * backwards, shove it forward, repeat with shrinking swings, then let it coast
 * to a dead stop.
 */
const CLASSIC_KNOTS: Knot[] = [
  { t: 0, p: 1 },
  { t: 0.12, p: 0.52 },
  { t: 0.22, p: 0.86 },
  { t: 0.32, p: 0.46 },
  { t: 0.44, p: 0.9 },
  { t: 0.54, p: 0.58 },
  { t: 0.86, p: 1 },
  { t: 1, p: 1 },
]

function knotPosition(knots: Knot[], t: number): number {
  if (t <= knots[0].t) return knots[0].p
  for (let i = 1; i < knots.length; i++) {
    const prev = knots[i - 1]
    const next = knots[i]
    if (t <= next.t) {
      const span = next.t - prev.t
      const local = span <= 0 ? 1 : (t - prev.t) / span
      return prev.p + (next.p - prev.p) * smoothstep(local)
    }
  }
  return knots[knots.length - 1].p
}

/**
 * The five endings. Every one is synthesized from the track's own audio — a
 * position curve read out of the source plus filtered surface noise — so
 * nothing licensed is bundled.
 */
export const SCRATCH_STYLES: Record<ScratchStyleId, ScratchStyle> = {
  classic: {
    id: 'classic',
    group: 'turntable',
    label: 'Classic scratch',
    hint: 'Back, forward, back, then a coast to a dead stop.',
    defaultLength: 1,
    lookBehind: 1,
    lookAhead: 0,
    offsetAt: (t, duration) => -(1 - knotPosition(CLASSIC_KNOTS, t)) * 0.8 * duration,
    stopAt: 0.86,
    noise: { burst: 0.05, motion: 0.018, lowHz: 5000, highHz: 1200 },
  },

  chatter: {
    id: 'chatter',
    group: 'turntable',
    label: 'Chatter run',
    hint: 'A run of fast back-and-forth swings that settle onto the cut.',
    defaultLength: 1.6,
    lookBehind: 0.7,
    lookAhead: 0,
    // Six shrinking swings that start and finish on the cut point.
    offsetAt: (t, duration) => -0.45 * duration * (1 - t) * (0.5 - 0.5 * Math.cos(2 * Math.PI * 6 * t)),
    stopAt: 0.9,
    noise: { burst: 0.07, motion: 0.02, lowHz: 6000, highHz: 1500 },
  },

  rewind: {
    id: 'rewind',
    group: 'turntable',
    label: 'Spin-back rewind',
    hint: 'The record yanked backwards, faster and faster, then dropped.',
    defaultLength: 1.5,
    lookBehind: 2.6,
    lookAhead: 0,
    offsetAt: (t, duration) => -2.2 * duration * Math.pow(t, 1.7),
    stopAt: 0.9,
    noise: { burst: 0.03, motion: 0.03, lowHz: 7000, highHz: 900 },
  },

  'needle-drag': {
    id: 'needle-drag',
    group: 'turntable',
    label: 'Needle drag',
    hint: 'Someone bumps the turntable and the needle skids across the record.',
    defaultLength: 2,
    lookBehind: 2.6,
    lookAhead: 0.4,
    offsetAt: (t, duration) => {
      // A lurch forward as the deck is knocked, then a long skid backwards.
      if (t < 0.06) return 0.25 * duration * (t / 0.06)
      const x = (t - 0.06) / 0.94
      return 0.25 * duration - 2.45 * duration * (1 - (1 - x) * (1 - x))
    },
    // The needle stops tracking properly the moment it leaves the groove.
    levelAt: (t) => (t < 0.06 ? 1 : Math.max(0.22, 1 - (t - 0.06) * 4)),
    stopAt: 0.88,
    noise: { burst: 0.16, motion: 0.13, lowHz: 8000, highHz: 400 },
  },

  'power-down': {
    id: 'power-down',
    group: 'turntable',
    label: 'Power down',
    hint: 'The turntable switched off: the music keeps rolling as the platter dies.',
    defaultLength: 2.5,
    lookBehind: 0.2,
    lookAhead: 0.5,
    // Rate decays exponentially, so pitch sags as the platter coasts to a halt.
    offsetAt: (t, duration) => {
      const tau = duration * 0.38
      return tau * (1 - Math.exp((-t * duration) / tau))
    },
    stopAt: 0.95,
    noise: { burst: 0.01, motion: 0.05, lowHz: 1400, highHz: 90 },
  },

  'power-surge': {
    id: 'power-surge',
    group: 'malfunction',
    label: 'Power surge',
    hint: 'The deck browns out: the motor lurches, the sound gates in and out, mains hum swells.',
    defaultLength: 2,
    lookBehind: 1.5,
    lookAhead: 0.4,
    // A motor fighting a failing supply: speed hunts either side of normal,
    // backwards on the worst sags, and loses the fight entirely.
    rateAt: (t) => (0.5 + 1.1 * Math.sin(2 * Math.PI * 3.2 * t)) * Math.max(0, 1 - t * 1.15),
    levelAt: (t) => {
      const flicker = Math.sin(2 * Math.PI * 7 * t) + Math.sin(2 * Math.PI * 11.3 * t)
      // Steep but not instant, so the dropouts snap without clicking.
      return Math.min(1, Math.max(0.05, (flicker + 0.6) * 2.5))
    },
    stopAt: 0.9,
    noise: { burst: 0.06, motion: 0.05, lowHz: 3000, highHz: 200 },
    tone: { hzAt: () => 60, levelAt: (t) => 0.11 * Math.min(1, t * 1.6), buzz: true },
  },

  'warped-vinyl': {
    id: 'warped-vinyl',
    group: 'malfunction',
    label: 'Warped pressing',
    hint: 'A record with a bend in it: the pitch wows deeper each turn until the needle gives up.',
    defaultLength: 3,
    lookBehind: 1.2,
    lookAhead: 1.2,
    // Wow at roughly one wobble per revolution, deepening as the warp wins.
    rateAt: (t, duration) =>
      (1 + (0.15 + 0.85 * t) * Math.sin(2 * Math.PI * 1.4 * t * duration)) * Math.max(0, 1 - t * 1.02),
    stopAt: 0.93,
    noise: { burst: 0.03, motion: 0.025, lowHz: 900, highHz: 60 },
  },

  'cd-skip': {
    id: 'cd-skip',
    group: 'malfunction',
    label: 'CD skip',
    hint: 'The last fragment sticks and repeats, each pass shorter, glitching to a halt.',
    defaultLength: 1.8,
    lookBehind: 0.4,
    lookAhead: 0,
    offsetAt: (t, duration) => {
      const { phase, length } = skipPhase(t, duration)
      return -length + phase * length
    },
    // Dip at the seams so each repeat starts and ends without a click.
    levelAt: (t) => {
      const { phase, length } = skipPhase(t, 1)
      const edge = Math.min(0.04 / Math.max(0.02, length), 0.5)
      return Math.min(1, Math.min(phase, 1 - phase) / edge)
    },
    stopAt: 0.88,
    noise: { burst: 0.02, motion: 0.012, lowHz: 9000, highHz: 3000 },
  },

  'tape-chew': {
    id: 'tape-chew',
    group: 'malfunction',
    label: 'Tape chew',
    hint: 'The machine eats the tape: speed sags unevenly, the signal drops out, everything slurs.',
    defaultLength: 2.5,
    lookBehind: 0.6,
    lookAhead: 1,
    rateAt: (t, duration) => {
      const flutter =
        0.22 * Math.sin(2 * Math.PI * 9 * t * duration) + 0.12 * Math.sin(2 * Math.PI * 23 * t * duration)
      // Sags hard at first, then crawls.
      const drag = Math.max(0, 1 - Math.pow(t, 0.55) * 1.15)
      return drag * (1 + flutter)
    },
    // The tape loses contact with the head every so often.
    levelAt: (t) => 1 - 0.8 * Math.pow(Math.max(0, Math.sin(2 * Math.PI * 4.7 * t)), 6),
    stopAt: 0.92,
    noise: { burst: 0.05, motion: 0.04, lowHz: 6000, highHz: 700 },
  },

  'radio-tune-out': {
    id: 'radio-tune-out',
    group: 'malfunction',
    label: 'Radio tune-out',
    hint: 'The station drifts off the dial: static swells over the music and a whistle slides away.',
    defaultLength: 3,
    lookBehind: 0.2,
    lookAhead: 1.1,
    // The music keeps playing; it is the signal that goes, not the transport.
    rateAt: (t) => 1 + 0.03 * Math.sin(2 * Math.PI * 2 * t),
    levelAt: (t) => Math.max(0, 1 - Math.pow(t, 1.5) * 1.25) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 3 * t)),
    stopAt: 0.95,
    noise: {
      burst: 0.02,
      motion: 0.01,
      lowHz: 7000,
      highHz: 250,
      swellAt: (t) => 0.22 * Math.pow(t, 1.4),
    },
    // A heterodyne whistle climbing as the dial moves away.
    tone: { hzAt: (t) => 900 + 2600 * t * t, levelAt: (t) => 0.05 * Math.sin(Math.PI * t) },
  },

  'dub-echo': {
    id: 'dub-echo',
    group: 'transform',
    label: 'Dub echo out',
    hint: 'The last bar is thrown into a delay: the dry signal drops out and the repeats ring away.',
    defaultLength: 3,
    lookBehind: 0.4,
    lookAhead: 0.4,
    rateAt: () => 1,
    // The dry signal is pulled after the throw; everything after is repeats.
    levelAt: (t) => (t < 0.2 ? 1 : Math.max(0, 1 - (t - 0.2) * 25)),
    stopAt: 0.97,
    noise: { burst: 0.01, motion: 0.008, lowHz: 5000, highHz: 400 },
    echo: { timeAt: (duration) => duration * 0.13, feedback: 0.62, dampingHz: 2600 },
  },

  underwater: {
    id: 'underwater',
    group: 'transform',
    label: 'Underwater',
    hint: 'The track sinks: the top end closes off, the pitch sags, and it drowns.',
    defaultLength: 3,
    lookBehind: 0.3,
    lookAhead: 1.1,
    rateAt: (t, duration) => (1 - 0.22 * t) * (1 + 0.04 * Math.sin(2 * Math.PI * 1.1 * t * duration)),
    // 9 kHz down to about 180 Hz: the water closing over it.
    filterAt: (t) => 9000 * Math.pow(0.02, t),
    levelAt: (t) => 1 - 0.25 * t,
    stopAt: 0.92,
    noise: { burst: 0.01, motion: 0.02, lowHz: 400, highHz: 60, swellAt: (t) => 0.03 * t },
  },

  'digital-death': {
    id: 'digital-death',
    group: 'transform',
    label: 'Digital death',
    hint: 'The player degrades: sample rate and bit depth collapse into a buzz, then nothing.',
    defaultLength: 2,
    lookBehind: 0.3,
    lookAhead: 1,
    rateAt: () => 1,
    // 48 kHz and 16 bits down to a few hundred hertz and about two bits.
    crushAt: (t) => ({ hz: 48000 * Math.pow(0.0025, t), bits: 16 - 14 * t }),
    // And the buffer starts freezing outright.
    levelAt: (t) => 1 - 0.9 * Math.pow(t, 3) * Math.max(0, Math.sin(2 * Math.PI * 9 * t)),
    stopAt: 0.93,
    noise: { burst: 0.01, motion: 0.005, lowHz: 9000, highHz: 2000 },
  },

  dissolve: {
    id: 'dissolve',
    group: 'transform',
    label: 'Dissolve',
    hint: 'The track crumbles into grains that scatter backwards and thin out into nothing.',
    defaultLength: 2.5,
    lookBehind: 1.8,
    lookAhead: 0.2,
    offsetAt: (t, duration) => {
      const { index, phase } = grainAt(t, duration)
      // Grains drift back from the cut and scatter further apart as it falls apart.
      const drift = -(0.1 + 0.9 * t) * duration
      const scatter = (hash(index) - 0.5) * 0.6 * duration * t
      return drift + scatter + phase * GRAIN
    },
    levelAt: (t) => {
      const { index, phase } = grainAt(t, 1)
      // A raised cosine per grain, and fewer grains survive as time runs out.
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * phase)
      return hash(index + 0.5) > t * 0.9 ? window : 0
    },
    stopAt: 0.95,
    noise: { burst: 0.015, motion: 0.01, lowHz: 6000, highHz: 800 },
  },

  doppler: {
    id: 'doppler',
    group: 'transform',
    label: 'Pass-by',
    hint: 'The track flies past like a car: the pitch drops through the middle as it recedes.',
    defaultLength: 2,
    lookBehind: 0.4,
    lookAhead: 1.3,
    rateAt: (t) => 1.18 - 0.36 / (1 + Math.exp(-(t - 0.5) * 12)),
    levelAt: (t) => {
      const near = Math.exp(-Math.pow((t - 0.45) / 0.22, 2))
      const receding = Math.max(0, 1 - Math.pow(Math.max(0, (t - 0.5) / 0.5), 1.5))
      return (0.35 + 0.65 * near) * receding
    },
    // It gets muffled as it goes away from you.
    filterAt: (t) => 1500 + 14000 * Math.exp(-Math.pow((t - 0.45) / 0.3, 2)),
    stopAt: 0.95,
    noise: { burst: 0.02, motion: 0.03, lowHz: 3000, highHz: 200, swellAt: (t) => 0.02 * t },
  },
}

export const SCRATCH_STYLE_LIST: ScratchStyle[] = [
  SCRATCH_STYLES.classic,
  SCRATCH_STYLES.chatter,
  SCRATCH_STYLES.rewind,
  SCRATCH_STYLES['needle-drag'],
  SCRATCH_STYLES['power-down'],
  SCRATCH_STYLES['power-surge'],
  SCRATCH_STYLES['warped-vinyl'],
  SCRATCH_STYLES['cd-skip'],
  SCRATCH_STYLES['tape-chew'],
  SCRATCH_STYLES['radio-tune-out'],
  SCRATCH_STYLES['dub-echo'],
  SCRATCH_STYLES.underwater,
  SCRATCH_STYLES['digital-death'],
  SCRATCH_STYLES.dissolve,
  SCRATCH_STYLES.doppler,
]

export const DEFAULT_SCRATCH_STYLE: ScratchStyleId = 'classic'
export const DEFAULT_SCRATCH_LENGTH = SCRATCH_STYLES.classic.defaultLength

/**
 * Build the ending out of a window of the track around the cut point.
 *
 * `window` spans roughly `[cut - lookBehind, cut + lookAhead]`; `cutSample` is
 * where the music stops inside it. The motion is defined in normalized time,
 * so a longer `duration` stretches the same gesture into a slower one.
 */
export function synthesizeScratch(
  window: AudioBuffer,
  cutSample: number,
  duration: number,
  style: ScratchStyle,
): AudioBuffer {
  const sampleRate = window.sampleRate
  const channels = window.numberOfChannels
  const outLength = Math.max(2, Math.round(duration * sampleRate))
  const out = createAudioBuffer(channels, outLength, sampleRate)
  const lastSample = window.length - 1

  // Where the needle is, in seconds either side of the cut. A style either
  // says so outright or gives a speed for us to integrate from the cut.
  const offsets = new Float32Array(outLength)
  if (style.rateAt) {
    let travelled = 0
    for (let i = 0; i < outLength; i++) {
      offsets[i] = travelled
      travelled += style.rateAt(i / (outLength - 1), duration) / sampleRate
    }
  } else if (style.offsetAt) {
    for (let i = 0; i < outLength; i++) {
      offsets[i] = style.offsetAt(i / (outLength - 1), duration)
    }
  }

  // If the track runs out after the cut, start the gesture earlier rather than
  // reading off the end of the window and holding a DC sample.
  let maxAhead = 0
  for (let i = 0; i < outLength; i++) maxAhead = Math.max(maxAhead, offsets[i])
  const shortfall = Math.max(0, cutSample + maxAhead * sampleRate - lastSample)
  const origin = Math.max(0, cutSample - shortfall)

  // Sample positions (in window samples) and how fast we move through them.
  const positions = new Float32Array(outLength)
  const speeds = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    positions[i] = Math.max(0, Math.min(lastSample, origin + offsets[i] * sampleRate))
  }
  for (let i = 0; i < outLength; i++) {
    const prev = positions[Math.max(0, i - 1)]
    const next = positions[Math.min(outLength - 1, i + 1)]
    speeds[i] = (next - prev) / 2
  }

  // Amplitude: micro fade in, the style's own level, then the sound dies.
  const fadeInSamples = Math.max(1, Math.round(EDGE_FADE * sampleRate))
  const stopStart = Math.round(outLength * style.stopAt)
  const stopEnd = Math.round(outLength * Math.min(1, style.stopAt + 0.07))
  const amplitude = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const t = i / (outLength - 1)
    let gain = i < fadeInSamples ? i / fadeInSamples : 1
    if (style.levelAt) gain *= style.levelAt(t)
    if (i >= stopStart) {
      const decay = Math.min(1, (i - stopStart) / Math.max(1, stopEnd - stopStart))
      gain *= 1 - decay
    }
    amplitude[i] = gain
  }

  // Surface noise that tracks the motion, with a transient at every turnaround.
  const noiseEnvelope = new Float32Array(outLength)
  const burstDecay = Math.exp(-1 / (0.02 * sampleRate))
  let burst = 0.6
  let previousSpeed = speeds[0]
  for (let i = 0; i < outLength; i++) {
    const speed = speeds[i]
    if (previousSpeed !== 0 && Math.sign(speed) !== Math.sign(previousSpeed)) burst = 1
    previousSpeed = speed === 0 ? previousSpeed : speed
    burst *= burstDecay
    const motion = Math.min(1, Math.abs(speed) / 3)
    const t = i / (outLength - 1)
    const envelope = style.noise.burst * burst + style.noise.motion * motion + (style.noise.swellAt?.(t) ?? 0)
    // The closing fade takes the noise with it, but the noise is the whole
    // point of a drag, so it is not tied to the music level.
    const closing = i >= stopStart ? Math.max(0, 1 - (i - stopStart) / Math.max(1, stopEnd - stopStart)) : 1
    noiseEnvelope[i] = envelope * closing * (i < fadeInSamples ? i / fadeInSamples : 1)
  }

  const lowpassCoeff = 1 - Math.exp((-2 * Math.PI * style.noise.lowHz) / sampleRate)
  const highpassCoeff = 1 - Math.exp((-2 * Math.PI * style.noise.highHz) / sampleRate)

  for (let c = 0; c < channels; c++) {
    const source = window.getChannelData(c)
    const target = out.getChannelData(c)
    let lowpass = 0
    let highpassState = 0
    let tonePhase = 0
    let musicLowpass = 0
    let musicLowpassB = 0
    let crushHold = 0
    let crushPhase = 0
    for (let i = 0; i < outLength; i++) {
      // Fractional read of the source: this is the pitch/direction sweep.
      const position = positions[i]
      const index = Math.floor(position)
      const frac = position - index
      const a = source[Math.max(0, Math.min(lastSample, index))]
      const b = source[Math.max(0, Math.min(lastSample, index + 1))]
      let sample = a + (b - a) * frac
      const time = i / (outLength - 1)

      // Digital degradation: sample-and-hold, then quantize.
      if (style.crushAt) {
        const crush = style.crushAt(time, duration)
        crushPhase += Math.max(1, crush.hz) / sampleRate
        if (crushPhase >= 1) {
          crushPhase -= Math.floor(crushPhase)
          crushHold = sample
        }
        const steps = Math.max(2, Math.pow(2, Math.max(1, crush.bits)) / 2)
        sample = Math.round(crushHold * steps) / steps
      }

      // Two one-poles in series, for a 12 dB/octave corner that really does
      // close the top end off rather than just leaning on it.
      if (style.filterAt) {
        const corner = Math.max(20, style.filterAt(time, duration))
        const coefficient = 1 - Math.exp((-2 * Math.PI * corner) / sampleRate)
        musicLowpass += coefficient * (sample - musicLowpass)
        musicLowpassB += coefficient * (musicLowpass - musicLowpassB)
        sample = musicLowpassB
      }

      // Band-limited noise, one pole each way.
      const white = Math.random() * 2 - 1
      lowpass += lowpassCoeff * (white - lowpass)
      highpassState += highpassCoeff * (lowpass - highpassState)
      const noise = lowpass - highpassState

      target[i] = sample * amplitude[i] + noise * noiseEnvelope[i]

      // Mains hum, or a whistle sliding off the dial.
      if (style.tone) {
        tonePhase += (2 * Math.PI * Math.max(0, style.tone.hzAt(time, duration))) / sampleRate
        const wave = style.tone.buzz
          ? Math.tanh(
              3 * (Math.sin(tonePhase) * 0.6 + Math.sin(2 * tonePhase) * 0.3 + Math.sin(3 * tonePhase) * 0.2),
            )
          : Math.sin(tonePhase)
        const closing =
          i >= stopStart ? Math.max(0, 1 - (i - stopStart) / Math.max(1, stopEnd - stopStart)) : 1
        target[i] += wave * style.tone.levelAt(time) * closing * (i < fadeInSamples ? i / fadeInSamples : 1)
      }
    }
    // Feedback delay, after the stop fade so the repeats ring on past the music.
    if (style.echo) {
      const delay = Math.max(1, Math.round(style.echo.timeAt(duration) * sampleRate))
      const damping = 1 - Math.exp((-2 * Math.PI * style.echo.dampingHz) / sampleRate)
      let feedbackLowpass = 0
      for (let i = delay; i < outLength; i++) {
        feedbackLowpass += damping * (target[i - delay] - feedbackLowpass)
        target[i] += style.echo.feedback * feedbackLowpass
      }
    }

    // Hard stop: make sure the very last samples land on silence.
    const tail = Math.max(1, Math.round(EDGE_FADE * sampleRate))
    for (let i = 0; i < tail; i++) {
      target[outLength - 1 - i] *= i / tail
    }
  }

  return out
}

/** How the scratch length applies to a sample the user supplied. */
export type ScratchFit = 'trim' | 'stretch'

/** Play a buffer back at a different speed, so it lands on `duration`. */
async function varispeed(sample: AudioBuffer, duration: number): Promise<AudioBuffer> {
  const sampleRate = sample.sampleRate
  const length = Math.max(2, Math.round(duration * sampleRate))
  const ctx = new OfflineAudioContext(sample.numberOfChannels, length, sampleRate)
  const node = ctx.createBufferSource()
  node.buffer = sample
  // Slower than 1 stretches it out and drops the pitch, the way a turntable would.
  node.playbackRate.value = Math.max(0.01, sample.duration / duration)
  node.connect(ctx.destination)
  node.start()
  return ctx.startRendering()
}

/**
 * Make a user-supplied scratch sample line up with the clip: same sample rate,
 * same channel count, and either trimmed to `duration` or stretched onto it,
 * with click-free edges.
 */
export async function conformScratchSample(
  sample: AudioBuffer,
  sampleRate: number,
  channels: number,
  duration: number,
  fit: ScratchFit = 'trim',
): Promise<AudioBuffer> {
  const resampled = await conformSampleRate(sample, sampleRate)
  const rechanneled = conformChannels(resampled, channels)
  const wanted = Math.max(2, Math.round(duration * sampleRate))
  // Trimming can only ever shorten a sample; stretching hits the length exactly.
  const fitted = fit === 'stretch' ? await varispeed(rechanneled, duration) : rechanneled
  const length = fit === 'stretch' ? fitted.length : Math.min(fitted.length, wanted)
  const out = createAudioBuffer(channels, length, sampleRate)
  const fade = Math.max(1, Math.round(EDGE_FADE * sampleRate))
  for (let c = 0; c < channels; c++) {
    const data = fitted.getChannelData(c).subarray(0, length)
    const target = out.getChannelData(c)
    target.set(data)
    for (let i = 0; i < fade && i < length; i++) {
      target[i] *= i / fade
      target[length - 1 - i] *= i / fade
    }
  }
  return out
}
