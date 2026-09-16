/**
 * decodeAudioData resamples to the decoding context's sample rate, so the only
 * way to keep a file's native rate is to create the context at that rate. These
 * helpers read the rate straight out of the container header.
 */

const MPEG1_RATES = [44100, 48000, 32000]
const MPEG2_RATES = [22050, 24000, 16000]
const MPEG25_RATES = [11025, 12000, 8000]

/** Browsers accept sample rates in this range for an (Offline)AudioContext. */
const MIN_RATE = 8000
const MAX_RATE = 96000

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = ''
  for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[offset + i])
  return text
}

function sniffWav(bytes: Uint8Array, view: DataView): number | null {
  if (bytes.length < 44) return null
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4)
    const size = view.getUint32(offset + 4, true)
    if (id === 'fmt ' && offset + 12 <= bytes.length) return view.getUint32(offset + 12, true)
    offset += 8 + size + (size % 2)
  }
  return null
}

function sniffFlac(bytes: Uint8Array): number | null {
  if (bytes.length < 26 || ascii(bytes, 0, 4) !== 'fLaC') return null
  // STREAMINFO payload starts at byte 8; the 20-bit sample rate at byte 18.
  return (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4) || null
}

function sniffMp3(bytes: Uint8Array): number | null {
  let start = 0
  if (bytes.length > 10 && ascii(bytes, 0, 3) === 'ID3') {
    const size =
      ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f)
    start = 10 + size
  }
  const limit = Math.min(bytes.length - 4, start + 200_000)
  for (let i = start; i < limit; i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue
    const version = (bytes[i + 1] >> 3) & 0x03
    const layer = (bytes[i + 1] >> 1) & 0x03
    const bitrateIndex = (bytes[i + 2] >> 4) & 0x0f
    const rateIndex = (bytes[i + 2] >> 2) & 0x03
    if (version === 1 || layer === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue
    if (version === 3) return MPEG1_RATES[rateIndex]
    if (version === 2) return MPEG2_RATES[rateIndex]
    return MPEG25_RATES[rateIndex]
  }
  return null
}

/** The file's own sample rate, or null when the container is not recognised. */
export function sniffSampleRate(data: ArrayBuffer): number | null {
  const bytes = new Uint8Array(data)
  const view = new DataView(data)
  const rate = sniffWav(bytes, view) ?? sniffFlac(bytes) ?? sniffMp3(bytes)
  if (!rate || !Number.isFinite(rate)) return null
  if (rate < MIN_RATE || rate > MAX_RATE) return null
  return rate
}
