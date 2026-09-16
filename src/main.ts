import './style.css'
import { decodeFile } from './audio/decode'
import { PreviewPlayer } from './audio/player'
import { canScratch, renderClip, type RenderResult } from './audio/render'
import { MAX_SCRATCH_LENGTH, MIN_SCRATCH_LENGTH } from './audio/scratch'
import { downloadBlob } from './export/download'
import { encodeBuffer } from './export/encode'
import {
  initialSelection,
  resetToDefaultLength,
  setEnd,
  setFromRegion,
  setLength,
  setStart,
  type Selection,
} from './selection'
import { createInitialState, type Bitrate, type ExportFormat } from './types'
import { ControlsPanel } from './ui/controls'
import { initFileLoader } from './ui/fileLoader'
import { SelectionPanel } from './ui/selectionPanel'
import { WaveformView } from './ui/waveform'
import { byId, setStatus } from './util/dom'
import { clamp, formatTime, formatTimeForFilename } from './util/time'

/** How long to wait after the last edit before re-rendering the clip. */
const RENDER_DEBOUNCE = 300
/** How much of the ending "Play ending" auditions. */
const ENDING_PREVIEW = 8

const state = createInitialState()

const loadStatus = byId<HTMLElement>('load-status')
const previewStatus = byId<HTMLElement>('preview-status')
const metaPanel = byId<HTMLElement>('meta')
const editor = byId<HTMLElement>('editor')

let rendered: RenderResult | null = null
let renderInFlight: Promise<RenderResult> | null = null
let renderToken = 0
let debounceTimer: number | undefined
let filenameEdited = false
let sourceName = 'clip'

const waveform = new WaveformView(byId<HTMLElement>('waveform'), {
  onRegionChange: (start, end, side) => {
    if (side && !state.customLength) setCustomLength(true)
    applySelection(setFromRegion(currentSelection(), start, end, trackDuration(), side))
  },
  onRegionCommit: () => refreshPanels(),
  onSeek: () => {
    player.stop()
  },
})

const player = new PreviewPlayer({
  onTime: (time) => {
    const position = Math.min(state.startTime + time, trackDuration())
    waveform.setPlayhead(position)
  },
  onEnded: () => {
    setStatus(previewStatus, '')
  },
})

const selectionPanel = new SelectionPanel({
  onStart: (value) =>
    applySelection(setStart(currentSelection(), value, trackDuration(), state.customLength)),
  onEnd: (value) => {
    setCustomLength(true)
    applySelection(setEnd(currentSelection(), value, trackDuration()))
  },
  onLength: (value) => {
    setCustomLength(true)
    applySelection(setLength(currentSelection(), value, trackDuration()))
  },
  onNudge: (target, delta) => {
    const selection = currentSelection()
    if (target === 'start') {
      applySelection(setStart(selection, selection.start + delta, trackDuration(), state.customLength))
    } else {
      setCustomLength(true)
      applySelection(setEnd(selection, selection.end + delta, trackDuration()))
    }
  },
  onCustomLength: (value) => {
    setCustomLength(value)
    refreshPanels()
  },
  onReset: () => {
    setCustomLength(false)
    applySelection(resetToDefaultLength(currentSelection(), trackDuration()))
  },
})

const controls = new ControlsPanel({
  onScratchEnabled: (value) => {
    state.scratch.enabled = value
    invalidateRender()
    refreshPanels()
  },
  onScratchPlacement: (value) => {
    state.scratch.placement = value
    invalidateRender()
    refreshPanels()
  },
  onScratchSource: (value) => {
    state.scratch.source = value
    invalidateRender()
    refreshPanels()
  },
  onScratchFile: (file) => {
    void loadScratchSample(file)
  },
  onScratchLength: (value) => {
    state.scratch.length = value
    invalidateRender()
    refreshPanels()
  },
  onScratchVolume: (value) => {
    state.scratch.volume = value
    invalidateRender()
  },
  onFadeIn: (enabled, length) => {
    state.fades.fadeIn = enabled
    state.fades.fadeInLength = length
    invalidateRender()
    refreshPanels()
  },
  onFadeOut: (enabled, length) => {
    state.fades.fadeOut = enabled
    state.fades.fadeOutLength = length
    invalidateRender()
    refreshPanels()
  },
  onNormalize: (value) => {
    state.normalize = value
    invalidateRender()
    refreshPanels()
  },
  onFormat: (value: ExportFormat) => {
    state.export.format = value
    if (!filenameEdited) state.export.filename = defaultFilename()
    else state.export.filename = withExtension(state.export.filename, value)
    refreshPanels()
  },
  onBitrate: (value: Bitrate) => {
    state.export.bitrate = value
  },
  onFilename: (value) => {
    const trimmed = value.trim()
    filenameEdited = trimmed.length > 0
    state.export.filename = trimmed || defaultFilename()
    refreshPanels()
  },
  onExport: () => {
    void runExport()
  },
})

function trackDuration(): number {
  return state.sourceBuffer?.duration ?? 0
}

function currentSelection(): Selection {
  return { start: state.startTime, end: state.endTime }
}

function clipDuration(): number {
  return state.endTime - state.startTime
}

function setCustomLength(value: boolean): void {
  if (state.customLength === value) return
  state.customLength = value
  waveform.setResizable(value)
}

function applySelection(next: Selection): void {
  const changed = next.start !== state.startTime || next.end !== state.endTime
  state.startTime = next.start
  state.endTime = next.end
  waveform.setRegion(next.start, next.end)
  if (!filenameEdited) state.export.filename = defaultFilename()
  if (changed) {
    // Moving the window makes whatever is playing the wrong clip.
    player.stop()
    invalidateRender()
  }
  refreshPanels()
}

