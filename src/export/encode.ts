import Mp3Worker from './encodeMp3.worker.ts?worker'
import { conformSampleRate } from '../audio/buffers'
import type { Bitrate, ExportFormat } from '../types'
import { encodeWav } from './encodeWav'
import { bufferToPcm } from './pcm'

/** Sample rates lamejs (MPEG1/2/2.5 layer III) can actually encode. */
const MP3_SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]
/** MPEG2 / MPEG2.5 top out well below 320 kbps. */
const MP3_LOW_RATE_MAX_BITRATE = 160

export interface EncodeResult {
  blob: Blob
  extension: ExportFormat
  /** Set when the export had to deviate from what was asked for. */
  note: string | null
}

type ProgressFn = (value: number) => void

interface WorkerDone {
  type: 'done'
  bytes: Uint8Array
}

interface WorkerProgress {
  type: 'progress'
  value: number
}

interface WorkerFailure {
  type: 'error'
  message: string
}

type WorkerMessage = WorkerDone | WorkerProgress | WorkerFailure

function runWorker(
  worker: Worker,
  payload: unknown,
  transfers: Transferable[],
  onProgress?: ProgressFn,
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data
      if (message.type === 'progress') {
        onProgress?.(message.value)
      } else if (message.type === 'done') {
        resolve(message.bytes)
        worker.terminate()
      } else {
        reject(new Error(message.message))
        worker.terminate()
      }
    }
    worker.onerror = (event) => {
      reject(new Error(event.message || 'The encoder worker crashed.'))
      worker.terminate()
    }
    worker.postMessage(payload, transfers)
  })
}

function flacWorkerUrls(): { worker: string; lib: string; dir: string } {
  const base = new URL(import.meta.env.BASE_URL, document.baseURI)
  const lib = new URL('flac/libflac.min.wasm.js', base)
  return {
    worker: new URL('flac/flacEncoderWorker.js', base).href,
    lib: lib.href,
    dir: lib.href.slice(0, lib.href.lastIndexOf('/') + 1),
  }
}

async function encodeMp3(
  buffer: AudioBuffer,
  bitrate: Bitrate,
  onProgress?: ProgressFn,
): Promise<EncodeResult> {
  let source = buffer
  const notes: string[] = []

  if (!MP3_SAMPLE_RATES.includes(source.sampleRate)) {
    source = await conformSampleRate(source, 48000)
    notes.push(`MP3 cannot carry ${buffer.sampleRate} Hz — resampled to 48 kHz.`)
  }

  let effectiveBitrate: number = bitrate
  if (source.sampleRate < 32000 && bitrate > MP3_LOW_RATE_MAX_BITRATE) {
    effectiveBitrate = MP3_LOW_RATE_MAX_BITRATE
    notes.push(`At ${source.sampleRate} Hz, MP3 tops out at ${MP3_LOW_RATE_MAX_BITRATE} kbps.`)
  }

  const pcm = bufferToPcm(source)
  const bytes = await runWorker(
    new Mp3Worker(),
    { channels: pcm.channels, sampleRate: pcm.sampleRate, bitrate: effectiveBitrate },
    pcm.channels.map((channel) => channel.buffer),
    onProgress,
  )
  return {
    blob: new Blob([bytes as BlobPart], { type: 'audio/mpeg' }),
    extension: 'mp3',
    note: notes.length ? notes.join(' ') : null,
  }
}

async function encodeFlac(buffer: AudioBuffer, onProgress?: ProgressFn): Promise<EncodeResult> {
  const urls = flacWorkerUrls()
  const pcm = bufferToPcm(buffer)
  const bytes = await runWorker(
    new Worker(urls.worker),
    {
      libUrl: urls.lib,
      libDir: urls.dir,
      channels: pcm.channels,
      sampleRate: pcm.sampleRate,
      compression: 5,
    },
    pcm.channels.map((channel) => channel.buffer),
    onProgress,
  )
  return { blob: new Blob([bytes as BlobPart], { type: 'audio/flac' }), extension: 'flac', note: null }
}

function encodeWavResult(buffer: AudioBuffer, note: string | null = null): EncodeResult {
  const bytes = encodeWav(bufferToPcm(buffer))
  return { blob: new Blob([bytes as BlobPart], { type: 'audio/wav' }), extension: 'wav', note }
}

/**
 * Encode the rendered clip. FLAC falls back to WAV rather than failing the
 * export outright, and says so in the returned note.
 */
export async function encodeBuffer(
  buffer: AudioBuffer,
  format: ExportFormat,
  bitrate: Bitrate,
  onProgress?: ProgressFn,
): Promise<EncodeResult> {
  if (format === 'mp3') return encodeMp3(buffer, bitrate, onProgress)
  if (format === 'wav') return encodeWavResult(buffer)
  try {
    return await encodeFlac(buffer, onProgress)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return encodeWavResult(buffer, `FLAC encoding was unavailable (${reason}) — exported WAV instead.`)
  }
}
