import { conformChannels, conformSampleRate } from './buffers'
import { createAudioBuffer } from './context'

/** Length of the synthesized scratch, in seconds. */
export const SCRATCH_DURATION = 1
/** How much of the track the synthesized scratch chews on. */
export const SCRATCH_SOURCE_DURATION = 0.8
/** Below this clip length the scratch has nothing to work with. */
export const MIN_CLIP_FOR_SCRATCH = 3
/** Click-avoiding micro fade applied at every hard edge. */
export const EDGE_FADE = 0.005

interface Knot {
  /** normalized time within the scratch, 0..1 */
  t: number
  /** normalized playback position within the source segment, 0..1 */
  p: number
}

/**
 * Turntable motion: start at the cut point, yank the record backwards, shove it
 * forward, repeat with shrinking swings, then let it coast to a dead stop.
 */
const POSITION_KNOTS: Knot[] = [
  { t: 0, p: 1 },
  { t: 0.12, p: 0.52 },
  { t: 0.22, p: 0.86 },
  { t: 0.32, p: 0.46 },
  { t: 0.44, p: 0.9 },
  { t: 0.54, p: 0.58 },
  { t: 0.86, p: 1 },
  { t: 1, p: 1 },
]

/** Ease with zero velocity at both ends, so direction changes do not click. */
function smoothstep(x: number): number {
  return x * x * (3 - 2 * x)
}

function positionAt(t: number): number {
  if (t <= POSITION_KNOTS[0].t) return POSITION_KNOTS[0].p
  for (let i = 1; i < POSITION_KNOTS.length; i++) {
    const prev = POSITION_KNOTS[i - 1]
    const next = POSITION_KNOTS[i]
    if (t <= next.t) {
      const span = next.t - prev.t
      const local = span <= 0 ? 1 : (t - prev.t) / span
      return prev.p + (next.p - prev.p) * smoothstep(local)
    }
  }
  return POSITION_KNOTS[POSITION_KNOTS.length - 1].p
}

/**
 * Build a record-scratch tail out of the clip's own final moments: a
 * playback-rate wiggle (forward, reverse, forward) over a burst of filtered
 * surface noise, ending in a hard stop. Nothing licensed is bundled.
 */
export function synthesizeScratch(clip: AudioBuffer, musicEndTime: number): AudioBuffer {
  const sampleRate = clip.sampleRate
  const channels = clip.numberOfChannels
  const outLength = Math.max(2, Math.round(SCRATCH_DURATION * sampleRate))
  const out = createAudioBuffer(channels, outLength, sampleRate)

  const segmentEnd = Math.max(2, Math.min(clip.length, Math.round(musicEndTime * sampleRate)))
  const segmentStart = Math.max(0, segmentEnd - Math.round(SCRATCH_SOURCE_DURATION * sampleRate))
  const segmentLength = Math.max(2, segmentEnd - segmentStart)

  // Sample positions (in source samples) and how fast we are moving through them.
  const positions = new Float32Array(outLength)
  const speeds = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const p = positionAt(i / (outLength - 1))
    positions[i] = segmentStart + p * (segmentLength - 1)
  }
  for (let i = 0; i < outLength; i++) {
    const prev = positions[Math.max(0, i - 1)]
    const next = positions[Math.min(outLength - 1, i + 1)]
    speeds[i] = (next - prev) / 2
  }

  // Amplitude: micro fade in, full through the coast, then the needle stops.
  const fadeInSamples = Math.max(1, Math.round(EDGE_FADE * sampleRate))
  const stopStart = Math.round(outLength * 0.86)
  const stopEnd = Math.round(outLength * 0.93)
  const amplitude = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    let gain = i < fadeInSamples ? i / fadeInSamples : 1
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
    noiseEnvelope[i] = (0.05 * burst + 0.018 * motion) * amplitude[i]
  }

  const lowpassCoeff = 1 - Math.exp((-2 * Math.PI * 5000) / sampleRate)
  const highpassCoeff = 1 - Math.exp((-2 * Math.PI * 1200) / sampleRate)

  for (let c = 0; c < channels; c++) {
    const source = clip.getChannelData(c)
    const target = out.getChannelData(c)
    let lowpass = 0
    let highpassState = 0
    for (let i = 0; i < outLength; i++) {
      // Fractional read of the source: this is the pitch/direction sweep.
      const position = positions[i]
      const index = Math.floor(position)
      const frac = position - index
      const a = source[Math.max(0, Math.min(source.length - 1, index))]
      const b = source[Math.max(0, Math.min(source.length - 1, index + 1))]
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

/**
 * Make a user-supplied scratch sample line up with the clip: same sample rate,
 * same channel count, trimmed to `maxDuration`, with click-free edges.
 */
export async function conformScratchSample(
  sample: AudioBuffer,
  sampleRate: number,
  channels: number,
  maxDuration: number,
): Promise<AudioBuffer> {
  const resampled = await conformSampleRate(sample, sampleRate)
  const rechanneled = conformChannels(resampled, channels)
  const maxSamples = Math.max(2, Math.round(maxDuration * sampleRate))
  const length = Math.min(rechanneled.length, maxSamples)
  const out = createAudioBuffer(channels, length, sampleRate)
  const fade = Math.max(1, Math.round(EDGE_FADE * sampleRate))
  for (let c = 0; c < channels; c++) {
    const data = rechanneled.getChannelData(c).subarray(0, length)
    const target = out.getChannelData(c)
    target.set(data)
    for (let i = 0; i < fade && i < length; i++) {
      target[i] *= i / fade
      target[length - 1 - i] *= i / fade
    }
  }
  return out
}
