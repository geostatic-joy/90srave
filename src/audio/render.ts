import type { AppState } from '../types'
import { normalizeBuffer, sliceBuffer } from './buffers'
import {
  EDGE_FADE,
  MIN_CLIP_FOR_SCRATCH,
  SCRATCH_STYLES,
  conformScratchSample,
  synthesizeScratch,
} from './scratch'

/** An overlaid scratch always leaves at least this much music in front of it. */
const MIN_MUSIC_BEFORE_SCRATCH = 0.5

export interface RenderResult {
  buffer: AudioBuffer
  /** Where the music stops inside the rendered clip, in seconds. */
  musicDuration: number
  /** Where the scratch starts, in seconds, or null when there is none. */
  scratchStart: number | null
  /** Set when the scratch could not be applied, or had to be shortened. */
  scratchNote: string | null
}

export function canScratch(clipDuration: number): boolean {
  return clipDuration >= MIN_CLIP_FOR_SCRATCH
}

/**
 * Turn the current selection plus effects into a single AudioBuffer.
 * Preview and export both consume this, so they cannot drift apart.
 */
export async function renderClip(state: AppState): Promise<RenderResult> {
  const source = state.sourceBuffer
  if (!source) throw new Error('No audio loaded.')

  const sampleRate = source.sampleRate
  const slice = sliceBuffer(source, state.startTime, state.endTime)
  const channels = slice.numberOfChannels
  const clipDuration = slice.length / sampleRate

  const { scratch } = state
  let scratchBuffer: AudioBuffer | null = null
  let scratchNote: string | null = null

  if (scratch.enabled) {
    const overlay = scratch.placement === 'overlay'
    // Overlaying eats into the music, so there the scratch can only be as long
    // as the clip can spare. Appending costs the music nothing.
    const room = overlay ? Math.max(0.1, clipDuration - MIN_MUSIC_BEFORE_SCRATCH) : scratch.length
    const length = Math.min(scratch.length, room)
    if (length < scratch.length - 0.001) {
      scratchNote = `Scratch shortened to ${length.toFixed(1)}s to leave room for the music.`
    }

    if (!canScratch(clipDuration)) {
      scratchNote = `The scratch needs a clip of at least ${MIN_CLIP_FOR_SCRATCH}s.`
    } else if (scratch.source === 'custom' && !scratch.customBuffer) {
      scratchNote = 'No custom scratch sample loaded yet.'
    } else if (scratch.source === 'custom' && scratch.customBuffer) {
      scratchBuffer = await conformScratchSample(scratch.customBuffer, sampleRate, channels, length)
    } else {
      const style = SCRATCH_STYLES[scratch.style]
      const musicEnd = overlay ? clipDuration - length : clipDuration
      // The gesture reads from the track around the cut, not just from the
      // selection: styles that keep rolling forward (power down, the lurch at
      // the start of a needle drag) need the audio on the far side of it.
      const cut = state.startTime + musicEnd
      const windowStart = Math.max(0, cut - style.lookBehind * length)
      const windowEnd = Math.min(source.duration, cut + style.lookAhead * length)
      const window = sliceBuffer(source, windowStart, windowEnd)
      const cutSample = Math.round((cut - windowStart) * sampleRate)
      scratchBuffer = synthesizeScratch(window, cutSample, length, style)
    }
  }

  const overlay = scratch.placement === 'overlay'
  const scratchDuration = scratchBuffer ? scratchBuffer.length / sampleRate : 0
  const musicDuration = scratchBuffer && overlay ? clipDuration - scratchDuration : clipDuration
  const outDuration = scratchBuffer && !overlay ? clipDuration + scratchDuration : clipDuration

  const ctx = new OfflineAudioContext(channels, Math.max(1, Math.round(outDuration * sampleRate)), sampleRate)

  const music = ctx.createBufferSource()
  music.buffer = slice
  const musicGain = ctx.createGain()
  music.connect(musicGain).connect(ctx.destination)

  // Fades. Both edges always get at least a 5ms micro fade so cuts do not click.
  const half = Math.max(EDGE_FADE, musicDuration / 2)
  const fadeIn = Math.min(
    half,
    state.fades.fadeIn ? Math.max(state.fades.fadeInLength, EDGE_FADE) : EDGE_FADE,
  )
  const fadeOutRequested = state.fades.fadeOut && !scratchBuffer
  const fadeOut = Math.min(
    half,
    fadeOutRequested ? Math.max(state.fades.fadeOutLength, EDGE_FADE) : EDGE_FADE,
  )

  musicGain.gain.setValueAtTime(0, 0)
  musicGain.gain.linearRampToValueAtTime(1, fadeIn)
  musicGain.gain.setValueAtTime(1, Math.max(fadeIn, musicDuration - fadeOut))
  musicGain.gain.linearRampToValueAtTime(0, musicDuration)
  music.start(0, 0, musicDuration)

  const scratchStart = scratchBuffer ? (overlay ? musicDuration : clipDuration) : null
  if (scratchBuffer && scratchStart !== null) {
    const scratchNode = ctx.createBufferSource()
    scratchNode.buffer = scratchBuffer
    const scratchGain = ctx.createGain()
    scratchGain.gain.value = scratch.volume
    scratchNode.connect(scratchGain).connect(ctx.destination)
    scratchNode.start(scratchStart)
  }

  const rendered = await ctx.startRendering()
  if (state.normalize) normalizeBuffer(rendered)

  return { buffer: rendered, musicDuration, scratchStart, scratchNote }
}
