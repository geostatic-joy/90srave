let sharedContext: AudioContext | null = null

/** One lazily-created AudioContext, shared by decoding and preview playback. */
export function getAudioContext(): AudioContext {
  if (!sharedContext) {
    const Ctor: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    sharedContext = new Ctor()
  }
  return sharedContext
}

/** Safari and Chrome start suspended until a user gesture touches the context. */
export async function resumeAudioContext(): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') {
    await ctx.resume()
  }
}

/**
 * Allocate a bare AudioBuffer. The constructor is the fast path; the
 * OfflineAudioContext fallback keeps older Safari happy.
 */
export function createAudioBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
  const safeLength = Math.max(1, Math.floor(length))
  try {
    return new AudioBuffer({ numberOfChannels, length: safeLength, sampleRate })
  } catch {
    return new OfflineAudioContext(numberOfChannels, safeLength, sampleRate).createBuffer(
      numberOfChannels,
      safeLength,
      sampleRate,
    )
  }
}
