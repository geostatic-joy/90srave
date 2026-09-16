import { floatToInt16, type PcmPayload } from './pcm'

/** 16-bit PCM WAV. Used as its own export format and as the FLAC fallback. */
export function encodeWav({ channels, sampleRate }: PcmPayload): Uint8Array {
  const numChannels = channels.length
  const frames = channels[0]?.length ?? 0
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const dataSize = frames * blockAlign
  const out = new Uint8Array(44 + dataSize)
  const view = new DataView(out.buffer)

  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeText(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 8 * bytesPerSample, true)
  writeText(36, 'data')
  view.setUint32(40, dataSize, true)

  const ints = channels.map(floatToInt16)
  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      view.setInt16(offset, ints[c][i], true)
      offset += 2
    }
  }
  return out
}
