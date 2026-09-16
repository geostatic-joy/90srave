import { getAudioContext, resumeAudioContext } from './context'

export interface PreviewCallbacks {
  /** Playback position inside the rendered clip, in seconds. */
  onTime?: (time: number) => void
  onEnded?: () => void
}

/** Plays the rendered clip and reports a playhead position while it runs. */
export class PreviewPlayer {
  private node: AudioBufferSourceNode | null = null
  private frame = 0
  private startedAt = 0
  private startOffset = 0
  private stopping = false

  constructor(private callbacks: PreviewCallbacks = {}) {}

  get playing(): boolean {
    return this.node !== null
  }

  async play(buffer: AudioBuffer, offset = 0): Promise<void> {
    this.stop()
    await resumeAudioContext()
    const ctx = getAudioContext()
    const node = ctx.createBufferSource()
    node.buffer = buffer
    node.connect(ctx.destination)
    node.onended = () => {
      if (this.node === node && !this.stopping) {
        this.teardown()
        this.callbacks.onEnded?.()
      }
    }
    this.node = node
    this.startOffset = Math.max(0, Math.min(offset, buffer.duration))
    this.startedAt = ctx.currentTime
    node.start(0, this.startOffset)
    this.tick()
  }

  stop(): void {
    if (!this.node) return
    this.stopping = true
    try {
      this.node.stop()
    } catch {
      /* already stopped */
    }
    this.stopping = false
    this.teardown()
    this.callbacks.onEnded?.()
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
    this.callbacks.onTime?.(time)
    this.frame = requestAnimationFrame(this.tick)
  }
}
