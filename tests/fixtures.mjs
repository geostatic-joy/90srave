/**
 * Generates the audio fixtures the browser tests run against: a two-minute
 * stereo MP3, plus WAVs that cover mono, 48 kHz, 96 kHz, 22.05 kHz and a track
 * too short for a scratch.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Mp3Encoder } from '@breezystack/lamejs'

export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '.fixtures')

/** Broadband material, so filter sweeps are measurable at all. */
function writeNoiseWav(path, { sampleRate, channels, seconds }) {
  const frames = Math.round(sampleRate * seconds)
  const header = Buffer.alloc(44)
  const data = Buffer.alloc(frames * channels * 2)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  // Deterministic pseudo-noise, so a fixture is always the same fixture.
  let seed = 12345
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      const value = (seed / 0x3fffffff - 1) * 0.5
      data.writeInt16LE(Math.round(value * 24000), (i * channels + c) * 2)
    }
  }
  writeFileSync(path, Buffer.concat([header, data]))
}

function writeWav(path, { sampleRate, channels, seconds, freq = 330 }) {
  const frames = Math.round(sampleRate * seconds)
  const header = Buffer.alloc(44)
  const data = Buffer.alloc(frames * channels * 2)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate
    const value = Math.sin(2 * Math.PI * freq * t) * (0.4 + 0.3 * Math.sin(2 * Math.PI * 1.5 * t))
    for (let c = 0; c < channels; c++) {
      data.writeInt16LE(Math.round(value * 24000 * (c === 1 ? 0.8 : 1)), (i * channels + c) * 2)
    }
  }
  writeFileSync(path, Buffer.concat([header, data]))
}

function writeMp3(path, { sampleRate = 44100, seconds = 120 } = {}) {
  const frames = sampleRate * seconds
  const left = new Int16Array(frames)
  const right = new Int16Array(frames)
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate
    const tone = Math.sin(2 * Math.PI * (220 + t * 4) * t)
    const beat = Math.sin(2 * Math.PI * 2 * t) > 0.6 ? 1 : 0.4
    left[i] = Math.round(tone * beat * 20000)
    right[i] = Math.round(tone * beat * 18000 * Math.sin(2 * Math.PI * 0.25 * t))
  }
  const encoder = new Mp3Encoder(2, sampleRate, 128)
  const chunks = []
  for (let i = 0; i < frames; i += 1152) {
    const encoded = encoder.encodeBuffer(left.subarray(i, i + 1152), right.subarray(i, i + 1152))
    if (encoded.length) chunks.push(Buffer.from(encoded))
  }
  const tail = encoder.flush()
  if (tail.length) chunks.push(Buffer.from(tail))
  writeFileSync(path, Buffer.concat(chunks))
}

/** Build any fixture that is not on disk yet, and return their paths. */
export function ensureFixtures() {
  mkdirSync(FIXTURE_DIR, { recursive: true })
  const files = {
    track: join(FIXTURE_DIR, 'test-track.mp3'),
    mono48k: join(FIXTURE_DIR, 'mono-48k-45s.wav'),
    short: join(FIXTURE_DIR, 'short-2s.wav'),
    hires: join(FIXTURE_DIR, 'hires-96k-10s.wav'),
    lofi: join(FIXTURE_DIR, 'lofi-22k-10s.wav'),
    noise: join(FIXTURE_DIR, 'noise-10s.wav'),
  }
  if (!existsSync(files.track)) writeMp3(files.track)
  if (!existsSync(files.mono48k)) writeWav(files.mono48k, { sampleRate: 48000, channels: 1, seconds: 45 })
  if (!existsSync(files.short))
    writeWav(files.short, { sampleRate: 44100, channels: 2, seconds: 2.5, freq: 440 })
  if (!existsSync(files.hires))
    writeWav(files.hires, { sampleRate: 96000, channels: 2, seconds: 10, freq: 500 })
  if (!existsSync(files.lofi))
    writeWav(files.lofi, { sampleRate: 22050, channels: 1, seconds: 10, freq: 300 })
  if (!existsSync(files.noise)) writeNoiseWav(files.noise, { sampleRate: 44100, channels: 2, seconds: 10 })
  return files
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = ensureFixtures()
  console.log(Object.values(files).join('\n'))
}
