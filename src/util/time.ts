/** Format seconds as `m:ss.s` (or `h:mm:ss.s` past an hour). */
export function formatTime(seconds: number): string {
  const safe = Math.max(0, seconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  const secsText = secs.toFixed(1).padStart(4, '0')
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${secsText}`
  }
  return `${minutes}:${secsText}`
}

/** Format seconds compactly for filenames: `03-42`. */
export function formatTimeForFilename(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(safe / 60)
  const secs = safe % 60
  return `${String(minutes).padStart(2, '0')}-${String(secs).padStart(2, '0')}`
}

/**
 * Parse `mm:ss.s`, `h:mm:ss.s` or a plain number of seconds.
 * Returns null when the text cannot be read as a time.
 */
export function parseTime(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const parts = trimmed.split(':')
  if (parts.length > 3) return null
  let total = 0
  for (const part of parts) {
    if (!/^\d*\.?\d*$/.test(part.trim()) || part.trim() === '') return null
    const value = Number(part)
    if (!Number.isFinite(value)) return null
    total = total * 60 + value
  }
  return total
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

/** Round to the nearest millisecond so typed values and drags stay tidy. */
export function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000
}
