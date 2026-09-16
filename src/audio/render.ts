import type { AppState } from '../types'
import { normalizeBuffer, sliceBuffer } from './buffers'
import {
  EDGE_FADE,
  MIN_CLIP_FOR_SCRATCH,
  SCRATCH_DURATION,
  conformScratchSample,
  synthesizeScratch,
} from './scratch'

/** Longest a custom sample may run when appended after the clip. */
const MAX_APPENDED_SCRATCH = 30

export interface RenderResult {
  buffer: AudioBuffer
  /** Where the music stops inside the rendered clip, in seconds. */
  musicDuration: number
  /** Where the scratch starts, in seconds, or null when there is none. */
  scratchStart: number | null
  /** Set when the scratch was requested but could not be applied. */
  scratchSkipped: string | null
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
  let scratchSkipped: string | null = null

  if (scratch.enabled) {
    const overlay = scratch.placement === 'overlay'
    if (!canScratch(clipDuration)) {
      scratchSkipped = `The scratch needs a clip of at least ${MIN_CLIP_FOR_SCRATCH}s.`
    } else if (scratch.source === 'custom' && !scratch.customBuffer) {
      scratchSkipped = 'No custom scratch sample loaded yet.'
    } else if (scratch.source === 'custom' && scratch.customBuffer) {
      const maxDuration = overlay ? Math.max(0.1, clipDuration - 0.5) : MAX_APPENDED_SCRATCH
      scratchBuffer = await conformScratchSample(scratch.customBuffer, sampleRate, channels, maxDuration)
    } else {
      const musicEnd = overlay ? clipDuration - SCRATCH_DURATION : clipDuration
      scratchBuffer = synthesizeScratch(slice, musicEnd)
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

  return { buffer: rendered, musicDuration, scratchStart, scratchSkipped }
}
