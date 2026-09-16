import { clamp, roundMs } from './util/time'

/** The default snippet length, and the whole point of the tool. */
export const DEFAULT_LENGTH = 90
/** Shortest selection we allow. */
export const MIN_LENGTH = 1

export interface Selection {
  start: number
  end: number
}

function tidy(selection: Selection): Selection {
  return { start: roundMs(selection.start), end: roundMs(selection.end) }
}

/** 90s from the top, or the whole track when it is shorter than that. */
export function initialSelection(trackDuration: number): Selection {
  const length = Math.min(DEFAULT_LENGTH, trackDuration)
  return tidy({ start: 0, end: length })
}

/** Restore a 90s length from the current start, shifting the start back if it will not fit. */
export function resetToDefaultLength(selection: Selection, trackDuration: number): Selection {
  const length = Math.min(DEFAULT_LENGTH, trackDuration)
  const start = clamp(selection.start, 0, Math.max(0, trackDuration - length))
  return tidy({ start, end: start + length })
}

/** Move the start. With the length locked the whole window slides; otherwise the end stays put. */
export function setStart(
  selection: Selection,
  value: number,
  trackDuration: number,
  customLength: boolean,
): Selection {
  if (!customLength) {
    const length = selection.end - selection.start
    const start = clamp(value, 0, Math.max(0, trackDuration - length))
    return tidy({ start, end: start + length })
  }
  const start = clamp(value, 0, Math.max(0, selection.end - MIN_LENGTH))
  return tidy({ start, end: selection.end })
}

/** Move the end. Only meaningful with a custom length; the start stays put. */
export function setEnd(selection: Selection, value: number, trackDuration: number): Selection {
  const end = clamp(value, Math.min(selection.start + MIN_LENGTH, trackDuration), trackDuration)
  return tidy({ start: selection.start, end })
}

/** Set the length, keeping the start fixed. */
export function setLength(selection: Selection, value: number, trackDuration: number): Selection {
  const maxLength = Math.max(MIN_LENGTH, trackDuration - selection.start)
  const length = clamp(value, Math.min(MIN_LENGTH, maxLength), maxLength)
  return tidy({ start: selection.start, end: selection.start + length })
}

/**
 * Apply a region drag or resize. `side` is undefined for a drag, which keeps the
 * length; a resize moves only the edge that was grabbed.
 */
export function setFromRegion(
  selection: Selection,
  start: number,
  end: number,
  trackDuration: number,
  side: 'start' | 'end' | undefined,
): Selection {
  if (side === 'start') return setStart(selection, start, trackDuration, true)
  if (side === 'end') return setEnd(selection, end, trackDuration)
  // A drag keeps the length whatever the mode: wavesurfer squashes the region
  // against the track edges, so the length comes from state, not from the drag.
  return setStart(selection, start, trackDuration, false)
}
