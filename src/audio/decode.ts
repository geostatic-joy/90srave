import { getAudioContext } from './context'
import { sniffSampleRate } from './sniff'

export interface DecodedAudio {
  buffer: AudioBuffer
  name: string
}

const KNOWN_EXTENSIONS = ['.mp3', '.flac', '.wav', '.m4a', '.ogg', '.opus', '.aac']

export function looksLikeAudio(file: File): boolean {
  if (file.type.startsWith('audio/')) return true
  const lower = file.name.toLowerCase()
  return KNOWN_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** Decode any file the browser's audio decoder understands into an AudioBuffer. */
export async function decodeFile(file: File): Promise<DecodedAudio> {
  if (!looksLikeAudio(file)) {
    throw new Error(`"${file.name}" does not look like an audio file. Try an MP3 or FLAC.`)
  }
  const bytes = await file.arrayBuffer()
  // decodeAudioData resamples to the decoding context's rate, so decode at the
  // file's own rate where the header tells us what it is — otherwise a 48 kHz
  // or 96 kHz master would quietly come back downsampled.
  const nativeRate = sniffSampleRate(bytes)
  let buffer: AudioBuffer | null = null
  if (nativeRate) {
    try {
      buffer = await new OfflineAudioContext(1, 1, nativeRate).decodeAudioData(bytes.slice(0))
    } catch {
      // Header lied, or the browser dislikes that rate: fall back below.
    }
  }
  if (!buffer) {
    try {
      buffer = await getAudioContext().decodeAudioData(bytes)
    } catch (error) {
      const detail = error instanceof Error && error.message ? ` (${error.message})` : ''
      throw new Error(
        `This browser could not decode "${file.name}"${detail}. FLAC needs a recent Chrome, Firefox or Safari.`,
      )
    }
  }
  if (buffer.length === 0) {
    throw new Error(`"${file.name}" decoded to an empty track.`)
  }
  return { buffer, name: file.name }
}