function refreshPanels(): void {
  selectionPanel.update(currentSelection(), state.customLength, trackDuration())
  controls.update(state, canScratch(clipDuration()), rendered?.scratchNote ?? null)
}

function invalidateRender(): void {
  rendered = null
  renderInFlight = null
  renderToken += 1
  window.clearTimeout(debounceTimer)
  debounceTimer = window.setTimeout(() => {
    void ensureRendered().catch(() => {
      /* surfaced when previewing or exporting */
    })
  }, RENDER_DEBOUNCE)
}

/** Render the clip once and reuse it for both preview and export. */
function ensureRendered(): Promise<RenderResult> {
  if (rendered) return Promise.resolve(rendered)
  if (renderInFlight) return renderInFlight
  const token = ++renderToken
  const task = renderClip(state).then((result) => {
    if (token === renderToken) {
      rendered = result
      renderInFlight = null
      refreshPanels()
    }
    return result
  })
  renderInFlight = task
  return task
}

function sanitizeBaseName(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .trim()
}

function withExtension(filename: string, extension: string): string {
  return `${filename.replace(/\.[^.]+$/, '')}.${extension}`
}

function defaultFilename(): string {
  const base = sanitizeBaseName(sourceName) || 'clip'
  const length = Math.round(clipDuration())
  return `${base}_snippet_${formatTimeForFilename(state.startTime)}_${length}s.${state.export.format}`
}

async function loadFile(file: File): Promise<void> {
  player.stop()
  setStatus(loadStatus, `Decoding ${file.name}…`)
  try {
    const { buffer } = await decodeFile(file)
    state.file = file
    state.sourceBuffer = buffer
    sourceName = file.name

    const selection = initialSelection(buffer.duration)
    state.startTime = selection.start
    state.endTime = selection.end
    state.customLength = false
    filenameEdited = false
    state.export.filename = defaultFilename()

    byId('meta-name').textContent = file.name
    byId('meta-duration').textContent = formatTime(buffer.duration)
    byId('meta-samplerate').textContent = `${buffer.sampleRate.toLocaleString()} Hz`
    byId('meta-channels').textContent =
      buffer.numberOfChannels === 1
        ? 'Mono'
        : buffer.numberOfChannels === 2
          ? 'Stereo'
          : `${buffer.numberOfChannels} channels`
    metaPanel.hidden = false
    editor.hidden = false

    await waveform.load(buffer, selection.start, selection.end, state.customLength)
    setStatus(loadStatus, `Loaded ${file.name}`, 'ok')
    setStatus(previewStatus, '')
    refreshPanels()
    invalidateRender()
  } catch (error) {
    setStatus(loadStatus, error instanceof Error ? error.message : String(error), 'error')
  }
}

async function loadScratchSample(file: File): Promise<void> {
  try {
    const { buffer } = await decodeFile(file)
    state.scratch.customBuffer = buffer
    state.scratch.customName = file.name
    state.scratch.source = 'custom'
    // Default to playing the whole sample; the slider trims it from there.
    state.scratch.length = clamp(
      Math.round(buffer.duration * 10) / 10,
      MIN_SCRATCH_LENGTH,
      MAX_SCRATCH_LENGTH,
    )
    invalidateRender()
    refreshPanels()
  } catch (error) {
    state.scratch.customBuffer = null
    state.scratch.customName = null
    refreshPanels()
    setStatus(previewStatus, error instanceof Error ? error.message : String(error), 'error')
  }
}

async function preview(fromEnding: boolean): Promise<void> {
  if (!state.sourceBuffer) return
  setStatus(previewStatus, 'Rendering…')
  try {
    const result = await ensureRendered()
    const offset = fromEnding ? Math.max(0, result.buffer.duration - ENDING_PREVIEW) : 0
    await player.play(result.buffer, offset)
    setStatus(previewStatus, `Playing ${formatTime(result.buffer.duration)} clip`)
  } catch (error) {
    setStatus(previewStatus, error instanceof Error ? error.message : String(error), 'error')
  }
}

async function runExport(): Promise<void> {
  if (!state.sourceBuffer) return
  controls.setExportBusy(true, 0)
  controls.setExportStatus('Rendering…')
  try {
    const result = await ensureRendered()
    controls.setExportStatus('Encoding…')
    const encoded = await encodeBuffer(result.buffer, state.export.format, state.export.bitrate, (value) =>
      controls.setExportBusy(true, value),
    )
    const filename = withExtension(state.export.filename || defaultFilename(), encoded.extension)
    downloadBlob(encoded.blob, filename)
    const size = `${(encoded.blob.size / 1_000_000).toFixed(1)} MB`
    controls.setExportStatus(
      encoded.note ? `Saved ${filename} (${size}). ${encoded.note}` : `Saved ${filename} (${size})`,
      encoded.note ? 'info' : 'ok',
    )
  } catch (error) {
    controls.setExportStatus(error instanceof Error ? error.message : String(error), 'error')
  } finally {
    controls.setExportBusy(false)
  }
}

initFileLoader((file) => {
  void loadFile(file)
})

byId<HTMLButtonElement>('play-selection').addEventListener('click', () => {
  void preview(false)
})
byId<HTMLButtonElement>('play-ending').addEventListener('click', () => {
  void preview(true)
})
byId<HTMLButtonElement>('stop').addEventListener('click', () => {
  player.stop()
  setStatus(previewStatus, '')
})

refreshPanels()
