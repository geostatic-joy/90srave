import { getAudioContext, resumeAudioContext } from './context'

export interface PlayOptions {
  /** Where to start inside the buffer, in seconds. */
  offset?: number
  /** Linear gain applied while playing. */
  gain?: number
  /** Off for sounds that are not part of the clip, like a sample audition. */
  followPlayhead?: boolean
}

export interface PreviewCallbacks {
  /** Playback position inside the rendered clip, in seconds. */
  onTime?: (time: number) => void
  onEnded?: () => void
}

/** Plays the rendered clip and reports a playhead position while it runs. */
export class PreviewPlayer {
  private node: AudioBufferSourceNode | null = null
  /**
   * Every node started and not yet torn down. play() has to await the audio
   * context, so two calls can overlap; this makes sure stop() can still silence
   * one that lost the race and is no longer the current node.
   */
  private live = new Set<AudioBufferSourceNode>()
  /** Bumped by every play() and stop(), so a superseded play() gives up. */
  private generation = 0
  private frame = 0
  private startedAt = 0
  private startOffset = 0
  private stopping = false
  private followPlayhead = true

  constructor(private callbacks: PreviewCallbacks = {}) {}

  get playing(): boolean {
    return this.node !== null
  }

  async play(buffer: AudioBuffer, options: PlayOptions = {}): Promise<void> {
    const { offset = 0, gain = 1, followPlayhead = true } = options
    this.stop()
    const generation = ++this.generation
    await resumeAudioContext()
    // Something else started playing while the context was resuming — on a
    // first play that wait is long enough to matter. The newer call wins.
    if (generation !== this.generation) return
    const ctx = getAudioContext()
    const node = ctx.createBufferSource()
    node.buffer = buffer
    if (gain === 1) {
      node.connect(ctx.destination)
    } else {
      const gainNode = ctx.createGain()
      gainNode.gain.value = gain
      node.connect(gainNode).connect(ctx.destination)
    }
    this.followPlayhead = followPlayhead
    node.onended = () => {
      this.live.delete(node)
      if (this.node === node && !this.stopping) {
        this.teardown()
        this.callbacks.onEnded?.()
      }
    }
    this.live.add(node)
    this.node = node
    this.startOffset = Math.max(0, Math.min(offset, buffer.duration))
    this.startedAt = ctx.currentTime
    node.start(0, this.startOffset)
    this.tick()
  }

  stop(): void {
    // Supersede any play() still waiting on the audio context.
    this.generation++
    const wasPlaying = this.node !== null
    this.stopping = true
    for (const node of this.live) {
      try {
        node.stop()
      } catch {
        /* already stopped */
      }
      node.onended = null
      node.disconnect()
    }
    this.live.clear()
    this.stopping = false
    this.teardown()
    if (wasPlaying) this.callbacks.onEnded?.()
  }

  private teardown(): void {
    if (this.node) {
      this.node.onended = null
      this.node.disconnect()
      this.node = null
    }
    if (this.frame) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
    }
  }

  private tick = (): void => {
    if (!this.node) return
    const ctx = getAudioContext()
    const time = this.startOffset + (ctx.currentTime - this.startedAt)
    if (this.followPlayhead) this.callbacks.onTime?.(time)
    this.frame = requestAnimationFrame(this.tick)
  }
}
