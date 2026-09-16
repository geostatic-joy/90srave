import { Mp3Encoder } from '@breezystack/lamejs'
import { floatToInt16 } from './pcm'

interface Mp3Request {
  channels: Float32Array[]
  sampleRate: number
  bitrate: number
}

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<Mp3Request>) => void) | null
  postMessage(message: unknown, transfer?: Transferable[]): void
}

/** lamejs wants 1152-sample frames of 16-bit PCM per channel. */
const FRAME_SIZE = 1152

worker.onmessage = (event: MessageEvent<Mp3Request>) => {
  const { channels, sampleRate, bitrate } = event.data
  try {
    const numChannels = Math.min(2, channels.length)
    const encoder = new Mp3Encoder(numChannels, sampleRate, bitrate)
    const left = floatToInt16(channels[0])
    const right = numChannels > 1 ? floatToInt16(channels[1]) : null
    const chunks: Uint8Array[] = []
    let size = 0

    for (let offset = 0; offset < left.length; offset += FRAME_SIZE) {
      const leftFrame = left.subarray(offset, offset + FRAME_SIZE)
      const encoded = right
        ? encoder.encodeBuffer(leftFrame, right.subarray(offset, offset + FRAME_SIZE))
        : encoder.encodeBuffer(leftFrame)
      if (encoded.length > 0) {
        const copy = new Uint8Array(encoded)
        chunks.push(copy)
        size += copy.length
      }
      if (offset % (FRAME_SIZE * 128) === 0) {
        worker.postMessage({ type: 'progress', value: offset / left.length })
      }
    }

    const tail = encoder.flush()
    if (tail.length > 0) {
      const copy = new Uint8Array(tail)
      chunks.push(copy)
      size += copy.length
    }

    const bytes = new Uint8Array(size)
    let position = 0
    for (const chunk of chunks) {
      bytes.set(chunk, position)
      position += chunk.length
    }
    worker.postMessage({ type: 'done', bytes }, [bytes.buffer])
  } catch (error) {
    worker.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
