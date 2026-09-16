/** Rendered audio flattened into plain arrays, ready to hand to a worker. */
export interface PcmPayload {
  channels: Float32Array[]
  sampleRate: number
}

export function bufferToPcm(buffer: AudioBuffer): PcmPayload {
  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    // Copy: the worker takes ownership of these when they are transferred.
    channels.push(Float32Array.from(buffer.getChannelData(c)))
  }
  return { channels, sampleRate: buffer.sampleRate }
}

export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const sample = Math.max(-1, Math.min(1, input[i]))
    out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return out
}
