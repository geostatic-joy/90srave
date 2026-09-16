import { createAudioBuffer } from './context'

/** Everything downstream works in mono or stereo; more channels get folded down. */
export function outputChannelCount(source: AudioBuffer): number {
  return Math.min(2, source.numberOfChannels)
}

/**
 * Read one output channel out of a source buffer, folding extra channels down:
 * odd source channels go right, even ones go left.
 */
function readChannel(source: AudioBuffer, targetChannel: number, targetChannels: number): Float32Array {
  const channels = source.numberOfChannels
  if (channels === targetChannels) {
    return source.getChannelData(targetChannel)
  }
  if (channels === 1) {
    return source.getChannelData(0)
  }
  if (targetChannels === 1) {
    const mixed = new Float32Array(source.length)
    for (let c = 0; c < channels; c++) {
      const data = source.getChannelData(c)
      for (let i = 0; i < mixed.length; i++) mixed[i] += data[i]
    }
    for (let i = 0; i < mixed.length; i++) mixed[i] /= channels
    return mixed
  }
  // More than two source channels: average every other channel into L / R.
  const mixed = new Float32Array(source.length)
  let count = 0
  for (let c = targetChannel; c < channels; c += 2) {
    const data = source.getChannelData(c)
    for (let i = 0; i < mixed.length; i++) mixed[i] += data[i]
    count++
  }
  if (count > 1) {
    for (let i = 0; i < mixed.length; i++) mixed[i] /= count
  }
  return mixed
}

/** Copy `[startTime, endTime)` of `source` into a new buffer with at most 2 channels. */
export function sliceBuffer(source: AudioBuffer, startTime: number, endTime: number): AudioBuffer {
  const sampleRate = source.sampleRate
  const channels = outputChannelCount(source)
  const startSample = Math.max(0, Math.min(source.length, Math.round(startTime * sampleRate)))
  const endSample = Math.max(startSample + 1, Math.min(source.length, Math.round(endTime * sampleRate)))
  const length = endSample - startSample
  const slice = createAudioBuffer(channels, length, sampleRate)
  for (let c = 0; c < channels; c++) {
    const from = readChannel(source, c, channels)
    slice.getChannelData(c).set(from.subarray(startSample, endSample))
  }
  return slice
}

/** Re-channel a buffer (mono <-> stereo) without touching its sample rate. */
export function conformChannels(source: AudioBuffer, targetChannels: number): AudioBuffer {
  if (source.numberOfChannels === targetChannels) return source
  const out = createAudioBuffer(targetChannels, source.length, source.sampleRate)
  for (let c = 0; c < targetChannels; c++) {
    out.getChannelData(c).set(readChannel(source, c, targetChannels))
  }
  return out
}

/** Resample a buffer if it does not already run at `sampleRate`. */
export async function conformSampleRate(source: AudioBuffer, sampleRate: number): Promise<AudioBuffer> {
  if (source.sampleRate === sampleRate) return source
  const length = Math.max(1, Math.round((source.length / source.sampleRate) * sampleRate))
  const ctx = new OfflineAudioContext(source.numberOfChannels, length, sampleRate)
  const node = ctx.createBufferSource()
  node.buffer = source
  node.connect(ctx.destination)
  node.start()
  return ctx.startRendering()
}

/** Scale a buffer in place so its loudest sample sits just under full scale. */
export function normalizeBuffer(buffer: AudioBuffer, ceiling = 0.97): void {
  let peak = 0
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) {
      const value = Math.abs(data[i])
      if (value > peak) peak = value
    }
  }
  if (peak === 0 || Math.abs(peak - ceiling) < 1e-4) return
  const gain = ceiling / peak
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < data.length; i++) data[i] *= gain
  }
}
