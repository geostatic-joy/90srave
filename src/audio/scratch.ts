import { conformChannels, conformSampleRate } from './buffers'
import { createAudioBuffer } from './context'

/** Range the scratch length slider covers, in seconds. */
export const MIN_SCRATCH_LENGTH = 0.3
export const MAX_SCRATCH_LENGTH = 5
/** Below this clip length the scratch has nothing to work with. */
export const MIN_CLIP_FOR_SCRATCH = 3
/** Click-avoiding micro fade applied at every hard edge. */
export const EDGE_FADE = 0.005

export type ScratchStyleId = 'classic' | 'chatter' | 'rewind' | 'needle-drag' | 'power-down'

export interface ScratchStyle {
  id: ScratchStyleId
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
   * reads on past the cut.
   */
  offsetAt: (t: number, duration: number) => number
  /** Level of the music itself, before the closing fade. */
  levelAt?: (t: number) => number
  /** Normalized time at which the sound dies away. */
  stopAt: number
  /** Surface noise: transient at direction changes, hiss that tracks speed, band edges. */
  noise: { burst: number; motion: number; lowHz: number; highHz: number }
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
}

export const SCRATCH_STYLE_LIST: ScratchStyle[] = [
  SCRATCH_STYLES.classic,
  SCRATCH_STYLES.chatter,
  SCRATCH_STYLES.rewind,
  SCRATCH_STYLES['needle-drag'],
  SCRATCH_STYLES['power-down'],
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

  // If the track runs out after the cut, start the gesture earlier rather than
  // reading off the end of the window and holding a DC sample.
  let maxAhead = 0
  for (let i = 0; i < outLength; i++) {
    maxAhead = Math.max(maxAhead, style.offsetAt(i / (outLength - 1), duration))
  }
  const shortfall = Math.max(0, cutSample + maxAhead * sampleRate - lastSample)
  const origin = Math.max(0, cutSample - shortfall)

  // Sample positions (in window samples) and how fast we move through them.
  const positions = new Float32Array(outLength)
  const speeds = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const offset = style.offsetAt(i / (outLength - 1), duration) * sampleRate
    positions[i] = Math.max(0, Math.min(lastSample, origin + offset))
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
    const envelope = style.noise.burst * burst + style.noise.motion * motion
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
    for (let i = 0; i < outLength; i++) {
      // Fractional read of the source: this is the pitch/direction sweep.
      const position = positions[i]
      const index = Math.floor(position)
      const frac = position - index
      const a = source[Math.max(0, Math.min(lastSample, index))]
      const b = source[Math.max(0, Math.min(lastSample, index + 1))]
      const sample = a + (b - a) * frac

      // Band-limited noise, one pole each way.
      const white = Math.random() * 2 - 1
      lowpass += lowpassCoeff * (white - lowpass)
      highpassState += highpassCoeff * (lowpass - highpassState)
      const noise = lowpass - highpassState

      target[i] = sample * amplitude[i] + noise * noiseEnvelope[i]
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
